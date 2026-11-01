/// <reference types="node" />
import type {NativeReadApi,NativeReadResponse,NativePageRecord,NativeTrackedTurn,NativeTerminalTurn,NativeTerminalReason} from './native/contracts.js';
export type NativeObservationTimer=ReturnType<typeof setTimeout>|number;
type NativeClearTimer=(timer:NativeObservationTimer|null)=>void;
export interface NativeWakeResult {retry?:unknown;retryAfterMs?:unknown;accepted?:unknown;throughSeq?:unknown;inputThroughSeq?:unknown;}
export interface NativeObservationArm<Identity> {baseline:number;latestSeq:number;lastInputAt?:number;windowMs:number;quietMs:number;identity:Identity;}
interface ObservationEntry<Identity> {key:string;baseline:number;latestSeq:number;quietMs:number;identity:Identity;startedAt:number;expiresAt:number;lastInputAt:number;pending:boolean;claiming:boolean;timer:NativeObservationTimer|null;expiry:NativeObservationTimer|null;}
export interface NativeObservationOptions<Identity> {
 readonly isCurrent:(key:string,identity:Identity)=>boolean;readonly readThrough:(key:string,identity:Identity)=>unknown;
 readonly onWake:(key:string,identity:Identity,latestSeq:number,isOwned:()=>boolean)=>Promise<NativeWakeResult|null|void>;
 readonly onSilence?:(key:string,identity:Identity)=>void;readonly now?:()=>number;
 readonly setTimer?:(callback:()=>void,delay:number)=>NativeObservationTimer;readonly clearTimer?:NativeClearTimer;
}
/** 观察回执不含身份、正文或令牌；类型参数使同一观察的身份贯穿所有回调。 */
export interface NativeBackgroundObservation<Identity> {
 arm:(key:string,value:NativeObservationArm<Identity>)=>{background:true;windowMs:number;quietMs:number;expiresAt:number};
 receive:(key:string,seq:unknown)=>boolean;has:(key:string)=>boolean;cancel:(key:string)=>void;cancelAll:()=>void;
 snapshot:(key:string)=>{active:false}|{active:true;pending:boolean;claiming:boolean;remainingMs:number};
}
const validKey = (key:string) => /^(?:group|private):[1-9]\d{0,19}$/.test(key ?? '');
const validSeq = (value:unknown):value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const failed = () => new Error('NATIVE_OBSERVATION_UNCONFIRMED');

/**
 * 管理原生二代的后台观察；只保存水位、时间与调用方的内存身份，不保存消息正文。
 * @param {object} options isCurrent复核身份/模式/许可；readThrough返回模型实际见过的水位。
 *   onWake第四参数只核对观察所有权，调用方须在异步提交前复核；返回accepted/throughSeq、retry/retryAfterMs。
 *   可选inputThroughSeq仅消费已提交的输入触发，不授予已读；异常不自动重试。
 *   onSilence在无新输入到期时执行；时钟与计时器可注入以便隔离验证。
 * @returns {object} arm/receive/has/cancel/cancelAll/snapshot；最多128个会话。
 * @note 单线程异步；旧计时器或旧异步回调不能删除替代观察；取消不触发任何外发。
 */
