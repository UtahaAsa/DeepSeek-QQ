/// <reference types="node" />
import type {SendQueue} from './send-queue.js';
import type {NativeSegment,NativePreparationBot,PreparedNativeReply} from '../native-chat.js';
/** 旧OneBot和原生消息的共同发送边界，外部回执保持unknown。 */
export type OutgoingMessage = string | NativeSegment | NativeSegment[];
type PreparedReply = Omit<PreparedNativeReply,'message'> & {message: OutgoingMessage};
export interface ReplyTransportBot extends NativePreparationBot {
 readonly sendPrivateMessage: (id: string | number, message: OutgoingMessage, options?: {timeoutMs: number}) => Promise<unknown>;
 readonly sendGroupMessage: (id: string | number, message: OutgoingMessage, options?: {timeoutMs: number}) => Promise<unknown>;
}
/** 合成必须接收本次会话守卫；可取消准备不等于已取消原生发送。 */
export interface ReplyVoice {readonly synthesize: (key: string, speech: string, guard: () => undefined, options?: {signal: AbortSignal}) => Promise<NativeSegment>;}
export interface ReplyTransport {bot: ReplyTransportBot; nativeVoice?: ReplyVoice | null;}
/** getTransport按实际发送读取，结果与批次表由所属发送器持有。 */
interface ReplySenderOptions {
 readonly sendQueue: SendQueue; readonly nativeBinding: unknown; readonly nativeVoice?: ReplyVoice | null; readonly bot?: ReplyTransportBot;
 readonly cfg: {sendDelayMs: unknown}; readonly captureSendGuard: (key: string) => () => undefined;
 readonly redactKnownTokensOnly: (text: string) => string; readonly splitForQQ: (text: string) => string[];
 readonly text: (text: string) => OutgoingMessage; readonly escapeCqText: (text: string) => string;
 readonly withTimeout: <Result>(task: Promise<Result>, ms: number, label: string) => Promise<Result>;
 readonly SEND_TIMEOUT_MS: number; readonly sleep: (ms: number) => Promise<unknown>;
 readonly log: (message: string, error?: unknown) => void; readonly lastSendFailed?: Map<string,boolean>;
 readonly getTransport?: () => ReplyTransport;
}
/** 必须提供即时bot或实时传输读取器，禁止创建永远没有传输的发送器。 */
export type ReplySenderDependencies = ReplySenderOptions & (
 {readonly getTransport: () => ReplyTransport} | {readonly bot: ReplyTransportBot}
);
interface LegacyReplyError {message?: unknown;}
import {createNativeReplyQueue} from '../native-reply-queue.js';
import {nativeChatMessages,prepareNativeReply} from '../native-chat.js';
/**
 * 组合文本回复准备、共享发送链与每会话结果；原生新批次不会被旧回执覆盖。
 * @param {object} options 所属传输、权限守卫、消息转换和日志能力；sendQueue必须与媒体发送共享。
 * getTransport在使用时返回bot/nativeVoice，避免提前读取尚未初始化的组件。
 * lastSendFailed仅供隔离测试注入；默认由此组件创建，提供给旧分条调用方记账及会话清理。
 * @returns {object} sendToQQ、lastSendSucceeded、lastSendFailed、所属nativeReplyQueue及共享批次表nativeSendBatches。
 * @note 构造不发消息；nativeReplyQueue的关闭由宿主生命周期负责。提交失败不自动重发。
 */
