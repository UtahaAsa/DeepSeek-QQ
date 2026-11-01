// Generated from messaging/send-queue.ts. Edit the TypeScript source and run build:typed.
/**
 * 创建所属桥接共享的串行发送链，供文本、语音、表情及分条发送共同使用。
 * @param {object} options sleep为延迟能力，getNativeDelay在原生发送结束后读取当前间隔。
 * @returns {object} append/recover依次扩展发送链；wait取得当前尾部；enqueueNative返回本次发送结果。
 * @note 不自动重发；原生发送失败仍保留后续间隔。策略检查由排队操作在实际提交前执行。
 */
export function createSendQueue({ sleep, getNativeDelay }) {
    let tail = Promise.resolve();
    const queue = {
        append(operation) { tail = tail.then(operation); return queue; },
        recover(onFailure) { tail = tail.catch(onFailure); return queue; },
        wait() { return tail; },
        enqueueNative(operation) {
            const sent = tail.then(operation);
            tail = sent.catch(() => { }).then(() => sleep(getNativeDelay()));
            return sent;
        }
    };
    return Object.freeze(queue);
}
