/// <reference types="node" />
import type {ClientRequest,IncomingMessage} from 'node:http';
import type {PublicResolverDependencies} from './public-dns.js';
import type {ImageProviderConfig,ImageTransport,ImageTransportOptions,ImageTransportDependencies,ImageOperationOptions,ImageErrorView} from './media/image-generation-contracts.js';
interface ProviderResponse {data?:Record<string,unknown>[];}
import https from 'node:https';
import net from 'node:net';
import { isPublicDestinationAddress as publicImageAddress } from './public-address.js';
import { createPublicAddressResolver, validatePublicDohAnswer } from './public-dns.js';
import { TextDecoder } from 'node:util';
import { IMAGE_MAX_BYTES, inspectNativeImage } from '../../native-research/native-adapter/native-image-store.mjs';
import { IMAGE_PROVIDER_ERROR_CODES } from './image-generation-errors.js';
import { PUBLIC_FLUX, isPublicFlux, isPublicFluxImageUrl } from './image-provider-presets.js';
export { IMAGE_PROVIDER_ERROR_CODES } from './image-generation-errors.js';

export const IMAGE_PROVIDER_TIMEOUT_MS = 180000;
export const IMAGE_PROVIDER_JSON_LIMIT = 12 * 1024 * 1024;
const fail = (code:string, submitted = false) => Object.assign(new Error(code), { code, submitted });
const record = (value:unknown):value is Record<string,unknown> => (value && typeof value === 'object' && !Array.isArray(value)) as boolean;
const known = (value:unknown, fields:string[]):value is Record<string,unknown> => record(value) && Object.keys(value).every(key => fields.includes(key));
const IMAGE_DNS_TIMEOUT_MS = 5000;
/** 保留现有生图DNS响应校验接口；公共解析错误转换为固定生图错误码。 */
export function validateImageDohAnswer(bytes:Buffer, hostname:string):string[] {
  try { return validatePublicDohAnswer(bytes, hostname); }
  catch { throw fail('IMAGE_PROVIDER_DNS_REFUSED'); }
}
/**
 * 创建生图解析器，复用所有媒体共用的严格公网解析与全fake-IP专用DoH兼容。
 * @param {object} options 隔离测试替身；不能由模型指定解析器或目的地址。
 * @returns {Function} 返回核验后的地址；取消和失败仍使用原生图固定码，不自动重试。
 */
export function createImageAddressResolver(options:PublicResolverDependencies = {}) {
  const resolve = createPublicAddressResolver(options);
  return async (...args:Parameters<typeof resolve>) => {
    try { return await resolve(...args); }
    catch (error) { throw fail((error as ImageErrorView|null)?.code === 'PUBLIC_DNS_CANCELLED' ? 'IMAGE_PROVIDER_CANCELLED' : 'IMAGE_PROVIDER_DNS_REFUSED'); }
  };
}

function inspectGeneratedImage(bytes:Buffer) {
  const info = inspectNativeImage(bytes);
  if (!['png', 'jpeg', 'webp'].includes(info.format)) throw 0;
  // 这里只核验容器完整性和像素边界，不把元数据检查称为完整解码或视觉验收。
  if (info.format === 'png') {
    let pos = 8, ended = false, imageData = false;
    while (pos + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(pos), type = bytes.toString('ascii', pos + 4, pos + 8);
      if (size > bytes.length - pos - 12 || ['acTL', 'fcTL', 'fdAT'].includes(type)) throw 0;
      if (type === 'IDAT' && size) imageData = true;
      pos += 12 + size;
      if (type === 'IEND') { if (size || pos !== bytes.length) throw 0; ended = true; break; }
    }
    if (!ended || !imageData) throw 0;
  } else if (info.format === 'jpeg') {
    if (!bytes.subarray(-2).equals(Buffer.from([255, 217]))) throw 0;
  } else {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length || (info as typeof info & {animated?:unknown}).animated) throw 0;
    let pos = 12, imageData = false;
    while (pos + 8 <= bytes.length) {
      const size = bytes.readUInt32LE(pos + 4), type = bytes.toString('ascii', pos, pos + 4);
      if (['ANIM', 'ANMF'].includes(type) || size > bytes.length - pos - 8) throw 0;
      if (['VP8 ', 'VP8L'].includes(type) && size) imageData = true;
      pos += 8 + size + (size & 1);
    }
    if (!imageData || pos !== bytes.length) throw 0;
  }
  return info;
}

