import type {NamedConsoleRoutes} from './contracts.js';
import type {ConsoleRequestHead, ConsoleJsonBody} from '../request-context.js';
import type {SocialV2State, StoredMessage} from '../../social/v2-store.js';
import type {WakeConfig, WakeTriggers, WakeSettings} from '../../wake/configuration.js';
/** 唤醒长度与时限仍由既有Number转换处理，不将外部配置视为可信数字。 */
export interface InboxWakeConfiguration {socialV2?: {wake?: WakeSettings|null};}
/** 读取、确认水位和唤醒配置写回共用的状态切片。 */
export type InboxWakeState = Pick<SocialV2State,'unread'|'recentMessages'|'lastUnreadSeq'|'lastReadThroughSeq'|'modelSeenSeqs'|'wakeConfig'|'lastActionAt'|'lastIncomingAt'|'preSleepWaitSatisfiedAt'|'preSleepWaitObservedAt'|'preSleepWaitAccumMs'|'pendingWakeTimer'>;
/** 同步匹配四个收件/配置入口，异步处理保留HTTP契约。 */
export type InboxWakeRoutes = NamedConsoleRoutes<'getSocialV2Unread'|'getSocialV2Recent'|'postSocialV2MarkRead'|'postSocialV2WakeConfig'>;
/** 复用已读与唤醒能力；状态写回仍由宿主持有，类型不代替权限校验。 */
export interface InboxWakeDependencies<Configuration extends InboxWakeConfiguration, State extends InboxWakeState> {
 readonly cfg: Configuration; readonly agentTokenOk: (key: string, token: NonNullable<ConsoleRequestHead['headers'][string]>) => boolean;
 readonly v2SessionAllowed: (key: string) => boolean; readonly v2ToolEnabled: (tool: string) => boolean; readonly getSocialV2State: (key: string) => State;
 readonly noteModelMessagesV2: (state: State, messages: readonly StoredMessage[]) => number; readonly readThroughSeqV2: (state: State) => number;
 readonly requestedReadThroughSeqV2: (state: State, body: ConsoleJsonBody, isAgent: boolean) => number | null;
 readonly isSleepingConfigV2: (config: WakeConfig) => boolean; readonly preSleepWaitBlockedV2: (state: State) => boolean;
 readonly acknowledgeMessagesV2: (state: State, throughSeq: number | null) => number; readonly ensureWakeableV2: (state: State, options: {key: string}) => void;
 readonly markReadCalledKeys: Pick<Set<string>,'add'>; readonly saveSocialV2State: () => void; readonly log: (...values: unknown[]) => void;
 readonly computeWakeSafetyV2: (config: WakeConfig) => {guaranteed: unknown};
 readonly pickWakeTriggersV2: (source: unknown, fallback: unknown) => WakeTriggers; readonly normalizeSpeakerIdsV2: (value: unknown) => string[];
 readonly wakeConfigUpdatedKeys: Pick<Set<string>,'add'>; readonly wakeConfigMissCount: Pick<Map<string,number>,'delete'>;
 readonly wakeTimers: {cancel: (key: string, slot: 'pendingWakeTimer') => void};
 readonly cancelReplyCheckV2: (key: string) => void; readonly setupSleepTimerV2: (key: string) => void;
}
/**
 * inbox-wake功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：agentTokenOk, v2SessionAllowed, v2ToolEnabled, getSocialV2State, noteModelMessagesV2, readThroughSeqV2, requestedReadThroughSeqV2, isSleepingConfigV2, preSleepWaitBlockedV2, cfg, acknowledgeMessagesV2, ensureWakeableV2, markReadCalledKeys, saveSocialV2State, log, computeWakeSafetyV2, pickWakeTriggersV2, normalizeSpeakerIdsV2, wakeConfigUpdatedKeys, wakeConfigMissCount, clearTimeout, cancelReplyCheckV2, setupSleepTimerV2。
 */