export function createReplySender({sendQueue,nativeBinding,nativeVoice,bot,cfg,captureSendGuard,redactKnownTokensOnly,
  splitForQQ,text,escapeCqText,withTimeout,SEND_TIMEOUT_MS,sleep,log,lastSendFailed=new Map(),getTransport=()=>({bot,nativeVoice} as ReplyTransport)}: ReplySenderDependencies) {
  const nativeSendBatches = new Map<string,symbol>();
  const enqueueNativeSend=<Result>(operation: () => Result | PromiseLike<Result>)=>sendQueue.enqueueNative(operation);
  const nativeReplyQueue = nativeBinding ? createNativeReplyQueue({
    // 本机合成可能超过通用媒体的20秒；文字先发，语音准备有界且随新消息可取消。
    voicePrepareTimeoutMs: 150000,
    prepare: (part, guard, signal, key) => {
      const {bot,nativeVoice}=getTransport();
      const [kind, target] = key.split(':');
      return prepareNativeReply(part, bot, { kind, target,
        synthesize: nativeVoice ? speech => nativeVoice.synthesize(key, speech, guard, { signal }) : undefined });
    },
    enqueue: enqueueNativeSend,
    send: async (message, part, key) => {
      const {bot}=getTransport();
      const [kind, id] = key.split(':');
      const timeout = part.some(segment => segment.type === 'image') ? Math.max(SEND_TIMEOUT_MS, 35000) : SEND_TIMEOUT_MS;
      if (kind === 'private') await withTimeout(bot.sendPrivateMessage(id, message, { timeoutMs: timeout }), timeout, `QQ发送 ${kind}:${id}`);
      else await withTimeout(bot.sendGroupMessage(id, message, { timeoutMs: timeout }), timeout, `QQ发送 ${kind}:${id}`);
    },
    onFailure: error => log('QQ 原生回复未全部完成:', (error as LegacyReplyError | null)?.message ?? error),
  }) : null;


  function sendToQQ(key: string, msg: string) {
    const {bot,nativeVoice}=getTransport();
    const assertSendAllowed = captureSendGuard(key);
    const safeMsg = redactKnownTokensOnly(msg);
    const [kind, id] = key.split(':');
    const parts = nativeBinding ? nativeChatMessages(safeMsg, kind) : splitForQQ(safeMsg);
    lastSendFailed.delete(key);
    if (nativeReplyQueue) {
      const batch = Symbol(); nativeSendBatches.set(key, batch);
      return nativeReplyQueue.submit(key, parts as NativeSegment[][], assertSendAllowed).then(result => {
        if (nativeSendBatches.get(key) === batch) {
          if (result.failed) lastSendFailed.set(key, true);
          nativeSendBatches.delete(key);
        }
      });
    }
    for (const part of parts) {
      sendQueue.append(async () => {
          assertSendAllowed();
          const prepared: PreparedReply = nativeBinding ? await prepareNativeReply(part as NativeSegment[], bot, {
            kind, target: id,
            synthesize: nativeVoice ? (speech) => nativeVoice.synthesize(key, speech, assertSendAllowed) : undefined,
          }) : { message: text(escapeCqText(part as string)), invalidImages: 0 };
          if (prepared.invalidMentions || prepared.invalidImages || prepared.invalidVoices) lastSendFailed.set(key, true);
          assertSendAllowed();
          const message = prepared.message;
          const timeout = nativeBinding && (part as NativeSegment[]).some((segment) => segment.type === 'image') ? Math.max(SEND_TIMEOUT_MS, 35000) : SEND_TIMEOUT_MS;
          if (kind === 'private') await withTimeout(bot.sendPrivateMessage(nativeBinding ? id : Number(id), message, { timeoutMs: timeout }), timeout, `QQ发送 ${kind}:${id}`);
          else await withTimeout(bot.sendGroupMessage(nativeBinding ? id : Number(id), message, { timeoutMs: timeout }), timeout, `QQ发送 ${kind}:${id}`);
        })
        .recover((error) => {
          lastSendFailed.set(key, true);
          log(`QQ 发送失败 (${key}):`, (error as LegacyReplyError | null)?.message ?? error);
        })
        .append(() => sleep(nativeBinding ? Math.max(3000, cfg.sendDelayMs as number) : cfg.sendDelayMs as number));
    }
    return sendQueue.wait();
  }

  /** 上一批发往该会话的消息是否全部成功。 */
  function lastSendSucceeded(key: string) {
    return lastSendFailed.get(key) !== true;
  }


  return {sendToQQ,lastSendSucceeded,lastSendFailed,nativeReplyQueue,enqueueNativeSend,nativeSendBatches};
}
