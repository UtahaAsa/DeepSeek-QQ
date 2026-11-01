import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { nativeMethod, isNativeListenerHandle } from './manual-login.mjs';

const own = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
const validUid = value => typeof value === 'string' && /^u_[A-Za-z0-9_-]{1,128}$/.test(value);
const refused = code => Object.assign(new Error(code), { code });
const text = (value, limit) => typeof value === 'string' ? Array.from(value
  .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim()).slice(0, limit).join('') : '';

/**
 * 好友申请接收/自动通过的独立许可；主动添加群成员不属于本模块。
 * @param {object} value receiveRequests和autoAccept严格布尔；省略为false。
 * @returns {object} 冻结副本，自动通过依赖接收；非法值抛FRIEND_REQUEST_SETTINGS_INVALID。
 * @note 无I/O；自动通过意味着所有通过本次会话及外层范围检查的普通新申请，疑似/历史申请不处理。
 */
export function normalizeFriendRequestPermissions(value = {}) {
  const names = ['receiveRequests', 'autoAccept'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !names.includes(key))) throw refused('FRIEND_REQUEST_SETTINGS_INVALID');
  const result = Object.fromEntries(names.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && typeof descriptor.value !== 'boolean') throw refused('FRIEND_REQUEST_SETTINGS_INVALID');
    return [key, descriptor?.value ?? false];
  }));
  if (result.autoAccept && !result.receiveRequests) throw refused('FRIEND_REQUEST_SETTINGS_INVALID');
  return Object.freeze(result);
}

/**
 * 构造当前账号的普通新好友申请控制器；构造无I/O，显式start才注册所属监听。
 * @param {object} options session为所属已登录会话；authorize(action,friendUid)须同步核验
 *   receive/accept独立许可、在线实例和请求范围，返回一致的上下文版本或null；不写日志。
 *   timeoutMs为审批默认3秒，lookupTimeoutMs为通知读取默认5秒；now仅供隔离时钟，不读好友列表/票据/数据库。
 * @returns {object} start/pending/inspectTarget/approveInspected/stop/snapshot；核对不审批，显式审批只接受内存短期资格。
 * @note 单JS线程、一个审批，最多128条去重记录及50次提交，内存重启清零；申请十分钟过期。
 *   未读事件只引导有界读取当前通知列表，历史申请不自动处理；approvalFriendRequest返回void不等于通过。
 *   审批须同UID/原请求时间的决定事件；未知结果熔断不重试。读取无法关联时也停止自动审批，结构诊断无个人正文。
 */
