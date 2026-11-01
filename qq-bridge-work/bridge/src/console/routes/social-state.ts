import type {NamedConsoleRoutes} from './contracts.js';
import type {ConsoleRequestHead} from '../request-context.js';
import type {SocialV2State} from '../../social/v2-store.js';
import type {WakeConfig} from '../../wake/configuration.js';
import type {SessionRegistry, SessionCreation} from '../../sessions/creation.js';
import type {WakeDispatchResult} from '../../wake/dispatch.js';
/** 只约束路由读取的配置切片；展示值和注入上限保持原始值。 */
export interface SocialStateConfiguration {
 socialV2?: {tools?: Record<string,unknown>; provideRecommendations?: unknown; wake?: unknown; send?: unknown; wait?: unknown; proactive?: unknown;
 sticker?: {enabled?: unknown; includeInPrompt?: unknown; promptMaxStickers?: unknown}; voice?: {enabled?: unknown}};
 slang?: {enabled?: unknown; injectMax?: unknown};
}
/** 重置与手动唤醒需要的可变兼容视图；不额外持有计时器所有权。 */
export type SocialRouteState = Pick<SocialV2State,'wakeConfig'|'unread'|'recentMessages'|'lastWakeReason'|'lastAiReplyAt'|'pendingWakeTimer'|'bootstrapSent'>;
/** 已读接口不在本模块暴露；每个入口仍由宿主统一鉴权。 */
export type SocialStateRoutes = NamedConsoleRoutes<'postSocialV2Reset'|'getSocialV2State'|'getSocialV2Prompt'|'getSocialV2States'|'postSocialV2Wake'>;
interface DeletableRegistry {delete: (key: string) => boolean;}
interface ClearableRegistry {clear: () => void;}
/** 实时依赖；重置代次可写，清理操作保持同步，唤醒异步错误按原日志处理。 */
export interface SocialStateDependencies<Configuration extends SocialStateConfiguration, State extends SocialRouteState, Slang, Sticker> {
 sessionEpoch: number; readonly sessionCreation: Pick<SessionCreation,'clear'>;
 readonly clearAllSocialV2Timers: () => void; readonly drainAllPromptQueues: (reason: string) => void;
 readonly socialV2: {paused: boolean; conversations: Pick<Map<string,State>,'keys'|'delete'> & Iterable<[string,State]>};
 readonly state: SessionRegistry; readonly stopRetiredSessionWork: (sessionId: string, key: string) => void;
 readonly usageObserver: {forget: (sessionId: string) => void}; readonly sessionModelManager: {forget: (sessionId: string) => void};
 readonly reverse: DeletableRegistry; readonly collectors: DeletableRegistry; readonly v2TurnStartAt: DeletableRegistry;
 readonly turnLeaseNoted: DeletableRegistry; readonly toolCallNames: DeletableRegistry; readonly pendingSendToolCalls: DeletableRegistry;
 readonly sendToolSucceededSessions: DeletableRegistry; readonly api: {events: {forget?: (sessionId: string) => void}};
 readonly forgetAgentToken: (key: string) => void; readonly seenForwardIds: DeletableRegistry; readonly saveState: () => void;
 readonly pendingWakeKeys: ClearableRegistry; readonly clearAllPendingWakeLeases: () => void; readonly wakeConfigUpdatedKeys: ClearableRegistry;
 readonly markReadCalledKeys: ClearableRegistry; readonly wakeConfigMissCount: ClearableRegistry;
 readonly atomicWriteJson: (file: string, data: {conversations: Record<string,never>}) => void; readonly SOCIAL_V2_FILE: string;
 readonly log: (...values: unknown[]) => void; readonly agentTokenOk: (key: string, token: NonNullable<ConsoleRequestHead['headers'][string]>) => boolean;
 readonly v2SessionAllowed: (key: string) => boolean; readonly v2ToolEnabled: (tool: string) => boolean; readonly getSocialV2State: (key: string) => State;
 readonly computeWakeSafetyV2: (config: WakeConfig) => unknown; readonly nativeObservation: {snapshot: (key: string) => unknown} | null | undefined;
 readonly cfg: Configuration; readonly syncStickerLibrary: (force: boolean) => Promise<unknown>; readonly readRoleState: () => {role?: unknown};
 readonly stickerEnabled: () => boolean; readonly selfDisplayName: unknown; readonly selfUserId: unknown; readonly selfIdentityTextV2: () => string;
 readonly currentMode: string; readonly currentRoleHintV2: () => string; readonly currentRoleHint: () => string;
 readonly replyTimingV2: (state: State) => {purpose: 'reply'; quietMs: number; remainingQuietMs: number};
 readonly formatMemoryV2: (state: State) => string; readonly formatParticipationV2: (state: State) => string; readonly confirmedSlangListV2: () => unknown;
 readonly slangEntries: Slang[]; readonly buildSlangContext: (entries: Slang[], max: unknown) => string;
 readonly stickerEntries: Sticker[]; readonly buildStickerContext: (entries: Sticker[], max: unknown) => string; readonly buildStickerStrategyHint: () => string;
 readonly voiceLibrary: () => {name: unknown}[]; readonly voiceCfg: () => {maxSeconds?: unknown};
 readonly modeAllowed: (key: string, kind: string, id: number, cfg: Configuration, mode: string) => boolean;
 readonly wakeTimers: {cancel: (key: string, slot: 'pendingWakeTimer') => void}; readonly saveSocialV2State: () => void;
 readonly sendWakePromptV2: (key: string, reason: string) => Promise<WakeDispatchResult>;
}
/**
 * social-state功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：sessionEpoch, sessionCreation, clearAllSocialV2Timers, drainAllPromptQueues, socialV2, state, stopRetiredSessionWork, usageObserver, sessionModelManager, reverse, collectors, v2TurnStartAt, turnLeaseNoted, toolCallNames, pendingSendToolCalls, sendToolSucceededSessions, api, forgetAgentToken, seenForwardIds, saveState, pendingWakeKeys, clearAllPendingWakeLeases, wakeConfigUpdatedKeys, markReadCalledKeys, wakeConfigMissCount, atomicWriteJson, SOCIAL_V2_FILE, log, agentTokenOk, v2SessionAllowed, v2ToolEnabled, getSocialV2State, computeWakeSafetyV2, nativeObservation, cfg, syncStickerLibrary, readRoleState, stickerEnabled, selfDisplayName, selfUserId, selfIdentityTextV2, currentMode, currentRoleHintV2, currentRoleHint, replyTimingV2, formatMemoryV2, formatParticipationV2, confirmedSlangListV2, buildSlangContext, slangEntries, stickerEntries, buildStickerContext, buildStickerStrategyHint, voiceLibrary, voiceCfg, modeAllowed, clearTimeout, saveSocialV2State, sendWakePromptV2。
 */
