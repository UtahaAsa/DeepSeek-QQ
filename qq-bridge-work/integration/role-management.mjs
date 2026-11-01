import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectOwnedProcesses } from './process-identity.mjs';

const operations = new Map([
  ['list', ['GET', '/api/roles']], ['content', ['GET', '/api/roles/content']],
  ['create', ['POST', '/api/roles/create']], ['update', ['POST', '/api/roles/update']],
  ['select', ['POST', '/api/role']],
  ['delete', ['POST', '/api/roles/delete']], ['restore', ['POST', '/api/roles/restore']],
]);
const validToken = token => /^[A-Za-z0-9_-]{16,128}$/.test(token);

/**
 * 构造仅限角色管理的本机桥接客户端；不会启动桥接、发送QQ消息或导出控制台凭据。
 * @param {object} options runtime为自有运行目录，current返回当前所属桥接及监督器PID。
 *   inspect/fetchImpl仅供隔离测试替换；每次请求前核验所属进程、端口及运行代次。
 * @returns {function(string,object=):Promise<object>} 支持list/content/create/update/select/delete/restore；复用既有角色校验和回收站。
 * @throws {Error} 未就绪、身份改变、未知操作、超时或响应不符时给固定脱敏错误。
 * @note 单线程；只访问核验后的回环端点，不跟随重定向，不记录或返回控制台令牌。
 */
export function createRoleClient({ runtime, current, inspect = inspectOwnedProcesses, fetchImpl = fetch }) {
  return createBridgeManagementClient({ runtime, current, inspect, fetchImpl, definitions: operations,
    fields: operation => operation === 'list' ? ['roles', 'current', 'limits', 'deletedRoles'] : operation === 'content'
      ? ['ok', 'name', 'content', 'chars', 'bytes', 'warnings', 'limits', 'stats', 'sections'] : ['ok', 'role', 'warnings', 'deleted', 'clearedCurrent', 'restoreId', 'restored'],
    unavailable: 'ROLE_MANAGEMENT_UNAVAILABLE', rejected: 'ROLE_OPERATION_REJECTED',
    allowedErrors: ['ROLE_IN_USE', 'ROLE_TRASH_FULL', 'ROLE_ALREADY_EXISTS', 'ROLE_DELETE_FAILED', 'ROLE_RESTORE_FAILED', 'ROLE_INPUT_INVALID'] });
}

/**
 * 复用本机管理通道的进程、端口和代次核验，不向浏览器传递控制台凭据。
 * @param {object} options definitions和fields必须是服务端固定操作表/投影；不得取自HTTP输入。
 * @returns {function(string,object=):Promise<object>} 只访问固定回环管理端点，不跟随重定向。
 * @throws {Error} 核验失败仅返回固定unavailable码；单线程异步，无持久凭据缓存。
 */
export function createBridgeManagementClient({ runtime, current, definitions, fields, unavailable, rejected,
  allowedErrors = [], inspect = inspectOwnedProcesses, fetchImpl = fetch }) {
  const refused = () => new Error(unavailable);
  return async (operation, input = {}) => {
    try {
      const definition = definitions.get(operation), before = current();
      if (!definition || !before?.ready || !Number.isSafeInteger(before.pid) || before.pid <= 0) throw refused();
      const config = JSON.parse(readFileSync(join(runtime, 'config.json'), 'utf8'));
      const port = config.consolePort;
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw refused();
      const observed = await inspect([before.pid]);
      const same = () => {
        const now = current(); return now?.ready && now.pid === before.pid && now.ownerPid === before.ownerPid;
      };
      const process = observed.processes.find(value => value.pid === before.pid);
      if (!same() || !process?.ownerMatchesCaller || process.parentPid !== before.ownerPid ||
          process.executable?.toLowerCase() !== before.executable?.toLowerCase() ||
          !observed.listeners.some(value => value.pid === before.pid && value.port === port && value.address === '127.0.0.1')) throw refused();
      const configured = String(config.consoleToken ?? '').trim();
      const token = validToken(configured) ? configured : readFileSync(join(runtime, 'state', 'console-token'), 'utf8').trim();
      if (!validToken(token)) throw refused();
      const [method, route] = definition;
      const url = 'http://127.0.0.1:' + port + route + (operation === 'content' ? '?name=' + encodeURIComponent(input.name) : '');
      const response = await fetchImpl(url, { method, headers: { 'X-Console-Token': token,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(input) } : {}), redirect: 'manual', signal: AbortSignal.timeout(5000) });
      if (!same()) throw refused();
      let bytes = 0; const chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length; if (bytes > 192 * 1024) throw refused(); chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!same() || !value || typeof value !== 'object' || Array.isArray(value)) throw refused();
      if (!response.ok || value.ok === false) return { ok: false, error: allowedErrors.includes(value.error) ? value.error : rejected };
      // 仅代理固定操作表并投影页面需要的字段，不能透传整个控制台。
      return Object.fromEntries(fields(operation).filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
    } catch { throw refused(); }
  };
}

