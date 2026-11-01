/// <reference types="node" />
import type {TokenLedgerOptions,LedgerBase,LedgerSample,RetryAxis,LedgerEvicted,LedgerEvent,LedgerProjection,EventInput,BaselineInput,SnapshotInput} from './usage/ledger-contracts.js';
interface LedgerError {message?:unknown;}
import {sampleKeyOf,BUCKET_LADDER_MS,pickBucketMs,usageFromStream,usageOfEvent} from './usage/ledger-protocol.js';
export {BUCKET_LADDER_MS,pickBucketMs,usageFromStream,usageOfEvent} from './usage/ledger-protocol.js';
import {createLedgerIndex} from './usage/ledger-index.js';
import {createLedgerQueries} from './usage/ledger-queries.js';
import {createLedgerTimeline} from './usage/ledger-timeline.js';
// Token 用量账本：把 DSH 会话事件里的 provider usage 落成「按会话 × 按回合」的可查明细，
// 并在读取时用价目表折算成金额。
//
// 为什么这样设计（三条约束决定了实现形态）：
//
// 1. **权威总量来自 DSH 的 tokenUsage 投影，不来自桥接自己累加。**
//    `session/follow` 的 snapshot 帧带 `projections.values.tokenUsage`，是**整条会话日志**的
//    累计桶（含桥接启动之前的历史）。桥接只补「基线之后」的增量，所以总量是精确的，
//    不需要重放全部历史。
//
// 2. **逐轮明细靠事件折叠，且必须幂等。**
//    snapshot 帧的 `records` 是最多 maxMessages 条历史事件，重连时会**重新下发**；
//    因此同一 (session, turn, step, retry) 的采样必须「后到覆盖先到」，而不是累加。
//    这与 DSH `dsh-token-meter` 的 tokenUsage 折叠语义一致：
//      - `assistant/message` / `assistant/attempt` 带 usage 时，同 (turn, step) 覆盖上一次采样；
//      - `llm/retry-started` 结束该覆盖作用域，于是重试的第二次请求**另算一次**（retry 轴 +1）。
//
// 3. **不能把唯一副本放在会被重连清空的内存里。**
//    `pumpMux` 的 finally 会清掉所有 per-turn Map（否则重连后回复会重复累加）。
//    所以每条采样一到就 append 到 JSONL 日志，内存只是它的投影。
//
// 存储：`state/token-usage.jsonl`，两种行：
//   {"k":"base", t, sid, key, seq, model, provider, b:{cacheMiss,cacheHit,cacheWrite,output,reasoning}}
//   {"k":"turn", t, sid, key, seq, turn, step, retry, model, provider, b:{...}}
// 行数超过上限时按内存态重写（自动去重 + 丢弃被覆盖的旧采样）。
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PRICE_TABLE,
  ZERO_BUCKETS,
  addBuckets,
  costOfBuckets,
  isPeakAt,
  normalizeUsage,
  priceUsage,
  ratesAt,
  totalTokensOf
} from './model-prices.js';
  /* extracted:sampleKeyOf */

  /* extracted:BUCKET_LADDER_MS */

  /* extracted:pickBucketMs */

  /* extracted:usageFromStream */

  /* extracted:usageOfEvent */


/**
 * 建立一个 token 账本。
 * @param {object} options
 * @param {string} options.file           JSONL 落盘路径
 * @param {(msg: string, err?: unknown) => void} [options.log]
 * @param {object} [options.priceTable]   价目表（`resolvePriceTable()` 的结果）
 * @param {(sessionId: string) => (string|undefined)} [options.resolveKey] 运行期 sessionId → 会话 key 解析
 * @param {number} [options.maxLines]     日志行数上限，超出即压缩重写
 * @param {() => number} [options.now]
 */
