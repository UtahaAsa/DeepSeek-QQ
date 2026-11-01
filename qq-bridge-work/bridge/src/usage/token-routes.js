// Generated from usage/token-routes.ts. Edit the TypeScript source and run build:typed.
/**
 * 用量账本的控制台接口，不改变累计、计价和持久化算法。
 * @param {object} options ledger为所属账本；getSymbol读取当前货币符号；log记录显式重置。
 * @returns {function(object):Promise<boolean>} 已处理为true；非用量路径为false；账本错误由宿主处理。
 * @note 调用前须完成统一鉴权。智能体令牌额外拒绝；构造无IO，只有POST reset调用账本重置。
 */
export function createTokenRoutes({ ledger: tokenLedger, getSymbol, log }) {
    return async function handleTokenRoute({ req, url, sendJson }) {
        if (url.pathname === '/api/tokens/summary' || url.pathname.startsWith('/api/tokens/')) {
            if (req.headers['x-agent-token']) {
                sendJson({ ok: false, error: '该接口仅控制台可用' }, 403);
                return true;
            }
            if (req.method === 'GET' && url.pathname === '/api/tokens/summary') {
                const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
                sendJson({ ...tokenLedger.summary({ limit }), ledger: tokenLedger.stats() });
                return true;
            }
            if (req.method === 'GET' && url.pathname === '/api/tokens/series') {
                const hours = Math.min(24 * 90, Math.max(1, Number(url.searchParams.get('hours')) || 24));
                const maxBuckets = Math.min(120, Math.max(6, Number(url.searchParams.get('buckets')) || 48));
                sendJson(tokenLedger.series({ hours, maxBuckets }));
                return true;
            }
            if (req.method === 'GET' && url.pathname === '/api/tokens/turns') {
                const key = String(url.searchParams.get('key') ?? '').trim();
                const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 200));
                const detail = tokenLedger.conversation(key, { turnLimit: limit });
                if (!detail) {
                    sendJson({ ok: false, error: '未找到该会话的用量记录' }, 404);
                    return true;
                }
                sendJson(detail);
                return true;
            }
            if (req.method === 'GET' && url.pathname === '/api/tokens/recent') {
                const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 50));
                sendJson({ ok: true, symbol: getSymbol(), entries: tokenLedger.recent(limit) });
                return true;
            }
            if (req.method === 'POST' && url.pathname === '/api/tokens/reset') {
                tokenLedger.reset();
                log('控制台：token 用量账本已重置');
                sendJson({ ok: true });
                return true;
            }
            sendJson({ ok: false, error: 'not found' }, 404);
            return true;
        }
        return false;
    };
}
