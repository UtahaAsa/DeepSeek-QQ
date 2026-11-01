import { readFileSync } from 'node:fs';
import { createBridgeManagementClient } from './role-management.mjs';

const operations = new Map([['state', ['GET', '/api/voice/configuration']], ['validate', ['POST', '/api/voice/validate']],
  ['apply', ['POST', '/api/voice/apply']], ['restore', ['POST', '/api/voice/restore']]]);
const allowedErrors = ['EXISTING_VOICE_RESOURCES_INVALID', 'VOICE_CONFIG_CONFLICT', 'VOICE_CONFIG_UNCHANGED', 'VOICE_CONFIG_BUSY', 'VOICE_BACKUP_UNAVAILABLE'];

/**
 * 仅代理所属桥接的语音资源管理；不扩展QQ语音权限，不启动登录。
 * @param {object} options 同角色客户端的所属runtime/current与测试替身。
 * @returns {function(string,object=):Promise<object>} state/validate/apply/restore；apply只确认开始。
 * @note 控制台令牌留在服务端；失败码白名单投影，不输出模型内部日志。
 */
export function createVoiceClient(options) {
  return createBridgeManagementClient({ ...options, definitions: operations, allowedErrors,
    unavailable: 'VOICE_MANAGEMENT_UNAVAILABLE', rejected: 'VOICE_OPERATION_REJECTED',
    fields: operation => operation === 'state' ? ['ok', 'config', 'revision', 'canRestore', 'busy', 'operation', 'voice'] :
      operation === 'validate' ? ['ok', 'config', 'summary'] : ['ok', 'accepted', 'operationId'] });
}

/**
 * 提供同源语音设置页和固定操作路由；只在本人提交时应用配置。
 * @param {function(string,object=):Promise<object>} requestVoice 已限制的管理客户端。
 * @returns {function(object,object,string):Promise<boolean>} origin为所属组合入口；处理成功返回true。
 * @note POST须精确同源/JSON/长度且最多32KiB；拒绝跨源数据请求，无外部资源或CORS。
 */
export function createVoiceRoutes(requestVoice) {
  const assets = new Map([
    ['/voice', ['text/html; charset=utf-8', 'voice.html']], ['/voice/page.js', ['text/javascript; charset=utf-8', 'voice.js']],
    ['/voice/page.css', ['text/css; charset=utf-8', 'roles.css']],
    ['/voice/confirmation.js', ['text/javascript; charset=utf-8', 'confirmation.js']],
  ].map(([route, [type, file]]) => [route, { type, body: readFileSync(new URL(file, import.meta.url)) }]));
  return async (req, res, origin) => {
    if (!req.url?.startsWith('/voice') || req.url === '/voice-status') return false;
    const url = new URL(req.url, origin);
    const respond = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }); res.end(body); };
    const json = (code, value) => respond(code, 'application/json; charset=utf-8', JSON.stringify(value));
    const navigation = req.method === 'GET' && url.pathname === '/voice' && req.headers['sec-fetch-site'] === 'same-site' &&
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']) && !navigation)) {
      req.resume(); json(403, { ok: false, error: 'VOICE_REQUEST_REFUSED' }); return true;
    }
    if (req.method === 'GET' && assets.has(url.pathname) && !url.search) {
      const asset = assets.get(url.pathname); respond(200, asset.type, asset.body); return true;
    }
    const operation = url.pathname.slice('/voice/api/'.length), definition = operations.get(operation);
    if (!url.pathname.startsWith('/voice/api/') || !definition || req.method !== definition[0]) {
      req.resume(); json(404, { ok: false, error: 'VOICE_ROUTE_NOT_FOUND' }); return true;
    }
    if (req.headers['x-qq-local-action'] !== '1') { req.resume(); json(403, { ok: false, error: 'VOICE_REQUEST_REFUSED' }); return true; }
    let inputValid = false;
    try {
      let input = {};
      if (url.search) throw Error();
      if (req.method === 'POST') {
        const size = Number(req.headers['content-length']);
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] ||
            !Number.isSafeInteger(size) || size < 2 || size > 32 * 1024) throw Error();
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > size) throw Error(); chunks.push(chunk); }
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const fields = operation === 'validate' ? ['config'] : operation === 'apply' ? ['config', 'revision'] : ['revision'];
        if (!input || Array.isArray(input) || Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))) throw Error();
        if (fields.includes('revision') && !/^[a-f0-9]{64}$/.test(input.revision ?? '')) throw Error();
        if (fields.includes('config') && (!input.config || typeof input.config !== 'object' || Array.isArray(input.config) ||
            Object.keys(input.config).length !== 6 || !['selectedVoice', 'python', 'engine', 'pretrained', 'ffmpeg', 'asrModel'].every(key =>
              typeof input.config[key] === 'string' && input.config[key].length <= 2048))) throw Error();
      }
      inputValid = true;
      const value = await requestVoice(operation, input);
      json(value.ok === false ? 400 : value.accepted ? 202 : 200, value);
    } catch { req.resume(); json(inputValid ? 503 : 400, { ok: false, error: inputValid ? 'VOICE_MANAGEMENT_UNAVAILABLE' : 'VOICE_INPUT_INVALID' }); }
    return true;
  };
}