function publicUrl(value:unknown, endpoint = false) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || /[\s\x00-\x1f\x7f]/.test(value)) throw 0;
    const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !host ||
        host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
        (net.isIP(host) ? !publicImageAddress(host) : !host.includes('.')) ||
        (endpoint && (url.search || !url.pathname.endsWith('/images/generations')))) throw 0;
    return url;
  } catch { throw fail('IMAGE_PROVIDER_URL_INVALID'); }
}

/**
 * 规范化操作员选择的Images API或固定公共FLUX预设；校验不联网，不推断或替换模型。
 * @param {object} value endpoint为完整HTTPS地址；model显式指定；size/quality留空时不发送。
 *   provider省略时沿用Images API；公共FLUX仅允许固定端点、模型、1024方形和默认质量方言。
 *   responseFormat为default/b64_json/url；GPT图像接口应选择default，不发送旧参数。
 * @returns {Readonly<object>} 无凭据配置；拒绝未知字段、URL凭据、查询参数和本机地址。
 * @throws {Error} 固定IMAGE_PROVIDER_CONFIG_INVALID或IMAGE_PROVIDER_URL_INVALID，无原始输入。
 * @note 同步纯函数；不改写调用方对象。凭据不属于本配置，也不读取环境变量。
 */
export function normalizeImageProviderConfig(value:unknown):Readonly<ImageProviderConfig> {
  if (!known(value, ['provider', 'endpoint', 'model', 'size', 'quality', 'responseFormat'])) throw fail('IMAGE_PROVIDER_CONFIG_INVALID');
  if (isPublicFlux(value)) {
    if (value.endpoint !== PUBLIC_FLUX.endpoint || value.model !== PUBLIC_FLUX.model ||
        !['', PUBLIC_FLUX.size].includes((value.size ?? '') as string) || (value.quality ?? '') !== '' ||
        (value.responseFormat ?? 'default') !== 'default') throw fail('IMAGE_PROVIDER_CONFIG_INVALID');
    return PUBLIC_FLUX;
  }
  if (value.provider !== undefined && value.provider !== 'openai') throw fail('IMAGE_PROVIDER_CONFIG_INVALID');
  const endpoint = publicUrl(value.endpoint, true).href;
  if (typeof value.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value.model)) throw fail('IMAGE_PROVIDER_CONFIG_INVALID');
  const size = value.size ?? '', quality = value.quality ?? '', responseFormat = value.responseFormat ?? 'default';
  if (typeof size !== 'string' || !['', 'auto'].includes(size) && !/^[1-9]\d{1,3}x[1-9]\d{1,3}$/.test(size)) throw fail('IMAGE_PROVIDER_CONFIG_INVALID');
  if (size && size !== 'auto') {
    const [width, height] = size.split('x').map(Number);
    if (width > 8192 || height > 8192 || width * height > 40_000_000) throw fail('IMAGE_PROVIDER_CONFIG_INVALID');
  }
  if (!['', 'auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(quality as string) ||
      !['default', 'b64_json', 'url'].includes(responseFormat as string)) throw fail('IMAGE_PROVIDER_CONFIG_INVALID');
  return Object.freeze({ ...(value.provider === 'openai' ? { provider: 'openai' } : {}), endpoint, model: value.model, size, quality, responseFormat }) as Readonly<ImageProviderConfig>;
}

/**
 * 创建一次性公网HTTPS传输；不代理、不重定向、不重试，不复用带鉴权连接。
 * @param {object} options resolveHost/request仅供隔离替身；生产使用全量DNS检查和Node HTTPS。
 * @returns {Function} requestBytes(url,{method,body,apiKey,maxBytes,signal,timeoutMs,publicFlux,eventStream})返回有界Buffer。
 * @throws {Error} 固定错误；submitted表示POST已交给传输，失败后可能已产生费用，不代表成功。
 * @note 每次解析检查全部地址，再固定首个已检查地址，保留TLS主机名验证。
 *   publicFlux只接受固定官方任务/临时图像路径且拒绝密钥；eventStream只为该任务开放有界SSE。
 *   超时覆盖DNS、TLS和响应体；调用取消会销毁所属请求，不中断其它会话。
 */
