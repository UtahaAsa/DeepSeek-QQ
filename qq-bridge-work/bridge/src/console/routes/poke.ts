import type {NamedConsoleRoutes} from './contracts.js';
import type {ConsoleRequestHead} from '../request-context.js';
import type {SocialV2State} from '../../social/v2-store.js';
/** 配置继续沿用Number归一化，未验证的限频值不冒充数字。 */
export interface PokeConfiguration {socialV2?: {send?: {maxSendPerMinute?: unknown; maxSendPerHour?: unknown}|null; context?: {recentLimit?: unknown}|null};}
export type PokeState = Pick<SocialV2State,'sendTimes'|'lastActionAt'|'lastAiReplyAt'|'wakeConfig'|'recentMessages'|'preSleepWaitSatisfiedAt'|'preSleepWaitObservedAt'|'preSleepWaitAccumMs'>;
export type PokeRoutes = NamedConsoleRoutes<'postSocialV2SendPoke'>;
/** 成员校验与发送均可等待，captureSendGuard必须同步返回发送前复核函数。 */
export interface PokeDependencies<Configuration extends PokeConfiguration> {
  readonly cfg: Configuration; readonly currentMode: string; readonly socialV2: {paused: boolean};
  readonly agentTokenOk: (key: string, token: NonNullable<ConsoleRequestHead['headers'][string]>) => boolean;
  readonly v2SessionAllowed: (key: string) => boolean; readonly v2ToolEnabled: (tool: 'sendPoke') => boolean;
  readonly modeAllowed: (key: string, kind: string, id: number, cfg: Configuration, mode: string) => boolean;
  readonly shouldBlockSilentReply: (key: string) => boolean;
  readonly assertGroupMember: (groupId: number, targetId: string) => Promise<string | null | undefined>;
  readonly getSocialV2State: (key: string) => PokeState; readonly captureSendGuard: (key: string) => () => void;
  readonly bot: {raw: (action: 'group_poke'|'send_poke', params: {user_id: number; group_id?: number}) => Promise<unknown>};
  readonly saveSocialV2State: () => void; readonly log: (...values: unknown[]) => void; readonly appendActivity: (message: string) => void;
}
/** 仅描述旧catch路径所读取的错误属性，不验证任意抛出值。 */
interface LegacyPokeError {message?: unknown; statusCode?: number;}
/**
 * poke功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：currentMode, agentTokenOk, v2SessionAllowed, v2ToolEnabled, socialV2, modeAllowed, cfg, shouldBlockSilentReply, assertGroupMember, getSocialV2State, captureSendGuard, bot, saveSocialV2State, log, appendActivity。
 */
