// QQ工作台host；保留qq-mode命名空间，并提供独立browser/client管理页面。
//
// 浏览器使用DSH公开main/sidebar.panellist及configForms接口；host使用已鉴权的
// Connection Fetch路由与所属父进程IPC。不修改DSH内核，不在DSH进程加载QQ。
//
// ⚠️ DSH 0.2.0 起，命名空间**不再需要注册**。
//   0.1.x 有 `ctx.settings.register(ns, schema, opts)`；0.2.0 已经删掉它，
//   `SettingsForms` 的公开面只剩 configure / writable / documentPath /
//   prepareDocument / describe / update / replace / mutate。命名空间改为
//   **从 profile 的 loader entry 推导**（dsh-settings 的
//   `configEditor.configuration()` → `ns: entry.options.id`），一个命名空间要能被
//   读写，只需要：
//     ① 存在一个 loader entry，其 **id 恰好等于命名空间名** —— 见 cordis.patch.yml
//        的 `id: qq-mode`（不是 `qq-mode-console`）；
//     ② 该 entry 的插件模块导出 `Config`（schema 读的就是 fiber.runtime.Config）；
//     ③ `Config` 里至少有一个字段带 `volatile` 标记。
//   这些条件只说明命名空间可定位。真实热改还要求使用宿主提供的Volatile运行时；
//   保存文件成功不能证明当前配置值已更新。schema-runtime.js明确复用固定宿主版本。
import fs from 'node:fs';
import path from 'node:path';
import z from './schema-runtime.js';
import { createWorkspaceSchema } from './workspace-schema.js';
import { createWorkspaceIpc, createWorkspaceFetch } from './workspace-host.js';

// 诊断日志写系统临时目录，**不要**按相对层级往上爬。
//
// 历史坑：这里曾经是 path.join(__dirname, '..', '..', '..', 'state', ...)。
// 插件是以 `link:<DSH_HOME>/plugins/qq-mode-console` 装进 profile 的，往上是
// <DSH_HOME>/..，于是在任何非作者机器上都会在用户主目录旁凭空拉出一个 state/ 目录，
// 只有作者机器上恰好指回仓库时才"看起来正常"。可用 QQ_MODE_DIAG 覆盖路径（空字符串=关闭）。
const DIAG = process.env.QQ_MODE_DIAG ?? '';

