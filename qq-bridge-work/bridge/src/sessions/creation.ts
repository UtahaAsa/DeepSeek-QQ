import type {ApplyResult} from '../models/session-models.js';
/** 会话映射由宿主持有；缺失的键不代表已创建会话。 */
export interface SessionRegistry {
  sessions: Record<string, string | undefined>;
  sessionPolicies: Record<string, string | undefined>;
}
/** 仅声明创建路径读取的配置；原始配置仍由宿主校验。 */
export interface SessionCreationConfiguration {
  sessionCwd?: unknown; workspaceTitle?: unknown; agentPreset?: unknown;
  socialV2?: {agentPreset?: unknown};
}
/** 创建请求必须指向已取得的工作区，预设仅在原有允许降级路径中省略。 */
export interface SessionCreateRequest { workspaceId: string; agentPreset?: string; }
interface WorkspaceCreated { created: boolean; workspace: {workspaceId: string}; }
/** 注入实时状态与RPC；unwrap只解除协议外壳，不宣称校验了未知载荷。 */
export interface SessionCreationDependencies<Configuration extends SessionCreationConfiguration = SessionCreationConfiguration> {
  readonly sessionEpoch: number; readonly currentMode: string; readonly cfg: Configuration;
  readonly STATE_DIR: string; readonly DSH_CONTROL_TIMEOUT_MS: number;
  readonly dshPresetIds: readonly string[]; readonly state: SessionRegistry;
  readonly reverse: Pick<Map<string,string>, 'set'>;
  readonly path: {join: (...parts: string[]) => string};
  readonly fs: {mkdirSync: (dir: string, options: {recursive: true}) => unknown};
  readonly api: {
    workspace: {create: (request: {path: string}) => Promise<unknown>;
      rename: (request: {workspaceId: string; title: unknown}) => Promise<unknown>;
      archiveSession: (request: {sessionId: string}) => Promise<unknown>};
    sessions: {create: (request: SessionCreateRequest) => Promise<unknown>};
    events: {follow: (sessionId: string) => void; forget?: (sessionId: string) => void};
  };
  readonly sessionPolicy: (key: string) => string;
  readonly isSessionAllowedInCurrentMode: (key: string) => boolean;
  readonly isCurrentSession: (key: string, sessionId: string) => boolean;
  readonly retireSession: (key: string) => void;
  readonly ensureChatModel: (sessionId: string) => Promise<ApplyResult>;
  readonly modePreset: (key: string, mode: string, config: Configuration) => string | null | undefined;
  readonly unwrap: (response: unknown, method: string) => unknown;
  readonly withTimeout: <T>(task: Promise<T>, timeoutMs: number, label: string) => Promise<T>;
  readonly saveState: () => void; readonly log: (message: string) => void;
}
/** 创建表操作不取消远端RPC；调用方须同时推进会话代次。 */
export interface SessionCreation {
  readonly ensure: (key: string) => Promise<string>;
  readonly forget: (key: string) => boolean; readonly clear: () => void;
}
/**
 * 管理会话复用、创建与在途任务；构造无IO，创建任务表归本实例持有。
 * @param {object} deps 实时依赖视图；getter避免模式、代次、配置在异步期间变成旧快照。
 * @returns {object|function} 所属实例的操作；错误语义与原调用方保持一致。
 * @note 不启动服务、不安装依赖。forget/clear只撤销任务表归属，不取消远端RPC；调用方仍须推进会话代次。
 */
