// Generated from messaging/reply-sender.ts. Edit the TypeScript source and run build:typed.
import { createNativeReplyQueue } from '../native-reply-queue.js';
import { nativeChatMessages, prepareNativeReply } from '../native-chat.js';
/**
 * 组合文本回复准备、共享发送链与每会话结果；原生新批次不会被旧回执覆盖。
 * @param {object} options 所属传输、权限守卫、消息转换和日志能力；sendQueue必须与媒体发送共享。
 * getTransport在使用时返回bot/nativeVoice，避免提前读取尚未初始化的组件。
 * lastSendFailed仅供隔离测试注入；默认由此组件创建，提供给旧分条调用方记账及会话清理。
 * @returns {object} sendToQQ、lastSendSucceeded、lastSendFailed、所属nativeReplyQueue及共享批次表nativeSendBatches。
 * @note 构造不发消息；nativeReplyQueue的关闭由宿主生命周期负责。提交失败不自动重发。
 */
export function createReplySender({ sendQueue, nativeBinding, nativeVoice, bot, cfg, captureSendGuard, redactKnownTokensOnly, splitForQQ, text, escapeCqText, withTimeout, SEND_TIMEOUT_MS, sleep, log, lastSendFailed = new Map(), getTransport = () => ({ bot, nativeVoice }) }) {
    const nativeSendBatches = new Map();
    const enqueueNativeSend = (operation) => sendQueue.enqueueNative(operation);
    const nativeReplyQueue = nativeBinding ? createNativeReplyQueue({
        // 本机合成可能超过通用媒体的20秒；文字先发，语音准备有界且随新消息可取消。
        voicePrepareTimeoutMs: 150000,
        prepare: (part, guard, signal, key) => {
            const { bot, nativeVoice } = getTransport();
            const [kind, target] = key.split(':');
            return prepareNativeReply(part, bot, { kind, target,
                synthesize: nativeVoice ? speech => nativeVoice.synthesize(key, speech, guard, { signal }) : undefined });
        },
        enqueue: enqueueNativeSend,
        send: async (message, part, key) => {
            const { bot } = getTransport();
            const [kind, id] = key.split(':');
            const timeout = part.some(segment => segment.type === 'image') ? Math.max(SEND_TIMEOUT_MS, 35000) : SEND_TIMEOUT_MS;
            if (kind === 'private')
                await withTimeout(bot.sendPrivateMessage(id, message, { timeoutMs: timeout }), timeout, `QQ发送 ${kind}:${id}`);
            else
                await withTimeout(bot.sendGroupMessage(id, message, { timeoutMs: timeout }), timeout, `QQ发送 ${kind}:${id}`);
        },
        onFailure: error => log('QQ 原生回复未全部完成:', error?.message ?? error),
    }) : null;
    function sendToQQ(key, msg) {
        const { bot, nativeVoice } = getTransport();
        const assertSendAllowed = captureSendGuard(key);
        const safeMsg = redactKnownTokensOnly(msg);
        const [kind, id] = key.split(':');
        const parts = nativeBinding ? nativeChatMessages(safeMsg, kind) : splitForQQ(safeMsg);
        lastSendFailed.delete(key);
        if (nativeReplyQueue) {
            const batch = Symbol();
            nativeSendBatches.set(key, batch);
            return nativeReplyQueue.submit(key, parts, assertSendAllowed).then(result => {
                if (nativeSendBatches.get(key) === batch) {
                    if (result.failed)
                        lastSendFailed.set(key, true);
                    nativeSendBatches.delete(key);
                }
            });
        }
        for (const part of parts) {
            sendQueue.append(async () => {
                assertSendAllowed();
                const prepared = nativeBinding ? await prepareNativeReply(part, bot, {
                    kind, target: id,
                    synthesize: nativeVoice ? (speech) => nativeVoice.synthesize(key, speech, assertSendAllowed) : undefined,
                }) : { message: text(escapeCqText(part)), invalidImages: 0 };
                if (prepared.invalidMentions || prepared.invalidImages || prepared.invalidVoices)
                    lastSendFailed.set(key, true);
                assertSendAllowed();
                const message = prepared.message;
                const timeout = nativeBinding && part.some((segment) => segment.type === 'image') ? Math.max(SEND_TIMEOUT_MS, 35000) : SEND_TIMEOUT_MS;
                if (kind === 'private')
                    await withTimeout(bot.sendPrivateMessage(nativeBinding ? id : Number(id), message, { timeoutMs: timeout }), timeout, `QQ发送 ${kind}:${id}`);
                else
                    await withTimeout(bot.sendGroupMessage(nativeBinding ? id : Number(id), message, { timeoutMs: timeout }), timeout, `QQ发送 ${kind}:${id}`);
            })
                .recover((error) => {
                lastSendFailed.set(key, true);
                log(`QQ 发送失败 (${key}):`, error?.message ?? error);
            })
                .append(() => sleep(nativeBinding ? Math.max(3000, cfg.sendDelayMs) : cfg.sendDelayMs));
        }
        return sendQueue.wait();
    }
    /** 上一批发往该会话的消息是否全部成功。 */
    function lastSendSucceeded(key) {
        return lastSendFailed.get(key) !== true;
    }
    return { sendToQQ, lastSendSucceeded, lastSendFailed, nativeReplyQueue, enqueueNativeSend, nativeSendBatches };
}
