import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { observeHelperExit } from './worker-shutdown.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const fail = code => Object.assign(new Error(code),{code});
/**
 * 启动一个所属SDK子进程。业务方只能从当前native session供应身份/信令，不能映射HTTP原始动作。
 * @param {object} options 回调onSignal/onAudio仅供本机驱动，原始载荷不得写日志或送入模型。
 * @returns {object} ready/request/close/snapshot；exited只表示worker退出，helperExitConfirmed独立确认助手。
 * @note 不自动登录、接听或拨号。单次请求超时为unknown，不重试。stdout/stderr关闭，
 * 账号SDK缓存和临时文件仅进入C盘本项目独立目录；不读取QQ账号目录。
 */
export function createAvsdkWorker({ onSignal = () => {}, onAudio = () => {}, onCallEvent = () => {}, onFault = () => {}, onExit = () => {} } = {}) {
  if (![onSignal,onAudio,onCallEvent,onFault,onExit].every(value => typeof value === 'function')) throw fail('PHONE_WORKER_CONFIGURATION_INVALID');
  const generation = randomUUID(), profile = path.join(root,'../avsdk-offline-probe/profile/private-worker',generation);
  fs.mkdirSync(profile,{recursive:true});
  const env = {...process.env};
  for (const key of Object.keys(env)) if (/KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|COOKIE/i.test(key)
      || /^(QQ_|DSH_|SNOWLUMA|DEEPSEEK)/.test(key)) delete env[key];
  delete env.NODE_OPTIONS; delete env.NODE_PATH;
  for (const key of ['TEMP','TMP','APPDATA','LOCALAPPDATA']) {
    env[key] = path.join(profile,key.toLowerCase()); fs.mkdirSync(env[key],{recursive:true});
  }
  env.NODE_DISABLE_COMPILE_CACHE = '1';
  const child = fork(path.join(root,'avsdk-worker.mjs'),[],{execPath:process.execPath,cwd:profile,env,
    serialization:'advanced',windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
  const helperExit = observeHelperExit(child, generation);
  let phase = 'starting', audioApiReady = false, exited = false, exitCode = null, signal = null, closing = null, sequence = 0, queuedSignals = 0, queuedAudio = 0;
  let resolveReady, rejectReady, resolveExit;
  const ready = new Promise((resolve,reject) => {resolveReady=resolve;rejectReady=reject;});
  // 调用者可能先close后await ready；预先消费拒绝，仍把原promise交还给调用者。
  ready.catch(() => {});
  const exit = new Promise(resolve => {resolveExit=resolve;});
  const pending = new Map();
  const startTimer = setTimeout(() => { rejectReady(fail('PHONE_WORKER_START_TIMEOUT')); void close().catch(() => {}); },10000);
  let signalWork = Promise.resolve();
  const notifyFault = code => { try {onFault({code});} catch {} };
  child.on('message',message => {
    if (exited || !message || typeof message !== 'object') return;
    if (message.kind === 'ready' && phase === 'starting' && message.audioApiReady === true) {
      clearTimeout(startTimer); phase='ready'; audioApiReady=true; resolveReady(snapshot()); return;
    }
    if (message.kind === 'receipt' && Number.isSafeInteger(message.id)) {
      const entry=pending.get(message.id); if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.ok === true) entry.resolve(message.value);
      else entry.reject(fail('PHONE_WORKER_REQUEST_REFUSED'));
      return;
    }
    if (phase !== 'ready') return;
    if (message.kind === 'call_event') {
      if (message.event?.generation !== generation || !['login_ready','invite','connected','ended'].includes(message.event?.type)) {
        notifyFault('PHONE_WORKER_EVENT_INVALID');void close().catch(() => {});return;
      }
      try {Promise.resolve(onCallEvent(message.event)).catch(() => {
        notifyFault('PHONE_CALL_EVENT_FAILED');void close().catch(() => {});
      });} catch {notifyFault('PHONE_CALL_EVENT_FAILED');void close().catch(() => {});}
    } else if (message.kind === 'sdk') {
      if (++queuedSignals > 32) {notifyFault('PHONE_SIGNAL_BACKPRESSURE');void close().catch(() => {});return;}
      signalWork = signalWork.then(async () => {
        if (phase !== 'ready') return;
        await onSignal(message.message);
      }).catch(() => {notifyFault('PHONE_SIGNAL_RELAY_FAILED');void close().catch(() => {});})
        .finally(() => {queuedSignals--;});
    } else if (message.kind === 'audio') {
      // 驱动须及时消费/复制，不能在这里等长耗时ASR/TTS；异步回调也纳入错误处理。
      if (++queuedAudio > 16) {queuedAudio--;notifyFault('PHONE_AUDIO_BACKPRESSURE');void close().catch(() => {});return;}
      try { Promise.resolve(onAudio(message.bytes,message.lease)).catch(() => {
        notifyFault('PHONE_AUDIO_CONSUMER_FAILED');void close().catch(() => {});
      }).finally(() => {queuedAudio--;}); } catch {queuedAudio--;notifyFault('PHONE_AUDIO_CONSUMER_FAILED');void close().catch(() => {});}
    } else if (message.kind === 'fault' || message.kind === 'media_fault') {
      notifyFault('PHONE_WORKER_FAILED');void close().catch(() => {});
    }
  });
  child.once('error',() => {rejectReady(fail('PHONE_WORKER_START_FAILED'));notifyFault('PHONE_WORKER_PROCESS_FAILED');});
  child.once('exit',(code,why) => {
    exited=true;phase='exited';exitCode=code;signal=why;clearTimeout(startTimer);
    rejectReady(fail('PHONE_WORKER_EXITED'));
    for (const entry of pending.values()) {clearTimeout(entry.timer);entry.reject(fail('PHONE_WORKER_OUTCOME_UNKNOWN'));}
    pending.clear();resolveExit(snapshot());try {onExit(snapshot());} catch {}
  });
  function request(operation,fields = {},timeoutMs = 10000) {
    if (phase !== 'ready' || pending.size >= 32 || !['bind','kernel_action','status','media_open','media_close','media_write','media_clear','media_status','call_accept','call_end','call_ignore'].includes(operation)
        || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
        || /^(media_|call_)/.test(operation) && fields?.lease?.generation !== generation) return Promise.reject(fail('PHONE_WORKER_UNAVAILABLE'));
    const id=++sequence;
    return new Promise((resolve,reject) => {
      const timer=setTimeout(() => {pending.delete(id);reject(fail('PHONE_WORKER_OUTCOME_UNKNOWN'));},timeoutMs);
      pending.set(id,{resolve,reject,timer});
      try {child.send({...fields,id,operation},error => {
        if (error && pending.has(id)) {pending.delete(id);clearTimeout(timer);reject(fail('PHONE_WORKER_OUTCOME_UNKNOWN'));}
      });} catch {pending.delete(id);clearTimeout(timer);reject(fail('PHONE_WORKER_OUTCOME_UNKNOWN'));}
    });
  }
  async function waitExit(ms) {
    let timer; try {return await Promise.race([exit,new Promise(resolve => {timer=setTimeout(() => resolve(null),ms);})]);}
    finally {clearTimeout(timer);}
  }
  function close() {
    if (exited) return Promise.resolve(snapshot());
    if (closing) return closing;
    phase='stopping';clearTimeout(startTimer);
    closing=(async () => {
      try {if(child.connected)child.send({id:++sequence,operation:'stop'},() => {});} catch {}
      if (await waitExit(5000)) return snapshot();
      child.kill();
      if (await waitExit(3000)) return snapshot();
      notifyFault('PHONE_WORKER_STOP_UNCONFIRMED');throw fail('PHONE_WORKER_STOP_UNCONFIRMED');
    })();return closing;
  }
  function snapshot() {return {generation,phase,exited,exitCode,signal,pendingRequests:pending.size,audioApiReady:phase==='ready' && audioApiReady,
    helperExitConfirmed:helperExit.confirmed(),signalingReady:false,actualCallVerified:false};}
  return Object.freeze({ready,request,close,snapshot});
}
