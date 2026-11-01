const byId = (id) => document.getElementById(id);
let lastQr = -1;
let lastPhase = 'idle', disconnectedSince = 0;
const showConnectionRecovery = visible => {
  const panel = byId('connection-recovery');
  if (panel) panel.hidden = !visible;
};
let scopeDirty = false, targetsDirty = false, currentState = null, actionBusy = false;
const choices = ['send', 'receive-images', 'send-images', 'receive-voice', 'send-voice', 'self-avatar', 'idle-messages', 'generate-images',
  'friend-requests', 'auto-accept', 'at-all', 'group-mute', 'group-kick', 'qzone-enabled',
  'profile-nickname', 'profile-signature', 'profile-birthday', 'profile-avatar'];
const profileChoices = { 'profile-nickname': 'nickname', 'profile-signature': 'signature', 'profile-birthday': 'birthday', 'profile-avatar': 'avatar' };
const groupChoices = { 'at-all': 'atAll', 'group-mute': 'mute', 'group-kick': 'kick' };
const friendChoices = { 'friend-requests': 'receiveRequests', 'auto-accept': 'autoAccept' };
const qzoneFields = { 'qzone-audience': 'audience', 'qzone-cooldown': 'cooldownMinutes', 'qzone-daily': 'dailyLimit' };
const audienceNames = { self: '仅自己可见', friends: '好友可见', public: '公开可见' };
const idleFields = { 'idle-minutes': 'idleMinutes', 'idle-cooldown': 'cooldownMinutes',
  'idle-daily': 'dailyLimit', 'idle-global-daily': 'globalDailyLimit', 'idle-quiet-start': 'quietStart', 'idle-quiet-end': 'quietEnd' };
