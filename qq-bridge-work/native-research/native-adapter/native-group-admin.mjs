import { performance } from 'node:perf_hooks';
import { nativeMethod, isNativeListenerHandle } from './manual-login.mjs';

const own = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
const id = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const uid = value => typeof value === 'string' && /^u_[A-Za-z0-9_-]{1,128}$/.test(value);
const refused = code => Object.assign(new Error(code), { code });
const keys = ['atAll', 'mute', 'kick'];

/**
 * 校验三个互不隐式开启的群管理许可；本模块不授予群范围、账号或模型权限。
 * @param {object} value atAll/mute/kick布尔值，省略项为false。
 * @returns {object} 冻结副本；未知字段、访问器和非布尔值抛GROUP_ADMIN_SETTINGS_INVALID。
 * @note 纯函数，无I/O；不会因拥有QQ管理员身份而自动开启任何许可。
 */
export function normalizeGroupAdminPermissions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !keys.includes(key))) throw refused('GROUP_ADMIN_SETTINGS_INVALID');
  return Object.freeze(Object.fromEntries(keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && (typeof descriptor.value !== 'boolean')) throw refused('GROUP_ADMIN_SETTINGS_INVALID');
    return [key, descriptor?.value ?? false];
  })));
}

/**
 * 构造固定QQ版本的群管理适配器；构造不会加载QQ或注册监听，须显式start。
 * @param {object} options session/self来自所属已登录会话；self为{uin,uid}。
 *   authorize(action,group,user)须同步重验在线、独立许可、群范围及已观察目标，
 *   返回非空上下文版本字符串；撤权/掉线/角色变化须改变该值或返回null。
 *   resolveMember(group,user)只能解析本次已观察且无冲突的{uin,uid}，不可按昵称推断。
 * @returns {object} start/checkAtAll/execute/stop/snapshot；不暴露成员资料或原生错误正文。
 * @note 单JS线程，最多一个操作；强制读取自身及目标身份后再提交。result=0只表示原生接收，
 *   不表示实际生效；仅禁言远端定向回传的截止状态相符才报confirmed，未取得仍为accepted。
 *   execute可接受主桥接签发的operationId来区分新一轮指令；同号去重，省略时兼容旧去重。
 *   无回执/异常/超时为unknown并熔断。无自动重试，不执行真实账号验收。
 */
