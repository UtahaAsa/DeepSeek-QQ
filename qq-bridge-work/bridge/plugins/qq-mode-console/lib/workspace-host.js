import { randomUUID, createHash } from 'node:crypto';
import { normalizeWorkspaceSettings } from './workspace-policy.js';

const error = code => Object.assign(new Error(code), { code });
const operations = new Set(['state', 'apply', 'login-start', 'login-state','login-connect', 'login-refresh', 'login-stop',
  'data-activity',
  'data-sessions','data-pending','data-memory','data-prompt','data-prompt-save','data-memory-update','data-slang','data-slang-add','data-slang-confirm','data-slang-reject','data-usage','data-usage-recent','data-tool-log','data-feedback','data-states',
  'roles-list', 'roles-content', 'roles-create', 'roles-update', 'roles-select', 'roles-library', 'roles-import', 'roles-delete', 'roles-restore',
  'voice-state', 'voice-validate', 'voice-apply', 'voice-restore', 'images-state', 'images-apply', 'images-clear', 'images-cancel',
  'singing-state', 'singing-prepare', 'singing-status', 'singing-audio','phone-state','phone-configure','phone-recover','phone-action']);
const codes = new Set(['WORKSPACE_UNAVAILABLE', 'WORKSPACE_REQUEST_REFUSED', 'WORKSPACE_SETTINGS_INVALID',
  'WORKSPACE_SETTINGS_CONFLICT', 'WORKSPACE_APPLY_FAILED', 'WORKSPACE_TIMEOUT', 'ROLE_OPERATION_REJECTED',
  'ROLE_MANAGEMENT_UNAVAILABLE', 'VOICE_MANAGEMENT_UNAVAILABLE', 'VOICE_OPERATION_REJECTED',
  'IMAGE_MANAGEMENT_UNAVAILABLE', 'IMAGE_OPERATION_REJECTED','PHONE_MANAGEMENT_UNAVAILABLE','PHONE_OPERATION_REJECTED']);

/**
 * 为DSH插件构造所属组合监督器的有界IPC请求通道；不直接加载QQ或访问凭据。
 * @param {object} channel 默认process；测试可替换同形EventEmitter通道。
 * @returns {object} request/close；每次请求超时8秒，最多8个待定请求。
 * @note 仅接受父IPC的同requestId响应；关闭后拒绝新请求，错误原文不外传。
 */
export function createWorkspaceIpc(channel = process) {
  const pending = new Map(); let closed = false;
  const receive = message => {
    if (message?.kind !== 'qq-workspace-response' || !pending.has(message.id)) return;
    const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
    if (message.ok === true) item.resolve(message.value);
    else item.reject(error(codes.has(message.error) ? message.error : 'WORKSPACE_UNAVAILABLE'));
  };
  channel.on('message', receive);
  const close = () => {
    if (closed) return; closed = true; channel.off('message', receive);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error('WORKSPACE_UNAVAILABLE')); }
    pending.clear();
  };
  return { close, request(operation, payload = {}) {
    if (closed || !channel.connected || typeof channel.send !== 'function' || !operations.has(operation) || pending.size >= 8) {
      return Promise.reject(error('WORKSPACE_UNAVAILABLE'));
    }
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(error('WORKSPACE_TIMEOUT')); }, 8000);
      pending.set(id, { resolve, reject, timer });
      channel.send({ kind: 'qq-workspace-request', id, operation, payload }, failed => {
        if (failed && pending.has(id)) { pending.delete(id); clearTimeout(timer); reject(error('WORKSPACE_UNAVAILABLE')); }
      });
    });
  } };
}

/**
 * 构造DSH已鉴权owner Fetch路由；只接受本人同源交互，设置应用须匹配已保存版本。
 * @param {object} options request为所属父IPC；describe只读取qq-mode的无密钥设置。
 * @returns {Function} Fetch Request到Response的异步处理器；不记录请求/响应正文。
 * @note Connection先完成owner身份验证；本层额外拒绝agent头和跨源/超长输入。
 */
