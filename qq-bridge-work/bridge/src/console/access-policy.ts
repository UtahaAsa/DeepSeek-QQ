import type {ConsoleRequestHead, ConsoleResponse, ConsoleRequestContext} from './request-context.js';
/** 每次调用取得当前策略，不固定暂停、开关、模式或令牌。 */
export interface ConsoleAgentPolicy {paused: boolean; enabled?: unknown; currentMode: string;}
export interface ConsoleAccessDependencies {
  readonly getPort: () => number; readonly getToken: () => string | null | undefined;
  readonly getAgentPolicy: () => ConsoleAgentPolicy;
  readonly isLiveAgentToken: (token: string) => boolean;
  readonly isNativeFeatureRoute: (method: string | undefined, pathname: string) => boolean;
}
type RequestAccessContext = Pick<ConsoleRequestContext,'url'|'SECURITY_HEADERS'|'sendJson'>;
type AgentAccessContext = Pick<ConsoleRequestContext,'url'|'sendJson'>;
import crypto from 'node:crypto';
/**
 * 构造控制台统一访问检查，所有业务路由必须先经过两层守卫。
 * @param {object} options getPort/getToken/getAgentPolicy每次读取当前状态，支持实际端口及令牌热更新。
 * isLiveAgentToken与isNativeFeatureRoute由所属桥接提供，不持有会话对象。
 * @returns {object} allowRequest/allowAgentRequest返回是否允许继续；false时已发送原有错误响应。
 * @note 同步检查；不读取请求体、不写盘，不启动HTTP服务；会话目标权限仍由业务入口核验。
 */