const targetControls = ['friend-mode', 'group-mode', 'friend', 'group', 'friend-exclude', 'group-exclude'];
const scopeNames = { selected: '指定范围', all: '全部在线会话', disabled: '关闭' };
function renderTargets(state) {
  const summary = state.gateway?.scopeSummary, reuse = !!state.gateway?.configured && !targetsDirty;
  byId('scope-summary').textContent = summary ? ['private', 'groups'].map((key, index) => {
    const value = summary[key]; return (index ? '群聊：' : '私聊：') + scopeNames[value.mode]
      + (value.mode === 'selected' ? `（${value.selectedCount}项）` : '') + `，排除${value.excludedCount}项`;
  }).join('；') : '请选择私聊与群聊范围；至少开启一类。';
  for (const [name, key] of [['friend', 'private'], ['group', 'groups']]) {
    if (reuse && summary) byId(name + '-mode').value = summary[key].mode;
    const mode = byId(name + '-mode').value, locked = state.started || state.gateway?.managedByDsh || actionBusy;
    byId(name + '-field').hidden = mode !== 'selected';
    byId(name + '-exclude-field').hidden = mode === 'disabled';
    byId(name).required = mode === 'selected' && !reuse;
    byId(name).disabled = locked || mode !== 'selected';
    byId(name + '-exclude').disabled = locked || mode === 'disabled';
    byId(name + '-mode').disabled = locked;
  }
}
function scopeFromInputs() {
  const ids = name => byId(name).value.trim().split(/[\s,，、]+/u).filter(Boolean);
  return Object.fromEntries([['friend', 'private'], ['group', 'groups']].map(([name, key]) => {
    const mode = byId(name + '-mode').value;
    return [key, { mode, ids: mode === 'selected' ? ids(name) : [], exclude: mode === 'disabled' ? [] : ids(name + '-exclude') }];
  }));
}
function showView() {
  const requested = location.hash.slice(1);
  const name = ['overview', 'features', 'login'].includes(requested) ? requested : 'overview';
  const titles = { overview: ['运行概览', '连接、权限与收发状态，一处查看。'], features: ['功能设置', '选择她在本次会话里可以使用的能力。'], login: ['QQ 连接', '确认目标，手动开始，手机扫码。'] };
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== name;
  for (const link of document.querySelectorAll('nav a')) { const selected = link.hash === '#' + name;
    link.classList.toggle('selected', selected); if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  byId('page-title').textContent = titles[name][0]; byId('page-description').textContent = titles[name][1];
  if (name === 'features' && currentState?.gateway?.managedByDsh) byId('page-description').textContent = '功能由 DSH QQ工作台统一管理，当前 QQ 连接可以保持。';
}
window.addEventListener('hashchange', showView); showView();
const phases = { idle: '等待确认目标并开始', initializing: '正在加载网关', connecting: '正在连接 QQ', connected: '正在准备二维码',
  requesting_qr: '正在获取二维码', qr_ready: '请用手机 QQ 扫码', scanned: '请在手机确认', expired: '二维码已过期',
  session_initializing: '正在完成登录后的QQ连接准备，请稍候', stopping: '正在停止', failed: 'QQ连接准备未完成，请返回管理入口检查', cancelled: '已停止' };
function render(state) {
  showConnectionRecovery(['failed', 'cancelled', 'timed_out'].includes(state.phase) && state.gateway?.state !== 'ready');
  currentState = state;
  document.body.classList.toggle('workspace-managed', state.gateway?.managedByDsh === true);
  byId('managed-feature-entry').hidden = state.gateway?.managedByDsh !== true;
  byId('workspace-settings-link').hidden = state.gateway?.managedByDsh !== true
    || byId('workspace-settings-link').getAttribute('href') === '#workspace-entry';
  if (state.gateway?.configured && (!scopeDirty || state.started)) {
    for (const [id, key] of [['send', 'sendEnabled'], ['receive-images', 'receiveImages'], ['send-images', 'sendImages'], ['receive-voice', 'receiveVoice'], ['send-voice', 'sendVoice'], ['self-avatar', 'readSelfAvatar'], ['generate-images', 'generateImages']]) byId(id).checked = state.gateway[key] === true;
    const idle = state.gateway.idleMessages;
    byId('idle-messages').checked = idle?.enabled === true;
    for (const [id, key] of Object.entries(groupChoices)) byId(id).checked = state.gateway.groupAdmin?.[key] === true;
    for (const [id, key] of Object.entries(friendChoices)) byId(id).checked = state.gateway.friendRequests?.[key] === true;
    for (const [id, key] of Object.entries(profileChoices)) byId(id).checked = state.gateway.selfProfile?.[key] === true;
    byId('qzone-enabled').checked = state.gateway.qzone?.enabled === true;
    if (state.gateway.qzone) for (const [id, key] of Object.entries(qzoneFields)) byId(id).value = String(state.gateway.qzone[key]);
    if (idle) { for (const [id, key] of Object.entries(idleFields)) byId(id).value = String(idle[key]); byId('idle-quiet').checked = idle.quietEnabled; }
  }
  lastPhase = state.phase; disconnectedSince = 0;
  byId('status').textContent = state.gateway?.state === 'ready'
    ? 'QQ 服务就绪，保持运行中' + (state.gateway.receiveImages ? '；收图已开启' : '') + (state.gateway.sendImages ? '；发图已开启' : '') + (state.gateway.receiveVoice ? '；语音理解已允许' : '') + (state.gateway.sendVoice ? '；语音回复已允许' : '')
    : state.loginReuse?.status === 'checking' ? '正在检查本实例的有效登录态'
    : state.loginReuse?.status === 'accepted' ? '正在复用登录态，等待QQ确认'
    : phases[state.phase] ?? '会话已结束';
  byId('start').disabled = state.started || !state.gateway?.configured || scopeDirty || actionBusy;
  byId('configure').disabled = state.started || state.gateway?.managedByDsh || actionBusy;
  for (const id of choices) byId(id).disabled = state.started || state.gateway?.managedByDsh || actionBusy;
  byId('send-images').disabled ||= !byId('send').checked;
  byId('send-voice').disabled ||= !byId('send').checked;
  byId('generate-images').disabled ||= !byId('send').checked || !byId('send-images').checked;
  byId('profile-avatar').disabled ||= !byId('receive-images').checked && !byId('send-images').checked;
  const profile = state.gateway?.native?.selfProfile;
  byId('profile-state').textContent = !state.gateway?.configured ? '自身资料修改尚未确认。'
    : !Object.values(state.gateway.selfProfile ?? {}).some(Boolean) ? '本次未允许修改自身资料或头像。'
    : '本次自身资料许可已确认；定向读回相符' + (profile?.observed ?? '—') + '次、仅接口受理' + (profile?.accepted ?? '—')
      + '次、结果未知' + (profile?.unknown ?? '—') + '次。' + (profile?.uncertain ? '本次后续修改已锁定。' : '实际显示效果仍需在 QQ 中确认。');
  renderTargets(state);
  byId('managed-summary').hidden = state.gateway?.managedByDsh !== true;
  byId('managed-summary').textContent = '范围和能力已在QQ工作台管理。' + byId('scope-summary').textContent + '。这里仅完成本人连接。';
  for (const id of Object.keys(groupChoices)) byId(id).disabled ||= byId('group-mode').value === 'disabled';
  byId('at-all').disabled ||= !byId('send').checked;
  byId('auto-accept').disabled ||= !byId('friend-requests').checked;
  byId('qzone-settings').hidden = !byId('qzone-enabled').checked;
  byId('qzone-settings').disabled = state.started || actionBusy || !byId('qzone-enabled').checked;
  const qzone = state.gateway?.qzone, qzoneNative = state.gateway?.native?.qzone;
  byId('qzone-state').textContent = !state.gateway?.configured ? '说说发布尚未确认。' : !qzone?.enabled
    ? '本次未允许发布说说。' : '本次允许原创文字说说，' + audienceNames[qzone.audience] + '；服务端接收'
      + (qzoneNative?.accepted ?? '—') + '次、拒绝' + (qzoneNative?.rejected ?? '—') + '次、结果未知' + (qzoneNative?.unknown ?? '—') + '次。'
      + (qzoneNative?.uncertain ? '发布已锁定，不会重试。' : qzoneNative?.busy ? '正在处理本次发布。' : '实际授权与空间页面仍须可用。');
  const groupAdmin = state.gateway?.native?.groupAdmin, friendRequests = state.gateway?.native?.friendRequests;
  byId('social-state').textContent = !state.gateway?.configured ? '好友申请与群管理尚未确认。'
    : !readySocial(state) ? '本次许可已确认；QQ 连接后显示操作计数。'
    : `好友申请：观察${friendRequests?.observed ?? 0}条、审批通过${friendRequests?.approved ?? 0}条、结果未知${friendRequests?.unknown ?? 0}条；群管理：原生接收${groupAdmin?.accepted ?? 0}次、结果未知${groupAdmin?.unknown ?? 0}次；全体提及尝试${groupAdmin?.atAllAttempts ?? 0}次。`
      + (groupAdmin?.uncertain || friendRequests?.uncertain ? '存在未知结果，相关自动操作已锁定，不会重试。' : '原生接收不等于实际生效。');
  byId('idle-messages').disabled ||= !byId('send').checked || byId('group-mode').value === 'disabled';
  byId('idle-settings').hidden = !byId('idle-messages').checked;
  byId('idle-settings').disabled = state.started || actionBusy || !byId('idle-messages').checked;
  for (const id of ['idle-quiet-start', 'idle-quiet-end']) byId(id).disabled = !byId('idle-quiet').checked;
  const idleNative = state.gateway?.native?.idleMessages;
  byId('idle-state').textContent = !state.gateway?.configured ? '冷场冒泡尚未确认。' : state.gateway.idleMessages?.enabled
    ? '本次允许冷场冒泡；已获得草稿资格' + (idleNative?.claimed ?? '—') + '次，原生确认送达'
      + (idleNative?.sendsConfirmed ?? '—') + '次，结果未知' + (idleNative?.sendsUnknown ?? '—') + '次。模型与草稿预设仍须就绪。'
    : '本次未开启冷场冒泡。';
  const ready = state.gateway?.state === 'ready', native = state.gateway?.native, ended = ['failed', 'cancelled'].includes(state.phase);
  byId('connection-badge').textContent = ready ? 'QQ 已连接' : ended ? '会话已结束' : state.started ? '连接处理中' : '等待登录';
  byId('connection-badge').dataset.ready = String(ready);
  byId('qq-state').textContent = ready ? '已连接' : ended ? '未连接' : state.started ? '处理中' : '未登录';
  byId('received-count').textContent = native ? String(native.privateReceived + native.groupReceived) : '—';
  byId('sent-count').textContent = native ? String(native.sendsConfirmed) : '—';
  byId('unknown-count').textContent = native ? String(native.sendsUnknown) : '—';
  for (const [id, key] of [['cap-text', 'sendEnabled'], ['cap-images', 'receiveImages'], ['cap-send-images', 'sendImages'], ['cap-receive-voice', 'receiveVoice'], ['cap-send-voice', 'sendVoice'], ['cap-self-avatar', 'readSelfAvatar']]) {
    byId(id).textContent = state.gateway?.configured ? state.gateway[key] ? '本次已允许' : '未开启' : '未确认';
  }
  byId('scope-feedback').textContent = state.started ? '此连接页显示当前设置。运行中修改范围和功能，请在DSH的QQ工作台保存并应用。' : scopeDirty ? '设置已调整，请重新确认目标范围。' : state.gateway?.configured ? '目标与设置已确认，可以手动开始连接。' : '先选择功能，再确认目标。';
  byId('refresh').hidden = state.phase !== 'expired' || state.qrRequests >= 2;
  byId('qr').hidden = !state.hasQr; byId('placeholder').hidden = state.hasQr;
  if (state.hasQr && state.qrVersion !== lastQr) { byId('qr').src = '/qr.png?v=' + state.qrVersion; lastQr = state.qrVersion; }
  if (!state.hasQr) byId('qr').removeAttribute('src');
}
function readySocial(state) { return state.gateway?.state === 'ready' && !!state.gateway?.native; }
async function post(route, body) {
  if (actionBusy) return;
  actionBusy = true;
  byId('error').textContent = '正在处理…';
  if (currentState) render(currentState);
  try {
  const response = await fetch(route, { method: 'POST', headers: { 'X-QQ-Local-Action': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(); if (route === '/scope') scopeDirty = false;
  const state = await response.json(); byId('error').textContent = ''; return state;
  } finally { actionBusy = false; if (currentState) render(currentState); }
}
function qzoneFromInputs() {
  const enabled = byId('qzone-enabled').checked, cooldown = byId('qzone-cooldown').valueAsNumber, daily = byId('qzone-daily').valueAsNumber;
  return { enabled, audience: byId('qzone-audience').value,
    cooldownMinutes: enabled || Number.isSafeInteger(cooldown) && cooldown >= 5 && cooldown <= 1440 ? cooldown : 120,
    dailyLimit: enabled || Number.isSafeInteger(daily) && daily >= 1 && daily <= 20 ? daily : 3 };
}
byId('scope').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { const state = await post('/scope', { ...(!currentState?.gateway?.configured || targetsDirty ? { scope: scopeFromInputs() } : {}), allowSend: byId('send').checked,
    receiveImages: byId('receive-images').checked, sendImages: byId('send-images').checked && byId('send').checked,
    receiveVoice: byId('receive-voice').checked, sendVoice: byId('send-voice').checked && byId('send').checked,
    readSelfAvatar: byId('self-avatar').checked, idleMessages: { enabled: byId('idle-messages').checked && byId('send').checked,
      idleMinutes: byId('idle-minutes').valueAsNumber, cooldownMinutes: byId('idle-cooldown').valueAsNumber,
      dailyLimit: byId('idle-daily').valueAsNumber, globalDailyLimit: byId('idle-global-daily').valueAsNumber,
      quietEnabled: byId('idle-quiet').checked, quietStart: byId('idle-quiet-start').value || '23:00', quietEnd: byId('idle-quiet-end').value || '08:00' },
    generateImages: byId('generate-images').checked && byId('send').checked && byId('send-images').checked,
    groupAdmin: Object.fromEntries(Object.entries(groupChoices).map(([id, key]) => [key,
      byId(id).checked && byId('group-mode').value !== 'disabled' && (key !== 'atAll' || byId('send').checked)])),
    friendRequests: { receiveRequests: byId('friend-requests').checked,
      autoAccept: byId('friend-requests').checked && byId('auto-accept').checked }, qzone: qzoneFromInputs(),
    selfProfile: Object.fromEntries(Object.entries(profileChoices).map(([id, key]) => [key,
      byId(id).checked && (key !== 'avatar' || byId('receive-images').checked || byId('send-images').checked)])) });
    if (!state) return; targetsDirty = false; render(state);
    for (const id of ['friend', 'group', 'friend-exclude', 'group-exclude']) byId(id).value = '';
    byId('status').textContent = '目标范围已确认，可以开始手动登录';
  } catch { byId('error').textContent = '目标范围未接受，请检查输入。'; }
});
byId('send').addEventListener('change', () => {
  byId('send-images').disabled = !byId('send').checked;
  byId('send-voice').disabled = !byId('send').checked;
  if (!byId('send').checked) byId('send-images').checked = false;
  if (!byId('send').checked) byId('send-voice').checked = false;
  if (!byId('send').checked) byId('idle-messages').checked = false;
  if (!byId('send').checked) byId('generate-images').checked = false;
  if (!byId('send').checked) byId('at-all').checked = false;
  if (!byId('receive-images').checked && !byId('send-images').checked) byId('profile-avatar').checked = false;
  if (currentState) render(currentState);
});
byId('friend-requests').addEventListener('change', () => {
  if (!byId('friend-requests').checked) byId('auto-accept').checked = false;
  if (currentState) render(currentState);
});
byId('send-images').addEventListener('change', () => {
  if (!byId('send-images').checked) byId('generate-images').checked = false;
  if (!byId('receive-images').checked && !byId('send-images').checked) byId('profile-avatar').checked = false;
  if (currentState) render(currentState);
});
byId('receive-images').addEventListener('change', () => {
  if (!byId('receive-images').checked && !byId('send-images').checked) byId('profile-avatar').checked = false;
  if (currentState) render(currentState);
});
for (const id of [...choices, ...targetControls, ...Object.keys(idleFields), ...Object.keys(qzoneFields), 'idle-quiet']) byId(id).addEventListener('input', () => {
  scopeDirty = true; if (targetControls.includes(id)) targetsDirty = true;
  if (id === 'group-mode' && byId(id).value === 'disabled') byId('idle-messages').checked = false;
  if (id === 'group-mode' && byId(id).value === 'disabled') for (const choice of Object.keys(groupChoices)) byId(choice).checked = false;
  if (currentState) render(currentState);
});
byId('scope').addEventListener('invalid', event => { location.hash = event.target.closest('#features') ? '#features' : '#login'; showView(); }, true);
for (const name of ['start', 'refresh', 'stop']) byId(name).addEventListener('click', () => {
  void post('/action/' + name).then((state) => { if (state) render(state); }).catch(() => { byId('error').textContent = '操作未完成，请通过 Status 查看状态。'; });
});
async function poll() {
  try { const response = await fetch('/state', { cache: 'no-store', signal: AbortSignal.timeout(5000) }); if (!response.ok) throw new Error(); render(await response.json()); }
  catch {
    disconnectedSince ||= Date.now();
    const initializing = ['initializing', 'session_initializing'].includes(lastPhase) && Date.now() - disconnectedSince < 120000;
    byId('status').textContent = initializing ? '正在完成QQ连接准备，响应暂慢，请稍候' : '暂时联系不上QQ连接服务，请返回管理入口检查状态。';
    showConnectionRecovery(!initializing);
    byId('connection-badge').textContent = '正在重新确认'; byId('connection-badge').dataset.ready = 'false';
    for (const id of ['start', 'configure', 'refresh', ...choices, ...targetControls]) byId(id).disabled = true;
    byId('idle-settings').disabled = true;
    byId('qzone-settings').disabled = true;
    byId('qr').hidden = true; byId('qr').removeAttribute('src');
  }
  setTimeout(poll, 1000);
}
void poll();