export function createImageTransport({ resolveHost = createImageAddressResolver(), request = https.request }:ImageTransportDependencies = {}):ImageTransport {
  return function requestBytes(rawUrl:string, { method = 'GET', body, apiKey, maxBytes = IMAGE_MAX_BYTES,
    signal, timeoutMs = IMAGE_PROVIDER_TIMEOUT_MS, publicFlux = false, eventStream = false }:ImageTransportOptions = {}) {
    return new Promise<Buffer>((resolve, reject) => {
      let req:ClientRequest|undefined, response:IncomingMessage|undefined, timer:ReturnType<typeof setTimeout>|undefined, done = false, submitted = false, chunks:Buffer[] = [], length = 0;
      const finish = (error:string|null, value?:Buffer) => {
        if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) {
          req?.destroy(); response?.destroy();
          for (const chunk of chunks) chunk.fill(0);
          chunks = []; reject(fail(error, submitted));
        } else { chunks = []; resolve(value!); }
      };
      const abort = () => finish('IMAGE_PROVIDER_CANCELLED');
      if (signal?.aborted) { abort(); return; }
      if (!['POST', 'GET'].includes(method) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > IMAGE_PROVIDER_JSON_LIMIT ||
          !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > IMAGE_PROVIDER_TIMEOUT_MS ||
          typeof publicFlux !== 'boolean' || typeof eventStream !== 'boolean' || eventStream && (!publicFlux || method !== 'GET') ||
          method === 'POST' && (!Buffer.isBuffer(body) || body.length > 16384 ||
            (publicFlux ? apiKey !== undefined : typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey))) ||
          method === 'GET' && (body !== undefined || apiKey !== undefined)) { finish('IMAGE_PROVIDER_REQUEST_INVALID'); return; }
      let url:URL;
      try {
        url = publicUrl(rawUrl, method === 'POST' && !publicFlux);
        if (publicFlux) {
          const base = new URL(PUBLIC_FLUX.endpoint);
          const allowedPath = method === 'POST' ? url.href === PUBLIC_FLUX.endpoint
            : eventStream ? new RegExp('^/gradio_api/call/infer/[a-f0-9]{32}$').test(url.pathname)
              : isPublicFluxImageUrl(url);
          if (url.origin !== base.origin || url.search || !allowedPath) throw 0;
        }
      } catch { finish('IMAGE_PROVIDER_URL_INVALID'); return; }
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(submitted ? 'IMAGE_PROVIDER_OUTCOME_UNKNOWN' : 'IMAGE_PROVIDER_TIMEOUT'), timeoutMs);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      Promise.resolve().then(() => resolveHost(hostname, { signal, timeoutMs: Math.min(timeoutMs, IMAGE_DNS_TIMEOUT_MS) })).then(addresses => {
        if (done) return;
        if (!Array.isArray(addresses) || !addresses.length || addresses.some(address => !publicImageAddress(address))) {
          finish('IMAGE_PROVIDER_DNS_REFUSED'); return;
        }
        const address = addresses[0], family = net.isIP(address);
        try {
          req = request({ protocol: 'https:', hostname, port: url.port || 443, path: url.pathname + url.search,
            method, agent: false, autoSelectFamily: false, rejectUnauthorized: true,
            ...(net.isIP(hostname) ? {} : { servername: hostname }),
            lookup: (_hostname, options, callback) => {
              if (_hostname !== hostname) { (callback as (error:Error)=>void)(fail('IMAGE_PROVIDER_DNS_REFUSED')); return; }
              if (options?.all) callback(null, [{ address, family }]); else callback(null, address, family);
            },
            headers: { 'User-Agent': 'DeepSeek-QQ-Bridge/0.2.1 (image generation)',
              Accept: method === 'POST' ? 'application/json' : eventStream ? 'text/event-stream' : 'image/png,image/jpeg,image/webp',
              'Accept-Encoding': 'identity', ...(method === 'POST' ? { 'Content-Type': 'application/json',
                'Content-Length': body!.length, ...(!publicFlux ? { Authorization: 'Bearer ' + apiKey } : {}) } : {}) },
          }, res => {
            response = res;
            res.on('error', () => finish(submitted ? 'IMAGE_PROVIDER_OUTCOME_UNKNOWN' : 'IMAGE_PROVIDER_NETWORK_FAILED'));
            res.on('aborted', () => finish(submitted ? 'IMAGE_PROVIDER_OUTCOME_UNKNOWN' : 'IMAGE_PROVIDER_NETWORK_FAILED'));
            res.on('close', () => { if (!res.complete) finish(submitted ? 'IMAGE_PROVIDER_OUTCOME_UNKNOWN' : 'IMAGE_PROVIDER_NETWORK_FAILED'); });
            if (done) { res.destroy(); return; }
            const status = res.statusCode;
            if (status !== 200) {
              finish(status === 429 ? 'IMAGE_PROVIDER_RATE_LIMITED' : status! >= 300 && status! < 400 ? 'IMAGE_PROVIDER_REDIRECT_REFUSED'
                : status! >= 400 && status! < 500 ? 'IMAGE_PROVIDER_REJECTED' : submitted ? 'IMAGE_PROVIDER_OUTCOME_UNKNOWN' : 'IMAGE_PROVIDER_DOWNLOAD_FAILED'); return;
            }
            const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
            const encoding = String(res.headers['content-encoding'] ?? 'identity').toLowerCase();
            if ((method === 'POST' ? type !== 'application/json' : eventStream ? type !== 'text/event-stream'
              : !['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(type)) || encoding !== 'identity') {
              finish('IMAGE_PROVIDER_RESPONSE_INVALID'); return;
            }
            const declared = res.headers['content-length'];
            if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > maxBytes)) { finish('IMAGE_PROVIDER_RESPONSE_LIMIT'); return; }
            res.on('data', (chunk:Buffer) => {
              if (done) return;
              length += chunk.length;
              if (length > maxBytes) { finish('IMAGE_PROVIDER_RESPONSE_LIMIT'); return; }
              chunks.push(Buffer.from(chunk));
            });
            res.on('end', () => {
              if (declared !== undefined && Number(declared) !== length) { finish('IMAGE_PROVIDER_RESPONSE_INVALID'); return; }
              const bytes = Buffer.concat(chunks, length);
              for (const chunk of chunks) chunk.fill(0);
              finish(null, bytes);
            });
          });
          req.on('error', () => finish(submitted ? 'IMAGE_PROVIDER_OUTCOME_UNKNOWN' : 'IMAGE_PROVIDER_NETWORK_FAILED'));
          if (done) { req.destroy(); return; }
          // 保守记录：交给POST传输后，即便连接报错也不假定供应商未执行。
          submitted = method === 'POST'; req.end(body);
        } catch { finish(submitted ? 'IMAGE_PROVIDER_OUTCOME_UNKNOWN' : 'IMAGE_PROVIDER_NETWORK_FAILED'); }
      }, () => finish('IMAGE_PROVIDER_DNS_REFUSED'));
    });
  };
}

