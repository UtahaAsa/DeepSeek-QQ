import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeApiClient } from '../bridge/src/dsh-client.js';
import { root, work, runtime, home, profile, cli, gateway, environment, deployment } from './environment.mjs';
import { launchCapture } from './launch-capture.mjs';
import { renderPortal } from './portal.mjs';
import { enforceProcessIdentity } from './process-identity.mjs';
import { refreshRuntimeMcp, refreshRuntimeWorkbench, refreshRuntimeNativeTools, migrateNativeToolNamespace } from './runtime-code.mjs';
import { createRoleClient, createRoleRoutes } from './role-management.mjs';
import { createRoleLibrary } from './role-library.mjs';
import { createVoiceClient, createVoiceRoutes } from './voice-management.mjs';
import { createPhoneClient } from './phone-management.mjs';
import { createImageClient, createImageRoutes } from './image-management.mjs';
import { createSingingClient } from './singing-management.mjs';
import { projectVoiceStatus } from './voice-status.mjs';
import { createWorkspaceManager } from './workspace-management.mjs';
import { createWorkspaceDataClient } from './workspace-data.mjs';
import { projectGatewayDiagnostics } from '../native-research/native-adapter/gateway-diagnostics.mjs';
import { bridgeHeartbeatIssue, classifySupervisorFailure, supervisorProbeCode } from './supervisor-health.mjs';
import { inspectRecovery, preserveStaleRecoveryLocks, stopOwnedRecovery } from './service-recovery.mjs';
import { migrateSessionDirectories } from './session-directory-migration.mjs';

