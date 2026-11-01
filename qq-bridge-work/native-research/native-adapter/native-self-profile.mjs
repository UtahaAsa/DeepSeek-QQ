import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { nativeMethod, isNativeListenerHandle } from './manual-login.mjs';
import { SENSITIVE_RE } from '../../bridge/src/sensitive.js';

const own = (object, key) => object && Object.getOwnPropertyDescriptor(object, key)?.value;
const fail = code => Object.assign(new Error(code), { code });
const fields = Object.freeze(['nickname', 'signature', 'birthday', 'avatar']);
const methods = Object.freeze({ nickname: 'setNickName', signature: 'setLongNick', birthday: 'setBirthday', avatar: 'setHeader' });
const record = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).every(key => keys.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const dayAt = time => Math.floor((time + 8 * 3600000) / 86400000);
const digest = value => createHash('sha256').update(value).digest('hex');

/**
 * 校验自身昵称、签名、生日与头像四项独立许可，不因其它QQ功能开启而授予写入。
 * @param {object} value 四个同名布尔字段，省略项为false；拒绝访问器、符号及未知字段。
 * @returns {Readonly<object>} 无I/O的冻结副本；异常为SELF_PROFILE_SETTINGS_INVALID。
 */
export function normalizeSelfProfilePermissions(value = {}) {
  if (!record(value, fields)) throw fail('SELF_PROFILE_SETTINGS_INVALID');
  const result = {};
  for (const field of fields) {
    const item = own(value, field);
    if (item !== undefined && typeof item !== 'boolean' || Object.hasOwn(value, field) && item === undefined) {
      throw fail('SELF_PROFILE_SETTINGS_INVALID');
    }
    result[field] = item ?? false;
  }
  return Object.freeze(result);
}

function birthday(value) {
  if (!record(value, ['year', 'month', 'day'])) throw fail('SELF_PROFILE_VALUE_INVALID');
  const year = own(value, 'year'), month = own(value, 'month'), day = own(value, 'day');
  if (![year, month, day].every(Number.isSafeInteger) || year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) {
    throw fail('SELF_PROFILE_VALUE_INVALID');
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw fail('SELF_PROFILE_VALUE_INVALID');
  }
  return Object.freeze({ year, month, day });
}

/**
 * 构造固定版本的自身资料写入核心；不接受目标账号，不读取联系人或历史。
 * @param {object} options session/self为所属已登录会话，self为uin/uid；构造无原生调用。
 *   authorize(field)同步重验所属会话、在线、操作员许可及当前聊天资格，返回上下文版本或null。
 *   contentAllowed(text)是昵称/签名的已知令牌与隐私闸门，必须严格返回true。
 *   avatarStager为内部受控缓存暂存器；prepare(handle,context)返回path/sha256/release，绝不接模型路径。
 *   isSessionExited只由宿主确认所属原生引擎已经退出，默认false；不能用掉线或stop替代退出证明。
 *   timeoutMs为一次操作总时限，now仅供隔离时钟；不是操作员任意原生方法配置。
 * @returns {object} start/execute/stop/releaseAfterSessionExit/snapshot。execute只接受{field,value}，不返回资料正文或原生诊断。
 * @note 单JS线程，一路操作；每字段5分钟、北京日20次尝试，重启清零，无自动重试。
 *   文本/生日修改后强制定向服务器读回，仅读回一致才称observed；原生零码不冒充已生效。
 *   头像零码只表示accepted。未知结果熔断；停止不能回滚已交原生的请求。
 *   仅头像prepare尚未触达setter的失败返回not_submitted及固定reason；不重用本轮修改资格。
 */
export function createNativeSelfProfile({ session, self, permissions: input, authorize, contentAllowed,
  avatarStager = null, isSessionExited = () => false, timeoutMs = 5000, avatarTimeoutMs = timeoutMs, now = Date.now }) {
  let permissions = normalizeSelfProfilePermissions(input);
  const identity = { uin: own(self, 'uin'), uid: own(self, 'uid') };
  if (typeof identity.uin !== 'string' || !/^[1-9]\d{0,19}$/.test(identity.uin)
      || typeof identity.uid !== 'string' || !/^u_[A-Za-z0-9_-]{1,128}$/.test(identity.uid)
      || typeof authorize !== 'function' || typeof contentAllowed !== 'function' || typeof now !== 'function' || typeof isSessionExited !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000
      || !Number.isSafeInteger(avatarTimeoutMs) || avatarTimeoutMs < timeoutMs || avatarTimeoutMs > 30000
      || permissions.avatar && (!avatarStager || typeof avatarStager.prepare !== 'function')) {
    throw fail('SELF_PROFILE_OPTIONS_INVALID');
  }
  let state = 'idle', service, listenerHandle, removalVerified = false, stopTask, pendingRead = null;
  let listenerAttempted = false;
  let busy = false, uncertain = false, highWater = 0, currentDay = null, dayAttempts = 0, nativePending = 0, sessionExitVerified = false;
  const waits = new Set(), recent = new Map(), hashes = new Set(), retainedLeases = new Set();
  const counts = { attempts: 0, unchanged: 0, observed: 0, accepted: 0, rejected: 0, unknown: 0, releaseFailures: 0 };
  function context(field, expected) {
    const clock = now();
    if (!Number.isSafeInteger(clock) || clock < 0 || clock < highWater) throw fail('SELF_PROFILE_CLOCK_INVALID');
    highWater = clock;
    if (state !== 'active' || uncertain || !permissions[field]) throw fail('SELF_PROFILE_NOT_ALLOWED');
    let value;
    try { value = authorize(field); } catch { throw fail('SELF_PROFILE_NOT_ALLOWED'); }
    if (typeof value !== 'string' || !value || value.length > 256 || expected !== undefined && expected !== value) {
      throw fail('SELF_PROFILE_NOT_ALLOWED');
    }
    return value;
  }
  function within(promise, deadline, stoppable = true, avatarPreparation = false) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, value) => {
        if (finished) return; finished = true; clearTimeout(timer); waits.delete(cancel);
        error ? reject(error) : resolve(value);
      };
      const cancel = () => finish(fail('SELF_PROFILE_NOT_ALLOWED'));
      const timer = setTimeout(() => finish(fail('SELF_PROFILE_TIMEOUT')), Math.max(1, deadline - performance.now()));
      if (stoppable) waits.add(cancel);
      Promise.resolve(promise).then(value => finish(null, value), error => finish(fail(
        avatarPreparation && error?.code === 'AVATAR_BACKUP_UNAVAILABLE' ? 'AVATAR_BACKUP_UNAVAILABLE' : 'SELF_PROFILE_NATIVE_FAILED')));
    });
  }
  function project(raw, field) {
    const simple = own(raw, 'simpleInfo'), core = own(simple, 'coreInfo'), base = own(simple, 'baseInfo');
    if (own(raw, 'uid') !== identity.uid || own(raw, 'uin') !== identity.uin
        || own(core, 'uid') !== identity.uid || own(core, 'uin') !== identity.uin) throw fail('SELF_PROFILE_SUBJECT_UNVERIFIED');
    if (field === 'avatar') return null;
    if (field === 'birthday') {
      const value = { year: own(base, 'birthday_year'), month: own(base, 'birthday_month'), day: own(base, 'birthday_day') };
      // 原生三项均为零表示尚未设置；不把它改成推测日期，也不挡住显式设置生日。
      return Object.values(value).every(item => item === 0) ? null : birthday(value);
    }
    const value = field === 'nickname' ? own(core, 'nick') : own(base, 'longNick');
    if (typeof value !== 'string' || value.length > 16384 || !value.isWellFormed()) throw fail('SELF_PROFILE_SUBJECT_UNVERIFIED');
    return value;
  }
  const listener = new Proxy({ onUserDetailInfoChanged(value) {
    const pending = pendingRead;
    if (!pending || own(value, 'uid') !== identity.uid) return;
    try { pending.resolve(project(value, pending.field)); } catch { pending.reject(fail('SELF_PROFILE_SUBJECT_UNVERIFIED')); }
  } }, { get(target, key) { return Object.hasOwn(target, key) ? target[key]
    : typeof key === 'string' && /^on[A-Za-z]/.test(key) ? () => {} : undefined; } });
  async function read(field, revision, deadline) {
    context(field, revision);
    let resolve, reject;
    const event = new Promise((yes, no) => { resolve = yes; reject = no; }); event.catch(() => {});
    pendingRead = { field, resolve, reject };
    try {
      const result = await within(Promise.resolve().then(() => {
        context(field, revision);
        if (performance.now() >= deadline) throw fail('SELF_PROFILE_TIMEOUT');
        return nativeMethod(service, 'fetchUserDetailInfo')('QQBridgeSelfProfile', [identity.uid], 1, [0]);
      }), deadline);
      context(field, revision);
      if (own(result, 'result') !== 0 || own(result, 'source') !== 1) throw fail('SELF_PROFILE_SUBJECT_UNVERIFIED');
      const detail = own(result, 'detail');
      if (detail instanceof Map && detail.has(identity.uid)) return project(detail.get(identity.uid), field);
      return await within(event, deadline);
    } catch {
      // 原生资料监听没有请求编号。一次关联失败后停止本实例后续查询，避免晚到旧事件串入新操作。
      uncertain = true; throw fail('SELF_PROFILE_SUBJECT_UNVERIFIED');
    }
    finally { pendingRead = null; }
  }
  /**
   * 只读当前登录账号的一项已勾选资料；不提交setter、不消耗写入预算。
   * @param {string} field nickname/signature/birthday，与对应字段独立许可一致。
   * @returns {Promise<object>} field/value/submitted:false及强制自身读回来源；未设置生日为null。
   * @throws {Error} 忙碌、撤权、身份/来源不可验证时拒绝；读取失败保持既有串行关联熔断。
   */
  async function readField(field) {
    if (!['nickname','signature','birthday'].includes(field)) throw fail('SELF_PROFILE_REQUEST_INVALID');
    if (busy) throw fail('SELF_PROFILE_BUSY');
    const revision = context(field); busy = true;
    try {
      const value = await read(field, revision, performance.now() + timeoutMs); context(field, revision);
      return { field, value, submitted: false, confirmed: true, source: 'forced_self_field_read' };
    } finally { busy = false; }
  }
  function preparePermissions(next) {
      if (Object.values(next).some(Boolean)) {
        service ??= nativeMethod(session, 'getProfileService')();
        for (const method of ['fetchUserDetailInfo', 'addKernelProfileListener', 'removeKernelProfileListener',
          ...fields.filter(field => next[field]).map(field => methods[field])]) nativeMethod(service, method);
        if (listenerHandle === undefined) {
          if (listenerAttempted) throw fail('SELF_PROFILE_UNAVAILABLE');
          listenerAttempted = true;
          listenerHandle = nativeMethod(service, 'addKernelProfileListener')(listener);
        }
        if (!isNativeListenerHandle(listenerHandle)) throw fail('SELF_PROFILE_UNAVAILABLE');
      }
  }
  /** 热改资料许可，保留日预算、冷却、去重及未知结果锁。@param {object} value 新许可。@returns {void} 失败拒绝。 */
  function configure(value) {
    if (state !== 'active') throw fail('SELF_PROFILE_STATE_INVALID');
    const next = normalizeSelfProfilePermissions(value); preparePermissions(next); permissions = next;
  }
  function start() {
    if (state !== 'idle') throw fail('SELF_PROFILE_STATE_INVALID');
    try {
      preparePermissions(permissions);
      state = 'active'; return snapshot();
    } catch { state = 'closed'; throw fail('SELF_PROFILE_UNAVAILABLE'); }
  }
  function valueFor(field, value) {
    if (field === 'birthday') return birthday(value);
    if (field === 'avatar') {
      if (typeof value !== 'string' || !/^(?:qqimg|qqavatar)_[a-f0-9]{32}$/.test(value)) throw fail('SELF_PROFILE_VALUE_INVALID');
      return value;
    }
    const limit = field === 'nickname' ? 64 : 280;
    if (typeof value !== 'string' || !value.isWellFormed() || value !== value.trim()
        || field === 'nickname' && !value || Array.from(value).length > limit || Buffer.byteLength(value) > limit * 4
        || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
        || SENSITIVE_RE.test(value) || value.includes(identity.uin) || value.includes(identity.uid)) throw fail('SELF_PROFILE_VALUE_INVALID');
    let safe = false;
    try { safe = contentAllowed(value) === true; } catch {}
    if (!safe) throw fail('SELF_PROFILE_CONTENT_REFUSED');
    return value;
  }
  function budget(field, fingerprint, restoration = false) {
    const clock = now(), day = dayAt(clock);
    if (!Number.isSafeInteger(clock) || clock < 0 || clock < highWater) throw fail('SELF_PROFILE_CLOCK_INVALID');
    highWater = clock;
    if (day !== currentDay) { currentDay = day; dayAttempts = 0; hashes.clear(); }
    if (dayAttempts >= 20 || (!restoration && (hashes.has(fingerprint) || clock - (recent.get(field) ?? -Infinity) < 300000))) {
      throw fail('SELF_PROFILE_LIMIT');
    }
  }
  async function release(lease) {
    if (!lease) return;
    try {
      await within(Promise.resolve().then(() => nativeMethod(lease, 'release')()), performance.now() + timeoutMs, false);
    } catch { counts.releaseFailures++; }
  }
  async function execute(request) {
    if (!record(request, ['field', 'value']) || !fields.includes(own(request, 'field'))) throw fail('SELF_PROFILE_REQUEST_INVALID');
    const field = own(request, 'field'), value = valueFor(field, own(request, 'value'));
    if (busy) throw fail('SELF_PROFILE_BUSY');
    const revision = context(field), deadline = performance.now() + (field === 'avatar' ? avatarTimeoutMs : timeoutMs);
    let fingerprint = field + ':' + digest(JSON.stringify(value)), invoked = false, nativeReceipt = false, lease = null;
    if (field === 'avatar' && value.startsWith('qqimg_')) budget(field, fingerprint);
    busy = true;
    try {
      const previous = await read(field, revision, deadline);
      context(field, revision);
      if (field !== 'avatar' && JSON.stringify(previous) === JSON.stringify(value)) {
        counts.unchanged++; return { outcome: 'unchanged', submitted: false, confirmed: true, confirmation: 'forced_self_field_read' };
      }
      if (field === 'avatar') {
        const preparation = Promise.resolve().then(() => { context(field, revision); return avatarStager.prepare(value, revision); });
        try { lease = await within(preparation, deadline, true, true); }
        catch (error) {
          preparation.then(release, () => {});
          if (!['AVATAR_BACKUP_UNAVAILABLE','SELF_PROFILE_TIMEOUT'].includes(error?.code)) throw fail('SELF_PROFILE_AVATAR_UNAVAILABLE');
          // 此分支尚未创建mutation，更没有调用setter；和提交后unknown严格分开。
          return { outcome: 'not_submitted', submitted: false, confirmed: false,
            reason: error?.code === 'AVATAR_BACKUP_UNAVAILABLE' ? 'AVATAR_BACKUP_UNAVAILABLE' : 'AVATAR_PREPARATION_UNAVAILABLE' };
        }
        if (!lease || typeof own(lease, 'path') !== 'string' || !path.isAbsolute(lease.path)
            || typeof own(lease, 'sha256') !== 'string' || !/^[a-f0-9]{64}$/.test(lease.sha256)
            || typeof own(lease, 'release') !== 'function') throw fail('SELF_PROFILE_AVATAR_UNAVAILABLE');
        fingerprint = field + ':' + lease.sha256;
      }
      const restoration = field === 'avatar' && value.startsWith('qqavatar_') && lease?.restoration === true && typeof lease.commit === 'function';
      if (field === 'avatar' && value.startsWith('qqavatar_') && !restoration) throw fail('SELF_PROFILE_AVATAR_UNAVAILABLE');
      context(field, revision); budget(field, fingerprint, restoration);
      const avatarBackupId = field === 'avatar' && /^qqavatar_[a-f0-9]{32}$/.test(lease?.backupId ?? '') ? lease.backupId : null;
      const avatarPath = lease?.path;
      const commitRestoration = restoration ? lease.commit : null;
      let releaseAfterReceipt = false;
      const mutation = Promise.resolve().then(async () => {
        if (restoration) await commitRestoration();
        context(field, revision);
        if (performance.now() >= deadline) throw fail('SELF_PROFILE_TIMEOUT');
        // 原生提交前才消耗预算；每次只写一个字段，不复制其它未修改资料。
        budget(field, fingerprint, restoration); recent.set(field, now()); hashes.add(fingerprint); dayAttempts++; counts.attempts++;
        invoked = true; nativePending++;
        return nativeMethod(service, methods[field])(...(field === 'birthday' ? [value.year, value.month, value.day]
          : [field === 'avatar' ? avatarPath : value]));
      }).then(result => {
        releaseAfterReceipt = Number.isSafeInteger(own(result, 'result'));
        return result;
      });
      // 原生调用超时后可能仍在读取头像文件；保留租约到原始调用结算，不能提前删文件。
      const heldLease = lease; lease = null;
      if (heldLease) retainedLeases.add(heldLease);
      const settled = mutation.finally(async () => {
        if (invoked) nativePending--;
        // void/throw没有合法原生完成回执，可能仍在后台读文件；只在确认引擎退出后清理。
        if ((!invoked || releaseAfterReceipt || sessionExitVerified) && (!heldLease || retainedLeases.has(heldLease))) {
          await release(heldLease); retainedLeases.delete(heldLease);
        }
      });
      settled.catch(() => {});
      try {
        const result = await within(settled, deadline);
        nativeReceipt = own(result, 'result') === 0;
        if (Number.isSafeInteger(own(result, 'result')) && own(result, 'result') !== 0) {
          counts.rejected++; return { outcome: 'rejected', submitted: true, confirmed: false };
        }
        if (field === 'avatar') {
          if (nativeReceipt) { counts.accepted++; return { outcome: 'accepted', submitted: true, confirmed: false,
            ...(avatarBackupId ? { backupId: avatarBackupId, restoration,
              ...(restoration && /^qqavatar_[a-f0-9]{32}$/.test(heldLease?.restoredFrom ?? '') ? { restoredFrom: heldLease.restoredFrom } : {}) } : {}) }; }
        } else {
          const observed = await read(field, revision, deadline);
          context(field, revision);
          if (JSON.stringify(observed) === JSON.stringify(value)) {
            counts.observed++; return { outcome: 'observed', submitted: true, confirmed: true,
              confirmation: 'forced_self_field_read', nativeReceipt };
          }
        }
      } catch { if (!invoked) throw fail('SELF_PROFILE_NOT_ALLOWED'); }
      uncertain = true;
      if (nativeReceipt) { counts.accepted++; return { outcome: 'accepted', submitted: true, confirmed: false }; }
      counts.unknown++; return { outcome: 'unknown', submitted: true, confirmed: false };
    } finally { await release(lease); busy = false; }
  }
  function stop() {
    if (stopTask) return stopTask;
    state = 'closed'; pendingRead?.reject(fail('SELF_PROFILE_NOT_ALLOWED'));
    for (const cancel of [...waits]) cancel();
    stopTask = (async () => {
      if (service && isNativeListenerHandle(listenerHandle)) {
        const handle = listenerHandle; listenerHandle = null;
        try {
          await within(Promise.resolve().then(() => nativeMethod(service, 'removeKernelProfileListener')(handle)),
            performance.now() + timeoutMs, false); removalVerified = true;
        } catch { removalVerified = false; }
      }
      return snapshot();
    })(); return stopTask;
  }
  async function releaseAfterSessionExit() {
    let verified = false;
    try { verified = isSessionExited() === true; } catch {}
    if (state !== 'closed' || !verified) throw fail('SELF_PROFILE_EXIT_UNVERIFIED');
    sessionExitVerified = true;
    for (const lease of [...retainedLeases]) { await release(lease); retainedLeases.delete(lease); }
    return snapshot();
  }
  function snapshot() {
    return { state, permissions, busy, uncertain, ...counts, dayAttempts, nativePending,
      retainedAvatarLeases: retainedLeases.size, sessionExitVerified, countersPersistAcrossRestart: false, removalVerified,
      listenerHandleKind: listenerHandle === undefined ? 'unobserved' : listenerHandle === null ? 'null' : typeof listenerHandle,
      cleanupRequired: !!service && !removalVerified || nativePending > 0 && !sessionExitVerified
        || retainedLeases.size > 0 || counts.releaseFailures > 0 };
  }
  return Object.freeze({ start, configure, execute, readField, stop, releaseAfterSessionExit, snapshot });
}
