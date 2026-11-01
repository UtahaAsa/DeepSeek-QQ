/// <reference types="node" />
/// <reference path="../types/js-yaml.d.ts" />
/** YAML结构仅在既有kind/version/base64/长度检查处分辨；不在模块加载时读取凭据。 */
interface CredentialDocument {records?:Record<string,{kind?:unknown;payload?:{version?:unknown;secret?:unknown}}> ;}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import YAML from 'js-yaml';
/** DSH home：凭据文件与（历史）启动日志都在这里。 */
export function resolveDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/**
 * 自动发现 DSH 的进程启动 token（新版 DSH 把它打印在 `dsh web` 的 URL 上）。
 *
 * 注意：0.1.7 的启动 token 由 processLaunchToken() 现场生成（32 字节随机数，
 * 只存在内存 WeakMap 里，**不落盘、不可推导**），所以「读日志」这条路只有
 * 在启动器把 `dsh web` 的 stdout 重定向到文件时才成立。guard 退役后
 * boot-guard.ps1 不再写 ~/.dsh/guard/logs/server-*.out.log，日志里剩下的是
 * **旧进程的陈旧 token**，拿它换 Cookie 只会得到 401。
 * 因此这里只是最后的兜底，主路径是 {@link discoverDshSessionCookie}。
 *
 * 查找顺序：环境变量 DSH_LAUNCH_TOKEN → DSH_HOME/logs（新启动器）→
 * DSH_HOME/guard/logs（guard 时代的历史日志，按时间从新到旧）。
 */
export function discoverDshLaunchToken() {
  const fromEnv = process.env.DSH_LAUNCH_TOKEN;
  if (typeof fromEnv === 'string' && /^[A-Za-z0-9_-]{16,}$/.test(fromEnv)) return fromEnv;
  const home = resolveDshHome();
  // DSH_HOME/logs 是退役 guard 之后约定的启动日志位置；guard/logs 保留兼容。
  const dirs = [path.join(home, 'logs'), path.join(home, 'guard', 'logs')];
  for (const logsDir of dirs) {
    let files;
    try {
      files = fs.readdirSync(logsDir)
        .filter((name) => /^server-.*\.(?:out\.)?log$/.test(name))
        .map((name) => ({ name, mtime: fs.statSync(path.join(logsDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      continue;
    }
    for (const { name } of files) {
      try {
        const text = fs.readFileSync(path.join(logsDir, name), 'utf8');
        const match = text.match(/[?&]token=([A-Za-z0-9_-]+)/);
        if (match) return match[1];
      } catch {
        // 单个日志文件可能正被 DSH 占用/轮转，跳过继续看更早的日志。
      }
    }
  }
  return '';
}

// ── 浏览器会话 Cookie 铸造（不依赖进程启动 token）────────────────────────────
// 背景：进程启动 token 是现生成、只在内存里的随机数，进程一重启就失效，且只有
// 「启动器记了 stdout 日志」时才能被发现——DSH 每升一次级、启动方式每变一次，
// 这条链路就要重新适配一次。
//
// DSH 另有一份**持久化**的会话签名密钥：credentials 里的
// `client-connection/browser-session`（32 字节，首次生成后长期不变）。浏览器
// Cookie 就是用它做 HMAC 签名的，服务端校验（dsh-client-connection 的
// isAuthenticated）只要求：
//   · cookie 名 = 'dsh-auth-' + base64url(sha256(authority))
//   · payload.authority === authority（Host 头，例如 127.0.0.1:3080）
//   · issuedAt <= now < expiresAt 且 expiresAt - issuedAt <= cookieMaxAgeDays（默认 30 天）
// 所以本机同用户进程可以**离线铸造**一个合法 Cookie，完全绕开启动 token。
// 权限没有提升：桥接本来就用启动 token 换到同等会话权限，这里只是换了一条
// 不依赖「启动器有没有记日志」的路。签名密钥不可用时返回空串，调用方回退到
// 启动 token 交换。
export const BROWSER_SESSION_KEY = 'client-connection/browser-session';

const COOKIE_PAYLOAD_VERSION = 1;

const COOKIE_PREFIX = 'dsh-auth-';

const SECRET_BYTES = 32;

/** 铸造 Cookie 的有效期：远小于 DSH 默认上限（30 天），够用且留足余量。 */
export const MINTED_COOKIE_LIFETIME_MS = 60 * 60 * 1000;

/** 到期前多久主动重铸。铸造是纯本地 HMAC（无网络往返），提前换比撞 401 再重试便宜。 */
export const MINTED_COOKIE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const base64url = (buffer:Uint8Array) => Buffer.from(buffer).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/**
 * 读取 DSH 持久化的浏览器会话签名密钥。
 * @returns 32 字节密钥；文件缺失/被占用/结构不符时返回 null（调用方回退）。
 */
export function readBrowserSessionSecret() {
  try {
    const doc = YAML.load(fs.readFileSync(path.join(resolveDshHome(), '.credentials.yaml'), 'utf8')) as CredentialDocument|null;
    const record = doc?.records?.[BROWSER_SESSION_KEY];
    if (record?.kind !== 'grant' || record?.payload?.version !== 1) return null;
    const secret = record.payload.secret;
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]+$/.test(secret)) return null;
    const decoded = Buffer.from(secret.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
    // 长度必须正好 32 字节；否则说明 DSH 换了密钥方案，宁可回退也不发坏 Cookie。
    return decoded.byteLength === SECRET_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * 用签名密钥为指定 DSH 地址铸造一个会话 Cookie。
 * @param baseUrl - DSH 基址；其 authority（host:port）会绑定进 Cookie 名与签名载荷。
 * @param secret - {@link readBrowserSessionSecret} 返回的密钥。
 * @param options.lifetimeMs - Cookie 有效期。
 * @returns 可直接放进 Cookie 头的 `name=value` 串。
 */
export function mintBrowserSessionCookie(baseUrl:unknown, secret:import('node:crypto').BinaryLike, { lifetimeMs = MINTED_COOKIE_LIFETIME_MS } = {}) {
  const authority = new URL(String(baseUrl)).host;
  if (!authority) throw new Error('DSH baseUrl has no authority');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + lifetimeMs;
  const body = base64url(Buffer.from(JSON.stringify({
    version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt
  }), 'utf8'));
  const signature = base64url(createHmac('sha256', secret).update(body).digest());
  const name = COOKIE_PREFIX + base64url(createHash('sha256').update(authority).digest());
  return `${name}=v1.${body}.${signature}`;
}

/**
 * 一步到位：为本机 DSH 铸造会话 Cookie。
 * @returns Cookie 串；密钥不可用时返回 ''（调用方回退到启动 token 交换）。
 */
export function discoverDshSessionCookie(baseUrl:unknown, options?:{lifetimeMs?:number}) {
  const secret = readBrowserSessionSecret();
  if (!secret) return '';
  try {
    return mintBrowserSessionCookie(baseUrl, secret, options);
  } catch {
    return '';
  }
}

/**
 * baseUrl 是否指向本机回环地址。
 *
 * 用途：DSH 的 launch token 是进程启动凭据，换 Cookie 时必须放进 URL 查询串，
 * 一旦发往非回环地址就等于把凭据交给中途的任何一环（代理日志、抓包、对端记录）。
 * 所以默认只允许回环，远程部署需要显式 opt-in。
 */
export function isLoopbackBase(baseUrl:unknown) {
  try {
    const u = new URL(String(baseUrl));
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '::1' || host === '[::1]') return true;
    // 127.0.0.0/8 整个网段都是回环
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}
