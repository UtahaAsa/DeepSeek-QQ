namespace QQConsole.UsageChart {
type ChartMetric='cost'|'tokens';
interface SeriesBucket {t:number;tokens?:unknown;cost?:unknown;cacheMiss?:unknown;cacheHit?:unknown;output?:unknown;steps?:unknown;turns?:unknown;tier?:unknown;keys?:unknown[];}
interface SeriesView extends QQConsole.Core.ApiResult {symbol?:unknown;buckets?:SeriesBucket[];bucketMs:number;busiest?:{t:number;cost?:unknown};estimated?:unknown;offChartCost?:unknown;offChartTokens?:unknown;countedSamples?:unknown;}


// ── 消耗走势图（手写 SVG） ───────────────────────────────────────────────
// 为什么不用图表库：控制台 CSP 是 default-src 'self'，不能引外部脚本；
// 而 SVG 用 document.createElementNS 生成既没有 innerHTML 转义风险，
// 也能直接用 CSS 变量跟随深浅主题。
let usageChartHours = 24;
let usageChartMetric:ChartMetric = 'cost';
let usageChartData:SeriesView|null = null;

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl<Tag extends keyof SVGElementTagNameMap>(name:Tag, attrs:Record<string,unknown> = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
function usageBucketValue(b:SeriesBucket, metric:ChartMetric) {
  return metric === 'tokens' ? (Number(b.tokens) || 0) : (Number(b.cost) || 0);
}
function usageMetricLabel(metric:ChartMetric) {
  return metric === 'tokens' ? 'token' : '花费';
}
function usageAxisValue(v:number, metric:ChartMetric, sym:unknown) {
  if (metric === 'tokens') return QQConsole.UsageLedger.usageNum(v);
  if (v === 0) return sym + '0';
  return v < 0.01 ? sym + v.toFixed(4) : sym + v.toFixed(2);
}
function usageBucketClock(ms:number, bucketMs:number) {
  const d = new Date(ms);
  const p = (n:number) => String(n).padStart(2, '0');
  // 桶宽 ≥ 1 天时只显示日期，否则显示「日 时:分」，跨天也能分辨。
  if (bucketMs >= 24 * 3600 * 1000) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderUsageChart(series:SeriesView) {
  const box = document.getElementById('usageChart');
  const totalEl = document.getElementById('usageChartTotal');
  const hintEl = document.getElementById('usageChartHint');
  const noteEl = document.getElementById('usageChartNote');
  usageChartData = series;
  const sym = series?.symbol || '¥';
  const buckets = Array.isArray(series?.buckets) ? series.buckets : [];
  if (!buckets.length) {
    box.innerHTML = '';
    box.textContent = '暂无数据';
    totalEl.textContent = '—';
    hintEl.textContent = '还没有用量记录';
    noteEl.textContent = '';
    return;
  }
  const metric = usageChartMetric;
  const values = buckets.map((b) => usageBucketValue(b, metric));
  const max = Math.max(...values, 0);
  // 全零时给一个假上限，避免除零；同时让空图看起来是"平"的而不是报错。
  const scaleMax = max > 0 ? max : 1;

  const W = 960;
  const H = 240;
  const padL = 62;
  const padR = 12;
  const padT = 12;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const step = plotW / buckets.length;
  const barW = Math.max(2, step * 0.72);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${usageMetricLabel(metric)}随时间的走势图` });

  // 横向网格 + 纵轴刻度（3 条线即可：0 / 一半 / 最大）
  // 窗口内完全没有用量时（max === 0）三条刻度都写 0：不能编出一个 ¥1 的假量程，
  // 那会让人以为"有量但很小"。
  for (let i = 0; i <= 2; i += 1) {
    const y = padT + plotH - (plotH * i) / 2;
    svg.appendChild(svgEl('line', { class: 'usage-grid', x1: padL, y1: y, x2: W - padR, y2: y }));
    const label = svgEl('text', { class: 'usage-axis', x: padL - 8, y: y + 3, 'text-anchor': 'end' });
    label.textContent = usageAxisValue(max > 0 ? (scaleMax * i) / 2 : 0, metric, sym);
    svg.appendChild(label);
  }

  // 柱：颜色 = 该桶的峰谷档位，所以"什么时候贵"是一眼可见的
  for (let i = 0; i < buckets.length; i += 1) {
    const b = buckets[i];
    const v = values[i];
    const x = padL + i * step + (step - barW) / 2;
    const h = v > 0 ? Math.max(1.5, (v / scaleMax) * plotH) : 0;
    const tooltip = svgEl('title');
    tooltip.textContent = `${usageBucketClock(b.t, series.bucketMs)}\n${usageMetricLabel(metric)}：${usageAxisValue(v, metric, sym)}`
      + `\n未命中输入：${QQConsole.UsageLedger.usageNum(b.cacheMiss)} ｜ 命中输入：${QQConsole.UsageLedger.usageNum(b.cacheHit)} ｜ 输出：${QQConsole.UsageLedger.usageNum(b.output)}`
      + `\n步数：${QQConsole.UsageLedger.usageNum(b.steps)} ｜ 轮次：${QQConsole.UsageLedger.usageNum(b.turns)}`
      + `\n时段：${b.tier === 'peak' ? '高峰（单价 ×2）' : (b.tier === 'mixed' ? '跨时段' : '空闲')}`
      + (b.keys?.length ? `\n会话：${b.keys.join('、')}` : '');
    if (h > 0) {
      const rect = svgEl('rect', { x, y: padT + plotH - h, width: barW, height: h, rx: 2, class: `usage-bar-${b.tier === 'peak' ? 'peak' : (b.tier === 'mixed' ? 'mixed' : 'off')}` });
      rect.appendChild(tooltip);
      svg.appendChild(rect);
    }
    // 透明命中区：0 值的桶也能 hover（鼠标移到空白处也要能看出那一刻是空闲还是高峰）
    const hit = svgEl('rect', { x: padL + i * step, y: padT, width: step, height: plotH, class: 'usage-hit' });
    hit.appendChild(tooltip.cloneNode(true));
    svg.appendChild(hit);
  }

  // 横轴：最多 6 个刻度，避免挤在一起
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 6));
  for (let i = 0; i < buckets.length; i += tickEvery) {
    const label = svgEl('text', { class: 'usage-axis', x: padL + i * step + step / 2, y: H - padB + 16, 'text-anchor': 'middle' });
    label.textContent = usageBucketClock(buckets[i].t, series.bucketMs);
    svg.appendChild(label);
  }

  box.innerHTML = '';
  box.appendChild(svg);

  const windowTotal = buckets.reduce((sum, b) => sum + usageBucketValue(b, metric), 0);
  totalEl.textContent = metric === 'tokens' ? `${QQConsole.UsageLedger.usageNum(windowTotal)} token` : QQConsole.UsageLedger.usageMoney(windowTotal, sym);
  const busiest = series.busiest;
  hintEl.textContent = `窗口内合计 ｜ 每格 ${Math.round(series.bucketMs / 60000)} 分钟`
    + (busiest && metric === 'cost' ? ` ｜ 最贵一格：${usageBucketClock(busiest.t, series.bucketMs)} ${QQConsole.UsageLedger.usageMoney(busiest.cost, sym)}` : '')
    + (series.estimated ? ' ｜ ⚠️ 含按兜底价估算的模型' : '');

  // 图上一定要能看出"还有多少没画进来"：投影基线覆盖的更早历史没有逐时明细。
  const notes:string[] = [];
  if (Number(series.offChartCost) > 0.0001) {
    notes.push(`另有 ${QQConsole.UsageLedger.usageMoney(series.offChartCost, sym)}（约 ${QQConsole.UsageLedger.usageNum(series.offChartTokens)} token）属于更早的历史，只有累计值、没有逐时明细，因此不在上图里；所以本图合计会小于「总花费」。`);
  }
  if (series.countedSamples === 0) {
    notes.push('所选时间窗内没有采样：要么这段时间真的没调用，要么逐轮明细已被容量上限淘汰（累计总量仍然准确）。');
  }
  noteEl.textContent = notes.join(' ');
}

export async function refreshUsageChart() {
  try {
    const r = await QQConsole.Core.api<SeriesView>(`/api/tokens/series?hours=${usageChartHours}`);
    renderUsageChart(r);
  } catch (error) {
    document.getElementById('usageChart').textContent = `走势读取失败：${(error as QQConsole.Core.ErrorView|null)?.message || '未知错误'}`;
  }
}

document.getElementById('usageChartControls').addEventListener('click', (ev) => {
  const hoursBtn = (ev.target as Element).closest<HTMLButtonElement>('[data-usage-hours]');
  const metricBtn = (ev.target as Element).closest<HTMLButtonElement>('[data-usage-metric]');
  if (hoursBtn) {
    usageChartHours = Number(hoursBtn.dataset.usageHours) || 24;
    document.querySelectorAll('#usageChartControls [data-usage-hours]').forEach((b) => b.classList.toggle('active', b === hoursBtn));
    refreshUsageChart();
  } else if (metricBtn) {
    usageChartMetric = metricBtn.dataset.usageMetric === 'tokens' ? 'tokens' : 'cost';
    document.querySelectorAll('#usageChartControls [data-usage-metric]').forEach((b) => b.classList.toggle('active', b === metricBtn));
    // 只换纵轴：不重新请求，直接重画现有数据。
    if (usageChartData) renderUsageChart(usageChartData);
  }
});
}
