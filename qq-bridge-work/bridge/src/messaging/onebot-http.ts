/// <reference types="node" />
/** 返回原OneBot信封，data仍未知，具体消费者按原规则解析。 */
export interface OnebotHttpResponse {status?:unknown;retcode?:unknown;wording?:unknown;data?:unknown;}
export interface OnebotHttpDependencies {readonly cfg:{onebot?:{httpUrl?:unknown;accessToken?:unknown}};readonly fetch:typeof globalThis.fetch;readonly AbortSignal:typeof globalThis.AbortSignal;}
/** @param deps 实时端点与HTTP能力；构造无请求。@returns 固定超时的兼容动作请求，错误沿原路径传播，不重试。 */
export function createOnebotHttp(deps:OnebotHttpDependencies) {
async function onebotHttpAction(action:string, params:unknown = {}, { timeoutMs = 15000 } = {}) {
    const httpUrl = String(deps.cfg.onebot?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const res = await (0, deps.fetch)(`${httpUrl}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(deps.cfg.onebot?.accessToken ? { authorization: `Bearer ${deps.cfg.onebot.accessToken}` } : {})
      },
      body: JSON.stringify(params ?? {}),
      signal: deps.AbortSignal.timeout(timeoutMs)
    });
    const body = await res.json().catch(() => ({})) as OnebotHttpResponse;
    if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
      const hint = res.status === 426 ? '（HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口）' : '';
      throw new Error(`OneBot HTTP ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
    }
    return body;
  }
return {onebotHttpAction};
}
