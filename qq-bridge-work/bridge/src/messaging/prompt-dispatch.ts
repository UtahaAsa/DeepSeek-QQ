import type {SessionRegistry} from '../sessions/creation.js';
import type {ReceiptMessage} from '../context/read-receipts.js';
/** 媒体与原生观察身份由宿主解释；泛型保持入队和投递两端的类型一致。 */
export interface PromptOptions<Media = unknown, Identity = unknown> {
  farewell?: boolean; silent?: boolean; media?: Media[]; wakeReason?: string;
  nativeGeneration?: number; nativeObservationIdentity?: Identity; offlineCurrent?: () => boolean;
}
/** 输入内容首项始终为文本，后续可为媒体解析产生的文本或图片。 */
export interface PromptText { type: 'text'; text: string; }
export interface PromptImage { type: 'image'; mediaType: string; data: string; name?: string; }
export type PromptContent = [PromptText, ...(PromptText | PromptImage)[]];
/** 旧消费代码的回执结构投影；不是RPC客户端已完成业务校验的承诺。 */
export interface PromptResponse { result:
  {ok: true; value: {command?: {text?: string} | null}} |
  {ok: false; error: {code: string; message: string}};
}
export interface PromptApi { sessions: {prompt: (request: {sessionId: string; mode: 'queue'; content: PromptContent}) => Promise<unknown>}; }
/** 成功只表示原有投递结果，queued/retried/skipped均不代表远端已执行。 */
export type PromptResult = {ok: false; error: string} | {ok: true; skipped?: true; queued?: true; retried?: true; command?: boolean};
/** 只声明提交回执读取或更新的状态，不取得整个社交状态的所有权。 */
export interface PromptWakeState { agentToken: string; lastUnreadSeq: number; lastWakeInputSeq?: number; }
export interface PromptWakeSnapshot<Message extends ReceiptMessage = ReceiptMessage> { messages: Message[]; recent: Message[]; }
/** 实时getter保留异步边界后的权限复核；构造此依赖视图不执行IO。 */
export interface PromptDispatchDependencies<Media = unknown, Identity = unknown, Capabilities = unknown,
  Wake extends PromptWakeState = PromptWakeState, Message extends ReceiptMessage = ReceiptMessage, Api extends PromptApi = PromptApi> {
  /** 保留宿主已有日志注入；具体日志仍由下层操作记录。 */
  readonly log?:(...values:unknown[])=>void;
  readonly nativeBinding: unknown; readonly nativePolicyCurrent: boolean; readonly nativePolicyGeneration: number;
  readonly nativeObservationCurrent: (key: string, identity: Identity) => boolean;
  readonly isSessionAllowedInCurrentMode: (key: string) => boolean;
  readonly currentMode: string; readonly cfg: {socialV2?: {enabled?: unknown}};
  readonly socialV2: {paused: boolean; conversations: {get: (key: string) => Wake | undefined}};
  readonly pendingWakeKeys: {delete: (key: string) => boolean}; readonly disarmPendingWakeLease: (key: string) => void;
  readonly dshReady: boolean;
  readonly offlineQueue: {enqueue: (key: string, text: string, options: PromptOptions<Media,Identity>) => void};
  readonly state: Pick<SessionRegistry,'sessions'>; readonly traceNativeReceive: (phase: string) => void;
  readonly ensureSession: (key: string) => Promise<string>;
  readonly enqueueForRetry: (key: string, text: string, options: PromptOptions<Media,Identity>) => void;
  readonly nativeTurnFence: {has: (sessionId: string) => boolean; open: (sessionId: string, baseline: number) => void}|null;
  readonly stopBridgeSessionWork: (sessionId: string, reason: string) => Promise<unknown>;
  readonly readNativeTurnBaseline: (api: Api, sessionId: string) => Promise<number>; readonly api: Api;
  readonly getSocialV2State: (key: string) => Wake;
  readonly buildWakePromptV2: (key: string, reason: string) => string;
  readonly buildWakeSnapshotV2: (key: string) => PromptWakeSnapshot<Message> | null | undefined;
  readonly withSlangContext: (text: string) => string;
  readonly resolveMediaList: (media: Media[]) => Promise<(PromptText | PromptImage)[]>;
  readonly buildNativeFeatureHints: (key: string) => string;
  readonly nativeCapabilities: Capabilities|null; readonly nativeChatHint: (kind: string, capabilities: Capabilities) => string;
  readonly isCurrentSession: (key: string, sessionId: string) => boolean;
  readonly social: {exitingSessions: Pick<Set<string>, 'add' | 'delete'>};
  readonly shouldAuditKey: (key: string) => boolean; readonly SENSITIVE_RE: RegExp;
  readonly sendToQQ: (key: string, text: string) => Promise<unknown>;
  readonly canonicalV2Key: (key: string) => string|null|undefined;
  readonly noteModelMessagesV2: (state: Wake, messages: Message[]) => void;
  readonly auditAndSend: (key: string, text: string) => Promise<unknown>; readonly mdToPlain: (text: string) => string;
}
/** 返回可等待的投递结果；权限变化、RPC异常沿Promise拒绝传播。 */
export type PromptDispatcher<Media = unknown, Identity = unknown> = (key: string, text: string, options?: PromptOptions<Media,Identity>) => Promise<PromptResult>;
/**
 * 执行一次prompt投递，队列由独立模块负责；每次await后继续核对当前权限与会话。
 * @param {object} deps 实时依赖视图；getter避免模式、代次、配置在异步期间变成旧快照。
 * @returns {object|function} 所属实例的操作；错误语义与原调用方保持一致。
 * @note 不启动服务、不安装依赖。
 */
