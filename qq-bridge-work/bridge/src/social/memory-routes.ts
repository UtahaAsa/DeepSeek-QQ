import type {ConsoleRouteHandler, ConsoleRequestHead} from '../console/request-context.js';
import type {ConversationMemory, ConversationMemoryState, ConversationMemoryExtra} from './conversation-memory.js';
/** 状态按请求同步读取；权限检查不从类型推导授权，必须按原顺序执行。 */
export interface MemoryRouteDependencies<State extends ConversationMemoryState = ConversationMemoryState> {
  readonly getState: (key: string) => State;
  readonly memory: ConversationMemory;
  readonly save: () => void;
  readonly redactKnownTokensOnly: (text: string) => string;
  readonly agentTokenOk: (key: string, token: ConsoleRequestHead['headers'][string]) => boolean;
  readonly v2SessionAllowed: (key: string) => boolean;
  readonly v2ToolEnabled: (tool: 'memory') => boolean;
  readonly now?: () => number;
}
/** 原持久化印象只在访问位置断言字段；记录值继续为unknown。 */
interface LegacyMemberImpression {traits?: unknown; interactionCount?: unknown; lastSeenAt?: unknown;}
/** 归一化的已知字段加未声明的外部字段，保留expiresAtMs/interactionCount原有转换。 */
interface CleanMemoryExtra extends Record<string, unknown> {
  pendingQuestion?: string; participants?: string[]; motivation?: string; target?: string;
}
/**
 * 会话记忆增删改查入口，调用前必须经过控制台统一鉴权。
 * @param {object} options getState读取所属会话，memory为记忆规则模块；save/redactKnownTokensOnly及权限检查由宿主提供。
 * @returns {function(object):Promise<boolean>} 已处理为true，无关路由为false；持久化异常交由宿主响应。
 * @note 智能体请求逐项检查会话归属、模式准入和memory开关；构造无IO，保留原HTTP字段和状态码。
 */
