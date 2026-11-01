// Generated from messaging/onebot-http.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
/** @param deps 实时端点与HTTP能力；构造无请求。@returns 固定超时的兼容动作请求，错误沿原路径传播，不重试。 */
export function createOnebotHttp(deps) {
    async function onebotHttpAction(action, params = {}, { timeoutMs = 15000 } = {}) {
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
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
            const hint = res.status === 426 ? '（HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口）' : '';
            throw new Error(`OneBot HTTP ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
        }
        return body;
    }
    return { onebotHttpAction };
}