export function createNativeBackgroundObservation<Identity>({ isCurrent, readThrough, onWake, onSilence = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout as NativeClearTimer }:NativeObservationOptions<Identity> = {} as NativeObservationOptions<Identity>):NativeBackgroundObservation<Identity> {
  if (![isCurrent, readThrough, onWake].every(value => typeof value === 'function')) throw failed();
  const entries = new Map<string,ObservationEntry<Identity>>();
  function cancel(key:string) {
    const entry = entries.get(key); if (!entry) return;
    entries.delete(key); clearTimer(entry.timer); clearTimer(entry.expiry);
  }
  const current = (entry:ObservationEntry<Identity>) => entries.get(entry.key) === entry && now() >= entry.startedAt && isCurrent(entry.key, entry.identity) === true;
  function schedule(entry:ObservationEntry<Identity>, delay:number) {
    clearTimer(entry.timer);
    entry.timer = setTimer(() => { void deliver(entry); }, Math.max(1, delay)); (entry.timer as {unref?:()=>unknown}|null)?.unref?.();
  }
  async function deliver(entry:ObservationEntry<Identity>) {
    if (!current(entry)) { if (entries.get(entry.key) === entry) cancel(entry.key); return; }
    if (entry.claiming) return;
    const through = readThrough(entry.key, entry.identity);
    if (!validSeq(through)) { cancel(entry.key); return; }
    entry.baseline = Math.max(entry.baseline, through);
    if (entry.latestSeq <= entry.baseline) {
      entry.pending = false;
      if (now() >= entry.expiresAt) { cancel(entry.key); onSilence(entry.key, entry.identity); }
      return;
    }
    if (now() - entry.lastInputAt < entry.quietMs) { schedule(entry, entry.quietMs - (now() - entry.lastInputAt)); return; }
    if (now() > entry.expiresAt + 120000) { cancel(entry.key); return; }
    entry.claiming = true;
    let result:NativeWakeResult|null|undefined;
    try { result = await onWake(entry.key, entry.identity, entry.latestSeq, () => entries.get(entry.key) === entry) as NativeWakeResult|null|undefined; }
    catch { if (entries.get(entry.key) === entry) cancel(entry.key); return; }
    if (!current(entry)) { if (entries.get(entry.key) === entry) cancel(entry.key); return; }
    entry.claiming = false;
    if (result?.retry === true) {
      const requested = Number(result.retryAfterMs);
      schedule(entry, Number.isFinite(requested) ? Math.min(60000, Math.max(1000, Math.round(requested))) : 1000);
      return;
    }
    if (result?.accepted !== true || !validSeq(result.throughSeq)) { cancel(entry.key); return; }
    const inputThrough = result.inputThroughSeq ?? result.throughSeq;
    if (!validSeq(inputThrough) || result.inputThroughSeq !== undefined && inputThrough > entry.latestSeq) { cancel(entry.key); return; }
    entry.baseline = Math.max(entry.baseline, result.throughSeq, inputThrough);
    if (entry.latestSeq > entry.baseline) schedule(entry, entry.quietMs);
    else cancel(entry.key);
  }
  return {
    /**
     * 将已授权观察交给后台；不会直接调用onWake，只注册有界计时器。
     * @param {string} key 已授权会话。@param {object} value baseline/latestSeq为本地消息水位，identity只留内存。
     * @returns {object} 无身份、正文或令牌的观察回执；参数不合法时固定错误。
     */
    arm(key:string, { baseline, latestSeq, lastInputAt, windowMs, quietMs, identity }:NativeObservationArm<Identity> = {} as NativeObservationArm<Identity>) {
      if (!validKey(key) || !validSeq(baseline) || !validSeq(latestSeq) || latestSeq < baseline
        || !Number.isSafeInteger(windowMs) || windowMs < 100 || windowMs > 600000
        || !Number.isSafeInteger(quietMs) || quietMs < 0 || quietMs > 120000
        || !entries.has(key) && entries.size >= 128 || !isCurrent(key, identity)) throw failed();
      cancel(key);
      const startedAt = now();
      const entry:ObservationEntry<Identity> = { key, baseline, latestSeq, quietMs, identity, startedAt, expiresAt: startedAt + windowMs,
        lastInputAt: Number.isFinite(lastInputAt) ? Math.min(startedAt, lastInputAt!) : startedAt,
        pending: latestSeq > baseline, claiming: false, timer: null, expiry: null };
      entries.set(key, entry);
      entry.expiry = setTimer(() => {
        if (!current(entry)) { if (entries.get(key) === entry) cancel(key); return; }
        if (entry.pending || entry.claiming) { schedule(entry, 1); return; }
        cancel(key); onSilence(key, identity);
      }, windowMs); (entry.expiry as {unref?:()=>unknown}|null)?.unref?.();
      if (entry.pending) schedule(entry, Math.max(1, quietMs - (startedAt - entry.lastInputAt)));
      return { background: true, windowMs, quietMs, expiresAt: entry.expiresAt };
    },
    /** @param {string} key 已授权会话。@param {number} seq 新输入水位。@returns {boolean} 是否由当前后台观察接管；不读取正文。 */
    receive(key:string, seq:unknown) {
      const entry = entries.get(key);
      if (!entry || !current(entry) || now() > entry.expiresAt || !validSeq(seq)) {
        if (entry && (!current(entry) || now() > entry.expiresAt)) cancel(key);
        return false;
      }
      if (seq > entry.latestSeq) {
        entry.latestSeq = seq; entry.lastInputAt = now(); entry.pending = true;
        if (!entry.claiming) schedule(entry, entry.quietMs);
      }
      return true;
    },
    /** @param {string} key 会话。@returns {boolean} 当前是否存在有效后台观察。 */
    has(key:string) { const entry = entries.get(key); return Boolean(entry && current(entry)); },
    /** @param {string} key 会话。@returns {void} 只撤销所属观察，不发言、不改已读水位。 */
    cancel,
    /** @returns {void} 撤销全部计时器，不改原模型、声音、会话和消息。 */
    cancelAll() { for (const key of entries.keys()) cancel(key); },
    /** @param {string} key 会话。@returns {object} 无身份和正文的状态摘要。 */
    snapshot(key:string) {
      const entry = entries.get(key);
      return !entry || !current(entry) ? { active: false } : { active: true, pending: entry.pending,
        claiming: entry.claiming, remainingMs: Math.max(0, entry.expiresAt - now()) };
    },
  };
}

