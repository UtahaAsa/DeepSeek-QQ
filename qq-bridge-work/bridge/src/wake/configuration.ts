import type {ReadReceiptState} from '../context/read-receipts.js';
/** 仅允许既有触发字段，原始字段值沿用既有转换与真假值规则。 */
export type WakeTriggerKey = 'atMention' | 'nameMention' | 'speakerIds' | 'keywords' | 'question' | 'poke' | 'anyMessage' | 'probability';
export type WakeTriggers = Partial<Record<WakeTriggerKey,unknown>>;
/** 已建立的唤醒配置；原始数字设置仍保留unknown交给既有数值转换。 */
export interface WakeConfig {
  mode?: string; infinite?: boolean; sleepUntil?: string | null; triggers?: WakeTriggers;
  batchWindowMs?: unknown; lastWakeAt?: number; wakeCount?: number; noActionCount?: number;
  confirmedAt?: number; confirmedBy?: string;
}
/** 消息结构切片；正文及时间尚未在本模块规范化。 */
export interface WakeMessage {seq?: unknown; isSelf?: unknown; tail?: unknown; plain?: unknown; text?: unknown; time?: unknown;}
/** 定时器槽名受限，避免取消时误拼字段导致任务残留。 */
export type WakeTimerSlot = 'pendingWakeTimer' | 'sleepTimer' | 'replyCheckTimer' | 'proactiveTimer' | 'rateLimitRetryTimer';
export type WakeTimerHandle = number | {unref?: () => unknown};
/** 配置校正与睡前观察读取的最小状态。 */
export interface WakeConfigurationState<Timer = WakeTimerHandle> {
  key?: string; wakeConfig?: WakeConfig; sleepTimer?: Timer | null; recentMessages?: WakeMessage[];
  lastIncomingAt?: number; preSleepWaitSatisfiedAt?: number; preSleepWaitObservedAt?: number;
}
/** 调度、投递和消息触发共享状态切片；会话对象仍由宿主持有。 */
export interface WakeState<Timer = WakeTimerHandle> extends WakeConfigurationState<Timer>, ReadReceiptState<WakeMessage> {
  agentToken?: unknown; wakeConfig: WakeConfig; wakeTimes: number[]; directWakeSeq?: number;
  pendingWakeReasons?: {reason: string; seq: number}[]; pendingWakeReason?: string | null;
  pendingWakeTimer?: Timer | null; replyCheckTimer?: Timer | null; proactiveTimer?: Timer | null; rateLimitRetryTimer?: Timer | null;
  preSleepWaitAccumMs?: number; lastWakeReason?: string; lastAiReplyAt?: number;
  pendingThoughts?: {expiresAt?: unknown}[];
}
/** 推荐设置属于外部输入，仅已约束的开关使用布尔类型。 */
export interface WakeSettings {
  defaultMode?: unknown; recommendedDefaultInfinite?: unknown; recommendedSleepMinMs?: unknown; recommendedSleepMaxMs?: unknown;
  sleepMinMs?: unknown; sleepMaxMs?: unknown; recommendedAtMention?: unknown; recommendedNameMention?: unknown;
  recommendedKeywords?: unknown; recommendedQuestion?: unknown; recommendedPoke?: unknown; recommendedProbability?: unknown;
  batchWindowMs?: unknown; preSleepWaitEnabled?: unknown; preSleepWaitMs?: unknown;
  directMaxWakePerMinute?: unknown; maxWakePerMinute?: unknown; directMaxWakePerHour?: unknown; maxWakePerHour?: unknown;
}
export interface WakeConfigurationInput {socialV2?: {enabled?: unknown; wake?: WakeSettings|null; autoReplyCheckMs?: unknown;
  proactive?: {enabled?: unknown; checkIntervalMinMs?: unknown; checkIntervalMaxMs?: unknown; idleThresholdMs?: unknown; probability?: unknown}|null};}
