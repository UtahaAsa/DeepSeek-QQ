import type {NamedConsoleRoutes} from './contracts.js';
/** 顶层配置已由宿主验证，嵌套安全配置沿原有结构假设合并。 */
export interface SecurityConfiguration {security?: Record<string,unknown>; consoleToken?: unknown;}
interface LegacySecurityFile extends Record<string,unknown> {security?: Record<string,unknown>;}
export type SecurityLifecycleRoutes = NamedConsoleRoutes<'getSecurity'|'postSecurity'|'postConsoleToken'|'postAuthorizeRead'|'postRestart'>;
/** 同步保存与释放顺序保持不变；类型不代表已执行ACL收紧或令牌轮换。 */
export interface SecurityLifecycleDependencies<Configuration extends SecurityConfiguration> {
  readonly cfg: Configuration; stateDirHardened: boolean | null; consoleToken: string;
  readonly STATE_DIR: string; readonly ROOT: string; readonly currentMode: string;
  readonly process: {platform: string; exit: (code: number) => unknown};
  readonly manualDirCommand: (directory: string) => string; readonly hardenStateDirAcl: () => void;
  readonly path: {join: (...parts: string[]) => string}; readonly readConfigObject: (file: string) => Record<string,unknown>;
  readonly atomicWriteJson: (file: string, value: Record<string,unknown>) => void;
  readonly atomicWriteText: (file: string, value: string) => void;
  readonly crypto: {randomBytes: (size: number) => {toString: (encoding: 'hex') => string}};
  readonly log: (...values: unknown[]) => void; readonly agentTokenOk: (key: string, token: string) => boolean;
  readonly modeAllowed: (key: string, kind: string, id: number, cfg: Configuration, mode: string) => boolean;
  readonly setTimeout: (callback: () => void, delay: number) => unknown;
  readonly saveState: () => void; readonly saveSocialV2State: () => void; readonly releaseLock: () => void;
}
/**
 * security-lifecycle功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：cfg, stateDirHardened, STATE_DIR, process, manualDirCommand, hardenStateDirAcl, path, ROOT, readConfigObject, atomicWriteJson, log, crypto, atomicWriteText, consoleToken, agentTokenOk, modeAllowed, currentMode, setTimeout, saveState, saveSocialV2State, releaseLock。
 */
