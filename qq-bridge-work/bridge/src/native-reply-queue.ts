/// <reference types="node" />
import type {NativeSegment,PreparedNativeReply} from './native-chat.js';
/** 媒体准备携带本次取消信号；实际提交单独排队并再次校验权限。 */
export interface NativeReplyQueueDependencies {
 readonly prepare: (part: NativeSegment[], guard: () => undefined, signal: AbortSignal, key: string) => Promise<PreparedNativeReply>;
 readonly enqueue: (operation: () => Promise<void>) => Promise<unknown>;
 readonly send: (message: NativeSegment[], part: NativeSegment[], key: string) => Promise<unknown>;
 readonly onFailure?: (error: unknown) => void; readonly prepareTimeoutMs?: number; readonly voicePrepareTimeoutMs?: number;
}
/** 每批独立的失败/取消结果；不表示已经撤回原生提交。 */
export interface NativeReplyResult {failed: boolean; cancelled: boolean;}
interface NativeReplyJob {abort: AbortController; preparingVoice: boolean;}
interface NativeReplyError {message?: unknown;}
/**
 * 将媒体准备与实际发送分开；同会话新回复可撤销尚未发送的旧语音。
 * @param {object} options prepare(part,guard,signal,key)只准备消息；enqueue(operation)只串行实际发送。
 *   send(message,part)、onFailure(error)及guard均由所属会话提供；prepareTimeoutMs限制一般媒体准备，
 *   voicePrepareTimeoutMs可为本机合成单独设置有界时限，不占用文字发送槽。
 * @returns {object} submit(key,parts,guard)返回{failed,cancelled}；close撤销所有未提交任务。
 * @note 不自动重发；实际提交后的失败/未知直接记失败，不能降级重复发送。
 */
export function createNativeReplyQueue({ prepare, enqueue, send, onFailure = () => {}, prepareTimeoutMs = 20000, voicePrepareTimeoutMs = prepareTimeoutMs }: NativeReplyQueueDependencies) {
  if (![prepareTimeoutMs, voicePrepareTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0 && value <= 180000)) throw new Error('NATIVE_REPLY_LIMIT_INVALID');
  const active = new Set<NativeReplyJob>(), latest = new Map<string,NativeReplyJob>(); let closed = false;
  async function submit(key: string, parts: NativeSegment[][], guard: () => undefined): Promise<NativeReplyResult> {
    if (closed || active.size >= 32) { onFailure(new Error('NATIVE_REPLY_QUEUE_FULL')); return { failed: true, cancelled: true }; }
    const previous = latest.get(key);
    if (previous?.preparingVoice) previous.abort.abort();
    const job = { abort: new AbortController(), preparingVoice: false };
    latest.set(key, job); active.add(job);
    let failed = false, cancelled = false;
    const current = ():undefined => { guard(); if (closed || job.abort.signal.aborted) throw new Error('NATIVE_REPLY_CANCELLED'); };
    try {
      for (const part of parts) {
        current(); job.preparingVoice = part.some(segment => segment.type === 'voice_text');
        const operation = new AbortController();
        let rejectCancelled!: (error: Error) => void;
        const cancelledTask = new Promise<never>((_, reject) => { rejectCancelled = reject; });
        const cancel = () => { operation.abort(); rejectCancelled(new Error('NATIVE_REPLY_CANCELLED')); };
        job.abort.signal.addEventListener('abort', cancel, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined, preparing = true;
        try {
          const timedOut = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { operation.abort(); reject(new Error('NATIVE_PREPARATION_TIMEOUT')); },
              job.preparingVoice ? voicePrepareTimeoutMs : prepareTimeoutMs);
          });
          const prepared = await Promise.race([prepare(part, current, operation.signal, key), timedOut, cancelledTask]);
          current(); job.preparingVoice = false; preparing = false;
          if (prepared.invalidMentions || prepared.invalidImages || prepared.invalidVoices) failed = true;
          await enqueue(async () => { current(); await send(prepared.message, part, key); });
        } catch (error) {
          failed = true; cancelled = job.abort.signal.aborted || closed;
          onFailure(error);
          if (cancelled) break;
          if (preparing && (error as NativeReplyError | null)?.message === 'NATIVE_PREPARATION_TIMEOUT' && part.length === 1 && part[0].type === 'voice_text') {
            // 此时尚未调用enqueue/send；撤销合成后仅提交本批明确的文字，不会迟到补发语音。
            current(); job.preparingVoice = false;
            await enqueue(async () => { current(); await send([{ type: 'text', data: {
              text: '[语音处理超时，改用文字] ' + (part[0] as Extract<NativeSegment,{type: 'voice_text'}>).data.text } }], part, key); });
          }
        } finally {
          clearTimeout(timer); job.abort.signal.removeEventListener('abort', cancel); operation.abort(); job.preparingVoice = false;
        }
      }
    } catch (error) { failed = true; cancelled = true; onFailure(error); }
    finally { active.delete(job); if (latest.get(key) === job) latest.delete(key); }
    return { failed, cancelled };
  }
  return { submit,
    /** 撤销本批所有待发与准备任务；队列仍可接受新权限版本。@returns {void} 已提交原生的动作无法撤回。 */
    cancelAll() { for (const job of active) job.abort.abort(); latest.clear(); },
    close() { closed = true; for (const job of active) job.abort.abort(); },
    snapshot: () => ({ active: active.size, closed }) };
}