/** 使用既有所有权定时器，取消只撤销本实例的任务归属。 */
export interface WakeTimers<State, Timer> {
  schedule: (key: string, state: State, slot: WakeTimerSlot, callback: () => void, delayMs: number) => Timer;
  cancel: (key: string, slot: WakeTimerSlot) => void; cancelOwner: (state: State, slot: WakeTimerSlot) => boolean;
  cancelConversation: (key: string) => void; clear: () => void;
}
/** 构造无IO；Math/Date由宿主注入以维持原时钟与随机数语义。 */
export interface WakeConfigurationDependencies<Timer, State extends WakeConfigurationState<Timer>> {
  readonly cfg: WakeConfigurationInput; readonly Math: Pick<Math,'random'|'max'|'min'|'round'>; readonly Date: DateConstructor;
  readonly socialV2: {conversations: {values: () => IterableIterator<State>}};
  readonly saveSocialV2State: () => void; readonly wakeTimers: Pick<WakeTimers<State,Timer>,'cancelOwner'>;
  readonly clearTimeout: (timer: Timer) => void; readonly setupSleepTimerV2: (key: string) => void;
  readonly log: (message: string) => void;
}
/**
 * 维护唤醒配置、默认值与沉睡观察门槛；不改写显式设置。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createWakeConfiguration<Timer, State extends WakeConfigurationState<Timer>>(deps: WakeConfigurationDependencies<Timer,State>) {
  const WAKE_TRIGGER_KEYS = Object.freeze(['atMention', 'nameMention', 'speakerIds', 'keywords', 'question', 'poke', 'anyMessage', 'probability'] as const);
  const EXPLICIT_END_RE = /(?:不聊了|不说了|晚安|睡了|先睡了|下了|先下了|拜拜|再见|走了|先走|撤了|去忙|忙了|下次再聊|下次聊|散了吧|结束|就到这|先这样|就这样吧|886|88|睡觉了|下班了|去洗澡|去吃饭了)/i;

  // key -> Set<string>

  // 归一化“指定群友发言唤醒”名单：
  // - 只保留正整数 QQ 号（字符串形式），拒绝 null/对象/“null”/非法字符等脏数据；
  // - 去重并限制最多 20 个，避免唤醒名单无限膨胀/被恶意塞入异常值；
  // - undefined/null 都视为“不启用”（空数组）。
  function normalizeSpeakerIdsV2(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    const rawList = Array.isArray(value) ? value : String(value).split(/[,，\s]+/);
    const seen = new Set();
    const clean = [];
    for (const v of rawList) {
      const s = String(v ?? '').trim();
      if (!/^[1-9]\d*$/.test(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      clean.push(s);
      if (clean.length >= 20) break;
    }
    return clean;
  }

  function pickWakeTriggersV2(source: unknown, fallback: unknown = {}): WakeTriggers {
    const out: WakeTriggers = {};
    const src = (source && typeof source === 'object' ? source : {}) as WakeTriggers;
    const fb = (fallback && typeof fallback === 'object' ? fallback : {}) as WakeTriggers;
    for (const name of WAKE_TRIGGER_KEYS) {
      const value = Object.prototype.hasOwnProperty.call(src, name) ? src[name] : fb[name];
      if (value !== undefined) out[name] = value;
    }
    return out;
  }

  function defaultWakeConfigV2() {
    const w = deps.cfg.socialV2?.wake ?? {};
    const defaultMode: 'active' | 'diving' = w.defaultMode === 'active' ? 'active' : 'diving';
    const defaultInfinite = w.recommendedDefaultInfinite !== false;
    const recMin = Number(w.recommendedSleepMinMs) || 300000;
    const recMax = Number(w.recommendedSleepMaxMs) || 7200000;
    let finiteMs = recMin + deps.Math.random() * deps.Math.max(0, recMax - recMin);
    const hardMin = deps.Math.max(0, Number(w.sleepMinMs) || 0);
    const hardMax = Number(w.sleepMaxMs) || 0;
    if (hardMin > 0 && finiteMs < hardMin) finiteMs = hardMin;
    if (hardMax > 0 && finiteMs > hardMax) finiteMs = hardMax;
    return {
      mode: defaultMode,
      infinite: defaultInfinite,
      sleepUntil: defaultInfinite ? null : new deps.Date(deps.Date.now() + deps.Math.round(finiteMs)).toISOString(),
      triggers: {
        atMention: w.recommendedAtMention !== false,
        nameMention: w.recommendedNameMention !== false,
        speakerIds: [],
        keywords: Array.isArray(w.recommendedKeywords) ? w.recommendedKeywords.map(String) : [],
        question: w.recommendedQuestion !== false,
        poke: w.recommendedPoke !== false,
        anyMessage: defaultMode === 'active',
        probability: deps.Math.min(1, deps.Math.max(0, Number(w.recommendedProbability) || 0))
      },
      batchWindowMs: deps.Math.max(1000, Number(w.batchWindowMs) || 2000),
      lastWakeAt: 0,
      wakeCount: 0,
      noActionCount: 0,
      confirmedAt: 0,
      confirmedBy: 'default'
    };
  }

  // 把“仍使用默认唤醒配置”的会话刷新为当前推荐/默认参数。
  // 只有 confirmedBy === 'default' 的会话才会被刷新；AI 或管理员显式设置过的（set_wake_config / mark_read）不会被覆盖。
  function refreshDefaultWakeConfigV2(st: State | null | undefined): boolean {
    if (!st || !st.wakeConfig) return false;
    if (st.wakeConfig.confirmedBy !== 'default') return false;
    const def = defaultWakeConfigV2();
    const old = st.wakeConfig;
    st.wakeConfig = {
      ...def,
      lastWakeAt: old.lastWakeAt || 0,
      wakeCount: old.wakeCount || 0,
      noActionCount: old.noActionCount || 0,
      confirmedAt: old.confirmedAt || 0,
      confirmedBy: 'default'
    };
    return true;
  }

  // 保存推荐/默认参数后，把所有仍使用默认配置的会话同步到新默认值。
  function refreshAllDefaultWakeConfigsV2() {
    let changed = false;
    for (const st of deps.socialV2.conversations.values()) {
      if (refreshDefaultWakeConfigV2(st)) changed = true;
    }
    if (changed) (0, deps.saveSocialV2State)();
    return changed;
  }

  function hasExplicitEndV2(st: WakeConfigurationState | null | undefined): boolean {
    const recent = Array.isArray(st?.recentMessages) ? st.recentMessages : [];
    const last = [...recent].reverse().find((m) => m && !m.isSelf);
    if (!last) return false;
    return EXPLICIT_END_RE.test(String(last.tail || last.plain || last.text || ''));
  }

  function isSleepingConfigV2(wc: WakeConfig | null | undefined): boolean {
    if (!wc) return false;
    if (wc.mode === 'active' || wc.triggers?.anyMessage) return false;
    return true; // diving 且不是 anyMessage 都视为“沉睡/潜水”，需要先观察
  }

  function preSleepWaitBlockedV2(st: WakeConfigurationState | null | undefined): boolean {
    if (!st) return false;
    const w = deps.cfg.socialV2?.wake ?? {};
    if (w.preSleepWaitEnabled === false) return false;
    if (hasExplicitEndV2(st)) return false;
    const waitMs = deps.Math.max(0, Number(w.preSleepWaitMs) || 300000);
    const now = deps.Date.now();
    // 已经连续安静满观察窗口：可以直接设置潜水。
    if ((st.lastIncomingAt || 0) && now - st.lastIncomingAt! >= waitMs) return false;
    // 已经完整等过观察窗口且之后没有新消息：放行。
    if (st.preSleepWaitSatisfiedAt && (!st.lastIncomingAt || st.lastIncomingAt <= st.preSleepWaitSatisfiedAt)) return false;
    // 已经做过一次沉睡前观察（可能等到了新消息并已把新消息返回给 AI），只要 AI 之后没有参与、也没有更新的消息，就允许直接沉睡。
    if (st.preSleepWaitObservedAt && (!st.lastIncomingAt || st.lastIncomingAt <= st.preSleepWaitObservedAt)) return false;
    return true;
  }

  function computeWakeSafetyV2(wc: WakeConfig | null | undefined) {
    const tr = wc?.triggers || {};
    const hard = wc?.mode === 'active' || tr.anyMessage || tr.atMention || tr.nameMention || tr.question || tr.poke ||
      (Array.isArray(tr.keywords) && tr.keywords.length > 0) ||
      normalizeSpeakerIdsV2(tr.speakerIds).length > 0;
    const timed = !wc?.infinite && wc?.sleepUntil && deps.Date.parse(wc.sleepUntil) > deps.Date.now();
    const soft = Number(tr.probability) > 0;
    const guaranteed = hard || timed || soft;
    const confirmedNum = Number(wc?.confirmedAt);
    const stale = !wc?.confirmedAt || !Number.isFinite(confirmedNum) || deps.Date.now() - confirmedNum > 24 * 60 * 60 * 1000;
    return { hard, timed, soft, guaranteed, stale };
  }

  // 防“永眠”：检查当前 WakeConfig 是否至少有一个可触发唤醒的途径；没有则重置为默认配置。
  // opts.skipSave=true 用于加载状态阶段，避免中途落盘覆盖尚未加载的会话。
  function ensureWakeableV2(st: State | null | undefined, opts: {key?: string; skipSave?: boolean} = {}): void {
    if (!st || !st.wakeConfig) return;
    const key = opts.key || st.key;
    const wc = st.wakeConfig;
    if (!wc.triggers || typeof wc.triggers !== 'object') wc.triggers = {};
    const tr = wc.triggers;
    // 掉垃圾数据只留有效 QQ 号，避免“null”/对象等脏值被当成可唤醒条件绕过防永眠。
    tr.speakerIds = normalizeSpeakerIdsV2(tr.speakerIds);
    const timed = !wc.infinite && wc.sleepUntil && Number.isFinite(deps.Date.parse(wc.sleepUntil)) && deps.Date.parse(wc.sleepUntil) > deps.Date.now();
    const wakeable = wc.mode === 'active' || tr.anyMessage || tr.atMention || tr.nameMention || tr.poke ||
      (Array.isArray(tr.keywords) && tr.keywords.length > 0) || tr.question || Number(tr.probability) > 0 ||
      (tr.speakerIds as string[]).length > 0 || timed;
    if (!wakeable) {
      if (st.sleepTimer) {
        if (!deps.wakeTimers.cancelOwner(st, 'sleepTimer')) (0, deps.clearTimeout)(st.sleepTimer);
        st.sleepTimer = null;
      }
      st.wakeConfig = defaultWakeConfigV2();
      if (!opts.skipSave) (0, deps.saveSocialV2State)();
      if (key) (0, deps.setupSleepTimerV2)(key);
      (0, deps.log)(`[reserved2] 唤醒配置无任何触发条件，已重置为默认配置，避免永眠`);
    }
  }
  return { normalizeSpeakerIdsV2, pickWakeTriggersV2, defaultWakeConfigV2, refreshDefaultWakeConfigV2, refreshAllDefaultWakeConfigsV2, hasExplicitEndV2, isSleepingConfigV2, preSleepWaitBlockedV2, computeWakeSafetyV2, ensureWakeableV2 };
}
