const byId = (id) => document.getElementById(id);
const terminal = ['succeeded', 'failed', 'cancelled', 'timed_out'];
const labels = { idle: '尚未开始', initializing: '正在准备登录', connecting: '正在连接 QQ', connected: '正在准备二维码',
  requesting_qr: '正在获取二维码', qr_ready: '请用手机 QQ 扫码', scanned: '已扫描，请在手机上确认', expired: '二维码已过期',
  session_initializing: '正在初始化账号会话', text_ready: '已就绪，等待两种入站短句', stopping: '正在结束试验',
  succeeded: '两种入站短句均已收到，本轮已完成', failed: '本轮接收检查未完成', cancelled: '试验已停止', timed_out: '试验时间已到' };
let polling = true, lastQr = -1, busy = false;
function render(state) {
  byId('status').textContent = labels[state.phase] || '状态不可用';
  byId('scope-fields').disabled = state.started || state.phase !== 'idle';
  byId('start').hidden = state.started || state.phase !== 'idle';
  byId('start').disabled = busy;
  byId('refresh').hidden = state.phase !== 'expired' || state.qrRequests >= 2;
  byId('stop').disabled = terminal.includes(state.phase) || state.phase === 'stopping';
  byId('qr-frame').hidden = state.loginSucceeded || terminal.includes(state.phase);
  byId('qr').hidden = !state.hasQr; byId('placeholder').hidden = state.hasQr;
  if (state.hasQr && state.qrVersion !== lastQr) { byId('qr').src = '/qr.png?v=' + state.qrVersion; lastQr = state.qrVersion; }
  if (!state.hasQr) byId('qr').removeAttribute('src');
  for (const kind of ['private', 'group']) byId(kind + '-in').textContent = state.textTrial?.[kind + 'Marker'] ? '已收到正确短句' : '等待';
  if (state.cleanupErrors) byId('error').textContent = '清理调用未全部完成，请查看脱敏报告。';
  if (terminal.includes(state.phase)) polling = false;
}
async function post(route, body) {
  const response = await fetch(route, { method: 'POST', cache: 'no-store', headers: { 'X-QQ-Local-Action': '1',
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error('ACTION_FAILED');
  render(await response.json());
}
byId('start').addEventListener('click', async () => {
  if (busy || !byId('friend-id').reportValidity() || !byId('group-id').reportValidity()) return;
  busy = true; byId('start').disabled = true; byId('error').textContent = '';
  try { await post('/scope', { friendUin: byId('friend-id').value.trim(), groupUin: byId('group-id').value.trim() }); await post('/action/start'); }
  catch { byId('error').textContent = '无法开始，请检查目标格式与当前状态。'; }
  finally { busy = false; byId('start').disabled = false; }
});
for (const name of ['refresh', 'stop']) byId(name).addEventListener('click', async () => {
  try { await post('/action/' + name); } catch { byId('error').textContent = '操作未完成，请检查当前状态。'; }
});
async function poll() {
  try { const response = await fetch('/state', { cache: 'no-store' }); if (!response.ok) throw new Error(); render(await response.json()); }
  catch { byId('status').textContent = '本机试验连接已断开'; byId('qr').hidden = true; byId('qr').removeAttribute('src'); }
  if (polling) setTimeout(poll, 500);
}
poll();
