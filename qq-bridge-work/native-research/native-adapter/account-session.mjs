import { isAbsolute, relative, resolve, sep } from 'node:path';
import { loginVersion, nativeMethod } from './manual-login.mjs';

const listenerNames = ['onNTSessionCreate', 'onGProSessionCreate', 'onSessionInitComplete', 'onOpentelemetryInit', 'onUserOnlineResult', 'onGetSelfTinyId'];
const dependsNames = ['onMSFStatusChange', 'onMSFSsoError', 'getGroupCode'];
const dispatcherNames = ['dispatchRequest', 'dispatchCall', 'dispatchCallWithJson'];
const timedCallbackNames = ['onNTSessionCreate', 'onSessionInitComplete', 'onOpentelemetryInit', 'onMSFStatusChange'];
const maxDiagnosticElapsedMs = 86400000;
// 固定公开MsfStatusType/MsfChangeReasonType；只保存标签，不转换或保留未知回调值。
const msfStatuses = new Map([[0, 'unknown'], [1, 'disconnected'], [2, 'connected']]);
const msfReasons = new Map([[0, 'unknown'], [1, 'user_login'], [2, 'user_logout'], [3, 'auto']]);

function inside(root, path) {
  if (!isAbsolute(root) || !isAbsolute(path)) throw new Error('SESSION_PATH_INVALID');
  const delta = relative(resolve(root), resolve(path));
  if (!delta || delta === '..' || delta.startsWith('..' + sep) || isAbsolute(delta)) throw new Error('SESSION_PATH_OUTSIDE_ROOT');
  return resolve(path);
}

/**
 * 生成固定 QQ 版本的账号会话配置，仅在进程内使用，不序列化账号或设备标识。
 * @param {object} options dataRoot/accountPath/downloadPath 为本次试验路径；identity 为手动登录回调的 uin/uid；machineGuid 为当前登录服务生成的 GUID；osVersion 为系统版本。
 * @returns {object} 私有会话配置；票据字段保持空值，不读取已有 QQ 数据库。
 * @throws {Error} 身份、GUID、版本或路径不满足受控格式时拒绝，错误不包含值。
 * @note 无文件/网络副作用；宿主须在执行前校验实际路径和原生文件指纹。
 */
export function buildAccountSessionConfig({ dataRoot, accountPath, downloadPath, identity, machineGuid, osVersion }) {
  if (typeof identity?.uin !== 'string' || !/^[1-9]\d{0,19}$/.test(identity.uin) ||
      typeof identity?.uid !== 'string' || !/^u_[A-Za-z0-9_-]{1,128}$/.test(identity.uid)) throw new Error('SESSION_IDENTITY_INVALID');
  if (typeof machineGuid !== 'string' || !/^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12})$/.test(machineGuid)) throw new Error('SESSION_GUID_INVALID');
  if (typeof osVersion !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(osVersion)) throw new Error('SESSION_OS_INVALID');
  const rawGuid = machineGuid.replaceAll('-', '');
  const guid = [rawGuid.slice(0, 8), rawGuid.slice(8, 12), rawGuid.slice(12, 16), rawGuid.slice(16, 20), rawGuid.slice(20)].join('-');
  return {
    selfUin: identity.uin, selfUid: identity.uid,
    desktopPathConfig: { account_path: inside(dataRoot, accountPath) },
    clientVer: loginVersion.version, a2: '', d2: '', d2Key: '', machineId: '', platform: 3,
    platVer: osVersion, appid: loginVersion.appid,
    rdeliveryConfig: { appKey: '', systemId: 0, appId: '', logicEnvironment: '', platform: 3,
      language: '', sdkVersion: '', userId: '', appVersion: '', osVersion: '', bundleId: '', serverUrl: '', fixedAfterHitKeys: [''] },
    defaultFileDownloadPath: inside(dataRoot, downloadPath),
    deviceInfo: { guid, buildVer: loginVersion.version, localId: 2052, devName: 'QQ-Bridge-Lab', devType: 'Windows_NT',
      vendorName: '', osVer: osVersion, vendorOsName: 'Windows_NT', setMute: false, vendorType: 0 },
    deviceConfig: '{"appearance":{"isSplitViewMode":true},"msg":{}}',
  };
}