export function createNativeGroupAdmin({ session, self, permissions: input, authorize, resolveMember,
  timeoutMs = 3000, now = Date.now }) {
  let permissions = normalizeGroupAdminPermissions(input);
  const identity = { uin: own(self, 'uin'), uid: own(self, 'uid') };
  if (!id(identity.uin) || !uid(identity.uid) || typeof authorize !== 'function'
      || typeof resolveMember !== 'function' || typeof now !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000) throw refused('GROUP_ADMIN_OPTIONS_INVALID');
  let state = 'idle', service, listenerHandle, removalVerified = false, waiting = null, busy = false, uncertain = false;
  let listenerAttempted = false;
  let attempts = 0, accepted = 0, rejected = 0, unknown = 0, highWater = 0, confirmed = 0, confirmationQueriesEnabled = true;
  const submitted = new Set();
  const listener = new Proxy({ onMemberInfoChange(group, source, members) {
    const pending = waiting;
    if (!pending || pending.group !== group || !(members instanceof Map) || pending.remoteOnly && source !== 1) return;
    for (const expected of pending.expected) {
      if (!members.has(expected.uid)) continue;
      const raw = members.get(expected.uid), role = own(raw, 'role');
      if (own(raw, 'uid') !== expected.uid || own(raw, 'uin') !== expected.uin
          || own(raw, 'isDelete') !== false || ![2, 3, 4].includes(role)) {
        pending.reject(refused('GROUP_ADMIN_MEMBER_UNVERIFIED')); return;
      }
      const mutedUntil = own(raw, 'shutUpTime');
      pending.found.set(expected.uid, { role, ...(Number.isSafeInteger(mutedUntil) && mutedUntil >= 0 ? { mutedUntil } : {}), source });
    }
    if (pending.found.size === pending.expected.length) pending.resolve(pending.found);
  } }, { get(target, key) { return Object.hasOwn(target, key) ? target[key]
    : typeof key === 'string' && /^on[A-Za-z]/.test(key) ? () => {} : undefined; } });
  function context(action, group, user, expected) {
    const clock = now();
    if (!Number.isSafeInteger(clock) || clock < highWater) throw refused('GROUP_ADMIN_CLOCK_INVALID');
    highWater = clock;
    if (state !== 'active' || uncertain || !permissions[action] || !id(group)
        || (user !== null && !id(user))) throw refused('GROUP_ADMIN_NOT_ALLOWED');
    let value;
    try { value = authorize(action, group, user); } catch { throw refused('GROUP_ADMIN_NOT_ALLOWED'); }
    if (typeof value !== 'string' || !value || value.length > 256 || (expected !== undefined && expected !== value)) {
      throw refused('GROUP_ADMIN_NOT_ALLOWED');
    }
    return value;
  }
  async function within(promise, deadline) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(refused('GROUP_ADMIN_TIMEOUT')), Math.max(1, deadline - performance.now()));
      })]);
    } finally { clearTimeout(timer); }
  }
  async function members(group, expected, deadline, remoteOnly = false) {
    let resolve, reject;
    const event = new Promise((yes, no) => { resolve = yes; reject = no; });
    // 先注册本次关联，再调用；仅收集指定UID，不枚举或缓存全群。
    waiting = { group, expected, found: new Map(), resolve, reject, remoteOnly };
    // 防止原生调用先失败时，已到达事件的拒绝成为未处理Promise。
    event.catch(() => {});
    try {
      const result = await within(Promise.resolve().then(() => nativeMethod(service, 'getMemberInfo')(
        group, expected.map(member => member.uid), true)), deadline);
      if (own(result, 'result') !== 0) throw refused('GROUP_ADMIN_MEMBER_UNVERIFIED');
      return await within(event, deadline);
    } catch (error) {
      throw refused(error?.code === 'GROUP_ADMIN_TIMEOUT' ? 'GROUP_ADMIN_TIMEOUT' : 'GROUP_ADMIN_MEMBER_UNVERIFIED');
    } finally { waiting = null; }
  }
  function preparePermissions(next) {
      if (Object.values(next).some(Boolean)) {
        service ??= nativeMethod(session, 'getGroupService')();
        for (const method of ['addKernelGroupListener', 'removeKernelGroupListener', 'getMemberInfo',
          ...(next.atAll ? ['getGroupRemainAtTimes'] : []), ...(next.mute ? ['setMemberShutUp'] : []),
          ...(next.kick ? ['kickMember'] : [])]) nativeMethod(service, method);
        if (listenerHandle === undefined) {
          if (listenerAttempted) throw refused('GROUP_ADMIN_LISTENER_UNVERIFIED');
          listenerAttempted = true;
          listenerHandle = nativeMethod(service, 'addKernelGroupListener')(listener);
        }
        if (!isNativeListenerHandle(listenerHandle)) throw refused('GROUP_ADMIN_LISTENER_UNVERIFIED');
      }
  }
  /** 热改独立许可，保留未知锁、已提交去重和计数。@param {object} value 新许可。@returns {void} 失败拒绝。 */
  function configure(value) {
    if (state !== 'active') throw refused('GROUP_ADMIN_STATE_INVALID');
    const next = normalizeGroupAdminPermissions(value); preparePermissions(next); permissions = next;
  }
  function start() {
    if (state !== 'idle') throw refused('GROUP_ADMIN_STATE_INVALID');
    try {
      preparePermissions(permissions);
      state = 'active'; return snapshot();
    } catch { state = 'closed'; throw refused('GROUP_ADMIN_UNAVAILABLE'); }
  }
  async function checkAtAll(group) {
    if (busy) throw refused('GROUP_ADMIN_BUSY');
    const revision = context('atAll', group, null), deadline = performance.now() + timeoutMs;
    busy = true;
    try {
      const found = await members(group, [identity], deadline);
      if (found.get(identity.uid).role < 3) throw refused('GROUP_ADMIN_ROLE_REFUSED');
      context('atAll', group, null, revision);
      const result = await within(Promise.resolve().then(() => nativeMethod(service, 'getGroupRemainAtTimes')(group)), deadline);
      context('atAll', group, null, revision);
      const quota = own(result, 'atInfo');
      // 固定接口返回Omit<GeneralCallResult,'result'>，成功只要求errCode=0；若显式带result则仍拒绝非零/异常值。
      if (own(result, 'errCode') !== 0 || (Object.hasOwn(result ?? {}, 'result') && own(result, 'result') !== 0) || own(quota, 'canAtAll') !== true
          || !['RemainAtAllCountForUin', 'RemainAtAllCountForGroup'].every(key =>
            Number.isSafeInteger(own(quota, key)) && own(quota, key) > 0)) throw refused('GROUP_ADMIN_AT_ALL_REFUSED');
      return { authorized: true, sent: false };
    } catch (error) {
      const codes = ['GROUP_ADMIN_TIMEOUT', 'GROUP_ADMIN_MEMBER_UNVERIFIED', 'GROUP_ADMIN_ROLE_REFUSED',
        'GROUP_ADMIN_NOT_ALLOWED', 'GROUP_ADMIN_CLOCK_INVALID', 'GROUP_ADMIN_AT_ALL_REFUSED'];
      throw refused(codes.includes(error?.code) ? error.code : 'GROUP_ADMIN_UNAVAILABLE');
    } finally { busy = false; }
  }
  async function execute(request) {
    const action = own(request, 'action'), group = own(request, 'group'), user = own(request, 'user');
    const duration = own(request, 'duration'), operationId = own(request, 'operationId');
    if (!request || typeof request !== 'object' || Array.isArray(request) || !['mute', 'kick'].includes(action)
        || Object.keys(request).some(key => !['action', 'group', 'user', 'operationId', ...(action === 'mute' ? ['duration'] : [])].includes(key))
        || Object.hasOwn(request ?? {}, 'operationId') && (typeof operationId !== 'string' || !/^[a-f0-9]{64}$/.test(operationId))
        || (action === 'mute' && (!Number.isSafeInteger(duration) || duration < 0 || duration > 30 * 86400))) {
      throw refused('GROUP_ADMIN_REQUEST_INVALID');
    }
    if (busy) throw refused('GROUP_ADMIN_BUSY');
    const revision = context(action, group, user), deadline = performance.now() + timeoutMs;
    // 新一轮显式资格有独立操作号；同一次资格仍不可重放，旧调用保留原去重语义。
    const operationKey = (action === 'mute' && duration === 0 ? 'unmute' : action) + ':' + group + ':' + user + (operationId ? ':' + operationId : '');
    if (user === identity.uin || submitted.has(operationKey)
        || attempts >= 50) throw refused('GROUP_ADMIN_REPEAT_REFUSED');
    let target;
    try { const member = resolveMember(group, user); target = { uin: own(member, 'uin'), uid: own(member, 'uid') }; }
    catch { throw refused('GROUP_ADMIN_MEMBER_UNVERIFIED'); }
    if (target.uin !== user || !uid(target.uid) || target.uid === identity.uid) throw refused('GROUP_ADMIN_MEMBER_UNVERIFIED');
    busy = true;
    try {
      const found = await members(group, [identity, target], deadline);
      const ownRole = found.get(identity.uid).role, targetRole = found.get(target.uid).role;
      if (ownRole < 3 || targetRole >= ownRole) throw refused('GROUP_ADMIN_ROLE_REFUSED');
      context(action, group, user, revision);
      // 不跨异步间隙信任旧UID映射。
      let current;
      try { current = resolveMember(group, user); } catch { throw refused('GROUP_ADMIN_MEMBER_UNVERIFIED'); }
      if (own(current, 'uin') !== user || own(current, 'uid') !== target.uid) throw refused('GROUP_ADMIN_MEMBER_UNVERIFIED');
      const invoke = nativeMethod(service, action === 'mute' ? 'setMemberShutUp' : 'kickMember');
      let invoked = false;
      try {
        const result = await within(Promise.resolve().then(() => {
          context(action, group, user, revision);
          if (performance.now() >= deadline) throw refused('GROUP_ADMIN_TIMEOUT');
          submitted.add(operationKey); attempts++; invoked = true;
          return action === 'mute' ? invoke(group, [{ uid: target.uid, timeStamp: duration }])
            : invoke(group, [target.uid], false, '');
        }), deadline);
        if (own(result, 'result') === 0) {
          if (action === 'mute' && confirmationQueriesEnabled && Number.isSafeInteger(found.get(target.uid).mutedUntil)) {
            try {
              context(action, group, user, revision);
              const after = await members(group, [target], deadline, true); context(action, group, user, revision);
              const until = after.get(target.uid)?.mutedUntil, currentSeconds = Math.floor(now() / 1000);
              const matches = duration === 0 ? until === 0 : Number.isSafeInteger(until) && until > currentSeconds
                && Math.abs(until - (currentSeconds + duration)) <= 5;
              if (matches) { accepted++; confirmed++; return { outcome: 'confirmed', submitted: true, confirmed: true,
                confirmation: 'forced_remote_group_member_read' }; }
            } catch { confirmationQueriesEnabled = false; }
          }
          accepted++; return { outcome: 'accepted', submitted: true, confirmed: false };
        }
        if (Number.isSafeInteger(own(result, 'result')) && own(result, 'result') !== 0) {
          rejected++; return { outcome: 'rejected', submitted: true, confirmed: false };
        }
      } catch {
        if (!invoked) throw refused('GROUP_ADMIN_NOT_ALLOWED');
        // 已交给原生的方法没有可核验回执；不传播错误文本，不自动重试。
      }
      uncertain = true; unknown++; return { outcome: 'unknown', submitted: true, confirmed: false };
    } finally { busy = false; }
  }
  async function stop() {
    state = 'closed'; waiting?.reject(refused('GROUP_ADMIN_NOT_ALLOWED'));
    if (service && isNativeListenerHandle(listenerHandle)) {
      const handle = listenerHandle; listenerHandle = null;
      try {
        await within(Promise.resolve().then(() => nativeMethod(service, 'removeKernelGroupListener')(handle)),
          performance.now() + timeoutMs);
        removalVerified = true;
      }
      catch { removalVerified = false; }
    }
    return snapshot();
  }
  function snapshot() {
    return { state, permissions, busy, uncertain, attempts, accepted, rejected, unknown, confirmed, confirmationQueriesEnabled, removalVerified,
      listenerHandleKind: listenerHandle === undefined ? 'unobserved' : listenerHandle === null ? 'null' : typeof listenerHandle,
      cleanupRequired: !!service && !removalVerified };
  }
  return { start, configure, checkAtAll, execute, stop, snapshot };
}