export function createConsoleAccess({getPort,getToken,getAgentPolicy,isLiveAgentToken,isNativeFeatureRoute}: ConsoleAccessDependencies) {
  function allowRequest(req: ConsoleRequestHead,res: ConsoleResponse,{url,SECURITY_HEADERS,sendJson}: RequestAccessContext): boolean {
    const consoleToken=getToken();
    // 浏览器会自动请求 /favicon.ico，且**不带控制台令牌**。若让它落到下面的鉴权分支，
    // 每次打开控制台都会在 DevTools 里留一条 401 噪音（离线预览 fixture 早已用 204 处理，
    // 真实服务端此前与自己的 fixture 行为不一致）。这里在任何鉴权之前直接 204 收掉。
    if (req.method === 'GET' && (url.pathname === '/favicon.ico' || url.pathname === '/apple-touch-icon.png')) {
      res.writeHead(204, SECURITY_HEADERS);
      res.end();
      return false;
    }
    // Host 头校验（DNS rebinding 硬化）：控制台只监听 127.0.0.1，因此合法请求的 Host
    // 只可能是 127.0.0.1 / localhost / [::1] 加本端口。攻击者用一个 TTL=0 的域名解析到
    // 127.0.0.1 时，浏览器会把 evil.com:3100 当作同源，Origin 校验随之失效；卡住 Host
    // 这一层后，这类请求在进入任何业务分支之前就被拒掉。
    // 反代/端口转发场景会被一并拒绝——这是有意的（要远程访问请用 SSH 隧道并自行承担）。
    const hostHeader = String(req.headers.host ?? '');
    // 用**实际绑定端口**而不是配置值：测试夹具用 consolePort: 0 让系统分配端口，
    // 配置里那个 0 不是请求里的 Host 端口。请求必然发生在 listen 之后，所以这里拿得到。
    const boundPort = getPort();
    const allowedHosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`];
    if (!allowedHosts.includes(hostHeader.toLowerCase())) {
      sendJson({ ok: false, error: `Host 头不被允许（${hostHeader || '缺失'}）：控制台只接受本机回环访问` }, 403);
      return false;
    }
    // 控制台鉴权：所有请求需带 x-console-token 或 ?token=
    // 定长比较：`!==` 会在第一个不同的字符处短路，理论上可被本机进程用响应时延逐字节试探。
    // 令牌是 192 bit 随机值且只监听回环，所以这是纵深防御而非在野漏洞。
    const suppliedToken = String(url.searchParams.get('token') ?? req.headers['x-console-token'] ?? '');
    const tokenMatches = (() => {
      if (!consoleToken) return false; // 上面已拒绝空令牌；真出现也只许失败关闭，绝不 return true
      const a = Buffer.from(suppliedToken, 'utf8');
      const b = Buffer.from(consoleToken, 'utf8');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    })();
    if (!tokenMatches) {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
        res.end('<!doctype html><meta charset="utf-8"><title>需要令牌</title><script>const t=prompt(\'请输入控制台访问令牌\');if(t)location.href=\'/?token=\'+encodeURIComponent(t);</script>');
      } else {
        sendJson({ ok: false, error: '未授权：请提供控制台访问令牌' }, 401);
      }
      return false;
    }
    // 智能体调用隔离（集中关卡）。
    //
    // 背景：控制台令牌是「管理端全权」，会话令牌是「只能动自己这个会话」。MCP 工具进程
    // 两者都持有，所以「这次请求到底是智能体发的还是管理端发的」必须由请求自己声明。
    // 各端点用 `if (x-agent-token && !agentTokenOk(...))` 做会话绑定校验，但那个写法在
    // **头缺失时整条跳过** —— 而头缺失恰恰是模型没传 token 时的自然结果
    // （旧版 mcp-qq-native.js 用 `...(token ? {...} : {})` 直接省略了这个头）。
    // 于是「漏传令牌」不是被拒绝，而是**升级成控制台全权**：典型的 confused deputy。
    //
    // 现在 MCP 端一律带上 x-agent-call: 1；带了令牌就必须命中某个活跃会话，
    // 端点自己漏写校验也不会退回管理端。
    //
    // 但「没带令牌」的智能体调用不能一律拒绝：closed-agent（管理员私聊）模式下模型
    // 本来就**没有**会话令牌（令牌只在 reserved2 的唤醒提示里下发），而 qq_send_group_message
    // / qq_list_groups 等工具必须在这个模式里可用（工具描述写的也是"closed-agent 模式不需要"）。
    // 这些端点各自按模式判定（/api/send/* 只在 closed-agent 放行；/api/images/* 在 reserved2
    // 强制要令牌；/api/status 对智能体调用只回最小对象），所以这里把「无令牌智能体调用」
    // 限制到这条非 v2 会话面；整个 /api/socialV2/ 前缀一概不放——那里的 token 校验全是
    // `if (x-agent-token && …)`，放进来就等于退化成管理端全权（confused deputy）。
    if (req.headers['x-agent-call'] !== undefined) {
      const agentToken = req.headers['x-agent-token'];
      const hasToken = typeof agentToken === 'string' && agentToken !== '';
      if (hasToken && !isLiveAgentToken(agentToken)) {
        sendJson({ ok: false, error: '未授权：智能体调用携带的会话令牌无效' }, 403);
        return false;
      }
      if (!hasToken) {
        const tokenlessAgentAllowed = url.pathname === '/api/status'
          || url.pathname.startsWith('/api/send/')
          || url.pathname.startsWith('/api/images/') || isNativeFeatureRoute(req.method, url.pathname);
        if (!tokenlessAgentAllowed) {
          sendJson({ ok: false, error: '未授权：该接口的智能体调用必须携带有效的会话令牌' }, 403);
          return false;
        }
      }
    }
    // CSRF 防护：所有写操作必须是 application/json，且（若带 Origin）必须来自本机页面。
    // 默认未配 consoleToken 时，这可阻止任意网页用表单/跨站请求触发
    // /api/restart、/api/workspace/reset、/api/role 等破坏性接口。
    if (req.method !== 'GET') {
      const ctype = String(req.headers['content-type'] ?? '');
      if (!ctype.toLowerCase().includes('application/json')) {
        sendJson({ ok: false, error: '请求必须是 application/json' }, 415);
        return false;
      }
      const origin = req.headers['origin'];
      if (origin) {
        let originHost = '';
        try { originHost = new URL(String(origin)).host; } catch {}
        if (![`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`].includes(originHost)) {
          sendJson({ ok: false, error: '跨站请求被拒绝' }, 403);
          return false;
        }
      }
    }

    return true;
  }
  function allowAgentRequest(req: ConsoleRequestHead,{url,sendJson}: AgentAccessContext): boolean {
    const {paused,enabled,currentMode}=getAgentPolicy();
    // 空 agent token 一律拒绝，防止 MCP 传入空字符串时被当作“管理端/无 token”绕过校验
    if (req.headers['x-agent-token'] === '') {
      sendJson({ ok: false, error: 'agent token 不能为空' }, 403);
      return false;
    }
    // 暂停二代 AI 时，所有带 agent token 的 v2 工具调用一律拒绝
    if (paused && req.headers['x-agent-token'] && (url.pathname.startsWith('/api/socialV2/') || url.pathname.startsWith('/api/send/') || url.pathname.startsWith('/api/images/'))) {
      sendJson({ ok: false, error: 'AI 已暂停，当前不允许执行 v2 工具' }, 403);
      return false;
    }
    // 二代模式总开关：关闭后 agent token 调用的 v2 工具全部拒绝（控制台仍可管理）
    if (enabled === false && req.headers['x-agent-token'] && (url.pathname.startsWith('/api/socialV2/') || url.pathname.startsWith('/api/send/') || url.pathname.startsWith('/api/images/'))) {
      sendJson({ ok: false, error: '二代模式已关闭，当前不允许执行 v2 工具' }, 403);
      return false;
    }
    // 模式隔离：带 agent token 的 v2 接口只允许在 reserved2 模式下使用
    if (req.headers['x-agent-token'] && url.pathname.startsWith('/api/socialV2/') && currentMode !== 'reserved2') {
      sendJson({ ok: false, error: '该接口仅 reserved2 模式可用' }, 403);
      return false;
    }
    // 管理端专用 v2 接口：带 agent token 的请求一律拒绝，防止 MCP 工具越权访问控制台功能
    // /api/socialV2/initial-prompt 也在这里：它是操作者写给 AI 的"环境背景"，
    // 让 AI 自己读/改等于把控制台的管理输入（以及未来可能写入的其它群信息）交给会话主体。
    const adminOnlyV2Paths = ['/api/socialV2/config', '/api/socialV2/activity', '/api/socialV2/reset', '/api/socialV2/states', '/api/socialV2/wake', '/api/socialV2/initial-prompt'];
    if (req.headers['x-agent-token'] && (adminOnlyV2Paths.includes(url.pathname) || (url.pathname === '/api/socialV2/feedback' && req.method === 'GET') || (url.pathname === '/api/socialV2/tool-log' && req.method === 'GET'))) {
      sendJson({ ok: false, error: '该接口仅控制台可用' }, 403);
      return false;
    }
    // 表情库管理接口只允许控制台（带 agent token 的 v2 工具一律拒绝，防止越权改库）
    if (req.headers['x-agent-token'] && (url.pathname === '/api/stickers' || url.pathname.startsWith('/api/stickers/'))) {
      sendJson({ ok: false, error: '该接口仅控制台可用' }, 403);
      return false;
    }
    // agent token 默认拒绝：MCP 的 v2 工具同时携带 x-console-token 与 x-agent-token，
    // 因此仅靠控制台令牌挡不住 AI。这里改成白名单：只有 AI 真正需要的面放行，
    // 其余（人格/提示词/思考强度/白名单/重启…）一律 403——避免以后新增管理端点时忘记拉黑。
    if (req.headers['x-agent-token']) {
      const agentAllowed = url.pathname === '/api/status'
        || url.pathname.startsWith('/api/socialV2/')
        || url.pathname.startsWith('/api/send/')
        || url.pathname.startsWith('/api/images/')
        || url.pathname === '/api/authorize/read';
      if (!agentAllowed) {
        sendJson({ ok: false, error: '该接口仅控制台可用' }, 403);
        return false;
      }
    }

    return true;
  }
  return Object.freeze({allowRequest,allowAgentRequest});
}
