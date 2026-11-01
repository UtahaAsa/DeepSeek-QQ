namespace QQConsole.RoleBindings {

document.getElementById('roleSet').addEventListener('click', async () => {
  const r = await QQConsole.Core.api('/api/role', 'POST', { role: document.getElementById('roleInput').value.trim() });
  if (r.ok) QQConsole.Roles.refreshRoles(); else alert(r.error || '设置失败');
});
document.getElementById('roleClear').addEventListener('click', async () => { await QQConsole.Core.api('/api/role', 'POST', { role: null }); QQConsole.Roles.refreshRoles(); QQConsole.Core.refresh(); });
document.getElementById('roleCreate').addEventListener('click', async () => {
  const name = document.getElementById('newRoleName').value.trim();
  const content = document.getElementById('newRoleContent').value.trim();
  if (!name) { QQConsole.Roles.setRoleMsg('请先填人格名', false); return; }
  const editing = QQConsole.Roles.roleEditorState.mode === 'edit';
  const exists = QQConsole.Roles.roleCache.some((role) => role.name === name);
  // 编辑模式下改了名字 → 先重命名文件，再保存内容
  if (editing && QQConsole.Roles.roleEditorState.name !== name) {
    const renamed = await QQConsole.Core.api('/api/roles/rename', 'POST', { from: QQConsole.Roles.roleEditorState.name, to: name });
    if (!renamed.ok) { QQConsole.Roles.setRoleMsg('❌ ' + (renamed.error || '重命名失败'), false); return; }
  }
  const endpoint = editing || exists ? '/api/roles/update' : '/api/roles/create';
  const r = await QQConsole.Core.api(endpoint, 'POST', { name, content });
  QQConsole.Roles.setRoleMsg(r.ok ? `✅ 已保存「${name}」` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) {
    QQConsole.Roles.roleEditorState = { mode: 'edit', name };
    document.getElementById('roleEditorWarnings').textContent = (r.warnings || []).length ? '⚠️ ' + r.warnings!.join('；') : '';
    await QQConsole.Roles.refreshRoles();
  }
});
document.getElementById('roleDuplicate').addEventListener('click', async () => {
  const source = document.getElementById('newRoleName').value.trim();
  const content = document.getElementById('newRoleContent').value.trim();
  const target = (prompt('把当前内容另存为新的人格，名称：', source ? source + '-副本' : '') || '').trim();
  if (!target) return;
  const r = await QQConsole.Core.api('/api/roles/create', 'POST', { name: target, content });
  if (!r.ok) { QQConsole.Roles.setRoleMsg('❌ ' + (r.error || '另存失败'), false); return; }
  document.getElementById('newRoleName').value = target;
  QQConsole.Roles.roleEditorState = { mode: 'edit', name: target };
  QQConsole.Roles.renderRoleEditor();
  QQConsole.Roles.setRoleMsg(`✅ 已另存为「${target}」`, true);
  QQConsole.Roles.refreshRoles();
});
document.getElementById('roleDelete').addEventListener('click', async () => {
  const name = document.getElementById('newRoleName').value.trim();
  if (!name) { QQConsole.Roles.setRoleMsg('请先选择或填写要删除的人格名', false); return; }
  if (!confirm(`确定删除人格「${name}」？该操作不可撤销（roles/${name}.md）。`)) return;
  const r = await QQConsole.Core.api<QQConsole.Core.ApiResult & {clearedCurrent?:boolean}>('/api/roles/delete', 'POST', { name });
  if (!r.ok) { QQConsole.Roles.setRoleMsg('❌ ' + (r.error || '删除失败'), false); return; }
  QQConsole.Roles.resetRoleForm();
  QQConsole.Roles.setRoleMsg(r.clearedCurrent ? `已删除「${name}」，并清除了当前启用的人格` : `已删除「${name}」`, true);
  QQConsole.Roles.refreshRoles();
  QQConsole.Core.refresh();
});
document.getElementById('roleFormReset').addEventListener('click', () => QQConsole.Roles.resetRoleForm());
document.getElementById('newRoleContent').addEventListener('input', QQConsole.Roles.updateRoleEditorWarnings);
}