/**
 * 创建账号会话的受控生命周期对象；构造无原生调用，prepare/initialize/stop 才执行显式方法。
 * @param {object} options wrapper 为已加载模块；configOptions 为独立目录和系统版本；onStage 仅接收固定阶段名。
 *   timeoutMs默认研究预算20秒，允许10至120000毫秒；常驻调用方须显式选择预算。now仅供隔离单调时钟替身。
 * @returns {object} prepare、initialize、stop、snapshot、useInitializedSession；底层会话仅传给宿主内部回调，不进入报告。
 * @note prepare 使用 StartupSession.create + getNTWrapperSession('nt_1')；initialize 调用 init/start。
 *       同时观察到 onSessionInitComplete 和 is_init=true 且 start 返回才确认初始化通知。
 *       快照附有界预算/耗时、缺失信号、必要回调首次耗时和MSF固定标签，不读取任意载荷。
 *       stop 只调用公开的零参数 startup.stop，不猜测 session.close 参数；全部原生析构仍未证实。
 */
export function createAccountSessionLifecycle({ wrapper, configOptions, onStage = async () => {}, timeoutMs = 20000,
  now = () => performance.now() }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120000 || typeof now !== 'function') throw new Error('SESSION_TIMEOUT_INVALID');
  let startup = null, session = null, prepareAttempted = false, prepared = false, stopped = false, stopTask = null;
  let initializeAttempted = false, initReturned = false, startAttempted = false, startReturned = false;
  let initCompleteObserved = false, telemetryInitialized = false, initialized = false, stopAttempted = false, stopReturned = false;
  let failurePoint = null, operation = 'idle', completeWait = null;
  let initializationStartedAt = null, initializationFinished = false, initializationElapsedMs = null;
  let msfStatus = null, msfChangeReason = null;
  const counts = Object.fromEntries([...listenerNames, ...dependsNames, ...dispatcherNames].map((name) => [name, 0]));
  const firstElapsedMs = Object.fromEntries(timedCallbackNames.map(name => [name, null]));
  const elapsed = () => {
    try {
      const duration = initializationStartedAt === null ? NaN : now() - initializationStartedAt;
      return Number.isFinite(duration) && duration >= 0 ? Math.min(maxDiagnosticElapsedMs, Math.floor(duration)) : null;
    } catch { return null; }
  };
  const snapshot = () => ({ prepared, initializeAttempted, initReturned, startAttempted, startReturned,
    initCompleteObserved, telemetryInitialized, initialized, stopAttempted, stopReturned, stopped,
    failurePoint, operation, callbackCounts: { ...counts }, nativeResourceTeardownVerified: false,
    initializationBudgetMs: timeoutMs, initializationElapsedMs: initializationFinished ? initializationElapsedMs : elapsed(),
    missingInitializationSignals: [!initReturned && 'init_return', !startReturned && 'startup_return',
      !initCompleteObserved && 'session_init_complete', !telemetryInitialized && 'telemetry_initialized'].filter(Boolean),
    callbackFirstElapsedMs: { ...firstElapsedMs }, msfStatus, msfChangeReason });
  const increment = (name) => {
    counts[name] = Math.min(counts[name] + 1, 1000000);
    if (Object.hasOwn(firstElapsedMs, name) && firstElapsedMs[name] === null) firstElapsedMs[name] = elapsed();
  };
  const check = () => { if (!stopped && initCompleteObserved && telemetryInitialized && startReturned) completeWait?.(true); };
  const listener = Object.fromEntries(listenerNames.map((name) => [name, (payload) => {
    if (stopped) return;
    increment(name);
    if (name === 'onSessionInitComplete') { initCompleteObserved = true; check(); }
    if (name === 'onOpentelemetryInit') {
      let ready;
      try { ready = Object.getOwnPropertyDescriptor(payload ?? {}, 'is_init')?.value; } catch { return; }
      if (ready === true) { telemetryInitialized = true; check(); }
      else if (ready === false) { failurePoint = 'telemetry_initialize'; completeWait?.(false); }
    }
  }]));
  const depends = Object.fromEntries(dependsNames.map((name) => [name, (...args) => {
    if (stopped) return;
    increment(name);
    if (name === 'onMSFStatusChange') {
      if (msfStatuses.has(args[0])) msfStatus = msfStatuses.get(args[0]);
      if (msfReasons.has(args[1])) msfChangeReason = msfReasons.get(args[1]);
    }
  }]));
  const dispatcher = Object.fromEntries(dispatcherNames.map((name) => [name, () => { if (!stopped) increment(name); }]));

  async function prepare() {
    if (prepareAttempted || stopped) throw new Error('SESSION_PREPARE_REFUSED');
    prepareAttempted = true;
    try {
      operation = 'startup_create'; await onStage('before_startup_create');
      if (stopped) throw new Error('SESSION_STOPPED');
      startup = nativeMethod(Object.getOwnPropertyDescriptor(wrapper, 'NodeIQQNTStartupSessionWrapper')?.value, 'create')();
      nativeMethod(startup, 'start'); nativeMethod(startup, 'stop');
      operation = 'session_get'; await onStage('before_session_get');
      if (stopped) throw new Error('SESSION_STOPPED');
      session = nativeMethod(Object.getOwnPropertyDescriptor(wrapper, 'NodeIQQNTWrapperSession')?.value, 'getNTWrapperSession')('nt_1');
      nativeMethod(session, 'init');
      prepared = true; operation = 'prepared'; await onStage('after_session_prepare');
    } catch { failurePoint ??= operation; throw new Error('SESSION_PREPARE_FAILED'); }
  }
  async function initialize(identity, machineGuid, { signal } = {}) {
    if (!prepared || initializeAttempted || stopped) throw new Error('SESSION_INITIALIZE_REFUSED');
    initializeAttempted = true;
    try { const time = now(); if (Number.isFinite(time)) initializationStartedAt = time; } catch { /* 诊断时钟不能阻止原生流程。 */ }
    let timer, abort;
    const waiting = new Promise((resolve) => { completeWait = resolve; });
    try {
      operation = 'session_config';
      const config = buildAccountSessionConfig({ ...configOptions, identity, machineGuid });
      abort = () => { failurePoint ??= 'aborted'; completeWait(false); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return snapshot(); }
      timer = setTimeout(() => { failurePoint ??= 'initialization_timeout'; completeWait(false); }, timeoutMs);
      operation = 'session_init'; await onStage('before_session_initialize');
      if (stopped || signal?.aborted) { abort(); return snapshot(); }
      const initResult = nativeMethod(session, 'init')(config, depends, dispatcher, listener);
      if (initResult instanceof Promise) await initResult;
      initReturned = true; await onStage('after_session_initialize');
      if (stopped || signal?.aborted || failurePoint) { completeWait(false); return snapshot(); }
      operation = 'startup_start'; await onStage('before_startup_start');
      if (stopped || signal?.aborted) { abort(); return snapshot(); }
      startAttempted = true;
      const startResult = nativeMethod(startup, 'start')();
      if (startResult instanceof Promise) await startResult;
      startReturned = true; await onStage('after_startup_start');
      operation = 'await_initialization'; check();
      initialized = await waiting;
      operation = initialized ? 'initialized' : 'initialization_unconfirmed';
    } catch { failurePoint ??= operation; }
    finally {
      initializationElapsedMs = elapsed(); initializationFinished = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); completeWait = null;
    }
    return snapshot();
  }
  function stop() {
    if (stopTask) return stopTask;
    stopped = true; completeWait?.(false);
    stopTask = (async () => {
      if (startup && startAttempted) {
        try {
          await onStage('before_startup_stop'); stopAttempted = true;
          const result = nativeMethod(startup, 'stop')();
          if (result instanceof Promise) await result;
          stopReturned = true; await onStage('after_startup_stop');
        } catch { failurePoint ??= 'startup_stop'; }
      }
      return snapshot();
    })();
    return stopTask;
  }
  function useInitializedSession(callback) {
    if (!initialized || stopped || typeof callback !== 'function') throw new Error('SESSION_USE_REFUSED');
    return callback(session);
  }
  return Object.freeze({ prepare, initialize, stop, snapshot, useInitializedSession });
}
