namespace QQConsole.AccessOperations {


// ── DSH 思考强度 ────────────────────────────────────────────────────────────
document.getElementById('dshEffortSave').addEventListener('click', async () => {
  const effort = document.getElementById('dshEffortSelect').value;
  const msg = document.getElementById('dshEffortMsg');
  msg.textContent = '保存中…';
  msg.className = 'meta';
  const r = await QQConsole.Core.api<QQConsole.Core.ApiResult & {reasoningEffort?:string;activeSessions?:number}>('/api/dsh/effort', 'POST', { reasoningEffort: effort });
  msg.textContent = r.ok ? `✅ 已设为 ${r.reasoningEffort}，下一条消息生效` : ('❌ ' + (r.error || '保存失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) QQConsole.SettingsLoaders.refreshDshModel();
});
document.getElementById('silentOn').addEventListener('click', async () => { await QQConsole.Core.api('/api/role-mode', 'POST', { mode: 'silent' }); QQConsole.Core.refresh(); });
document.getElementById('silentOff').addEventListener('click', async () => { await QQConsole.Core.api('/api/role-mode', 'POST', { mode: 'active' }); QQConsole.Core.refresh(); });
document.getElementById('wlSave').addEventListener('click', async () => {
  const parse = (s:string) => s.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  const r = await QQConsole.Core.api('/api/whitelist', 'POST', {
    allow: { private: parse(document.getElementById('wlPrivate').value), groups: parse(document.getElementById('wlGroups').value) },
    deny: { private: parse(document.getElementById('dnPrivate').value), groups: parse(document.getElementById('dnGroups').value) },
    ownerQQ: document.getElementById('ownerQQ').value.trim()
  });
  if (r.ok) { QQConsole.SettingsLoaders.refreshWhitelist(); QQConsole.Core.refresh(); alert('白名单已保存并生效'); }
  else alert(r.error || '保存失败');
});
document.getElementById('restartBtn').addEventListener('click', async () => {
  if (!confirm('确定重启桥接？')) return;
  const r = await QQConsole.Core.api<QQConsole.Core.ApiResult & {message?:string}>('/api/restart', 'POST', {});
  document.getElementById('restartMsg').textContent = r.message || '正在重启…';
});
document.getElementById('clearWsBtn').addEventListener('click', async () => {
  if (!confirm('确定清空整个「QQ 聊天」工作区？\n将归档全部 QQ 会话、清除所有上下文映射、清空活动日志。\n此操作不可撤销。')) return;
  const r = await QQConsole.Core.api<QQConsole.Core.ApiResult & {archivedCount?:number}>('/api/workspace/reset', 'POST', {});
  document.getElementById('clearWsMsg').textContent = r.ok ? (`✅ 已归档 ${r.archivedCount} 个会话，工作区已清空`) : ('❌ ' + (r.error || '失败'));
  document.getElementById('clearWsMsg').className = r.ok ? 'meta ok' : 'meta err';
  QQConsole.SettingsLoaders.refreshSessions(); QQConsole.Core.refresh();
});
document.getElementById('aiNotifySend').addEventListener('click', async () => {
  const kind = document.getElementById('aiNotifyKind').value;
  const id = document.getElementById('aiNotifyId').value.trim();
  const message = document.getElementById('aiNotifyMessage').value.trim();
  if (!id || !message) { alert('请填写群号/QQ 号和提醒内容'); return; }
  const r = await QQConsole.Core.api<QQConsole.Core.ApiResult & {sessionId?:string}>('/api/console/notify-ai', 'POST', { key: kind + ':' + id, message });
  const msg = document.getElementById('aiNotifyMsg');
  msg.textContent = r.ok ? ('✅ 已投递到 DSH：' + r.sessionId) : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
});
}
