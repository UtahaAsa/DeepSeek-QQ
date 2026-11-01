import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { nativeMethod } from './manual-login.mjs';
import { isPrivateIp, resolveSafeAddresses } from '../../bridge/src/safe-fetch.js';
import { SENSITIVE_RE } from '../../bridge/src/sensitive.js';

const own = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
const fail = (code, submitted = false) => Object.assign(new Error(code), { code, submitted });
const targets = Object.freeze({ auth: ['ssl.ptlogin2.qq.com', '/jump'],
  publish: ['user.qzone.qq.com', '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6'] });
const rights = Object.freeze({ self: 64, friends: 4, public: 1 });
const cookieValue = value => typeof value === 'string' && /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{8,2048}$/.test(value);
const dayAt = time => Math.floor((time + 8 * 3600000) / 86400000);
export const DEFAULT_QZONE_SETTINGS = Object.freeze({ enabled: false, audience: 'self', cooldownMinutes: 120, dailyLimit: 3 });
export const QZONE_PUBLIC_ERROR_CODES = Object.freeze(['QZONE_BUSY', 'QZONE_NOT_ALLOWED', 'QZONE_CONTENT_REFUSED',
  'QZONE_CLOCK_INVALID', 'QZONE_LIMIT', 'QZONE_PREPARATION_FAILED', 'QZONE_OUTCOME_UNKNOWN']);

/**
 * 规范化操作员的账号级说说设置，不允许模型选择可见范围或收件人。
 * @param {object} value enabled布尔，audience为self/friends/public；冷却5~1440分钟，每日1~20次。
 * @returns {object} 冻结副本，缺省关闭且仅自己可见；未知字段、访问器或异常值抛QZONE_SETTINGS_INVALID。
 * @note 纯函数，无凭据、网络和文件I/O；当前核心仅支持原创纯文字，不接图片路径或URL。
 */
export function normalizeQzoneSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_QZONE_SETTINGS, key))) throw fail('QZONE_SETTINGS_INVALID');
  const result = { ...DEFAULT_QZONE_SETTINGS };
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('QZONE_SETTINGS_INVALID');
    result[key] = descriptor.value;
  }
  if (typeof result.enabled !== 'boolean' || typeof result.audience !== 'string' || !Object.hasOwn(rights, result.audience)
      || !Number.isSafeInteger(result.cooldownMinutes)
      || result.cooldownMinutes < 5 || result.cooldownMinutes > 1440 || !Number.isSafeInteger(result.dailyLimit)
      || result.dailyLimit < 1 || result.dailyLimit > 20) throw fail('QZONE_SETTINGS_INVALID');
  return Object.freeze(result);
}

/**
 * 固定QQ授权/说说域名的HTTPS传输；不接受代理、重定向或其它目标。
 * @param {object} options resolveHost/request仅供隔离测试；正式解析全部公网地址后固定一个地址，保留TLS证书校验。
 * @returns {function} request(stage,url,{body,cookie,signal,beforeRequest,beforeSubmit})。
 * @note 固定GET授权、POST发布；响应最多256KiB，失败仅固定错误，无原始URL/正文/凭据出站。
 */