export function createPromptDispatcher<Media, Identity, Capabilities, Wake extends PromptWakeState, Message extends ReceiptMessage, Api extends PromptApi>(deps: PromptDispatchDependencies<Media,Identity,Capabilities,Wake,Message,Api>): PromptDispatcher<Media,Identity> {

  // 实际的 DSH prompt 投递（不再直接对外暴露，统一走 promptQueues 串行队列）。
  async function deliverPromptNow(key: string, promptText: string, opts: PromptOptions<Media,Identity> = {}): Promise<PromptResult> {
    const checkNativePolicy = () => {
      if (opts.offlineCurrent && !opts.offlineCurrent()) throw new Error('OFFLINE_QUEUE_INVALIDATED');
      if (deps.nativeBinding && (!deps.nativePolicyCurrent || opts.nativeGeneration !== deps.nativePolicyGeneration)) throw new Error('NATIVE_POLICY_CHANGED');
      if (opts.nativeObservationIdentity && !(0, deps.nativeObservationCurrent)(key, opts.nativeObservationIdentity)) throw new Error('NATIVE_OBSERVATION_UNCONFIRMED');
    };
    checkNativePolicy();
    if (!(0, deps.isSessionAllowedInCurrentMode)(key)) throw new Error(`当前模式不允许会话 ${key}`);
    // Recheck queued wakes at dispatch time: no model call while paused/disabled
    // and no reserved2 prompt leaking into an ordinary chat after a mode switch.
    const wakeBlocked = () => opts.wakeReason && (deps.currentMode !== 'reserved2' || deps.socialV2.paused || deps.cfg.socialV2?.enabled === false);
    const skipWake = (): PromptResult => {
      deps.pendingWakeKeys.delete(key);
      (0, deps.disarmPendingWakeLease)(key);
      return { ok: true, skipped: true };
    };
    if (wakeBlocked()) return skipWake();
    if (!deps.dshReady) {
      if (opts.nativeObservationIdentity) return { ok: false, error: 'NATIVE_OBSERVATION_UNCONFIRMED' };
      deps.offlineQueue.enqueue(key,promptText,{farewell:!!opts.farewell,silent:!!opts.silent,media:opts.media??[],wakeReason:opts.wakeReason});
      return { ok: true, queued: true };
    }
    let sessionId;
    const previousSessionId = deps.state.sessions[key];
    try {
      (0, deps.traceNativeReceive)('session_begin');
      sessionId = await (0, deps.ensureSession)(key);
      (0, deps.traceNativeReceive)('session_end');
    } catch (error) {
      if (String((error as {message?: unknown} | null)?.message ?? error).includes('会话创建期间已重置')) {
        checkNativePolicy();
        (0, deps.enqueueForRetry)(key, promptText, opts);
        return { ok: true, retried: true };
      }
      throw error;
    }
    if (deps.nativeBinding && !deps.nativeTurnFence!.has(sessionId)) {
      let baseline = -1;
      if (sessionId === previousSessionId) {
        await (0, deps.stopBridgeSessionWork)(sessionId, 'native-baseline');
        baseline = await (0, deps.readNativeTurnBaseline)(deps.api, sessionId);
      }
      checkNativePolicy(); deps.nativeTurnFence!.open(sessionId, baseline);
    }
    checkNativePolicy();
    let wakeState: Wake | undefined;
    let wakeToken: string | undefined;
    let wakeSnapshot: PromptWakeSnapshot<Message> | null | undefined;
    let wakeInputSeq = 0;
    if (opts.wakeReason) {
      if (wakeBlocked()) return skipWake();
      // Build only after session creation: retries may rotate the token, and an
      // offline queue may have received more messages since this wake was queued.
      wakeState = (0, deps.getSocialV2State)(key);
      wakeToken = wakeState.agentToken;
      wakeInputSeq = Number.isSafeInteger(wakeState.lastUnreadSeq) ? wakeState.lastUnreadSeq : 0;
      promptText = (0, deps.buildWakePromptV2)(key, opts.wakeReason);
      wakeSnapshot = (0, deps.buildWakeSnapshotV2)(key);
      if (wakeSnapshot) {
        promptText += `\n\n【本次消息快照】\n${JSON.stringify(wakeSnapshot)}\n以上消息已提供，无需重复查询；partial=true 时用 qq_get_unread_messages(afterSeq=readThroughSeq) 继续读取。先处理当前消息；回复前如需确认后续补充，用 qq_wait_for_messages(purpose="reply") 补足短静默，已安静够久会立即返回，不要先长等。收尾只确认你已处理的 readThroughSeq（本地 seq，非 QQ messageId），传给 qq_mark_read 或 qq_set_wake_config 的 throughSeq；新到消息留待处理。`;
      }
    }
    let content: PromptContent = [{ type: 'text', text: (0, deps.withSlangContext)(promptText) }];
    if (Array.isArray(opts.media) && opts.media.length > 0) {
      const imageParts = await (0, deps.resolveMediaList)(opts.media);
      content = [{ type: 'text', text: (0, deps.withSlangContext)(promptText) }, ...imageParts];
    }
    if (deps.nativeBinding) {
      content[0].text += (0, deps.buildNativeFeatureHints)(key);
      if (deps.currentMode === 'reserved2') content[0].text += (0, deps.nativeChatHint)(key.split(':')[0], deps.nativeCapabilities!)
        .replace('普通聊天的回复由桥接自动发送，无需另调用发送工具。', '本模式通过发送工具发言；图片、语音标记可放入qq_send_message或qq_send_native_message的正文。');
    }
    checkNativePolicy();
    // 媒体解析成功后再标记退场，避免解析异常时残留退场标记。
    if (!(0, deps.isCurrentSession)(key, sessionId)) throw new Error('投递前会话已重置或权限已变化');
    if (opts.farewell) deps.social.exitingSessions.add(sessionId);
    let accepted;
    try {
      (0, deps.traceNativeReceive)('prompt_begin');
      accepted = await deps.api.sessions.prompt({ sessionId, mode: 'queue', content }) as PromptResponse;
      (0, deps.traceNativeReceive)('prompt_end');
      checkNativePolicy();
    } catch (error) {
      if (opts.farewell) deps.social.exitingSessions.delete(sessionId);
      throw error;
    }
    if (!accepted.result.ok) {
      if (opts.farewell) deps.social.exitingSessions.delete(sessionId);
      const errText = `${accepted.result.error.code}: ${accepted.result.error.message}`;
      const safeErrText = (0, deps.shouldAuditKey)(key) && deps.SENSITIVE_RE.test(errText) ? '（含敏感信息，已隐藏）' : errText;
      if (!opts.silent) await (0, deps.sendToQQ)(key, `⚠️ 消息未被接受：${safeErrText}`);
      return { ok: false, error: safeErrText };
    }
    if (wakeState && (0, deps.isCurrentSession)(key, sessionId)
      && deps.socialV2.conversations.get((0, deps.canonicalV2Key)(key) as string) === wakeState
      && wakeState.agentToken === wakeToken) {
      // Acceptance grants visibility, never acknowledgement. New arrivals and
      // rejected/stale deliveries must not be cleared by an old cursor.
      // 输入触发已交给本轮，不等于消息正文全部可确认已读；只记提交前捕获的输入序号。
      wakeState.lastWakeInputSeq = Math.max(wakeState.lastWakeInputSeq || 0, wakeInputSeq);
      if (wakeSnapshot) (0, deps.noteModelMessagesV2)(wakeState, [...wakeSnapshot.messages, ...wakeSnapshot.recent]);
    }
    if (accepted.result.value.command?.text && !opts.silent && deps.currentMode !== 'reserved2') {
      if (opts.farewell) deps.social.exitingSessions.delete(sessionId);
      await (0, deps.auditAndSend)(key, (0, deps.mdToPlain)(accepted.result.value.command.text));
    } else if (accepted.result.value.command?.text && opts.silent && opts.farewell) {
      deps.social.exitingSessions.delete(sessionId);
    }
    return { ok: true, command: Boolean(accepted.result.value.command) };
  }
  return deliverPromptNow;
}
