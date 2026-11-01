const statusText = { idle:'尚未开始', initializing:'正在准备登录', connecting:'正在连接 QQ', connected:'已连接，正在准备二维码',
  requesting_qr:'正在获取二维码', qr_ready:'请用手机 QQ 扫码', scanned:'已扫描，请在手机上确认', expired:'二维码已失效，可重新获取',
  session_initializing:'扫码登录成功，正在初始化账号会话', stopping:'正在结束试验', succeeded:'已收到登录成功通知，试验结束', failed:'试验未完成，请查看脱敏报告', cancelled:'试验已停止', timed_out:'试验时间已到，已结束' };
const terminal = ['succeeded','failed','cancelled','timed_out'];
let lastQr = -1, polling = true;
const byId = (id) => document.getElementById(id);
function render(state) {
  byId('status').textContent = statusText[state.phase] || '状态不可用';
  if (state.failurePoint === 'already_logged_in') byId('status').textContent = 'QQ 返回账号已登录提示，本轮试验已结束';
  if (state.phase === 'succeeded' && state.accountSessionInitialized) byId('status').textContent = '已收到账号会话初始化通知，试验结束';
  byId('start').hidden = state.started || state.phase !== 'idle';
  byId('refresh').hidden = state.phase !== 'expired' || state.qrRequests >= 2;
  byId('stop').disabled = terminal.includes(state.phase) || state.phase === 'stopping';
  byId('qr').hidden = !state.hasQr;
  byId('placeholder').hidden = state.hasQr;
  if (state.hasQr && state.qrVersion !== lastQr) { byId('qr').src = '/qr.png?v=' + state.qrVersion; lastQr = state.qrVersion; }
  if (!state.hasQr) byId('qr').removeAttribute('src');
  if (state.phase === 'expired' && state.qrRequests >= 2) byId('error').textContent = '本轮获取次数已用完，请停止试验。';
  if (state.cleanupErrors) byId('error').textContent = '清理调用未全部完成，宿主将结束本次试验进程。';
  if (terminal.includes(state.phase)) polling = false;
}
async function action(name) {
  byId('error').textContent = '';
  try {
    const response = await fetch('/action/' + name, { method:'POST', headers:{'X-QQ-Local-Action':'1'}, cache:'no-store' });
    if (!response.ok) throw new Error();
    render(await response.json());
  } catch { byId('error').textContent = '操作未完成，请稍后重试或等待试验自动结束。'; }
}
for (const name of ['start','refresh','stop']) byId(name).addEventListener('click', () => action(name));
async function poll() {
  try {
    const response = await fetch('/state', { cache:'no-store' });
    if (!response.ok) throw new Error();
    render(await response.json());
  } catch { byId('status').textContent = '本机试验连接已断开'; byId('qr').hidden = true; byId('qr').removeAttribute('src'); }
  if (polling) setTimeout(poll, 500);
}
poll();
