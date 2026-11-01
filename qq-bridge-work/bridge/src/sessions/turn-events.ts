import type {SocialTimeline, SocialTimelineConfig} from '../messaging/message-segmentation.js';
import type {PromptResult} from '../messaging/prompt-dispatch.js';
/** 这里只消费事件类别；具体载荷通过泛型保留给collector。 */
export interface TurnEvent { type: string; }
/** 已收集回合的结果切片；未知原因仍按既有分支忽略。 */
export interface CompletedTurn { text: string; reason: unknown; }
/** 旧收尾分支对远端原因的消费投影；不改变异常或缺字段的运行语义。 */
interface LegacyTurnReason {kind?:unknown;error?:{message?:string};}
/** collector属于宿主会话，只暴露本模块使用的推入与大小接口。 */
export interface TurnCollector<Event, Ended extends CompletedTurn = CompletedTurn> {
  push: (event: Event) => Ended | null | undefined; size?: () => number;
}
/** 收尾仅操作无行动次数；其余唤醒配置由泛型保留。 */
export interface TurnWakeConfig { noActionCount?: number; }
export interface TurnWakeState<Config extends TurnWakeConfig = TurnWakeConfig> {
  lastActionAt: number; bootstrapSent: boolean; wakeConfig: Config;
}
/** 旧社交模式的退场与活跃时间状态切片。 */
export interface TurnSocialState {
  phase: string; activeDeadlineAt: number; activeExitAt: number;
  lastActiveMessageAt?: number; lastAiReplyAt?: number;
}
interface Deletable { delete: (key: string) => boolean; }
interface KeySet extends Deletable { has: (key: string) => boolean; }
/** 实时依赖视图；泛型保留collector、事件、状态、租约和配置的配对关系。 */
export interface TurnEventDependencies<Event extends TurnEvent, Ended extends CompletedTurn,
  Collector extends TurnCollector<Event,Ended>, Lease, WakeConfig extends TurnWakeConfig,
  Wake extends TurnWakeState<WakeConfig>, SocialConfig extends SocialTimelineConfig> {
  readonly collectors: Pick<Map<string,Collector>,'get'|'set'|'delete'>;
  readonly createTurnCollector: () => Collector;
  readonly v2TurnStartAt: Pick<Map<string,number>,'get'|'delete'>;
  readonly turnLeaseNoted: Deletable; readonly nativeTrackedTurns: Deletable;
  readonly social: {silentTurns: Pick<Map<string,{ts: number}[]>,'get'|'set'|'delete'>; exitingSessions: KeySet};
  readonly currentMode: string;
  readonly getSocialV2State: (key: string) => Wake;
  readonly sendToolSucceededSessions: KeySet; readonly pendingSendToolCalls: Deletable; readonly toolCallNames: Deletable;
  readonly cfg: {socialV2?: {wake?: {noActionLimit?: unknown; maxWakeConfigReminders?: unknown}|null}; security?: {interceptNotify?: unknown}; social: SocialConfig};
  readonly defaultWakeConfigV2: () => WakeConfig;
  readonly saveSocialV2State: () => void; readonly log: (...values: unknown[]) => void;
  readonly SILENT_TURN_TIMEOUT_MS: number; readonly SILENT_MARKER: string;
  readonly pendingWakeKeys: KeySet & {add: (key: string) => unknown};
  readonly disarmPendingWakeLease: (key: string) => void;
  readonly wakeConfigUpdatedKeys: KeySet; readonly markReadCalledKeys: KeySet;
  readonly nativeObservation?: {has: (key: string) => boolean} | null;
  readonly ensureWakeableV2: (state: Wake, options: {key: string}) => unknown;
  readonly wakeConfigMissCount: Pick<Map<string,number>,'get'|'set'|'delete'>;
  readonly armPendingWakeLease: (key: string) => Lease;
  readonly isWakeLeaseCurrent: (key: string, lease: Lease) => boolean;
  readonly deliverPrompt: (key: string, text: string) => Promise<PromptResult>;
  readonly buildWakeReminderPromptV2: (key: string) => string;
  readonly replayPendingWakeReasonsV2: (key: string) => unknown;
  readonly mdToPlain: (text: string) => string; readonly socialState: (key: string) => TurnSocialState;
  readonly isSilentMarker: (text: string) => boolean;
  readonly KNOWN_AGENT_TOKENS: Iterable<string>; readonly shouldAuditKey: (key: string) => boolean;
  readonly SENSITIVE_RE: RegExp; readonly appendActivity: (message: string) => void;
  readonly sendToQQ: (key: string, text: string) => Promise<unknown>;
  readonly isSocialEnabled: () => boolean; readonly shouldBlockSilentReply: (key: string) => boolean;
  readonly planSocialTimeline: (text: string, config: SocialConfig) => SocialTimeline;
  readonly sendBurstToQQ: (key: string, messages: string[], config: SocialConfig) => Promise<unknown>;
  readonly lastSendSucceeded: (key: string) => boolean; readonly nativeBinding: unknown;
}
/** 回合结束操作可等待；track只维护collector，不触发发送。 */
export interface TurnEvents<Event, Ended extends CompletedTurn, Collector extends TurnCollector<Event,Ended>> {
  readonly trackTurnEvent: (sessionId: string, event: Event) => {collector: Collector | undefined; ended: Ended | null | undefined};
  readonly finishSessionTurn: (key: string, frame: {sessionId: string}, ended: Ended) => Promise<void>;
}
/**
 * 维护回合收集与结束分发；保留静默、工具已发送、原生发送和唤醒收尾语义。
 * @param {object} deps 实例依赖；动态配置、权限、会话状态通过getter实时读取。
 * @returns {object} 功能操作；异步错误沿原调用边界传播，调用方负责记录或响应。
 */