export function createMemoryRoutes<State extends ConversationMemoryState>({getState:getSocialV2State,memory,save:saveSocialV2State,redactKnownTokensOnly,
  agentTokenOk,v2SessionAllowed,v2ToolEnabled,now=Date.now}: MemoryRouteDependencies<State>): ConsoleRouteHandler {
  const {formatMemoryV2,appendMemoryV2}=memory;
  return async function handleMemoryRoute({req,url,readBody,sendJson}) {
    if (req.method === 'POST' && url.pathname === '/api/socialV2/memory-append') {
      const body = await readBody();
      const key = String(body.key ?? '').trim();
      const category = String(body.category ?? '').trim();
      const content = String(body.content ?? '').trim();
      const extra = (body.extra && typeof body.extra === 'object' ? body.extra : {}) as ConversationMemoryExtra;
      if (!key || !category || !content) { sendJson({ ok: false, error: 'key/category/content 不能为空' }, 400); return true; }
      if (!['activeTopic', 'pendingThought', 'memberImpression'].includes(category)) { sendJson({ ok: false, error: 'category 必须是 activeTopic / pendingThought / memberImpression' }, 400); return true; }
      if (category === 'memberImpression' && !String((extra as Record<string, unknown>).target || '').trim()) { sendJson({ ok: false, error: 'memberImpression 需要 extra.target 指定群友名字' }, 400); return true; }
      if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2SessionAllowed(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2ToolEnabled('memory')) { sendJson({ ok: false, error: '工具未启用：qq_memory_append' }, 403); return true; }
      const st = getSocialV2State(key);
      appendMemoryV2(st, category, content, extra);
      sendJson({ ok: true, key, category, content, memory: formatMemoryV2(st) });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/socialV2/memory-update') {
      const body = await readBody();
      const key = String(body.key ?? '').trim();
      const category = String(body.category ?? '').trim();
      const oldContent = String(body.oldContent ?? '').trim();
      const target = redactKnownTokensOnly(String(body.target ?? '').trim());
      const newContent = body.newContent !== undefined && body.newContent !== null ? redactKnownTokensOnly(String(body.newContent).trim()) : undefined;
      const newExtra = (body.newExtra && typeof body.newExtra === 'object' && !Array.isArray(body.newExtra) ? body.newExtra : {}) as Record<string, unknown>;
      const redactExtra = (v: unknown) => redactKnownTokensOnly(String(v ?? '')).trim();
      const cleanNewExtra: CleanMemoryExtra = {
        ...newExtra,
        pendingQuestion: newExtra.pendingQuestion !== undefined ? redactExtra(newExtra.pendingQuestion) : undefined,
        participants: Array.isArray(newExtra.participants) ? newExtra.participants.map((p) => redactExtra(p)) : undefined,
        motivation: newExtra.motivation !== undefined ? redactExtra(newExtra.motivation) : undefined,
        target: newExtra.target !== undefined ? redactExtra(newExtra.target) : undefined
      };
      if (!key || !category) { sendJson({ ok: false, error: 'key/category 不能为空' }, 400); return true; }
      if (!['activeTopic', 'pendingThought', 'memberImpression'].includes(category)) { sendJson({ ok: false, error: 'category 必须是 activeTopic / pendingThought / memberImpression' }, 400); return true; }
      if (category === 'memberImpression' && !target) { sendJson({ ok: false, error: 'memberImpression 需要 target 指定原群友名字' }, 400); return true; }
      if (category !== 'memberImpression' && !oldContent) { sendJson({ ok: false, error: '该类别需要 oldContent 指定要编辑的记忆内容' }, 400); return true; }
      if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2SessionAllowed(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2ToolEnabled('memory')) { sendJson({ ok: false, error: '工具未启用：qq_memory_*' }, 403); return true; }
      const st = getSocialV2State(key);
      if (category === 'activeTopic' && Array.isArray(st.activeTopics)) {
        const idx = st.activeTopics.findIndex((t) => String(t?.text ?? '') === oldContent);
        if (idx < 0) { sendJson({ ok: false, error: '找不到要编辑的 activeTopic' }, 404); return true; }
        if (newContent !== undefined) st.activeTopics[idx].text = newContent.slice(0, 200);
        if (cleanNewExtra.pendingQuestion !== undefined) st.activeTopics[idx].pendingQuestion = String(cleanNewExtra.pendingQuestion).slice(0, 200);
        if (Array.isArray(cleanNewExtra.participants)) st.activeTopics[idx].participants = cleanNewExtra.participants.map(String).slice(0, 10);
      } else if (category === 'pendingThought' && Array.isArray(st.pendingThoughts)) {
        const idx = st.pendingThoughts.findIndex((t) => String(t?.text ?? '') === oldContent);
        if (idx < 0) { sendJson({ ok: false, error: '找不到要编辑的 pendingThought' }, 404); return true; }
        if (newContent !== undefined) st.pendingThoughts[idx].text = newContent.slice(0, 200);
        if (cleanNewExtra.motivation !== undefined) st.pendingThoughts[idx].motivation = String(cleanNewExtra.motivation).slice(0, 50);
        if (cleanNewExtra.expiresAtMs !== undefined) st.pendingThoughts[idx].expiresAt = now() + Math.max(0, Number(cleanNewExtra.expiresAtMs) || 0);
      } else if (category === 'memberImpression' && st.memberImpressions && typeof st.memberImpressions === 'object') {
        const oldTarget = target;
        if (['__proto__', 'constructor', 'prototype'].includes(oldTarget)) { sendJson({ ok: false, error: '非法的群友名字' }, 400); return true; }
        // 必须命中**已有**条目（own property）：否则任意 target 都能凭空建一条，
        // 而 'toString'/'valueOf' 这类名字会从 Object.prototype 上取到继承来的函数，
        // 往函数对象上写 traits —— JSON.stringify 又会把它整个丢掉（静默数据丢失）。
        if (!Object.prototype.hasOwnProperty.call(st.memberImpressions, oldTarget)) {
          sendJson({ ok: false, error: '找不到要编辑的群友印象（新印象请用 qq_memory_append 添加）' }, 404);
          return true;
        }
        const im = st.memberImpressions[oldTarget] as LegacyMemberImpression;
        const newTarget = String(cleanNewExtra.target || oldTarget).trim().slice(0, 64);
        if (!newTarget || ['__proto__', 'constructor', 'prototype'].includes(newTarget)) { sendJson({ ok: false, error: '非法的群友名字' }, 400); return true; }
        if (newContent !== undefined) {
          im.traits = newContent.split(/[,，、]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
        }
        if (cleanNewExtra.interactionCount !== undefined) im.interactionCount = Math.max(0, Number(cleanNewExtra.interactionCount) || 0);
        if (newTarget !== oldTarget) delete st.memberImpressions[oldTarget];
        st.memberImpressions[newTarget] = im;
        // 与控制台/AI 的 append 路径保持一致：条目数上限 50，超了按 lastSeenAt 淘汰最旧，
        // 否则 memory-update 能无限塞名字（每次 1MB 请求 → 状态文件与每轮 prompt 一起膨胀）。
        const impressionEntries = Object.entries(st.memberImpressions);
        if (impressionEntries.length > 50) {
          impressionEntries.sort((a, b) => (Number((a[1] as LegacyMemberImpression | null)?.lastSeenAt) || 0) - (Number((b[1] as LegacyMemberImpression | null)?.lastSeenAt) || 0));
          for (let i = 0; i < impressionEntries.length - 50; i += 1) delete st.memberImpressions[impressionEntries[i][0]];
        }
      }
      saveSocialV2State();
      sendJson({ ok: true, key, category, memory: formatMemoryV2(st) });
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/socialV2/memory') {
      const key = String(url.searchParams.get('key') ?? '').trim();
      const category = String(url.searchParams.get('category') ?? '').trim();
      if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return true; }
      if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2SessionAllowed(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2ToolEnabled('memory')) { sendJson({ ok: false, error: '工具未启用：qq_memory_query' }, 403); return true; }
      const st = getSocialV2State(key);
      const raw = {
        activeTopics: Array.isArray(st.activeTopics) ? st.activeTopics.slice(-20) : [],
        pendingThoughts: Array.isArray(st.pendingThoughts) ? st.pendingThoughts.filter((t) => !t.expiresAt || now() < (t.expiresAt as number)).slice(-20) : [],
        memberImpressions: st.memberImpressions && typeof st.memberImpressions === 'object' ? st.memberImpressions : {}
      };
      if (category === 'activeTopic') {
        raw.pendingThoughts = [];
        raw.memberImpressions = {};
      } else if (category === 'pendingThought') {
        raw.activeTopics = [];
        raw.memberImpressions = {};
      } else if (category === 'memberImpression') {
        raw.activeTopics = [];
        raw.pendingThoughts = [];
      }
      sendJson({ ok: true, key, category, formatted: formatMemoryV2({ ...st, ...raw }), raw });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/socialV2/memory-remove') {
      const body = await readBody();
      const key = String(body.key ?? '').trim();
      const category = String(body.category ?? '').trim();
      const content = String(body.content ?? '').trim();
      const target = String(body.target ?? '').trim();
      if (!key || !category) { sendJson({ ok: false, error: 'key/category 不能为空' }, 400); return true; }
      if (!['activeTopic', 'pendingThought', 'memberImpression'].includes(category)) { sendJson({ ok: false, error: 'category 必须是 activeTopic / pendingThought / memberImpression' }, 400); return true; }
      if (category === 'memberImpression' && !target) { sendJson({ ok: false, error: 'memberImpression 需要 target 指定群友名字' }, 400); return true; }
      if (category === 'memberImpression' && ['__proto__', 'constructor', 'prototype'].includes(target)) { sendJson({ ok: false, error: '非法的群友名字' }, 400); return true; }
      if (category !== 'memberImpression' && !content) { sendJson({ ok: false, error: '该类别需要 content 指定要删除的记忆内容' }, 400); return true; }
      if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2SessionAllowed(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2ToolEnabled('memory')) { sendJson({ ok: false, error: '工具未启用：qq_memory_remove' }, 403); return true; }
      const st = getSocialV2State(key);
      if (category === 'activeTopic' && Array.isArray(st.activeTopics)) {
        st.activeTopics = st.activeTopics.filter((t) => String(t?.text ?? '') !== content);
      } else if (category === 'pendingThought' && Array.isArray(st.pendingThoughts)) {
        st.pendingThoughts = st.pendingThoughts.filter((t) => String(t?.text ?? '') !== content);
      } else if (category === 'memberImpression' && st.memberImpressions && typeof st.memberImpressions === 'object') {
        delete st.memberImpressions[target];
      }
      saveSocialV2State();
      sendJson({ ok: true, key, category, memory: formatMemoryV2(st) });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/socialV2/memory-clear') {
      const body = await readBody();
      const key = String(body.key ?? '').trim();
      const category = String(body.category ?? '').trim();
      if (!key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return true; }
      if (category && !['activeTopic', 'pendingThought', 'memberImpression'].includes(category)) { sendJson({ ok: false, error: 'category 必须是 activeTopic / pendingThought / memberImpression' }, 400); return true; }
      if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2SessionAllowed(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return true; }
      if (req.headers['x-agent-token'] && !v2ToolEnabled('memory')) { sendJson({ ok: false, error: '工具未启用：qq_memory_clear' }, 403); return true; }
      const st = getSocialV2State(key);
      if (!category || category === 'activeTopic') st.activeTopics = [];
      if (!category || category === 'pendingThought') st.pendingThoughts = [];
      if (!category || category === 'memberImpression') st.memberImpressions = {};
      saveSocialV2State();
      sendJson({ ok: true, key, category: category || 'all', memory: formatMemoryV2(st) });
      return true;
    }
    return false;
  };
}