export function createNativeFriendRequests({ session, permissions: input, authorize, timeoutMs = 3000, lookupTimeoutMs = 5000, now = Date.now }) {
  let permissions = normalizeFriendRequestPermissions(input);
  if (typeof authorize !== 'function' || typeof now !== 'function' || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 10 || timeoutMs > 10000 || !Number.isSafeInteger(lookupTimeoutMs)
      || lookupTimeoutMs < 10 || lookupTimeoutMs > 15000) throw refused('FRIEND_REQUEST_OPTIONS_INVALID');
  let state = 'idle', service, handle, startedAt, highWater = 0, reversed = false, waiting = null;
  let listenerAttempted = false;
  let busy = false, uncertain = false, removalVerified = false, attempts = 0, approved = 0, rejected = 0, unknown = 0, friendshipConfirmed = 0;
  let lookup = null, lookupUncertain = false, lastLookupAt = -Infinity;
  const diagnostics = { requestCallbacks: 0, unreadCallbacks: 0, doubtCallbacks: 0, invalidPayloads: 0,
    rows: 0, lookupAttempts: 0, lookupFailures: 0, lastShapes: [], filtered: {} };
  const requests = new Map(), seen = new Set(), reviews = new Map();
  function buddyState(uid) {
    try {
      const value = nativeMethod(service, 'isBuddy')(uid);
      if (value instanceof Promise) value.catch(() => {});
      return value === true ? 'friend' : value === false ? 'not_friend' : 'unverified';
    } catch { return 'unverified'; }
  }
  function clock() {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || time < highWater) reversed = true;
    highWater = Math.max(highWater, time); return time;
  }
  function context(action, friendUid, expected) {
    clock();
    if (state !== 'active' || reversed || uncertain || !permissions.receiveRequests
        || (action === 'accept' && (!permissions.autoAccept || lookupUncertain))) throw refused('FRIEND_REQUEST_NOT_ALLOWED');
    let revision;
    try { revision = authorize(action, friendUid); } catch { throw refused('FRIEND_REQUEST_NOT_ALLOWED'); }
    if (typeof revision !== 'string' || !revision || revision.length > 256
        || (expected !== undefined && revision !== expected)) throw refused('FRIEND_REQUEST_NOT_ALLOWED');
    return revision;
  }
  function decide(raw) {
    if (!waiting || !waiting.invoked || own(raw, 'friendUid') !== waiting.entry.friendUid
        || own(raw, 'reqTime') !== waiting.entry.reqTime || own(raw, 'isDecide') !== true) return;
    const kind = own(raw, 'reqType');
    if ([2, 3].includes(kind) && own(raw, 'isAgreed') === true) {
      waiting.resolve({ outcome: 'approved', friendshipConfirmed: kind === 3 && buddyState(waiting.entry.friendUid) === 'friend' });
    } else if (kind === 7 && own(raw, 'isAgreed') === false) {
      waiting.resolve({ outcome: 'rejected', friendshipConfirmed: false });
    }
  }
  function reasonFor(raw, time, explicitReview = false) {
    const uid = own(raw, 'friendUid'), stamp = own(raw, 'reqTime'), kind = own(raw, 'reqType');
    if (!validUid(uid)) return 'invalid_subject';
    if (typeof stamp !== 'string' || !/^[1-9]\d{0,12}$/.test(stamp)) return 'invalid_time';
    // 固定上游也处理类型13；只在明确非主动方且未读时兼容，不能审批自己的发起记录。
    const ordinary = kind === 1 && own(raw, 'isDecide') === false;
    const peerConfirmation = kind === 13 && own(raw, 'isInitiator') === false && own(raw, 'isUnread') === true
      && typeof own(raw, 'isDecide') === 'boolean';
    if (!ordinary && !peerConfirmation) return 'not_incoming_request';
    if (!['isInitiator', 'isDoubt', 'isAgreed'].every(key => own(raw, key) === undefined || own(raw, key) === false)) return 'disallowed_flags';
    if (own(raw, 'isBuddy') === true) return 'already_friend_reported';
    if (explicitReview && own(raw, 'isInitiator') !== false) return 'recipient_not_verified';
    if (!explicitReview && Number(stamp) * 1000 < Math.floor(startedAt / 1000) * 1000) return 'before_session';
    if (Number(stamp) * 1000 > time + 5000) return 'future';
    if (!explicitReview && time - Number(stamp) * 1000 >= 600000) return 'expired';
    return null;
  }
  function shape(raw, time) {
    const type = own(raw, 'reqType'), stamp = own(raw, 'reqTime');
    const result = { reqType: Number.isSafeInteger(type) && type >= 0 && type <= 255 ? type : null,
      reqTimeType: typeof stamp, filteredReason: reasonFor(raw, time),
      isBuddyType: own(raw, 'isBuddy') === null ? 'null' : typeof own(raw, 'isBuddy') };
    for (const name of ['isDecide','isInitiator','isUnread','isDoubt','isBuddy','isAgreed']) {
      const value = own(raw, name); result[name] = typeof value === 'boolean' ? value : value === undefined ? 'absent' : 'invalid';
    }
    return result;
  }
  const listener = new Proxy({ onBuddyReqChange(payload) {
    diagnostics.requestCallbacks++;
    const rows = own(payload, 'buddyReqs');
    if (!Array.isArray(rows) || rows.length > 128) { diagnostics.invalidPayloads++; return; }
    if (state !== 'active' || !permissions.receiveRequests) return;
    const time = clock();
    if (reversed) return;
    diagnostics.rows += rows.length; diagnostics.lastShapes = rows.slice(0, 4).map(raw => shape(raw, time));
    const reading = lookup; let inspected = null, review = null, rowIndex = -1;
    for (const raw of rows) {
      rowIndex++;
      decide(raw);
      const friendUid = own(raw, 'friendUid'), reqTime = own(raw, 'reqTime');
      let reason = reasonFor(raw, time), revision;
      if (reading?.readOnly) {
        if (friendUid === reading.friendUid) {
          inspected = shape(raw, time); inspected.nativeFriendState = buddyState(friendUid);
          if (!reason && inspected.nativeFriendState !== 'not_friend') inspected.filteredReason = 'friend_state_' + inspected.nativeFriendState;
          for (const [id, item] of reviews) if (item.expiresAt <= time) reviews.delete(id);
          if (!reasonFor(raw, time, true) && inspected.nativeFriendState === 'not_friend' && reviews.size < 16) {
            try {
              const revision = context('receive', friendUid, reading.revision), id = 'qqreq_' + randomBytes(24).toString('hex');
              const expiresAt = time + 600000;
              reviews.set(id, { friendUid, reqTime, revision, expiresAt, status: 'pending', nickname: '', comment: '' });
              review = { reviewId: id, reviewExpiresAt: expiresAt, requiresExplicitApproval: true };
            } catch {}
          }
        }
        if (reason) diagnostics.filtered[reason] = (diagnostics.filtered[reason] ?? 0) + 1;
        continue;
      }
      if (!reason) {
        try { revision = context('receive', friendUid); } catch { reason = 'scope_not_allowed'; }
      }
      if (!reason) {
        const relation = buddyState(friendUid);
        if (diagnostics.lastShapes[rowIndex]) diagnostics.lastShapes[rowIndex].nativeFriendState = relation;
        if (relation !== 'not_friend') reason = 'friend_state_' + relation;
      }
      if (reason) diagnostics.filtered[reason] = (diagnostics.filtered[reason] ?? 0) + 1;
      if (reason) continue;
      const fingerprint = friendUid + ':' + reqTime;
      if (seen.has(fingerprint) || seen.size >= 128) continue;
      seen.add(fingerprint);
      requests.set('qqreq_' + randomBytes(24).toString('hex'), { friendUid, reqTime, revision,
        nickname: text(own(raw, 'friendNick'), 128), comment: text(own(raw, 'extWords'), 280),
        expiresAt: Number(reqTime) * 1000 + 600000, status: 'pending' });
    }
    reading?.resolve({ eventReceived: true, found: !!inspected, ...(inspected ? { request: inspected } : {}),
      ...(review ?? {}), source: 'bounded_buddy_request_event_after_refresh', approvalSubmitted: false });
    if (!reading?.readOnly && permissions.autoAccept) queueMicrotask(drain);
  }, onBuddyReqUnreadCntChange(value) {
    diagnostics.unreadCallbacks++;
    if (state !== 'active' || !permissions.receiveRequests || typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)
        || lookup || busy || lookupUncertain || clock() - lastLookupAt < 2000) return;
    queueMicrotask(() => { void refresh().catch(() => {}); });
  }, onDoubtBuddyReqChange() {
    // 疑似申请只记数量，不读正文、票据或自动审批。
    diagnostics.doubtCallbacks++;
  } }, { get(target, key) { return Object.hasOwn(target, key) ? target[key]
    : typeof key === 'string' && /^on[A-Za-z]/.test(key) ? () => {} : undefined; } });
  async function within(promise, deadline) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(refused('FRIEND_REQUEST_TIMEOUT')), Math.max(1, deadline - performance.now()));
      })]);
    } finally { clearTimeout(timer); }
  }
  async function refresh(friendUid = null) {
    if (friendUid !== null && !validUid(friendUid)) throw refused('FRIEND_REQUEST_NOT_ALLOWED');
    if (lookup || busy || diagnostics.lookupAttempts >= 64) throw refused('FRIEND_REQUEST_LOOKUP_BUSY');
    const revision = context('receive', friendUid), deadline = performance.now() + lookupTimeoutMs;
    let resolve, reject;
    const event = new Promise((yes, no) => { resolve = yes; reject = no; }); event.catch(() => {});
    const operation = { friendUid, revision, readOnly: friendUid !== null, resolve, reject }; lookup = operation;
    diagnostics.lookupAttempts++; lastLookupAt = clock();
    try {
      const results = await within(Promise.all([Promise.resolve().then(() => {
        context('receive', friendUid, revision); return nativeMethod(service, 'getBuddyReq')();
      }), event]), deadline);
      context('receive', friendUid, revision); return results[1];
    } catch {
      // 通知没有查询编号；关联失败后禁止自动审批，避免晚到查询结果混成新申请。
      lookupUncertain = true; diagnostics.lookupFailures++; throw refused('FRIEND_REQUEST_LOOKUP_UNCONFIRMED');
    } finally { if (lookup === operation) lookup = null; }
  }
  async function drain() {
    if (busy || state !== 'active' || uncertain || !permissions.autoAccept) return;
    const time = clock();
    for (const entry of requests.values()) {
      if (entry.status === 'pending' && entry.expiresAt <= time) entry.status = 'expired';
    }
    const entry = [...requests.values()].find(value => value.status === 'pending');
    if (!entry) return;
    try { context('accept', entry.friendUid, entry.revision); }
    catch { entry.status = 'refused'; queueMicrotask(drain); return; }
    if (attempts >= 50) {
      for (const value of requests.values()) if (value.status === 'pending') value.status = 'limited';
      return;
    }
    await submitEntry(entry);
  }
  async function submitEntry(entry) {
    busy = true;
    const deadline = performance.now() + timeoutMs;
    let resolve, reject;
    const event = new Promise((yes, no) => { resolve = yes; reject = no; }); event.catch(() => {});
    const operation = { entry, resolve, reject, invoked: false }; waiting = operation;
    try {
      // 返回void不作为成功；预先挂好决定事件，支持同步回调，但无重复提交。
      const result = await within(Promise.resolve().then(() => {
        context('accept', entry.friendUid, entry.revision);
        if (clock() >= entry.expiresAt || performance.now() >= deadline) throw refused('FRIEND_REQUEST_NOT_ALLOWED');
        entry.status = 'submitted'; entry.invoked = true; attempts++; operation.invoked = true;
        return nativeMethod(service, 'approvalFriendRequest')({ friendUid: entry.friendUid, reqTime: entry.reqTime, accept: true });
      }), deadline);
      if (own(result, 'result') !== undefined && own(result, 'result') !== 0) throw refused('FRIEND_REQUEST_UNCONFIRMED');
      const decision = await within(event, deadline);
      entry.status = decision.outcome; entry.friendshipConfirmed = decision.friendshipConfirmed;
      if (decision.outcome === 'approved') { approved++; if (decision.friendshipConfirmed) friendshipConfirmed++; } else rejected++;
    } catch {
      if (operation.invoked) { entry.status = 'unknown'; uncertain = true; unknown++; }
      else entry.status = 'refused';
    } finally {
      waiting = null; busy = false;
      if (state === 'active' && !uncertain) queueMicrotask(drain);
    }
  }
  /**
   * 本机操作员明确批准后，提交刚刚只读核对过的指定申请；不接受UID或任意请求时间。
   * @param {string} reviewId inspectTarget生成的十分钟一次性资格，调用方不得自动批准历史申请。
   * @returns {Promise<object>} 匹配决定事件才确认审批；好友关系由独立原生缓存复核，不把void当成功。
   * @throws {Error} 撤权、过期、已提交或未知锁时拒绝；共享50次预算，不自动重试。
   */
  async function approveInspected(reviewId) {
    if (busy || lookup || !/^qqreq_[a-f0-9]{48}$/.test(reviewId ?? '')) throw refused('FRIEND_REQUEST_REVIEW_NOT_ALLOWED');
    const entry = reviews.get(reviewId), time = clock();
    if (!entry || entry.expiresAt <= time || attempts >= 50 || seen.size >= 128) throw refused('FRIEND_REQUEST_REVIEW_NOT_ALLOWED');
    context('accept', entry.friendUid, entry.revision);
    if (buddyState(entry.friendUid) !== 'not_friend') throw refused('FRIEND_REQUEST_REVIEW_NOT_ALLOWED');
    const fingerprint = entry.friendUid + ':' + entry.reqTime;
    if (seen.has(fingerprint)) throw refused('FRIEND_REQUEST_ALREADY_SUBMITTED');
    reviews.delete(reviewId); seen.add(fingerprint); requests.set(reviewId, entry);
    await submitEntry(entry);
    return { outcome: entry.status, submitted: entry.invoked === true,
      approvalConfirmed: entry.status === 'approved', friendshipConfirmed: entry.friendshipConfirmed === true };
  }
  function preparePermissions(next) {
      if (next.receiveRequests) {
        service ??= nativeMethod(session, 'getBuddyService')();
        for (const name of ['addKernelBuddyListener', 'removeKernelBuddyListener',
          ...(next.autoAccept ? ['approvalFriendRequest'] : [])]) nativeMethod(service, name);
        if (handle === undefined) {
          if (listenerAttempted) throw refused('FRIEND_REQUEST_LISTENER_UNVERIFIED');
          listenerAttempted = true;
          handle = nativeMethod(service, 'addKernelBuddyListener')(listener);
        }
        if (!isNativeListenerHandle(handle)) throw refused('FRIEND_REQUEST_LISTENER_UNVERIFIED');
      }
  }
  /** 热改新申请许可，废弃旧待处理资格，保留已见去重、提交计数及未知锁。@param {object} value 新许可。@returns {void} 失败拒绝。 */
  function configure(value) {
    if (state !== 'active') throw refused('FRIEND_REQUEST_STATE_INVALID');
    const next = normalizeFriendRequestPermissions(value); preparePermissions(next);
    permissions = next; requests.clear(); reviews.clear(); startedAt = clock();
    lookup?.reject(refused('FRIEND_REQUEST_NOT_ALLOWED'));
  }
  function start() {
    if (state !== 'idle') throw refused('FRIEND_REQUEST_STATE_INVALID');
    startedAt = clock();
    if (reversed) throw refused('FRIEND_REQUEST_OPTIONS_INVALID');
    try {
      preparePermissions(permissions);
      state = 'active'; return snapshot();
    } catch { state = 'closed'; throw refused('FRIEND_REQUEST_UNAVAILABLE'); }
  }
  function pending() {
    const time = clock(), result = [];
    if (state !== 'active' || reversed) return result;
    for (const [requestId, entry] of requests) {
      if (entry.status !== 'pending' || entry.expiresAt <= time) continue;
      try { context('receive', entry.friendUid, entry.revision); } catch { continue; }
      result.push({ requestId, nickname: entry.nickname, comment: entry.comment, expiresAt: entry.expiresAt });
    }
    return result;
  }
  async function stop() {
    state = 'closed'; waiting?.reject(refused('FRIEND_REQUEST_NOT_ALLOWED')); lookup?.reject(refused('FRIEND_REQUEST_NOT_ALLOWED'));
    reviews.clear();
    for (const entry of requests.values()) { entry.nickname = ''; entry.comment = ''; }
    if (service && isNativeListenerHandle(handle)) {
      const current = handle; handle = null;
      try {
        await within(Promise.resolve().then(() => nativeMethod(service, 'removeKernelBuddyListener')(current)),
          performance.now() + timeoutMs); removalVerified = true;
      } catch { removalVerified = false; }
    }
    return snapshot();
  }
  function snapshot() {
    return { state, permissions, busy, uncertain, observed: seen.size, attempts, approved, rejected, unknown, friendshipConfirmed,
      diagnostics: { ...diagnostics, lastShapes: diagnostics.lastShapes.map(row => ({ ...row })), filtered: { ...diagnostics.filtered }, lookupBusy: !!lookup, lookupUncertain },
      removalVerified, listenerHandleKind: handle === undefined ? 'unobserved' : handle === null ? 'null' : typeof handle,
      cleanupRequired: !!service && !removalVerified };
  }
  return { start, configure, pending, inspectTarget: friendUid => refresh(friendUid), approveInspected, stop, snapshot };
}
