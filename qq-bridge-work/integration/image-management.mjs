import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { createBridgeManagementClient } from './role-management.mjs';
import { IMAGE_GENERATION_API_ERRORS } from '../bridge/src/image-generation-errors.js';

const definitions = new Map([['state', ['GET', '/api/image-generation/configuration']],
  ...['apply', 'clear', 'cancel'].map(operation => [operation, ['POST', '/api/image-generation/' + operation]])]);
const refused = () => new Error('IMAGE_MANAGEMENT_UNAVAILABLE');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const settingsFields = ['provider', 'endpoint', 'model', 'size', 'quality', 'responseFormat'];
const settingsObject = value => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => settingsFields.includes(key)) && ['endpoint', 'model'].every(key => typeof value[key] === 'string') &&
  Object.values(value).every(item => typeof item === 'string' && item.length <= 2048);

/**
 * 深度投影页面所需状态；密钥只以hasApiKey表示，不转发未知嵌套字段。
 * @param {object} state 来自已核验所属桥接的状态。
 * @returns {object} 固定状态字段和已校验无凭据配置。
 * @throws {Error} 响应不符时固定拒绝，不含输入值；同步纯函数。
 */
export function projectImageGeneration(state) {
  if (!state || !integer(state.revision) || state.revision < 1 ||
      !['permission', 'configured', 'hasApiKey', 'busy', 'closed'].every(key => typeof state[key] === 'boolean') ||
      !['attempted', 'prepared', 'failed', 'cancelled'].every(key => integer(state.counts?.[key])) ||
      !integer(state.limits?.attemptedToday)) throw refused();
  const lastResult = state.lastResult === 'prepared_not_sent' || IMAGE_GENERATION_API_ERRORS.includes(state.lastResult) ? state.lastResult : null;
  return { revision: state.revision, permission: state.permission, configured: state.configured, hasApiKey: state.hasApiKey,
    busy: state.busy, closed: state.closed, settings: state.settings === null ? null : (() => {
      if (!settingsObject(state.settings)) throw refused();
      return Object.fromEntries(settingsFields.filter(key => Object.hasOwn(state.settings, key)).map(key => [key, state.settings[key]]));
    })(),
    counts: Object.fromEntries(['attempted', 'prepared', 'failed', 'cancelled'].map(key => [key, state.counts[key]])), lastResult,
    limits: { concurrent: 1, cooldownSeconds: 60, dailyAttempts: 20, timezone: 'Asia/Shanghai', persistAcrossRestart: false,
      attemptedToday: state.limits.attemptedToday }, credentialsPersisted: false, realQqDeliveryIncluded: false };
}

/**
 * 复用所属OS进程/端口/代次校验，仅代理固定图片配置操作，不提供生成入口。
 * @param {object} options runtime/current及隔离测试替身，语义同角色管理客户端。
 * @returns {Function} state/apply/clear/cancel；不输出控制台令牌、密钥或供应商诊断。
 */
export function createImageClient(options) {
  const request = createBridgeManagementClient({ ...options, definitions, fields: () => ['ok', 'generation'],
    unavailable: 'IMAGE_MANAGEMENT_UNAVAILABLE', rejected: 'IMAGE_OPERATION_REJECTED', allowedErrors: IMAGE_GENERATION_API_ERRORS });
  return async (operation, input = {}) => {
    try {
      const value = await request(operation, input);
      return value.ok === false ? value : { ok: true, generation: projectImageGeneration(value.generation) };
    } catch { throw refused(); }
  };
}

/**
 * 提供固定同源图片设置页；读取/保存均不触发付费生成或QQ操作。
 * @param {Function} requestImage 已限制的操作员管理客户端。
 * @returns {Function} (req,res,origin)处理所属回环请求，命中返回true。
 * @note POST精确同源/JSON/自定义头、16KiB限额；拒绝智能体标记、跨源API和未知字段，无外部资源。
 */
export function createImageRoutes(requestImage) {
  const assets = new Map([
    ['/image-generation', ['text/html; charset=utf-8', 'images.html']],
    ['/image-generation/page.js', ['text/javascript; charset=utf-8', 'images.js']],
    ['/image-generation/page.css', ['text/css; charset=utf-8', 'roles.css']],
    ['/image-generation/confirmation.js', ['text/javascript; charset=utf-8', 'confirmation.js']],
  ].map(([route, [type, file]]) => [route, { type, body: readFileSync(new URL(file, import.meta.url)) }]));
  return async (req, res, origin) => {
    if (!req.url?.startsWith('/image-generation')) return false;
    const url = new URL(req.url, origin);
    const reply = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }); res.end(body); };
    const json = (code, value) => reply(code, 'application/json; charset=utf-8', JSON.stringify(value));
    const navigation = req.method === 'GET' && url.pathname === '/image-generation' && req.headers['sec-fetch-site'] === 'same-site' &&
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== origin.slice(7) || req.headers.origin && req.headers.origin !== origin ||
        req.headers['x-agent-call'] !== undefined || req.headers['x-agent-token'] !== undefined ||
        req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']) && !navigation) {
      req.resume(); json(403, { ok: false, error: 'IMAGE_REQUEST_REFUSED' }); return true;
    }
    if (req.method === 'GET' && assets.has(url.pathname) && !url.search) {
      const asset = assets.get(url.pathname); reply(200, asset.type, asset.body); return true;
    }
    const operation = url.pathname.slice('/image-generation/api/'.length), definition = definitions.get(operation);
    if (!url.pathname.startsWith('/image-generation/api/') || !definition || req.method !== definition[0]) {
      req.resume(); json(404, { ok: false, error: 'IMAGE_ROUTE_NOT_FOUND' }); return true;
    }
    if (req.headers['x-qq-local-action'] !== '1') { req.resume(); json(403, { ok: false, error: 'IMAGE_REQUEST_REFUSED' }); return true; }
    let valid = false;
    try {
      let input = {};
      if (url.search) throw 0;
      if (req.method === 'POST') {
        const size = Number(req.headers['content-length']);
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] ||
            !Number.isSafeInteger(size) || size < 2 || size > 16384) throw 0;
        const chunks = []; let length = 0;
        try {
          for await (const chunk of req) { length += chunk.length; if (length > size) throw 0; chunks.push(Buffer.from(chunk)); }
          if (length !== size) throw 0;
          input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        } finally { for (const chunk of chunks) chunk.fill(0); }
        const fields = operation === 'apply' ? ['expectedRevision', 'settings', 'apiKey'] : ['expectedRevision'];
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key)) ||
            !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw 0;
        if (operation === 'apply') {
          if (!settingsObject(input.settings)) throw 0; // 供应商语义由主桥接的权威校验器执行，代理不加载原生媒体模块。
          if (Object.hasOwn(input, 'apiKey') && (typeof input.apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(input.apiKey))) throw 0;
        } else if (Object.keys(input).length !== 1) throw 0;
      }
      valid = true;
      const value = await requestImage(operation, input);
      if (Object.hasOwn(input, 'apiKey')) input.apiKey = '';
      if (value.ok === false) json(400, { ok: false, error: IMAGE_GENERATION_API_ERRORS.includes(value.error) ? value.error : 'IMAGE_OPERATION_REJECTED' });
      else json(200, { ok: true, generation: projectImageGeneration(value.generation) });
    } catch { req.resume(); json(valid ? 503 : 400, { ok: false, error: valid ? 'IMAGE_MANAGEMENT_UNAVAILABLE' : 'IMAGE_INPUT_INVALID' }); }
    return true;
  };
}
