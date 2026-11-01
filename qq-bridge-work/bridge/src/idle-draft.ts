/// <reference types="node" />
import type {DshCollectorEvent,DshCollectorData} from './dsh/turn-collector.js';
export interface IdleDraftDependencies {create:(signal:AbortSignal)=>Promise<unknown>;prepare:(sid:string,signal:AbortSignal)=>Promise<unknown>;prompt:(sid:string,text:string,signal:AbortSignal)=>Promise<unknown>;follow:(sid:string)=>void;forget:(sid:string)=>void;stop:(sid:string)=>Promise<unknown>;archive:(sid:string)=>Promise<unknown>;timeoutMs?:number;maxPromptChars?:number;}
/** 所有Promise和回调在进入owned/active前初始化，不改变原赋值顺序。 */
interface DraftJob {abort:AbortController;sid:string|null;collector:ReturnType<typeof createTurnCollector>|null;chars:number;settled:boolean;done:Promise<string>;finished:Promise<void>;reject:()=>void;resolve:(value:string)=>void;}
import { createTurnCollector } from './dsh-client.js';
const fail = () => new Error('IDLE_DRAFT_UNAVAILABLE');

/**
 * 管理专属草稿会话；不复用正常聊天会话，不自行调用QQ或重试模型。
 * @param {object} options create/prepare/prompt/follow/forget/stop/archive均只操作本模块创建的会话。
 *   timeoutMs默认60秒，maxPromptChars默认16000；工具调用或输出超过8000字符即拒绝。
 * @returns {object} generate(text,{signal})、handleEvent(sessionId,event)、cancelAll、close及无身份snapshot。
 * @note 单JS线程，只允许一个任务；清理未确认时禁止新任务，迟到创建仍须停止/归档。
 */
export function createIdleDraftRunner({ create, prepare, prompt, follow, forget, stop, archive, timeoutMs = 60000, maxPromptChars = 16000 }:IdleDraftDependencies) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 90000
      || !Number.isSafeInteger(maxPromptChars) || maxPromptChars<16000 || maxPromptChars>256000) throw fail();
  const owned = new Map<string,DraftJob>(), active = new Set<DraftJob>(); let closed = false, cleanupFailed = false, closeTask:Promise<void[]>|undefined;
  async function generate(text:unknown, { signal }:{signal?:AbortSignal} = {}) {
    if (closed || cleanupFailed || active.size || typeof text !== 'string' || text.length > maxPromptChars || signal?.aborted) throw fail();
    const abort = new AbortController(), job = { abort, sid: null, collector: null, chars: 0, settled: false } as DraftJob;
    let resolveDone!:(value:string)=>void, rejectDone!:(error:Error)=>void, finish!:()=>void;
    job.done = new Promise<string>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; }); job.done.catch(() => {});
    job.finished = new Promise<void>(resolve => { finish = resolve; });
    job.reject = () => { if (!job.settled) { job.settled = true; rejectDone(fail()); } };
    job.resolve = value => { if (!job.settled) { job.settled = true; resolveDone(value); } };
    const cancel = () => { abort.abort(); job.reject(); };
    active.add(job); const timer = setTimeout(cancel, timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const sid = await create(abort.signal);
      if (typeof sid !== 'string' || !sid || sid.length > 256 || owned.has(sid)) { cleanupFailed = true; throw fail(); }
      job.sid = sid;
      owned.set(job.sid, job); abort.signal.throwIfAborted();
      await prepare(job.sid, abort.signal); abort.signal.throwIfAborted();
      follow(job.sid); await prompt(job.sid, text, abort.signal); abort.signal.throwIfAborted();
      return await job.done;
    } catch { throw fail(); }
    finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); abort.abort(); job.reject();
      if (job.sid) {
        // 保留owned/active直到清理结束，避免迟到事件转入普通聊天或释放后并行创建。
        try { forget(job.sid); } catch { cleanupFailed = true; }
        try { await stop(job.sid); } catch { cleanupFailed = true; }
        try { await archive(job.sid); } catch { cleanupFailed = true; }
        owned.delete(job.sid);
      }
      active.delete(job); finish();
      if (cleanupFailed) throw fail();
    }
  }
  function handleEvent(sid:string, event:DshCollectorEvent|null|undefined) {
    const job = owned.get(sid); if (!job) return false;
    if (job.settled || job.abort.signal.aborted) return true;
    if (event?.type === 'tool/call' || (event?.type === 'turn/start' && job.collector)) { job.abort.abort(); job.reject(); return true; }
    if (event?.type === 'turn/start') job.collector = createTurnCollector();
    if (event?.type === 'assistant/message') {
      for (const block of (event.data as DshCollectorData|null)?.message?.content ?? []) if (block?.type === 'text') job.chars += String(block.text ?? '').length;
      if (job.chars > 8000) { job.abort.abort(); job.reject(); return true; }
    }
    try {
      const ended = job.collector?.push(event!);
      if (ended) { if ((ended.reason as {kind?:unknown}|null)?.kind === 'completed') job.resolve(ended.text); else job.reject(); }
    } catch { job.reject(); }
    return true;
  }
  function cancelAll() { for (const job of active) { job.abort.abort(); job.reject(); } }
  return { generate, handleEvent, cancelAll,
    close() { if (!closeTask) { closed = true; cancelAll(); closeTask = Promise.all([...active].map(job => job.finished)); } return closeTask; },
    snapshot: () => ({ closed, active: active.size, cleanupFailed }) };
}
