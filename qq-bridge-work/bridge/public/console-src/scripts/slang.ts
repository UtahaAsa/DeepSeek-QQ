namespace QQConsole.Slang {
export type SlangStatus='candidate'|'confirmed'|'rejected';
type SlangModalMode='confirm'|'edit';
interface SlangEntryView {id:string;status:string;content:string;source?:unknown;count?:unknown;meaning?:string;usage?:string;example?:string;risk?:string;sources?:unknown[];evidence?:{sender?:unknown;text?:unknown}[];}
interface SlangConfigView {enabled?:unknown;extractMinMessages?:number;extractCooldownMs?:number;inferenceThresholds?:unknown[];injectMax?:number;learnerPreset?:string;workspaceTitle?:string;autoResearch?:unknown;}
interface SlangReadView extends QQConsole.Core.ApiResult {entries?:SlangEntryView[];config?:SlangConfigView;}
interface SlangMutationView extends QQConsole.Core.ApiResult {count?:number;confirmedCount?:number;skippedCount?:number;rejectedCount?:number;removedCount?:number;}
type SlangButton<Key extends string>=HTMLButtonElement & {dataset:DOMStringMap & Record<Key,string>};
interface SlangTabButton extends HTMLButtonElement {dataset:DOMStringMap & {slangTab:SlangStatus};}



let slangEntriesCache:SlangEntryView[] = [];
let slangSelected = new Set<string>();
let slangActiveTab:SlangStatus = 'candidate';
let slangModalId:string|null = null;
let slangModalMode:SlangModalMode = 'confirm'; // confirm | edit

function slangStatusLabel(status:string) {
  return ({ candidate: '候选', confirmed: '已确认', rejected: '已拒绝' } as Record<string,string>)[status] || QQConsole.Core.esc(status);
}
function slangStatusClass(status:string) {
  return ({ candidate: 'pill b', confirmed: 'pill g', rejected: 'pill r' } as Record<string,string>)[status] || 'pill';
}
function slangSourceLabel(e:SlangEntryView) {
  if (e.source === 'manual') return '手动';
  if (Array.isArray(e.evidence) && e.evidence.some((ev) => ev.sender === 'AI提交')) return 'AI提交';
  return '自动提取';
}
function slangEvidenceHtml(e:SlangEntryView) {
  return Array.isArray(e.evidence) && e.evidence.length
    ? e.evidence.slice(-2).map((ev) => `<span class="meta">${QQConsole.Core.esc(String(ev.sender || '未知'))}：${QQConsole.Core.esc(String(ev.text || '').slice(0, 30))}</span>`).join('<br>')
    : '<span class="meta">—</span>';
}
function slangSourcesHtml(e:SlangEntryView) {
  return Array.isArray(e.sources) && e.sources.length
    ? e.sources.slice(0, 5).map((s) => `<span class="meta">🔗 ${QQConsole.Core.esc(s)}</span>`).join('<br>')
    : '';
}
function slangSearchFields(e:SlangEntryView) {
  return [e.content, e.meaning, e.usage, e.example, e.risk, Array.isArray(e.sources) ? e.sources.join(' ') : '', Array.isArray(e.evidence) ? e.evidence.map((x) => x.text || '').join(' ') : ''].join(' ').toLowerCase();
}
function getSlangLimit() {
  const id = slangActiveTab === 'candidate' ? 'slangLimitCand' : slangActiveTab === 'confirmed' ? 'slangLimitConfirmed' : 'slangLimitRejected';
  return Math.max(10, Number(document.getElementById(id)?.value) || 100);
}
function getSlangSearch() {
  const id = slangActiveTab === 'candidate' ? 'slangSearchCand' : slangActiveTab === 'confirmed' ? 'slangSearchConfirmed' : 'slangSearchRejected';
  return String(document.getElementById(id)?.value || '').trim().toLowerCase();
}
function selectedIdsForStatus(status:SlangStatus) {
  return [...slangSelected].filter((id) => slangEntriesCache.some((e) => e.id === id && e.status === status));
}
function setSlangMsg(text:string, ok = true) {
  const msg = document.getElementById('slangMsg');
  if (!msg) return;
  msg.textContent = text;
  msg.className = ok ? 'meta ok' : 'meta err';
}
export function setSlangTab(tab:SlangStatus) {
  slangActiveTab = tab;
  document.querySelectorAll<SlangTabButton>('.slang-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.slangTab === tab));
  document.querySelectorAll('.slang-panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'slangPanel' + tab[0].toUpperCase() + tab.slice(1)));
  renderSlangPanel();
}
function updateSlangSelectAll(status:SlangStatus) {
  const id = status === 'candidate' ? 'slangCandidateSelectAll' : status === 'confirmed' ? 'slangConfirmedSelectAll' : 'slangRejectedSelectAll';
  const el = document.getElementById(id);
  if (!el) return;
  const list = slangEntriesCache.filter((e) => e.status === status);
  const q = getSlangSearch();
  const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
  el.checked = filtered.length > 0 && filtered.every((e) => slangSelected.has(e.id));
  el.indeterminate = filtered.some((e) => slangSelected.has(e.id)) && !el.checked;
}

function renderSlangPanel() {
  const status = slangActiveTab;
  const containerId = status === 'candidate' ? 'slangCandidateList' : status === 'confirmed' ? 'slangConfirmedList' : 'slangRejectedList';
  const box = document.getElementById(containerId);
  if (!box) return;
  const list = slangEntriesCache.filter((e) => e.status === status);
  const q = getSlangSearch();
  const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
  if (!filtered.length) {
    box.innerHTML = '<div class="meta" style="padding:8px">' + (list.length ? '没有符合条件的词条' : (status === 'candidate' ? '暂无候选黑话，等 DSH 自动提取、AI 提交或手动添加' : status === 'confirmed' ? '暂无已确认黑话' : '暂无已拒绝词条')) + '</div>';
    updateSlangSelectAll(status);
    return;
  }
  const limit = getSlangLimit();
  const shown = filtered.slice(0, limit);
  let html = `<div class="meta" style="padding:6px 8px">共 ${filtered.length} 条，显示 ${shown.length} 条（可滚动查找）</div>`;
  html += '<table><tr><th>选择</th><th>词条</th><th>次数</th><th>来源</th><th>含义 / 用法 / 示例</th><th>参考来源</th><th>语境证据</th><th>操作</th></tr>';
  for (const e of shown) {
    const meaning = e.meaning ? QQConsole.Core.esc(e.meaning) : (status === 'candidate' ? '<span class="meta">待研究</span>' : '<span class="meta">无</span>');
    const checked = slangSelected.has(e.id) ? ' checked' : '';
    const actions:string[] = [];
    if (status === 'candidate') {
      actions.push(`<button class="small" data-slang-confirm="${QQConsole.Core.esc(e.id)}">确认</button>`);
      actions.push(`<button class="small" data-slang-edit="${QQConsole.Core.esc(e.id)}">编辑</button>`);
      actions.push(`<button class="small" data-slang-reject="${QQConsole.Core.esc(e.id)}">拒绝</button>`);
    } else if (status === 'confirmed') {
      actions.push(`<button class="small" data-slang-edit="${QQConsole.Core.esc(e.id)}">编辑</button>`);
    } else {
      actions.push(`<button class="small" data-slang-restore="${QQConsole.Core.esc(e.id)}">恢复候选</button>`);
    }
    actions.push(`<button class="small danger" data-slang-del="${QQConsole.Core.esc(e.id)}">删</button>`);
    html += `<tr>
      <td><input type="checkbox" data-slang-select="${QQConsole.Core.esc(e.id)}"${checked}></td>
      <td><b>${QQConsole.Core.esc(e.content)}</b><br><span class="${slangStatusClass(status)}">${slangStatusLabel(status)}</span></td>
      <td>${QQConsole.Core.esc(e.count)}</td>
      <td>${QQConsole.Core.esc(slangSourceLabel(e))}</td>
      <td>${meaning}${e.usage ? '<br><span class="meta">用法：' + QQConsole.Core.esc(e.usage) + '</span>' : ''}${e.example ? '<br><span class="meta">例：' + QQConsole.Core.esc(e.example) + '</span>' : ''}${e.risk ? '<br><span class="meta">风险：' + QQConsole.Core.esc(e.risk) + '</span>' : ''}</td>
      <td>${slangSourcesHtml(e) || '<span class="meta">—</span>'}</td>
      <td>${slangEvidenceHtml(e)}</td>
      <td class="row">${actions.join('')}</td>
    </tr>`;
  }
  box.innerHTML = html + '</table>';
  box.querySelectorAll<HTMLInputElement & {dataset:DOMStringMap & {slangSelect:string}}>('[data-slang-select]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.slangSelect;
    if (cb.checked) slangSelected.add(id); else slangSelected.delete(id);
    updateSlangSelectAll(status);
  }));
  box.querySelectorAll<SlangButton<'slangConfirm'>>('[data-slang-confirm]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangConfirm, 'confirm')));
  box.querySelectorAll<SlangButton<'slangEdit'>>('[data-slang-edit]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangEdit, 'edit')));
  box.querySelectorAll<SlangButton<'slangReject'>>('[data-slang-reject]').forEach((btn) => btn.addEventListener('click', async () => {
    const r2 = await QQConsole.Core.api('/api/slang/' + btn.dataset.slangReject + '/reject', 'POST', {});
    if (!r2.ok) alert(r2.error || '拒绝失败');
    setSlangMsg(r2.ok ? '✅ 已拒绝' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  box.querySelectorAll<SlangButton<'slangRestore'>>('[data-slang-restore]').forEach((btn) => btn.addEventListener('click', async () => {
    const e = slangEntriesCache.find((x) => x.id === btn.dataset.slangRestore);
    if (!e) return;
    const r2 = await QQConsole.Core.api('/api/slang/' + e.id, 'PATCH', { status: 'candidate' });
    if (!r2.ok) alert(r2.error || '恢复失败');
    setSlangMsg(r2.ok ? '✅ 已恢复为候选' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  box.querySelectorAll<SlangButton<'slangDel'>>('[data-slang-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确定删除该黑话？')) return;
    const r2 = await QQConsole.Core.api('/api/slang/' + btn.dataset.slangDel, 'DELETE', {});
    if (!r2.ok) alert(r2.error || '删除失败');
    setSlangMsg(r2.ok ? '✅ 已删除' : ('❌ ' + (r2.error || '失败')), r2.ok);
    slangSelected.delete(btn.dataset.slangDel);
    refreshSlang();
  }));
  updateSlangSelectAll(status);
}

export async function refreshSlang() {
  try {
    const r = await QQConsole.Core.api<SlangReadView>('/api/slang');
    slangEntriesCache = r.entries || [];
    renderSlangPanel();
  } catch (e) {
    const box = document.getElementById('slangCandidateList');
    if (box) box.innerHTML = '<span class="meta">加载失败</span>';
  }
}

function openSlangModal(id:string, mode:SlangModalMode) {
  const e = slangEntriesCache.find((x) => x.id === id);
  if (!e) return;
  slangModalId = id;
  slangModalMode = mode;
  document.getElementById('slangModalTitle').textContent = mode === 'confirm' ? `确认黑话：${e.content}` : `编辑黑话：${e.content}`;
  document.getElementById('slangModalContent').textContent = mode === 'confirm'
    ? '你可以直接填写含义/用法并转正，也可以先送 DSH 深度联网研究，研究结果回来后在此处删改再确认。'
    : '修改后保存；候选不会转正，已确认仍保持已确认。';
  document.getElementById('slangModalMeaning').value = e.meaning || '';
  document.getElementById('slangModalUsage').value = e.usage || '';
  document.getElementById('slangModalExample').value = e.example || '';
  document.getElementById('slangModalRisk').value = e.risk || '';
  document.getElementById('slangModalSources').value = Array.isArray(e.sources) ? e.sources.join('\n') : '';
  document.getElementById('slangModalDirectConfirm').textContent = mode === 'confirm' ? '直接确认（转正）' : '保存修改';
  document.getElementById('slangModalSendResearch').style.display = mode === 'confirm' && e.status === 'candidate' ? '' : 'none';
  document.getElementById('slangModalOverlay').classList.add('open');
}
export function closeSlangModal() {
  document.getElementById('slangModalOverlay').classList.remove('open');
  slangModalId = null;
}
function readSlangModalPayload() {
  return {
    meaning: document.getElementById('slangModalMeaning').value.trim(),
    usage: document.getElementById('slangModalUsage').value.trim(),
    example: document.getElementById('slangModalExample').value.trim(),
    risk: document.getElementById('slangModalRisk').value.trim(),
    sources: document.getElementById('slangModalSources').value.split(/\n/).map((s) => s.trim()).filter(Boolean)
  };
}

document.querySelectorAll<SlangTabButton>('.slang-tab').forEach((btn) => btn.addEventListener('click', () => setSlangTab(btn.dataset.slangTab)));
document.getElementById('slangSearchCand').addEventListener('input', renderSlangPanel);
document.getElementById('slangSearchConfirmed').addEventListener('input', renderSlangPanel);
document.getElementById('slangSearchRejected').addEventListener('input', renderSlangPanel);
document.getElementById('slangLimitCand').addEventListener('change', renderSlangPanel);
document.getElementById('slangLimitConfirmed').addEventListener('change', renderSlangPanel);
document.getElementById('slangLimitRejected').addEventListener('change', renderSlangPanel);
document.getElementById('slangCandidateSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => x.status === 'candidate');
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if ((e.target as HTMLInputElement).checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangConfirmedSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => x.status === 'confirmed');
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if ((e.target as HTMLInputElement).checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangRejectedSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => x.status === 'rejected');
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if ((e.target as HTMLInputElement).checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangBatchResearch').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要研究的候选词'); return; }
  const r = await QQConsole.Core.api<SlangMutationView>('/api/slang/research', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已送 ${r.count} 条候选到 DSH 深度联网研究，完成后刷新查看结果` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) refreshSlang();
});
document.getElementById('slangBatchConfirm').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要确认的候选词'); return; }
  if (!confirm(`确定批量确认 ${ids.length} 条候选？缺少含义的会被跳过。`)) return;
  const r = await QQConsole.Core.api<SlangMutationView>('/api/slang/batch-confirm', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已确认 ${r.confirmedCount} 条，跳过 ${r.skippedCount} 条` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchReject').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要拒绝的候选词'); return; }
  if (!confirm(`确定拒绝 ${ids.length} 条候选？`)) return;
  const r = await QQConsole.Core.api<SlangMutationView>('/api/slang/batch-reject', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已拒绝 ${r.rejectedCount} 条` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteCand').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要删除的候选词'); return; }
  if (!confirm(`确定删除 ${ids.length} 条候选？此操作不可恢复！`)) return;
  const r = await QQConsole.Core.api<SlangMutationView>('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条候选` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteConfirmed').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('confirmed');
  if (!ids.length) { alert('请先勾选要删除的已确认词条'); return; }
  if (!confirm(`确定删除 ${ids.length} 条已确认黑话？此操作不可恢复！`)) return;
  const r = await QQConsole.Core.api<SlangMutationView>('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已确认` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteRejected').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('rejected');
  if (!ids.length) { alert('请先勾选要删除的已拒绝词条'); return; }
  if (!confirm(`确定删除 ${ids.length} 条已拒绝词条？此操作不可恢复！`)) return;
  const r = await QQConsole.Core.api<SlangMutationView>('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已拒绝` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchRestore').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('rejected');
  if (!ids.length) { alert('请先勾选要恢复的已拒绝词条'); return; }
  let okCount = 0;
  for (const id of ids) {
    const r = await QQConsole.Core.api('/api/slang/' + id, 'PATCH', { status: 'candidate' });
    if (r.ok) okCount++;
  }
  setSlangMsg(`✅ 已恢复 ${okCount}/${ids.length} 条为候选`);
  if (okCount) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangModalDirectConfirm').addEventListener('click', async () => {
  if (!slangModalId) return;
  const payload = readSlangModalPayload();
  if (!payload.meaning) { alert('请先填写含义，确认后才会注入 AI 上下文'); return; }
  const e = slangEntriesCache.find((x) => x.id === slangModalId);
  if (!e) return;
  const path = slangModalMode === 'confirm' ? `/api/slang/${e.id}/confirm` : `/api/slang/${e.id}`;
  const r2 = await QQConsole.Core.api(path, slangModalMode === 'confirm' ? 'POST' : 'PATCH', payload);
  if (!r2.ok) alert(r2.error || '保存失败');
  setSlangMsg(r2.ok ? (slangModalMode === 'confirm' ? '✅ 已确认转正' : '✅ 已保存') : ('❌ ' + (r2.error || '失败')), r2.ok);
  closeSlangModal();
  refreshSlang();
});
document.getElementById('slangModalSendResearch').addEventListener('click', async () => {
  if (!slangModalId) return;
  const r = await QQConsole.Core.api<SlangMutationView>('/api/slang/research', 'POST', { ids: [slangModalId] });
  setSlangMsg(r.ok ? `✅ 已送「${slangEntriesCache.find((x) => x.id === slangModalId)?.content || ''}」到 DSH 深度联网研究，稍后刷新查看结果` : ('❌ ' + (r.error || '失败')), r.ok);
  closeSlangModal();
  refreshSlang();
});
document.getElementById('slangModalCancel').addEventListener('click', closeSlangModal);
document.getElementById('slangModalOverlay').addEventListener('click', (e) => { if ((e.target as Element).id === 'slangModalOverlay') closeSlangModal(); });

document.getElementById('slangAdd').addEventListener('click', async () => {
  const content = document.getElementById('slangContent').value.trim();
  const meaning = document.getElementById('slangMeaning').value.trim();
  const usage = document.getElementById('slangUsage').value.trim();
  const example = document.getElementById('slangExample').value.trim();
  if (!content) { alert('词条不能为空'); return; }
  const r = await QQConsole.Core.api('/api/slang', 'POST', { content, meaning, usage, example });
  document.getElementById('slangMsg').textContent = r.ok ? '✅ 已添加' : ('❌ ' + (r.error || '失败'));
  document.getElementById('slangMsg').className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) {
    document.getElementById('slangContent').value = '';
    document.getElementById('slangMeaning').value = '';
    document.getElementById('slangUsage').value = '';
    document.getElementById('slangExample').value = '';
    refreshSlang();
  }
});
document.getElementById('slangExtract').addEventListener('click', async () => {
  const r = await QQConsole.Core.api('/api/slang/extract', 'POST', {});
  setSlangMsg(r.ok ? '✅ 已触发提取' : ('❌ ' + (r.error || '失败')), r.ok);
});
document.getElementById('slangResearch').addEventListener('click', async () => {
  const r = await QQConsole.Core.api<SlangMutationView>('/api/slang/research', 'POST', {});
  setSlangMsg(r.ok ? ('✅ 已触发研究 ' + r.count + ' 条') : ('❌ ' + (r.error || '失败')), r.ok);
});
export function loadSlangConfig() {
  QQConsole.Core.api<SlangReadView>('/api/slang').then(r => {
    const c = r.config || {};
    document.getElementById('slangEnabled').checked = c.enabled !== false;
    document.getElementById('slangExtractMin').value = c.extractMinMessages ?? 10;
    document.getElementById('slangCooldown').value = c.extractCooldownMs ?? 300000;
    document.getElementById('slangThresholds').value = (c.inferenceThresholds || [2, 4, 8]).join(', ');
    document.getElementById('slangInjectMax').value = c.injectMax ?? 8;
    document.getElementById('slangLearnerPreset').value = c.learnerPreset || 'qq-chat';
    document.getElementById('slangWorkspaceTitle').value = c.workspaceTitle || 'QQ 黑话学习';
    document.getElementById('slangAutoResearch').checked = c.autoResearch !== false;
  }).catch(() => {});
}
document.getElementById('slangConfigSave').addEventListener('click', async () => {
  const r = await QQConsole.Core.api('/api/slang/config', 'POST', {
    enabled: document.getElementById('slangEnabled').checked,
    extractMinMessages: Number(document.getElementById('slangExtractMin').value) || 10,
    extractCooldownMs: Number(document.getElementById('slangCooldown').value) || 300000,
    inferenceThresholds: document.getElementById('slangThresholds').value.split(/[,，\s]+/).map(Number).filter(Boolean),
    injectMax: Number(document.getElementById('slangInjectMax').value) || 8,
    learnerPreset: document.getElementById('slangLearnerPreset').value.trim(),
    workspaceTitle: document.getElementById('slangWorkspaceTitle').value.trim(),
    autoResearch: document.getElementById('slangAutoResearch').checked
  });
  const msg = document.getElementById('slangConfigMsg');
  msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadSlangConfig();
});
}
