import type {NamedConsoleRoutes} from './contracts.js';
import type {MessageToolsDependencies, MessageToolsState} from './message-tools.js';
import type {GapPlanner, SendGapConfig} from '../../messaging/gap-planner.js';
/** 数值与开关沿用原转换，外部配置不视为已验证的值。 */
export interface TextSendConfiguration {socialV2?: {send?: (SendGapConfig & {
 burstEnabled?: unknown; burstMaxMessages?: unknown; maxMessageChars?: unknown; maxSendPerMinute?: unknown; maxSendPerHour?: unknown;
})|null};}
/** 复用发送额度、回合时间与唤醒确认状态，不改变宿主所有权。 */
export type TextSendState = MessageToolsState;
/** 仅暴露二代分条与统一发送，宿主仍负责鉴权和只读检查。 */
export type TextSendRoutes = NamedConsoleRoutes<'postSocialV2SendBurst'|'postSocialV2SendMessage'>;
/** 复用消息工具的发送守卫及记账边界；间隔规划无IO，实际发送可等待。 */
export interface TextSendDependencies<Configuration extends TextSendConfiguration, State extends TextSendState>
 extends Pick<MessageToolsDependencies<Configuration,unknown,State>,'cfg'|'currentMode'|'SENSITIVE_RE'|'modeAllowed'|'log'|'agentTokenOk'|'v2SessionAllowed'|'v2ToolEnabled'|'shouldBlockSilentReply'|'getSocialV2State'|'resolveReplyTargetV2'|'recordSentMessagesV2'|'saveSocialV2State'|'appendActivity'|'scheduleReplyCheckV2'> {
 readonly computeGapsV2: GapPlanner['computeGapsV2'];
 readonly sendMessagesV2: (key: string, messages: string[], gaps: number[], replyToMessageId?: unknown, atUserId?: unknown) => Promise<string[]>;
 readonly findCjkSpaceWarning: (messages: string[]) => string | null | undefined;
 readonly findSplitBoundaryWarning: (messages: string[]) => string | null | undefined;
}
/** 仅描述原部分成功路径读取的字段；不新增异常载荷验证。 */
interface LegacySendError {message?: unknown; sent?: string[];}
/**
 * text-send功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：cfg, agentTokenOk, v2SessionAllowed, v2ToolEnabled, currentMode, modeAllowed, shouldBlockSilentReply, SENSITIVE_RE, getSocialV2State, computeGapsV2, sendMessagesV2, recordSentMessagesV2, saveSocialV2State, log, appendActivity, scheduleReplyCheckV2, findCjkSpaceWarning, findSplitBoundaryWarning, resolveReplyTargetV2。
 */