export function createPokeRoutes<Configuration extends PokeConfiguration>(deps: PokeDependencies<Configuration>): PokeRoutes {
  return {
    postSocialV2SendPoke: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/send-poke',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const key = String(body.key ?? '').trim();
        const targetUserId = String(body.targetUserId ?? body.userId ?? '').trim();
        if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (deps.currentMode !== 'reserved2') { sendJson({ ok: false, error: '该接口仅 reserved2 模式可用' }, 403); return; }
        if (!req.headers['x-agent-token']) { sendJson({ ok: false, error: 'reserved2 模式发送拍一拍必须携带 agent token' }, 403); return; }
        if (!(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (!(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (!(0, deps.v2ToolEnabled)('sendPoke')) { sendJson({ ok: false, error: '工具未启用：qq_send_poke' }, 403); return; }
        if (deps.socialV2.paused) { sendJson({ ok: false, error: '二代 AI 已暂停，不能发送拍一拍' }, 403); return; }
        const keyMatch = /^(group|private):(\d+)$/.exec(key);
        if (!keyMatch) { sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400); return; }
        const kind = keyMatch[1];
        const id = Number(keyMatch[2]);
        if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
          sendJson({ ok: false, error: '当前模式不允许操作该会话' }, 403);
          return;
        }
        if ((0, deps.shouldBlockSilentReply)(key)) { sendJson({ ok: false, error: '静默模式已开启，当前不允许拍一拍' }, 403); return; }
        if (kind === 'group' && !targetUserId) {
          sendJson({ ok: false, error: '群聊拍一拍必须指定 targetUserId（要拍的群友 QQ 号）' }, 400);
          return;
        }
        if (targetUserId && !/^[1-9]\d*$/.test(targetUserId)) {
          sendJson({ ok: false, error: 'targetUserId 必须是正整数 QQ 号' }, 400);
          return;
        }
        // 群聊必须确认目标确实是本群成员（私聊天然只有双方，无需校验）。
        if (kind === 'group') {
          const memberError = await (0, deps.assertGroupMember)(id, targetUserId);
          if (memberError) { sendJson({ ok: false, error: memberError }, 403); return; }
        }
        const st = (0, deps.getSocialV2State)(key);
        const sendCfg = deps.cfg.socialV2?.send ?? {};
        const now = Date.now();
        const maxPerMinute = Number(sendCfg.maxSendPerMinute) || 0;
        const maxPerHour = Number(sendCfg.maxSendPerHour) || 0;
        const recentMinute = (st.sendTimes || []).filter((t) => now - t < 60000).length;
        const recentHour = (st.sendTimes || []).filter((t) => now - t < 3600000).length;
        if ((maxPerMinute > 0 && recentMinute + 1 > maxPerMinute) || (maxPerHour > 0 && recentHour + 1 > maxPerHour)) {
          sendJson({ ok: false, error: '发送频率超限，请稍后再试' }, 429);
          return;
        }
        st.sendTimes.push(now);
        if (st.sendTimes.length > 500) st.sendTimes = st.sendTimes.slice(-500);
        // 成员校验是异步的（要问 OneBot）；期间操作者可能切模式/改白名单/开静默。
        // 拍一拍此前完全没有发送守卫，这里补上：真正发之前再确认一次。
        const sendGuard = (0, deps.captureSendGuard)(key);
        try {
          sendGuard();
          if ((0, deps.shouldBlockSilentReply)(key)) {
            const blocked: Error & {statusCode?: number} = new Error('静默模式已开启，当前不允许拍一拍');
            blocked.statusCode = 403;
            throw blocked;
          }
          if (kind === 'group') {
            await deps.bot.raw('group_poke', { group_id: id, user_id: Number(targetUserId) });
          } else {
            // 私聊拍一拍：send_poke 自动路由到当前私聊对象
            await deps.bot.raw('send_poke', { user_id: id });
          }
          st.lastActionAt = now;
          st.lastAiReplyAt = now;
          st.wakeConfig.noActionCount = 0;
          const pokeText = kind === 'group'
            ? `[拍一拍] 我拍了拍 ${targetUserId}`
            : '[拍一拍] 我拍了拍你';
          st.recentMessages.push({
            messageId: null,
            sender: '我',
            text: pokeText,
            plain: pokeText,
            tail: pokeText,
            kind: 'poke',
            quoteTargetIsSelf: false,
            isOwner: true,
            ownerLabel: '我',
            isSelf: true,
            media: [],
            hasMedia: false,
            forwardIds: [],
            hasForward: false,
            poke: { targetId: targetUserId || String(id), targetIsSelf: false, groupId: kind === 'group' ? String(id) : null },
            time: Date.now()
          });
          const recentLimit = Number(deps.cfg.socialV2?.context?.recentLimit) || 100;
          if (st.recentMessages.length > recentLimit) st.recentMessages.splice(0, st.recentMessages.length - recentLimit);
          st.preSleepWaitSatisfiedAt = 0;
          st.preSleepWaitObservedAt = 0;
          st.preSleepWaitAccumMs = 0;
          (0, deps.saveSocialV2State)();
          (0, deps.log)(`[reserved2] 工具拍一拍 ${key}${kind === 'group' ? ' -> ' + targetUserId : ''}`);
          (0, deps.appendActivity)(`${key} [reserved2] 工具拍一拍${kind === 'group' ? ' -> ' + targetUserId : ''}`);
          sendJson({ ok: true, key, kind, targetUserId: targetUserId || String(id) });
        } catch (error) {
          const idx = st.sendTimes.indexOf(now);
          if (idx >= 0) st.sendTimes.splice(idx, 1);
          if (st.sendTimes.length > 500) st.sendTimes = st.sendTimes.slice(-500);
          (0, deps.log)(`[reserved2] 工具拍一拍失败 ${key}:`, (error as LegacyPokeError | null)?.message ?? error);
          sendJson({ ok: false, error: `拍一拍失败：${(error as LegacyPokeError | null)?.message ?? error}` }, (error as LegacyPokeError | null)?.statusCode ?? 500);
        }
        return;

      }
    }
  };
}