export function createSecurityLifecycleRoutes<Configuration extends SecurityConfiguration>(deps: SecurityLifecycleDependencies<Configuration>): SecurityLifecycleRoutes {
  return {
    getSecurity: {
      matches: (req, url) => req.method === 'GET' && url.pathname === '/api/security',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        sendJson({
          security: deps.cfg.security ?? { interceptNotify: true },
          // state/ 的 ACL 收紧结果：Windows 上改 ACL 需要管理员权限，未提权时会失败。
          // 控制台据此显示警告与可复制的命令（而不是让用户以为已经安全）。
          // 命令必须取自 state-acl 的**安全**版本：把 (OI)(CI) 授权和 /T 混在一句里
          // 会把子文件 DACL 清空，用户照抄就会把自己的 state/ 弄坏。
          stateDir: {
            hardened: deps.stateDirHardened,
            path: deps.STATE_DIR,
            manualCommand: deps.process.platform === 'win32'
              ? (0, deps.manualDirCommand)(deps.STATE_DIR)
              : `chmod 700 "${deps.STATE_DIR}"`
          }
        });
        return;

      }
    },
    postSecurity: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/security',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        // 支持从控制台**重试**收紧 state/ 权限（用户在管理员终端里配好了权限/换了启动方式后）。
        if (body.rehardenStateDir === true) {
          deps.stateDirHardened = null;
          (0, deps.hardenStateDirAcl)();
          sendJson({ ok: deps.stateDirHardened === true, hardened: deps.stateDirHardened, path: deps.STATE_DIR });
          return;
        }
        const configFile = deps.path.join(deps.ROOT, 'config.json');
        const file = (0, deps.readConfigObject)(configFile) as LegacySecurityFile;
        const next = { ...(file.security ?? {}), ...body };
        if (typeof next.interceptNotify === 'boolean') next.interceptNotify = next.interceptNotify;
        else if (next.interceptNotify !== undefined) next.interceptNotify = Boolean(next.interceptNotify);
        file.security = next;
        (0, deps.atomicWriteJson)(configFile, file);
        deps.cfg.security = { ...(deps.cfg.security ?? {}), ...next };
        (0, deps.log)(`控制台：安全拦截通知已更新（interceptNotify=${deps.cfg.security.interceptNotify}）`);
        sendJson({ ok: true, security: deps.cfg.security });
        return;

      }
    },
    postConsoleToken: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/console/token',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        let newToken = String(body.token ?? '').trim();
        const generated = !newToken;
        if (generated) {
          newToken = deps.crypto.randomBytes(24).toString('hex');
        }
        if (newToken.length < 16) {
          sendJson({ ok: false, error: '控制台访问令牌至少需要 16 位；留空可生成随机令牌' }, 400);
          return;
        }
        if (newToken.length > 128) {
          sendJson({ ok: false, error: '控制台访问令牌不能超过 128 位' }, 400);
          return;
        }
        if (!/^[A-Za-z0-9_-]+$/.test(newToken)) {
          sendJson({ ok: false, error: '控制台访问令牌只能包含字母、数字、下划线或短横线' }, 400);
          return;
        }
        const configFile = deps.path.join(deps.ROOT, 'config.json');
        const file = (0, deps.readConfigObject)(configFile) as LegacySecurityFile;
        // 手动令牌写入 config.json（用户可见、可再改）；随机令牌写入 state/console-token 并清空 config 中的手动值。
        file.consoleToken = generated ? '' : newToken;
        (0, deps.atomicWriteJson)(configFile, file);
        deps.cfg.consoleToken = generated ? '' : newToken;
        (0, deps.atomicWriteText)(deps.path.join(deps.STATE_DIR, 'console-token'), newToken);
        deps.consoleToken = newToken;
        (0, deps.log)(`控制台：访问令牌已${generated ? '重新生成' : '手动修改'}（不记录完整值）`);
        sendJson({ ok: true, token: newToken, generated });
        return;

      }
    },
    postAuthorizeRead: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/authorize/read',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const key = String(body.key ?? '').trim();
        const token = String(body.token ?? '').trim();
        const keyMatch = /^(group|private):(\d+)$/.exec(key);
        if (!keyMatch) { sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400); return; }
        if (!token || !(0, deps.agentTokenOk)(key, token)) {
          // 空 token 一律拒绝：该端点对 agent 流量开放（见 startConsoleServer 里的
          // agent 白名单），而 MCP 的 agentApi 总是带着真实控制台令牌，
          // 所以「不传 token 就跳过校验」等于把它变成免鉴权端点。
          sendJson({ ok: false, error: token ? 'agent token 无效' : '缺少会话令牌；旧只读工具在需要令牌的模式下不可用，请改用带会话令牌的 v2 读工具' }, 403);
          return;
        }
        const kind = keyMatch[1];
        const id = Number(keyMatch[2]);
        if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
          sendJson({ ok: false, error: '当前模式不允许读取该会话' }, 403);
          return;
        }
        sendJson({ ok: true, key });
        return;

      }
    },
    postRestart: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/restart',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        sendJson({ ok: true, message: '正在重启桥接（若由守护窗口启动，5 秒后自动恢复）…' });
        (0, deps.setTimeout)(() => {
          (0, deps.log)('控制台：重启桥接');
          // 退出前落盘：SIGINT/SIGTERM 的收尾路径会 saveState()/saveSocialV2State()，
          // 而重启这条路径以前直接 process.exit，500ms 窗口内改动的唤醒配置/计数器会丢。
          try { (0, deps.saveState)(); } catch (error) { (0, deps.log)('重启前保存会话映射失败:', (error as {message?: unknown} | null)?.message ?? error); }
          try { (0, deps.saveSocialV2State)(); } catch (error) { (0, deps.log)('重启前保存二代会话状态失败:', (error as {message?: unknown} | null)?.message ?? error); }
          (0, deps.releaseLock)();
          deps.process.exit(0);
        }, 500);
        return;

      }
    }
  };
}
