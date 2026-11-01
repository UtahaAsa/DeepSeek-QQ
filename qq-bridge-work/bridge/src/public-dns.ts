/// <reference types="node" />
import type {ClientRequest,IncomingMessage} from 'node:http';
/** 解析器仅使用这些HTTPS能力，默认实现仍为Node内建request。 */
export type PublicDnsRequest=(options:import('node:https').RequestOptions & Pick<import('node:net').TcpNetConnectOpts,'autoSelectFamily'>,onResponse:(response:IncomingMessage)=>void)=>ClientRequest;
interface PublicDnsRow {address:string;family:number;}
/** OS/隔离替身返回值在原有全量地址校验后才可用于连接。 */
export interface PublicResolverDependencies {lookup?:(hostname:string,options:{all:true;verbatim:true})=>Promise<unknown>;request?:PublicDnsRequest;}
export interface PublicResolverOptions {signal?:AbortSignal;timeoutMs?:number;}
interface DohAnswer {TTL?:unknown;name?:unknown;type?:unknown;data?:unknown;}
interface DohValue {Status?:unknown;TC?:unknown;Question?:{type?:unknown;name?:unknown}[];Answer?:DohAnswer[];}
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import { TextDecoder } from 'node:util';
import { isPublicDestinationAddress } from './public-address.js';
const fail = (code:string) => Object.assign(new Error(code), { code });
const record = (value:unknown):value is Record<string,unknown> => (value && typeof value === 'object' && !Array.isArray(value)) as boolean;
const PUBLIC_DNS_TIMEOUT_MS = 5000, PUBLIC_DOH_MAX_BYTES = 16384;
// 固定官方公共DoH及其公网引导地址；不接受模型/配置替换，不依赖本机fake-IP解析该解析器。
const publicDoh = Object.freeze({ hostname: 'cloudflare-dns.com', address: '1.1.1.1', path: '/dns-query' });
const dnsRefused = () => fail('PUBLIC_DNS_REFUSED');
const benchmarkAddress = (address:string) => {
  if (net.isIP(address) !== 4) return false;
  const parts = address.split('.').map(Number);
  return parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
};
function canonicalDnsName(value:unknown):string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 254) throw dnsRefused();
  const name = value.toLowerCase().replace(/\.$/, '');
  if (name.length > 253 || !name.includes('.') || name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')
      || net.isIP(name) || !name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw dnsRefused();
  return name;
}

/**
 * 核验固定DoH的单个A问题响应；所有答案必须属于规范CNAME链且最终地址全部公网。
 * @param {Buffer} bytes 有界UTF-8 JSON响应；不接受任意URL或供应商鉴权。
 * @param {string} hostname 当前图片请求的规范公开域名。
 * @returns {string[]} 验证后的公网IPv4地址；失败固定DNS_REFUSED，不返回响应正文。
 * @note 纯内存；不接受截断、错问题、未知记录类型、循环链、额外答案或混合私网答案。
 */
export function validatePublicDohAnswer(bytes:Buffer, hostname:string):string[] {
  try {
    const name = canonicalDnsName(hostname);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > PUBLIC_DOH_MAX_BYTES) throw 0;
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as DohValue;
    if (!record(value) || value.Status !== 0 || value.TC !== false || !Array.isArray(value.Question) || value.Question.length !== 1
        || value.Question[0]?.type !== 1 || canonicalDnsName(value.Question[0]?.name) !== name
        || !Array.isArray(value.Answer) || value.Answer.length < 1 || value.Answer.length > 64) throw 0;
    const aliases = new Map<string,string>(), addresses = new Map<string,string[]>(), owners = new Set<string>();
    for (const answer of value.Answer) {
      if (!record(answer) || !Number.isSafeInteger(answer.TTL) || (answer.TTL as number) < 0 || (answer.TTL as number) > 2147483647) throw 0;
      const owner = canonicalDnsName(answer.name); owners.add(owner);
      if (answer.type === 5) {
        const target = canonicalDnsName(answer.data);
        if (aliases.has(owner) && aliases.get(owner) !== target) throw 0;
        aliases.set(owner, target);
      } else if (answer.type === 1 && net.isIP(answer.data as string) === 4 && isPublicDestinationAddress(answer.data)) {
        if (!addresses.has(owner)) addresses.set(owner, []);
        addresses.get(owner)!.push(answer.data as string);
      } else throw 0;
    }
    let current = name; const visited = new Set();
    while (aliases.has(current)) {
      if (visited.has(current) || visited.size >= 8 || addresses.has(current)) throw 0;
      visited.add(current); current = aliases.get(current)!;
    }
    if (visited.has(current) || !addresses.has(current)) throw 0;
    visited.add(current);
    if ([...owners].some(owner => !visited.has(owner))) throw 0;
    return [...new Set(addresses.get(current))];
  } catch { throw dnsRefused(); }
}

