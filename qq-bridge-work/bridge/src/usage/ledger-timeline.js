// Generated from usage/ledger-timeline.ts. Edit the TypeScript source and run build:typed.
import { ZERO_BUCKETS, addBuckets, priceUsage, totalTokensOf, ratesAt, isPeakAt } from '../model-prices.js';
import { pickBucketMs } from './ledger-protocol.js';
/** 按窗口生成用量时间线；构造无IO，依赖引用保持实时。 */
export function createLedgerTimeline({ baselines, samples, evicted, priceTable, now, keyOf, evictionCovered }) {
    /**
     * 按时间分桶的走势数据（控制台走势图用）。
     *
     * 三个刻意的设计：
     * 1. **单遍扫描**：控制台每 3 秒拉一次，不能是 O(会话×采样) 或多次遍历。
     * 2. **空桶补零**：没有调用的时段必须出现在图里（值为 0），否则"那段时间很安静"
     *    会被画成"那两个小时之间什么都没有"，图会撒谎。
     * 3. **桶的峰谷档位**：桶里只有一种档位就用它；混了就标 `mixed`；**空桶按该时刻
     *    实际属于高峰还是空闲来标** —— 这样即使某段时间完全没用量，图上也能看出
     *    "这段时间本来就是 2 倍价"。
     * 桶宽阶梯与选择规则在模块级（`BUCKET_LADDER_MS` / `pickBucketMs`），离线 fixture 复用同一份。
     */
    function series({ hours = 24, maxBuckets = 48, at } = {}) {
        const endAt = Number.isFinite(Number(at)) ? Number(at) : now();
        const windowHours = Math.min(24 * 90, Math.max(1, Number(hours) || 24));
        const windowMs = windowHours * 60 * 60 * 1000;
        const bucketMs = pickBucketMs(windowMs, Math.max(6, Math.min(120, Number(maxBuckets) || 48)));
        // 桶边界对齐到 bucketMs 的整数倍，这样刷新之间桶不会"漂移"。
        const end = Math.floor(endAt / bucketMs) * bucketMs + bucketMs;
        const start = end - Math.ceil(windowMs / bucketMs) * bucketMs;
        const count = Math.round((end - start) / bucketMs);
        const rows = [];
        for (let i = 0; i < count; i += 1) {
            const t = start + i * bucketMs;
            rows.push({
                t,
                cost: 0,
                tokens: 0,
                cacheMiss: 0,
                cacheHit: 0,
                cacheWrite: 0,
                output: 0,
                turns: 0,
                steps: 0,
                tier: null,
                keys: new Set()
            });
        }
        const totals = { cost: 0, tokens: 0, turns: 0, steps: 0 };
        let estimated = false;
        let countedSamples = 0;
        // 逐桶的「轮次」去重集合（键 = sessionId|turn）。
        // steps 数的是计费请求（同一回合的多个 step / 重试各算一条），turns 数的是真正的对话轮次；
        // 旧代码把去重集合的键写成 sampleKeyOf(sid, turn, step, retry) —— 那**正是 samples 的键**，
        // 遍历 samples 时每个键天然唯一，去重永不命中，于是 row.turns 恒等于 row.steps：
        // 图上标的「轮次」其实一直是「请求数」，且这层去重是纯粹的死代码。
        const turnSeen = new Set();
        const rowTurnSeen = rows.map(() => new Set());
        // 权威总额（含窗口之外）的三个组成部分，按 summary() 的同一口径在**同一次遍历**里累加：
        //   ① 被淘汰采样的累计（evicted）② 投影基线自身 ③ 仍然逐轮可拆、且没被基线覆盖的采样（seq > 基线 seq）。
        // 非 live 采样绝不能计入：基线已经包含了它的历史，再算一次就是重复计费，offChartCost 会凭空变大。
        let ledgerCost = 0;
        let ledgerBuckets = { ...ZERO_BUCKETS };
        for (const e of evicted.values()) {
            if (evictionCovered(e))
                continue; // 已被投影基线覆盖：再加一次就是重复计费
            ledgerCost += Number(e.cost) || 0;
            ledgerBuckets = addBuckets(ledgerBuckets, e.buckets);
        }
        for (const base of baselines.values()) {
            // 与 sessionView() 同口径：基线没有逐时明细，按快照时刻（缺失时取当前）整体计价。
            ledgerCost += priceUsage(base.buckets, { model: base.model, at: base.t || now(), table: priceTable }).cost.total;
            ledgerBuckets = addBuckets(ledgerBuckets, base.buckets);
        }
        for (const s of samples.values()) {
            // 这条采样的计价只算一次：窗口内的桶与窗口外的"总额"共用同一个 p。
            const p = priceUsage(s.buckets, { model: s.model, at: s.t || endAt, table: priceTable });
            const tokens = totalTokensOf(s.buckets);
            const base = baselines.get(s.sessionId);
            if (!base || s.seq > base.seq) {
                ledgerCost += p.cost.total;
                ledgerBuckets = addBuckets(ledgerBuckets, s.buckets);
            }
            if (s.t < start || s.t >= end)
                continue;
            const idx = Math.min(count - 1, Math.max(0, Math.floor((s.t - start) / bucketMs)));
            const row = rows[idx];
            row.cost += p.cost.total;
            row.tokens += tokens;
            row.cacheMiss += s.buckets.cacheMiss;
            row.cacheHit += s.buckets.cacheHit;
            row.cacheWrite += s.buckets.cacheWrite;
            row.output += s.buckets.output;
            row.steps += 1;
            row.tier = row.tier === null || row.tier === p.rates.tier ? p.rates.tier : 'mixed';
            row.keys.add(keyOf(s.sessionId) ?? s.key ?? null);
            const turnId = `${s.sessionId}|${s.turn}`;
            if (!rowTurnSeen[idx].has(turnId)) {
                rowTurnSeen[idx].add(turnId);
                row.turns += 1;
            }
            // 窗口级轮次：跨桶的同一回合只算一次（所以各桶 turns 之和 ≥ totals.turns）。
            if (!turnSeen.has(turnId)) {
                turnSeen.add(turnId);
                totals.turns += 1;
            }
            totals.cost += p.cost.total;
            totals.tokens += tokens;
            totals.steps += 1;
            estimated ||= p.rates.estimated;
            countedSamples += 1;
        }
        for (const row of rows) {
            // 空桶也要有档位：用该时刻真实的峰谷归属，而不是留空。
            if (row.tier === null)
                row.tier = isPeakAt(row.t, priceTable) ? 'peak' : 'off';
            row.keys = [...row.keys].filter(Boolean);
        }
        let busiest = null;
        for (const row of rows) {
            if (row.cost <= 0)
                continue;
            if (!busiest || row.cost > busiest.cost)
                busiest = row;
        }
        // 时间轴之外的那部分（更早的回合 / 投影基线覆盖的历史）。
        //
        // 旧实现在这里调 summary({ limit: 1 }) 只为拿一个总额 —— 那是又一次 buildIndex()（全量采样、
        // 每条约一次 priceUsage、还建两层 Map）加逐会话聚合，把控制台每 3 秒轮询一次的最热端点成本
        // 直接翻倍，也违背了本函数头「单遍扫描」的约定。现在用上面同一次遍历累出的权威总额。
        const ledgerTokens = totalTokensOf(ledgerBuckets);
        return {
            ok: true,
            generatedAt: endAt,
            currency: priceTable.currency,
            symbol: priceTable.symbol,
            hours: windowHours,
            bucketMs,
            from: start,
            to: end,
            buckets: rows.map(({ keys, ...rest }) => ({ ...rest, keys })),
            totals,
            busiest: busiest ? { t: busiest.t, cost: busiest.cost, tokens: busiest.tokens } : null,
            estimated,
            countedSamples,
            // 时间轴之外的部分：图上画不出来，控制台会单独说明，避免"图上加起来 ≠ 总花费"引起误会。
            offChartCost: Math.max(0, ledgerCost - totals.cost),
            offChartTokens: Math.max(0, ledgerTokens - totals.tokens)
        };
    }
    return { series };
}
