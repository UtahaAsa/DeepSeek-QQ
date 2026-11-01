import { buildEngineConfig } from './engine-contract.mjs';

// 来自固定 NapCat 提交的版本表，属于公开客户端元数据，不是用户凭据。
export const loginVersion = Object.freeze({ version: '9.9.35-52892', appid: '537382819', qua: 'V1_WIN_NQ_9.9.35_52892_GW_B' });
const callbackNames = ['onLoginConnected', 'onLoginDisConnected', 'onLoginConnecting', 'onQRCodeGetPicture',
  'onQRCodeLoginPollingStarted', 'onQRCodeSessionUserScaned', 'onQRCodeLoginSucceed', 'onQRCodeSessionFailed',
  'onLoginFailed', 'onLogoutSucceed', 'onLogoutFailed', 'onUserLoggedIn', 'onQRCodeSessionQuickLoginFailed',
  'onPasswordLoginFailed', 'OnConfirmUnusualDeviceFailed', 'onQQLoginNumLimited', 'onLoginState', 'onLoginRecordUpdate'];
const valueKind = (value) => value === null ? 'null' : value === true ? 'true' : value === false ? 'false' : typeof value;

/**
 * 读取原生公开数据方法，不调用 getter；调用方仍须负责实际执行授权。
 * @param {object} object 实例或工厂。
 * @param {string} name 明确的方法名。
 * @returns {function} 绑定到原对象的函数。
 * @throws {Error} 方法缺失或不是数据函数时拒绝；不输出原始对象。
 */
export function nativeMethod(object, name) {
  for (let cursor = object, depth = 0; cursor && depth < 8; cursor = Object.getPrototypeOf(cursor), depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
    if (descriptor) {
      if (typeof descriptor.value !== 'function') break;
      return descriptor.value.bind(object);
    }
  }
  throw new Error('NATIVE_METHOD_UNAVAILABLE');
}

/**
 * 核验所属原生监听注册返回的句柄，沿用文字通道已支持的数字/数字字符串契约。
 * @param {unknown} value 原生注册方法的原始返回值，不接受用户提供的替代句柄。
 * @returns {boolean} 非负安全整数或1到20位数字字符串为true；不转换值、不执行I/O。
 * @note 调用方须原样保存并移除所属句柄；本函数不授予任何账号或操作权限。
 */
export function isNativeListenerHandle(value) {
  return Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^\d{1,20}$/.test(value);
}

/**
 * 生成固定版本、独立目录的引擎和登录配置；不读取真实主机名或账号历史。
 * @param {{dataRoot:string, globalPath:string, osVersion:string}} options 受控路径与系统版本。
 * @returns {{engine:object, login:object}} 无账号/票据的配置。
 * @note 复用引擎路径校验；路径真实边界与文件指纹由宿主执行前检查。
 */
export function buildManualLoginConfig(options) {
  const engine = { ...buildEngineConfig(options), qua: loginVersion.qua };
  return { engine, login: { machineId: '', appid: loginVersion.appid, platVer: options.osVersion,
    commonPath: engine.global_path_config.desktopGlobalPath, clientVer: loginVersion.version,
    hostName: 'QQ-Bridge-Lab', externalVersion: false } };
}

function decodeQr(payload) {
  const descriptor = payload && Object.getOwnPropertyDescriptor(payload, 'pngBase64QrcodeData');
  const source = descriptor?.value;
  if (typeof source !== 'string' || source.length > 180000) return null;
  const encoded = source.replace(/^data:image\/png;base64,/, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  const png = Buffer.from(encoded, 'base64');
  if (png.length < 33 || png.length > 131072 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) < 1 || png.readUInt32BE(16) > 2048 ||
      png.readUInt32BE(20) < 1 || png.readUInt32BE(20) > 2048) return null;
  return png;
}

