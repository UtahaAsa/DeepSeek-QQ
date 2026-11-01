import type {NamedConsoleRoutes} from './contracts.js';
import type {ConsoleRequestHead} from '../request-context.js';
import type {SocialV2State, StoredMedia} from '../../social/v2-store.js';
import type {HistoryReplyInfo} from './history.js';
import type {MediaReference} from '../../media/contracts.js';
/** 限频/长度配置保留原始值，仍沿用既有Number转换。 */
export interface MessageToolsConfiguration {socialV2?: {send?: {maxMessageChars?: unknown; maxSendPerMinute?: unknown; maxSendPerHour?: unknown}|null};}
/** 发送预占、成功记账及失败回滚共用的最小状态切片。 */
export type MessageToolsState = Pick<SocialV2State,'sendTimes'|'lastAiReplyAt'|'lastActionAt'|'wakeConfig'>;
/** 仅暴露消息工具入口，匹配同步、处理异步。 */
export type MessageToolsRoutes = NamedConsoleRoutes<'postSocialV2CheckSend'|'getImagesMessage'|'postSendGroup'>;
/** 实时依赖和可等待发送；引用/艾特原始值在下游按原规则归一化。 */
export interface MessageToolsDependencies<Configuration extends MessageToolsConfiguration, Segment, State extends MessageToolsState = MessageToolsState> {
 readonly cfg: Configuration; readonly currentMode: string; readonly SENSITIVE_RE: Pick<RegExp,'test'>;
 readonly socialV2: {paused: boolean}; readonly allowed: (kind: string, id: number, cfg: Configuration) => boolean;
 readonly modeAllowed: (key: string, kind: string, id: number, cfg: Configuration, mode: string) => boolean;
 readonly escapeCqText: (text: string) => string; readonly redactKnownTokensOnly: (text: string) => string; readonly text: (text: string) => Segment;
 readonly bot: {sendPrivateMessage: (id: number, message: Segment) => Promise<unknown>; sendGroupMessage: (id: number, message: Segment) => Promise<unknown>};
 readonly log: (...values: unknown[]) => void;
 readonly agentTokenOk: (key: string, token: NonNullable<ConsoleRequestHead['headers'][string]>) => boolean;
 readonly v2SessionAllowed: (key: string) => boolean; readonly v2ToolEnabled: (tool: string) => boolean;
 readonly findMessageMedia: (key: string, messageId: string) => MediaReference[]; readonly fetchMediaData: (media: unknown[]) => Promise<unknown>;
 readonly unquoteJsonString: (text: string) => string; readonly shouldBlockSilentReply: (key: string) => boolean;
 readonly getSocialV2State: (key: string) => State;
 readonly resolveReplyTargetV2: (state: State, kind: string, id: number, reference: string) => Promise<{info: HistoryReplyInfo; messageId: string} | null>;
 readonly sendMessagesV2: (key: string, messages: string[], gaps: number[], replyToMessageId: unknown, atUserId: unknown) => Promise<string[]>;
 readonly recordSentMessagesV2: (key: string, messages: string[]) => void; readonly saveSocialV2State: () => void;
 readonly appendActivity: (message: string) => void; readonly scheduleReplyCheckV2: (key: string) => void;
}
/** 只描述旧失败记账路径读取的属性，不校验任意抛出值。 */
interface LegacySendError {message?: unknown; sent?: string[];}
/**
 * message-tools功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：SENSITIVE_RE, allowed, cfg, modeAllowed, currentMode, escapeCqText, redactKnownTokensOnly, bot, text, log, agentTokenOk, v2SessionAllowed, v2ToolEnabled, findMessageMedia, fetchMediaData, unquoteJsonString, socialV2, shouldBlockSilentReply, getSocialV2State, resolveReplyTargetV2, sendMessagesV2, recordSentMessagesV2, saveSocialV2State, appendActivity, scheduleReplyCheckV2。
 */
