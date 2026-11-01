import type {WakeState, WakeMessage, WakeConfig, WakeTriggers, WakeTimerHandle} from '../wake/configuration.js';
/** 媒体保留传输与表情识别字段，不只保留模型展示字段。 */
export interface StoredMedia {kind: 'face' | 'sticker' | 'image'; file?: string; url?: string; faceId?: string; emojiId?: string; summary?: string; subType?: string;}
/** 旧消息及模型压缩前的结构切片；正文和外部标识未校验时保持unknown。 */
export interface StoredMessage extends WakeMessage {
  sender?: unknown; user_id?: unknown; userId?: unknown; messageId?: unknown; kind?: string;
  quoteTargetIsSelf?: boolean; isOwner?: boolean; ownerLabel?: string;
  media?: StoredMedia[]; hasMedia?: boolean; forwardIds?: unknown[]; hasForward?: boolean;
  poke?: {targetId: string | null; targetIsSelf: boolean; groupId: string | null};
}
/** 记忆元素沿旧持久化结构保留原始字段，消费者继续按原规则转换。 */
export interface StoredTopic {text?: unknown; participants?: unknown[]; lastMentionAt?: number; pendingQuestion?: unknown;}
export interface StoredThought {text?: unknown; expiresAt?: unknown; motivation?: unknown;}
/** 二代状态的内存视图，沿用可变兼容对象；定时器和模型展示水位不可持久化。 */
export interface SocialV2State<Timer = WakeTimerHandle> extends WakeState<Timer> {
  agentToken: string; bootstrapSent: boolean; recentMessages: StoredMessage[]; unread: StoredMessage[];
  lastWakeReason: string; lastAiReplyAt: number; lastActionAt: number; sendTimes: number[]; stickerCollectTimes: number[];
  lastIncomingAt: number; preSleepWaitSatisfiedAt: number; preSleepWaitObservedAt: number; preSleepWaitAccumMs: number;
  lastReadThroughSeq: number; modelSeenSeqs: Set<number>; activeTopics: StoredTopic[]; pendingThoughts: StoredThought[];
  memberImpressions: Record<string,unknown>;
}
/** 明确列出既有落盘字段；不使用Omit避免以后新增内存字段意外进入落盘契约。 */
export type PersistedConversation = Pick<SocialV2State,
  'wakeConfig'|'recentMessages'|'unread'|'lastWakeReason'|'lastAiReplyAt'|'lastActionAt'|'agentToken'|'bootstrapSent'|
  'wakeTimes'|'sendTimes'|'stickerCollectTimes'|'lastIncomingAt'|'preSleepWaitSatisfiedAt'|'preSleepWaitObservedAt'|
  'preSleepWaitAccumMs'|'lastUnreadSeq'|'lastReadThroughSeq'|'activeTopics'|'pendingThoughts'|'memberImpressions'> & {seenForwardIds: string[]};