export function createTurnEvents<Event extends TurnEvent, Ended extends CompletedTurn, Collector extends TurnCollector<Event,Ended>, Lease, WakeConfig extends TurnWakeConfig, Wake extends TurnWakeState<WakeConfig>, SocialConfig extends SocialTimelineConfig>(deps: TurnEventDependencies<Event,Ended,Collector,Lease,WakeConfig,Wake,SocialConfig>): TurnEvents<Event,Ended,Collector> {

  // 仅turn/start创建collector；完成或孤立的空turn/end必须释放，避免永久判忙。
  function trackTurnEvent(sessionId: string, event: Event) {
    let collector = deps.collectors.get(sessionId);
    if (!collector && event?.type === 'turn/start') {
      collector = (0, deps.createTurnCollector)();
      deps.collectors.set(sessionId, collector);
    }
    const ended = collector ? collector.push(event) : null;
    if (ended) {
      // 回合正常收尾：collector 立刻释放。v2TurnStartAt 留给调用方（无行动判定要用它），
      // 调用方在 `if (ended)` 分支里用完再删。
      deps.collectors.delete(sessionId);
    } else if (event?.type === 'turn/end' && (!collector || collector.size?.() === 0)) {
      deps.collectors.delete(sessionId);
      deps.v2TurnStartAt.delete(sessionId);
      deps.turnLeaseNoted.delete(sessionId);
    }
    return { collector, ended };
  }

  async function finishSessionTurn(key: string, frame: {sessionId: string}, ended: Ended): Promise<void> {
    deps.nativeTrackedTurns.delete(frame.sessionId);
    // reserved2 无行动兜底：普通唤醒回合若既没发消息、也没 mark_read / set_wake_config，
    // 则累计 noActionCount；达到阈值后自动重置 WakeConfig，避免 AI 卡死。
    const silentQueueNow = deps.social.silentTurns.get(frame.sessionId) ?? [];
    const isSilentTurn = silentQueueNow.length > 0;
    if (deps.currentMode === 'reserved2' && key && !isSilentTurn) {
      const st = (0, deps.getSocialV2State)(key);
      const turnStart = deps.v2TurnStartAt.get(frame.sessionId) ?? 0;
      const sendToolHit = deps.sendToolSucceededSessions.has(frame.sessionId);
      // turn/start 丢了（重连后由快照补发的回合）就无从判断「这一轮有没有行动」：
      // 此时记 miss 会冤枉 AI，连续 3 次就把 AI 自己设的唤醒配置重置成默认值。
      if (turnStart > 0 || sendToolHit) {
        const actionTaken = sendToolHit || (turnStart > 0 && st.lastActionAt >= turnStart);
        if (actionTaken) {
          st.wakeConfig.noActionCount = 0;
        } else {
          st.wakeConfig.noActionCount = (st.wakeConfig.noActionCount || 0) + 1;
          const limit = Number(deps.cfg.socialV2?.wake?.noActionLimit) || 3;
          if (st.wakeConfig.noActionCount >= limit) {
            (0, deps.log)(`[reserved2] ${key} 连续 ${st.wakeConfig.noActionCount} 次唤醒无行动，重置唤醒配置`);
            st.wakeConfig = (0, deps.defaultWakeConfigV2)();
            st.bootstrapSent = true;
            st.wakeConfig.noActionCount = 0;
          }
        }
        (0, deps.saveSocialV2State)();
      } else {
        (0, deps.log)(`[reserved2] ${key} 回合结束但缺少 turn/start（重连补发），跳过无行动计数`);
      }
    }
    deps.v2TurnStartAt.delete(frame.sessionId);
    deps.collectors.delete(frame.sessionId);
    deps.turnLeaseNoted.delete(frame.sessionId);
    const sendToolSucceeded = deps.sendToolSucceededSessions.has(frame.sessionId);
    deps.sendToolSucceededSessions.delete(frame.sessionId);
    deps.pendingSendToolCalls.delete(frame.sessionId);
    deps.toolCallNames.delete(frame.sessionId);
    // 标记本次 turn 是否为“活跃超时退场”发言（用于准确回到观望，避免把旧回复误判为退场）
    const isFarewell = deps.social.exitingSessions.has(frame.sessionId);
    if (isFarewell) deps.social.exitingSessions.delete(frame.sessionId);
    // 摘要投喂触发的 turn：回复静默（不发送到 QQ）。
    // 用 FIFO 时间戳队列 + 超时回收，避免计数残留吞掉后续正常回复。
    const silentQueue = deps.social.silentTurns.get(frame.sessionId) ?? [];
    const silentNow = Date.now();
    while (silentQueue.length && silentNow - silentQueue[0].ts > deps.SILENT_TURN_TIMEOUT_MS) silentQueue.shift();
    if (silentQueue.length > 0) {
      silentQueue.shift();
      if (silentQueue.length > 0) deps.social.silentTurns.set(frame.sessionId, silentQueue);
      else deps.social.silentTurns.delete(frame.sessionId);
      (0, deps.log)(`摘要投喂 turn 结束，静默 (${key})`);
      return;
    }
    // reserved2 防遗忘：每次唤醒回合结束时，若 AI 没有调用 qq_set_wake_config 设置下一次唤醒条件，
    // 则发送提醒；连续未设置达到上限后重置为默认唤醒配置。静默/后台提醒回合已在上方 continue，不触发。
    if (deps.pendingWakeKeys.has(key)) {
      deps.pendingWakeKeys.delete(key);
      (0, deps.disarmPendingWakeLease)(key);
      if (deps.wakeConfigUpdatedKeys.has(key) || deps.markReadCalledKeys.has(key) || deps.nativeObservation?.has(key)) {
        (0, deps.ensureWakeableV2)((0, deps.getSocialV2State)(key), { key });
        deps.wakeConfigUpdatedKeys.delete(key);
        deps.markReadCalledKeys.delete(key);
        deps.wakeConfigMissCount.delete(key);
      } else {
        const currentMiss = (deps.wakeConfigMissCount.get(key) ?? 0) + 1;
        const maxReminders = Number(deps.cfg.socialV2?.wake?.maxWakeConfigReminders) || 2;
        if (currentMiss < maxReminders) {
          deps.wakeConfigMissCount.set(key, currentMiss);
          deps.pendingWakeKeys.add(key);
          const reminderLease=(0, deps.armPendingWakeLease)(key);
          (0, deps.deliverPrompt)(key, (0, deps.buildWakeReminderPromptV2)(key)).then((result) => {
            if (!(0,deps.isWakeLeaseCurrent)(key,reminderLease)) return;
            if (result && result.ok === false) {
              deps.pendingWakeKeys.delete(key);
              (0, deps.disarmPendingWakeLease)(key);
            }
          }).catch((error) => {
            if (!(0,deps.isWakeLeaseCurrent)(key,reminderLease)) return;
            deps.pendingWakeKeys.delete(key);
            (0, deps.disarmPendingWakeLease)(key);
            (0, deps.log)(`[reserved2] ${key} 唤醒提醒投递失败: ${(error as {message?: unknown} | null)?.message ?? error}`);
          });
          (0, deps.log)(`[reserved2] ${key} 未设置唤醒条件，发送提醒 (${currentMiss}/${maxReminders})`);
        } else {
          const st = (0, deps.getSocialV2State)(key);
          st.wakeConfig = (0, deps.defaultWakeConfigV2)();
          (0, deps.saveSocialV2State)();
          (0, deps.log)(`[reserved2] ${key} 连续未设置唤醒条件，已重置为默认唤醒配置`);
        }
      }
    }
    // 繁忙期间被暂存的唤醒原因：当前 turn 结束后补一次（定时器类与消息类语义不同，
    // 详见 replayPendingWakeReasonsV2 的注释）。
    (0, deps.replayPendingWakeReasonsV2)(key);
    if ((ended.reason as LegacyTurnReason).kind === 'completed' && ended.text.trim()) {
      const plain = (0, deps.mdToPlain)(ended.text);
      // 纯 Markdown/空白输出按“无文本”处理，避免后续 planSocialTimeline 拿空串崩溃。
      if (!plain.trim()) {
        (0, deps.log)(`agent 回复为空（仅格式/空白）(${key})`);
        if (isFarewell) {
          const st = (0, deps.socialState)(key);
          if (st.phase === 'exiting') {
            st.phase = 'idle';
            st.activeDeadlineAt = 0;
            st.activeExitAt = 0;
            (0, deps.log)(`社交模式：${key} 空退场回合，回到观望`);
          }
        }
        return;
      }
      // 社交模式静默标记：AI 主动选择“潜水/不接话”，不发送到 QQ
      if ((0, deps.isSilentMarker)(plain)) {
        (0, deps.log)(`社交模式：AI 选择静默（${deps.SILENT_MARKER}）(${key})`);
        if (isFarewell) {
          const st = (0, deps.socialState)(key);
          if (st.phase === 'exiting') {
            st.phase = 'idle';
            st.activeDeadlineAt = 0;
            st.activeExitAt = 0;
            (0, deps.log)(`社交模式：${key} 退场选择静默，回到观望`);
          }
        }
        return;
      }
      // 本回合已经通过 MCP 发送工具成功发出消息：跳过自动转发，避免重复发送。
      if (sendToolSucceeded) {
        (0, deps.log)(`工具已发送消息，跳过自动转发 (${key})`);
        if (isFarewell) {
          const st = (0, deps.socialState)(key);
          if (st.phase === 'exiting') {
            st.phase = 'idle';
            st.activeDeadlineAt = 0;
            st.activeExitAt = 0;
            (0, deps.log)(`社交模式：${key} 工具发送后退场完成，回到观望`);
          }
        }
        return;
      }
      // 审计（对完整文本执行，避免截断漏判；这里只判断，不发送，避免双重发送）
      const hasKnownToken = [...deps.KNOWN_AGENT_TOKENS].some((t) => t && plain.includes(t));
      if ((0, deps.shouldAuditKey)(key) && (deps.SENSITIVE_RE.test(plain) || hasKnownToken)) {
        (0, deps.log)(`⚠️ 回复被安全策略拦截 (${key})，疑似包含敏感信息${hasKnownToken ? '（含会话令牌）' : ''}`);
        (0, deps.appendActivity)(`${key} agent 回复被拦截（疑似敏感信息${hasKnownToken ? '/会话令牌' : ''}）`);
        if (deps.cfg.security?.interceptNotify !== false) {
          await (0, deps.sendToQQ)(key, '⚠️ 本条回复因疑似包含敏感信息（路径/凭据/会话令牌）被安全策略拦截，已记录并通知管理员。');
        }
        if (isFarewell) {
          const st = (0, deps.socialState)(key);
          if (st.phase === 'exiting') {
            st.phase = 'idle';
            st.activeDeadlineAt = 0;
            st.activeExitAt = 0;
            (0, deps.log)(`社交模式：${key} 退场发言被拦截，回到观望`);
          }
        }
        return;
      }
      // 仿真群友模式：时间线多段发送（主回复 + 可选二次补刀）
      if ((0, deps.isSocialEnabled)()) {
        if ((0, deps.shouldBlockSilentReply)(key)) {
          (0, deps.log)(`静默模式，拦截在途回复 (${key})`);
          (0, deps.appendActivity)(`${key} 静默模式，拦截在途回复`);
          if (isFarewell) {
            const st = (0, deps.socialState)(key);
            if (st.phase === 'exiting') {
              st.phase = 'idle';
              st.activeDeadlineAt = 0;
              st.activeExitAt = 0;
              (0, deps.log)(`社交模式：${key} 静默模式下退场回合被拦截，回到观望`);
            }
          }
          return;
        }
        const timeline = (0, deps.planSocialTimeline)(plain, deps.cfg.social);
        const messages = timeline.main;
        (0, deps.log)(`agent 回复 (${key}) ${plain.length} 字 → ${messages.length} 条`);
        (0, deps.appendActivity)(`${key} agent 回复：${messages[0].slice(0, 80)}${messages.length > 1 ? '（分' + messages.length + '条）' : ''}${messages[0].length > 80 ? '…' : ''}`);
        if (messages.length > 1) {
          await (0, deps.sendBurstToQQ)(key, messages, deps.cfg.social);
        } else {
          await (0, deps.sendToQQ)(key, messages[0]);
        }
        // 发言后刷新活跃时间，并调度可能的二次补刀
        const st = (0, deps.socialState)(key);
        if (isFarewell) {
          // 确认为退场发言：不再刷新活跃时间、不调度补刀，直接进入观望
          st.phase = 'idle';
          st.activeDeadlineAt = 0;
          st.activeExitAt = 0;
          (0, deps.log)(`社交模式：${key} 退场发言完成，进入观望`);
        } else if (st.phase === 'exiting') {
          // 退场期间有旧回复恰好完成：照常发出，但不把它当作退场，也不调度补刀
          (0, deps.log)(`社交模式：${key} 退场期间旧回复完成，保持退场状态`);
        } else {
          if ((0, deps.lastSendSucceeded)(key)) {
            st.lastActiveMessageAt = Date.now();
            st.lastAiReplyAt = Date.now();
            (0, deps.log)(`社交模式：发言完成，刷新活跃时间 (${key})`);
          } else {
            // 发送其实失败了（网关报错/超时/被限流）。旧代码照样刷新时间戳，
            // 于是「我说过话了」这个判断被写进状态：主动发言概率被压低、
            // 活跃调度往前走，而群里根本没收到消息。这里不刷新，让下一轮照常补上。
            (0, deps.log)(`社交模式：${key} 本轮发言未送达（QQ 发送失败），不刷新活跃时间`);
          }
        }
      } else if (deps.currentMode === 'reserved2') {
        (0, deps.log)(`[reserved2] AI 内部输出（不自动转发）(${key}): ${plain.slice(0, 80)}`);
        (0, deps.appendActivity)(`${key} [reserved2] AI 内部输出：${plain.slice(0, 80)}${plain.length > 80 ? '…' : ''}`);
      } else {
        if ((0, deps.shouldBlockSilentReply)(key)) {
          (0, deps.log)(`静默模式，拦截在途回复 (${key})`);
          (0, deps.appendActivity)(`${key} 静默模式，拦截在途回复`);
          return;
        }
        (0, deps.log)(`agent 回复 (${key}) ${plain.length} 字`);
        (0, deps.appendActivity)(`${key} agent 回复：${plain.slice(0, 80)}${plain.length > 80 ? '…' : ''}`);
        // 原生发送自行跟踪真实回执；媒体准备不能阻塞整个DSH事件流。
        if (deps.nativeBinding) void (0, deps.sendToQQ)(key, plain).catch(error => (0, deps.log)('原生回复调度失败:', (error as {message?: unknown} | null)?.message ?? error));
        else await (0, deps.sendToQQ)(key, plain);
      }
    } else if ((ended.reason as LegacyTurnReason).kind === 'error') {
      const msg = (ended.reason as LegacyTurnReason).error?.message ?? '未知错误';
      const safeMsg = (0, deps.shouldAuditKey)(key) && deps.SENSITIVE_RE.test(msg) ? '（含敏感信息，已隐藏）' : msg.slice(0, 500);
      // 以前这里只发 QQ、不写日志：出问题时 bridge.log 里什么都没有，排查只能靠猜（PR #24）。
      (0, deps.log)(`⚠️ agent 处理出错 (${key})：${safeMsg}`);
      (0, deps.appendActivity)(`${key} agent 处理出错：${safeMsg.slice(0, 80)}`);
      await (0, deps.sendToQQ)(key, `⚠️ agent 处理出错：${safeMsg}`);
      if (isFarewell) {
        const st = (0, deps.socialState)(key);
        if (st.phase === 'exiting') {
          st.phase = 'idle';
          st.activeDeadlineAt = 0;
          st.activeExitAt = 0;
          (0, deps.log)(`社交模式：${key} 退场发言出错，回到观望`);
        }
      }
    } else if ((ended.reason as LegacyTurnReason).kind === 'aborted') {
      (0, deps.log)(`⏹️ 回合被中止 (${key})`);
      await (0, deps.sendToQQ)(key, '⏹️ 已停止');
      if (isFarewell) {
        const st = (0, deps.socialState)(key);
        if (st.phase === 'exiting') {
          st.phase = 'idle';
          st.activeDeadlineAt = 0;
          st.activeExitAt = 0;
          (0, deps.log)(`社交模式：${key} 退场发言中止，回到观望`);
        }
      }
    } else if (!ended.text.trim()) {
      // completed 但没文本（纯工具调用回合）
      (0, deps.log)(`回合完成但无文本 (${key})`);
      if (isFarewell) {
        const st = (0, deps.socialState)(key);
        if (st.phase === 'exiting') {
          st.phase = 'idle';
          st.activeDeadlineAt = 0;
          st.activeExitAt = 0;
          (0, deps.log)(`社交模式：${key} 退场回合无文本，回到观望`);
        }
      }
    }
  }
  return { trackTurnEvent, finishSessionTurn };
}