export function createInboxWakeRoutes<Configuration extends InboxWakeConfiguration, State extends InboxWakeState>(deps: InboxWakeDependencies<Configuration, State>): InboxWakeRoutes {
  return {
    getSocialV2Unread: {
      matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/unread',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const key = String(url.searchParams.get('key') ?? '').trim();
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
        if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getUnread')) { sendJson({ ok: false, error: '工具未启用：qq_get_unread_messages' }, 403); return; }
        const afterRaw = url.searchParams.get('afterSeq');
        const afterSeq = afterRaw === null ? null : Number(afterRaw);
        if (afterRaw !== null && (!/^\d+$/.test(afterRaw) || !Number.isSafeInteger(afterSeq) || (afterSeq as number) < 0)) {
          sendJson({ ok: false, error: 'afterSeq 必须是非负安全整数；从最早未读开始请传 0' }, 400);
          return;
        }
        const st = (0, deps.getSocialV2State)(key);
        // Preserve the old tail read by default; cursor paging lets a backlog
        // larger than one response be read completely, even outside recent.
        const messages = afterSeq === null ? st.unread.slice(-limit)
          : st.unread.filter((m) => Number.isSafeInteger(m.seq) && (m.seq as number) > afterSeq).slice(0, limit);
        const readThroughSeq = req.headers['x-agent-token'] ? (0, deps.noteModelMessagesV2)(st, messages) : (0, deps.readThroughSeqV2)(st);
        sendJson({ ok: true, key, unreadCount: st.unread.length, messages, readThroughSeq });
        return;

      }
    },
    getSocialV2Recent: {
      matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/recent',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const key = String(url.searchParams.get('key') ?? '').trim();
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getRecent')) { sendJson({ ok: false, error: '工具未启用：qq_get_recent_messages' }, 403); return; }
        const st = (0, deps.getSocialV2State)(key);
        const start = Math.max(0, st.recentMessages.length - offset - limit);
        const end = Math.max(0, st.recentMessages.length - offset);
        const messages = st.recentMessages.slice(start, end);
        const readThroughSeq = req.headers['x-agent-token'] ? (0, deps.noteModelMessagesV2)(st, messages) : (0, deps.readThroughSeqV2)(st);
        sendJson({ ok: true, key, messages, readThroughSeq });
        return;

      }
    },
    postSocialV2MarkRead: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/mark-read',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const key = String(body.key ?? '').trim();
        if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('markRead')) { sendJson({ ok: false, error: '工具未启用：qq_mark_read' }, 403); return; }
        const st = (0, deps.getSocialV2State)(key);
        // 注意：不带 throughSeq 的调用会清空全部未读，这是**有意保留的兼容语义**
        // （旧 preset 与「没有水位」的收尾调用；见 acknowledgeMessagesV2 的注释与
        // test-token-economy 的 legacy 用例）。当前 preset 会明确要求带上 readThroughSeq 水位。
        const throughSeq = (0, deps.requestedReadThroughSeqV2)(st, body, !!req.headers['x-agent-token']);
        // 如果当前已经是“潜水”唤醒配置，且最近还有对话/刚被唤醒，不允许用 mark_read 直接回到潜水；
        // 必须先等够沉睡前观察窗口，避免“聊两句又去潜水”。
        if ((0, deps.isSleepingConfigV2)(st.wakeConfig) && (0, deps.preSleepWaitBlockedV2)(st)) {
          const preSleepMs = Math.max(0, Number(deps.cfg.socialV2?.wake?.preSleepWaitMs) || 300000);
          const remaining = Math.max(0, preSleepMs - ((st.lastIncomingAt || 0) ? Date.now() - st.lastIncomingAt : 0));
          const remainMin = Math.ceil(remaining / 60000);
          sendJson({
            ok: false,
            error: `还不能通过 qq_mark_read 直接回到潜水：还需等待约 ${remainMin} 分钟无新消息，或调用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成一次沉睡前观察。如果等待期间有人发新消息，请先查看返回的 newMessages；判断不需要你参与就可以直接收尾沉睡，若你参与了则需下次再等观察窗口。`,
            preSleepWaitMs: preSleepMs,
            preSleepWaitRemainingMs: remaining
          }, 400);
          return;
        }
        const markedCount = (0, deps.acknowledgeMessagesV2)(st, throughSeq);
        st.lastActionAt = Date.now();
        st.wakeConfig.noActionCount = 0;
        // 防止“有限潜水被 timeout 唤醒后 sleepUntil 被清空、又 mark_read 收尾”导致无定时器无触发条件的静默态。
        if (!st.wakeConfig.infinite && !st.wakeConfig.sleepUntil) {
          st.wakeConfig.infinite = true;
        }
        (0, deps.ensureWakeableV2)(st, { key });
        st.wakeConfig.confirmedAt = Date.now();
        st.wakeConfig.confirmedBy = 'mark_read';
        deps.markReadCalledKeys.add(key);
        (0, deps.saveSocialV2State)();
        (0, deps.log)(`[reserved2] 控制台/工具标记 ${key} 未读已读：${markedCount} 条，已确认下一次唤醒配置`);
        sendJson({ ok: true, key, markedCount, unreadCount: st.unread.length, readThroughSeq: (0, deps.readThroughSeqV2)(st), wakeGuaranteed: (0, deps.computeWakeSafetyV2)(st.wakeConfig).guaranteed, wakeSafety: (0, deps.computeWakeSafetyV2)(st.wakeConfig), wakeConfig: st.wakeConfig });
        return;

      }
    },
    postSocialV2WakeConfig: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/wake-config',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const key = String(body.key ?? '').trim();
        if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('setWakeConfig')) { sendJson({ ok: false, error: '工具未启用：qq_set_wake_config' }, 403); return; }
        const st = (0, deps.getSocialV2State)(key);
        const throughSeq = (0, deps.requestedReadThroughSeqV2)(st, body, !!req.headers['x-agent-token']);
        // Preserve the deployed behavior: with markRead disabled, update wake configuration only.
        const acknowledgeOnClose = throughSeq !== null && (0, deps.v2ToolEnabled)('markRead');
        const input = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config as Record<string,unknown> : {};
        const current = st.wakeConfig as WakeConfig & {triggers: WakeTriggers};
        const inputTriggers = input.triggers && typeof input.triggers === 'object' && !Array.isArray(input.triggers) ? input.triggers as Record<string,unknown> : {};
        const normalizeTriggerBool = (name: string, fallback: boolean): boolean => {
          if (name in inputTriggers) return inputTriggers[name] === true;
          return fallback;
        };
        const rawKeywords = inputTriggers.keywords;
        const nextKeywords = rawKeywords !== undefined
          ? (Array.isArray(rawKeywords)
            ? rawKeywords.map((k) => String(k ?? '').trim()).filter(Boolean).slice(0, 50).map((k) => k.slice(0, 100))
            : [])
          : (Array.isArray(current.triggers.keywords) ? current.triggers.keywords.slice(0, 50).map((k) => String(k).slice(0, 100)) : []);
        const next = {
          ...current,
          mode: input.mode === 'active' ? 'active' : input.mode === 'diving' ? 'diving' : current.mode,
          infinite: typeof input.infinite === 'boolean' ? input.infinite : current.infinite,
          sleepUntil: current.sleepUntil,
          triggers: {
            // 只带已知字段（见 WAKE_TRIGGER_KEYS 的说明）；未知键一律丢弃。
            ...(0, deps.pickWakeTriggersV2)(inputTriggers, current.triggers),
            atMention: normalizeTriggerBool('atMention', current.triggers.atMention === true),
            nameMention: normalizeTriggerBool('nameMention', current.triggers.nameMention === true),
            question: normalizeTriggerBool('question', current.triggers.question === true),
            anyMessage: normalizeTriggerBool('anyMessage', current.triggers.anyMessage === true),
            poke: normalizeTriggerBool('poke', current.triggers.poke === true),
            keywords: nextKeywords
          },
          batchWindowMs: Number.isFinite(Number(input.batchWindowMs)) && Number(input.batchWindowMs) >= 1000
            ? Math.min(3600000, Math.round(Number(input.batchWindowMs)))
            : current.batchWindowMs
        };
        // 从 active 切回 diving 时，若 AI 没显式保留 anyMessage，则清除，避免“潜水=每条都唤醒”的语义矛盾。
        if (next.mode === 'diving' && !('anyMessage' in inputTriggers)) {
          next.triggers.anyMessage = false;
        }
        if (next.mode === 'active') {
          next.infinite = true;
          next.sleepUntil = null;
          next.triggers.anyMessage = true;
        }
        if (typeof input.infinite === 'boolean' && next.mode !== 'active') next.infinite = input.infinite;
        if (next.infinite) {
          next.sleepUntil = null;
        } else if (input.sleepUntil) {
          const d = new Date(String(input.sleepUntil));
          if (!Number.isNaN(d.getTime())) next.sleepUntil = d.toISOString();
        } else if (Number.isFinite(Number(input.sleepMs))) {
          let ms = Math.max(0, Math.round(Number(input.sleepMs)));
          const minMs = Math.max(0, Number(deps.cfg.socialV2?.wake?.sleepMinMs) || 0);
          const maxMs = Number(deps.cfg.socialV2?.wake?.sleepMaxMs) || 0;
          if (ms < minMs) ms = minMs;
          if (maxMs > 0 && ms > maxMs) ms = maxMs;
          next.sleepUntil = new Date(Date.now() + ms).toISOString();
        } else if (!next.sleepUntil && !next.infinite) {
          // 既没有无限也没有时间：使用推荐默认有限时长
          const recMin = Number(deps.cfg.socialV2?.wake?.recommendedSleepMinMs) || 300000;
          const recMax = Number(deps.cfg.socialV2?.wake?.recommendedSleepMaxMs) || 7200000;
          const ms = recMin + Math.random() * Math.max(0, recMax - recMin);
          next.sleepUntil = new Date(Date.now() + Math.round(ms)).toISOString();
        }
        // 对有限 sleepUntil 也做 min/max clamp，防止绕过 sleepMaxMs
        if (!next.infinite && next.sleepUntil) {
          const maxMs = Number(deps.cfg.socialV2?.wake?.sleepMaxMs) || 0;
          const minMs = Math.max(0, Number(deps.cfg.socialV2?.wake?.sleepMinMs) || 0);
          let until = Date.parse(next.sleepUntil);
          if (Number.isFinite(until)) {
            if (minMs > 0 && until < Date.now() + minMs) until = Date.now() + minMs;
            if (maxMs > 0 && until > Date.now() + maxMs) until = Date.now() + maxMs;
            next.sleepUntil = new Date(until).toISOString();
          }
        }
        // 归一化概率
        if (next.triggers.probability !== undefined) {
          next.triggers.probability = Math.min(1, Math.max(0, Number(next.triggers.probability) || 0));
        }
        // 归一化拍一拍触发（只接受布尔，防脏字符串被当成 true）
        if (input.triggers && typeof input.triggers === 'object' && 'poke' in input.triggers) {
          next.triggers.poke = input.triggers.poke === true;
        }
        // 归一化“指定成员”触发：只保留正整数 QQ 号，去重，限制数量；
        // null/undefined/非法值统一清空，避免“null”被当成有效唤醒条件绕过防永眠。
        next.triggers.speakerIds = (0, deps.normalizeSpeakerIdsV2)(next.triggers.speakerIds);
        // 私聊不适用“指定成员发言醒来”：清除以免误导/脏数据（私聊仍按原有逻辑每次消息都唤醒）。
        if (key.startsWith('private:')) {
          next.triggers.speakerIds = [];
        }
        // 防止 AI 永眠：无限期潜水必须至少有一个可触发条件
        if (next.infinite) {
          const tr = next.triggers ?? {};
          const hasTrigger = tr.atMention || tr.nameMention || tr.poke || (Array.isArray(tr.keywords) && tr.keywords.length > 0) || tr.question || tr.anyMessage || (Number(tr.probability) > 0) || (Array.isArray(tr.speakerIds) && tr.speakerIds.length > 0);
          if (!hasTrigger) {
            sendJson({ ok: false, error: '无限期潜水必须至少保留一个唤醒条件（@/名字/拍一拍/关键词/提问/anyMessage/概率>0），否则 AI 可能永眠' }, 400);
            return;
          }
        }
        // 沉睡前强制观察窗口：除非对方明确结束、或已经安静/等待足够时间，否则不允许 AI 聊两句就设置潜水。
        if ((0, deps.isSleepingConfigV2)(next) && (0, deps.preSleepWaitBlockedV2)(st)) {
          const preSleepMs = Math.max(0, Number(deps.cfg.socialV2?.wake?.preSleepWaitMs) || 300000);
          const remaining = Math.max(0, preSleepMs - ((st.lastIncomingAt || 0) ? Date.now() - st.lastIncomingAt : 0));
          const remainMin = Math.ceil(remaining / 60000);
          sendJson({
            ok: false,
            error: `还不能立刻设置潜水/下一次唤醒：还需等待约 ${remainMin} 分钟无新消息，或调用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成一次沉睡前观察。如果等待期间有人发新消息，请先查看返回的 newMessages；判断不需要你参与就可以直接设置并沉睡，若你参与了则需下次再等观察窗口。`,
            preSleepWaitMs: preSleepMs,
            preSleepWaitRemainingMs: remaining
          }, 400);
          return;
        }
        const markedCount = acknowledgeOnClose ? (0, deps.acknowledgeMessagesV2)(st, throughSeq) : 0;
        st.wakeConfig = next;
        st.wakeConfig.lastWakeAt = st.wakeConfig.lastWakeAt || 0;
        st.wakeConfig.wakeCount = st.wakeConfig.wakeCount || 0;
        st.wakeConfig.noActionCount = 0;
        st.wakeConfig.confirmedAt = Date.now();
        st.wakeConfig.confirmedBy = 'set_wake_config';
        st.lastActionAt = Date.now();
        // 已成功设置下一次唤醒：本轮沉睡前观察标记作废，下次想再睡需重新走 5 分钟观察。
        st.preSleepWaitSatisfiedAt = 0;
        st.preSleepWaitObservedAt = 0;
        st.preSleepWaitAccumMs = 0;
        (0, deps.saveSocialV2State)();
        deps.wakeConfigUpdatedKeys.add(key);
        deps.wakeConfigMissCount.delete(key);
        if (st.pendingWakeTimer) {
          deps.wakeTimers.cancel(key,'pendingWakeTimer');
          st.pendingWakeTimer = null;
        }
        (0, deps.cancelReplyCheckV2)(key); // AI 已主动设置新的唤醒配置，取消回复检查
        (0, deps.setupSleepTimerV2)(key);
        (0, deps.log)(`[reserved2] 更新唤醒配置 ${key}: mode=${next.mode} infinite=${next.infinite} sleepUntil=${next.sleepUntil ?? 'null'}`);
        sendJson({ ok: true, key, markedCount, unreadCount: st.unread.length, readThroughSeq: (0, deps.readThroughSeqV2)(st), wakeConfig: next, wakeSafety: (0, deps.computeWakeSafetyV2)(next) });
        return;

      }
    }
  };
}
