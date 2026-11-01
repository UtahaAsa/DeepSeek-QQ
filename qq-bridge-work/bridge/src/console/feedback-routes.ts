import type {ConsoleRouteContext, ConsoleRouteHandler, ConsoleRequestHead} from './request-context.js';
import type {FeedbackStore} from './feedback-store.js';
/** 原始限长值沿既有Number转换；错误级反馈继续只记日志。 */
export interface FeedbackConfiguration {ownerQQ?: unknown; socialV2?: {feedback?: {maxLength?: unknown; notifyOwnerOnError?: unknown}|null};}
/** 头字段保留原始数组可能性，不能当成已校验字符串令牌。 */
export interface FeedbackRouteDependencies {
  readonly cfg: FeedbackConfiguration; readonly store: FeedbackStore;
  readonly feedbackTimes: Pick<Map<string,number[]>,'get'|'set'>;
  readonly agentTokenOk: (key: string, token: NonNullable<ConsoleRequestHead['headers'][string]>) => boolean;
  readonly v2SessionAllowed: (key: string) => boolean; readonly v2ToolEnabled: (tool: 'feedback') => boolean;
  readonly truncateText: (text: string, limit: number) => string;
  readonly log: (message: string) => void; readonly appendActivity: (message: string) => void;
  readonly now?: () => number;
}
/**
 * 反馈与工具日志路由；统一鉴权先行，反馈提交额外检查会话归属、模式与工具开关。
 * @param {object} options store为所属反馈存储；feedbackTimes为所属实例限频表；now为限频时钟。
 * @returns {function(object):Promise<boolean>} 已处理为true，否则false；存储错误交由宿主统一响应。
 * @note 每会话一分钟5条、一小时20条，保留原统计边界；记录错误级反馈不主动发送通知。
 */
export function createFeedbackRoutes({cfg,store,feedbackTimes,agentTokenOk,v2SessionAllowed,v2ToolEnabled,truncateText,log,appendActivity,now=Date.now}: FeedbackRouteDependencies): ConsoleRouteHandler {
  const {readToolLog,readFeedbackEntries,appendFeedbackEntry}=store;
  return async function handleFeedbackRoute({req,url,readBody,sendJson}: ConsoleRouteContext) {
    // ── 工具调用日志 ─────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/socialV2/tool-log') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
      sendJson({ ok: true, entries: readToolLog(limit) });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/socialV2/tool-log/clear') {
      if (req.headers['x-agent-token']) { sendJson({ ok: false, error: '该接口仅控制台可用' }, 403); return true; }
      store.clearToolLog();
      log('控制台：工具调用日志已清空');
      sendJson({ ok: true });
      return true;
    }
    // ── 反馈 / 自己消息 / 消息详情 / 活跃成员 ────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/socialV2/feedback') {
      sendJson({ ok: true, entries: readFeedbackEntries() });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/socialV2/feedback-clear') {
      if (req.headers['x-agent-token']) { sendJson({ ok: false, error: '该接口仅控制台可用' }, 403); return true; }
      store.clearFeedback();
      log('控制台：清空 AI 反馈');
      sendJson({ ok: true });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/socialV2/feedback') {
      const body = await readBody();
      const key = String(body.key ?? '').trim();
      const level = body.level === 'warning' || body.level === 'error' ? body.level : 'info';
      const rawMessage = String(body.message ?? '').trim();
      if (!key || !rawMessage) { sendJson({ ok: false, error: 'key 和 message 不能为空' }, 400); return true; }
      if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2SessionAllowed(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2ToolEnabled('feedback')) { sendJson({ ok: false, error: '工具未启用：qq_report_feedback' }, 403); return true; }
      // 反馈限频：防止持有会话 token 的调用方刷磁盘/日志。
      const fNow = now();
      const fTimes = feedbackTimes.get(key) || [];
      const fRecentMinute = fTimes.filter((t) => fNow - t < 60000).length;
      const fRecentHour = fTimes.filter((t) => fNow - t < 3600000).length;
      if (fRecentMinute >= 5 || fRecentHour >= 20) {
        sendJson({ ok: false, error: '反馈过于频繁，请稍后再试' }, 429);
        return true;
      }
      fTimes.push(fNow);
      feedbackTimes.set(key, fTimes.slice(-100));
      const maxLength = Math.max(1, Number(cfg.socialV2?.feedback?.maxLength) || 500);
      const message = truncateText(rawMessage, maxLength);
      appendFeedbackEntry({ id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), key, level, message, time: new Date().toISOString() });
      log(`[reserved2] AI 反馈 (${key}) [${level}]: ${message.slice(0, 80)}`);
      appendActivity(`${key} [reserved2] AI 反馈 [${level}]：${message.slice(0, 80)}`);
      if (cfg.socialV2?.feedback?.notifyOwnerOnError && level === 'error' && cfg.ownerQQ) {
        log(`[reserved2] 错误级反馈，可通知 owner ${cfg.ownerQQ}（当前仅记录日志）`);
      }
      sendJson({ ok: true, key, level, message });
      return true;
    }
    return false;
  };
}
