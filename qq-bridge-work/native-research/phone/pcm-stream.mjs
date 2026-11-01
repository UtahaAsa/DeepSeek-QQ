export const pcmFormat = Object.freeze({ sampleRate: 48000, channels: 1, bitsPerSample: 16,
  frameMs: 20, frameBytes: 1920 });
const fail = code => Object.assign(new Error(code), { code });
const own = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;

/**
 * 创建所属通话的固定PCM通道；设备方法同步执行，授权代次每次IO前重新检查。
 * @param {object} options device提供preparePcm/writePcm/readPcm/disarmPcm；lease由驱动构造，
 * isLeaseCurrent只检查驱动内存中的当前通话。缓冲仅保存在本进程，不写日志或文件。
 * @returns {object} start/enqueue/drain/stop/snapshot；停止只确认本地通道，不代表QQ已挂断。
 * @note 单次使用；20ms发送一帧，空闲补静音，定时器迟到不补发突发帧。
 * 收发分别有容量上限，发送整块回压，接收溢出停止，防止ASR悄悄跨越丢失帧。
 */
export function createPcmStream({ device, lease, isLeaseCurrent, clock = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout, maxTxFrames = 100, maxRxFrames = 250 }) {
  if (!device || !['preparePcm','writePcm','readPcm','disarmPcm'].every(key => typeof device[key] === 'function')
      || typeof isLeaseCurrent !== 'function' || typeof clock !== 'function'
      || ![maxTxFrames,maxRxFrames].every(n => Number.isInteger(n) && n >= 1 && n <= 500))
    throw fail('PCM_CONFIGURATION_INVALID');
  const boundLease = Object.freeze(Object.fromEntries(['generation','ref','revision'].map(key => [key, own(lease,key)])));
  if (![boundLease.generation,boundLease.ref].every(value => typeof value === 'string' && /^[A-Za-z0-9_:-]{8,160}$/.test(value))
      || !Number.isSafeInteger(boundLease.revision) || boundLease.revision < 0) throw fail('PCM_LEASE_INVALID');
  let phase = 'idle', timer = null, due = 0, reason = null, localStopped = false;
  let sentFrames = 0, receivedFrames = 0, silentFrames = 0, lateTicks = 0;
  const tx = [], rx = [], silence = Buffer.alloc(pcmFormat.frameBytes);
  const current = () => { try { return isLeaseCurrent(boundLease) === true; } catch { return false; } };
  function stop(code = 'requested') {
    if (phase === 'stopped') return snapshot();
    phase = 'stopped'; reason = code;
    if (timer !== null) clearTimer(timer); timer = null;
    for (const frame of [...tx,...rx]) frame.fill(0);
    tx.length = rx.length = 0; silence.fill(0);
    try { localStopped = device.disarmPcm() === true; } catch { localStopped = false; }
    return snapshot();
  }
  function requireCurrent() {
    if (phase !== 'running') throw fail('PCM_NOT_RUNNING');
    if (!current()) { stop('lease_expired'); throw fail('PCM_LEASE_EXPIRED'); }
  }
  function schedule(first = false) {
    const now = clock();
    due = first || now - due >= pcmFormat.frameMs ? now + pcmFormat.frameMs : due + pcmFormat.frameMs;
    // Windows定时器可能晚约一个系统时钟片；按绝对目标修正，避免每帧延迟累积为慢放。
    timer = setTimer(tick, Math.max(1,due-now));
  }
  function tick() {
    timer = null;
    if (phase !== 'running') return;
    if (!current()) { stop('lease_expired'); return; }
    if (clock() - due >= pcmFormat.frameMs) lateTicks++;
    if (rx.length >= maxRxFrames) { stop('receive_backpressure'); return; }
    const frame = tx.shift();
    try {
      if (!frame) silence.fill(0);
      if (device.writePcm(frame ?? silence) !== true) throw fail('PCM_IO_UNCONFIRMED');
      sentFrames++; if (!frame) silentFrames++;
      if (!current()) { stop('lease_expired'); return; }
      const received = device.readPcm();
      if (!Buffer.isBuffer(received) || received.length !== pcmFormat.frameBytes) throw fail('PCM_FRAME_INVALID');
      if (!current()) { stop('lease_expired'); return; }
      rx.push(Buffer.from(received)); receivedFrames++;
      schedule();
    } catch { stop('device_io_failed'); }
    finally { frame?.fill(0); }
  }
  function start() {
    if (phase !== 'idle') throw fail('PCM_ALREADY_USED');
    if (!current()) { stop('lease_expired'); throw fail('PCM_LEASE_EXPIRED'); }
    try {
      if (device.preparePcm() !== true) throw fail('PCM_PREPARE_UNCONFIRMED');
      phase = 'running'; requireCurrent(); schedule(true); return snapshot();
    } catch (error) { stop('prepare_failed'); throw fail(error.code === 'PCM_LEASE_EXPIRED' ? error.code : 'PCM_PREPARE_FAILED'); }
  }
  function enqueue(bytes) {
    requireCurrent();
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length % pcmFormat.frameBytes !== 0)
      throw fail('PCM_FRAME_INVALID');
    const count = bytes.length / pcmFormat.frameBytes;
    if (count > maxTxFrames - tx.length) return { accepted: false, reason: 'backpressure', queuedFrames: tx.length };
    for (let offset = 0; offset < bytes.length; offset += pcmFormat.frameBytes)
      tx.push(Buffer.from(bytes.subarray(offset, offset + pcmFormat.frameBytes)));
    return { accepted: true, queuedFrames: tx.length };
  }
  function drain(maxFrames = 25) {
    requireCurrent();
    if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > maxRxFrames) throw fail('PCM_DRAIN_INVALID');
    const frames = rx.splice(0,maxFrames), result = Buffer.concat(frames);
    for (const frame of frames) frame.fill(0);
    return result;
  }
  function snapshot() { return { phase, reason, localStopped, queuedTxFrames: tx.length, queuedRxFrames: rx.length,
    sentFrames, receivedFrames, silentFrames, lateTicks, remoteAudioConfirmed: false, callEndedConfirmed: false }; }
  /** 清空当前代次尚未提交的声音，供对端插话时取消播放；不声明撤回已提交的帧。 */
  function clearTx() {requireCurrent();const clearedFrames=tx.length;for(const frame of tx)frame.fill(0);tx.length=0;return {clearedFrames};}
  return Object.freeze({ start, enqueue, drain, clearTx, stop: () => stop(), snapshot });
}
