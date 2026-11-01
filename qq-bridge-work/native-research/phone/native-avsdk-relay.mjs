import { nativeMethod, isNativeListenerHandle } from '../native-adapter/manual-login.mjs';
import { createAvsdkWorker } from './avsdk-worker-client.mjs';

const fail = code => Object.assign(new Error(code),{code});
const validAction = (type,payload) => Number.isInteger(type) && type >= 0 && type <= 2147483647
  && typeof payload === 'string' && payload.length > 0 && Buffer.byteLength(payload) <= 256*1024 && !payload.includes('\0');
/**
 * 原生会话与所属SDK子进程之间的私有信令转发候选；不暴露任意命令或模型工具。
 * @param {object} options session为当前所属native session，identity由其宿主提供；
 * isAuthorized核对当前代次/启用状态。listenerContract由固定宿主供应，Windows 9.9.35使用同一监听对象移除。
 * onSdkEvent/onNativeState仅供内部通话驱动，禁止记录原始载荷。
 * @returns {object} start/close/snapshot；监听必须取得可撤销handle。转发回执不是接通证明。
 * @note 不读取账号文件，不主动呼叫、不自动接受邀请。信令未知结果不重试；
 * 监听移除和子进程真实退出分别核对。旧回调在关闭或撤权后立即失效。
 */
