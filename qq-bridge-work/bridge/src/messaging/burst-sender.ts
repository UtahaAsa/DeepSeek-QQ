import type {SendQueue} from './send-queue.js';
import type {ReplyTransportBot,OutgoingMessage} from './reply-sender.js';
import type {NativeSegment} from '../native-chat.js';
import type {createNativeReplyQueue} from '../native-reply-queue.js';
/** 旧式和二代分条共享发送队列；引用与提及保持外部输入，沿用既有转换。 */
export interface BurstSenderDependencies {
 readonly getTransport: () => {bot: ReplyTransportBot; nativeBinding?: unknown; nativeReplyQueue?: ReturnType<typeof createNativeReplyQueue> | null};
 readonly sendQueue: SendQueue; readonly lastSendFailed: Map<string,boolean>;
 readonly onebotSend: (kind: string, id: string, message: string, replyToMessageId?: unknown, atUserId?: unknown) => Promise<unknown>;
 readonly captureSendGuard: (key: string) => () => undefined; readonly redactKnownTokensOnly: (text: string) => string;
 readonly text: (text: string) => OutgoingMessage; readonly escapeCqText: (text: string) => string;
 readonly withTimeout: <Result>(task: Promise<Result>, ms: number, label: string) => Promise<Result>;
 readonly SEND_TIMEOUT_MS: number; readonly randInt: (min: number, max: number) => number;
 readonly sleep: (ms: number) => Promise<unknown>; readonly log: (message: string, error?: unknown) => void; readonly random?: () => number;
}
interface BurstSendError extends Error {sent?: string[];}
interface LegacyBurstError {message?: unknown;}
import {nativeChatMessages} from '../native-chat.js';
import {normalizeBurstTiming} from './burst-timing.js';
/**
 * 组合旧式、二代与原生分条发送，所有分支沿用所属桥接的发送队列与权限守卫。
 * @param {object} options getTransport延迟提供bot/nativeBinding/nativeReplyQueue，避免启动顺序依赖。
 * sendQueue、lastSendFailed、onebotSend及转换/日志/延迟回调由所属实例提供；random供隔离验证。
 * @returns {object} sendBurstToQQ返回旧式已发送条目；sendMessagesV2/sendNativeMessagesV2在失败时附带error.sent。
 * @note 不重试、不补发；引用与at只用于首条；保留各分支原有失败处理与等待语义。
 */
export function createBurstSender({getTransport,sendQueue,lastSendFailed,onebotSend,captureSendGuard,redactKnownTokensOnly,
  text,escapeCqText,withTimeout,SEND_TIMEOUT_MS,randInt,sleep,log,random=()=>Math.random()}: BurstSenderDependencies) {
  function sendBurstToQQ(key: string, messages: string[], socialCfgOrMin: unknown, maybeMax?: unknown) {
    const {bot,nativeBinding}=getTransport();
    const assertSendAllowed = captureSendGuard(key);
    const [kind, id] = key.split(':');
    const {min,max,longProb,longMin,longMax}=normalizeBurstTiming(socialCfgOrMin,maybeMax);

    const sent: string[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = redactKnownTokensOnly(messages[i]);
      const isLast = i === messages.length - 1;
      sendQueue.append(async () => {
          assertSendAllowed();
          if (kind === 'private') await withTimeout(bot.sendPrivateMessage(nativeBinding ? id : Number(id), text(escapeCqText(msg))), SEND_TIMEOUT_MS, `QQ发送 ${kind}:${id}`);
          else await withTimeout(bot.sendGroupMessage(nativeBinding ? id : Number(id), text(escapeCqText(msg))), SEND_TIMEOUT_MS, `QQ发送 ${kind}:${id}`);
          sent.push(msg);
        })
        .recover((error) => {
          log(`QQ 发送失败 (${key}):`, (error as LegacyBurstError | null)?.message ?? error);
          // 与 sendToQQ 同样的失败记账。少了这一步，调用方 `lastSendSucceeded(key)`
          // 会把「一条都没发出去」当成「我已经说过话了」：刷新 lastActiveMessageAt /
          // lastAiReplyAt 并抑制后续接话，而群里什么都没收到 —— 静默丢回复。
          lastSendFailed.set(key, true);
        });
      if (!isLast) {
        const useLong = longProb > 0 && random() < longProb;
        const delay = useLong ? randInt(longMin, longMax) : randInt(min, max);
        sendQueue.append(() => sleep(delay));
      }
    }
    return sendQueue.wait().then(() => sent);
  }


  async function sendNativeMessagesV2(key: string, messages: string[], delays: number[], replyToMessageId?: unknown, atUserId?: unknown) {
    const {nativeReplyQueue}=getTransport();
    const guard = captureSendGuard(key), sent: string[] = [];
    for (let index = 0; index < messages.length; index++) {
      guard(); const parts = nativeChatMessages(redactKnownTokensOnly(messages[index]), key.split(':')[0]);
      if (parts.length && index === 0) {
        const prefix: NativeSegment[] = [];
        if (replyToMessageId != null) prefix.push({ type: 'reply', data: { id: String(replyToMessageId) } });
        if (atUserId != null) prefix.push({ type: 'at', data: { qq: String(atUserId) } });
        parts[0].unshift(...prefix);
      }
      const result = await nativeReplyQueue!.submit(key, parts, guard);
      if (result.failed) { const error: BurstSendError = new Error('NATIVE_SEND_UNCONFIRMED'); error.sent = sent; throw error; }
      sent.push(messages[index]);
      if (index < delays.length) await sleep(delays[index]);
    }
    return sent;
  }

  function sendMessagesV2(key: string, messages: string[], delays: number[], replyToMessageId?: unknown, atUserId: unknown = null) {
    if (getTransport().nativeReplyQueue) return sendNativeMessagesV2(key, messages, delays, replyToMessageId, atUserId);
    const assertSendAllowed = captureSendGuard(key);
    const [kind, id] = key.split(':');
    const sent: string[] = [];
    const failed: unknown[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const useReply = i === 0 ? replyToMessageId : null;
      const useAt = i === 0 ? atUserId : null;
      sendQueue.append(async () => {
          assertSendAllowed();
          await onebotSend(kind, id, msg, useReply, useAt);
          sent.push(msg);
        })
        .recover((error) => {
          log(`QQ 发送失败 (${key}):`, (error as LegacyBurstError | null)?.message ?? error);
          failed.push(error);
        });
      if (i < delays.length) {
        const d = delays[i];
        sendQueue.append(() => sleep(d));
      }
    }
    return sendQueue.wait().then(() => {
      if (failed.length > 0) {
        const err: BurstSendError = new Error(`QQ 发送失败 ${failed.length}/${messages.length} 条：${(failed[0] as LegacyBurstError | null)?.message ?? '未知错误'}`);
        err.sent = sent.slice();
        throw err;
      }
      return sent;
    });
  }


  return Object.freeze({sendBurstToQQ,sendMessagesV2,sendNativeMessagesV2});
}
