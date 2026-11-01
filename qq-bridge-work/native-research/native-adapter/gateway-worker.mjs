import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release } from 'node:os';
import { createCountingGlobalAdapter } from './engine-contract.mjs';
import { buildManualLoginConfig, createManualLoginController, nativeMethod } from './manual-login.mjs';
import { createAccountSessionLifecycle } from './account-session.mjs';
import { createGatewaySession } from './gateway-session.mjs';
import { createGatewayBroker } from './gateway-broker.mjs';
import { createLoginPortal } from './login-portal.mjs';
import { acquireGatewayDataLease } from './gateway-data-lease.mjs';
import { gatewayFailureCode, projectGatewayDiagnostics } from './gateway-diagnostics.mjs';
import { tryReuseLogin } from './login-reuse.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataRoot = realpathSync(process.env.QQ_GATEWAY_DATA);
const appPath = process.env.QQ_GATEWAY_APP;
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
if (!process.send || !process.connected) throw new Error('SUPERVISOR_REQUIRED');
// 整个worker进程持有；不能在终端回调或destroy返回后提前释放，OS在进程结束时收回。
const workerDataLease = acquireGatewayDataLease(dataRoot, 'worker');
// fork返回和父进程落盘workerPid之间存在调度窗口；仅同代次的null可短暂等待。
let supervisorRecord;
for (let attempt = 0; attempt < 26; attempt++) {
  supervisorRecord = JSON.parse(readFileSync(join(dataRoot, 'status.json'), 'utf8'));
  if (supervisorRecord.component !== 'qq-native-gateway' || supervisorRecord.artifactLeaseProtocol !== 1
      || supervisorRecord.instanceId !== process.env.QQ_GATEWAY_INSTANCE || supervisorRecord.supervisorPid !== process.ppid
      || supervisorRecord.workerPid !== null || !process.connected || attempt === 25) break;
  await new Promise(resolve => setTimeout(resolve, 20));
}
if (supervisorRecord.component !== 'qq-native-gateway' || supervisorRecord.artifactLeaseProtocol !== 1
    || supervisorRecord.instanceId !== process.env.QQ_GATEWAY_INSTANCE || supervisorRecord.supervisorPid !== process.ppid
    || supervisorRecord.workerPid !== process.pid || !workerDataLease.owns(dataRoot, 'worker')) throw new Error('SUPERVISOR_IDENTITY_CHANGED');
