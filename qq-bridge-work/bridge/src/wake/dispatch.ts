import type {PromptOptions, PromptResult} from '../messaging/prompt-dispatch.js';
import type {WakeState, WakeTimerHandle, WakeTimers, WakeConfigurationInput} from './configuration.js';
/** 后台观察限频时由观察者重试，其余分支沿原逻辑返回void。 */
export type WakeDispatchResult = {retry: true; retryAfterMs: number} | void;
/** 状态、定时器、租约与原生观察身份各自保留类型，不混用清理权限。 */
export interface WakeDispatchDependencies<Timer extends WakeTimerHandle, State extends WakeState<Timer>, Lease, Identity> {
  /** 兼容宿主已有的时钟注入；实际计时器归wakeTimers持有。 */
  readonly clearTimeout?:typeof globalThis.clearTimeout;readonly setTimeout?:typeof globalThis.setTimeout;
  readonly cfg: WakeConfigurationInput; readonly currentMode: string; readonly socialV2: {paused: boolean};
  readonly nativeObservationCurrent: (key: string, identity: Identity) => boolean;
  readonly isSessionAllowedInCurrentMode: (key: string) => boolean; readonly getSocialV2State: (key: string) => State;
  readonly isConversationBusyV2: (key: string, state: State) => boolean; readonly busyReasonV2: (key: string, state: State) => string;
  readonly Date: Pick<DateConstructor,'now'|'parse'>; readonly Math: Pick<Math,'max'|'min'|'round'>;
  readonly hasDirectUnreadV2: (state: State) => boolean; readonly isTimerWakeReason: (reason: string) => boolean;
  readonly wakeTimers: Pick<WakeTimers<State,Timer>,'schedule'|'cancel'>; readonly cancelReplyCheckV2: (key: string) => void;
  readonly saveSocialV2State: () => void; readonly buildWakePromptV2: (key: string, reason: string) => string;
  readonly pendingWakeKeys: Pick<Set<string>,'add'|'delete'>; readonly armPendingWakeLease: (key: string) => Lease;
  readonly isWakeLeaseCurrent: (key: string, lease: Lease | undefined) => boolean; readonly disarmPendingWakeLease: (key: string) => void;
  readonly deliverPrompt: (key: string, text: string, options: PromptOptions<never,Identity>) => Promise<PromptResult>;
  readonly setupSleepTimerV2: (key: string) => void; readonly log: (...values: unknown[]) => void;
}
/**
 * 执行一次唤醒投递，保留限频、失败回滚和离线补投语义。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createWakeDispatcher<Timer extends WakeTimerHandle, State extends WakeState<Timer>, Lease, Identity>(deps: WakeDispatchDependencies<Timer,State,Lease,Identity>) {


  async function sendWakePromptV2(key: string, reason: string, observationIdentity?: Identity): Promise<WakeDispatchResult> {
    if (observationIdentity && !(0, deps.nativeObservationCurrent)(key, observationIdentity)) return;
    if (deps.cfg.socialV2?.enabled === false) return;
    if (deps.currentMode !== 'reserved2' || deps.socialV2.paused) return;
    if (!(0, deps.isSessionAllowedInCurrentMode)(key)) {
      (0, deps.log)(`[reserved2] 跳过唤醒 ${key}（${reason}）：会话已不在当前模式允许范围内`);
      return;
    }
    const st = (0, deps.getSocialV2State)(key);
    // 防重入：如果该会话已经有一个 DSH turn 在进行中（AI 正在思考/调用工具），
    // 或已有排队/在途 prompt，则不再投递新的候选唤醒，避免“思维链进行中又塞入一个 question 唤醒”。
    if ((0, deps.isConversationBusyV2)(key, st)) {
      if (!Array.isArray(st.pendingWakeReasons)) st.pendingWakeReasons = [];
      const seq = st.lastUnreadSeq || 0;
      if (!st.pendingWakeReasons.some((r) => r && r.reason === reason && r.seq === seq)) {
        st.pendingWakeReasons.push({ reason, seq });
        // 有界队列：最多保留 20 条，防止消息洪峰下无限增长。
        if (st.pendingWakeReasons.length > 20) st.pendingWakeReasons.splice(0, st.pendingWakeReasons.length - 20);
      }
      (0, deps.log)(`[reserved2] 会话繁忙，暂存唤醒原因 ${key}（${reason}@seq${seq}，原因=${(0, deps.busyReasonV2)(key, st)}）`);
      return;
    }
    // 唤醒频率硬限制：超限则**延后重试**，不能直接丢弃。直接 return 的后果：
    //   · timeout 唤醒时 setupSleepTimerV2 已经清空 sleepTimer，丢弃后这个会话会停在
    //     「infinite=false、sleepUntil 已过期、没有任何定时器」的静默态，除非重启或
    //     主动机会兜底（默认 30~90 分钟）才可能恢复；
    //   · @/提问被丢弃则要等下一条消息才可能再唤醒。
    // 重试仍然遵守限频（等到窗口腾出位置），只是把「这一枪」补回来。
    const now = deps.Date.now();
    const direct = (0, deps.hasDirectUnreadV2)(st);
    const maxPerMinute = direct ? Number(deps.cfg.socialV2?.wake?.directMaxWakePerMinute) || 12 : Number(deps.cfg.socialV2?.wake?.maxWakePerMinute) || 0;
    const maxPerHour = direct ? Number(deps.cfg.socialV2?.wake?.directMaxWakePerHour) || 120 : Number(deps.cfg.socialV2?.wake?.maxWakePerHour) || 0;
    const recentMinute = (st.wakeTimes || []).filter((t) => now - t < 60000).length;
    const recentHour = (st.wakeTimes || []).filter((t) => now - t < 3600000).length;
    if ((maxPerMinute > 0 && recentMinute >= maxPerMinute) || (maxPerHour > 0 && recentHour >= maxPerHour)) {
      let retryAfterMs = 0;
      if (maxPerMinute > 0 && recentMinute >= maxPerMinute) {
        const times = (st.wakeTimes || []).filter((t) => now - t < 60000).sort((a, b) => a - b);
        if (times.length) retryAfterMs = deps.Math.max(retryAfterMs, 60000 - (now - times[0]) + 500);
      }
      if (maxPerHour > 0 && recentHour >= maxPerHour) {
        const times = (st.wakeTimes || []).filter((t) => now - t < 3600000).sort((a, b) => a - b);
        if (times.length) retryAfterMs = deps.Math.max(retryAfterMs, 3600000 - (now - times[0]) + 500);
      }
      // 每次只等一小段（最长 60s）：小时级限频不会一次性睡满一小时而错过中途可用的窗口。
      const waitMs = deps.Math.min(60000, deps.Math.max(1000, deps.Math.round(retryAfterMs) || 5000));
      // 原生后台观察独占其重试；不能交给另一个持有旧观察身份的定时器后撤销自身。
      if (observationIdentity) {
        (0, deps.log)(`[reserved2] 后台唤醒限频，保留观察，${deps.Math.round(waitMs / 1000)}s 后重试`);
        return { retry: true, retryAfterMs: waitMs };
      }
      if (!st.rateLimitRetryTimer) {
        st.rateLimitRetryTimer = deps.wakeTimers.schedule(key, st, 'rateLimitRetryTimer', () => {
          st.rateLimitRetryTimer = null;
          // 消息类原因在重试前再确认一次：等待窗口里消息可能已被别的回合处理掉，
          // 没必要为一条已经处理过的消息再唤醒一次（定时器类原因与未读无关，不检查）。
          if (!(0, deps.isTimerWakeReason)(reason) && !(Array.isArray(st.unread) && st.unread.length > 0)) {
            (0, deps.log)(`[reserved2] 限频重试前发现未读已清空，跳过 ${key}（${reason}）`);
            return;
          }
          void sendWakePromptV2(key, reason, observationIdentity).catch((error) => (0, deps.log)(`[reserved2] 限频重试唤醒异常 ${key}:`, (error as {message?: unknown} | null)?.message ?? error));
        }, waitMs);
        (st.rateLimitRetryTimer as {unref?: () => unknown}).unref?.();
      }
      (0, deps.log)(`[reserved2] 唤醒频率超限，${deps.Math.round(waitMs / 1000)}s 后重试 ${key}（${reason}）`);
      return;
    }
    // Only a real new wake resets observation; skipped/busy candidates must
    // preserve the current turn's progress through its required wait window.
    st.preSleepWaitSatisfiedAt = 0;
    st.preSleepWaitObservedAt = 0;
    st.preSleepWaitAccumMs = 0;
    (0, deps.cancelReplyCheckV2)(key); // 本次唤醒已接管，清理仍在排队的回复检查
    if (st.rateLimitRetryTimer) { deps.wakeTimers.cancel(key, 'rateLimitRetryTimer'); st.rateLimitRetryTimer = null; }
    const wakeTime = now;
    st.wakeTimes.push(wakeTime);
    if (st.wakeTimes.length > 200) st.wakeTimes = st.wakeTimes.slice(-200);
    // 无论提前唤醒还是超时唤醒，都清理有限潜水定时器与 sleepUntil，避免状态残留/重复唤醒
    const prevSleepUntil = st.wakeConfig.sleepUntil;
    const hadFiniteSleep = !st.wakeConfig.infinite && !!prevSleepUntil && Number.isFinite(deps.Date.parse(prevSleepUntil));
    if (st.sleepTimer) {
      deps.wakeTimers.cancel(key, 'sleepTimer');
      st.sleepTimer = null;
    }
    st.wakeConfig.sleepUntil = null;
    st.wakeConfig.lastWakeAt = now;
    st.wakeConfig.wakeCount = (st.wakeConfig.wakeCount || 0) + 1;
    st.lastWakeReason = reason;
    (0, deps.saveSocialV2State)();
    const promptText = (0, deps.buildWakePromptV2)(key, reason);
    (0, deps.log)(`[reserved2] 唤醒 ${key}（${reason}）`);
    const rollbackWakeTime = () => {
      const idx = st.wakeTimes.lastIndexOf(wakeTime);
      if (idx >= 0) st.wakeTimes.splice(idx, 1);
      (0, deps.saveSocialV2State)();
    };
    let lease: Lease | undefined;
    try {
      deps.pendingWakeKeys.add(key);
      lease = (0, deps.armPendingWakeLease)(key);
      const result = await (0, deps.deliverPrompt)(key, promptText, { wakeReason: reason, ...(observationIdentity ? { nativeObservationIdentity: observationIdentity } : {}) });
      if (!(0, deps.isWakeLeaseCurrent)(key, lease)) return;
      const restoreFiniteSleep = () => {
        if (hadFiniteSleep) {
          st.wakeConfig.sleepUntil = prevSleepUntil;
          st.wakeConfig.infinite = false;
          (0, deps.saveSocialV2State)();
          (0, deps.setupSleepTimerV2)(key);
        }
      };
      if (result && result.ok === false) {
        deps.pendingWakeKeys.delete(key);
        (0, deps.disarmPendingWakeLease)(key);
        rollbackWakeTime();
        restoreFiniteSleep();
        (0, deps.log)(`[reserved2] 唤醒投递被拒 ${key}: ${result.error || '未知错误'}`);
      } else if (result && result.queued === true) {
        // 入队而非真正在途：保留 pendingWakeKeys，等 DSH 恢复后真正投递的 turn/end 再触发收尾保护；
        // 不能在这里删除，否则补投的唤醒回合会丢失“未设置唤醒配置”的安全兜底。
        (0, deps.log)(`[reserved2] 唤醒已入队 ${key}（${reason}），等待 DSH 恢复后补投`);
      }
    } catch (error) {
      if (!(0, deps.isWakeLeaseCurrent)(key, lease)) return;
      deps.pendingWakeKeys.delete(key);
      (0, deps.disarmPendingWakeLease)(key);
      rollbackWakeTime();
      if (hadFiniteSleep) {
        st.wakeConfig.sleepUntil = prevSleepUntil;
        st.wakeConfig.infinite = false;
        (0, deps.saveSocialV2State)();
        (0, deps.setupSleepTimerV2)(key);
      }
      (0, deps.log)(`[reserved2] 唤醒投递失败 ${key}: ${(error as {message?: unknown} | null)?.message ?? error}`);
    }
  }
  return { sendWakePromptV2 };
}
