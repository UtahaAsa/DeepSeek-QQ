/// <reference types="node" />
export interface NativeIdleDependencies {bot:{isConnected:boolean;raw:(action:string,payload:Record<string,unknown>,options:{timeoutMs:number})=>Promise<unknown>};ready:(key:string)=>boolean;captureGuard:(key:string)=>()=>undefined;generate:(prompt:string,options:{signal:AbortSignal})=>Promise<unknown>;submit:(group:string,claim:unknown,text:string,guard:()=>undefined)=>Promise<unknown>;roleHint?:()=>string;audit?:(text:string,key:string)=>undefined;onSent?:(key:string,text:string)=>undefined;intervalMs?:number;}
interface IdleJob {group:string;abort:AbortController;phase:'claiming'|'generating'|'submitting';}
interface IdleEvent {group_id?:unknown;sender?:{card?:unknown;nickname?:unknown};raw_message?:unknown;}
const validGroup = (value:unknown):value is string => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const safeLine = (value:unknown) => Array.from(String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ')).slice(0, 240).join('');

/**
 * 原生冷场轮询：网关决定资格，本模块只生成草稿并提交一次；不阻塞普通消息。
 * @param {object} options bot为所属OneBot，ready(key)和captureGuard(key)须核验实时模式/角色/发送权限。
 *   generate(prompt,{signal})只能使用无工具草稿会话；submit(group,claim,text,guard)须共用普通发送队列。
 *   roleHint/audit/onSent不执行模型动作；intervalMs默认60秒，定时器不维持进程存活。
 * @returns {object} start/tick/observeMessage/activity/cancel/close/snapshot；构造不启动轮询。
 * @note 单JS线程，一个草稿，最多128群各8条短上下文。失败/静默/取消不退还网关预算，不自动补发。
 */
export function createNativeIdleLoop({ bot, ready, captureGuard, generate, submit, roleHint = () => '', audit = () => {},
  onSent = () => {}, intervalMs = 60000 }:NativeIdleDependencies) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 10 || intervalMs > 300000) throw Error('IDLE_LOOP_INVALID');
  const contexts = new Map<string,string[]>(), lastSent = new Map<string,string>(); let closed = false, timer:ReturnType<typeof setInterval>|null = null, running:Promise<void>|null = null, active:IdleJob|null = null;
  const counters = { checks: 0, drafts: 0, sent: 0, cancelled: 0, failed: 0, silent: 0 };
  function activity(group:unknown) { if (active?.group === String(group) && active.phase !== 'submitting') active.abort.abort(); }
  function observeMessage(event:IdleEvent|null|undefined) {
    const group = String(event?.group_id ?? ''); if (!validGroup(group)) return;
    activity(group);
    if (!contexts.has(group) && contexts.size >= 128) return;
    const lines = contexts.get(group) ?? [];
    lines.push(safeLine(event!.sender?.card || event!.sender?.nickname || '群友') + '：' + safeLine(event!.raw_message));
    contexts.set(group, lines.slice(-8));
  }
  async function run() {
    if (closed || !bot.isConnected) return;
    counters.checks++;
    try {
      const result = await bot.raw('get_idle_group_candidates', {}, { timeoutMs: 3000 }) as {groups?:unknown[]}|null;
      if (!Array.isArray(result?.groups) || result.groups.length > 16 || result.groups.some(group => !validGroup(group))) throw Error();
      for (const group of result.groups as string[]) {
        const key = 'group:' + group;
        if (closed || !ready(key)) continue;
        const guard = captureGuard(key); guard();
        active = { group, abort: new AbortController(), phase: 'claiming' };
        const claim = await bot.raw('claim_idle_group', { group_id: group }, { timeoutMs: 3000 }) as {claim?:unknown}|null; guard();
        if (closed || active.abort.signal.aborted) { counters.cancelled++; return; }
        if (!/^qqidle_[a-f0-9]{48}$/.test((claim?.claim ?? '') as string)) throw Error();
        active.phase = 'generating'; counters.drafts++;
        const prompt = Array.from(roleHint()).slice(0, 8000).join('') + '\n【当前群的近期上下文，仅供参考】\n'
          + (contexts.get(group) ?? []).join('\n')
          + '\n群里已长时间无人发言。请按角色自然开启一个简短话题，不要编造群里发生的事情。只输出一条280字以内普通文字，不用工具、提及或媒体标记；不适合开口时只输出[SILENT]。';
        const text = String(await generate(prompt, { signal: active.abort.signal })).trim();
        if (active.abort.signal.aborted || closed || !ready(key)) { counters.cancelled++; return; }
        guard();
        if (!text || text === '[SILENT]') { counters.silent++; return; }
        if (Array.from(text).length > 280 || /\[\[qq-|\[CQ:|```|[\x00-\x08\x0b-\x1f]/i.test(text)) throw Error();
        audit(text, key); active.phase = 'submitting';
        await submit(group, claim!.claim, text, () => { if (closed || active!.abort.signal.aborted || !ready(key)) throw Error('IDLE_CANCELLED'); guard(); });
        counters.sent++;
        if (!closed) { if (lastSent.has(group) || lastSent.size < 128) lastSent.set(group, text); onSent(key, text); }
        return;
      }
    } catch { if (active?.abort.signal.aborted || closed) counters.cancelled++; else counters.failed++; }
    finally { active = null; }
  }
  function tick() {
    if (closed || running) return running ?? Promise.resolve();
    running = run().finally(() => { running = null; }); return running;
  }
  function cancel() { active?.abort.abort(); }
  return { tick, observeMessage, activity, cancel, recentSent: (group:unknown) => lastSent.get(String(group)) ?? '',
    start() { if (!closed && !timer) { timer = setInterval(() => { void tick(); }, intervalMs); timer.unref?.(); } },
    close() { closed = true; clearInterval(timer!); timer = null; cancel(); contexts.clear(); lastSent.clear(); return running ?? Promise.resolve(); },
    snapshot: () => ({ ...counters, closed, activeDraft: active !== null, trackedGroups: contexts.size }) };
}