export function createMessageToolsRoutes<Configuration extends MessageToolsConfiguration, Segment, State extends MessageToolsState>(deps: MessageToolsDependencies<Configuration, Segment, State>): MessageToolsRoutes {
  return {
    postSocialV2CheckSend: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/check-send',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const key = String(body.key ?? '').trim();
        const tool = String(body.tool ?? '').trim();
        const token = String(body.token ?? '').trim();
        if (!key || !tool || !token) {
          sendJson({ ok: false, error: 'key/tool/token 不能为空' }, 400);
          return;
        }
        if (!(0, deps.agentTokenOk)(key, token)) {
          sendJson({ ok: false, error: 'agent token 无效' }, 403);
          return;
        }
        if (!(0, deps.v2SessionAllowed)(key)) {
          sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
          return;
        }
        const flagMap: Record<string,string> = { sendGroup: 'sendGroup', sendPrivate: 'sendPrivate', reply: 'reply' };
        const flag = flagMap[tool];
        if (!flag) {
          sendJson({ ok: false, error: 'tool 必须是 sendGroup/sendPrivate/reply' }, 400);
          return;
        }
        if (!(0, deps.v2ToolEnabled)(flag)) {
          sendJson({ ok: false, error: `工具未启用：qq_${tool === 'sendGroup' ? 'send_group_message' : tool === 'sendPrivate' ? 'send_private_message' : 'reply'}` }, 403);
          return;
        }
        sendJson({ ok: true, key, tool });
        return;

      }
    },
    getImagesMessage: {
      matches: (req, url) => req.method === 'GET' && url.pathname === '/api/images/message',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const key = String(url.searchParams.get('key') ?? '').trim();
        const messageId = String(url.searchParams.get('messageId') ?? '').trim();
        const agentToken = String(req.headers['x-agent-token'] ?? '').trim();
        const keyMatch = /^(group|private):(\d+)$/.exec(key);
        if (!keyMatch) { sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400); return; }
        if (!messageId) { sendJson({ ok: false, error: 'messageId 不能为空' }, 400); return; }
        if (deps.currentMode === 'reserved2' && !agentToken) {
          sendJson({ ok: false, error: 'reserved2 模式读取图片必须携带 agent token' }, 403);
          return;
        }
        if (deps.currentMode === 'chat' || deps.currentMode === 'reserved') {
          sendJson({ ok: false, error: '一代 chat/reserved 模式图片已自动内联，按需图片工具仅 reserved2 模式可用' }, 403);
          return;
        }
        if (agentToken && !(0, deps.agentTokenOk)(key, agentToken)) {
          sendJson({ ok: false, error: 'agent token 无效' }, 403);
          return;
        }
        const kind = keyMatch[1];
        const id = Number(keyMatch[2]);
        if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
          sendJson({ ok: false, error: '当前模式不允许读取该会话' }, 403);
          return;
        }
        if (agentToken && !(0, deps.v2ToolEnabled)('getImages')) {
          sendJson({ ok: false, error: '工具未启用：qq_get_message_images' }, 403);
          return;
        }
        if (!agentToken && deps.currentMode === 'closed-agent' && !(0, deps.v2ToolEnabled)('getImages')) {
          sendJson({ ok: false, error: '工具未启用：qq_get_message_images' }, 403);
          return;
        }
        const media = (0, deps.findMessageMedia)(key, messageId);
        if (!media.length) {
          sendJson({ ok: true, messageId, media: [], images: [], note: '该消息没有可读取的图片/表情元数据' });
          return;
        }
        try {
          const images = await (0, deps.fetchMediaData)(media);
          sendJson({ ok: true, messageId, media, images });
        } catch (error) {
          (0, deps.log)(`图片查询失败 ${key} ${messageId}: ${(error as LegacySendError | null)?.message ?? error}`);
          sendJson({ ok: false, error: `图片查询失败：${(error as LegacySendError | null)?.message ?? error}` }, 500);
        }
        return;

      }
    },
    postSendGroup: {
      matches: (req, url) => req.method === 'POST' && (url.pathname === '/api/send/group' || url.pathname === '/api/send/private' || url.pathname === '/api/send/reply'),
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const token = String(body.token ?? '').trim();
        const isPrivate = url.pathname === '/api/send/private';
        const isReply = url.pathname === '/api/send/reply';
        const targetId = isPrivate ? String(body.userId ?? '').trim() : String(body.groupId ?? '').trim();
        const message = (0, deps.unquoteJsonString)(String(body.message ?? '').trim());
        // 引用 id 与端点无关：/api/send/reply 与另两个端点都允许带（是否真的引用由下游按 id 判断）。
        // 旧写法 `isReply ? body.replyToMessageId : body.replyToMessageId` 两个分支一模一样，
        // 保留 isReply 变量只是为了下面的端点语义判断，别再让人以为这里有过分支逻辑。
        const replyToMessageId = body.replyToMessageId;
        const atUserId = body.atUserId ?? null;
        const key = isPrivate ? `private:${targetId}` : `group:${targetId}`;
        // 安全边界：发送工具只允许在 closed-agent（管理员私聊）或 reserved2（二代 AI 带会话令牌）下使用；
        // chat/reserved 的自动转发已覆盖正常回复，MCP 发送工具不应成为 prompt injection 的越权出口。
        if (deps.currentMode === 'chat' || deps.currentMode === 'reserved') {
          sendJson({ ok: false, error: '发送工具仅限 closed-agent / reserved2 模式使用' }, 403);
          return;
        }
        if (deps.socialV2.paused && token) {
          sendJson({ ok: false, error: 'AI 已暂停，当前不允许执行发送工具' }, 403);
          return;
        }
        if (!targetId || !message) { sendJson({ ok: false, error: '目标 id 和 message 不能为空' }, 400); return; }
        if (isPrivate && atUserId) { sendJson({ ok: false, error: '私聊不需要 @' }, 400); return; }
        if (isReply && (replyToMessageId === undefined || replyToMessageId === null || String(replyToMessageId).trim() === '')) {
          sendJson({ ok: false, error: 'replyToMessageId 不能为空' }, 400);
          return;
        }
        if (deps.currentMode === 'reserved2' && !token) { sendJson({ ok: false, error: 'reserved2 模式发送必须携带 agent token' }, 403); return; }
        if (token && !(0, deps.agentTokenOk)(key, token)) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        const flag = isPrivate ? 'sendPrivate' : (isReply ? 'reply' : 'sendGroup');
        if (token && !(0, deps.v2ToolEnabled)(flag)) { sendJson({ ok: false, error: `工具未启用：${flag}` }, 403); return; }
        if ((0, deps.shouldBlockSilentReply)(key)) {
          sendJson({ ok: false, error: '静默模式已开启，当前不允许发送' }, 403);
          return;
        }
        const keyMatch = /^(group|private):(\d+)$/.exec(key);
        if (!keyMatch) { sendJson({ ok: false, error: 'key 格式无效' }, 400); return; }
        const kind = keyMatch[1];
        const id = Number(keyMatch[2]);
        if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
          sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
          return;
        }
        if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '' && !/^-?[1-9]\d*$/.test(String(replyToMessageId).trim())) {
          sendJson({ ok: false, error: 'replyToMessageId 必须是非零整数（消息 id 可能为负数）' }, 400);
          return;
        }
        let quotedInfo: HistoryReplyInfo | null = null;
        let actualReplyToMessageId = replyToMessageId;
        if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '') {
          const stForReply = (0, deps.getSocialV2State)(key);
          const resolved = await (0, deps.resolveReplyTargetV2)(stForReply, kind, id, String(replyToMessageId).trim());
          if (!resolved) {
            sendJson({ ok: false, error: '无法解析被引用消息，请确认 message id 正确且属于当前会话（可用 qq_get_message_detail 查看）' }, 400);
            return;
          }
          quotedInfo = resolved.info;
          actualReplyToMessageId = resolved.messageId;
        }
        const sendCfg = deps.cfg.socialV2?.send ?? {};
        const maxChars = Math.max(1, Number(sendCfg.maxMessageChars) || 500);
        if (message.length > maxChars) { sendJson({ ok: false, error: `单条消息不能超过 ${maxChars} 字` }, 400); return; }
        if (deps.SENSITIVE_RE.test(message)) { sendJson({ ok: false, error: '消息含敏感信息，已阻止发送' }, 403); return; }
        // st/now 必须声明在 try **之外**：下面的 catch 要用它们回滚预占的发送额度。
        // 写在 try 里时 catch 拿到的是块作用域外的名字 ⇒ ReferenceError（send-burst
        // 曾整段踩过同型问题，见体检报告 #1 / R2）。后果不是"少一行日志"，而是
        // 失败响应变成「st is not defined」、额度不回滚（接下来一分钟全是假 429），
        // 且部分成功的已发消息不会被记进 recentMessages。
        const st = (0, deps.getSocialV2State)(key);
        const now = Date.now();
        try {
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
          const sentMessages = await (0, deps.sendMessagesV2)(key, [message], [], actualReplyToMessageId, atUserId);
          (0, deps.recordSentMessagesV2)(key, sentMessages);
          st.lastAiReplyAt = now;
          st.lastActionAt = now;
          st.wakeConfig.noActionCount = 0;
          (0, deps.saveSocialV2State)();
          (0, deps.log)(`[send] ${url.pathname} ${key}: 成功 ${sentMessages.length}/1 条`);
          (0, deps.appendActivity)(`${key} [send] 成功 ${sentMessages.length}/1 条：${message.slice(0, 80)}`);
          if (sentMessages.length > 0) (0, deps.scheduleReplyCheckV2)(key);
          sendJson({ ok: true, key, sent: sentMessages.length, failed: sentMessages.length ? 0 : 1, quoted: quotedInfo });
        } catch (error) {
          if ((error as LegacySendError | null)?.sent?.length) {
            (0, deps.recordSentMessagesV2)(key, (error as LegacySendError).sent!);
            (0, deps.log)(`[send] ${url.pathname} ${key} 部分成功 ${(error as LegacySendError).sent!.length}/1 条，已记录已发消息`);
          }
          // 失败/未发出的消息回滚预占的发送额度，避免假 429。
          const sentCount = Array.isArray((error as LegacySendError | null)?.sent) ? (error as LegacySendError).sent!.length : 0;
          const failedCount = Math.max(0, 1 - sentCount);
          for (let i = 0;i < failedCount;i++) {
            const idx = st.sendTimes.indexOf(now);
            if (idx >= 0) st.sendTimes.splice(idx, 1);
          }
          if (st.sendTimes.length > 500) st.sendTimes = st.sendTimes.slice(-500);
          (0, deps.saveSocialV2State)();
          sendJson({ ok: false, error: (error as LegacySendError | null)?.message ?? String(error) }, 500);
        }
        return;

      }
    }
  };
}
