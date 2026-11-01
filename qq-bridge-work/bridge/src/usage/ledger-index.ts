import type {LedgerIndexDependencies,LedgerEvicted,LedgerIndexEntry,LedgerView,LedgerTurn} from './ledger-contracts.js';
import {ZERO_BUCKETS,addBuckets,priceUsage,totalTokensOf,ratesAt,isPeakAt} from '../model-prices.js';
/** 构造共享账本视图的单遍索引工具；构造无IO，依赖引用保持实时。 */
export function createLedgerIndex({baselines,samples,evicted,sessionSeen,priceTable,now}:LedgerIndexDependencies) {


  /**
   * 被淘汰的累计桶是否已经被更**新的投影基线**整块覆盖。
   *
   * 为什么必须判断：基线（session/follow 快照的 tokenUsage）本身就是"整条会话日志"的
   * 权威累计，包含 seq <= asOfSeq 的全部事件；而淘汰桶没有 seq，旧代码无条件把它和基线
   * 相加 —— 一旦重连后拿到的基线覆盖了被淘汰的采样，这部分 token 与花费就被算了两遍
   * （实测 +33%，且只有 reset() 能清掉）。
   */
  function evictionCovered(entry:LedgerEvicted|null|undefined) {
    if (!entry) return false;
    const base = baselines.get(entry.sessionId);
    const maxSeq = Number(entry.maxSeq);
    if (!base || !Number.isFinite(maxSeq) || maxSeq < 0) return false;
    return Number(base.seq) >= maxSeq;
  }


  // ── 读取 ────────────────────────────────────────────────────────────────

  /** 按 sessionId 取「基线 + 基线之后采样」的权威桶。 */
  /**
   * 单遍索引：一次扫过所有采样，算出每个会话需要的全部聚合量。
   *
   * 为什么必须这么写：控制台每 3 秒拉一次 `/api/tokens/summary`，而它跑在**和 QQ 事件
   * 同一个事件循环**里。原先 summary 对每个会话都重扫一遍全部采样（O(会话数 × 采样数)，
   * 而且 sessionTotals/sessionCost/turnRows 各扫一遍 = 3 倍），几千条采样、几十个会话
   * 就是百万级迭代。这里压成单遍 O(采样数)。
   *
   * 基线单独计价（它没有逐时明细，只能整体按快照时刻的峰谷算），并只把
   * `seq > 基线 seq` 的采样算进「权威累计」，避免和基线重复计费。
   */
  function buildIndex() {
    const index = new Map<string,LedgerIndexEntry>();
    for (const s of samples.values()) {
      let entry = index.get(s.sessionId);
      if (!entry) {
        entry = {
          liveBuckets: { ...ZERO_BUCKETS },
          liveCost: 0,
          liveByTier: { peak: 0, off: 0 },
          allCost: 0,
          allByTier: { peak: 0, off: 0 },
          estimated: false,
          turns: new Map(),
          models: new Set()
        };
        index.set(s.sessionId, entry);
      }
      const base = baselines.get(s.sessionId);
      const isLive = !base || s.seq > base.seq;
      const p = priceUsage(s.buckets, { model: s.model, at: s.t || now(), table: priceTable });
      entry.estimated ||= p.rates.estimated;
      entry.allCost += p.cost.total;
      entry.allByTier[p.rates.tier] += p.cost.total;
      if (isLive) {
        entry.liveBuckets = addBuckets(entry.liveBuckets, s.buckets);
        entry.liveCost += p.cost.total;
        entry.liveByTier[p.rates.tier] += p.cost.total;
      }
      let row = entry.turns.get(s.turn);
      if (!row) {
        row = {
          sessionId: s.sessionId,
          key: s.key,
          turn: s.turn,
          steps: 0,
          attempts: 0,
          startedAt: s.t,
          endedAt: s.t,
          model: s.model,
          provider: s.provider,
          buckets: { ...ZERO_BUCKETS },
          cost: 0,
          tier: null
        };
        entry.turns.set(s.turn, row);
      }
      row.buckets = addBuckets(row.buckets, s.buckets);
      row.steps += 1;
      row.attempts += s.retry > 0 ? 1 : 0;
      if (s.t < row.startedAt) row.startedAt = s.t;
      if (s.t > row.endedAt) row.endedAt = s.t;
      if (s.model) { row.model = s.model; entry.models.add(s.model); }
      if (s.provider) row.provider = s.provider;
      row.cost += p.cost.total;
      row.tier = row.tier === null || row.tier === p.rates.tier ? p.rates.tier : 'mixed';
    }
    return index;
  }


  /** 把一个会话的索引项 + 投影基线合成「会话视图」。 */
  function sessionView(key:unknown, sessionIds:string[], index:ReadonlyMap<string,LedgerIndexEntry>) {
    const view:LedgerView = {
      key,
      sessionIds,
      sessions: sessionIds.length,
      buckets: { ...ZERO_BUCKETS },
      cost: 0,
      unattributedCost: 0,
      attributedCost: 0,
      byTier: { peak: 0, off: 0 },
      turns: 0,
      steps: 0,
      estimated: false,
      lastAt: 0,
      firstAt: 0,
      models: []
    };
    const models = new Set<unknown>();
    for (const sid of sessionIds) {
      const base = baselines.get(sid);
      const entry = index.get(sid) ?? null;
      const rawGone = evicted.get(sid) ?? null;
      const gone = evictionCovered(rawGone) ? null : rawGone;
      const liveBuckets = entry?.liveBuckets ?? { ...ZERO_BUCKETS };
      const cumulative = addBuckets(base?.buckets ?? ZERO_BUCKETS, gone?.buckets ?? ZERO_BUCKETS);
      const total = addBuckets(cumulative, liveBuckets);
      view.buckets = addBuckets(view.buckets, total);

      let cost = (entry?.liveCost ?? 0) + (gone?.cost ?? 0);
      view.byTier.peak += (entry?.liveByTier.peak ?? 0) + (gone?.byTier.peak ?? 0);
      view.byTier.off += (entry?.liveByTier.off ?? 0) + (gone?.byTier.off ?? 0);
      view.estimated ||= (entry?.estimated ?? false) || (gone?.estimated ?? false);
      if (base) {
        const p = priceUsage(base.buckets, { model: base.model, at: base.t || now(), table: priceTable });
        cost += p.cost.total;
        view.byTier[p.rates.tier] += p.cost.total;
        view.estimated ||= p.rates.estimated;
      }
      view.cost += cost;
      if (entry) {
        for (const model of entry.models) models.add(model);
        for (const row of entry.turns.values()) {
          view.steps += row.steps;
          if (!view.firstAt || row.startedAt < view.firstAt) view.firstAt = row.startedAt;
          if (row.endedAt > view.lastAt) view.lastAt = row.endedAt;
        }
        view.turns += entry.turns.size;
      }
      // 能拆到具体某一轮的花费 = 所有采样的花费之和；差额是只剩累计值的历史。
      const attributed = entry?.allCost ?? 0;
      view.attributedCost += attributed;
      view.unattributedCost += Math.max(0, cost - attributed);
    }
    view.models = [...models];
    for (const sid of sessionIds) {
      const t = sessionSeen.get(sid);
      if (t && t > view.lastAt) view.lastAt = t;
    }
    return view;
  }


  /** 某个会话的逐轮明细（新的在前）。 */
  function turnsOf(sessionIds:string[], index:ReadonlyMap<string,LedgerIndexEntry>) {
    const rows:LedgerTurn[] = [];
    for (const sid of sessionIds) {
      const entry = index.get(sid);
      if (entry) rows.push(...entry.turns.values());
    }
    rows.sort((a, b) => b.turn - a.turn || b.endedAt - a.endedAt);
    return rows;
  }


  /** 账本里出现过的全部 sessionId（基线、采样、被淘汰汇总、活动记录四处的并集）。 */
  function allSessionIds() {
    const ids = new Set([...baselines.keys(), ...sessionSeen.keys(), ...evicted.keys()]);
    for (const s of samples.values()) ids.add(s.sessionId);
    return ids;
  }
return {evictionCovered,buildIndex,sessionView,turnsOf,allSessionIds};
}