export function createSocialStateRoutes<Configuration extends SocialStateConfiguration, State extends SocialRouteState, Slang, Sticker>(deps: SocialStateDependencies<Configuration, State, Slang, Sticker>): SocialStateRoutes {
  return {
    postSocialV2Reset: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/reset',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        deps.sessionEpoch++;
        deps.sessionCreation.clear();
        (0, deps.clearAllSocialV2Timers)();
        (0, deps.drainAllPromptQueues)('二代状态已重置');
        for (const key of [...deps.socialV2.conversations.keys()]) {
          const sid = deps.state.sessions[key];
          if (sid) {
            delete deps.state.sessions[key];
            // 与 retireSession / session-reset / workspace-reset 一致：先让 DSH 停下这个会话的活。
            // 少了这一步，DSH 会继续跑完在途/排队的 turn（token 照烧、副作用照做），
            // 而桥接这边已经把所有映射删掉 —— 输出被静默丢弃，agentToken 也已轮换（它的 MCP 发送全部 403）。
            (0, deps.stopRetiredSessionWork)(sid, key);
            deps.usageObserver.forget(sid);
            deps.sessionModelManager.forget(sid);
            deps.reverse.delete(sid);
            deps.collectors.delete(sid);
            deps.v2TurnStartAt.delete(sid);
            deps.turnLeaseNoted.delete(sid);
            deps.toolCallNames.delete(sid);
            deps.pendingSendToolCalls.delete(sid);
            deps.sendToolSucceededSessions.delete(sid);
            // 订阅也要退掉，否则它会在每次重连时被重新 follow 并重发整份快照。
            deps.api.events.forget?.(sid);
          }
          delete deps.state.sessionPolicies[key];
          (0, deps.forgetAgentToken)(key);
          deps.socialV2.conversations.delete(key);
          deps.seenForwardIds.delete(key);
        }
        (0, deps.saveState)();
        deps.pendingWakeKeys.clear();
        (0, deps.clearAllPendingWakeLeases)();
        deps.wakeConfigUpdatedKeys.clear();
        deps.markReadCalledKeys.clear();
        deps.wakeConfigMissCount.clear();
        deps.socialV2.paused = false;
        try { (0, deps.atomicWriteJson)(deps.SOCIAL_V2_FILE, { conversations: {} }); } catch (error) { (0, deps.log)('重置二代状态：写空状态文件失败:', (error as {message?: unknown} | null)?.message ?? error); }
        (0, deps.log)('控制台：二代 AI 状态已重置（会话、定时器、唤醒配置已清空，工具日志保留）');
        sendJson({ ok: true });
        return;

      }
    },
    getSocialV2State: {
      matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/state',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const key = String(url.searchParams.get('key') ?? '').trim();
        if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('socialState')) { sendJson({ ok: false, error: '工具未启用：qq_social_state' }, 403); return; }
        const st = (0, deps.getSocialV2State)(key);
        sendJson({
          ok: true,
          key,
          wakeConfig: st.wakeConfig,
          wakeSafety: (0, deps.computeWakeSafetyV2)(st.wakeConfig),
          unreadCount: st.unread.length,
          recentCount: st.recentMessages.length,
          lastWakeReason: st.lastWakeReason,
          lastAiReplyAt: st.lastAiReplyAt,
          backgroundObservation: deps.nativeObservation?.snapshot(key) ?? { active: false }
        });
        return;

      }
    },
    getSocialV2Prompt: {
      matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/prompt',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const key = String(url.searchParams.get('key') ?? '').trim();
        if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getPrompt')) { sendJson({ ok: false, error: '工具未启用：qq_get_prompt' }, 403); return; }
        const st = (0, deps.getSocialV2State)(key);
        // 让 prompt 里的表情摘要尽量新鲜：按 TTL 同步一次 QQ 收藏表情（失败不阻塞）。
        if (deps.cfg.socialV2?.sticker?.enabled !== false) {
          try { await (0, deps.syncStickerLibrary)(false); } catch { }
        }
        const roleState = (0, deps.readRoleState)();
        const toolMap = {
          getPrompt: 'qq_get_prompt',
          getUnread: 'qq_get_unread_messages',
          getRecent: 'qq_get_recent_messages',
          socialState: 'qq_social_state',
          sendGroup: 'qq_send_group_message',
          sendPrivate: 'qq_send_private_message',
          reply: 'qq_reply',
          sendBurst: 'qq_send_burst',
          sendMessage: 'qq_send_message',
          waitMessages: 'qq_wait_for_messages',
          feedback: 'qq_report_feedback',
          getMyRecent: 'qq_get_my_recent_messages',
          getMessageDetail: 'qq_get_message_detail',
          getActiveMembers: 'qq_get_active_members',
          setWakeConfig: 'qq_set_wake_config',
          markRead: 'qq_mark_read',
          memory: 'qq_memory_append / qq_memory_query / qq_memory_remove / qq_memory_clear',
          slangQuery: 'qq_slang_query',
          slangSubmit: 'qq_slang_submit',
          getImages: 'qq_get_message_images',
          getForwardMsg: 'qq_get_forward_msg',
          sendPoke: 'qq_send_poke',
          listStickers: 'qq_list_stickers',
          getStickerImage: 'qq_get_sticker_image',
          sendSticker: 'qq_send_sticker',
          setStickerRemark: 'qq_set_sticker_remark',
          stickerNote: 'qq_sticker_note',
          collectSticker: 'qq_collect_sticker',
          getSelfImage: 'qq_get_self_image',
          sendVoice: 'qq_send_voice / qq_list_voices'
        };
        const tools = deps.cfg.socialV2?.tools ?? {};
        const stickerToolFlags = new Set(['listStickers', 'getStickerImage', 'sendSticker', 'setStickerRemark', 'stickerNote', 'collectSticker']);
        const enabledTools = [];
        for (const [flag, name] of Object.entries(toolMap)) {
          if (tools[flag] !== false && !(stickerToolFlags.has(flag) && !(0, deps.stickerEnabled)())) enabledTools.push(name);
        }
        sendJson({
          ok: true,
          key,
          time: new Date().toISOString(),
          // 机器人自己的身份：agent 需要它才能把「@樰」对到自己身上（issue #29）。
          self: {
            nickname: deps.selfDisplayName || null,
            userId: deps.selfUserId || null,
            line: (0, deps.selfIdentityTextV2)().trim() || null
          },
          role: { name: roleState.role ?? null, hint: deps.currentMode === 'reserved2' ? (0, deps.currentRoleHintV2)() : (0, deps.currentRoleHint)() },
          recommended: deps.cfg.socialV2?.provideRecommendations === false ? null : {
            wake: deps.cfg.socialV2?.wake ?? {},
            send: deps.cfg.socialV2?.send ?? {},
            wait: deps.cfg.socialV2?.wait ?? {},
            proactive: deps.cfg.socialV2?.proactive ?? {}
          },
          enabledTools,
          replyTiming: (0, deps.replyTimingV2)(st),
          unreadCount: st.unread.length,
          recentCount: st.recentMessages.length,
          currentWakeConfig: st.wakeConfig,
          wakeSafety: (0, deps.computeWakeSafetyV2)(st.wakeConfig),
          memory: (0, deps.formatMemoryV2)(st),
          participation: (0, deps.formatParticipationV2)(st),
          slang: {
            enabled: deps.cfg.slang?.enabled !== false,
            entries: (0, deps.confirmedSlangListV2)(),
            block: (0, deps.buildSlangContext)(deps.slangEntries, deps.cfg.slang?.injectMax ?? 8)
          },
          stickers: {
            enabled: deps.cfg.socialV2?.sticker?.enabled !== false,
            total: deps.stickerEntries.length,
            context: deps.cfg.socialV2?.sticker?.includeInPrompt !== false ? (0, deps.buildStickerContext)(deps.stickerEntries, deps.cfg.socialV2?.sticker?.promptMaxStickers ?? 8) : '',
            strategy: deps.cfg.socialV2?.sticker?.includeInPrompt !== false ? (0, deps.buildStickerStrategyHint)() : ''
          },
          // 语音库摘要：让 AI 一开始就知道有哪些语音可发（真发之前用 qq_list_voices 看详情）。
          voices: deps.cfg.socialV2?.voice?.enabled === false ? { enabled: false } : {
            enabled: true,
            total: (0, deps.voiceLibrary)().length,
            names: (0, deps.voiceLibrary)().slice(0, 12).map((v) => v.name),
            maxSeconds: (0, deps.voiceCfg)().maxSeconds,
            hint: '可用 qq_list_voices 查看语音库，再用 qq_send_voice 把其中一个当语音发出去'
          }
        });
        return;

      }
    },
    getSocialV2States: {
      matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/states',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const list = [];
        for (const [key, st] of deps.socialV2.conversations) {
          list.push({
            key,
            wakeConfig: st.wakeConfig,
            unreadCount: st.unread.length,
            recentCount: st.recentMessages.length,
            lastWakeReason: st.lastWakeReason,
            lastAiReplyAt: st.lastAiReplyAt,
            noActionCount: st.wakeConfig.noActionCount || 0
          });
        }
        sendJson({ ok: true, conversations: list });
        return;

      }
    },
    postSocialV2Wake: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/wake',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const key = String(body.key ?? '').trim();
        const reason = String(body.reason ?? 'admin').trim() || 'admin';
        if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (deps.currentMode !== 'reserved2') { sendJson({ ok: false, error: '该接口仅 reserved2 模式可用' }, 403); return; }
        const keyMatch = /^(group|private):(\d+)$/.exec(key);
        if (!keyMatch) { sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400); return; }
        const kind = keyMatch[1];
        const id = Number(keyMatch[2]);
        if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
          sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
          return;
        }
        const st = (0, deps.getSocialV2State)(key);
        if (st.pendingWakeTimer) {
          deps.wakeTimers.cancel(key,'pendingWakeTimer');
          st.pendingWakeTimer = null;
        }
        // 第一次唤醒必须走 bootstrap：那条 prompt 里带着「二代协议说明 + 操作者为这个会话
        // 预写的初始提示词（群环境/氛围）」。若用手动唤醒的 admin 文案顶掉它，这个会话就
        // 永远拿不到引导 —— 而 bootstrapSent 一旦置真，后续再也不会补发。
        const firstWake = !st.bootstrapSent;
        if (firstWake) st.bootstrapSent = true;
        const effectiveReason = firstWake ? 'bootstrap' : reason;
        (0, deps.saveSocialV2State)();
        // 和其它唤醒入口保持一致：sendWakePromptV2 是异步的，这里不 await（不能让 HTTP 回复
        // 等一个可能卡几十秒的模型回合），但必须挂 catch。裸调用一旦 reject 就是
        // unhandledRejection：Node 会打警告甚至按配置退出进程，而 HTTP 那边已经回了 {ok:true}，
        // 表面上"唤醒成功"，实际上谁也不知道它失败了。
        void (0, deps.sendWakePromptV2)(key, effectiveReason).catch((error: unknown) => (0, deps.log)(`[reserved2] 手动唤醒异常 ${key}:`, (error as {message?: unknown} | null)?.message ?? error));
        (0, deps.log)(`控制台：手动唤醒 ${key}（${effectiveReason}${firstWake && reason !== effectiveReason ? `，首次唤醒，请求原因 ${reason} 已升级为 bootstrap` : ''}）`);
        sendJson({ ok: true, key, reason: effectiveReason, requestedReason: reason, firstWake });
        return;

      }
    }
  };
}