let control = null, engine = null, loginService = null, account = null, portal = null;
let runtimeStage = 'not_started', runtimeFailure = null, startRequested = false;
let handoffStage = 'not_started', handoffFailureCode = null;
let reuseExistingLogin = true;
let workspaceManaged = false;
const gateway = createGatewaySession();
const broker = await createGatewayBroker({ instanceId: process.env.QQ_GATEWAY_INSTANCE, getConnection: gateway.consumerConnection });
const configOptions = { dataRoot, accountPath: realpathSync(join(dataRoot, 'account')), downloadPath: realpathSync(join(dataRoot, 'downloads')), osVersion: release() };
const config = buildManualLoginConfig({ dataRoot, globalPath: realpathSync(join(dataRoot, 'account', 'nt_qq', 'global')), osVersion: release() });
const send = (value) => { if (process.connected) process.send(value, () => {}); };
async function stopAccount() { await gateway.stop(); if (account) { const state = await account.stop(); if (state.startAttempted && !state.stopReturned) throw new Error('STARTUP_STOP_UNCONFIRMED'); } }
async function openRuntime() {
  try {
    let wrapper;
    {
      // 桌面 QQ 的进程名无法代表账号冲突。使用本实例独立数据目录，不接管桌面进程。
      runtimeStage = 'host_check';
      const lock = JSON.parse(readFileSync(join(root, 'toolchain.lock.json'), 'utf8'));
      if (hash(process.execPath) !== lock.node.sha256) throw new Error('HOST_CHANGED');
      const baseline = JSON.parse(readFileSync(join(dirname(root), 'results', 'native-import-closure-20261023.json'), 'utf8'));
      if (!appPath || !baseline.ordinaryImportModules?.length) throw new Error('QQ_PATH_REQUIRED');
      for (const entry of baseline.ordinaryImportModules) {
        if (!/^[A-Za-z0-9_.-]+$/.test(entry.name)) throw new Error('MODULE_NAME_REFUSED');
        const path = realpathSync(join(appPath, entry.name));
        if (dirname(path).toLowerCase() !== realpathSync(appPath).toLowerCase() || hash(path) !== entry.sha256) throw new Error('QQ_BASELINE_CHANGED');
      }
      runtimeStage = 'adapter_load';
      const { loadNativePrototype } = await import('./prototype-host.mjs');
      control = loadNativePrototype().control;
      if (!control.start()) throw new Error('CONTROL_START_REFUSED');
      runtimeStage = 'wrapper_load';
      const module = { exports: {} }; process.dlopen(module, join(appPath, 'wrapper.node')); wrapper = module.exports;
      engine = nativeMethod(Object.getOwnPropertyDescriptor(wrapper, 'NodeIQQNTWrapperEngine')?.value, 'get')();
    }
    runtimeStage = 'account_prepare';
    // 常驻账号接入独立等待90秒；研究探针仍沿用生命周期默认20秒，外层网关留120秒宽限。
    account = createAccountSessionLifecycle({ wrapper, configOptions, timeoutMs: 90000 }); await account.prepare();
    {
      runtimeStage = 'engine_initialize';
      nativeMethod(engine, 'initWithDeskTopConfig')(config.engine, createCountingGlobalAdapter().adapter);
      loginService = nativeMethod(Object.getOwnPropertyDescriptor(wrapper, 'NodeIKernelLoginService')?.value, 'get')();
      nativeMethod(loginService, 'initConfig')(config.login);
    }
    runtimeStage = 'prepared';
    return { loginService, beforeDestroy: stopAccount, destroyEngine: () => { if (engine) nativeMethod(engine, 'destroy')(); } };
  } catch (error) {
    const codes = ['DESKTOP_QQ_RUNNING', 'HOST_CHANGED', 'QQ_PATH_REQUIRED', 'QQ_BASELINE_CHANGED', 'CONTROL_START_REFUSED'];
    runtimeFailure = codes.includes(error?.message) ? error.message : 'RUNTIME_PREPARE_FAILED';
    try { await stopAccount(); } catch { /* 最终由进程隔离兜底；不输出异常载荷。 */ }
    try { if (loginService) nativeMethod(loginService, 'destroy')(); } catch {}
    try { if (engine) nativeMethod(engine, 'destroy')(); } catch {}
    throw new Error('RUNTIME_PREPARE_FAILED');
  }
}
const controller = createManualLoginController({ openRuntime, allowAccountIdentity: true,
  preferExistingLogin: () => reuseExistingLogin, reuseLogin: tryReuseLogin,
  onAuthenticated: async (identity, { signal }) => {
    try {
      handoffStage = 'machine_guid'; const guid = nativeMethod(loginService, 'getMachineGuid')();
      handoffStage = 'account_initialize'; const result = await account.initialize(identity, guid, { signal });
      if (!result.initialized) { handoffStage = 'account_unconfirmed'; return false; }
      handoffStage = 'gateway_run';
      const outcome = await account.useInitializedSession((session) => gateway.run({ session, self: identity, signal,
        media: { root: dataRoot, profileAvatarRoot: process.env.QQ_GATEWAY_AVATAR_ROOT, profileAvatarBackupRoot: join(dataRoot, 'avatar-backups'),
          nativeRoots: [join(dataRoot, 'account'), join(dataRoot, 'downloads')] } }));
      handoffStage = 'gateway_ended'; return outcome;
    } catch (error) { handoffFailureCode = gatewayFailureCode(error); throw new Error('ACCOUNT_HANDOFF_FAILED'); }
  },
  onTerminal: (state) => {
    send({ kind: 'terminal', cleanupErrors: state.cleanupErrors, cleanupComplete: state.cleanupComplete,
      phase: state.phase, outcome: state.outcome, failurePoint: state.failurePoint, runtimeStage, runtimeFailure,
      diagnostics: projectGatewayDiagnostics({ handoffStage, handoffFailureCode, account: account?.snapshot(), gateway: gateway.snapshot() }) });
    setTimeout(async () => { await broker.close(); await portal?.close(); control?.stop();
      process.exit(state.cleanupErrors || state.outcome === 'failed' || state.outcome === 'timed_out' ? 1 : 0); }, 300);
  },
});
portal = await createLoginPortal({ ...controller, configure: (scope) => !workspaceManaged && !startRequested && gateway.configure(scope),
  start: () => {
    if (!gateway.snapshot().configured || startRequested) return false;
    startRequested = true;
    send({ kind: 'initializing' });
    // 先返回用户的POST响应，再加载可能同步阻塞的原生模块。
    setTimeout(() => controller.start(), 50);
    return true;
  },
  snapshot: () => { const state = controller.snapshot(); return { ...state, started: state.started || startRequested,
    phase: startRequested && state.phase === 'idle' ? 'initializing' : state.phase, gateway: { ...gateway.snapshot(), managedByDsh: workspaceManaged } }; },
}, { gateway: true, parentPortal: process.env.QQ_GATEWAY_PARENT_PORTAL });
send({ kind: 'portal', url: portal.url });
setInterval(() => {
  const native = gateway.snapshot();
  const phase = controller.snapshot().phase;
  broker.refresh(); // 先更新内存响应，再发布ready，避免读到旧空值。
  send({ kind: 'heartbeat', phase: startRequested && phase === 'idle' ? 'initializing' : phase, gatewayState: native.state,
    sendEnabled: native.sendEnabled, configured: native.configured, onebotUrl: native.onebotUrl, pipeSecurity: broker.snapshot() });
}, 1000).unref();
process.on('message', value => {
  if (value?.kind === 'stop') { void controller.stop(); return; }
  if (value?.kind !== 'workspace-request' || !/^[a-f0-9-]{36}$/.test(value.id ?? '')
      || !['state', 'configure','login-state','login-connect','login-refresh','login-stop'].includes(value.operation)) return;
  let ok = true;
  try {
    if(value.operation==='login-connect'){
      if(!gateway.snapshot().configured)throw 0;
      if(!startRequested){startRequested=true;send({kind:'initializing'});setTimeout(()=>controller.start(),50);}
    }
    if(value.operation==='login-refresh')controller.refresh();
    if(value.operation==='login-stop')setTimeout(()=>void controller.stop(),100);
    if (value.operation === 'configure') {
      if (Buffer.byteLength(JSON.stringify(value.configuration)) > 4096) throw 0;
      const { reuseLogin, ...configuration } = value.configuration;
      if (reuseLogin !== undefined && typeof reuseLogin !== 'boolean') throw 0;
      ok = gateway.reconfigure(configuration);
      if (ok) workspaceManaged = true;
      if (ok && reuseLogin !== undefined) reuseExistingLogin = reuseLogin;
      broker.refresh();
    }
  } catch { ok = false; }
  const state = controller.snapshot(), native = gateway.snapshot();
  send({ kind: 'workspace-response', id: value.id, ok,
    value: { gateway: native, login: { phase: startRequested&&state.phase==='idle'?'initializing':state.phase, hasQr: state.hasQr,started:state.started||startRequested,qrVersion:state.qrVersion,qrRequests:state.qrRequests,
      ...(value.operation==='login-state'&&state.hasQr?(()=>{const qr=controller.readQr();return qr&&qr.length<=192*1024?{qrData:'data:image/png;base64,'+qr.toString('base64')}:{hasQr:false};})():{}) },
      diagnostics: projectGatewayDiagnostics({ handoffStage, handoffFailureCode, account: account?.snapshot(), gateway: native }) } });
});
process.once('disconnect', () => { void controller.stop(); setTimeout(() => process.exit(2), 8000).unref(); });
process.on('uncaughtException', () => { send({ kind: 'fatal' }); process.exit(1); });
process.on('unhandledRejection', () => { send({ kind: 'fatal' }); process.exit(1); });
