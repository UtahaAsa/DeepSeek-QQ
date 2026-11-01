/// <reference types="node" />
import type {AgentRequestInit,ImageFailure} from './contracts.js';
import type {ClientRequest,IncomingMessage} from 'node:http';
/** HTTP、文件与计时器均由所属实例注入；构造无IO，响应JSON始终返回unknown。 */
export interface AgentTransportDependencies {
 readonly AbortSignal: typeof globalThis.AbortSignal; readonly Buffer: typeof globalThis.Buffer; readonly ROOT: string;
 readonly URL: typeof globalThis.URL; readonly clearTimeout: typeof globalThis.clearTimeout; readonly setTimeout: typeof globalThis.setTimeout;
 readonly fetch: typeof globalThis.fetch; readonly fs: Pick<typeof import('node:fs'),'readFileSync'>;
 readonly path: Pick<typeof import('node:path'),'join'>; readonly http: Pick<typeof import('node:http'),'request'>;
 readonly getConfig: () => {consolePort?: unknown; consoleToken?: unknown};
 readonly getOneBotConfig: () => {httpUrl: string; token?: string};
 readonly projectImageGenerationError: (code: unknown, details?: unknown) => ImageFailure;
}
interface ApiEnvelope {ok?: unknown; error?: unknown;}
interface OnebotEnvelope {status?: unknown; retcode?: unknown; wording?: unknown; data?: unknown;}
/** 桥接及兼容HTTP传输；每次请求重新读取鉴权，长轮询保持独立超时。
 * @param {object} deps 实例配置读取器、HTTP与计时器；构造不发起请求。
 * @returns {object} 原有API操作；异常和业务错误保持原传播规则。
 */
