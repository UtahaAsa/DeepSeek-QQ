import { GEN1_ROLE_LINE_RE, parseRoleSections, renderRoleInjection, roleCharStats, roleSectionReport } from '/roles/role-card.js';
import { confirmAction } from '/roles/confirmation.js';
const byId = id => document.getElementById(id);
let editing = null, currentName = null, dirty = false, busy = false, names = [];
let injectionLimit = 8000, limitVerified = false, libraryCard = null;
const feedback = (text, error = false) => { byId('feedback').textContent = text; byId('feedback').dataset.error = String(error); };
function controls() {
  for (const id of ['new', 'roles', 'save', 'clear', 'file', 'library']) byId(id).disabled = busy;
  byId('role-form').setAttribute('aria-busy', String(busy));
  byId('library-import').disabled = busy || !libraryCard;
  byId('use').disabled = busy || !editing || dirty;
  byId('delete').disabled = busy || !editing || dirty;
  for (const button of byId('deleted-roles').querySelectorAll('button')) button.disabled = busy;
  byId('name').readOnly = !!editing; byId('name').disabled = busy; byId('content').disabled = busy;
}
function count() {
  const bytes = new TextEncoder().encode(byId('content').value).length;
  byId('count').textContent = `${bytes.toLocaleString()} / 65,536 字节 · 支持文字与 Markdown`;
  preview();
}
function preview() {
  const content = byId('content').value, mode = byId('preview-mode').value;
  const stats = roleCharStats(content), projected = renderRoleInjection(content, mode, injectionLimit);
  byId('injection').value = projected;
  const unmarkedLegacy = parseRoleSections(content).filter(section => section.mode === 'all').some(section =>
    section.lines.some(line => GEN1_ROLE_LINE_RE.test(line)));
  byId('preview-summary').textContent = `角色原文 ${content.length} 字符；此模式正文 ${projected.length} 字符；上限 ${injectionLimit}${limitVerified ? '' : '（默认值，尚未连接桥接确认）'}。` +
    (stats[mode] > injectionLimit ? ' 超出部分不会注入。' : '') + (unmarkedLegacy ? ' 未标记小节含一代旧指令，二代会执行兼容过滤，请核对预览。' : '');
  byId('section-report').replaceChildren(...roleSectionReport(content, mode).map(section => {
    const item = document.createElement('li'); item.textContent = `${section.injected ? '参与此模式' : '不适用此模式'}：${section.heading}`; return item;
  }));
}
async function request(operation, body) {
  const response = await fetch('/roles/api/' + operation, { method: body ? 'POST' : 'GET',
    headers: { 'X-QQ-Local-Action': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(35000) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error('角色操作未完成。请确认桥接已就绪、名称有效且内容不超过 64 KiB，再重试。');
  return data;
}
async function run(action) {
  if (busy) return;
  busy = true; controls(); feedback('正在处理…');
  try { await action(); } catch (error) { feedback(error.message || '暂时无法连接角色管理服务。', true); }
  finally { busy = false; controls(); }
}
async function refresh() {
  const data = await request('list'); names = data.roles; currentName = data.current;
  if (Number.isInteger(data.limits?.injectMaxChars) && data.limits.injectMaxChars >= 1000 && data.limits.injectMaxChars <= 20000) {
    injectionLimit = data.limits.injectMaxChars; limitVerified = true; preview();
  }
  const list = byId('roles'); list.replaceChildren();
  for (const name of names) { const option = document.createElement('option'); option.value = name; option.textContent = name; list.append(option); }
  list.value = editing ?? '';
  byId('current').textContent = data.current ? '当前选用：' + data.current : '当前未选用角色卡';
  const deleted = byId('deleted-roles'); deleted.replaceChildren();
  for (const entry of data.deletedRoles ?? []) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '恢复「' + entry.name + '」';
    button.addEventListener('click', () => void run(async () => { await request('restore', { restoreId: entry.restoreId }); await refresh(); feedback('角色卡已恢复，当前选用保持原设置。'); }));
    deleted.append(button);
  }
}
async function loadLibrary() {
  try {
    const data = await request('library');
    const list = byId('library'); list.replaceChildren();
    for (const card of data.entries) {
      const option = document.createElement('option'); option.value = card.name;
      option.textContent = card.name + (card.runtimeRelation === 'different' ? '（运行副本不同）' : ''); list.append(option);
    }
    list.value = ''; byId('library-status').textContent = `共 ${data.entries.length} 张角色卡。先预览，再导入副本。`;
  } catch { byId('library-status').textContent = '角色库暂时不可读，仍可从文字文件导入或手动新建。'; }
}
byId('library').addEventListener('change', () => void run(async () => {
  libraryCard = null;
  const card = await request('library-content?name=' + encodeURIComponent(byId('library').value)); libraryCard = card;
  byId('library-content').value = card.content;
  const relation = { different: '与当前运行副本内容不同。导入会另建副本，不覆盖。', same: '与当前同名运行副本相同。仍可另建副本编辑。',
    missing: '当前运行目录尚无同名卡片。', unavailable: '当前同名运行副本不可读；导入不会覆盖它。' };
  byId('library-relation').textContent = `${card.name} · ${card.bytes.toLocaleString()} 字节。${relation[card.runtimeRelation] ?? ''}`;
  feedback('库内原文已载入预览，编辑区和当前角色保持不变。');
}));
byId('library-import').addEventListener('click', async () => {
  if (busy || !libraryCard || !await discardAllowed()) return;
  let name = libraryCard.name, index = 1;
  while (names.includes(name)) { const suffix = '-副本' + (index > 1 ? index : ''); name = libraryCard.name.slice(0, 40 - suffix.length) + suffix; index++; }
  editing = null; dirty = true; byId('roles').value = ''; byId('name').value = name; byId('content').value = libraryCard.content;
  count(); controls(); feedback('已填入新副本编辑区。保存后才会写入，再选用后才应用。'); byId('name').focus();
});
async function discardAllowed() { return !dirty || await confirmAction('当前编辑尚未保存，要放弃这些修改吗？'); }
function draft() { editing = null; dirty = false; byId('roles').value = ''; byId('name').value = ''; byId('content').value = ''; count(); controls(); }
byId('new').addEventListener('click', async () => { if (busy || !await discardAllowed()) return; draft(); feedback('填写名称和内容，然后保存。'); byId('name').focus(); });
byId('roles').addEventListener('change', async () => {
  const name = byId('roles').value;
  if (!await discardAllowed()) { byId('roles').value = editing ?? ''; return; }
  void run(async () => { const data = await request('content?name=' + encodeURIComponent(name)); editing = name;
    byId('name').value = name; byId('content').value = data.content; dirty = false; count(); feedback('已载入，编辑后请保存。'); });
});
for (const id of ['name', 'content']) byId(id).addEventListener('input', () => { dirty = true; count(); controls(); });
byId('file').addEventListener('change', () => void run(async () => {
  const file = byId('file').files[0]; if (!file) return;
  try {
  if (file.size > 65536 || !/\.(md|txt)$/i.test(file.name)) throw new Error('请选择不超过 64 KiB 的 .md 或 .txt 文件。');
  if (byId('content').value && !await confirmAction('导入会替换编辑区内容，继续吗？')) { feedback('已取消导入，编辑内容保留。'); return; }
  const bytes = await file.arrayBuffer();
  byId('content').value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!editing && !byId('name').value) byId('name').value = file.name.replace(/\.(md|txt)$/i, '').slice(0, 40);
  dirty = true; count(); feedback('已导入编辑区，保存后才会写入角色卡。');
  } finally { byId('file').value = ''; }
}));
byId('role-form').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
  const name = byId('name').value.trim(), content = byId('content').value;
  if (!name || name.length > 40 || !content.trim() || new TextEncoder().encode(content).length > 65536) throw new Error('请填写有效名称和内容，内容最多 64 KiB。');
  if (!editing && names.includes(name)) throw new Error('这个名称已经存在，请从列表中选择后编辑，或换一个名称。');
  await request(editing ? 'update' : 'create', { name, content }); editing = name; dirty = false; await refresh();
  feedback(currentName === editing ? '已保存，当前角色卡的更新将用于后续聊天。' : '已保存。点击“选用这张角色卡”后应用于后续聊天。');
}); });
byId('use').addEventListener('click', () => void run(async () => { await request('select', { role: editing }); await refresh(); feedback('已选用，后续聊天将使用这张角色卡。'); }));
byId('clear').addEventListener('click', () => void run(async () => { await request('select', { role: null }); await refresh(); feedback('已停用角色卡，角色内容和对话记录保留。'); }));
byId('delete').addEventListener('click', async () => {
  if (busy || !editing || dirty) return;
  const name = editing, active = currentName === name;
  if (!await confirmAction(`将角色「${name}」移入回收站？${active ? '该角色正在使用，删除后会取消选用。' : ''}可从角色回收站恢复。`)) return;
  void run(async () => { await request('delete', { name, clearCurrent: active }); draft(); await refresh(); feedback('角色已移入回收站，可以恢复。'); });
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
byId('preview-mode').addEventListener('change', preview);
void loadLibrary();
void run(async () => { await refresh(); feedback(names.length ? '请选择已有角色卡，或新增一张。' : '还没有角色卡，填写名称和内容开始创建。'); });
count();