/**
 * 构造角色页面和同源管理路由；仅显式保存/选用才写入，页面访问不修改角色。
 * @param {function(string,object=):Promise<object>} requestRole 已限定能力的内部客户端。
 * @param {object} options requestLibrary为固定只读组件角色库接口；不接收HTTP目录参数。
 * @returns {function(object,object,string):Promise<boolean>} 已处理返回true；origin须为所属组合回环地址。
 * @note 拒绝跨源数据/写操作、未知字段、流式或超过96KiB的请求体；无CORS、无外部资源。
 */
export function createRoleRoutes(requestRole, { requestLibrary = async () => { throw Error('ROLE_LIBRARY_UNAVAILABLE'); } } = {}) {
  const assets = new Map([
    ['/roles', ['text/html; charset=utf-8', 'roles.html']],
    ['/roles/page.js', ['text/javascript; charset=utf-8', 'roles.js']],
    ['/roles/page.css', ['text/css; charset=utf-8', 'roles.css']],
    ['/roles/confirmation.js', ['text/javascript; charset=utf-8', 'confirmation.js']],
  ].map(([route, [type, file]]) => [route, { type, body: readFileSync(new URL(file, import.meta.url)) }]));
  const parserAssets = new Map([['/roles/role-card.js', '../bridge/src/role-card.js'], ['/roles/md-to-plain.js', '../bridge/src/md-to-plain.js']]);
  return async (req, res, origin) => {
    if (!req.url?.startsWith('/roles')) return false;
    const url = new URL(req.url, origin);
    if (!url.pathname.startsWith('/roles')) return false;
    const respond = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }); res.end(body); };
    const json = (code, value) => respond(code, 'application/json; charset=utf-8', JSON.stringify(value));
    const navigation = req.method === 'GET' && url.pathname === '/roles' && req.headers['sec-fetch-site'] === 'same-site' &&
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']) && !navigation)) {
      req.resume(); json(403, { ok: false, error: 'ROLE_REQUEST_REFUSED' }); return true;
    }
    if (req.method === 'GET' && parserAssets.has(url.pathname) && !url.search) {
      try { respond(200, 'text/javascript; charset=utf-8', readFileSync(new URL(parserAssets.get(url.pathname), import.meta.url))); }
      catch { json(503, { ok: false, error: 'ROLE_PREVIEW_UNAVAILABLE' }); }
      return true;
    }
    if (req.method === 'GET' && assets.has(url.pathname) && !url.search) {
      const asset = assets.get(url.pathname); respond(200, asset.type, asset.body); return true;
    }
    const operation = url.pathname.slice('/roles/api/'.length), fromLibrary = ['library', 'library-content'].includes(operation);
    const definition = fromLibrary ? ['GET'] : operations.get(operation);
    if (!url.pathname.startsWith('/roles/api/') || !definition || req.method !== definition[0]) {
      req.resume(); json(404, { ok: false, error: 'ROLE_ROUTE_NOT_FOUND' }); return true;
    }
    if (req.headers['x-qq-local-action'] !== '1') { req.resume(); json(403, { ok: false, error: 'ROLE_REQUEST_REFUSED' }); return true; }
    let inputValid = false;
    try {
      let input = {};
      if (req.method === 'POST') {
        const size = Number(req.headers['content-length']);
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] ||
            !Number.isSafeInteger(size) || size < 2 || size > 96 * 1024 || url.search) throw new Error();
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > size) throw new Error(); chunks.push(chunk); }
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const fields = operation === 'select' ? ['role'] : operation === 'delete' ? ['name', 'clearCurrent']
          : operation === 'restore' ? ['restoreId'] : ['name', 'content'];
        if (!input || Array.isArray(input) || Object.keys(input).length !== fields.length ||
            Object.keys(input).some(key => !fields.includes(key)) || fields.some(key =>
              !(operation === 'select' && input[key] === null) && typeof input[key] !== (key === 'clearCurrent' ? 'boolean' : 'string'))) throw new Error();
      } else if (operation === 'content' || operation === 'library-content') {
        if (url.searchParams.size !== 1 || !url.searchParams.has('name')) throw new Error();
        input.name = url.searchParams.get('name');
      } else if (url.search) throw new Error();
      inputValid = true;
      const value = fromLibrary ? await requestLibrary(operation === 'library' ? 'list' : 'content', input) : await requestRole(operation, input);
      json(value.ok === false ? 400 : 200, value);
    } catch { req.resume(); json(inputValid ? 503 : 400, { ok: false,
      error: inputValid ? 'ROLE_MANAGEMENT_UNAVAILABLE' : 'ROLE_INPUT_INVALID' }); }
    return true;
  };
}
