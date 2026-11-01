import type {SessionRegistry} from './creation.js';
/** 清理只需要删除能力，不能通过此接口枚举或替换其它会话数据。 */
interface Deletable { delete: (key: string) => boolean; }
/** 退役期间保留会话对象，仅轮换权限令牌和展示水位。 */
export interface RetiredConversation { agentToken: string; bootstrapSent: boolean; modelSeenSeqs: Set<number>; }
/** 泛型保留挂起请求及定时器的实际类型，避免将请求结构抹平。 */
export interface SessionRetirementDependencies<Timer, Pending extends {timer?: Timer}> {
  readonly state: SessionRegistry;
  readonly lastSendFailed: Deletable; readonly activeWaits: Deletable;
  readonly offlineQueue: {clearHint: (key: string) => void};
  readonly slangSubmitTimes: Deletable; readonly feedbackTimes: Deletable;
  readonly wakeConfigMissCount: Deletable; readonly wakeConfigUpdatedKeys: Deletable;
  readonly markReadCalledKeys: Deletable; readonly reverse: Deletable; readonly collectors: Deletable;
  readonly usageObserver: {forget: (sessionId: string) => void};
  readonly sessionModelManager: {forget: (sessionId: string) => void};
  readonly sendToolSucceededSessions: Deletable; readonly pendingSendToolCalls: Deletable;
  readonly v2TurnStartAt: Deletable; readonly turnLeaseNoted: Deletable; readonly toolCallNames: Deletable;
  readonly social: {silentTurns: Deletable; exitingSessions: Deletable};
  readonly pending: Deletable & {get: (key: string) => Pending | undefined};
  readonly clearTimeout: (timer: Timer | undefined) => void;
  readonly cancelPendingEntry: (entry: Pending) => Promise<unknown>;
  readonly clearSocialV2Timers: (key: string) => void; readonly cancelSocialTimers: (key: string) => void;
  readonly disarmPendingWakeLease: (key: string) => void; readonly pendingWakeKeys: Deletable;
  readonly socialV2: {conversations: {get: (key: string) => RetiredConversation | undefined}};
  readonly crypto: {randomBytes: (size: number) => {toString: (encoding: 'hex') => string}};
  readonly rememberAgentToken: (key: string, token: string) => void;
  readonly saveState: () => void; readonly saveSocialV2State: () => void;
  readonly stopBridgeSessionWork: (sessionId: string, reason: string) => Promise<unknown>;
  readonly withTimeout: <T>(task: Promise<T>, timeoutMs: number, label: string) => Promise<T>;
  readonly DSH_CONTROL_TIMEOUT_MS: number; readonly log: (message: string) => void;
  readonly api: {events: {forget?: (sessionId: string) => void};
    workspace: {archiveSession: (request: {sessionId: string}) => Promise<unknown>}};
}
/** 本地退役同步撤销映射；停止与归档在后台顺序执行，错误沿原日志路径报告。 */
export interface SessionRetirement {
  readonly stopRetiredSessionWork: (sessionId: string, key?: string) => void;
  readonly forgetConversationCaches: (key: string) => void; readonly retireSession: (key: string) => void;
}
/**
 * 集中会话退役及缓存清理；状态借自所属桥接，停止/归档仍沿用原异步边界。
 * @param {object} deps 实时依赖视图；getter避免模式、代次、配置在异步期间变成旧快照。
 * @returns {object|function} 所属实例的操作；错误语义与原调用方保持一致。
 * @note 不启动服务、不安装依赖。
 */
