import type {ConsoleRouteContext} from '../console/request-context.js';
/** 路由只透传同步账本结果，不重复定义计价算法或内部采样结构。 */
export interface TokenRoutePayload {readonly ok: boolean;}
/** 同步统计切片；其余统计字段继续原样传递到响应。 */
export interface TokenRouteLedgerStats {readonly file: string; readonly samples: number; readonly sessions: number;}
/** 查询必须同步返回数据；reset完成才响应，不接受未等待的Promise。 */
export interface TokenRouteLedger {
  readonly summary: (options: {limit: number}) => TokenRoutePayload;
  readonly stats: () => TokenRouteLedgerStats;
  readonly series: (options: {hours: number; maxBuckets: number}) => TokenRoutePayload;
  readonly conversation: (key: string, options: {turnLimit: number}) => TokenRoutePayload | null;
  readonly recent: (limit: number) => readonly unknown[];
  readonly reset: () => undefined;
}
/** 只读取当前货币符号；鉴权仍由宿主和原有agent令牌拦截共同负责。 */
export interface TokenRouteDependencies {
  readonly ledger: TokenRouteLedger; readonly getSymbol: () => unknown; readonly log: (message: string) => void;
}
export type TokenRouteContext = Pick<ConsoleRouteContext,'req'|'url'|'sendJson'>;
export type TokenRouteHandler = (context: TokenRouteContext) => Promise<boolean>;
/**
 * 用量账本的控制台接口，不改变累计、计价和持久化算法。
 * @param {object} options ledger为所属账本；getSymbol读取当前货币符号；log记录显式重置。
 * @returns {function(object):Promise<boolean>} 已处理为true；非用量路径为false；账本错误由宿主处理。
 * @note 调用前须完成统一鉴权。智能体令牌额外拒绝；构造无IO，只有POST reset调用账本重置。
 */
export function createTokenRoutes<Value>({ledger:tokenLedger,getSymbol,log}: TokenRouteDependencies & {getSymbol:()=>Value & (Value extends PromiseLike<unknown>?never:unknown)}): TokenRouteHandler {
  return async function handleTokenRoute({req,url,sendJson}) {
    if (url.pathname === '/api/tokens/summary' || url.pathname.startsWith('/api/tokens/')) {
      if (req.headers['x-agent-token']) { sendJson({ ok: false, error: '该接口仅控制台可用' }, 403); return true; }
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
        if (!detail) { sendJson({ ok: false, error: '未找到该会话的用量记录' }, 404); return true; }
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
