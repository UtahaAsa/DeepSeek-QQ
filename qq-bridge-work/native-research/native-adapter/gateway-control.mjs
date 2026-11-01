import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGatewayWatchdog } from './gateway-watchdog.mjs';
import { createProfileAvatarOwner } from './profile-avatar-owner.mjs';
import { acquireGatewayDataLease } from './gateway-data-lease.mjs';
import { recoverGatewayArtifacts } from './gateway-artifact-recovery.mjs';
import { projectGatewayDiagnostics } from './gateway-diagnostics.mjs';

const root = realpathSync(dirname(fileURLToPath(import.meta.url)));
const action = process.argv[2];
const fixture = false; // 发布入口仅允许真实所属服务；不装配测试运行时。
const owned = process.argv.includes('--owned');
const dataArg = process.argv.find((arg) => arg.startsWith('--data='))?.slice(7);
const dataRoot = resolve(dataArg ?? join(root, 'service-data', 'native'));
const allowed = join(root, 'service-data') + sep;
if (!dataRoot.toLowerCase().startsWith(allowed.toLowerCase())) throw new Error('DATA_ROOT_REFUSED');
const stateFile = join(dataRoot, 'status.json'), lockFile = join(dataRoot, 'owner.lock');
const readState = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const writeState = (value) => { writeFileSync(stateFile + '.tmp', JSON.stringify(value, null, 2)); renameSync(stateFile + '.tmp', stateFile); };
async function request(state, stop = false) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(state.controlUrl) || !/^[a-f0-9-]{36}$/.test(state.instanceId)) throw new Error('STATE_REFUSED');
  const response = await fetch(state.controlUrl + (stop ? '/stop' : '/health'), {
    method: stop ? 'POST' : 'GET', headers: { 'X-QQ-Gateway-Instance': state.instanceId }, signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('CONTROL_UNAVAILABLE');
  const health = await response.json();
  if (health.instanceId !== state.instanceId || health.supervisorPid !== state.supervisorPid || health.startedAt !== state.startedAt) throw new Error('PROCESS_IDENTITY_MISMATCH');
  return health;
}
async function daemon() {
  mkdirSync(dataRoot, { recursive: true });
  if (!realpathSync(dataRoot).toLowerCase().startsWith(allowed.toLowerCase())) throw new Error('DATA_ROOT_LINK_REFUSED');
  const dataLease = acquireGatewayDataLease(dataRoot, 'supervisor');
  let owner, recovery;
  try {
    recovery = await recoverGatewayArtifacts({ dataRoot, supervisorLease: dataLease, fixture });
    owner = openSync(lockFile, 'wx');
  } catch (error) { dataLease.close(); throw error; }
  let child = null, server = null, stopping = false, timer = null, watchdog = null, avatarOwner = null;
  // 常驻账号初始化最多90秒，留120秒总宽限；ready后的6秒心跳策略不变。
  const heartbeatPolicy = createGatewayWatchdog({ initializationMs: 120000 });
  let exitResolve;
  const exited = new Promise((resolve) => { exitResolve = resolve; });
  const state = { schemaVersion: 1, component: 'qq-native-gateway', status: 'starting', fixture,
    instanceId: randomUUID(), supervisorPid: process.pid, workerPid: null, startedAt: new Date().toISOString(),
    controlUrl: null, portalUrl: null, onebotUrl: null, dataDirectory: dataRoot,
    phase: 'idle', configured: false, sendEnabled: false, cleanupComplete: false, cleanupErrors: 0, forcedExit: false,
    productionReady: false, modelConfigured: false, modelVerified: false, artifactLeaseProtocol: 1, artifactRecovery: recovery };
  // fork前持久化新代次，旧延迟启动worker看到代次不符时不得加载账号。
  writeState(state);
  async function stop(reason = 'requested') {
    if (stopping) return;
    stopping = true; state.stopReason = reason; state.status = 'stopping'; writeState(state);
    if (child?.connected) child.send({ kind: 'stop' }, () => {});
    timer = setTimeout(() => { state.forcedExit = true; child?.kill(); }, 8000);
    await exited;
  }
  if (owned && process.connected) {
    process.once('disconnect', () => void stop('owner_disconnect'));
    process.on('message', value => {
      if (value?.kind === 'stop') { void stop(); return; }
      if (value?.kind === 'workspace-request' && /^[a-f0-9-]{36}$/.test(value.id ?? '')
          && ['state', 'configure','login-state','login-connect','login-refresh','login-stop'].includes(value.operation) && child?.connected && !stopping) child.send(value, () => {});
    });
  }
  try {
    for (const path of ['account/nt_qq/global', 'downloads', 'temp']) mkdirSync(join(dataRoot, path), { recursive: true });
    avatarOwner = createProfileAvatarOwner({ parent: dataRoot,
      workerExited: () => child === null || Number.isSafeInteger(child.pid) && (child.exitCode !== null || child.signalCode !== null),
      ownership: { instanceId: state.instanceId, fixture } });
    server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
      const own = req.headers.host === state.controlUrl?.slice(7) && !req.headers.origin &&
        !req.headers['sec-fetch-site'] && req.headers['x-qq-gateway-instance'] === state.instanceId;
      if (!own || !((req.method === 'GET' && req.url === '/health') || (req.method === 'POST' && req.url === '/stop'))) {
        res.writeHead(403); res.end('{}'); return;
      }
      if (req.url === '/stop') void stop();
      res.end(JSON.stringify(state));
    });
    server.requestTimeout = 3000; server.headersTimeout = 3000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    state.controlUrl = 'http://127.0.0.1:' + server.address().port;
    child = fork(join(root, 'gateway-worker.mjs'), [], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, QQ_GATEWAY_INSTANCE: state.instanceId, QQ_GATEWAY_DATA: dataRoot,
        QQ_GATEWAY_AVATAR_ROOT: avatarOwner.root, TEMP: join(dataRoot, 'temp'), TMP: join(dataRoot, 'temp') },
    });
    state.workerPid = child.pid;
    writeState(state);
    child.on('message', (value) => {
      if (value?.kind === 'portal' && /^http:\/\/127\.0\.0\.1:\d+$/.test(value.url)) {
        state.portalUrl = value.url; state.status = 'awaiting_user'; writeState(state);
        if (process.connected) process.send({ kind: 'started', state }, () => { if (!owned) process.disconnect(); });
      } else if (value?.kind === 'initializing' && !stopping && state.phase === 'idle') {
        state.phase = 'initializing'; heartbeatPolicy.userStart(); writeState(state);
      } else if (value?.kind === 'heartbeat') {
        if (stopping) return;
        heartbeatPolicy.heartbeat(value.phase, value.gatewayState);
        const phases = ['idle','initializing','connecting','connected','requesting_qr','qr_ready','scanned','expired','session_initializing','stopping','failed','cancelled'];
        if (phases.includes(value.phase)) state.phase = value.phase;
        state.configured = value.configured === true; state.sendEnabled = value.sendEnabled === true;
        state.pipeSecurity = Object.fromEntries(['running', 'aclVerified', 'remoteRejectConfigured', 'restrictedTokenDenied']
          .map((key) => [key, value.pipeSecurity?.[key] === true]));
        state.status = value.gatewayState === 'ready' ? 'ready' : ['offline','failed'].includes(value.gatewayState) ? 'degraded' : 'awaiting_user';
        if (state.status === 'ready' && !Object.values(state.pipeSecurity).every(Boolean)) state.status = 'degraded';
        state.onebotUrl = state.status === 'ready' && /^ws:\/\/127\.0\.0\.1:\d+$/.test(value.onebotUrl) ? value.onebotUrl : null;
      } else if (value?.kind === 'workspace-response' && /^[a-f0-9-]{36}$/.test(value.id ?? '') && owned && process.connected) {
        process.send(value, () => {});
      } else if (value?.kind === 'terminal') {
        state.diagnostics = projectGatewayDiagnostics(value.diagnostics);
        state.cleanupComplete = value.cleanupComplete === true;
        state.cleanupErrors = Number.isSafeInteger(value.cleanupErrors) ? value.cleanupErrors : 1;
        if (['failed', 'cancelled', 'timed_out', 'succeeded'].includes(value.outcome)) state.outcome = value.outcome;
        if (['failed', 'cancelled', 'timed_out', 'succeeded'].includes(value.phase)) state.phase = value.phase;
        const points = ['runtime_prepare', 'method_lookup', 'listener_registration', 'connect', 'await_login_event', 'qr_request',
          'qr_request_refused', 'qr_payload', 'identity_handoff', 'account_session', 'already_logged_in', 'login_event', 'reuse_unconfirmed'];
        state.failurePoint = points.includes(value.failurePoint) ? value.failurePoint : null;
        const stages = ['not_started', 'fixture', 'desktop_check', 'host_check', 'adapter_load', 'wrapper_load', 'account_prepare', 'engine_initialize', 'prepared'];
        state.runtimeStage = stages.includes(value.runtimeStage) ? value.runtimeStage : 'unknown';
        const failures = ['DESKTOP_QQ_RUNNING', 'HOST_CHANGED', 'QQ_PATH_REQUIRED', 'QQ_BASELINE_CHANGED', 'CONTROL_START_REFUSED', 'FIXTURE_PREPARE_FAILED', 'RUNTIME_PREPARE_FAILED'];
        state.runtimeFailure = failures.includes(value.runtimeFailure) ? value.runtimeFailure : null;
        writeState(state);
      }
    });
    child.once('error', () => { state.status = 'failed'; exitResolve(); });
    child.once('exit', (code) => { state.workerExitCode = code;
      if (!stopping) state.stopReason = state.outcome === 'failed' || state.outcome === 'timed_out' ? 'login_failed' : 'worker_exit';
      state.status = stopping && code === 0 && !state.forcedExit &&
      ['requested', 'owner_disconnect'].includes(state.stopReason) ? 'stopped' : 'failed'; exitResolve(); });
    watchdog = setInterval(() => {
      const reason = heartbeatPolicy.reason();
      if (!stopping && reason) { state.status = 'unresponsive'; void stop(reason); }
    }, 1000);
    await exited;
  } finally {
    // 自己关闭IPC不等于父进程丢失；不得在最终状态写完后再次进入stop覆盖失败原因。
    stopping = true;
    clearTimeout(timer); clearInterval(watchdog);
    state.onebotUrl = null; state.portalUrl = null;
    try { await avatarOwner?.cleanup(); state.avatarFileCleanupComplete = avatarOwner?.snapshot().cleanupComplete === true; }
    catch { state.avatarFileCleanupComplete = false; state.cleanupComplete = false; state.cleanupErrors++; state.status = 'failed'; }
    writeState(state);
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    closeSync(owner); unlinkSync(lockFile);
    dataLease.close();
    if (process.connected) process.disconnect();
  }
}
async function main() {
  if (action === '--daemon') return daemon();
  if (!['Start', 'Stop', 'Status'].includes(action)) throw new Error('ACTION_REQUIRED');
  if (action === 'Start') {
    if (existsSync(lockFile)) {
      // 不根据陈旧 PID 杀进程或抢锁；本机可验证的已有实例才算幂等。
      try { const health = await request(readState()); console.log(JSON.stringify(health)); return; }
      catch { /* 新宿主只在取得双排他租约并核对持久标记后恢复；不会终止任何旧进程。 */ }
    }
    if (!fixture && (!process.env.QQ_GATEWAY_APP || !existsSync(join(process.env.QQ_GATEWAY_APP, 'wrapper.node')))) throw new Error('QQ_APP_REQUIRED');
    const child = fork(fileURLToPath(import.meta.url), ['--daemon', '--data=' + dataRoot], {
      detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env,
    });
    const state = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.disconnect(); reject(new Error('START_TIMEOUT')); }, 12000);
      child.once('message', (value) => { clearTimeout(timer); value?.kind === 'started' ? resolve(value.state) : reject(new Error('START_FAILED')); });
      child.once('error', () => { clearTimeout(timer); reject(new Error('START_FAILED')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('START_FAILED')); });
    });
    child.unref(); console.log(JSON.stringify(state)); return;
  }
  if (!existsSync(stateFile)) { console.log(JSON.stringify({ schemaVersion: 1, status: 'stopped', fixture, productionReady: false })); return; }
  const previous = readState();
  if (!existsSync(lockFile)) { console.log(JSON.stringify(previous)); process.exitCode = previous.status === 'stopped' ? 0 : 1; return; }
  const health = await request(previous, action === 'Stop');
  if (action === 'Stop') {
    const deadline = Date.now() + 11000;
    while (existsSync(lockFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    if (existsSync(lockFile)) throw new Error('STOP_UNCONFIRMED');
    const final = readState(); console.log(JSON.stringify(final)); process.exitCode = final.status === 'stopped' ? 0 : 1; return;
  }
  console.log(JSON.stringify(health)); process.exitCode = health.status !== 'ready' ? 2 : 0;
}
await main().catch(() => { console.error(JSON.stringify({ schemaVersion: 1, status: 'unavailable', error: 'GATEWAY_CONTROL_FAILED', productionReady: false })); process.exitCode = 1; });
