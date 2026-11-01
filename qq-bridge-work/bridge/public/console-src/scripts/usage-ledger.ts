namespace QQConsole.UsageLedger {
interface UsageBuckets {cacheMiss?:number;cacheHit?:number;cacheWrite?:number;output?:number;}
interface ConversationView {key?:unknown;cost?:unknown;turns?:unknown;steps?:unknown;buckets?:UsageBuckets;}
interface UsageTotals extends ConversationView {unattributedCost?:unknown;estimated?:unknown;byTier?:{peak?:unknown;off?:unknown};totalTokens?:unknown;inputTokens?:unknown;cacheHitRate?:unknown;avgCostPerTurn?:unknown;}
interface PriceTierView {tier?:unknown;tierLabel?:unknown;model?:unknown;estimated?:unknown;}
/** 价目表覆盖项未提前视为可信数值或HTML，原Number与esc仍负责展示。 */
interface PriceTableView {symbol?:unknown;version?:unknown;holidayCount?:unknown;nowTier?:PriceTierView;models?:Record<string,{label?:unknown;off?:{cacheHit?:unknown;cacheMiss?:unknown;output?:unknown}}> ;}
interface UsageSummaryView extends QQConsole.Core.ApiResult {conversations?:ConversationView[];symbol?:unknown;totals?:UsageTotals;priceTable?:PriceTableView;nowTier?:PriceTierView;}
interface UsageTurnView {turn?:unknown;endedAt?:string|number;steps?:unknown;cost?:unknown;tier?:unknown;buckets?:UsageBuckets;}
interface UsageTurnsView {key?:unknown;turns?:UsageTurnView[];symbol?:unknown;attributedCost?:unknown;unattributedCost?:unknown;}
interface UsageRecentView {symbol?:unknown;entries?:{time?:string|number;key?:unknown;turn?:unknown;step?:unknown;cacheMiss?:unknown;cacheHit?:unknown;output?:unknown;cost?:unknown;tier?:unknown}[];}



// ── 令牌与花费 ───────────────────────────────────────────────────────────
// 数据分三层：累计总量（DSH tokenUsage 投影，权威）→ 按会话归并 → 逐轮明细。
// 金额一律在渲染时算，价目表改了不需要重算历史。
let usageSelectedKey = '';
let usageConversationsCache:ConversationView[] = [];

export function usageNum(n:unknown) {
  const v = Number(n) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e5) return (v / 1e4).toFixed(0) + ' 万';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万';
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function usageMoney(n:unknown, sym?:unknown) {
  const s = sym || '¥';
  const v = Number(n) || 0;
  if (v === 0) return s + '0';
  if (v < 0.01) return s + v.toFixed(4);
  return s + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function usagePct(n:unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return (v * 100).toFixed(1) + '%';
}
function usageRate(buckets:UsageBuckets|null|undefined) {
  const b = buckets || {};
  const input = (b.cacheMiss || 0) + (b.cacheHit || 0) + (b.cacheWrite || 0);
  return input > 0 ? (b.cacheHit || 0) / input : 0;
}
function usageTime(ms:string|number|null|undefined) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (error) { return '—'; }
}
function usageBar(share:unknown) {
  const ratio = Math.max(0, Math.min(1, Number(share) || 0));
  const width = Math.max(2, Math.round(ratio * 100));
  return `<span class="usage-bar-wrap"><span class="usage-bar-track"><span class="usage-bar-fill" style="width:${width}%"></span></span><span class="meta">${(ratio * 100).toFixed(1)}%</span></span>`;
}
function usageTierTag(tier:unknown) {
  if (tier === 'peak') return '<span class="pill r usage-tier">高峰</span>';
  if (tier === 'off') return '<span class="pill g usage-tier">空闲</span>';
  if (tier === 'mixed') return '<span class="pill b usage-tier">跨时段</span>';
  return '<span class="meta">—</span>';
}

function syncUsageKeySelect(keys:string[]) {
  const sel = document.getElementById('usageKeySelect');
  if (!sel) return;
  if (!keys.includes(usageSelectedKey)) usageSelectedKey = keys[0] || '';
  const signature = keys.join('\u0000');
  if (sel.dataset.signature !== signature) {
    sel.dataset.signature = signature;
    sel.innerHTML = keys.length
      ? keys.map(k => `<option value="${QQConsole.Core.esc(k)}">${QQConsole.Core.esc(k)}</option>`).join('')
      : '<option value="">（暂无会话）</option>';
  }
  // 每 3 秒的轮询不得覆盖用户正在操作的控件。
  if (document.activeElement !== sel) sel.value = usageSelectedKey;
}

function renderUsageConversations(r:UsageSummaryView) {
  const box = document.getElementById('usageConversations');
  const list = r.conversations || [];
  const sym = r.symbol || '¥';
  usageConversationsCache = list;
  if (!list.length) {
    box.innerHTML = '<div class="empty-state"><strong>还没有用量记录</strong><p>QQ 会话产生一次 LLM 调用后，这里会按群 / 好友列出 token 与花费。新账本从桥接重启后开始记账。</p></div>';
    return;
  }
  const maxCost = Math.max(...list.map(x => Number(x.cost) || 0), 0);
  let html = '<table><tr><th>会话</th><th>类型</th><th class="num">轮数</th><th class="num">步数</th><th class="num">未命中输入</th><th class="num">命中输入</th><th class="num">命中率</th><th class="num">输出</th><th class="num">花费</th><th>占比</th></tr>';
  for (const c of list) {
    const key = String(c.key ?? '');
    const isInternal = key.startsWith('internal:');
    const type = isInternal ? '<span class="pill b">内部</span>'
      : (key.startsWith('private:') ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>');
    const b = c.buckets || {};
    html += '<tr>'
      + `<td class="usage-key"><button class="usage-key-button" data-usage-key="${QQConsole.Core.esc(key)}" aria-pressed="${key === usageSelectedKey}">${QQConsole.Core.esc(key)}</button></td>`
      + `<td>${type}</td>`
      + `<td class="num">${usageNum(c.turns)}</td>`
      + `<td class="num">${usageNum(c.steps)}</td>`
      + `<td class="num">${usageNum(b.cacheMiss)}</td>`
      + `<td class="num">${usageNum(b.cacheHit)}</td>`
      + `<td class="num">${usagePct(usageRate(b))}</td>`
      + `<td class="num">${usageNum(b.output)}</td>`
      + `<td class="num">${usageMoney(c.cost, sym)}</td>`
      + `<td>${usageBar(maxCost > 0 ? (Number(c.cost) || 0) / maxCost : 0)}</td>`
      + '</tr>';
  }
  html += '</table>';
  const totals = r.totals || {};
  if (Number(totals.unattributedCost) > 0) {
    html += `<div class="meta" style="padding:8px 10px">其中 ${usageMoney(totals.unattributedCost, sym)} 来自更早的回合：它们只剩累计值（在逐轮快照窗口之外），无法再拆到具体某一轮。</div>`;
  }
  if (totals.estimated) {
    html += '<div class="meta" style="padding:8px 10px">⚠️ 有模型未登记在价目表里，这部分按 <code>deepseek-flash</code> 兜底价估算，可在 <code>config.json</code> 的 <code>pricing.models</code> 补充。</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll<HTMLButtonElement>('[data-usage-key]').forEach(btn => btn.addEventListener('click', () => {
    usageSelectedKey = btn.dataset.usageKey!;
    box.querySelectorAll<HTMLButtonElement>('[data-usage-key]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.usageKey === usageSelectedKey)));
    const sel = document.getElementById('usageKeySelect');
    if (sel) sel.value = usageSelectedKey;
    refreshUsageTurns();
  }));
}

function renderUsageTurns(r:UsageTurnsView) {
  const box = document.getElementById('usageTurns');
  const scope = document.getElementById('usageTurnScope');
  const rows = r.turns || [];
  const sym = r.symbol || '¥';
  if (scope) {
    scope.textContent = `${QQConsole.Core.esc(r.key || '')} ｜ 共 ${rows.length} 轮可追溯 ｜ 已归属 ${usageMoney(r.attributedCost, sym)}`
      + (Number(r.unattributedCost) > 0 ? ` ｜ 未逐轮归属 ${usageMoney(r.unattributedCost, sym)}` : '');
  }
  if (!rows.length) {
    box.innerHTML = '<span class="meta">该会话还没有可追溯的逐轮记录（只有累计值）。</span>';
    return;
  }
  let html = '<table><tr><th class="num">轮次</th><th>结束时间</th><th class="num">步数</th><th class="num">未命中输入</th><th class="num">命中输入</th><th class="num">命中率</th><th class="num">输出</th><th class="num">花费</th><th>时段</th></tr>';
  for (const t of rows) {
    const b = t.buckets || {};
    html += '<tr>'
      + `<td class="num">#${QQConsole.Core.esc(t.turn)}</td>`
      + `<td>${QQConsole.Core.esc(usageTime(t.endedAt))}</td>`
      + `<td class="num">${usageNum(t.steps)}</td>`
      + `<td class="num">${usageNum(b.cacheMiss)}</td>`
      + `<td class="num">${usageNum(b.cacheHit)}</td>`
      + `<td class="num">${usagePct(usageRate(b))}</td>`
      + `<td class="num">${usageNum(b.output)}</td>`
      + `<td class="num">${usageMoney(t.cost, sym)}</td>`
      + `<td>${usageTierTag(t.tier)}</td>`
      + '</tr>';
  }
  box.innerHTML = html + '</table>';
}

function renderUsageRecent(r:UsageRecentView) {
  const box = document.getElementById('usageRecent');
  const list = r.entries || [];
  const sym = r.symbol || '¥';
  if (!list.length) { box.innerHTML = '<span class="meta">（空）</span>'; return; }
  let html = '<table><tr><th>时间</th><th>会话</th><th class="num">轮</th><th class="num">步</th><th class="num">未命中</th><th class="num">命中</th><th class="num">输出</th><th class="num">花费</th><th>时段</th></tr>';
  for (const e of list) {
    html += '<tr>'
      + `<td>${QQConsole.Core.esc(usageTime(e.time))}</td>`
      + `<td>${QQConsole.Core.esc(e.key || '未归属')}</td>`
      + `<td class="num">#${QQConsole.Core.esc(e.turn)}</td>`
      + `<td class="num">${QQConsole.Core.esc(e.step)}</td>`
      + `<td class="num">${usageNum(e.cacheMiss)}</td>`
      + `<td class="num">${usageNum(e.cacheHit)}</td>`
      + `<td class="num">${usageNum(e.output)}</td>`
      + `<td class="num">${usageMoney(e.cost, sym)}</td>`
      + `<td>${usageTierTag(e.tier)}</td>`
      + '</tr>';
  }
  box.innerHTML = html + '</table>';
}

function renderUsagePrices(pt:PriceTableView|null|undefined) {
  const box = document.getElementById('usagePrices');
  if (!pt || !pt.models) { box.textContent = '（价目表不可用）'; return; }
  const sym = pt.symbol || '¥';
  const tier = pt.nowTier;
  let html = `<div style="margin-bottom:6px">价目表版本 <code>${QQConsole.Core.esc(pt.version)}</code> ｜ 高峰时段为北京时间的 2 倍价（周一至周五 9:00-12:00、14:00-18:00，法定节假日除外，已内置 ${QQConsole.Core.esc(pt.holidayCount)} 天假期）</div>`;
  html += '<table><tr><th>模型</th><th class="num">缓存命中</th><th class="num">缓存未命中</th><th class="num">输出</th></tr>';
  for (const [name, m] of Object.entries(pt.models)) {
    // 单价与货币符号都可能来自 config.json 的 pricing 覆盖项（运维可写），
    // 不能直接拼进 innerHTML：这里统一走 esc() （数字原样显示仍然是数字）。
    const price = (v:unknown) => QQConsole.Core.esc((sym as string) + (Number.isFinite(Number(v)) ? Number(v) : (v ?? '')));
    html += `<tr><td><code>${QQConsole.Core.esc(name)}</code><div class="meta">${QQConsole.Core.esc(m.label)}</div></td>`
      + `<td class="num">${price(m.off?.cacheHit)}</td>`
      + `<td class="num">${price(m.off?.cacheMiss)}</td>`
      + `<td class="num">${price(m.off?.output)}</td></tr>`;
  }
  html += '</table>';
  html += `<div class="meta" style="padding:8px 10px">上表为<b>空闲时段</b>单价（元 / 百万 token）。当前时刻属于 <b>${tier ? QQConsole.Core.esc(tier.tierLabel) : '—'}</b>${tier?.estimated ? '，且价目表里没有 <code>' + QQConsole.Core.esc(tier.model) + '</code>，按兜底价估算' : ''}。</div>`;
  box.innerHTML = html;
}

export async function refreshUsage() {
  const msg = document.getElementById('usageMsg');
  try {
    const r = await QQConsole.Core.api<UsageSummaryView>('/api/tokens/summary?limit=200');
    const t = r.totals || {};
    const b = t.buckets || {};
    const sym = r.symbol || '¥';
    document.getElementById('metricUsageCost').textContent = usageMoney(t.cost, sym);
    document.getElementById('metricUsageCostHint').textContent =
      `高峰 ${usageMoney(t.byTier?.peak, sym)} ｜ 空闲 ${usageMoney(t.byTier?.off, sym)}`;
    document.getElementById('metricUsageTokens').textContent = usageNum(t.totalTokens);
    document.getElementById('metricUsageTokensHint').textContent =
      `输入 ${usageNum(t.inputTokens)} ｜ 输出 ${usageNum(b.output)}`;
    document.getElementById('metricUsageHitRate').textContent = usagePct(t.cacheHitRate);
    document.getElementById('metricUsageHitHint').textContent =
      `命中 ${usageNum(b.cacheHit)} ｜ 未命中 ${usageNum(b.cacheMiss)}`;
    document.getElementById('metricUsagePerTurn').textContent = usageMoney(t.avgCostPerTurn, sym);
    document.getElementById('metricUsagePerTurnHint').textContent =
      `${usageNum(t.turns)} 轮 ｜ ${usageNum(t.steps)} 步 ｜ 当前${r.nowTier?.tier === 'peak' ? '高峰' : '空闲'}时段`;
    renderUsageConversations(r);
    renderUsagePrices(r.priceTable ? { ...r.priceTable, nowTier: r.nowTier } : null);
    syncUsageKeySelect((r.conversations || []).map(c => String(c.key ?? '')));
    if (!document.getElementById('usageTurns').dataset.loaded && usageSelectedKey) refreshUsageTurns();
    msg.textContent = `✅ 已同步于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    msg.className = 'meta ok';
  } catch (error) {
    msg.textContent = `❌ 读取失败：${(error as QQConsole.Core.ErrorView|null)?.message || '未知错误'}`;
    msg.className = 'meta err';
  }
}

async function refreshUsageTurns() {
  const box = document.getElementById('usageTurns');
  if (!usageSelectedKey) {
    box.innerHTML = '<span class="meta">选择一个会话后加载逐轮明细…</span>';
    box.dataset.loaded = '';
    return;
  }
  try {
    const r = await QQConsole.Core.api<UsageTurnsView>('/api/tokens/turns?key=' + encodeURIComponent(usageSelectedKey) + '&limit=200');
    renderUsageTurns(r);
    box.dataset.loaded = '1';
  } catch (error) {
    box.innerHTML = `<span class="meta err">读取失败：${QQConsole.Core.esc((error as QQConsole.Core.ErrorView|null)?.message || '未知错误')}</span>`;
    box.dataset.loaded = '';
  }
}

export async function refreshUsageRecent() {
  try {
    renderUsageRecent(await QQConsole.Core.api<UsageRecentView>('/api/tokens/recent?limit=40'));
  } catch (error) {
    document.getElementById('usageRecent').innerHTML = '<span class="meta">（读取失败）</span>';
  }
}

document.getElementById('usageRefresh').addEventListener('click', () => {
  refreshUsage();
  QQConsole.UsageChart.refreshUsageChart();
  refreshUsageTurns();
  refreshUsageRecent();
  QQConsole.Navigation.showConsoleToast('用量已刷新');
});
document.getElementById('usageTurnsLoad').addEventListener('click', () => refreshUsageTurns());
document.getElementById('usageKeySelect').addEventListener('change', (ev) => {
  usageSelectedKey = (ev.target as HTMLSelectElement).value;
  refreshUsageTurns();
});
document.getElementById('usageClear').addEventListener('click', async () => {
  if (!confirm('确定清空 token 用量账本？累计花费与逐轮明细都会被删除，且不可恢复（下一次同步会从 DSH 重新拉取会话累计值）。')) return;
  const msg = document.getElementById('usageMsg');
  try {
    const r = await QQConsole.Core.api('/api/tokens/reset', 'POST', {});
    msg.textContent = r.ok ? '✅ 账本已清空' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
  } catch (error) {
    msg.textContent = '❌ ' + ((error as QQConsole.Core.ErrorView|null)?.message || '失败');
    msg.className = 'meta err';
  }
  usageSelectedKey = '';
  document.getElementById('usageTurnScope').textContent = '—';
  document.getElementById('usageTurns').dataset.loaded = '';
  refreshUsage();
  refreshUsageRecent();
});
}