export function createNativeAvsdkRelay({session,identity,isAuthorized,onSdkEvent = () => {},onNativeState = () => {},
  onCallEvent = () => {},onAudio = () => {},onWorkerExit = () => {},makeWorker = createAvsdkWorker,drainTimeoutMs = 3000,
  listenerContract='returned-handle'} = {}) {
  if (!session || typeof isAuthorized !== 'function' || typeof makeWorker !== 'function'
      || ![onSdkEvent,onNativeState,onCallEvent,onAudio,onWorkerExit].every(value => typeof value === 'function')
      || !Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 1 || drainTimeoutMs > 30000
      || !['returned-handle','windows-listener-object-v1'].includes(listenerContract)) throw fail('PHONE_RELAY_CONFIGURATION_INVALID');
  let state='idle',service=null,worker=null,handle=null,registrationAttempted=false,removalVerified=false;
  let startAttempted=false,closing=null,pending=0,failureCode=null,bindSubmitted=false;
  let kernelToSdk=0,sdkToKernel=0;
  let audioApiReady=false,exitReported=false;
  let registrationReturnKind=null,handleKind=null,removalReturnKind=null,removalResultKind=null,removalTask=null;
  const returnKind=value=>value&&typeof value.then==='function'?'promise':value===null?'null':typeof value;
  const buffered=[], inflight=new Set();
  let work=Promise.resolve();
  const authorized=() => {try{return isAuthorized() === true;}catch{return false;}};
  const accepting=() => ['registering','binding','active'].includes(state) && authorized();
  function reportExit(info) {
    if (exitReported || info?.exited !== true) return;
    exitReported=true;try {onWorkerExit(info);} catch {failureCode='PHONE_EXIT_CONSUMER_FAILED';}
  }
  function track(promise) {
    inflight.add(promise);promise.finally(() => inflight.delete(promise)).catch(() => {});return promise;
  }
  function fault(code) {
    failureCode=code;
    if (!['closing','closed'].includes(state)) {state='failed';void close().catch(() => {});}
  }
  function queueAction(type,payload) {
    if (!accepting()) return;
    if (!validAction(type,payload)) {fault('PHONE_NATIVE_SIGNAL_SHAPE_INVALID');return;}
    if (state !== 'active') {
      if (buffered.length >= 16) {fault('PHONE_NATIVE_SIGNAL_BACKPRESSURE');return;}
      buffered.push({type,payload});return;
    }
    if (++pending > 16) {pending--;fault('PHONE_NATIVE_SIGNAL_BACKPRESSURE');return;}
    const next=work.then(async () => {
      if (state !== 'active' || !authorized()) return;
      const result=await worker.request('kernel_action',{actionType:type,payload});
      if (result?.outcome !== 'accepted') throw fail('PHONE_NATIVE_SIGNAL_UNCONFIRMED');
      kernelToSdk++;
    }).catch(() => {fault('PHONE_NATIVE_SIGNAL_UNCONFIRMED');}).finally(() => {pending--;});
    work=next;track(next);
  }
  async function receiveSdk(message) {
    if (!['binding','active'].includes(state) || !authorized()) return;
    if (!message || !Number.isInteger(message.cmd)) throw fail('PHONE_SDK_SIGNAL_INVALID');
    if (message.cmd === 20001) {
      const value=message.value;
      if (!Array.isArray(value) || value.length !== 2 || !validAction(value[0],value[1])) throw fail('PHONE_SDK_SIGNAL_INVALID');
      // 原生动作只在所属驱动内流转；不经过public gateway或模型工具。
      let submitted=false;
      await track(Promise.resolve().then(() => {
        if (!['binding','active'].includes(state) || !authorized()) return;
        submitted=true;
        return nativeMethod(service,'setActionFromAVSDK')(value[0],value[1]);
      }));
      if(submitted)sdkToKernel++;
    } else await track(Promise.resolve().then(() => {
      if (['binding','active'].includes(state) && authorized()) return onSdkEvent(message);
    }));
  }
  const listener=new Proxy({
    onActionToAVSDK:(type,payload) => queueAction(type,payload),
    OnInviteActionToAVSDK:(_info,type,payload) => queueAction(type,payload),
    onS2CActionToAVSDK:info => {
      if (!accepting()) return;
      // destroyReason单独出现不足以关联某通话，交给内部驱动核对，不在这里伪造终态。
      try {track(Promise.resolve(onNativeState(info))).catch(() => fault('PHONE_NATIVE_STATE_FAILED'));}
      catch {fault('PHONE_NATIVE_STATE_FAILED');}
    },
  },{get:(target,key) => Object.hasOwn(target,key) ? target[key]
    : typeof key === 'string' && /^(on|On)[A-Za-z]/.test(key) ? () => {} : undefined});
  async function start() {
    if (startAttempted || state !== 'idle' || !authorized()) throw fail('PHONE_RELAY_START_REFUSED');
    startAttempted=true;state='starting';
    try {
      const account=typeof identity === 'function' ? identity() : identity;
      if (!account || typeof account.uid !== 'string' || !/^u_[A-Za-z0-9_-]{1,128}$/.test(account.uid)
          || typeof account.uin !== 'string' || !/^[1-9]\d{0,19}$/.test(account.uin)) throw fail('PHONE_RELAY_IDENTITY_INVALID');
      service=nativeMethod(session,'getAVSDKService')();
      nativeMethod(service,'setActionFromAVSDK');nativeMethod(service,'removeKernelAVSDKListener');
      worker=makeWorker({onSignal:receiveSdk,onFault:() => fault('PHONE_SDK_WORKER_FAILED'),
        onCallEvent:event => {if(!['closing','closed','failed'].includes(state))return onCallEvent(event);},
        onAudio:(bytes,lease) => {if(state==='active' && authorized())return onAudio(bytes,lease);},
        onExit:info => {reportExit(info);if(!['closing','closed'].includes(state))fault('PHONE_SDK_WORKER_EXITED');}});
      const ready=await worker.ready;audioApiReady=ready?.audioApiReady === true;
      if (state !== 'starting' || !authorized()) throw fail('PHONE_RELAY_START_REFUSED');
      state='registering';registrationAttempted=true;
      const registration=nativeMethod(service,'addKernelAVSDKListener')(listener);
      registrationReturnKind=returnKind(registration);
      const registered=await registration;handleKind=returnKind(registered);
      if(listenerContract==='windows-listener-object-v1'){
        // 固定wrapper的两个入口都转换同一JS监听对象并返回void；不合成数字ID。
        if(registered!==undefined)throw fail('PHONE_LISTENER_HANDLE_UNCONFIRMED');
        handle=listener;handleKind='listener_object';
      }else{
        if (!isNativeListenerHandle(registered)) throw fail('PHONE_LISTENER_HANDLE_UNCONFIRMED');
        handle=registered;
      }
      if (!accepting()) throw fail('PHONE_RELAY_START_REFUSED');
      state='binding';bindSubmitted=true;
      const receipt=await track(worker.request('bind',{uid:account.uid,uin:account.uin}));
      if (receipt?.outcome !== 'accepted' || state !== 'binding' || !authorized()) throw fail('PHONE_RELAY_BIND_UNCONFIRMED');
      state='active';
      for (const action of buffered.splice(0)) queueAction(action.type,action.payload);
      return snapshot();
    } catch(error) {
      failureCode=/^PHONE_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'PHONE_RELAY_START_FAILED';
      await close().catch(() => {});throw fail(failureCode);
    }
  }
  function close() {
    if (closing) return closing;
    state='closing';buffered.length=0;
    closing=(async () => {
      if (handle !== null && !removalVerified) {
        if(!removalTask){
          try{
            const returned=nativeMethod(service,'removeKernelAVSDKListener')(handle);removalReturnKind=returnKind(returned);
            removalTask=Promise.resolve(returned).then(value=>{removalResultKind=returnKind(value);
              if(value!==undefined)return false;removalVerified=true;handle=null;return true;},()=>false);
          }catch{removalReturnKind='threw';removalTask=Promise.resolve(false);}
        }
        let removalTimer;
        await Promise.race([removalTask,new Promise(resolve=>{removalTimer=setTimeout(()=>resolve(false),drainTimeoutMs);})])
          .finally(()=>clearTimeout(removalTimer));
      }
      const stopped=worker ? await worker.close() : {exited:true};
      reportExit(stopped);
      let timer;
      const drained=await Promise.race([Promise.allSettled([...inflight]).then(() => true),
        new Promise(resolve => {timer=setTimeout(() => resolve(false),drainTimeoutMs);})]).finally(() => clearTimeout(timer));
      if (!drained || stopped.exited !== true || stopped.helperExitConfirmed === false || registrationAttempted && !removalVerified) throw fail('PHONE_RELAY_STOP_UNCONFIRMED');
      state='closed';return snapshot();
    })();
    closing.catch(() => {closing=null;});return closing;
  }
  function snapshot() {return {state,bindSubmitted,kernelToSdk,sdkToKernel,pendingNativeActions:pending,
    listenerRegistered:handle !== null,listenerRemovalVerified:removalVerified,
      cleanupRequired:registrationAttempted && !removalVerified || worker?.snapshot().exited === true && worker?.snapshot().helperExitConfirmed === false,workerExited:worker?.snapshot().exited ?? false,
    listenerContract,registrationReturnKind,handleKind,removalReturnKind,removalResultKind,
    workerExitCode:Number.isInteger(worker?.snapshot().exitCode)?worker.snapshot().exitCode:null,
    generation:worker?.snapshot().generation,audioApiReady:state==='active' && audioApiReady,
    signalingReady:false,actualCallVerified:false,failureCode};}
  function requestCall(operation,lease,bytes) {
    if (!['call_accept','call_end','call_ignore','media_open','media_close','media_write','media_clear','media_status'].includes(operation)
        || state !== 'active' || !worker || !['call_end','call_ignore','media_close','media_clear'].includes(operation) && !authorized())
      return Promise.resolve({outcome:'not_submitted'});
    return track(worker.request(operation,{lease,...(operation==='media_write'?{bytes}:{})}));
  }
  return Object.freeze({start,close,snapshot,requestCall});
}