export function createQzoneTransport({ resolveHost = resolveSafeAddresses, request = https.request } = {}) {
  return (stage, rawUrl, { body, cookie, signal, beforeRequest, beforeSubmit } = {}) => new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(rawUrl);
      if (!Object.hasOwn(targets, stage) || url.protocol !== 'https:' || url.hostname !== targets[stage][0]
          || url.pathname !== targets[stage][1] || url.port || url.username || url.password || url.hash
          || typeof beforeRequest !== 'function' || stage === 'publish' && (typeof beforeSubmit !== 'function'
            || !Buffer.isBuffer(body) || body.length > 16384 || typeof cookie !== 'string' || /[\r\n]/.test(cookie))
          || stage === 'auth' && (body !== undefined || cookie !== undefined)) throw 0;
    } catch { reject(fail('QZONE_TRANSPORT_REFUSED')); return; }
    let req, response, timer, done = false, submitted = false, length = 0, chunks = [];
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { req?.destroy(); response?.destroy(); for (const chunk of chunks) chunk.fill(0); chunks = []; reject(fail(error, submitted)); }
      else { chunks = []; resolve(value); }
    };
    const abort = () => finish('QZONE_CANCELLED');
    if (signal?.aborted) { abort(); return; }
    timer = setTimeout(() => finish('QZONE_TRANSPORT_TIMEOUT'), 60000);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => resolveHost(url.hostname)).then(addresses => {
      if (done) return;
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(address => !net.isIP(address) || isPrivateIp(address))) {
        finish('QZONE_TRANSPORT_REFUSED'); return;
      }
      const address = addresses[0], family = net.isIP(address);
      try {
        beforeRequest();
        req = request({ protocol: 'https:', hostname: url.hostname, servername: url.hostname, port: 443,
          path: url.pathname + url.search, method: stage === 'auth' ? 'GET' : 'POST', agent: false,
          rejectUnauthorized: true, autoSelectFamily: false,
          lookup: (hostname, options, callback) => {
            if (hostname !== url.hostname) { callback(fail('QZONE_TRANSPORT_REFUSED')); return; }
            if (options?.all) callback(null, [{ address, family }]); else callback(null, address, family);
          },
          headers: stage === 'publish' ? { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': body.length } : {},
        }, value => {
          response = value;
          if (done) { response.destroy(); return; }
          response.on('error', () => finish('QZONE_TRANSPORT_FAILED'));
          response.on('aborted', () => finish('QZONE_TRANSPORT_FAILED'));
          response.on('data', bytes => {
            if (done) return;
            const chunk = Buffer.from(bytes); length += chunk.length;
            if (length > 262144) { chunk.fill(0); finish('QZONE_RESPONSE_INVALID'); return; }
            chunks.push(chunk);
          });
          response.on('end', () => {
            if (done) return;
            finish(null, { statusCode: response.statusCode,
              setCookies: stage === 'auth' ? response.headers['set-cookie'] : undefined, bytes: Buffer.concat(chunks) });
          });
        });
        req.on('error', () => finish('QZONE_TRANSPORT_FAILED'));
        if (stage === 'publish') { beforeSubmit(); submitted = true; }
        req.end(body);
      } catch { finish(submitted ? 'QZONE_TRANSPORT_FAILED' : 'QZONE_TRANSPORT_REFUSED'); }
    }, () => finish('QZONE_TRANSPORT_REFUSED'));
  });
}

/**
 * 从所属已登录账号临时取得授权并提交纯文字说说；构造不接触原生服务、凭据、网络或磁盘。
 * @param {object} options session/self来自当前会话；authorize须重验账号级发布许可并返回上下文版本；
 *   contentAllowed须执行调用方既有隐私/已知令牌审计；settings由操作员选择。transport/now/timeoutMs仅供隔离。
 * @returns {object} publish(text,{signal})/close/snapshot；只返回固定状态及服务端tid，不返回凭据/URL/正文。
 * @note 单JS线程、一个在途请求；每日次数/冷却/正文摘要去重仅当前进程内存，失败不退还预算，重启清零。
 *   POST可能已提交而没有可靠回执时熔断不重试；serverReceipt不等于空间页面实际可见性验收。
 */