export function createTextSendRoutes<Configuration extends TextSendConfiguration, State extends TextSendState>(deps: TextSendDependencies<Configuration, State>): TextSendRoutes {
  return {
    postSocialV2SendBurst: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/send-burst',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const key = String(body.key ?? '').trim();
        let rawMessages = body.messages;
        if (typeof rawMessages === 'string') {
          const trimmed = rawMessages.trim();
          if (trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) rawMessages = parsed.map(String);
            } catch { }
          } else if (trimmed.startsWith('"')) {
            // 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
            try {
              const parsed = JSON.parse(trimmed);
              if (typeof parsed === 'string') rawMessages = parsed;
              else if (Array.isArray(parsed)) rawMessages = parsed.map(String);
            } catch { }
          }
        }
        const messages = Array.isArray(rawMessages)
          ? rawMessages.map((m) => String(m ?? '').trim()).filter(Boolean)
          : (typeof rawMessages === 'string' ? [String(rawMessages).trim()].filter(Boolean) : []);
        const replyToMessageId = body.replyToMessageId;
        if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '') {
          sendJson({ ok: false, error: 'qq_send_burst 暂不支持引用，请使用 qq_reply' }, 400);
          return;
        }
        if (!key || !messages.length) {
          sendJson({ ok: false, error: 'key 和 messages 不能为空' }, 400);
          return;
        }
        const sendCfgBurst = deps.cfg.socialV2?.send ?? {};
        if (sendCfgBurst.burstEnabled === false && messages.length > 1) {
          sendJson({ ok: false, error: '已禁用多条发送，请合并为一条消息' }, 403);
          return;
        }
        if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('sendBurst')) { sendJson({ ok: false, error: '工具未启用：qq_send_burst' }, 403); return; }
        if (deps.currentMode !== 'reserved2') {
          sendJson({ ok: false, error: '该接口仅 reserved2 模式可用' }, 403);
          return;
        }
        if (!req.headers['x-agent-token']) { sendJson({ ok: false, error: 'reserved2 模式发送必须携带 agent token' }, 403); return; }
        const keyMatch = /^(group|private):(\d+)$/.exec(key);
        if (!keyMatch) {
          sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400);
          return;
        }
        const kind = keyMatch[1];
        const id = Number(keyMatch[2]);
        if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
          sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
          return;
        }
        if ((0, deps.shouldBlockSilentReply)(key)) {
          sendJson({ ok: false, error: '静默模式已开启，当前不允许发送' }, 403);
          return;
        }
        const sendCfg = deps.cfg.socialV2?.send ?? {};
        const maxMsgs = Math.max(1, Number(sendCfg.burstMaxMessages) || 8);
        const maxChars = Math.max(1, Number(sendCfg.maxMessageChars) || 500);
        if (messages.length > maxMsgs) {
          sendJson({ ok: false, error: `最多发送 ${maxMsgs} 条` }, 400);
          return;
        }
        for (const msg of messages) {
          if (msg.length > maxChars) {
            sendJson({ ok: false, error: `单条消息不能超过 ${maxChars} 字` }, 400);
            return;
          }
          if (deps.SENSITIVE_RE.test(msg)) {
            sendJson({ ok: false, error: '消息含敏感信息，已阻止发送' }, 403);
            return;
          }
        }
        const st = (0, deps.getSocialV2State)(key);
        const now = Date.now();
        try {
          const maxPerMinute = Number(sendCfg.maxSendPerMinute) || 0;
          const maxPerHour = Number(sendCfg.maxSendPerHour) || 0;
          const recentMinute = (st.sendTimes || []).filter((t) => now - t < 60000).length;
          const recentHour = (st.sendTimes || []).filter((t) => now - t < 3600000).length;
          if ((maxPerMinute > 0 && recentMinute + messages.length > maxPerMinute) || (maxPerHour > 0 && recentHour + messages.length > maxPerHour)) {
            sendJson({ ok: false, error: '发送频率超限，请稍后再试' }, 429);
            return;
          }
          // 先预占发送额度，避免并发绕过限频
          for (let i = 0;i < messages.length;i++) st.sendTimes.push(now);
          if (st.sendTimes.length > 500) st.sendTimes = st.sendTimes.slice(-500);
          const delays = (0, deps.computeGapsV2)(messages, 'auto', undefined, undefined, sendCfg);
          const sentMessages = await (0, deps.sendMessagesV2)(key, messages, delays);
          (0, deps.recordSentMessagesV2)(key, sentMessages);
          st.lastAiReplyAt = now;
          st.lastActionAt = now;
          st.wakeConfig.noActionCount = 0;
          (0, deps.saveSocialV2State)();
          (0, deps.log)(`[reserved2] 工具分条发送 ${key}: 成功 ${sentMessages.length}/${messages.length} 条`);
          (0, deps.appendActivity)(`${key} [reserved2] 工具分条发送：成功 ${sentMessages.length}/${messages.length} 条`);
          if (sentMessages.length > 0) (0, deps.scheduleReplyCheckV2)(key);
          const burstHint = messages.length >= 3 ? '你已经连发了多条，确认是必要的吗？真人很少一口气补完。' : undefined;
          const spaceWarn = (0, deps.findCjkSpaceWarning)(messages);
          const splitWarn = (0, deps.findSplitBoundaryWarning)(messages);
          sendJson({ ok: true, key, sent: sentMessages.length, failed: messages.length - sentMessages.length, ...(burstHint ? { hint: burstHint } : {}), ...(spaceWarn ? { warn: spaceWarn } : {}), ...(splitWarn ? { splitWarn } : {}) });
        } catch (error) {
          if ((error as LegacySendError | null)?.sent?.length) {
            (0, deps.recordSentMessagesV2)(key, (error as LegacySendError).sent!);
            (0, deps.log)(`[reserved2] 工具分条发送部分成功 ${(error as LegacySendError).sent!.length}/${messages.length} 条，已记录已发消息`);
          }
          // 失败/未发出的消息回滚预占的发送额度，避免假 429。
          const sentCount = Array.isArray((error as LegacySendError | null)?.sent) ? (error as LegacySendError).sent!.length : 0;
          const failedCount = Math.max(0, messages.length - sentCount);
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
    },
    postSocialV2SendMessage: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/send-message',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const key = String(body.key ?? '').trim();
        let rawMessages = body.messages;
        if (typeof rawMessages === 'string') {
          const trimmed = rawMessages.trim();
          // 兼容模型把数组序列化成 JSON 字符串传入的情况，例如 "[...]"。
          if (trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) rawMessages = parsed.map(String);
            } catch { }
          } else if (trimmed.startsWith('"')) {
            // 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
            try {
              const parsed = JSON.parse(trimmed);
              if (typeof parsed === 'string') rawMessages = parsed;
              else if (Array.isArray(parsed)) rawMessages = parsed.map(String);
            } catch { }
          }
        }
        const isRawString = typeof rawMessages === 'string';
        const messages = Array.isArray(rawMessages)
          ? rawMessages.map((m) => String(m ?? '').trim()).filter(Boolean)
          : (isRawString ? [String(rawMessages).trim()].filter(Boolean) : []);
        const replyToMessageId = body.replyToMessageId;
        const atUserId = body.atUserId ?? null;
        // 二代不再按空格自动分条：字符串就是一条消息，数组模式原样使用调用方间隔。
        // 旧写法是 `(isRawString && messages.length > 1) ? 'auto' : ...` —— 上面 messages 的构造
        // 保证 isRawString 为真时 length 恒为 1，这个分支永远不可达，留着只会让人以为
        // "字符串多段时有特殊间隔策略"。
        const gapMode = (body.gapMode === 'fixed' || body.gapMode === 'byLength') ? body.gapMode : 'auto';
        const gapMs = Number(body.gapMs);
        const gaps = Array.isArray(body.gaps) ? body.gaps.map(Number) : [];
        if (!key || !messages.length) {
          sendJson({ ok: false, error: 'key 和 messages 不能为空' }, 400);
          return;
        }
        const sendCfgBurst = deps.cfg.socialV2?.send ?? {};
        if (sendCfgBurst.burstEnabled === false && messages.length > 1) {
          sendJson({ ok: false, error: '已禁用多条发送，请合并为一条消息' }, 403);
          return;
        }
        if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('sendMessage')) { sendJson({ ok: false, error: '工具未启用：qq_send_message' }, 403); return; }
        if (deps.currentMode !== 'reserved2') { sendJson({ ok: false, error: '该接口仅 reserved2 模式可用' }, 403); return; }
        if (!req.headers['x-agent-token']) { sendJson({ ok: false, error: 'reserved2 模式发送必须携带 agent token' }, 403); return; }
        const keyMatch = /^(group|private):(\d+)$/.exec(key);
        if (!keyMatch) { sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400); return; }
        const kind = keyMatch[1];
        const id = Number(keyMatch[2]);
        if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
          sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
          return;
        }
        if (kind === 'private' && atUserId) {
          sendJson({ ok: false, error: '私聊不需要 @' }, 400);
          return;
        }
        if ((0, deps.shouldBlockSilentReply)(key)) {
          sendJson({ ok: false, error: '静默模式已开启，当前不允许发送' }, 403);
          return;
        }
        if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '' && !/^-?[1-9]\d*$/.test(String(replyToMessageId).trim())) {
          sendJson({ ok: false, error: 'replyToMessageId 必须是非零整数（消息 id 可能为负数）' }, 400);
          return;
        }
        const sendCfg = deps.cfg.socialV2?.send ?? {};
        const maxMsgs = Math.max(1, Number(sendCfg.burstMaxMessages) || 8);
        const maxChars = Math.max(1, Number(sendCfg.maxMessageChars) || 500);
        if (messages.length > maxMsgs) {
          sendJson({ ok: false, error: `最多发送 ${maxMsgs} 条` }, 400);
          return;
        }
        for (const msg of messages) {
          if (msg.length > maxChars) {
            sendJson({ ok: false, error: `单条消息不能超过 ${maxChars} 字` }, 400);
            return;
          }
          if (deps.SENSITIVE_RE.test(msg)) {
            sendJson({ ok: false, error: '消息含敏感信息，已阻止发送' }, 403);
            return;
          }
        }
        const delays = (0, deps.computeGapsV2)(messages, gapMode, gapMs, gaps, sendCfg);
        // 先做发送频率检查并预占额度，再解析引用目标，避免未限流的引用查询打爆 OneBot。
        const st = (0, deps.getSocialV2State)(key);
        const now = Date.now();
        const maxPerMinute = Number(sendCfg.maxSendPerMinute) || 0;
        const maxPerHour = Number(sendCfg.maxSendPerHour) || 0;
        const recentMinute = (st.sendTimes || []).filter((t) => now - t < 60000).length;
        const recentHour = (st.sendTimes || []).filter((t) => now - t < 3600000).length;
        if ((maxPerMinute > 0 && recentMinute + messages.length > maxPerMinute) || (maxPerHour > 0 && recentHour + messages.length > maxPerHour)) {
          sendJson({ ok: false, error: '发送频率超限，请稍后再试' }, 429);
          return;
        }
        // 先预占发送额度，避免并发绕过限频
        for (let i = 0;i < messages.length;i++) st.sendTimes.push(now);
        if (st.sendTimes.length > 500) st.sendTimes = st.sendTimes.slice(-500);
        let quotedInfo = null;
        let actualReplyToMessageId = replyToMessageId;
        if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '') {
          const resolved = await (0, deps.resolveReplyTargetV2)(st, kind, id, String(replyToMessageId).trim());
          if (!resolved) {
            // 引用解析失败：回滚已预占的发送额度
            for (let i = 0;i < messages.length;i++) {
              const idx = st.sendTimes.indexOf(now);
              if (idx >= 0) st.sendTimes.splice(idx, 1);
            }
            (0, deps.saveSocialV2State)();
            sendJson({ ok: false, error: '无法解析被引用消息，请确认 message id 正确且属于当前会话（可用 qq_get_message_detail 查看）' }, 400);
            return;
          }
          quotedInfo = resolved.info;
          actualReplyToMessageId = resolved.messageId;
        }
        try {
          const sentMessages = await (0, deps.sendMessagesV2)(key, messages, delays, actualReplyToMessageId, atUserId);
          (0, deps.recordSentMessagesV2)(key, sentMessages);
          st.lastAiReplyAt = now;
          st.lastActionAt = now;
          st.wakeConfig.noActionCount = 0;
          (0, deps.saveSocialV2State)();
          (0, deps.log)(`[reserved2] 工具统一发送 ${key}: 成功 ${sentMessages.length}/${messages.length} 条`);
          (0, deps.appendActivity)(`${key} [reserved2] 工具统一发送：成功 ${sentMessages.length}/${messages.length} 条`);
          if (sentMessages.length > 0) (0, deps.scheduleReplyCheckV2)(key);
          const burstHint = messages.length >= 3 ? '你已经连发了多条，确认是必要的吗？真人很少一口气补完。' : undefined;
          const spaceWarn = (0, deps.findCjkSpaceWarning)(messages);
          const splitWarn = (0, deps.findSplitBoundaryWarning)(messages);
          sendJson({ ok: true, key, sent: sentMessages.length, failed: messages.length - sentMessages.length, delays, quoted: quotedInfo, ...(burstHint ? { hint: burstHint } : {}), ...(spaceWarn ? { warn: spaceWarn } : {}), ...(splitWarn ? { splitWarn } : {}) });
        } catch (error) {
          if ((error as LegacySendError | null)?.sent?.length) {
            (0, deps.recordSentMessagesV2)(key, (error as LegacySendError).sent!);
            (0, deps.log)(`[reserved2] 工具统一发送部分成功 ${(error as LegacySendError).sent!.length}/${messages.length} 条，已记录已发消息`);
          }
          // 失败/未发出的消息回滚预占的发送额度，避免假 429。
          const sentCount = Array.isArray((error as LegacySendError | null)?.sent) ? (error as LegacySendError).sent!.length : 0;
          const failedCount = Math.max(0, messages.length - sentCount);
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
