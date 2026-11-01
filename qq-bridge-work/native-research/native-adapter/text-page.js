const byId = (id) => document.getElementById(id);
const terminal = ['succeeded','failed','cancelled','timed_out'];
const phaseText = { idle:'尚未开始', initializing:'正在准备登录', connecting:'正在连接 QQ', connected:'已连接，正在准备二维码',
  requesting_qr:'正在获取二维码', qr_ready:'请用手机 QQ 扫码', scanned:'已扫描，请在手机上确认', session_initializing:'正在初始化账号会话',
  text_ready:'已就绪，请完成下方文字测试', text_reconnecting:'正在恢复本机连接', stopping:'正在结束试验', succeeded:'本轮文字收发与连接恢复检查已完成',
  failed:'本轮未完成，请查看状态与脱敏报告', cancelled:'试验已停止', timed_out:'试验时间已到，已结束' };
const sendText = { not_sent:'尚未发送', pending:'等待发送回执', confirmed:'收到成功回执', unknown:'结果不确定，请检查接收方，本轮不重发', rejected:'本次发送未成功' };
let lastQr = -1, polling = true, busyStart = false;
function render(state) {
  const text = state.textTrial || {};
  byId('status').textContent = phaseText[state.phase] || '状态不可用';
  if (state.failurePoint === 'already_logged_in') byId('status').textContent = 'QQ 返回账号已登录提示，本轮已结束';
  byId('start').hidden = state.started || state.phase !== 'idle'; byId('start').disabled = busyStart;
  byId('scope-fields').disabled = state.started || state.phase !== 'idle';
  byId('refresh').hidden = state.phase !== 'expired' || state.qrRequests >= 2;
  byId('stop').disabled = terminal.includes(state.phase) || state.phase === 'stopping';
  byId('qr').hidden = !state.hasQr; byId('placeholder').hidden = state.hasQr;
  byId('qr-frame').hidden = state.loginSucceeded || terminal.includes(state.phase);
  if (state.hasQr && state.qrVersion !== lastQr) { byId('qr').src = '/qr.png?v=' + state.qrVersion; lastQr = state.qrVersion; }
  if (!state.hasQr) byId('qr').removeAttribute('src');
  const ready = state.phase === 'text_ready' && text.state === 'ready';
  for (const kind of ['private','group']) {
    const label = kind === 'private' ? '私聊' : '群聊';
    byId(kind + '-in').textContent = text[kind + 'Marker'] ? '已收到正确短句' : '等待' + label + '测试短句';
    byId(kind + '-out').textContent = sendText[text[kind + 'Send']] || '尚未发送';
    byId('send-' + kind).disabled = !ready || !text[kind + 'Marker'] || text[kind + 'Send'] !== 'not_sent';
    byId('confirm-' + kind).checked = !!text[kind + 'RecipientConfirmed'];
    byId('confirm-' + kind).disabled = !ready || text[kind + 'Send'] !== 'confirmed' || text[kind + 'RecipientConfirmed'];
    byId(kind + '-after').textContent = text[kind + 'AfterReconnect'] ? '已收到新的测试短句' : '等待';
  }
  byId('reconnect').disabled = !ready || text.reconnects !== 0 || text.privateSend !== 'confirmed' || text.groupSend !== 'confirmed';
  byId('reconnect-state').textContent = text.reconnects ? text.transportConnected ? '已恢复，请再次发送入站短句' : '已执行重连，本机连接已结束或未就绪' : '尚未重连';
  if (state.cleanupErrors) byId('error').textContent = '清理调用未全部完成，监督器将结束本次进程。';
  if (terminal.includes(state.phase)) polling = false;
}
async function post(route, body) {
  const headers = { 'X-QQ-Local-Action':'1' };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(route, { method:'POST', headers, cache:'no-store', ...(body ? { body:JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error();
  render(await response.json());
}
async function action(name) {
  byId('error').textContent = '';
  try { await post('/action/' + name); } catch { byId('error').textContent = '操作未完成，请检查当前状态；发送操作不会自动重试。'; }
}
byId('start').addEventListener('click', async () => {
  if (busyStart) return;
  for (const id of ['friend-id','group-id']) { if (!byId(id).reportValidity()) return; }
  busyStart = true; byId('start').disabled = true; byId('error').textContent = '';
  try {
    await post('/scope', { friendUin:byId('friend-id').value.trim(), groupUin:byId('group-id').value.trim() });
    await post('/action/start');
  } catch { byId('error').textContent = '无法开始，请确认目标号码为数字且本轮尚未开始。'; }
  finally { busyStart = false; byId('start').disabled = false; }
});
for (const name of ['refresh','stop','send-private','send-group','reconnect']) byId(name).addEventListener('click', () => action(name));
for (const kind of ['private','group']) byId('confirm-' + kind).addEventListener('change', () => action('confirm-' + kind));
async function poll() {
  try { const response = await fetch('/state', { cache:'no-store' }); if (!response.ok) throw new Error(); render(await response.json()); }
  catch { byId('status').textContent = '本机试验连接已断开'; byId('qr').hidden = true; byId('qr').removeAttribute('src'); }
  if (polling) setTimeout(poll, 500);
}
poll();
