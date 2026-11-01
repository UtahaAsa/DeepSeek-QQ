/// <reference types="node" />
import type {IncomingMessage, ServerResponse} from 'node:http';
/** 守卫只检查方法和原始HTTP头，不把头字段当成已经验证的身份。 */
export type ConsoleRequestHead = Pick<IncomingMessage,'method'|'headers'>;
export type ConsoleRequestInput = Pick<IncomingMessage,'url'|'method'|'headers'|'on'|'pause'>;
export type ConsoleResponse = Pick<ServerResponse,'writeHead'|'end'>;
/** 仅顶层通过JSON对象校验，字段仍须业务入口转换与校验。 */
export type ConsoleJsonBody = Record<string,unknown>;
export type ConsoleTimer = ReturnType<typeof setTimeout> | number;
/** 数字句柄用于既有隔离时钟，真实宿主仍使用Node定时器。 */
export interface ConsoleRequestOptions {
  port: number; setTimer?: (callback: () => void, delay: number) => ConsoleTimer;
  clearTimer?: (timer: ConsoleTimer) => void;
}
/** 单次响应与流读取能力；readBody拒绝时带原有statusCode，不推断字段结构。 */
export interface ConsoleRequestContext {
  url: URL; SECURITY_HEADERS: Record<string,string>;
  sendJson: (value: unknown, status?: number) => void;
  readBody: () => Promise<ConsoleJsonBody>; sendError: (error: unknown) => void;
}
/** 业务路由仍须由宿主先运行访问守卫；类型本身不授予访问权限。 */
export type ConsoleRouteContext = Pick<ConsoleRequestContext,'url'|'readBody'|'sendJson'> & {req: ConsoleRequestHead};
export type ConsoleRouteHandler = (context: ConsoleRouteContext) => Promise<boolean>;
/** 仅描述旧错误输出所访问的属性，不宣称已验证任意抛出值。 */
interface ErrorFields {statusCode?: unknown; message?: unknown;}
/**
 * 创建单次控制台请求的解析、JSON响应和错误响应能力。
 * @param {object} req Node请求对象；读取请求体时才注册流事件。
 * @param {object} res Node响应对象。
 * @param {object} options port为配置端口；setTimer/clearTimer仅供隔离测试时钟。
 * @returns {object|null} 地址无效时已响应400并返回null；否则提供url、headers、sendJson、readBody、sendError。
 * @note 请求体最多1000000字节，观察期限30秒；空体返回对象，非法JSON/数组/标量拒绝。
 */
export function createConsoleRequest(req: ConsoleRequestInput,res: ConsoleResponse,{port,setTimer=setTimeout,clearTimer=clearTimeout}: ConsoleRequestOptions): ConsoleRequestContext | null {
  let url;
  try { url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`); }
  catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'Connection': 'close' });
    res.end(JSON.stringify({ ok: false, error: '无效的请求地址' }));
    return null;
  }
  const SECURITY_HEADERS = {
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
  const sendJson = (obj: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
    res.end(JSON.stringify(obj, null, 2));
  };
  const readBody = (): Promise<ConsoleJsonBody> => new Promise((resolve, reject) => {
    const MAX_BODY_BYTES = 1_000_000;
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    let bodyTimer: ConsoleTimer | null = null;
    const fail = (status: number, message: string) => {
      if (settled) return;
      settled = true;
      if (bodyTimer) clearTimer(bodyTimer);
      const err: Error & {statusCode?: number} = new Error(message);
      err.statusCode = status;
      reject(err);
    };
    const done = (val: ConsoleJsonBody) => {
      if (settled) return;
      settled = true;
      if (bodyTimer) clearTimer(bodyTimer);
      resolve(val);
    };
    // 提前按 Content-Length 拒绝超限请求体
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      fail(413, '请求体过大（超过 1MB）');
      return;
    }
    bodyTimer = setTimer(() => fail(400, '请求体读取超时'), 30000);
    req.on('data', (c: Buffer | Uint8Array | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (total > MAX_BODY_BYTES) {
        req.pause();
        fail(413, '请求体过大（超过 1MB）');
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      const data = Buffer.concat(chunks).toString('utf8');
      if (!data.trim()) { done({}); return; }
      let parsed: unknown;
      try { parsed = JSON.parse(data); } catch { fail(400, '请求体必须是合法 JSON'); return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail(400, '请求体必须是 JSON 对象');
        return;
      }
      done(parsed as ConsoleJsonBody);
    });
    // 请求体超限/连接异常时也要结束等待，避免 handler 悬挂
    req.on('error', () => fail(400, '请求体读取失败'));
    req.on('aborted', () => fail(400, '请求体读取中断'));
  });

  const sendError=(error: unknown)=>{
    const status=Number((error as ErrorFields | null)?.statusCode)||500;
    sendJson({ok:false,error:(error as ErrorFields | null)?.message??String(error)},status);
  };
  return {url,SECURITY_HEADERS,sendJson,readBody,sendError};
}