/**
 * 仅提取本次手动登录回调的两个身份字段，供同一子进程内初始化账号会话。
 * @param {object} payload 真实登录成功通知；不得将原对象/返回值写日志或传给监督父进程。
 * @returns {{uin:string,uid:string}} 独立的只读身份对象，不包含票据、昵称或其它字段。
 * @throws {Error} 数据字段缺失、为 getter 或格式异常时拒绝，错误不包含原始值。
 */
export function extractSessionIdentity(payload) {
  let uin, uid;
  try {
    uin = Object.getOwnPropertyDescriptor(payload, 'uin')?.value;
    uid = Object.getOwnPropertyDescriptor(payload, 'uid')?.value;
  } catch { throw new Error('LOGIN_IDENTITY_INVALID'); }
  if (typeof uin !== 'string' || !/^[1-9]\d{0,19}$/.test(uin) ||
      typeof uid !== 'string' || !/^u_[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('LOGIN_IDENTITY_INVALID');
  return Object.freeze({ uin, uid });
}

/**
 * 创建手动扫码控制器，构造时不加载原生模块；仅 start() 才调用宿主工厂。
 * @param {{openRuntime:function():Promise<object>, onTerminal?:function(object):void, onStage?:function(string):Promise<void>, allowAccountIdentity?:boolean, onAuthenticated?:function(object,object):Promise<boolean|{sessionInitialized:boolean,completed:boolean}>}} options
 *   openRuntime 提供已配置的 loginService 和 destroyEngine；onTerminal 仅接收脱敏结果，onStage 刷出固定操作名。
 * @returns {object} start/refresh/stop/snapshot/readQr 接口；二维码仅在内存内返回给本机页面。
 * @note 单 JS 线程；只接受一次开始、最多两次二维码请求。忽略成功事件的全部账号参数。
 *       默认忽略成功载荷。只有显式允许身份且提供 onAuthenticated 才把两个字段交给受控后续处理；
 *       onAuthenticated 必须响应 signal；可返回true，或仅含sessionInitialized/completed布尔值的结果。
 *       初始化和后续验收分别记录，避免取消后把已完成初始化抹去。stop幂等，异常正文不外传。
 */
export function createManualLoginController({ openRuntime, onTerminal = () => {}, onStage = async () => {}, allowAccountIdentity = false, onAuthenticated = null,
  preferExistingLogin = () => false, reuseLogin = null }) {
  if ((allowAccountIdentity === true) !== (typeof onAuthenticated === 'function')) throw new Error('ACCOUNT_HANDOFF_SCOPE_REQUIRED');
  let phase = 'idle', outcome = null, started = false, connected = false, stopping = false;
  let loginSucceeded = false, qr = null, qrRequests = 0, qrVersion = 0, listenerId = null;
  let runtime = null, methods = null, startTask = null, stopTask = null, cleanupComplete = false, cleanupErrors = 0;
  let failurePoint = null, operation = 'idle', listenerRegistered = false, listenerRemovalVerified = false;
  let listenerHandleKind = 'unobserved', connectReturnKind = 'unobserved', qrRequestReturnKind = 'unobserved';
  let handoffTask = null, accountIdentityRead = false, accountSessionInitialized = false;
  const handoffAbort = new AbortController();
  let reuseTask = null, reuseTimer = null, reuseBusy = false, reuseRequested = false;
  let loginReuse = { status: 'not_attempted', candidates: 0 };
  const callbackCounts = Object.fromEntries(callbackNames.map((name) => [name, 0]));
  const snapshot = () => ({ phase, outcome, started, connected, loginSucceeded, qrRequests, qrVersion, loginReuse: { ...loginReuse },
    hasQr: qr !== null, cleanupComplete, cleanupErrors, failurePoint, operation, listenerRegistered, listenerRemovalVerified,
    listenerHandleKind, connectReturnKind, qrRequestReturnKind, accountIdentityRead, accountSessionInitialized, callbackCounts: { ...callbackCounts } });
  const clearQr = () => { if (qr) qr.fill(0); qr = null; };
  const finish = (reason, point = null) => { if (reason === 'failed') failurePoint ??= point ?? 'login_event'; void stop(reason); };
  const listener = Object.fromEntries(callbackNames.map((name) => [name, (...args) => {
    if (stopping) return;
    callbackCounts[name] = Math.min(callbackCounts[name] + 1, 1000000);
    if (name === 'onLoginConnected') {
      connected = true; phase = 'connected';
      if (qrRequests === 0 && !reuseRequested) queueMicrotask(() => beginLogin());
    } else if (name === 'onQRCodeGetPicture') {
      // 只读取 PNG 字段；不访问二维码 URL、账号、昵称、头像或任何票据字段。
      let nextQr = null;
      try { nextQr = qrRequests > 0 ? decodeQr(args[0]) : null; } catch { /* 原生载荷异常不进入日志。 */ }
      if (!nextQr) { finish('failed', 'qr_payload'); return; }
      clearQr(); qr = nextQr; qrVersion++; phase = 'qr_ready';
    } else if (name === 'onQRCodeSessionUserScaned') {
      clearQr(); phase = 'scanned';
    } else if (name === 'onQRCodeLoginSucceed') {
      if (loginSucceeded) return;
      clearTimeout(reuseTimer);
      loginSucceeded = true; clearQr();
      if (!allowAccountIdentity) { finish('succeeded'); return; }
      let identity;
      try { accountIdentityRead = true; identity = extractSessionIdentity(args[0]); }
      catch { finish('failed', 'identity_handoff'); return; }
      phase = 'session_initializing'; operation = 'account_session';
      handoffTask = Promise.resolve().then(() => onAuthenticated(identity, { signal: handoffAbort.signal }))
        .then((confirmed) => {
          const initialized = confirmed === true || Object.getOwnPropertyDescriptor(confirmed ?? {}, 'sessionInitialized')?.value === true;
          const completed = confirmed === true || Object.getOwnPropertyDescriptor(confirmed ?? {}, 'completed')?.value === true;
          accountSessionInitialized = initialized;
          if (stopping) return;
          finish(completed ? 'succeeded' : 'failed', 'account_session');
        }).catch(() => { if (!stopping) finish('failed', 'account_session'); });
    } else if (name === 'onQRCodeSessionFailed') {
      clearQr(); phase = 'expired';
    } else if (name === 'onUserLoggedIn') {
      finish('failed', 'already_logged_in');
    } else if (['onLoginDisConnected', 'onLoginFailed', 'onQQLoginNumLimited',
      'onPasswordLoginFailed', 'OnConfirmUnusualDeviceFailed', 'onQRCodeSessionQuickLoginFailed'].includes(name)) {
      finish('failed');
    }
  }]));
  function beginLogin() {
    if (stopping || reuseRequested || loginSucceeded) return;
    reuseRequested = true;
    if (typeof reuseLogin !== 'function' || preferExistingLogin() !== true) { refresh(); return; }
    reuseBusy = true; loginReuse = { status: 'checking', candidates: 0 };
    reuseTask = Promise.resolve().then(() => reuseLogin({ service: runtime.loginService,
      current: () => !stopping && !loginSucceeded })).then(result => {
      loginReuse = { status: ['unavailable', 'multiple_accounts', 'accepted', 'refused', 'unknown', 'cancelled'].includes(result?.status)
        ? result.status : 'unknown', candidates: Number.isSafeInteger(result?.candidates) && result.candidates >= 0 && result.candidates <= 16 ? result.candidates : 0 };
      reuseBusy = false;
      if (loginSucceeded) { loginReuse.status = 'authenticated'; return; }
      if (stopping || loginSucceeded || loginReuse.status === 'cancelled') return;
      if (['unavailable', 'multiple_accounts', 'refused'].includes(loginReuse.status)) { refresh(); return; }
      if (loginReuse.status === 'unknown') { finish('failed', 'reuse_unconfirmed'); return; }
      // 固定接口返回0仍不是登录成功；无真实成功回调不交接身份，也不并发发二维码。
      reuseTimer = setTimeout(() => finish('failed', 'reuse_unconfirmed'), 10000);
    }).catch(() => { reuseBusy = false; loginReuse = { status: 'unknown', candidates: 0 }; finish('failed', 'reuse_unconfirmed'); });
  }
  function start() {
    if (started || stopping) return false;
    started = true; phase = 'initializing';
    startTask = (async () => {
      try {
        operation = 'runtime_prepare';
        runtime = await openRuntime();
        if (stopping) return;
        operation = 'method_lookup';
        await onStage('before_login_method_lookup');
        methods = Object.fromEntries(['addKernelLoginListener', 'removeKernelLoginListener', 'connect', 'getQRCodePicture', 'destroy']
          .map((name) => [name, nativeMethod(runtime.loginService, name)]));
        operation = 'listener_registration';
        await onStage('before_login_listener');
        if (stopping) return;
        const registration = methods.addKernelLoginListener(listener);
        listenerHandleKind = valueKind(registration);
        listenerRegistered = true;
        if (Number.isSafeInteger(registration) && registration >= 0) listenerId = registration;
        // 参考启动实现不依赖返回编号。未知编号不猜转换方式，关闭时销毁整个独立登录服务，
        // 并保留 listenerRemovalVerified=false，不能冒充单独注销已完成。
        if (registration instanceof Promise) { registration.catch(() => {}); throw new Error('ASYNC_REGISTRATION_UNSUPPORTED'); }
        await onStage('after_login_listener');
        if (stopping) return;
        phase = 'connecting';
        operation = 'connect';
        await onStage('before_login_connect');
        if (stopping) return;
        const connection = methods.connect();
        connectReturnKind = valueKind(connection);
        // 返回布尔值的语义未证实；由成功/失败回调及监督时限决定结果，不将 false 当成认证失败。
        if (connection instanceof Promise) { connection.catch(() => {}); throw new Error('ASYNC_CONNECT_UNSUPPORTED'); }
        await onStage('after_login_connect');
        if (!stopping) operation = 'await_login_event';
      } catch { const point = operation; queueMicrotask(() => finish('failed', point)); }
    })();
    return true;
  }
  function refresh() {
    if (stopping || reuseBusy || ['accepted', 'unknown'].includes(loginReuse.status) || !connected || qrRequests >= 2 || !['connected', 'expired'].includes(phase)) return false;
    qrRequests++; clearQr(); phase = 'requesting_qr';
    try {
      operation = 'qr_request';
      const requested = methods.getQRCodePicture();
      qrRequestReturnKind = valueKind(requested);
      if (requested === false) { finish('failed', 'qr_request_refused'); return false; }
      return true;
    } catch { finish('failed', 'qr_request'); return false; }
  }
  function stop(reason = 'cancelled') {
    if (stopTask) return stopTask;
    if (!['cancelled', 'timed_out', 'failed', 'succeeded'].includes(reason)) reason = 'failed';
    stopping = true; outcome = reason; phase = 'stopping'; clearQr(); clearTimeout(reuseTimer);
    handoffAbort.abort();
    stopTask = (async () => {
      await startTask;
      await reuseTask;
      await handoffTask;
      if (runtime) {
        if (typeof runtime.beforeDestroy === 'function') {
          try { await runtime.beforeDestroy(); } catch { cleanupErrors++; }
        }
        if (Number.isSafeInteger(listenerId) && listenerId >= 0) {
          try { await nativeMethod(runtime.loginService, 'removeKernelLoginListener')(listenerId); listenerRemovalVerified = true; } catch { cleanupErrors++; }
        }
        try { await nativeMethod(runtime.loginService, 'destroy')(); } catch { cleanupErrors++; }
        try { await runtime.destroyEngine(); } catch { cleanupErrors++; }
      }
      cleanupComplete = cleanupErrors === 0 && (!listenerRegistered || listenerRemovalVerified); phase = outcome;
      onTerminal(snapshot());
      return snapshot();
    })();
    return stopTask;
  }
  return { start, refresh, stop, snapshot, readQr: () => qr ? Buffer.from(qr) : null };
}