function requestPublicDoh(hostname:string, signal:AbortSignal, request:PublicDnsRequest):Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let req:ClientRequest|undefined, response:IncomingMessage|undefined, done = false, size = 0; const chunks:Buffer[] = [];
    const finish = (error:unknown, value?:Buffer) => {
      if (done) return; done = true; signal.removeEventListener('abort', abort);
      if (error) { req?.destroy(); response?.destroy(); reject(error); } else resolve(value!);
      for (const chunk of chunks) chunk.fill(0);
    };
    const abort = () => finish(fail('PUBLIC_DNS_CANCELLED'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    try {
      req = request({ protocol: 'https:', hostname: publicDoh.hostname, port: 443, servername: publicDoh.hostname,
        path: publicDoh.path + '?name=' + encodeURIComponent(hostname) + '&type=A', method: 'GET',
        agent: false, autoSelectFamily: false, rejectUnauthorized: true,
        lookup: (host, options, callback) => {
          // Node的错误优先回调允许失败时只传error；本地声明要求成功地址，故只投影此失败调用。
          if (host !== publicDoh.hostname) { (callback as (error:Error)=>void)(dnsRefused()); return; }
          if (options?.all) callback(null, [{ address: publicDoh.address, family: 4 }]); else callback(null, publicDoh.address, 4);
        },
        headers: { Host: publicDoh.hostname, Accept: 'application/dns-json', 'Accept-Encoding': 'identity' },
      }, res => {
        response = res;
        res.on('error', () => finish(dnsRefused())); res.on('aborted', () => finish(dnsRefused()));
        res.on('close', () => { if (!res.complete) finish(dnsRefused()); });
        if (done) { res.destroy(); return; }
        const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        const length = res.headers['content-length'];
        if (res.statusCode !== 200 || !['application/dns-json', 'application/json'].includes(type)
            || String(res.headers['content-encoding'] ?? 'identity').toLowerCase() !== 'identity'
            || length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > PUBLIC_DOH_MAX_BYTES)) { finish(dnsRefused()); return; }
        res.on('data', (chunk:Buffer) => {
          if (done) return;
          size += chunk.length; if (size > PUBLIC_DOH_MAX_BYTES) { finish(dnsRefused()); return; }
          chunks.push(Buffer.from(chunk));
        });
        res.on('end', () => {
          if (done) return;
          if (length !== undefined && Number(length) !== size) { finish(dnsRefused()); return; }
          finish(null, Buffer.concat(chunks, size));
        });
      });
      req.on('error', () => finish(dnsRefused()));
      if (done) req.destroy(); else req.end();
    } catch { finish(dnsRefused()); }
  });
}

/**
 * 图片专用解析：OS结果全部为benchmark/fake-IP时才查询固定公共DoH，原fake-IP永不用于连接。
 * @param {object} options lookup/request仅供隔离替身；默认OS lookup及固定公网DoH HTTPS传输。
 * @returns {Function} (hostname,{signal,timeoutMs})返回全量核验的公网地址，IPv4优先。
 * @note 不更改全局DNS/代理，不接触供应商密钥；无缓存、不重试查询或生成POST；共享至多5秒预算。
 */
export function createPublicAddressResolver({ lookup = dns.promises.lookup, request = https.request }:PublicResolverDependencies = {}) {
  return async (hostname:string, { signal, timeoutMs = PUBLIC_DNS_TIMEOUT_MS }:PublicResolverOptions = {}):Promise<string[]> => {
    if (signal?.aborted) throw fail('PUBLIC_DNS_CANCELLED');
    const host = typeof hostname === 'string' ? hostname.toLowerCase().replace(/^\[|\]$/g, '') : '';
    if (net.isIP(host)) { if (!isPublicDestinationAddress(host)) throw dnsRefused(); return [host]; }
    const name = canonicalDnsName(host);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw dnsRefused();
    const controller = new AbortController(); let expired = false, raw:Buffer|undefined, rejectAborted!:(error:Error)=>void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
    const cancel = () => controller.abort();
    const check = () => { if (controller.signal.aborted) throw expired ? dnsRefused() : fail('PUBLIC_DNS_CANCELLED'); };
    const onAbort = () => rejectAborted(expired ? dnsRefused() : fail('PUBLIC_DNS_CANCELLED'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { expired = true; controller.abort(); }, Math.min(timeoutMs, PUBLIC_DNS_TIMEOUT_MS));
    try {
      // 这里只投影旧协议字段，紧随的原有全量校验通过前不得使用结果连接。
      const rows = await Promise.race([Promise.resolve().then(() => { check(); return lookup(name, { all: true, verbatim: true }); }), aborted]) as PublicDnsRow[];
      check();
      if (!Array.isArray(rows) || !rows.length || rows.length > 64 || rows.some(row =>
        !record(row) || typeof row.address !== 'string' || ![4, 6].includes(row.family) || net.isIP(row.address) !== row.family)) throw dnsRefused();
      if (rows.every(row => isPublicDestinationAddress(row.address)))
        return [...rows.filter(row => row.family === 4), ...rows.filter(row => row.family === 6)].map(row => row.address);
      if (!rows.every(row => benchmarkAddress(row.address))) throw dnsRefused();
      raw = await Promise.race([requestPublicDoh(name, controller.signal, request), aborted]); check();
      return validatePublicDohAnswer(raw, name);
    } catch { check(); throw dnsRefused(); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', onAbort); raw?.fill(0); }
  };
}