export function createSessionCreation<Configuration extends SessionCreationConfiguration>(deps: SessionCreationDependencies<Configuration>): SessionCreation {
  const sessionPromises = new Map<string, Promise<string>>();
  async function ensureSession(key: string): Promise<string> {
    const epoch = deps.sessionEpoch;
    const policy = (0, deps.sessionPolicy)(key);
    if (!(0, deps.isSessionAllowedInCurrentMode)(key)) throw new Error(`当前模式不允许会话 ${key}`);
    const existing = deps.state.sessions[key];
    if (existing) {
      // reset/清空工作区期间旧映射可能尚未清理；发现代际不匹配必须丢弃旧会话，防止复活。
      if (!(0, deps.isCurrentSession)(key, existing)) {
        (0, deps.retireSession)(key);
      } else {
        const applied = await (0, deps.ensureChatModel)(existing);
        // DSH 侧会话已不存在（DSH 重启、异常退出、归档竞态）：本地映射已经失效，
        // 必须退役并重建，否则每条消息都会对着一个不存在的会话重试 selectModel。
        if (applied === 'not-found') {
          (0, deps.log)(`会话 ${key} 在 DSH 侧已不存在，退役本地映射并在本次调用中重建`);
          (0, deps.retireSession)(key);
        } else {
          if (epoch !== deps.sessionEpoch || !(0, deps.isCurrentSession)(key, existing)) throw new Error('会话创建期间已重置或权限已变化');
          return existing;
        }
      }
    }
    if (sessionPromises.has(key)) return sessionPromises.get(key)!;
    const promise = (async () => {
      const dir = deps.cfg.sessionCwd ? String(deps.cfg.sessionCwd) : deps.path.join(deps.STATE_DIR, 'agents');
      deps.fs.mkdirSync(dir, { recursive: true });
      let sessionId: string | undefined;
      let lastError: unknown = null;
      const preset = (0, deps.modePreset)(key, deps.currentMode, deps.cfg);
      // 非 closed-agent（chat / reserved / reserved2，会话可能属于 QQ 群）必须 fail-closed：
      // 拿不到 qq-chat* 就拒绝建会话，绝不让 DSH 用默认 preset（standard）顶上——那会把
      // bash/文件读写等本地工具暴露给 QQ 群里的任何人（见 RULES.md「无本地工具」）。
      // closed-agent 仅 owner 私聊、本来就用完整工具面，回退不构成提权。
      const strictPreset = deps.currentMode !== 'closed-agent';
      if (strictPreset && !preset) {
        const wanted = deps.currentMode === 'reserved2' ? (deps.cfg.socialV2?.agentPreset || deps.cfg.agentPreset) : deps.cfg.agentPreset;
        throw new Error(`拒绝为 ${key} 创建会话：模式 ${deps.currentMode} 需要 preset "${wanted}"，但它不在 DSH 可用清单中（${deps.dshPresetIds.join(', ') || '未知'}）。回退到 DSH 默认 preset 会把本地工具暴露给 QQ 群；请先运行 node scripts/setup-dsh.mjs 并重启 DSH。`);
      }
      // 归组：所有 QQ 会话挂到同一个 workspace（幂等创建），GUI 里不再散落「未分组」
      // 创建顺序有安全含义：
      //   1) workspace + agentPreset —— 正常路径；
      //   2) workspace 无 preset     —— 仅 closed-agent 允许的降级（那里本就是完整工具面）；
      //      群聊模式绝不走这一步：DSH 会给「无 preset 会话」套上默认 preset（standard）。
      for (const withPreset of strictPreset ? [true] : [true, false]) {
        try {
          const wsValue = (0, deps.unwrap)(await deps.api.workspace.create({ path: dir }), 'workspace.create') as WorkspaceCreated;
          if (wsValue.created && deps.cfg.workspaceTitle) {
            await deps.api.workspace.rename({ workspaceId: wsValue.workspace.workspaceId, title: deps.cfg.workspaceTitle });
          }
          const params: SessionCreateRequest = { workspaceId: wsValue.workspace.workspaceId };
          if (withPreset && preset) params.agentPreset = preset;
          const value = (0, deps.unwrap)(await deps.api.sessions.create(params), 'session.create') as {sessionId: string};
          sessionId = value.sessionId;
          if (withPreset && preset) {
            (0, deps.log)(`会话 ${key} 已挂载 preset ${preset}`);
          } else if (preset) {
            (0, deps.log)(`⚠️ 会话 ${key} 未能挂载 preset ${preset}（${(lastError as {message?: unknown} | null)?.message ?? '未知原因'}），已降级为无 preset 会话；请检查 ~/.dsh/.agent-presets/${preset} 后重启 DSH`);
          }
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!sessionId) {
        throw new Error(`无法为 ${key} 创建 DSH 会话（模式 ${deps.currentMode}，preset ${preset ?? '无'}）：${(lastError as {message?: unknown} | null)?.message ?? '未知原因'}。已拒绝退化为 DSH 默认 preset 会话——那会把本地工具暴露给 QQ 群。`);
      }
      // 新版 DSH 事件流需要显式 follow 该会话，否则收不到 turn 事件。
      deps.api.events.follow(sessionId);
      // reset/清空工作区期间创建完成：丢弃，防止旧会话复活
      if (epoch !== deps.sessionEpoch || policy !== (0, deps.sessionPolicy)(key) || !(0, deps.isSessionAllowedInCurrentMode)(key)) {
        (0, deps.log)(`会话创建期间发生 reset，丢弃 ${key} 的新会话（${sessionId}）`);
        // 已follow但尚未安装本地映射，不能交给retireSession清理；归档不会移除客户端订阅意图。
        try { deps.api.events.forget?.(sessionId); }
        catch { (0, deps.log)('取消失效会话订阅失败，仍尝试归档'); }
        try { await (0, deps.withTimeout)(deps.api.workspace.archiveSession({ sessionId }), deps.DSH_CONTROL_TIMEOUT_MS, 'archiveSession'); } catch { }
        throw new Error('会话创建期间已重置，丢弃新会话');
      }
      deps.state.sessions[key] = sessionId;
      deps.state.sessionPolicies[key] = policy;
      deps.reverse.set(sessionId, key);
      (0, deps.saveState)();
      await (0, deps.ensureChatModel)(sessionId);
      if (epoch !== deps.sessionEpoch || !(0, deps.isCurrentSession)(key, sessionId)) {
        if (deps.state.sessions[key] === sessionId) (0, deps.retireSession)(key);
        throw new Error('会话创建期间已重置或权限已变化');
      }
      (0, deps.log)(`新会话 ${key} -> ${sessionId}（模式 ${deps.currentMode}，preset: ${(0, deps.modePreset)(key, deps.currentMode, deps.cfg) ?? '默认'}）`);
      return sessionId;
    })();
    sessionPromises.set(key, promise);
    try {
      return await promise;
    } finally {
      // 只有仍持有该条目的 promise 才删除，避免旧 promise 误删 reset 后新建的 promise。
      if (sessionPromises.get(key) === promise) sessionPromises.delete(key);
    }
  }
  return { ensure: ensureSession, forget: key => sessionPromises.delete(key), clear: () => sessionPromises.clear() };
}