/**
 * 创建Images API或固定公共FLUX单图生成器；只生成，不负责QQ发送。
 * @param {object} options transport仅供隔离测试，不接受模型指定的下载地址或鉴权配置。
 * @returns {Function} generate(config,apiKey,prompt,{signal})返回验证过的静态PNG/JPEG/WebP字节和摘要。
 * @throws {Error} 固定错误，不回传供应商正文、修订提示词、地址或鉴权信息；失败不重试。
 * @note 每次n=1；default不发送response_format；URL结果二次校验且下载时不携带API密钥。
 */
export function createImageProvider({ transport = createImageTransport() }:{transport?:ImageTransport} = {}) {
  return async function generate(settings:unknown, apiKey:string|undefined, prompt:unknown, { signal }:ImageOperationOptions = {}) {
    const config = normalizeImageProviderConfig(settings);
    if (typeof prompt !== 'string' || !prompt.trim() || Array.from(prompt).length > 2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(prompt) ||
        (isPublicFlux(config) ? apiKey !== '' && apiKey !== undefined : typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey))) throw fail('IMAGE_PROVIDER_REQUEST_INVALID');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw fail('IMAGE_PROVIDER_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, IMAGE_PROVIDER_TIMEOUT_MS);
    let response:Buffer|undefined, image:Buffer|undefined;
    try {
      if (isPublicFlux(config)) {
        const body = Buffer.from(JSON.stringify({ data: [prompt, 20261025, false, 1024, 1024, 4] }));
        try { response = await transport(config.endpoint, { method: 'POST', body, publicFlux: true, maxBytes: 16384, signal: controller.signal }); }
        finally { body.fill(0); }
        let job:{event_id?:unknown}|null;
        try { job = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response)); } catch { throw fail('IMAGE_PROVIDER_RESPONSE_INVALID', true); }
        if (typeof job?.event_id !== 'string' || !/^[a-f0-9]{32}$/.test(job.event_id)) throw fail('IMAGE_PROVIDER_RESPONSE_INVALID', true);
        response.fill(0);
        response = await transport(config.endpoint + '/' + job.event_id, { method: 'GET', publicFlux: true, eventStream: true,
          maxBytes: 256 * 1024, signal: controller.signal });
        let completed:unknown;
        try {
          const blocks = new TextDecoder('utf-8', { fatal: true }).decode(response).replace(/\r\n/g, '\n').split('\n\n');
          for (const block of blocks) {
            const event = /^event:\s*(.*)$/m.exec(block)?.[1];
            if (event === 'error') throw fail('IMAGE_PROVIDER_REJECTED', true);
            if (event === 'complete') {
              if (completed !== undefined) throw 0;
              completed = JSON.parse(block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n'));
            }
          }
          if (!Array.isArray(completed) || completed.length !== 2 || !record(completed[0]) || typeof completed[0].url !== 'string' ||
              !Number.isSafeInteger(completed[1])) throw 0;
        } catch (error) { if ((error as ImageErrorView|null)?.code === 'IMAGE_PROVIDER_REJECTED') throw error; throw fail('IMAGE_PROVIDER_RESPONSE_INVALID', true); }
        const url = publicUrl((completed as [{url:string},unknown])[0].url);
        if (!isPublicFluxImageUrl(url)) throw fail('IMAGE_PROVIDER_URL_INVALID', true);
        image = await transport(url.href, { method: 'GET', publicFlux: true, maxBytes: IMAGE_MAX_BYTES, signal: controller.signal });
        if (controller.signal.aborted) throw fail('IMAGE_PROVIDER_CANCELLED', true);
        let info; try { info = inspectGeneratedImage(image); } catch { throw fail('IMAGE_PROVIDER_IMAGE_INVALID', true); }
        return { bytes: image, info };
      }
      const payload = { model: config.model, prompt, n: 1, ...(config.size ? { size: config.size } : {}),
        ...(config.quality ? { quality: config.quality } : {}),
        ...(config.responseFormat !== 'default' ? { response_format: config.responseFormat } : {}) };
      const body = Buffer.from(JSON.stringify(payload));
      try { response = await transport(config.endpoint, { method: 'POST', body, apiKey, maxBytes: IMAGE_PROVIDER_JSON_LIMIT, signal: controller.signal }); }
      finally { body.fill(0); }
      if (controller.signal.aborted) throw fail('IMAGE_PROVIDER_CANCELLED', true);
      let data:ProviderResponse|null;
      try {
        if (!Buffer.isBuffer(response) || response.length > IMAGE_PROVIDER_JSON_LIMIT) throw 0;
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response));
        if (!Array.isArray(data?.data) || data.data.length !== 1 || !record(data.data[0])) throw 0;
      } catch { throw fail('IMAGE_PROVIDER_RESPONSE_INVALID', true); }
      const entry = data!.data![0];
      if (typeof entry.b64_json === 'string' && entry.b64_json) {
        const encoded = entry.b64_json;
        if (encoded.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) throw fail('IMAGE_PROVIDER_RESPONSE_INVALID', true);
        image = Buffer.from(encoded, 'base64');
        if (image.toString('base64') !== encoded) throw fail('IMAGE_PROVIDER_RESPONSE_INVALID', true);
      } else if (typeof entry.url === 'string') {
        const url = publicUrl(entry.url);
        image = await transport(url.href, { method: 'GET', maxBytes: IMAGE_MAX_BYTES, signal: controller.signal });
      } else throw fail('IMAGE_PROVIDER_RESPONSE_INVALID', true);
      if (controller.signal.aborted) throw fail('IMAGE_PROVIDER_CANCELLED', true);
      let info;
      try {
        info = inspectGeneratedImage(image);
      } catch { throw fail('IMAGE_PROVIDER_IMAGE_INVALID', true); }
      return { bytes: image, info };
    } catch (error) {
      if (Buffer.isBuffer(image)) image.fill(0);
      if (IMAGE_PROVIDER_ERROR_CODES.includes((error as ImageErrorView|null)?.code as string)) throw fail((error as ImageErrorView).code as string, response !== undefined || (error as ImageErrorView).submitted === true);
      throw fail('IMAGE_PROVIDER_FAILED', true);
    } finally {
      if (Buffer.isBuffer(response)) response.fill(0);
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  };
}