export interface PersistedSocialV2 {paused: boolean; conversations: Record<string,PersistedConversation>;}
/** 读取函数输出保持unknown。下方Legacy类型断言仅描述旧逻辑已作的结构假设，不增加校验。 */
interface LegacyConversation extends Record<string,unknown> {wakeConfig?: WakeConfig | null;}
interface LegacyFile {paused?: unknown; conversations?: unknown;}
/** 文件、令牌、配置及调度能力由宿主提供，构造实例不读写文件。 */
export interface V2StateStoreDependencies<Timer> {
  readonly canonicalV2Key: (key: unknown) => string | null | undefined;
  readonly defaultWakeConfigV2: () => WakeConfig;
  readonly crypto: {randomBytes: (size: number) => {toString: (encoding: 'hex') => string}};
  readonly rememberAgentToken: (key: string, token: string) => void;
  readonly scheduleProactiveCheckV2: (key: string) => void; readonly setupSleepTimerV2: (key: string) => void;
  readonly fs: {statSync: (file: string) => {size: number; mtimeMs: number}}; readonly SOCIAL_V2_FILE: string;
  readonly readJsonSafe: (file: string, fallback: null) => unknown;
  readonly pickWakeTriggersV2: (source: unknown, fallback?: unknown) => WakeTriggers;
  readonly normalizeSpeakerIdsV2: (source: unknown) => string[];
  readonly refreshDefaultWakeConfigV2: (state: SocialV2State<Timer>) => boolean;
  readonly ensureWakeableV2: (state: SocialV2State<Timer>, options: {skipSave: boolean; key: string}) => void;
  readonly sanitizeForwardId: (value: unknown) => string;
  readonly seenForwardIds: Pick<Map<string,Set<string>>,'get'|'set'>;
  readonly Math: Pick<Math,'min'>; readonly log: (...values: unknown[]) => void;
  readonly atomicWriteJson: (file: string, value: PersistedSocialV2) => void;
}
/** 获取会话可能创建内存态与调度任务；加载/保存错误按原日志路径处理。 */
export interface V2StateStore<Timer> {
  readonly getSocialV2State: (key: string) => SocialV2State<Timer>;
  readonly loadSocialV2State: () => void; readonly saveSocialV2State: () => undefined;
  readonly state: {conversations: Map<string,SocialV2State<Timer>>; paused: boolean};
}
/**
 * 持有二代会话状态表及兼容持久化投影；定时器只保留在内存。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createV2StateStore<Timer = WakeTimerHandle>(deps: V2StateStoreDependencies<Timer>): V2StateStore<Timer> {

  const socialV2 = { conversations: new Map<string,SocialV2State<Timer>>(), paused: false };
  function getSocialV2State(key: string): SocialV2State<Timer> {
    // 只允许内部约定的会话 key 格式，并统一成无前导零的正整数形式，防止同一会话分裂成多个状态。
    const canonical = (0, deps.canonicalV2Key)(key);
    if (!canonical) {
      const err: Error & {statusCode?: number} = new Error(`无效的会话 key：${String(key ?? '')}`);
      err.statusCode = 400;
      throw err;
    }
    key = canonical;
    let st = socialV2.conversations.get(key);
    if (!st) {
      st = {
        wakeConfig: (0, deps.defaultWakeConfigV2)(),
        recentMessages: [],
        unread: [],
        lastWakeReason: '',
        lastAiReplyAt: 0,
        lastActionAt: 0,
        agentToken: deps.crypto.randomBytes(16).toString('hex'),
        bootstrapSent: false,
        wakeTimes: [],
        sendTimes: [],
        stickerCollectTimes: [],
        pendingWakeTimer: null,
        sleepTimer: null,
        replyCheckTimer: null,
        proactiveTimer: null,
        rateLimitRetryTimer: null,
        lastIncomingAt: 0,
        preSleepWaitSatisfiedAt: 0,
        preSleepWaitObservedAt: 0,
        preSleepWaitAccumMs: 0,
        lastUnreadSeq: 0,
        lastReadThroughSeq: 0,
        modelSeenSeqs: new Set<number>(),
        activeTopics: [],
        pendingThoughts: [],
        memberImpressions: {}
      };
      (0, deps.rememberAgentToken)(key, st.agentToken);
      socialV2.conversations.set(key, st);
      (0, deps.scheduleProactiveCheckV2)(key);
      (0, deps.setupSleepTimerV2)(key);
    }
    return st;
  }

  function loadSocialV2State() {
    try {
      // 记下读取时刻的文件指纹。加载末尾会统一落盘一次（为了让 ensureWakeableV2
      // 中途的改动不丢），但如果这期间**别的进程**已经写过这个文件，我们手上的
      // 内存态就是旧的 —— 再写回去等于把它那份更新的状态覆盖掉。
      // 这不是假想：日志里出现过两个桥接实例同时启动，第二个实例在加载后立刻回写，
      // 把第一个实例刚更新的读水位/唤醒时间/转发 id 全部退回旧值。
      const fileStamp = (() => {
        try {
          const s = deps.fs.statSync(deps.SOCIAL_V2_FILE);
          return `${s.size}:${s.mtimeMs}`;
        } catch {
          return null;
        }
      })();
      const raw = (0, deps.readJsonSafe)(deps.SOCIAL_V2_FILE, null) as LegacyFile | null;
      socialV2.paused = raw?.paused === true;
      if (raw && typeof raw.conversations === 'object') {
        const seenTokens = new Set();
        for (const [key, val] of Object.entries(raw.conversations as Record<string,LegacyConversation>)) {
          if (!val || typeof val !== 'object') continue;
          if (!/^(group|private):\d+$/.test(key)) continue;
          const defaultWc = (0, deps.defaultWakeConfigV2)();
          let agentToken = String(val.agentToken || deps.crypto.randomBytes(16).toString('hex'));
          if (!agentToken || seenTokens.has(agentToken)) {
            agentToken = deps.crypto.randomBytes(16).toString('hex');
          }
          seenTokens.add(agentToken);
          const st: SocialV2State<Timer> = {
            wakeConfig: {
              ...defaultWc,
              ...(val.wakeConfig ?? {}),
              // 加载时也按已知字段过滤：旧状态文件里可能残留任意键（见 WAKE_TRIGGER_KEYS）。
              triggers: (0, deps.pickWakeTriggersV2)((val.wakeConfig?.triggers) ?? {}, defaultWc.triggers)
            },
            recentMessages: Array.isArray(val.recentMessages) ? val.recentMessages as StoredMessage[] : [],
            unread: Array.isArray(val.unread) ? val.unread as StoredMessage[] : [],
            lastWakeReason: String(val.lastWakeReason ?? ''),
            lastAiReplyAt: Number(val.lastAiReplyAt) || 0,
            lastActionAt: Number(val.lastActionAt) || 0,
            agentToken,
            bootstrapSent: !!val.bootstrapSent,
            wakeTimes: Array.isArray(val.wakeTimes) ? val.wakeTimes as number[] : [],
            sendTimes: Array.isArray(val.sendTimes) ? val.sendTimes as number[] : [],
            stickerCollectTimes: Array.isArray(val.stickerCollectTimes) ? val.stickerCollectTimes as number[] : [],
            pendingWakeTimer: null,
            sleepTimer: null,
            replyCheckTimer: null,
            proactiveTimer: null,
            lastIncomingAt: Number(val.lastIncomingAt) || 0,
            preSleepWaitSatisfiedAt: Number(val.preSleepWaitSatisfiedAt) || 0,
            preSleepWaitObservedAt: Number(val.preSleepWaitObservedAt) || 0,
            preSleepWaitAccumMs: Number(val.preSleepWaitAccumMs) || 0,
            lastUnreadSeq: Number(val.lastUnreadSeq) || 0,
            lastReadThroughSeq: Number.isSafeInteger(val.lastReadThroughSeq) && (val.lastReadThroughSeq as number) >= 0
              ? deps.Math.min(val.lastReadThroughSeq as number, Number(val.lastUnreadSeq) || 0) : 0,
            modelSeenSeqs: new Set<number>(),
            activeTopics: Array.isArray(val.activeTopics) ? val.activeTopics as StoredTopic[] : [],
            pendingThoughts: Array.isArray(val.pendingThoughts) ? val.pendingThoughts as StoredThought[] : [],
            memberImpressions: (() => {
              const rawImp = (val.memberImpressions && typeof val.memberImpressions === 'object') ? val.memberImpressions : {};
              const clean: Record<string,unknown> = {};
              for (const [k, v] of Object.entries(rawImp)) {
                if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
                clean[k] = v;
              }
              return clean;
            })()
          };
          // 旧状态/异常状态里的指定成员名单也统一归一化，防止“null”/非法值污染。
          if (st.wakeConfig?.triggers && typeof st.wakeConfig.triggers === 'object') {
            st.wakeConfig.triggers.speakerIds = (0, deps.normalizeSpeakerIdsV2)(st.wakeConfig.triggers.speakerIds);
            if (key.startsWith('private:')) st.wakeConfig.triggers.speakerIds = [];
          }
          // 仍使用默认唤醒配置的会话，在重启加载时同步到当前推荐/默认参数。
          (0, deps.refreshDefaultWakeConfigV2)(st);
          (0, deps.rememberAgentToken)(key, st.agentToken);
          socialV2.conversations.set(key, st);
          // 重启后从已持久化的消息与 seenForwardIds 字段重建“本会话见过的 forward id”
          {
            const rebuilt = new Set<string>();
            if (Array.isArray(val.seenForwardIds)) {
              for (const fid of val.seenForwardIds) {
                const safe = (0, deps.sanitizeForwardId)(fid);
                if (safe) rebuilt.add(safe);
              }
            }
            for (const m of [...(st.recentMessages || []), ...(st.unread || [])]) {
              if (Array.isArray(m?.forwardIds)) {
                for (const fid of m.forwardIds) {
                  const safe = (0, deps.sanitizeForwardId)(fid);
                  if (safe) rebuilt.add(safe);
                }
              }
            }
            if (rebuilt.size) deps.seenForwardIds.set(key, rebuilt);
          }
          (0, deps.ensureWakeableV2)(st, { skipSave: true, key });
          (0, deps.scheduleProactiveCheckV2)(key);
        }
        // 加载阶段统一落盘一次，避免 ensureWakeableV2 中途写盘覆盖未加载会话。
        // 但只有在文件仍是「我们读到的那一份」时才写：否则说明有另一个进程写过它，
        // 我们手里的内存态已经过时，回写会静默吞掉对方的新数据。
        const nowStamp = (() => {
          try {
            const s = deps.fs.statSync(deps.SOCIAL_V2_FILE);
            return `${s.size}:${s.mtimeMs}`;
          } catch {
            return null;
          }
        })();
        if (fileStamp !== null && nowStamp !== null && fileStamp !== nowStamp) {
          (0, deps.log)('⚠️ state/social-v2.json 在本次加载期间被其它进程改写，跳过回写以免覆盖更新的状态（是否误开了第二个桥接实例？）');
        } else {
          saveSocialV2State();
        }
      }
    } catch (error) {
      (0, deps.log)('读取 socialV2 状态失败:', (error as {message?: unknown} | null)?.message ?? error);
    }
  }

  function saveSocialV2State():undefined {
    try {
      const obj: PersistedSocialV2 = { paused: socialV2.paused, conversations: Object.create(null) };
      for (const [key, st] of socialV2.conversations) {
        obj.conversations[key] = {
          wakeConfig: st.wakeConfig,
          recentMessages: st.recentMessages.slice(-200),
          unread: st.unread.slice(-100),
          lastWakeReason: st.lastWakeReason,
          lastAiReplyAt: st.lastAiReplyAt,
          lastActionAt: st.lastActionAt,
          agentToken: st.agentToken,
          bootstrapSent: st.bootstrapSent,
          wakeTimes: st.wakeTimes.slice(-200),
          sendTimes: st.sendTimes.slice(-500),
          stickerCollectTimes: Array.isArray(st.stickerCollectTimes) ? st.stickerCollectTimes.slice(-500) : [],
          lastIncomingAt: st.lastIncomingAt || 0,
          preSleepWaitSatisfiedAt: st.preSleepWaitSatisfiedAt || 0,
          preSleepWaitObservedAt: st.preSleepWaitObservedAt || 0,
          preSleepWaitAccumMs: st.preSleepWaitAccumMs || 0,
          lastUnreadSeq: st.lastUnreadSeq || 0,
          lastReadThroughSeq: st.lastReadThroughSeq || 0,
          activeTopics: Array.isArray(st.activeTopics) ? st.activeTopics.slice(-50) : [],
          pendingThoughts: Array.isArray(st.pendingThoughts) ? st.pendingThoughts.slice(-50) : [],
          memberImpressions: st.memberImpressions && typeof st.memberImpressions === 'object' ? st.memberImpressions : {},
          seenForwardIds: Array.from(deps.seenForwardIds.get(key) || []).slice(-1000)
        };
      }
      (0, deps.atomicWriteJson)(deps.SOCIAL_V2_FILE, obj);
    } catch (error) {
      (0, deps.log)('保存 socialV2 状态失败:', (error as {message?: unknown} | null)?.message ?? error);
    }
  }
  return { getSocialV2State, loadSocialV2State, saveSocialV2State, state: socialV2 };
}