/**
 * 按固定DSH契约只读核对当前所跟踪回合是否已经结束；不激活Agent，不请求模型、不回放历史正文。
 * @param {object} api 所属DSH客户端。@param {string} sessionId 当前自有会话。
 * @param {object} tracked turn/startSeq是本权限版本已接受的回合标识。
 * @returns {Promise<object|null>} 匹配的最新结束元数据；迁移中/形状未知/已出现下一轮时返回null。
 * @note 两次只读RPC；调用方必须在await前后复核会话、权限代次与tracked对象身份。
 */
export async function readNativeTerminalTurn(api:NativeReadApi, sessionId:unknown, tracked:NativeTrackedTurn|null|undefined):Promise<NativeTerminalTurn|null> {
  if (typeof sessionId !== 'string' || !sessionId || !Number.isSafeInteger(tracked?.turn) || (tracked!.turn as number) < 1
    || !validSeq(tracked!.startSeq)) return null;
  try {
    const projection = await api.callUnary('session/projections', { sessionId }) as NativeReadResponse|null;
    const value = projection?.result?.ok ? projection.result.value : null;
    if (value?.kind !== 'sequenced' || !validSeq(value.asOfSeq) || value.asOfSeq <= tracked!.startSeq) return null;
    const response = await api.callUnary('session/page', { address: { kind: 'session', sessionId },
      throughSeq: value.asOfSeq, maxMessages: 1 }) as NativeReadResponse|null;
    const records = response?.result?.ok ? response.result.value?.records : null;
    if (!Array.isArray(records) || records.length > 128) return null;
    for (const record of [...records].reverse() as NativePageRecord[]) {
      const event = record?.type === 'event' ? record.event : null;
      if (!event || !validSeq(event.seq) || event.seq > value.asOfSeq || event.seq <= tracked!.startSeq) continue;
      if (!['turn/start', 'turn/end'].includes(event.type as string)) continue;
      if (event.type !== 'turn/end' || event.data?.turn !== tracked!.turn
        || !['completed', 'aborted', 'error'].includes(event.data?.reason?.kind as string)) return null;
      return { type: 'turn/end', seq: event.seq, data: { turn: tracked!.turn as number, reason: { kind: event.data!.reason!.kind as NativeTerminalReason } } };
    }
    return null;
  } catch { return null; }
}