const action = process.argv[2], stateFile = join(root, 'status.json'), lockFile = join(root, 'owner.lock');
// 与固定宿主默认600秒预算一致；客户端观察期限不授予终止监督器的权限。
const STARTUP_TIMEOUT_MS = 600000, START_OBSERVATION_TIMEOUT_MS = 650000;
const gatewayData = join(gateway, 'service-data', 'combined');
const sleep = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const store = (state) => { writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2)); renameSync(stateFile + '.tmp', stateFile); };
const load = () => JSON.parse(readFileSync(stateFile, 'utf8'));
async function freePort() {
  const server = createSocketServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
async function request(state, stop = false) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(state.controlUrl) || !/^[a-f0-9-]{36}$/.test(state.instanceId)) throw new Error('STATE_REFUSED');
  const response = await fetch(state.controlUrl + (stop ? '/stop' : '/health'), {
    method: stop ? 'POST' : 'GET', headers: { 'X-QQ-Combined-Instance': state.instanceId }, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('CONTROL_UNAVAILABLE');
  const health = await response.json();
  if (health.instanceId !== state.instanceId || health.supervisorPid !== state.supervisorPid || health.startedAt !== state.startedAt) throw new Error('IDENTITY_MISMATCH');
  return health;
}
async function daemon() {
  const owner = openSync(lockFile, 'wx');
  const state = { schemaVersion: 1, component: 'qq-native-combined', instanceId: randomUUID(), supervisorPid: process.pid,
    healthPolicyVersion: 2,
    startedAt: new Date().toISOString(), status: 'starting', dataDirectory: root, controlUrl: null, portalUrl: null,
    dsh: { status: 'starting', pid: null, url: null, profile, home },
    gateway: { status: 'stopped', pid: null, portalUrl: null }, bridge: { status: 'stopped', pid: null },
    modelConfigured: null, modelVerified: false, productionReady: false, forcedExit: false,
    identityChecks: { policy: 'startup-before-credential-handoff', dsh: 'pending', gateway: 'pending' } };
  let server, dsh, gw, bridge, api, token = null, pending = '', stopping = false, poll, checking = false, bridgeBeat = 0;
  let started = false, finish, gatewayRestartRequired = false, gatewayIsolating = false, isolationTask = null;
  let bridgeStartedAt = 0, firstBridgeHeartbeat = false;
  let workspaceManager = null, stopTask = null;
  const childStops = new WeakMap();
  const workspaceGatewayPending = new Map();
  function workspaceGateway(operation, configuration) {
    if (!gw?.connected || stopping || gatewayRestartRequired) return Promise.reject(new Error('WORKSPACE_UNAVAILABLE'));
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { workspaceGatewayPending.delete(id); reject(new Error('WORKSPACE_TIMEOUT')); }, 4000);
      workspaceGatewayPending.set(id, { owner: gw, resolve, reject, timer });
      gw.send({ kind: 'workspace-request', id, operation, ...(configuration ? { configuration } : {}) }, () => {});
    });
  }
  const done = new Promise((resolve) => { finish = resolve; });
  const env = environment();
  const alive = (child) => child && child.exitCode === null && child.signalCode === null;
  async function verifyOwned(stage, native) {
    try {
      const result = await enforceProcessIdentity({ combined: state, native, stage, expectedExecutable: process.execPath }, {
        stillCurrent: (snapshot) => !stopping && alive(dsh) && dsh.pid === snapshot.combined.dsh.pid &&
          (stage === 'dsh' || (alive(gw) && gw.pid === snapshot.combined.gateway.pid &&
            (!snapshot.combined.bridge.pid || (alive(bridge) && bridge.pid === snapshot.combined.bridge.pid))))
      });
      if (stage === 'all') {
        const response = await fetch(native.controlUrl + '/health', { headers: { 'X-QQ-Gateway-Instance': native.instanceId }, signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error();
        const fresh = await response.json();
        if (fresh.instanceId !== native.instanceId || fresh.startedAt !== native.startedAt || fresh.supervisorPid !== gw?.pid ||
            fresh.workerPid !== native.workerPid || fresh.onebotUrl !== native.onebotUrl || fresh.status !== 'ready' || !fresh.sendEnabled ||
            !['running', 'aclVerified', 'remoteRejectConfigured', 'restrictedTokenDenied'].every((key) => fresh.pipeSecurity?.[key] === true) ||
            stopping || !alive(dsh) || !alive(gw)) throw new Error();
      }
      if (stopping) throw new Error('SUPERVISOR_STOPPING');
      const key = stage === 'dsh' ? 'dsh' : 'gateway';
      state.identityChecks[key] = 'verified'; state.identityChecks[key + 'CheckedAt'] = new Date().toISOString();
      return result;
    } catch (error) {
      if (stopping) throw error;
      if (error?.message === 'OWNED_PROCESS_IDENTITY_UNCONFIRMED') {
        const key = stage === 'dsh' ? 'dsh' : 'gateway';
        state.identityChecks[key] = 'pending';
        state.healthCheck = { code: error.message, component: key, checkedAt: new Date().toISOString() };
        store(state); throw error;
      }
      if (stage === 'dsh') {
        state.identityChecks.dsh = 'failed'; state.error = 'OWNED_PROCESS_IDENTITY_FAILED'; store(state); await stop(true);
      } else {
        state.identityChecks.gateway = 'failed'; state.gateway.reason = 'OWNED_PROCESS_IDENTITY_FAILED';
        await isolateGateway();
      }
      throw new Error('OWNED_PROCESS_IDENTITY_FAILED');
    }
  }
  function stopChild(child, message) {
    if (!child) return Promise.resolve();
    if (childStops.has(child)) return childStops.get(child);
    const task = Promise.resolve().then(() => stopChildOnce(child, message));
    childStops.set(child, task); return task;
  }
  async function stopChildOnce(child, message) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (message && child.connected) child.send(message, () => {}); else child.kill('SIGTERM');
    const until = Date.now() + (child === dsh ? 30000 : 11000);
    while (child.exitCode === null && child.signalCode === null && Date.now() < until) await sleep();
    if (child.exitCode === null && child.signalCode === null) {
      state.forcedExit = true; child.kill('SIGKILL');
      const forcedDeadline = Date.now() + 3000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < forcedDeadline) await sleep();
      if (child.exitCode === null && child.signalCode === null) throw new Error('OWNED_STOP_UNCONFIRMED');
    }
  }
  function stop(failed = false) {
    if (stopTask) return stopTask;
    stopping = true; clearInterval(poll);
    const owned = [['bridge', bridge, { kind: 'qq-bridge-stop' }], ['gateway', gw, { kind: 'stop' }], ['dsh', dsh, { kind: 'stop' }]];
    stopTask = Promise.resolve().then(async () => {
      state.status = 'stopping'; state.productionReady = false;
      try { store(state); } catch { failed = true; }
      state.stopEvidence = {};
      try {
        for (const [name, child, message] of owned) {
          let stopError = false;
          try { await stopChild(child, message); } catch { stopError = true; }
          const exited = !child || child.exitCode !== null || child.signalCode !== null;
          state[name].status = exited ? 'stopped' : 'unknown';
          state.stopEvidence[name] = { exited, exitCode: child?.exitCode ?? null, signal: child?.signalCode ?? null, stopError };
          if (!exited || stopError || child && child.exitCode !== 0) failed = true;
        }
        state.status = failed || state.forcedExit ? 'failed' : 'stopped';
        if (Object.values(state.stopEvidence).some(value => !value.exited)) state.error = 'OWNED_STOP_UNCONFIRMED';
      } finally {
        token = null; pending = ''; state.gateway.portalUrl = null;
        try { store(state); } finally { finish(); }
      }
      return state;
    });
    return stopTask;
  }
  function isolateGateway() {
    if (stopping) return stopTask;
    if (isolationTask) return isolationTask;
    gatewayRestartRequired = true; gatewayIsolating = true; state.gateway.restartRequired = true;
    state.gateway.portalUrl = null; state.status = 'awaiting_user';
    const oldBridge = bridge; state.bridge.status = oldBridge ? 'stopping' : 'stopped';
    isolationTask = (async () => {
      try {
        try { await stopChild(oldBridge, { kind: 'qq-bridge-stop' }); }
        finally { await stopChild(gw, { kind: 'stop' }); }
        if (stopping) return;
        state.bridge.status = 'stopped'; state.bridge.pid = null; bridge = null;
      } catch { if (!stopping) state.gateway.status = 'failed'; }
      finally { gatewayIsolating = false; if (!stopping) store(state); }
    })();
    store(state); return isolationTask;
  }
  function track(child, component) {
    child.once('error', () => {
      if (stopping || (component === 'bridge' && child !== bridge) || (component === 'gateway' && child !== gw)) return;
      if (component === 'bridge') { state.gateway.reason = 'BRIDGE_START_FAILED'; void isolateGateway(); return; }
      state.error = component + '_START_FAILED'; void stop(true);
    });
    child.once('exit', (code) => {
      if ((component === 'bridge' && child !== bridge) || (component === 'gateway' && child !== gw)) return;
      state[component].exitCode = code;
      if (!stopping && component === 'bridge') {
        state.gateway.reason = 'BRIDGE_EXITED';
        state.lastBridgeFailure = { ...state.bridge, failedAt: new Date().toISOString() };
        void isolateGateway(); return;
      }
      if (component === 'gateway') {
        try {
          const final = JSON.parse(readFileSync(join(gatewayData, 'status.json'), 'utf8'));
          if (final.supervisorPid === child.pid) {
            state.gateway.terminal = Object.fromEntries(['outcome', 'failurePoint', 'runtimeStage', 'runtimeFailure', 'stopReason', 'workerExitCode', 'forcedExit']
              .filter((key) => Object.hasOwn(final, key)).map((key) => [key, final[key]]));
            state.gateway.terminal.diagnostics = projectGatewayDiagnostics(final.diagnostics);
          }
        } catch { state.gateway.diagnosticAvailable = false; }
      }
      if (!stopping && component === 'gateway' && child === gw) {
        state.gateway.status = code === 0 ? 'stopped' : 'failed'; state.status = 'awaiting_user';
        void isolateGateway(); return;
      }
      if (!stopping) { state.error = component + '_EXITED'; void stop(true); }
    });
  }
  async function launchGateway() {
    if (stopping) throw new Error('SUPERVISOR_STOPPING');
    // 网关守护进程用OS排他租约区分活实例与可验证的崩溃残留，不按旧锁/PID抢占实例。
    const child = fork(join(gateway, 'gateway-control.mjs'), ['--daemon', '--owned', '--data=' + gatewayData],
      { cwd: gateway, env: { ...env, QQ_GATEWAY_APP: process.env.QQ_GATEWAY_APP, QQ_GATEWAY_PARENT_PORTAL: state.controlUrl },
        windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    gw = child; state.gateway = { pid: child.pid, status: 'starting', portalUrl: null, restartRequired: false };
    child.on('message', value => {
      const waiting = value?.kind === 'workspace-response' && workspaceGatewayPending.get(value.id);
      if (!waiting || waiting.owner !== child || child !== gw) return;
      workspaceGatewayPending.delete(value.id); clearTimeout(waiting.timer);
      if (value.ok === true) waiting.resolve(value.value); else waiting.reject(new Error('WORKSPACE_APPLY_FAILED'));
    });
    state.identityChecks.gateway = 'pending'; delete state.identityChecks.gatewayCheckedAt;
    gatewayRestartRequired = false; isolationTask = null; track(child, 'gateway'); store(state);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('GATEWAY_START_TIMEOUT')), 12000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('GATEWAY_START_FAILED')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('GATEWAY_START_FAILED')); });
      child.on('message', (message) => {
        if (!stopping && child === gw && message?.kind === 'started') {
          clearTimeout(timer); state.gateway.portalUrl = message.state.portalUrl;
          state.gateway.status = 'awaiting_user'; state.status = 'awaiting_user'; started = true; store(state);
          void workspaceManager?.reapply();
          if (process.connected) process.send({ kind: 'started', state }, () => process.disconnect());
          resolve(state.gateway.portalUrl);
        }
      });
    });
  }
  async function tick() {
    // 手动重新准备期间旧状态文件尚可能存在；不得将它当成新宿主健康结果。
    if (checking || stopping || gatewayIsolating) return;
    checking = true;
    try {
      if (!api && token) {
        await verifyOwned('dsh');
        if (stopping) return;
        api = new NodeApiClient(state.dsh.url, 3000, { token, launchTokenOnly: true });
      }
      if (api) {
        try { await api.settings.describe({}); if (stopping) return; state.dsh.status = 'ready'; }
        catch (error) { if (stopping) return; state.dsh.status = 'unavailable'; state.healthCheck = { code: supervisorProbeCode(error), component: 'dsh', checkedAt: new Date().toISOString() }; }
      }
      if (!started && Date.now() - Date.parse(state.startedAt) > STARTUP_TIMEOUT_MS) { state.error = 'DSH_START_TIMEOUT'; void stop(true); return; }
      if (stopping) return;
      if (!gw && state.dsh.status === 'ready') {
        await launchGateway();
        if (stopping) return;
      }
      if (started && gw && !gatewayRestartRequired) {
        const previous = JSON.parse(readFileSync(join(gatewayData, 'status.json'), 'utf8'));
        const response = await fetch(previous.controlUrl + '/health', { headers: { 'X-QQ-Gateway-Instance': previous.instanceId }, signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error('GATEWAY_HEALTH_FAILED');
        const health = await response.json();
        if (stopping || gatewayRestartRequired || gatewayIsolating) return;
        if (health.supervisorPid !== gw.pid || health.instanceId !== previous.instanceId || health.startedAt !== previous.startedAt) throw new Error('GATEWAY_IDENTITY_FAILED');
        state.gateway.status = health.status;
        if (bridge && ['failed', 'stopped'].includes(health.status)) { state.gateway.reason = 'GATEWAY_TERMINAL'; void isolateGateway(); return; }
        if (!bridge && health.status === 'ready' && state.dsh.status === 'ready') {
          await verifyOwned('all', health);
          if (stopping) return;
          bridge = fork(join(work, 'bridge', 'src', 'bridge.js'), [], { cwd: runtime, windowsHide: true,
            env: { ...env, DSH_BRIDGE_LAUNCH_TOKEN: token, QQ_NATIVE_GATEWAY_STATUS: join(gatewayData, 'status.json') },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
          const currentBridge = bridge;
          state.bridge = { pid: bridge.pid, status: 'starting' }; bridgeStartedAt = Date.now(); bridgeBeat = bridgeStartedAt; firstBridgeHeartbeat = false; track(bridge, 'bridge');
          bridge.stderr.on('data', (chunk) => {
            if (stopping || currentBridge !== bridge) return;
            state.bridge.stderrBytes = (state.bridge.stderrBytes ?? 0) + chunk.length;
            const hints = new Set(state.bridge.startupHints ?? []), text = String(chunk);
            for (const [hint, pattern] of [['module_missing', /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/],
              ['syntax_error', /SyntaxError/], ['type_error', /TypeError/], ['reference_error', /ReferenceError/],
              ['address_in_use', /EADDRINUSE/], ['permission_denied', /EACCES|EPERM/], ['file_missing', /ENOENT/]]) {
              if (pattern.test(text)) hints.add(hint);
            }
            state.bridge.startupHints = [...hints];
          });
          bridge.on('message', (message) => {
            if (stopping || currentBridge !== bridge) return;
            if (message?.kind === 'qq-bridge-failure' && ['config', 'gateway', 'state', 'services', 'running'].includes(message.phase) &&
                /^(BRIDGE_FATAL|NATIVE_GATEWAY_(PATH|STATUS|HEALTH|BROKER|SEND_PERMISSION)_FAILED)$/.test(message.code ?? '')) {
              state.bridge.failurePhase = message.phase; state.bridge.failureCode = message.code; store(state);
            }
            if (message?.kind === 'qq-bridge-health') {
            bridgeBeat = Date.now(); firstBridgeHeartbeat = true; state.bridge.lastHeartbeatAt = new Date(bridgeBeat).toISOString();
            state.bridge.reason = message.nativePermissionsCurrent === true ? null
              : message.nativePermissionsError === true ? 'NATIVE_POLICY_STOP_UNCONFIRMED' : 'NATIVE_POLICY_REVALIDATING';
            state.bridge.status = message.dshReady && message.upstreamConnected && message.nativePermissionsCurrent === true ? 'ready' : 'degraded';
            state.bridge.voice = projectVoiceStatus(message.voice);
            state.bridge.nativePermissionsCurrent = message.nativePermissionsCurrent === true;
            state.bridge.nativePermissionsError = message.nativePermissionsError === true;
            state.bridge.nativePolicyRevision = Number.isSafeInteger(message.nativePolicyRevision) && message.nativePolicyRevision > 0 ? message.nativePolicyRevision : null;
          } });
        }
        const issue = bridge && bridgeHeartbeatIssue({ startedAt: bridgeStartedAt, heartbeatAt: bridgeBeat, firstHeartbeat: firstBridgeHeartbeat, now: Date.now() });
        if (issue) { state.bridge.status = 'degraded'; state.bridge.reason = issue;
          state.healthCheck = { code: issue, component: 'bridge', checkedAt: new Date().toISOString() }; }
        state.status = state.bridge.status === 'ready' && state.dsh.status === 'ready' && health.status === 'ready' ? 'ready' : 'awaiting_user';
        const policyIssue = state.bridge.nativePermissionsCurrent === false
          ? state.bridge.nativePermissionsError ? 'NATIVE_POLICY_STOP_UNCONFIRMED' : 'NATIVE_POLICY_REVALIDATING' : null;
        if (policyIssue) state.healthCheck = { code: policyIssue, component: 'bridge', checkedAt: new Date().toISOString() };
        if (issue || policyIssue || state.dsh.status === 'unavailable') state.status = 'degraded';
        else state.healthCheck = null;
      }
      store(state);
    } catch (error) {
      if (stopping || gatewayRestartRequired) return;
      const failure = classifySupervisorFailure(error, { dshAlive: alive(dsh), gatewayAlive: alive(gw) });
      state.healthCheck = { code: failure.code, component: 'supervisor', checkedAt: new Date().toISOString(), action: failure.action };
      if (failure.action === 'stop') { state.error = failure.code; void stop(true); }
      else if (failure.action === 'isolate_gateway') { state.gateway.reason = failure.code; void isolateGateway(); }
      else { state.status = 'degraded'; store(state); }
    }
    finally { checking = false; }
  }
  try {
    refreshRuntimeMcp({ source: join(work, 'bridge'), runtime, backup: join(root, 'code-backups') });
    refreshRuntimeNativeTools({ source: join(work, 'bridge'), runtime, backup: join(root, 'code-backups') });
    migrateNativeToolNamespace({ profileFile: join(home, 'profiles', profile, 'cordis.patch.yml'), runtime, backup: join(root, 'code-backups') });
    refreshRuntimeWorkbench({ source: join(work, 'bridge'), runtime, backup: join(root, 'code-backups') });
    const roleClient = createRoleClient({ runtime,
      current: () => ({ ready: !stopping && alive(bridge) && state.bridge.status === 'ready',
        pid: bridge?.pid, ownerPid: process.pid, executable: process.execPath }) });
    const roleLibrary = createRoleLibrary({ libraryRoot: join(work, 'bridge', 'roles'), runtimeRoot: join(runtime, 'roles') });
    const roleRoutes = createRoleRoutes(roleClient, { requestLibrary: roleLibrary });
    const voiceClient = createVoiceClient({ runtime,
      current: () => ({ ready: !stopping && alive(bridge) && state.bridge.status === 'ready',
        pid: bridge?.pid, ownerPid: process.pid, executable: process.execPath }) });
    const voiceRoutes = createVoiceRoutes(voiceClient);
    const phoneClient=createPhoneClient({runtime,current:()=>({ready:!stopping&&alive(bridge)&&state.bridge.status==='ready',
      pid:bridge?.pid,ownerPid:process.pid,executable:process.execPath})});
    const imageClient = createImageClient({ runtime,
      current: () => ({ ready: !stopping && alive(bridge) && state.bridge.status === 'ready',
        pid: bridge?.pid, ownerPid: process.pid, executable: process.execPath }) });
    const imageRoutes = createImageRoutes(imageClient);
    const singingClient = createSingingClient({ runtime,
      current: () => ({ ready: !stopping && alive(bridge) && state.bridge.status === 'ready',
        pid: bridge?.pid, ownerPid: process.pid, executable: process.execPath }) });
    workspaceManager = createWorkspaceManager({ combined: () => state, gateway: workspaceGateway,
      data:createWorkspaceDataClient({runtime,current:()=>({ready:!stopping&&alive(bridge)&&state.bridge.status==='ready',pid:bridge?.pid,ownerPid:process.pid,executable:process.execPath})}),
      roles: roleClient, library: roleLibrary, voice: voiceClient, images: imageClient, singing: singingClient,phone:phoneClient,
      prepareLogin: async () => {
        if (stopping || gatewayIsolating || state.dsh.status !== 'ready') throw new Error('WORKSPACE_UNAVAILABLE');
        if (gatewayRestartRequired || !alive(gw)) return launchGateway();
        return state.gateway.portalUrl;
      } });
    server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      const host = state.controlUrl?.slice(7), ownHost = req.headers.host === host;
      if (await roleRoutes(req, res, state.controlUrl)) return;
      if (await voiceRoutes(req, res, state.controlUrl)) return;
      if (await imageRoutes(req, res, state.controlUrl)) return;
      if (ownHost && req.method === 'GET' && req.url === '/voice-status' && req.headers['x-qq-local-action'] === '1' &&
          (!req.headers.origin || req.headers.origin === state.controlUrl) &&
          (!req.headers['sec-fetch-site'] || ['none', 'same-origin'].includes(req.headers['sec-fetch-site']))) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(projectVoiceStatus(alive(bridge) && !stopping ? state.bridge.voice : null))); return;
      }
      if (ownHost && req.method === 'GET' && ['/', '/open-dsh'].includes(req.url)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(renderPortal(state.gateway.portalUrl, state.gateway.restartRequired === true)); return;
      }
      if (ownHost && req.method === 'POST' && req.url === '/qq-restart' && req.headers['x-qq-local-action'] === '1' &&
          (!req.headers.origin || req.headers.origin === state.controlUrl) && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) &&
          !req.headers['transfer-encoding'] && Number(req.headers['content-length'] ?? 0) === 0) {
        if (stopping || !gatewayRestartRequired || gatewayIsolating || state.dsh.status !== 'ready') { res.writeHead(409); res.end('{}'); return; }
        gatewayIsolating = true;
        try { const url = await launchGateway(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url })); }
        catch { if (!stopping) { gatewayRestartRequired = true; state.gateway.restartRequired = true; } res.writeHead(503); res.end('{}'); }
        finally { gatewayIsolating = false; if (!stopping) store(state); }
        return;
      }
      if (ownHost && req.method === 'POST' && req.url === '/dsh-launch' &&
          req.headers['x-qq-local-action'] === '1' && (!req.headers.origin || req.headers.origin === state.controlUrl) &&
          !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) && token && !stopping && state.identityChecks.dsh === 'verified') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ url: state.dsh.url + '/?token=' + encodeURIComponent(token) })); return;
      }
      if (ownHost && req.method === 'POST' && req.url === '/open-dsh' && req.headers.origin === state.controlUrl && token && !stopping && state.identityChecks.dsh === 'verified') {
        res.writeHead(303, { Location: state.dsh.url + '/?token=' + encodeURIComponent(token) }); res.end(); return;
      }
      const authorized = ownHost && !req.headers.origin && !req.headers['sec-fetch-site'] && req.headers['x-qq-combined-instance'] === state.instanceId;
      if (!authorized || !((req.method === 'GET' && req.url === '/health') || (req.method === 'POST' && req.url === '/stop'))) { res.writeHead(403); res.end('{}'); return; }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/stop') void stop(); res.end(JSON.stringify(state));
    });
    server.requestTimeout = 3000; server.headersTimeout = 3000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    state.controlUrl = 'http://127.0.0.1:' + server.address().port; state.portalUrl = state.controlUrl;
    const directoryMigration = await migrateSessionDirectories({ work, deployment, storage: join(home, 'sessions'),
      registryFile: join(runtime, 'state/sessions.json'), backupRoot: join(root, 'session-directory-backups'),
      assertOffline: () => { if (stopping || dsh || state.dsh.pid !== null) throw new Error('SESSION_DIRECTORY_OWNER_ACTIVE'); } });
    state.sessionDirectories = { checked: directoryMigration.checked, migrated: directoryMigration.migrated,
      workspaceRestored: directoryMigration.workspaceRestored === true };
    writeFileSync(join(root, 'session-directory-migration.json'), JSON.stringify({ checkedAtUtc: new Date().toISOString(),
      rootInstanceId: state.instanceId, ...directoryMigration }, null, 2) + '\n');
    const port = await freePort(); const consolePort = await freePort();
    if (stopping) { await stopTask; return; }
    const config = JSON.parse(readFileSync(join(runtime, 'config.json'), 'utf8'));
    config.dsh.baseUrl = 'http://127.0.0.1:' + port; config.consolePort = consolePort;
    writeFileSync(join(runtime, 'config.json'), JSON.stringify(config, null, 2));
    state.dsh.url = config.dsh.baseUrl;
    dsh = fork(join(work, 'integration', 'dsh-owned.mjs'), ['--profile', profile, '--host', '127.0.0.1', '--port', String(port), '--no-open'],
      { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    state.dsh.pid = dsh.pid; track(dsh, 'dsh');
    dsh.on('message', message => {
      if (message?.kind !== 'qq-workspace-request' || !/^[a-f0-9-]{36}$/.test(message.id ?? '') || !workspaceManager || stopping) return;
      void workspaceManager.request(message.operation, message.payload).then(value => {
        if (dsh.connected) dsh.send({ kind: 'qq-workspace-response', id: message.id, ok: true, value }, () => {});
      }, error => {
        const safe = ['WORKSPACE_SETTINGS_INVALID', 'WORKSPACE_SETTINGS_CONFLICT', 'WORKSPACE_REQUEST_REFUSED'].includes(error?.code)
          ? error.code : 'WORKSPACE_UNAVAILABLE';
        if (dsh.connected) dsh.send({ kind: 'qq-workspace-response', id: message.id, ok: false, error: safe }, () => {});
      });
    });
    dsh.on('message', (message) => { if (message?.kind === 'dsh-startup-stage' && ['cli_importing', 'cli_loaded', 'boot_returned'].includes(message.stage)) { state.dsh.startupStage = message.stage; store(state); } if (message?.kind === 'dsh-stop-ack') {
      state.dsh.stopAcknowledged = true; state.dsh.stopAcknowledgedAt = new Date().toISOString(); store(state);
    } });
    const acceptToken = (value) => { if (!stopping) token = value; };
    // stdout/stderr各自保留行边界，避免两个流交错拼接出伪启动行。
    dsh.stdout.on('data', launchCapture(state.dsh.url, acceptToken));
    // 只记录固定诊断类别和字节数；不保存原始启动输出、URL或凭据。
    const diagnostic = (stream) => (chunk) => {
      state.dsh[stream + 'Bytes'] = (state.dsh[stream + 'Bytes'] ?? 0) + chunk.length;
      const text = String(chunk), hints = new Set(state.dsh.startupHints ?? []);
      for (const [hint, pattern] of [['module_missing', /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/], ['address_in_use', /EADDRINUSE/],
        ['permission_denied', /EACCES|EPERM/], ['file_missing', /ENOENT/], ['startup_error', /StartupError|startup failed/],
        ['type_error', /TypeError/], ['syntax_error', /SyntaxError/], ['connection_failed', /ECONNREFUSED|ETIMEDOUT|fetch failed/]]) {
        if (pattern.test(text)) hints.add(hint);
      }
      state.dsh.startupHints = [...hints];
    };
    dsh.stdout.on('data', diagnostic('stdout')); dsh.stderr.on('data', diagnostic('stderr'));
    dsh.stderr.on('data', launchCapture(state.dsh.url, acceptToken));
    process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
    // 启动调用方断开只表示交接；daemon负责完整组件生命周期。
    poll = setInterval(() => void tick(), 1000); store(state); await tick(); await done;
  } finally {
    clearInterval(poll);
    await stop(true);
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    closeSync(owner); unlinkSync(lockFile); if (process.connected) process.disconnect();
  }
}
async function main() {
  if (action === '--daemon') return daemon();
  if (!['Start', 'Stop', 'Status'].includes(action)) throw new Error('ACTION_REQUIRED');
  if (action === 'Start') {
    const current=await inspectRecovery();
    if(current.health){console.log(JSON.stringify(current.health));return;}
    if(current.alive||current.view.action!=='start')throw new Error('START_OWNERSHIP_UNCONFIRMED');
    // 关机后的残留标记沿用恢复入口的双重OS核验和原字节备份，不能直接删除锁。
    await preserveStaleRecoveryLocks(current);
    if (!existsSync(join(root, 'prepared.json'))) throw new Error('PREPARE_REQUIRED');
    if (!process.env.QQ_GATEWAY_APP || !existsSync(join(process.env.QQ_GATEWAY_APP, 'wrapper.node'))) throw new Error('QQ_APP_REQUIRED');
    const child = fork(fileURLToPath(import.meta.url), ['--daemon'], { detached: true, windowsHide: true,
      env: environmentWithQq(), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const state = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // 只结束本次等待并交接；监督器继续管理所属进程，后续通过同一实例查询。
        if (child.connected) child.disconnect();
        child.unref(); reject(new Error('START_OBSERVATION_TIMEOUT'));
      }, START_OBSERVATION_TIMEOUT_MS);
      child.once('message', (message) => { clearTimeout(timer); message?.kind === 'started' ? resolve(message.state) : reject(new Error('START_FAILED')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('START_FAILED')); });
      child.once('error', () => { clearTimeout(timer); reject(new Error('START_FAILED')); });
    });
    child.unref(); console.log(JSON.stringify(state)); return;
  }
  if (action === 'Stop') {
    const result = await stopOwnedRecovery();
    console.log(JSON.stringify(result)); process.exitCode = result.status === 'stopped' ? 0 : result.status === 'stopping' ? 2 : 1;
    return;
  }
  if (!existsSync(stateFile)) { console.log(JSON.stringify({ schemaVersion: 1, status: 'stopped', productionReady: false })); return; }
  if (!existsSync(lockFile)) { const state = load(); console.log(JSON.stringify(state)); process.exitCode = state.status === 'stopped' ? 0 : 1; return; }
  const state = await request(load(), action === 'Stop');
  if (action === 'Stop') {
    const until = Date.now() + 65000;
    while (existsSync(lockFile) && Date.now() < until) await sleep();
    if (existsSync(lockFile)) throw new Error('STOP_UNCONFIRMED');
    const final = load(); console.log(JSON.stringify(final)); process.exitCode = final.status === 'stopped' ? 0 : 1;
  } else { console.log(JSON.stringify(state)); process.exitCode = state.status === 'ready' ? 0 : 2; }
}
function environmentWithQq() { return { ...environment(), QQ_GATEWAY_APP: process.env.QQ_GATEWAY_APP }; }
await main().catch((error) => {
  const pending = error?.message === 'START_OBSERVATION_TIMEOUT';
  console.error(JSON.stringify({ status: pending ? 'starting' : 'unavailable',
    error: pending ? 'START_OBSERVATION_TIMEOUT' : 'COMBINED_CONTROL_FAILED', productionReady: false }));
  process.exitCode = pending ? 2 : 1;
});