export function createAgentTransport(deps: AgentTransportDependencies) {
  const { AbortSignal, Buffer, ROOT, URL, clearTimeout, fetch, fs, getConfig, getOneBotConfig, http, path, projectImageGenerationError, setTimeout } = deps;


  // 说明：本文件曾经有一对 escapeCqText() / messageSegments()，用于在 MCP 侧构造消息段。
  // 它们从来没有被任何工具调用（发送一律走桥接的 /api/send/*，由桥接统一构造文本段并做
  // CQ 转义，见 bridge.js 的 onebotSend），属于"看起来在防护、实际是死代码"的假安全。
  // 这里直接删除，避免以后有人以为 MCP 侧还有一道 CQ 转义而放松桥接那一层。

  async function onebot(action: string, params: Record<string,unknown> = {}): Promise<unknown> {
    const { httpUrl, token } = getOneBotConfig();
    const res = await fetch(`${httpUrl}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      const hint = res.status === 426 ? '；HTTP 426 通常表示 httpUrl 指向了 WebSocket 端口，请检查 config.json 的 onebot.httpUrl 是否为兼容HTTP地址' : '';
      throw new Error(`HTTP ${res.status}${hint}`);
    }
    const body = await res.json() as OnebotEnvelope;
    if (body.status !== 'ok' || body.retcode !== 0) {
      throw new Error(`OneBot ${action} 失败: retcode=${body.retcode} ${body.wording ?? ''}`);
    }
    return body.data;
  }


  // 桥接控制台/内部 Agent API 访问：二代仿真模式的状态工具都通过这里读写桥接内存态。
  function agentApiBase() {
    const port = Number(getConfig().consolePort) || 3100;
    return `http://127.0.0.1:${port}`;
  }

  function readConsoleToken() {
    // 每次请求都重新读取，优先 config.json 里的 consoleToken，其次 state/console-token，
    // 避免 token 变化后 MCP 仍使用启动时缓存的旧值导致一直 401。
    //
    // 必须与桥接的校验口径**完全一致**（bridge.js 的 startConsoleServer：长度 16~128、
    // 只允许 [A-Za-z0-9_-]，不合法就忽略并回退 state/console-token）。否则用户手填一个
    // 短令牌时桥接会正常运行，而 MCP 拿着这个桥接根本不认的值去请求 —— 每个工具都 401，
    // 且错误信息里看不出原因是"config.json 里的令牌格式不合法"。
    try {
      const c = getConfig();
      const configured = String(c.consoleToken ?? '').trim();
      if (/^[A-Za-z0-9_-]{16,128}$/.test(configured)) return configured;
    } catch { }
    try {
      const tokenFile = path.join(ROOT, 'state', 'console-token');
      return fs.readFileSync(tokenFile, 'utf8').trim();
    } catch {
      return '';
    }
  }


  /**
   * 把桥接返回的 `error` 变成可读文本。
   *
   * 为什么必须有：桥接个别分支会回一个**对象**（例如 `{code, message}`），直接
   * `new Error(obj)` 会把它 String 成 "[object Object]" —— 模型和运维都读不到任何信息。
   * r3 的已知未修项里就记着 `qq_wait_for_messages` 出现过 `error: "\"Error: [object Object]\""`。
   */
  function errorText(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      try {
        const text = JSON.stringify(value);
        if (text && text !== '{}') return text.slice(0, 500);
      } catch { }
      const message = (value as Record<string,unknown>).message ?? (value as Record<string,unknown>).msg ?? (value as Record<string,unknown>).error;
      if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500);
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return fallback;
  }


  async function agentApi(path: string, init: AgentRequestInit = {}): Promise<unknown> {
    const timeoutMs = init.timeoutMs || 15000;
    const { timeoutMs: _omit, ...rest } = init;
    const headers = agentHeaders(rest.headers);
    const res = await fetch(`${agentApiBase()}${path}`, { ...rest, headers, signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (path === '/api/images/generate' && (!res.ok || (body as ApiEnvelope | null)?.ok === false)) {
      const { error: code, ...details } = projectImageGenerationError((body as ApiEnvelope | null)?.error, body);
      throw Object.assign(new Error(code), { code, ...details });
    }
    if (!res.ok) {
      throw new Error(errorText((body as ApiEnvelope | null)?.error, `桥接 API HTTP ${res.status}`));
    }
    // 桥接的部分端点会用 200 + {ok:false,error} 表达业务失败（例如发送被审计拦截）。
    // 不检查 body.ok 会把「被拦截」当成「发送成功」上报给模型 —— 模型据此认为消息已发出，
    // 于是不再重试也不告诉用户，是典型的静默错误。
    if (body && typeof body === 'object' && (body as ApiEnvelope).ok === false) {
      throw new Error(errorText((body as ApiEnvelope).error, '桥接 API 返回 ok:false（未说明原因）'));
    }
    return body;
  }


  /**
   * 桥接 API 请求头（含控制台令牌、x-agent-call 与调用方附加头）。
   * 拆出来是为了长轮询通道复用同一套鉴权，避免两条通路口径漂移。
   */
  function agentHeaders(extra: Record<string,string> = {}): Record<string,string> {
    const consoleToken = readConsoleToken();
    const headers: Record<string,string> = {
      'content-type': 'application/json',
      ...(consoleToken ? { 'x-console-token': consoleToken } : {}),
      ...(extra ?? {})
    };
    // 声明「这是一次智能体调用」。桥接据此把「没带会话令牌」判定为**拒绝**，而不是
    // 退化成「管理端全权」——所以这个头绝不能随 token 一起被省略。历史上 331/355/379/877
    // 行用 `...(token ? {headers:{...}} : {})` 把整个头省掉了，于是「模型漏传 token」
    // 不是被拒绝，反而提权成控制台权限（confused deputy）。
    // 令牌本身仍然只在真有时才发：/api/status 的模式探测（legacyReadToolAllowed）本来就是
    // 无令牌调用，桥接对它单独放行并按最小对象返回。
    headers['x-agent-call'] = '1';
    return headers;
  }


  /**
   * 长轮询专用 POST（`node:http`，不经过 undici）。
   *
   * 为什么必须单独一条：Node 的全局 `fetch` 是 undici，自带 300 秒 `headersTimeout`。
   * 而 `qq_wait_for_messages` 的常规用法就是 `timeoutMs=300000` 的沉睡前观察 ——
   * 客户端会在第 301 秒以 `fetch failed / Headers Timeout Error` 断掉，桥接侧的
   * 长轮询却还在跑满自己的预算：AI 拿不到结果只能重试，而 `activeWaits` 仍占着会话
   * （重新等待被 429），于是空转烧 token（见 issue #24）。`node:http` 没有默认响应超时，
   * 超时完全由这里的计时器按调用方预算控制。
   */
  function agentApiLongPoll(path: string, init: AgentRequestInit = {}): Promise<unknown> {
    const timeoutMs = Math.max(1000, Number(init.timeoutMs) || 15000);
    const url = new URL(`${agentApiBase()}${path}`);
    const body = init.body == null ? '' : String(init.body);
    const headers: Record<string,string|number> = agentHeaders(init.headers);
    headers['content-length'] = Buffer.byteLength(body);
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let req: ClientRequest | undefined;
      let res: IncomingMessage | undefined;
      const finish = (error: unknown, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        const error = new Error(`等待超时（${Math.round(timeoutMs / 1000)}s）`);
        finish(error);
        req?.destroy(error);
        res?.destroy();
      }, timeoutMs);
      timer.unref?.();
      try {
        req = http.request({
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: init.method || 'GET',
          headers,
          timeout: 0
        }, (response) => {
          res = response;
          const chunks: Uint8Array[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            if (settled) return;
            size += chunk.length;
            // 桥接的 wait 响应本来就是小 JSON；超过 4MB 说明对端异常，别把内存吃光。
            if (size > 4 * 1024 * 1024) {
              finish(new Error('等待响应体过大，已中止'));
              response.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', (error) => finish(error));
          response.on('aborted', () => finish(new Error('等待响应中断')));
          response.on('close', () => { if (!response.complete) finish(new Error('等待响应中断')); });
          response.on('end', () => {
            if (settled) return;
            let parsed: unknown = null;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { parsed = null; }
            const status = response.statusCode || 0;
            if (status < 200 || status >= 300) {
              finish(new Error(errorText((parsed as ApiEnvelope | null)?.error, `桥接 API HTTP ${status}`)));
              return;
            }
            if (parsed && typeof parsed === 'object' && (parsed as ApiEnvelope).ok === false) {
              finish(new Error(errorText((parsed as ApiEnvelope).error, '桥接 API 返回 ok:false（未说明原因）')));
              return;
            }
            finish(null, parsed);
          });
        });
        req.on('error', (error) => finish(error));
        req.end(body);
      } catch (error) {
        finish(error);
        req?.destroy();
      }
    });
  }
  return { onebot, agentApiBase, readConsoleToken, errorText, agentApi, agentHeaders, agentApiLongPoll };
}