export function createNativeQzonePublisher({ session, self, settings: input, authorize, contentAllowed,
  transport = createQzoneTransport(), now = Date.now, timeoutMs = 30000 }) {
  let settings = normalizeQzoneSettings(input);
  const selfUin = own(self, 'uin'), selfUid = own(self, 'uid');
  if (typeof selfUin !== 'string' || !/^[1-9]\d{0,19}$/.test(selfUin) || typeof selfUid !== 'string'
      || !/^u_[A-Za-z0-9_-]{1,128}$/.test(selfUid) || ![authorize, contentAllowed, transport, now].every(value => typeof value === 'function')
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60000) throw fail('QZONE_OPTIONS_INVALID');
  let closed = false, controller = null, uncertain = false, highWater = 0, day = null, dailyAttempts = 0, nextAttempt = 0;
  let attempts = 0, accepted = 0, rejected = 0, unknown = 0, preparationFailures = 0, phase = 'idle';
  const seen = new Set();
  function checkpoint(expected) {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || time < highWater) throw fail('QZONE_CLOCK_INVALID');
    highWater = time;
    if (closed || !settings.enabled || uncertain || controller?.signal.aborted) throw fail('QZONE_NOT_ALLOWED');
    let context;
    try { context = authorize(); } catch { throw fail('QZONE_NOT_ALLOWED'); }
    if (typeof context !== 'string' || !context || context.length > 256 || expected !== undefined && context !== expected) throw fail('QZONE_NOT_ALLOWED');
    return { time, context };
  }
  async function publish(text, { signal } = {}) {
    if (controller) throw fail('QZONE_BUSY');
    const current = checkpoint();
    if (typeof text !== 'string' || !text.isWellFormed() || !text.trim() || Array.from(text).length > 1000 || Buffer.byteLength(text) > 4000
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(text)
        || text.includes(selfUin) || text.includes(selfUid) || SENSITIVE_RE.test(text)) throw fail('QZONE_CONTENT_REFUSED');
    try { if (contentAllowed(text) !== true) throw 0; } catch { throw fail('QZONE_CONTENT_REFUSED'); }
    const date = dayAt(current.time);
    if (day === null || date > day) { day = date; dailyAttempts = 0; seen.clear(); }
    const fingerprint = createHash('sha256').update(text).digest('hex');
    if (date !== day || dailyAttempts >= settings.dailyLimit || current.time < nextAttempt || seen.has(fingerprint)) throw fail('QZONE_LIMIT');
    if (signal?.aborted) throw fail('QZONE_NOT_ALLOWED');
    const operation = new AbortController(); controller = operation; phase = 'authorizing';
    dailyAttempts++; attempts++; nextAttempt = current.time + settings.cooldownMinutes * 60000; seen.add(fingerprint);
    const abort = () => operation.abort(), timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    let submitted = false;
    async function wait(promise) {
      let cancelled;
      try {
        return await Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
          cancelled = () => reject(fail('QZONE_CANCELLED', submitted));
          if (operation.signal.aborted) cancelled(); else operation.signal.addEventListener('abort', cancelled, { once: true });
        })]);
      } finally { operation.signal.removeEventListener('abort', cancelled); }
    }
    try {
      checkpoint(current.context);
      const ticket = await wait(nativeMethod(nativeMethod(session, 'getTicketService')(), 'forceFetchClientKey')(''));
      checkpoint(current.context);
      const clientKey = own(ticket, 'clientKey'), keyIndex = own(ticket, 'keyIndex');
      if (own(ticket, 'result') !== 0 || typeof clientKey !== 'string' || !/^[\x21-\x7e]{8,2048}$/.test(clientKey)
          || typeof keyIndex !== 'string' || !/^\d{1,4}$/.test(keyIndex)) throw fail('QZONE_AUTH_UNAVAILABLE');
      const authUrl = new URL('https://ssl.ptlogin2.qq.com/jump');
      authUrl.search = new URLSearchParams({ ptlang: '1033', clientuin: selfUin, clientkey: clientKey,
        u1: 'https://h5.qzone.qq.com/qqnt/qzoneinpcqq/friend?refresh=0&clientuin=0&darkMode=0', keyindex: keyIndex }).toString();
      const auth = await wait(transport('auth', authUrl, { signal: operation.signal, beforeRequest: () => checkpoint(current.context) }));
      checkpoint(current.context);
      if (![200, 302, 303].includes(own(auth, 'statusCode'))) throw fail('QZONE_AUTH_UNAVAILABLE');
      const cookies = own(auth, 'setCookies'); let skey;
      if (!Array.isArray(cookies) || cookies.length > 32) throw fail('QZONE_AUTH_UNAVAILABLE');
      for (const entry of cookies) {
        if (typeof entry !== 'string' || entry.length > 4096) throw fail('QZONE_AUTH_UNAVAILABLE');
        const part = entry.slice(0, entry.indexOf(';') < 0 ? entry.length : entry.indexOf(';'));
        if (part.startsWith('skey=')) {
          if (skey !== undefined || !cookieValue(part.slice(5))) throw fail('QZONE_AUTH_UNAVAILABLE');
          skey = part.slice(5);
        }
      }
      if (!skey) throw fail('QZONE_AUTH_UNAVAILABLE');
      const psResponse = await wait(nativeMethod(nativeMethod(session, 'getTipOffService')(), 'getPskey')(['qzone.qq.com'], true));
      checkpoint(current.context);
      const map = own(psResponse, 'domainPskeyMap'), pskey = map instanceof Map ? Map.prototype.get.call(map, 'qzone.qq.com') : null;
      if (own(psResponse, 'result') !== 0 || !cookieValue(pskey)) throw fail('QZONE_AUTH_UNAVAILABLE');
      let hash = 5381;
      for (let index = 0; index < skey.length; index++) hash = (Math.imul(hash, 33) + skey.charCodeAt(index)) | 0;
      const publishUrl = new URL('https://user.qzone.qq.com' + targets.publish[1]); publishUrl.searchParams.set('g_tk', String(hash & 0x7fffffff));
      const body = Buffer.from(new URLSearchParams({ syn_tweet_verson: '1', paramstr: '1', con: text, feedversion: '1', ver: '1',
        ugc_right: String(rights[settings.audience]), to_sign: '0', hostuin: selfUin, code_version: '1', format: 'json',
        qzreferrer: 'https://user.qzone.qq.com/' + selfUin + '/main' }).toString());
      phase = 'publishing';
      const response = await wait(transport('publish', publishUrl, { body,
        cookie: 'p_uin=o' + selfUin + '; p_skey=' + pskey + '; skey=' + skey + '; uin=o' + selfUin,
        signal: operation.signal, beforeRequest: () => checkpoint(current.context),
        beforeSubmit: () => { checkpoint(current.context); submitted = true; } }));
      submitted = true; // 收到发布请求的响应也足以证明已经提交，不能降格成可重试的预备失败。
      const status = own(response, 'statusCode');
      if ([400, 401, 403, 429].includes(status)) { rejected++; return { outcome: 'rejected', submitted: true, serverReceipt: false, audience: settings.audience }; }
      if (status !== 200 || !Buffer.isBuffer(own(response, 'bytes')) || response.bytes.length > 262144) throw fail('QZONE_RESPONSE_INVALID', true);
      let result;
      try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)); } catch { throw fail('QZONE_RESPONSE_INVALID', true); }
      const codes = ['code', 'subcode'].filter(key => own(result, key) !== undefined).map(key => own(result, key));
      const tid = own(result, 't1_tid') ?? own(result, 'tid');
      if (codes.length && codes.every(Number.isSafeInteger) && codes.some(code => code !== 0) && tid === undefined) {
        rejected++; return { outcome: 'rejected', submitted: true, serverReceipt: false, audience: settings.audience };
      }
      if (!codes.length || !codes.every(code => code === 0) || typeof tid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tid)
          || [clientKey, skey, pskey].some(secret => tid.includes(secret))) throw fail('QZONE_RESPONSE_INVALID', true);
      accepted++; return { outcome: 'accepted', submitted: true, serverReceipt: true, audience: settings.audience, tid };
    } catch {
      if (submitted) { uncertain = true; unknown++; throw fail('QZONE_OUTCOME_UNKNOWN', true); }
      preparationFailures++; throw fail(closed || operation.signal.aborted ? 'QZONE_NOT_ALLOWED' : 'QZONE_PREPARATION_FAILED');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); controller = null; phase = uncertain ? 'unknown' : 'idle';
    }
  }
  return Object.freeze({ publish,
    /** 更新设置并撤销旧任务，预算和未知锁不重置。@param {object} value 新设置。@returns {void} 关闭后拒绝。 */
    configure(value) { if (closed) throw fail('QZONE_NOT_ALLOWED'); const next = normalizeQzoneSettings(value); controller?.abort(); settings = next; },
    close: () => { closed = true; controller?.abort(); },
    snapshot: () => ({ settings, closed, phase, busy: controller !== null, uncertain, attempts, dailyAttempts,
      accepted, rejected, unknown, preparationFailures, countersPersistAcrossRestart: false }) });
}