export function createSessionRetirement<Timer, Pending extends {timer?: Timer}>(deps: SessionRetirementDependencies<Timer,Pending>): SessionRetirement {

  /**
     * 让 DSH 停下一个已经不再属于桥接的会话：先清队列再取消在途 turn，最后归档。
     * 拆出来是因为所有「撤销映射」的路径都必须做同样的事（retireSession / session-reset /
     * workspace-reset / reset，以及控制台的二代状态重置）—— 少一处就会留下
     * 「DSH 还在烧 token、桥接已经收不到也发不出」的静默黑洞。
     */
  function stopRetiredSessionWork(sessionId: string, key = ''): void {
    void (async () => {
      try { await (0, deps.withTimeout)((0, deps.stopBridgeSessionWork)(sessionId, 'retire'), deps.DSH_CONTROL_TIMEOUT_MS, 'stopSessionWork'); }
      catch (error) { (0, deps.log)(`⚠️ 停止旧会话失败 ${key}：${(error as {message?: unknown} | null)?.message ?? error}；本地映射已撤销，请在 DSH 检查旧任务`); }
      try { await (0, deps.withTimeout)(deps.api.workspace.archiveSession({ sessionId }), deps.DSH_CONTROL_TIMEOUT_MS, 'archiveSession'); }
      catch (error) { (0, deps.log)(`归档失效会话失败 ${key}: ${(error as {message?: unknown} | null)?.message ?? error}`); }
    })();
  }

  /**
     * 清掉「按会话 key 记账」的内存态。
     *
     * 为什么单独抽出来：这些 Map/Set 分散在文件各处，退役路径（retireSession）、
     * 手动重置（/api/session/reset、/reset、workspace reset）、二代状态重置
     * 各自只清了其中一部分 —— 于是「哪个 key 清哪个不清」完全靠人记。
     * 结果是有界但真实的慢性泄漏：被移出白名单的会话，其 lastSendFailed、
     * 限流时间戳会一直留在内存里。所有撤销会话映射的路径都必须调用这里。
     */
  function forgetConversationCaches(key: string) {
    deps.lastSendFailed.delete(key);
    deps.activeWaits.delete(key);
    deps.offlineQueue.clearHint(key);
    deps.slangSubmitTimes.delete(key);
    deps.feedbackTimes.delete(key);
    deps.wakeConfigMissCount.delete(key);
    deps.wakeConfigUpdatedKeys.delete(key);
    deps.markReadCalledKeys.delete(key);
  }

  function retireSession(key: string) {
    const sessionId = deps.state.sessions[key];
    delete deps.state.sessions[key];
    delete deps.state.sessionPolicies[key];
    // 按 key 记账的内存态在**有映射和无映射时都要清**：一条被移出白名单、
    // 但从未成功建过会话的 key 同样会留下限流时间戳与失败标记。
    forgetConversationCaches(key);
    if (!sessionId) return;
    deps.reverse.delete(sessionId);
    deps.collectors.delete(sessionId);
    deps.usageObserver.forget(sessionId);
    deps.sessionModelManager.forget(sessionId);
    deps.sendToolSucceededSessions.delete(sessionId);
    deps.pendingSendToolCalls.delete(sessionId);
    deps.v2TurnStartAt.delete(sessionId);
    deps.turnLeaseNoted.delete(sessionId);
    deps.toolCallNames.delete(sessionId);
    deps.social.silentTurns.delete(sessionId);
    deps.social.exitingSessions.delete(sessionId);
    // 退役的会话要退订：否则 _desiredFollows 只增不减，每次重连都会为它重开一条
    // follow 流并重发一整份历史快照（内存与重连延迟都随会话数线性增长）。
    deps.api.events.forget?.(sessionId);
    const entry = deps.pending.get(key);
    if (entry) { (0, deps.clearTimeout)(entry.timer); void (0, deps.cancelPendingEntry)(entry).catch(() => { }); }
    deps.pending.delete(key);
    (0, deps.clearSocialV2Timers)(key);
    (0, deps.cancelSocialTimers)(key);
    (0, deps.disarmPendingWakeLease)(key);
    deps.pendingWakeKeys.delete(key);
    const st = deps.socialV2.conversations.get(key);
    if (st) {
      // 保留旧 token 在脱敏集合中，但撤销它的调用权限。
      st.agentToken = deps.crypto.randomBytes(24).toString('hex');
      (0, deps.rememberAgentToken)(key, st.agentToken);
      st.bootstrapSent = false;
      st.modelSeenSeqs = new Set();
    }
    (0, deps.saveState)();
    (0, deps.saveSocialV2State)();
    stopRetiredSessionWork(sessionId, key);
    (0, deps.log)(`会话权限已变化，停用旧映射 ${key} -> ${sessionId}`);
  }
  return { stopRetiredSessionWork, forgetConversationCaches, retireSession };
}
