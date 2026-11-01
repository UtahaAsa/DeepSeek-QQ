import { randomBytes } from 'node:crypto';

const own = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
const validRef = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{8,160}$/.test(value);
const validPeer = value => typeof value === 'string' && /^private:[1-9]\d{0,19}$/.test(value);
const fail = code => Object.assign(new Error(code), { code });
const endReasons = new Set(['user_requested', 'conversation_done', 'needs_rest', 'uncomfortable', 'busy',
  'connection_timeout', 'permission_revoked', 'shutdown', 'technical_error']);

/**
 * 单通话控制层。transport 必须由所属原生驱动提供，不能由模型构造。
 * @param {object} options transport.readiness()返回generation/signalingReady/audioReady；
 *   start/accept/end接收所属ref和当前权限代次，只返回accepted/not_submitted/unknown。
 *   policy()返回enabled/revision/autoAnswer；allowsPeer仅检查本机已授权的私聊范围。
 * @returns {object} start/receiveInvite/accept/end/observe/workerExited/reconcile/close/snapshot。
 * @note 不加载QQ、不联网、不写盘。真实接通与结束只由匹配代次/ref的驱动事件确认；
 *   命令返回0或超时不代表终态。所有事件入口仅供所属驱动调用，不能暴露为模型工具。
 */
