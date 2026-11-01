/** 断流清理只申请clear能力，不读取或替换集合内容。 */
interface Clearable { clear: () => void; }
/** 流生产与消费共享同一Envelope类型，未校验的外部输入可继续使用unknown。 */
export interface SessionEventStreamDependencies<Envelope> {
  readonly api: {events: {mux: (options: Record<string, never>) => AsyncIterable<Envelope>}};
  readonly handleSessionFrame: (envelope: Envelope) => Promise<unknown>;
  readonly log: (...values: unknown[]) => void; readonly sleep: (delayMs: number) => Promise<unknown>;
  readonly nativeIdleLoop?: {cancel: () => void} | null;
  readonly idleDraftRunner?: {cancelAll: () => void} | null;
  readonly nativePhoneModel?: {cancelAll: () => void} | null;
  readonly nativePhone?: {reconcile: () => Promise<unknown>} | null;
  readonly collectors: Clearable; readonly social: {silentTurns: Clearable; exitingSessions: Clearable};
  readonly sendToolSucceededSessions: Clearable; readonly pendingSendToolCalls: Clearable;
  readonly v2TurnStartAt: Clearable; readonly toolCallNames: Clearable; readonly pendingWakeKeys: Clearable;
  readonly clearAllPendingWakeLeases: () => void; readonly wakeConfigUpdatedKeys: Clearable;
  readonly markReadCalledKeys: Clearable; readonly wakeConfigMissCount: Clearable; readonly activeWaits: Clearable;
}
/** pump保持既有无限重连行为；只有外部依赖抛错才会拒绝，不新增停止协议。 */
export interface SessionEventStream {
  readonly pumpMux: () => Promise<never>; readonly clearDisconnectedSessionState: () => void;
}
/**
 * 串行消费DSH事件流，断开时清理宿主回合状态并按原规则退避重连。
 * @param {object} deps 实例依赖；动态配置、权限、会话状态通过getter实时读取。
 * @returns {object} 功能操作；异步错误沿原调用边界传播，调用方负责记录或响应。
 */
export function createSessionEventStream<Envelope>(deps: SessionEventStreamDependencies<Envelope>): SessionEventStream {

  function clearDisconnectedSessionState(): void {
    deps.nativeIdleLoop?.cancel(); deps.idleDraftRunner?.cancelAll();
    deps.nativePhoneModel?.cancelAll(); void deps.nativePhone?.reconcile().catch(() => { });
    // WebSocket 正常关闭和异常中断都会走到这里；必须清掉旧 turn 相关状态，
    // 否则重连后旧 collector/标记残留会导致回复重复累加或误判。
    deps.collectors.clear(); // 清除旧 turn collector，避免重连后残留导致重复累加
    deps.social.silentTurns.clear(); // 清除未消费的摘要静默名额，避免重连后吞掉正常回复
    deps.sendToolSucceededSessions.clear();
    deps.pendingSendToolCalls.clear();
    deps.v2TurnStartAt.clear();
    deps.toolCallNames.clear();
    deps.pendingWakeKeys.clear();
    (0, deps.clearAllPendingWakeLeases)();
    deps.social.exitingSessions.clear();
    deps.wakeConfigUpdatedKeys.clear();
    deps.markReadCalledKeys.clear();
    deps.wakeConfigMissCount.clear();
    // 长轮询（qq_wait_for_messages）的租约也要清：它的 req.on('close') 在事件流
    // 断开时不一定触发，残留租约会用 429 卡住该会话最长 15 分钟的等待工具。
    deps.activeWaits.clear();
  }

  async function pumpMux(): Promise<never> {
    // 事件流重连退避：DSH 侧流被立刻关闭时（例如版本不兼容，见 issue #34），
    // 固定 3 秒重连会以每分钟 20 行的速度刷屏，真正有用的错误反而被淹没。
    let retryMs = 3000;
    let failureStreak = 0;
    for (;;) {
      let framesThisStream = 0;
      try {
        (0, deps.log)('连接 DSH 事件流…');
        for await (const envelope of deps.api.events.mux({})) { framesThisStream += 1; await (0, deps.handleSessionFrame)(envelope); }
        // 流正常关闭（服务端主动断开）不会抛错。以前这里什么都不打，日志看起来
        // 就像「连上了、然后又连一次」，完全看不出 DSH 把流关了。
        (0, deps.log)(`DSH 事件流已结束（本次收到 ${framesThisStream} 帧）`);
      } catch (error) {
        (0, deps.log)('事件流中断:', (error as {message?: unknown} | null)?.message ?? error);
      } finally { clearDisconnectedSessionState(); }
      if (framesThisStream > 0) {
        failureStreak = 0;
        retryMs = 3000;
      } else {
        failureStreak += 1;
        retryMs = Math.min(30000, retryMs * 2);
        if (failureStreak === 3) {
          (0, deps.log)('⚠️ 连续多次连上 DSH 事件流后一帧都没收到就断开：多半是 DSH 侧事件流协议/版本不匹配'
            + '（可在 DSH 里核对版本，或查看 issue #34）。已改为指数退避重连，不再每 3 秒刷屏。');
        }
      }
      await (0, deps.sleep)(retryMs);
    }
  }
  return { pumpMux, clearDisconnectedSessionState };
}
