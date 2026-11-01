/** 外部事件与快照仅在旧有投影位置断言；计费校验仍由账本负责。 */
interface ModelHint {model?: unknown; provider?: unknown;}
interface UsageEvent {type?: unknown; data?: ModelHint & {usage?: {model?: unknown}};}
interface UsageSnapshot {projections?: {values?: {modelSelection?: {lastUsed?: ModelHint; pending?: ModelHint}}}; records?: unknown;}
interface LegacyUsageError {message?: unknown;}
/** 账本摄入为同步调用，不允许把未处理的异步失败漏出主链路。 */
export interface UsageObserverDependencies {
 readonly tokenLedger: {
  readonly ingestEvent: (value: {sessionId: string; event: unknown; model: unknown; provider: unknown}) => boolean;
  readonly ingestBaseline: (value: {sessionId: string; projection: unknown; at: number; model: unknown; provider: unknown}) => boolean;
  readonly ingestSnapshotRecords: (value: {sessionId: string; records: unknown}) => number;
 };
 readonly nominalModel: () => unknown; readonly fallbackProvider: () => unknown;
 readonly rebuildInFlightCollector: (sessionId: string, records: unknown) => undefined;
 readonly log: (message: string, error?: unknown) => void; readonly now?: () => number;
}
/**
 * 接入会话模型选择、用量事件及快照，实际计费和幂等折叠仍由账本负责。
 * @param {object} options tokenLedger为既有账本；nominalModel/fallbackProvider读取当前配置；rebuildInFlightCollector只恢复未结束回合。
 * @returns {object} recordSessionUsage/recordSessionSnapshot与forget；forget只清理模型提示，不删除账本记录。
 * @note 构造无IO；摄入错误记录后返回，不阻断QQ主链路；不发送消息、不自行累加用量。
 */
export function createUsageObserver({tokenLedger,nominalModel,fallbackProvider,rebuildInFlightCollector,log,now=Date.now}: UsageObserverDependencies) {
  /** sessionId -> 最近一次已知的实际模型。切换模型会让单价差好几倍，所以按会话记。 */
  const sessionModels = new Map<string,{model: string; provider?: unknown}>();

  function rememberModel(sessionId: string, selection: ModelHint | null | undefined) {
    const model = selection?.model;
    if (typeof model === 'string' && model) {
      sessionModels.set(sessionId, { model, provider: selection?.provider });
    }
  }

  /** 摄入一条会话事件到 token 账本；任何异常都不能影响 QQ 主链路。 */
  function recordSessionUsage(sessionId: string, event: unknown) {
    try {
      if ((event as UsageEvent | null)?.type === 'model/selection') rememberModel(sessionId, (event as UsageEvent).data);
      const known = sessionModels.get(sessionId);
      tokenLedger.ingestEvent({
        sessionId,
        event,
        model: (event as UsageEvent | null)?.data?.usage?.model ?? known?.model,
        provider: (event as UsageEvent | null)?.data?.provider ?? known?.provider
      });
    } catch (error) {
      log('token 账本：摄入事件失败', (error as LegacyUsageError | null)?.message ?? error);
    }
  }

  /**
   * 处理会话开场快照：
   * 1. `projections.tokenUsage` 是**整条会话日志**的权威累计桶（含桥接启动前的历史）；
   * 2. `records` 是最近若干条历史事件，用来回填「逐轮花费」。
   * 重连时该帧会重新下发，账本内部按 (turn, step, retry) + seq 做幂等折叠，不会翻倍。
   */
  function recordSessionSnapshot(sessionId: string, snapshot: unknown) {
    try {
      if (!snapshot) return;
      const selection = (snapshot as UsageSnapshot).projections?.values?.modelSelection;
      rememberModel(sessionId, selection?.lastUsed ?? selection?.pending ?? null);
      const known = sessionModels.get(sessionId);
      tokenLedger.ingestBaseline({
        sessionId,
        projection: (snapshot as UsageSnapshot).projections,
        at: now(),
        model: known?.model ?? nominalModel(),
        provider: known?.provider ?? fallbackProvider()
      });
      tokenLedger.ingestSnapshotRecords({ sessionId, records: (snapshot as UsageSnapshot).records });
      rebuildInFlightCollector(sessionId, (snapshot as UsageSnapshot).records);
    } catch (error) {
      log('token 账本：处理会话快照失败', (error as LegacyUsageError | null)?.message ?? error);
    }
  }


  return Object.freeze({recordSessionUsage,recordSessionSnapshot,forget:(sessionId: string)=>sessionModels.delete(sessionId)});
}