export function createTokenLedger({
  file,
  log = () => {},
  priceTable = DEFAULT_PRICE_TABLE,
  resolveKey,
  maxLines = 20000,
  now = () => Date.now()
}:TokenLedgerOptions = {} as TokenLedgerOptions) {
  if (typeof file !== 'string' || !file) throw new Error('createTokenLedger: file is required');

  /** sessionId -> 最新一条投影基线 */
  const baselines = new Map<string,LedgerBase>();
  /** sampleKey -> 采样记录 */
  const samples = new Map<string,LedgerSample>();
  /** sessionId -> { turn, step, retry, seq }：重试轴，用于区分同一步骤的多次计费请求 */
  const retryAxis = new Map<string,RetryAxis>();
  /** sessionId -> 最近一次见到的会话 key（会话退役后仍可归属到原 QQ 会话） */
  const sessionKeys = new Map<string,unknown>();
  /** sessionId -> 被淘汰（只剩累计值、无法再拆到某一轮）的采样汇总 */
  const evicted = new Map<string,LedgerEvicted>();
  let evictedDirty = false;
  /** sessionId -> 最近一次活动时间 */
  const sessionSeen = new Map<string,number>();
  /** 落盘行数（含被覆盖的旧采样），用于决定何时压缩 */
  let journalLines = 0;
  let lastIngestAt = 0;
  let lastCompactedAt = 0;
  let droppedLines = 0;

  function keyOf(sessionId:string) {
    let key;
    try {
      key = resolveKey?.(sessionId);
    } catch {
      key = undefined;
    }
    if (key) {
      sessionKeys.set(sessionId, key);
      return key;
    }
    return sessionKeys.get(sessionId);
  }

  // ── 载入 ────────────────────────────────────────────────────────────────
  function applyRecord(record:Record<string,unknown>|null, { fromDisk }:{fromDisk:boolean}) {
    if (!record || typeof record !== 'object') return false;
    const sid = record.sid;
    if (typeof sid !== 'string' || !sid) return false;
    if (record.key) sessionKeys.set(sid, record.key);
    const seq = Number.isFinite(Number(record.seq)) ? Number(record.seq) : -1;
    const t = Number.isFinite(Number(record.t)) ? Number(record.t) : 0;
    const buckets = normalizeUsage(record.b);

    // 被淘汰的逐轮采样：只保留累计桶与花费，不保留回合归属。
    if (record.k === 'evict') {
      const prevEvicted = evicted.get(sid);
      if (prevEvicted && prevEvicted.dropped >= (Number(record.dropped) || 0)) return false;
      evicted.set(sid, {
        sessionId: sid,
        key: record.key,
        buckets,
        cost: Number(record.cost) || 0,
        byTier: {
          peak: Number(record.peak) || 0,
          off: Number(record.off) || 0
        },
        estimated: record.estimated === true,
        dropped: Number(record.dropped) || 0,
        maxSeq: Number.isFinite(Number(record.maxSeq)) ? Number(record.maxSeq) : -1
      });
      if (t > (sessionSeen.get(sid) ?? 0)) sessionSeen.set(sid, t);
      return true;
    }

    if (record.k === 'base') {
      const prev = baselines.get(sid);
      if (prev && prev.seq > seq) return false; // 旧基线不得覆盖新基线
      baselines.set(sid, {
        sessionId: sid,
        key: record.key,
        seq,
        t,
        model: record.model,
        provider: record.provider,
        buckets
      });
      if (t > (sessionSeen.get(sid) ?? 0)) sessionSeen.set(sid, t);
      return true;
    }

    if (record.k === 'turn') {
      const turn = Number(record.turn);
      const step = Number(record.step);
      const retry = Number.isFinite(Number(record.retry)) ? Number(record.retry) : 0;
      if (!Number.isFinite(turn) || !Number.isFinite(step)) return false;
      const sk = sampleKeyOf(sid, turn, step, retry);
      const prev = samples.get(sk);
      // 幂等关键：只有 seq **严格更新**才允许覆盖。
      // 相等 seq 只可能是同一条事件的重放（重连时 snapshot 会重发），
      // 若放行「相等 seq 覆盖」，旧快照就能把新数据改小 —— 花费会凭空缩水。
      if (prev && seq >= 0 && prev.seq >= seq) return false;
      samples.set(sk, {
        sessionId: sid,
        key: record.key,
        seq,
        t,
        turn,
        step,
        retry,
        model: record.model,
        provider: record.provider,
        buckets
      });
      const axis = retryAxis.get(sid);
      if (!axis || axis.seq <= seq) retryAxis.set(sid, { turn, step, retry, seq });
      if (t > (sessionSeen.get(sid) ?? 0)) sessionSeen.set(sid, t);
      return true;
    }
    return false;
  }

  function load() {
    baselines.clear();
    samples.clear();
    retryAxis.clear();
    sessionKeys.clear();
    sessionSeen.clear();
    journalLines = 0;
    droppedLines = 0;
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return; // 首次运行：文件还不存在
    }
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      journalLines += 1;
      let record:Record<string,unknown>|null;
      try {
        record = JSON.parse(line);
      } catch {
        droppedLines += 1; // 进程中断留下的半行：跳过
        continue;
      }
      try {
        applyRecord(record, { fromDisk: true });
      } catch (error) {
        droppedLines += 1;
        log('token 账本：丢弃无法应用的行', (error as LedgerError|null)?.message ?? error);
      }
    }
  }

  // ── 落盘 ────────────────────────────────────────────────────────────────
  function appendLine(record:unknown) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
      journalLines += 1;
      return true;
    } catch (error) {
      log('token 账本：写入失败', (error as LedgerError|null)?.message ?? error);
      return false;
    }
  }

  /**
   * 把内存态整体重写回磁盘：顺带丢掉被覆盖的旧采样，控制文件体积。
   */
  function compact() {
    const out:Record<string,unknown>[] = [];
    for (const base of baselines.values()) {
      out.push({
        k: 'base', t: base.t, sid: base.sessionId, key: base.key, seq: base.seq,
        model: base.model, provider: base.provider, b: base.buckets
      });
    }
    for (const s of samples.values()) {
      out.push({
        k: 'turn', t: s.t, sid: s.sessionId, key: s.key, seq: s.seq,
        turn: s.turn, step: s.step, retry: s.retry,
        model: s.model, provider: s.provider, b: s.buckets
      });
    }
    for (const e of evicted.values()) {
      out.push({
        k: 'evict', t: sessionSeen.get(e.sessionId) ?? 0, sid: e.sessionId, key: e.key,
        b: e.buckets, cost: e.cost, peak: e.byTier.peak, off: e.byTier.off,
        estimated: e.estimated, dropped: e.dropped, maxSeq: Number(e.maxSeq) >= 0 ? Number(e.maxSeq) : -1
      });
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`;
      fs.writeFileSync(tmp, out.map((r) => `${JSON.stringify(r)}\n`).join(''), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
      journalLines = out.length;
      evictedDirty = false;
      lastCompactedAt = now();
      return true;
    } catch (error) {
      log('token 账本：压缩失败', (error as LedgerError|null)?.message ?? error);
      return false;
    }
  }

  /**
   * 淘汰最旧的逐轮采样，把内存与磁盘都压在 maxLines 条以内。
   *
   * 为什么必须有淘汰：`compact()` 只是把内存态「重写」一遍 —— 如果内存本身无限增长，
   * 那么一旦条数越过上限，**之后每一条采样**都会触发一次整文件同步重写（多 MB 的
   * JSONL 写在 QQ 事件路径上），而且内存会一直涨。所以压缩必须真的丢东西。
   *
   * 关键：**丢明细不能丢总量**。被淘汰的采样先把桶累加进 `evicted`（连同它自己那一次的
   * 计价结果），读取时照样算进权威累计；只是这些旧回合不再能拆到具体某一轮，控制台会
   * 把它归进「未逐轮归属」。这样即使某个会话还没有投影基线，总量也依然精确。
   */
  function evictOldestSamples() {
    const overflow = samples.size - maxLines;
    if (overflow <= 0) return 0;
    const ordered = [...samples.entries()].sort((a, b) => a[1].t - b[1].t);
    for (let i = 0; i < overflow; i += 1) {
      const [sampleId, sample] = ordered[i];
      samples.delete(sampleId);
      const acc = evicted.get(sample.sessionId) ?? {
        sessionId: sample.sessionId,
        key: sample.key,
        buckets: { ...ZERO_BUCKETS },
        cost: 0,
        byTier: { peak: 0, off: 0 },
        estimated: false,
        dropped: 0,
        // 被淘汰采样里最大的 seq：一旦更新的投影基线覆盖到它，这些桶就已经包含在
        // 基线里了，再相加就是重复计费（见 evictionCovered()）。
        maxSeq: -1
      };
      acc.buckets = addBuckets(acc.buckets, sample.buckets);
      const sampleSeq = Number(sample.seq);
      if (Number.isFinite(sampleSeq) && sampleSeq >= 0) {
        acc.maxSeq = Math.max(Number(acc.maxSeq) >= 0 ? Number(acc.maxSeq) : -1, sampleSeq);
      }
      const p = priceUsage(sample.buckets, { model: sample.model, at: sample.t || now(), table: priceTable });
      acc.cost += p.cost.total;
      acc.byTier[p.rates.tier] += p.cost.total;
      acc.estimated ||= p.rates.estimated;
      acc.dropped += 1;
      if (sample.key) acc.key = sample.key;
      evicted.set(sample.sessionId, acc);
      evictedDirty = true;
    }
    return overflow;
  }
  /* extracted:evictionCovered */


  function maybeCompact() {
    if (journalLines <= maxLines && samples.size <= maxLines && !evictedDirty) return;
    const dropped = evictOldestSamples();
    if (dropped > 0) log(`token 账本：逐轮明细超过 ${maxLines} 条，已淘汰最旧的 ${dropped} 条（累计总量不受影响）`);
    compact();
  }

  // ── 摄入 ────────────────────────────────────────────────────────────────

  /**
   * 摄入一条会话事件。
   * @param {object} args
   * @param {string} args.sessionId
   * @param {object} args.event       SessionEvent（含 seq/type/data）
   * @param {'live'|'snapshot'} [args.origin] 事件来源；仅用于统计，两路都走同一套幂等折叠
   * @param {number} [args.at]        事件时间（缺省用事件自带的 time）
   * @param {string} [args.model]     实际模型（调用方按会话跟踪；缺省尝试从事件里取）
   * @param {string} [args.provider]
   * @returns {boolean} 是否产生了新的账本记录
   */
  function ingestEvent({ sessionId, event, origin = 'live', at, model, provider }:EventInput = {}) {
    if (typeof sessionId !== 'string' || !sessionId || !event || typeof event !== 'object') return false;
    // 时间优先取事件自带的 `time`（Unix 毫秒，由 DSH 写入），它决定峰谷档位；
    // 取不到才回落到「收到时间」，避免机器时钟/重放顺序影响计价。
    const t = Number.isFinite(Number(at)) ? Number(at)
      : (Number.isFinite(Number((event as LedgerEvent).time)) ? Number((event as LedgerEvent).time) : now());
    const seq = Number.isFinite(Number((event as LedgerEvent).seq)) ? Number((event as LedgerEvent).seq) : -1;
    const eventModel = model ?? (event as LedgerEvent).data?.model ?? (event as LedgerEvent).data?.usage?.model;
    const eventProvider = provider ?? (event as LedgerEvent).data?.provider;

    if ((event as LedgerEvent).type === 'llm/retry-started') {
      const turn = Number((event as LedgerEvent).data?.turn);
      const step = Number((event as LedgerEvent).data?.step);
      if (!Number.isFinite(turn) || !Number.isFinite(step)) return false;
      const retry = Number.isFinite(Number((event as LedgerEvent).data?.retry)) ? Number((event as LedgerEvent).data!.retry) : 1;
      const axis = retryAxis.get(sessionId);
      if (axis && axis.seq > seq) return false;
      retryAxis.set(sessionId, { turn, step, retry, seq });
      return false; // 轴本身不入账
    }

    if ((event as LedgerEvent).type !== 'assistant/message' && (event as LedgerEvent).type !== 'assistant/attempt') return false;
    const raw = usageOfEvent(event);
    if (!raw) return false;
    const turn = Number((event as LedgerEvent).data?.turn);
    const step = Number((event as LedgerEvent).data?.step);
    if (!Number.isFinite(turn) || !Number.isFinite(step)) return false;
    const axis = retryAxis.get(sessionId);
    const retry = axis && axis.turn === turn && axis.step === step ? axis.retry : 0;
    const buckets = normalizeUsage(raw);
    if (totalTokensOf(buckets) === 0) return false;

    const key = keyOf(sessionId);
    const sk = sampleKeyOf(sessionId, turn, step, retry);
    const prev = samples.get(sk);
    if (prev && seq >= 0 && prev.seq >= seq) return false;

    const record = {
      k: 'turn', t, sid: sessionId, key, seq,
      turn, step, retry,
      model: eventModel ?? prev?.model,
      provider: eventProvider ?? prev?.provider,
      b: buckets
    };
    samples.set(sk, {
      sessionId, key, seq, t, turn, step, retry,
      model: record.model, provider: record.provider, buckets
    });
    if (t > (sessionSeen.get(sessionId) ?? 0)) sessionSeen.set(sessionId, t);
    lastIngestAt = now();
    appendLine(record);
    maybeCompact();
    return true;
  }

  /**
   * 摄入 `session/follow` snapshot 帧的投影基线（整条会话日志的权威累计桶）。
   * 语义：基线与「seq 大于 baseline.seq 的采样」相加才是会话总量。
   */
  function ingestBaseline({ sessionId, projection, at, model, provider }:BaselineInput = {}) {
    if (typeof sessionId !== 'string' || !sessionId || !projection) return false;
    const values = (projection as LedgerProjection).values ?? projection;
    const tokenUsage = (values as LedgerProjection|null)?.tokenUsage;
    if (!tokenUsage) return false;
    const seq = Number.isFinite(Number((projection as LedgerProjection).asOfSeq)) ? Number((projection as LedgerProjection).asOfSeq) : -1;
    const t = Number.isFinite(Number(at)) ? Number(at) : now();
    const buckets = normalizeUsage(tokenUsage);
    const prev = baselines.get(sessionId);
    if (prev && prev.seq > seq) return false;
    const key = keyOf(sessionId);
    const same = prev && prev.seq === seq
      && prev.buckets.cacheMiss === buckets.cacheMiss
      && prev.buckets.cacheHit === buckets.cacheHit
      && prev.buckets.cacheWrite === buckets.cacheWrite
      && prev.buckets.output === buckets.output;
    baselines.set(sessionId, { sessionId, key, seq, t, model, provider, buckets });
    if (t > (sessionSeen.get(sessionId) ?? 0)) sessionSeen.set(sessionId, t);
    // 内容与 seq 都没变的重复基线（重连重发）不再落盘：否则每重连一次就多一行，
    // 而 follow 集合只会增长，日志会被无意义地推大。
    if (same) return false;
    lastIngestAt = now();
    appendLine({
      k: 'base', t, sid: sessionId, key, seq,
      model, provider, b: buckets
    });
    // 基线也要参与压缩判断：重连风暴会在每个会话上各追加一行基线，
    // 只靠 ingestEvent 触发压缩的话，这些行可能永远等不到一次压缩。
    maybeCompact();
    return true;
  }

  /** 摄入 snapshot 的全部历史记录（逐轮明细回填）。 */
  function ingestSnapshotRecords({ sessionId, records, at }:SnapshotInput = {}) {
    if (!Array.isArray(records)) return 0;
    let n = 0;
    for (const entry of records as ({type?:unknown;event?:unknown}|null)[]) {
      const event = entry?.type === 'event' ? entry.event : entry;
      if (!event || typeof event !== 'object') continue;
      if (ingestEvent({ sessionId, event, origin: 'snapshot', at })) n += 1;
    }
    return n;
  }
  /* extracted:buildIndex */

  /* extracted:sessionView */

  /* extracted:turnsOf */

  /* extracted:allSessionIds */

  /* extracted:summary */

  /* extracted:conversation */

  /* extracted:series */

  /* extracted:recent */


  function stats() {
    return {
      file,
      journalLines,
      maxLines,
      droppedLines,
      sessions: new Set([...baselines.keys(), ...sessionSeen.keys()]).size,
      baselines: baselines.size,
      samples: samples.size,
      lastIngestAt,
      lastCompactedAt,
      priceVersion: priceTable.version
    };
  }

  /** 清空账本（控制台手动重置）。 */
  function reset():undefined {
    baselines.clear();
    samples.clear();
    retryAxis.clear();
    sessionKeys.clear();
    sessionSeen.clear();
    // 被淘汰采样汇总是「权威累计」的一部分：漏清它，控制台点完重置仍会报出旧花费，
    // 用户以为没清掉。更隐蔽的是 evictedDirty 若保持 true，下一次 maybeCompact() 会走
    // compact()，把内存里这份 **已经被删掉** 的 evicted 重新序列化回磁盘 ——
    // 「删除」的总额在下一个采样到来时原地复活，而且文件被写坏成"重置前的量"。
    evicted.clear();
    evictedDirty = false;
    droppedLines = 0;
    lastCompactedAt = 0;
    journalLines = 0;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '', { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      log('token 账本：重置失败', (error as LedgerError|null)?.message ?? error);
    }
    lastIngestAt = 0;
  }

  const {evictionCovered,buildIndex,sessionView,turnsOf,allSessionIds}=createLedgerIndex({baselines,samples,evicted,sessionSeen,priceTable,now});
  const {summary,conversation,recent}=createLedgerQueries({baselines,samples,priceTable,now,keyOf,buildIndex,sessionView,turnsOf,allSessionIds});
  const {series}=createLedgerTimeline({baselines,samples,evicted,priceTable,now,keyOf,evictionCovered});

  load();

  return {
    ingestEvent,
    ingestBaseline,
    ingestSnapshotRecords,
    summary,
    conversation,
    series,
    recent,
    stats,
    reset,
    compact,
    hasSession: (sid:string) => baselines.has(sid) || sessionSeen.has(sid),
    file
  };
}