export function createWorkspaceFetch({ request, describe, origin: getOrigin = input => new URL(input.url).origin }) {
  return async input => {
    const json = (status, value) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
    let conflict = null;
    try {
      // DSH的Fetch适配器使用合成URL，真实监听来源必须由宿主显式提供。
      const origin = getOrigin(input);
      if (input.method !== 'POST' || input.headers.get('x-qq-local-action') !== '1'
          || input.headers.has('x-agent-call') || input.headers.has('x-agent-token')
          || input.headers.get('origin') && input.headers.get('origin') !== origin
          || input.headers.get('sec-fetch-site') && input.headers.get('sec-fetch-site') !== 'same-origin'
          || input.headers.get('content-type') !== 'application/json') return json(403, { ok: false, error: 'WORKSPACE_REQUEST_REFUSED' });
      const declared = Number(input.headers.get('content-length') ?? 0);
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > 128 * 1024) return json(400, { ok: false, error: 'WORKSPACE_REQUEST_REFUSED' });
      const reader = input.body?.getReader(); let bytes = 0; const chunks = [];
      if (!reader) throw error('WORKSPACE_REQUEST_REFUSED');
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length; if (bytes > 128 * 1024) { await reader.cancel(); throw error('WORKSPACE_REQUEST_REFUSED'); }
        chunks.push(Buffer.from(value));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['operation', 'payload'].includes(key))
          || !operations.has(body.operation) || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) throw error('WORKSPACE_REQUEST_REFUSED');
      let payload = body.payload;
      if (['login-start','login-connect'].includes(body.operation) && describe()?.value?.workspaceEnabled !== true) throw error('WORKSPACE_SETTINGS_CONFLICT');
      if (body.operation === 'apply') {
        if (Object.keys(payload).some(key => !['revision', 'settingsDigest'].includes(key)) || !Number.isSafeInteger(payload.revision)
            || payload.settingsDigest !== undefined && !/^[a-f0-9]{64}$/.test(payload.settingsDigest)) {
          conflict = { stage: 'request_revision', revisionPresent: Number.isSafeInteger(payload.revision) };
          throw error('WORKSPACE_SETTINGS_CONFLICT');
        }
        const view = describe();
        if (!view || view.value?.workspaceEnabled !== true) {
          conflict = { stage: 'saved_view', viewFound: Boolean(view), enabled: view?.value?.workspaceEnabled === true };
          throw error('WORKSPACE_SETTINGS_CONFLICT');
        }
        const settings = normalizeWorkspaceSettings(view.value.workspace);
        const digest = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
        // DSH可在写入后重新投影namespace版本。只在QQ偏好完全相同时容许该版本推进，
        // 绝不因模式等其他字段的更新而把另一份QQ偏好应用到本次操作。
        if (payload.settingsDigest !== undefined && payload.settingsDigest !== digest
            || view.revision !== payload.revision && payload.settingsDigest !== digest) {
          conflict = { stage: 'saved_value', revisionMatches: view.revision === payload.revision, digestMatches: payload.settingsDigest === digest };
          throw error('WORKSPACE_SETTINGS_CONFLICT');
        }
        payload = { revision: view.revision, settings };
      }
      const value = await request(body.operation, payload);
      // Parent responses are service projections, never raw child/native objects.
      if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) throw error('WORKSPACE_UNAVAILABLE');
      return json(200, { ok: true, value });
    } catch (failure) {
      const code = codes.has(failure?.code) ? failure.code : 'WORKSPACE_REQUEST_REFUSED';
      return json(code === 'WORKSPACE_SETTINGS_CONFLICT' ? 409 : code === 'WORKSPACE_REQUEST_REFUSED' ? 400 : 503,
        { ok: false, error: code, ...(conflict ? { conflict } : {}) });
    }
  };
}
