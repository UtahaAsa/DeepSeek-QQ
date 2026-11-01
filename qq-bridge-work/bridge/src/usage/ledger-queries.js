// Generated from usage/ledger-queries.ts. Edit the TypeScript source and run build:typed.
import { ZERO_BUCKETS, addBuckets, priceUsage, totalTokensOf, ratesAt, isPeakAt } from '../model-prices.js';
/** 组合账本汇总、会话明细与最近流水；构造无IO，依赖引用保持实时。 */
export function createLedgerQueries({ baselines, samples, priceTable, now, keyOf, buildIndex, sessionView, turnsOf, allSessionIds }) {
    /** 汇总：全局 + 每个会话。 */
    function summary({ limit = 200 } = {}) {
        const index = buildIndex();
        const byKey = new Map();
        for (const sid of allSessionIds()) {
            const key = keyOf(sid) ?? (baselines.get(sid)?.key) ?? null;
            const bucketKey = key ?? `未归属:${sid.slice(0, 8)}`;
            if (!byKey.has(bucketKey))
                byKey.set(bucketKey, []);
            byKey.get(bucketKey).push(sid);
        }
        const conversations = [];
        for (const [key, sids] of byKey)
            conversations.push(sessionView(key, sids, index));
        conversations.sort((a, b) => b.cost - a.cost || totalTokensOf(b.buckets) - totalTokensOf(a.buckets));
        const totals = {
            buckets: { ...ZERO_BUCKETS },
            cost: 0,
            attributedCost: 0,
            unattributedCost: 0,
            byTier: { peak: 0, off: 0 },
            turns: 0,
            steps: 0,
            conversations: conversations.length,
            estimated: false
        };
        for (const c of conversations) {
            totals.buckets = addBuckets(totals.buckets, c.buckets);
            totals.cost += c.cost;
            totals.attributedCost += c.attributedCost;
            totals.unattributedCost += c.unattributedCost;
            totals.byTier.peak += c.byTier.peak;
            totals.byTier.off += c.byTier.off;
            totals.turns += c.turns;
            totals.steps += c.steps;
            totals.estimated ||= c.estimated;
        }
        const totalTok = totalTokensOf(totals.buckets);
        const inputTok = totals.buckets.cacheMiss + totals.buckets.cacheHit + totals.buckets.cacheWrite;
        return {
            ok: true,
            generatedAt: now(),
            priceVersion: priceTable.version,
            currency: priceTable.currency,
            symbol: priceTable.symbol,
            nowTier: ratesAt(undefined, now(), priceTable),
            priceTable: {
                version: priceTable.version,
                currency: priceTable.currency,
                symbol: priceTable.symbol,
                unit: priceTable.unit,
                peakMultiplier: priceTable.peakMultiplier,
                peakWindows: priceTable.peakWindows,
                peakWeekdays: priceTable.peakWeekdays,
                holidayCount: (priceTable.holidays ?? []).length,
                models: Object.fromEntries(Object.entries(priceTable.models).map(([name, m]) => [name, { label: m.label, off: m.off }]))
            },
            totals: {
                ...totals,
                totalTokens: totalTok,
                inputTokens: inputTok,
                cacheHitRate: inputTok > 0 ? totals.buckets.cacheHit / inputTok : 0,
                avgCostPerTurn: totals.turns > 0 ? totals.cost / totals.turns : 0,
                avgCostPerStep: totals.steps > 0 ? totals.cost / totals.steps : 0
            },
            conversations: conversations.slice(0, Math.max(1, Math.min(500, Number(limit) || 200)))
        };
    }
    /** 单会话明细：汇总 + 逐轮（新的在前）。 */
    function conversation(key, { turnLimit = 200 } = {}) {
        if (typeof key !== 'string' || !key)
            return null;
        const sids = [];
        for (const sid of allSessionIds()) {
            if (keyOf(sid) === key)
                sids.push(sid);
        }
        if (!sids.length)
            return null;
        const index = buildIndex();
        const view = sessionView(key, sids, index);
        const rows = turnsOf(sids, index);
        return {
            ok: true,
            generatedAt: now(),
            currency: priceTable.currency,
            symbol: priceTable.symbol,
            ...view,
            turnLimit,
            turns: rows.slice(0, Math.max(1, Math.min(1000, Number(turnLimit) || 200)))
        };
    }
    /** 最近采样流水（实时观察用，按时间倒序）。 */
    function recent(limit = 50) {
        const n = Math.max(1, Math.min(500, Number(limit) || 50));
        const all = [...samples.values()].sort((a, b) => b.t - a.t);
        const out = [];
        for (const s of all.slice(0, n)) {
            const p = priceUsage(s.buckets, { model: s.model, at: s.t || now(), table: priceTable });
            out.push({
                time: s.t,
                key: keyOf(s.sessionId) ?? s.key ?? null,
                sessionId: s.sessionId,
                turn: s.turn,
                step: s.step,
                retry: s.retry,
                model: s.model ?? null,
                tokens: totalTokensOf(s.buckets),
                ...s.buckets,
                cost: p.cost.total,
                tier: p.rates.tier,
                estimated: p.rates.estimated
            });
        }
        return out;
    }
    return { summary, conversation, recent };
}
