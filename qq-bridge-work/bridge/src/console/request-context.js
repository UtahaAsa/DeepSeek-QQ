// Generated from console/request-context.ts. Edit the TypeScript source and run build:typed.
/**
 * 创建单次控制台请求的解析、JSON响应和错误响应能力。
 * @param {object} req Node请求对象；读取请求体时才注册流事件。
 * @param {object} res Node响应对象。
 * @param {object} options port为配置端口；setTimer/clearTimer仅供隔离测试时钟。
 * @returns {object|null} 地址无效时已响应400并返回null；否则提供url、headers、sendJson、readBody、sendError。
 * @note 请求体最多1000000字节，观察期限30秒；空体返回对象，非法JSON/数组/标量拒绝。
 */
export function createConsoleRequest(req, res, { port, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let url;
    try {
        url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    }
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
    const sendJson = (obj, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
        res.end(JSON.stringify(obj, null, 2));
    };
    const readBody = () => new Promise((resolve, reject) => {
        const MAX_BODY_BYTES = 1_000_000;
        const chunks = [];
        let total = 0;
        let settled = false;
        let bodyTimer = null;
        const fail = (status, message) => {
            if (settled)
                return;
            settled = true;
            if (bodyTimer)
                clearTimer(bodyTimer);
            const err = new Error(message);
            err.statusCode = status;
            reject(err);
        };
        const done = (val) => {
            if (settled)
                return;
            settled = true;
            if (bodyTimer)
                clearTimer(bodyTimer);
            resolve(val);
        };
        // 提前按 Content-Length 拒绝超限请求体
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
            fail(413, '请求体过大（超过 1MB）');
            return;
        }
        bodyTimer = setTimer(() => fail(400, '请求体读取超时'), 30000);
        req.on('data', (c) => {
            if (settled)
                return;
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
            if (settled)
                return;
            const data = Buffer.concat(chunks).toString('utf8');
            if (!data.trim()) {
                done({});
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(data);
            }
            catch {
                fail(400, '请求体必须是合法 JSON');
                return;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                fail(400, '请求体必须是 JSON 对象');
                return;
            }
            done(parsed);
        });
        // 请求体超限/连接异常时也要结束等待，避免 handler 悬挂
        req.on('error', () => fail(400, '请求体读取失败'));
        req.on('aborted', () => fail(400, '请求体读取中断'));
    });
    const sendError = (error) => {
        const status = Number(error?.statusCode) || 500;
        sendJson({ ok: false, error: error?.message ?? String(error) }, status);
    };
    return { url, SECURITY_HEADERS, sendJson, readBody, sendError };
}