export function createCallSession({ transport, policy, allowsPeer, clock = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, commandTimeoutMs = 15000, dialTimeoutMs = 45000,
  ringTimeoutMs = 30000, endTimeoutMs = 15000, makeId = () => 'qqcall_' + randomBytes(16).toString('hex') }) {
  if (!transport || !['readiness','start','accept','end'].every(name => typeof transport[name] === 'function')
      || typeof policy !== 'function' || typeof allowsPeer !== 'function'
      || ![commandTimeoutMs,dialTimeoutMs,ringTimeoutMs,endTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0 && value <= 300000))
    throw fail('CALL_CONFIGURATION_INVALID');
  let active = null, last = null, closed = false, closeTask = null;
  const seenInvites = new Map();
  const publicView = call => call ? { callId: call.id, direction: call.direction, phase: call.phase,
    connected: call.phase === 'connected', ended: call.phase === 'ended', confirmed: call.terminalEvidence === 'native_ended',
    connectedMs: call.connectedAt === null ? 0 : Math.max(0, (call.endedAt ?? clock()) - call.connectedAt),
    reason: call.reason, terminalEvidence: call.terminalEvidence,
    lastCommand: call.lastCommand, lastCommandOutcome: call.lastCommandOutcome } : null;
  function readiness() {
    let value;
    try { value = transport.readiness(); } catch { return null; }
    const generation = own(value,'generation');
    return validRef(generation) && own(value,'signalingReady') === true && own(value,'audioReady') === true ? { generation } : null;
  }
  function permission(peerKey) {
    let value;
    try { value = policy(); } catch { throw fail('CALL_NOT_ALLOWED'); }
    const revision = own(value,'revision');
    let allowed = false;
    try { allowed = validPeer(peerKey) && allowsPeer(peerKey) === true; } catch {}
    if (own(value,'enabled') !== true || !Number.isSafeInteger(revision) || revision < 0 || !allowed) throw fail('CALL_NOT_ALLOWED');
    return { revision, autoAnswer: own(value,'autoAnswer') === true };
  }
  function currentLease(peerKey) {
    if (closed) throw fail('CALL_CLOSED');
    const grant = permission(peerKey), ready = readiness();
    if (!ready) throw fail('CALL_UNAVAILABLE');
    return { ...grant, generation: ready.generation };
  }
  function stillAuthorized(call) {
    try { const grant = permission(call.peerKey), ready = readiness();
      return ready?.generation === call.generation && grant.revision === call.revision;
    } catch { return false; }
  }
  function cancelDeadline(call) { if (call.deadline !== null) clearTimer(call.deadline); call.deadline = null; }
  function finish(call, reason, evidence) {
    if (call.phase === 'ended') return;
    cancelDeadline(call); call.phase = 'ended'; call.endedAt = clock(); call.reason = reason; call.terminalEvidence = evidence;
    if (active === call) { active = null; last = call; }
    for (const resolve of call.endWaiters.splice(0)) resolve();
  }
  function schedule(call, delay, action) {
    cancelDeadline(call);
    call.deadline = setTimer(() => {
      call.deadline = null;
      if (active !== call || call.phase === 'ended') return;
      action();
    }, delay);
    call.deadline?.unref?.();
  }
  async function command(call, operation) {
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimer(() => resolve({ outcome: 'unknown' }), commandTimeoutMs);
      timer?.unref?.();
    });
    const request = { ref: call.ref, generation: call.generation, revision: call.revision,
      peerKey: call.peerKey, reason: call.reason };
    // 抛错也可能发生在原生提交之后；只有明确not_submitted才证明没执行。
    const work = Promise.resolve().then(() => {
      if (operation !== 'end' && (closed || active !== call || !stillAuthorized(call)
          || !(['start','accept'].includes(operation))
          || (operation === 'start' && !['dialing','ringing'].includes(call.phase))
          || (operation === 'accept' && call.phase !== 'accepting'))) return { outcome: 'not_submitted' };
      if (operation === 'end' && call.phase === 'ended') return { outcome: 'not_submitted' };
      return transport[operation](request);
    }).catch(() => ({ outcome: 'unknown' }));
    const receipt = await Promise.race([work, timeout]);
    clearTimer(timer);
    const outcome = own(receipt,'outcome');
    return ['accepted','not_submitted','unknown'].includes(outcome) ? outcome : 'unknown';
  }
  function allocate(peerKey, ref, direction, lease, phase) {
    const id = makeId();
    if (typeof id !== 'string' || !/^qqcall_[a-f0-9]{32}$/.test(id)) throw fail('CALL_CONFIGURATION_INVALID');
    return { id, ref, peerKey, direction, generation: lease.generation, revision: lease.revision, phase,
      connectedAt: null, endedAt: null, reason: null, deadline: null, endTask: null,
      lastCommand: null, lastCommandOutcome: null, terminalEvidence: null, endWaiters: [] };
  }
  async function beginEnd(call, reason) {
    if (call.phase === 'ended') return publicView(call);
    if (call.endTask) return call.endTask;
    call.reason = reason; call.phase = 'ending'; cancelDeadline(call);
    call.endTask = (async () => {
      const outcome = await command(call, 'end');
      call.lastCommand = 'end'; call.lastCommandOutcome = outcome;
      if (call.phase !== 'ended') {
        // accepted仅表示挂断请求被受理；不把not_submitted误当已挂断。
        schedule(call, endTimeoutMs, () => { if (call.phase !== 'ended') call.phase = 'end_unconfirmed'; });
      }
      return publicView(call);
    })();
    return call.endTask;
  }
  function timeoutCall(call) { void beginEnd(call, 'connection_timeout').catch(() => {}); }
  async function start(peerKey) {
    const lease = currentLease(peerKey);
    if (active) throw fail('CALL_BUSY');
    const call = allocate(peerKey, 'out_' + randomBytes(16).toString('hex'), 'outgoing', lease, 'dialing');
    active = call;
    schedule(call, dialTimeoutMs, () => timeoutCall(call));
    const outcome = await command(call, 'start');
    call.lastCommand = 'start'; call.lastCommandOutcome = outcome;
    if (call.phase === 'ended') return publicView(call);
    if (active !== call) return publicView(call);
    if (outcome === 'not_submitted') {
      if (call.connectedAt === null) finish(call, 'not_submitted', 'not_submitted');
      else void beginEnd(call, 'technical_error').catch(() => {});
    } else if (outcome === 'unknown' && ['dialing','ringing'].includes(call.phase)) call.phase = 'start_unconfirmed';
    if (!stillAuthorized(call) && call.phase !== 'ended') void beginEnd(call, 'permission_revoked').catch(() => {});
    return publicView(call);
  }
  async function accept(callId) {
    const call = active;
    if (!call || call.id !== callId) throw fail('CALL_STALE');
    if (call.direction !== 'incoming' || call.phase !== 'incoming') throw fail('CALL_STATE_INVALID');
    const lease = currentLease(call.peerKey);
    if (lease.generation !== call.generation || lease.revision !== call.revision) throw fail('CALL_PERMISSION_STALE');
    call.phase = 'accepting';
    const outcome = await command(call, 'accept');
    call.lastCommand = 'accept'; call.lastCommandOutcome = outcome;
    if (call.phase !== 'ended' && outcome === 'unknown' && call.phase === 'accepting') call.phase = 'accept_unconfirmed';
    if (call.phase !== 'ended' && outcome === 'not_submitted') void beginEnd(call, 'technical_error').catch(() => {});
    if (call.phase !== 'ended' && !stillAuthorized(call)) void beginEnd(call, 'permission_revoked').catch(() => {});
    return publicView(call);
  }
  /** 处理所属驱动的新来电；issuedAt必须来自真实接收时间，不得重放历史或模型构造。 */
  async function receiveInvite(event) {
    const peerKey = own(event,'peerKey'), ref = own(event,'ref'), generation = own(event,'generation'), issuedAt = own(event,'issuedAt');
    if (!validRef(ref) || !Number.isSafeInteger(issuedAt) || issuedAt > clock()+2000 || issuedAt < clock()-ringTimeoutMs) return { handled: false };
    let lease;
    try { lease = currentLease(peerKey); } catch { return { handled: false }; }
    if (generation !== lease.generation) return { handled: false };
    const key = generation + ':' + ref;
    if (active?.ref === ref && active.generation === generation) return { handled: true, call: publicView(active) };
    for (const [name, expiry] of seenInvites) if (expiry < clock()) seenInvites.delete(name);
    if (active || seenInvites.has(key) || seenInvites.size >= 256) return { handled: false };
    seenInvites.set(key, issuedAt + ringTimeoutMs);
    const call = allocate(peerKey, ref, 'incoming', lease, 'incoming'); active = call;
    schedule(call, ringTimeoutMs, () => timeoutCall(call));
    if (lease.autoAnswer) {
      try { await accept(call.id); }
      catch { void beginEnd(call, 'permission_revoked').catch(() => {}); }
    }
    return { handled: true, call: publicView(call) };
  }
  async function end(callId, reason) {
    if (!endReasons.has(reason)) throw fail('CALL_REASON_INVALID');
    if (last?.id === callId) return publicView(last);
    if (!active || active.id !== callId) throw fail('CALL_STALE');
    return beginEnd(active, reason);
  }
  /** 只接受已由原生驱动关联本次ref的终态/接通事件；收到回执或观察超时不能代替此事件。 */
  function observe(event) {
    const call = active;
    if (!call || own(event,'generation') !== call.generation || own(event,'ref') !== call.ref) return false;
    const type = own(event,'type');
    if (type === 'ended') { finish(call, call.reason ?? 'peer_ended', 'native_ended'); return true; }
    if (type === 'connected') call.connectedAt ??= clock();
    if (!stillAuthorized(call)) { void beginEnd(call, 'permission_revoked').catch(() => {}); return false; }
    if (type === 'connected') {
      if (['ending','end_unconfirmed'].includes(call.phase)) return true;
      if (call.phase === 'connected') return true;
      if (!['dialing','ringing','start_unconfirmed','accepting','accept_unconfirmed'].includes(call.phase)) return false;
      call.phase = 'connected'; call.connectedAt ??= clock(); cancelDeadline(call); return true;
    }
    if (type === 'ringing' && call.phase === 'dialing') { call.phase = 'ringing'; return true; }
    return false;
  }
  /** 仅供所属子进程真实exit事件调用；不能因PID文件、探测超时或请求错误调用。 */
  function workerExited(generation) {
    if (!active || active.generation !== generation) return false;
    finish(active, 'worker_exited', 'worker_exited'); return true;
  }
  function reconcile() {
    if (active && !stillAuthorized(active)) void beginEnd(active, 'permission_revoked').catch(() => {});
    return snapshot();
  }
  function snapshot() {
    let enabled = false;
    try { const grant = policy(); enabled = own(grant,'enabled') === true && Number.isSafeInteger(own(grant,'revision')) && own(grant,'revision') >= 0; } catch {}
    return { available: !closed && enabled && readiness() !== null,
    busy: active !== null, closed, call: publicView(active ?? last) }; }
  function close() {
    // 先前停止超时后，真实终态/所属进程exit已释放资源时不能继续返回旧失败Promise。
    if (closed && active === null) return Promise.resolve();
    if (closeTask) return closeTask;
    closed = true;
    const call = active;
    closeTask = (async () => {
      if (!call) return;
      void beginEnd(call, 'shutdown').catch(() => {});
      if (call.phase === 'ended') return;
      let timer;
      try { await Promise.race([new Promise(resolve => call.endWaiters.push(resolve)), new Promise((_, reject) => {
        timer = setTimer(() => reject(fail('CALL_STOP_UNCONFIRMED')), commandTimeoutMs+endTimeoutMs);
        timer?.unref?.();
      })]); } finally { clearTimer(timer); }
    })();
    return closeTask;
  }
  return { start, receiveInvite, accept, end, observe, workerExited, reconcile, close, snapshot };
}