function diag(msg) {
  if (!DIAG) return;
  try {
    fs.mkdirSync(path.dirname(DIAG), { recursive: true });
    fs.appendFileSync(DIAG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

export const name = 'qq-mode-console';
// 命名空间属于 settings seam：声明依赖让 entry 等 settings 就绪后再 activate。
export const inject = ['settings'];

export const QQMODE_NAMESPACE = 'qq-mode';

/**
 * 独立的 schema（历史遗留：0.1.x 的 `settings.register()` 需要它）。
 * 现在**不参与** DSH 的 settings 定位（那用的是下面导出的 `Config`），
 * 但仓库里的静态测试会用它验证非法 mode 被拒绝，故保留。
 */
export const QqModeSchema = z.object({
  // `simulation` 是规范名（QSH_PLAN.md §2.1），`chat`/`reserved`/`reserved2` 是历史拼写。
  // 两者都必须能被**存进设置**：桥接在输入侧把它们归一到同一个内部值（见 bridge.js 的
  // MODE_INPUT_ALIASES），但这里如果只列历史名，用户在 DSH 设置里写 `simulation` 会被
  // schema 直接拒掉，而 schema 校验失败会把整个命名空间一起打掉 —— 连 ownerQQ 都读不到，
  // 桥接只能回退本地 mode.json 且**没有任何提示**。默认值保持 `reserved2`（不改变现有用户行为）。
  mode: z.union([
    z.const('chat'), z.const('closed-agent'), z.const('reserved'), z.const('reserved2'), z.const('simulation')
  ]).default('reserved2'),
  ownerQQ: z.string().description('管理员 QQ（ownerQQ）；留空表示不通过 DSH 设置覆盖 config.json'),
});

/**
 * 这个插件**作为 loader entry 的 Config** 暴露出去的模式设置。
 *
 * 为什么必须有它、而且字段必须带 `volatile`：
 *   DSH 定位 settings 命名空间的方式（0.1.7 起成立，0.2.0 更加是唯一路径）是
 *   （dsh-settings/lib/index.js）：
 *       const entry = configEditor.entries().find((row) => row.options.id === ns);
 *       const schema = entry?.fiber?.runtime?.Config;
 *       if (!entry || !schema) throw new Error(`No configurable plugin entry "${ns}"`);
 *       const form = volatileForm(schema);   // 只保留 meta.volatile 的字段，否则抛
 *                                            // "Plugin entry ... has no volatile fields"
 *   也就是说，一个命名空间要能被**写入**，必须同时满足三点：
 *     ① 存在一个 loader entry，其 **id 恰好等于命名空间名** —— 所以 cordis.patch.yml 里
 *        这条 entry 的 id 是 `qq-mode`（不是 `qq-mode-console`）；
 *     ② 该 entry 的插件模块导出了 `Config`（schema(entry) 读的就是 fiber.runtime.Config）；
 *     ③ `Config` 里至少有一个字段带 `volatile` 标记。
 *   0.1.5 时代只有 `ctx.settings.register()`，而 entry id 与命名空间不同名 —— 于是桥接的
 *   「模式写穿 DSH 设置」永远抛 `No configurable plugin entry "qq-mode"`：模式只在本地生效，
 *   下一次 DSH 轮询就把它覆盖回滚（只在有人从控制台改模式时才会暴露）。
 *   这里补齐 ②③；① 在 cordis.patch.yml。
 *
 * `.extra('volatile', true)`声明热字段。宿主3.18.5会把它解析为真正的Volatile引用。
 * 桥接自带3.18.1只能保留标记，不能据此更新运行值；本模块不使用那份解析器。
 * Config字段的.get()及固定DSH中的保存/刷新/应用由隔离测试分别核验。
 */
export const Config = z.object({
  workspaceEnabled: z.boolean().default(false).extra('volatile', true),
  workspace: createWorkspaceSchema(),
  mode: z.union([
    z.const('chat'), z.const('closed-agent'), z.const('reserved'), z.const('reserved2'), z.const('simulation')
  ]).default('reserved2').extra('volatile', true),
  ownerQQ: z.string().description('管理员 QQ（ownerQQ）；留空表示不通过 DSH 设置覆盖 config.json').extra('volatile', true),
});

/**
 * 装配自定义工作台的Host通道并同步已保存偏好；命名空间仍由entry id和Config推导。
 * @param {object} ctx DSH插件上下文；Connection负责owner认证，webServer提供真实监听来源。
 * @returns {void} 效果由所属fiber释放，不修改DSH内核；宿主退出时撤销待定IPC请求。
 * @note 隐藏本entry自动生成页以保留唯一编辑入口；不自动登录QQ或调用模型。
 */
export function apply(ctx) {
  diag(`apply called; settings service=${typeof ctx.settings}; namespace=${QQMODE_NAMESPACE} (0.2.0: no registration needed)`);
  // 只隐藏本插件的自动生成页，全部编辑入口由QQ工作台持有。
  if (typeof ctx.effect === 'function' && typeof ctx.settings?.configure === 'function') {
    ctx.effect(() => ctx.settings.configure({ auto: false }));
  }
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['connection', 'webServer'], child => {
    const ipc = createWorkspaceIpc();
    child.effect(() => () => ipc.close());
    const character = fs.readFileSync(new URL('../client/companion.png', import.meta.url));
    if (character.length > 3 * 1024 * 1024 || character.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('WORKSPACE_CHARACTER_REFUSED');
    // 固定角色原图只走所属DSH的owner认证，不接收任意文件名或外部资源地址。
    child.effect(() => child.connection.fetch.register({ path: '/api/qq-workspace-character', methods: ['GET'], requestBody: 'buffered', fetch: input => {
      if (input.headers.has('x-agent-call') || input.headers.has('x-agent-token')
          || input.headers.get('origin') && input.headers.get('origin') !== child.webServer.getOrigin()
          || input.headers.get('sec-fetch-site') && input.headers.get('sec-fetch-site') !== 'same-origin') return new Response(null, { status: 403 });
      return new Response(character, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
    } }));
    // 素材固定白名单；继续由Connection完成owner认证，禁止模型和跨源调用。
    for (const name of ['hero', 'navigation', 'background']) {
      const artwork = fs.readFileSync(new URL('../client/' + name + '.png', import.meta.url));
      if (artwork.length > 8 * 1024 * 1024 || artwork.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('WORKSPACE_ART_REFUSED');
      child.effect(() => child.connection.fetch.register({ path: '/api/qq-workspace-art/' + name, methods: ['GET'], requestBody: 'buffered', fetch: input => {
        if (input.headers.has('x-agent-call') || input.headers.has('x-agent-token')
            || input.headers.get('origin') && input.headers.get('origin') !== child.webServer.getOrigin()
            || input.headers.get('sec-fetch-site') && input.headers.get('sec-fetch-site') !== 'same-origin') return new Response(null, { status: 403 });
        return new Response(artwork, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
      } }));
    }
    child.effect(() => child.connection.fetch.register({ path: '/api/qq-workspace', methods: ['POST'], requestBody: 'buffered',
      fetch: createWorkspaceFetch({ request: ipc.request,
        origin: () => child.webServer.getOrigin(),
        describe: () => ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === QQMODE_NAMESPACE) }) }));
    child.effect(() => {
      let disposed = false, inFlight = false, lastRevision = -1;
      const synchronize = async () => {
        if (disposed || inFlight) return;
        const view = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === QQMODE_NAMESPACE);
        if (!view || view.value?.workspaceEnabled !== true || view.revision === lastRevision) return;
        inFlight = true;
        try {
          await ipc.request('apply', { revision: view.revision, settings: view.value.workspace });
          lastRevision = view.revision;
        } catch { /* Parent未就绪时保留设置，下次重试；不输出载荷。 */ }
        finally { inFlight = false; }
      };
      const timer = setInterval(() => { void synchronize(); }, 1000); timer.unref(); void synchronize();
      return () => { disposed = true; clearInterval(timer); };
    });
  });
}

