import { createCallSession } from './call-session.mjs';
import { createNativeAvsdkRelay } from './native-avsdk-relay.mjs';
const fail=code=>Object.assign(new Error(code),{code});

/**
 * 将真实SDK事件、授权私聊映射、单通话状态与20ms媒体连接起来的内部候选。
 * @param {object} options resolveCaller只使用当前已观察UID映射；policy提供enabled/revision/autoAnswer，
 * onAudio交给所属ASR，不得保存无关联系人的声音。SDK原始载荷不公开给模型。
 * @returns {object} prepare/accept/end/start/enqueuePcm/reconcile/close/snapshot。
 * @note SDK进程一通电话后确认停止再准备下一实例，不自动重拨。当前没有拨号业务参数，
 * start明确拒绝；不能把本候选称为已完成真实接听、双向语音或主动拨号。
 */
export function createNativeCallController({session,identity,policy,allowsPeer,resolveCaller,onAudio=()=>{},
  makeRelay=createNativeAvsdkRelay,localEndTimeoutMs=20000}={}) {
  if (!session || ![policy,allowsPeer,resolveCaller,onAudio,makeRelay].every(v=>typeof v==='function')
      || !Number.isInteger(localEndTimeoutMs) || localEndTimeoutMs<1 || localEndTimeoutMs>60000)
    throw fail('CALL_DRIVER_CONFIGURATION_INVALID');
  let relay=null,phase='idle',closed=false,prepareTask=null,failureCode=null,loggedGeneration=null;
  let boundRevision=null,endTimer=null,mediaLease=null;
  let lastContext=null;
  const leases=new Map(),pendingInvites=[];
  const grant=()=>{try{return policy();}catch{return {};}};
  const authorized=()=>{const value=grant();return !closed && value.enabled===true && value.revision===boundRevision;};
  function clearEndTimer(){if(endTimer!==null)clearTimeout(endTimer);endTimer=null;}
  function ready() {
    const state=relay?.snapshot();return {generation:state?.generation,
      signalingReady:!closed && phase==='ready' && state?.state==='active' && loggedGeneration===state?.generation,
      audioReady:state?.audioApiReady===true};
  }
  const transport={readiness:ready,start:async()=>({outcome:'not_submitted'}),
    accept:request=>command('call_accept',request),end:request=>command('call_end',request)};
  const calls=createCallSession({transport,policy,allowsPeer});
  function validEntry(request) {
    const entry=leases.get(request.ref);
    return entry && entry.generation===request.generation && entry.revision===request.revision && entry.peerKey===request.peerKey;
  }
  async function command(operation,request) {
    if (!relay || !validEntry(request)) return {outcome:'not_submitted'};
    const lease={ref:request.ref,generation:request.generation,revision:request.revision};
    if(operation==='call_end') {
      mediaLease=null;
      // 在SDK离房通知缺失时，明确停止所属子进程；只有真实exit才能释放占位。
      clearEndTimer();const owner=relay;
      endTimer=setTimeout(()=>{
        if(relay!==owner || closed)return;
        void prepare().catch(()=>{});
      },localEndTimeoutMs);endTimer.unref?.();
    }
    return relay.requestCall(operation,lease);
  }
  async function handleInvite(event) {
    if(closed || event.generation!==ready().generation || !ready().signalingReady)return;
    const owner = relay;
    const ignore = () => owner.requestCall('call_ignore', {generation:event.generation,ref:event.ref,revision:boundRevision});
    let peerKey;try{peerKey=resolveCaller(event.callerUid);}catch{return ignore();}
    if(typeof peerKey!=='string'||!/^private:[1-9]\d{0,19}$/.test(peerKey))return ignore();
    let allowed=false;try{allowed=allowsPeer(peerKey)===true;}catch{}if(!allowed || !authorized())return ignore();
    const entry={generation:event.generation,ref:event.ref,revision:boundRevision,peerKey};
    if(leases.has(event.ref))return;
    leases.set(event.ref,entry);
    const result=await calls.receiveInvite({...event,peerKey});
    if(result.handled)lastContext={callId:result.call.callId,peerKey};
    if(!result.handled){leases.delete(event.ref);await ignore();}
  }
  async function handleEvent(event) {
    if(closed || !relay || event.generation!==relay.snapshot().generation)return;
    if(event.type==='login_ready') {loggedGeneration=event.generation;return;}
    if(event.type==='invite') {
      if(phase!=='ready') {if(pendingInvites.length<1)pendingInvites.push(event);return;}
      return handleInvite(event);
    }
    if(event.type==='ended' && phase!=='ready') {
      const index=pendingInvites.findIndex(invite=>invite.generation===event.generation&&invite.ref===event.ref);
      if(index>=0){pendingInvites.splice(index,1);return;}
    }
    const entry=leases.get(event.ref);if(!entry || entry.generation!==event.generation)return;
    if(event.type==='connected') {
      const accepted=calls.observe(event);
      if(!accepted || !calls.snapshot().call?.connected || !authorized())return;
      const lease={generation:entry.generation,ref:entry.ref,revision:entry.revision};
      const outcome=await relay.requestCall('media_open',lease);
      if(outcome?.outcome!=='accepted')throw fail('CALL_MEDIA_OPEN_UNCONFIRMED');
      if(calls.snapshot().call?.connected && authorized())mediaLease=lease;
    } else if(event.type==='ended' && calls.observe(event)) {
      clearEndTimer();mediaLease=null;
      // 不在SDK事件回调中await自身relay的清理，避免互相等待。
      void prepare().catch(()=>{});
    }
  }
  function prepare() {
    if(closed)return Promise.reject(fail('CALL_DRIVER_CLOSED'));
    if(prepareTask)return prepareTask;
    const task=(async()=>{
      phase='preparing';clearEndTimer();mediaLease=null;loggedGeneration=null;
      if(relay) {
        const current=calls.snapshot().call;
        if(current && !current.ended)await calls.end(current.callId,'technical_error').catch(()=>{});
        clearEndTimer();
        const old=relay;await old.close();
        const info=old.snapshot();
        if(info.workerExited!==true || info.cleanupRequired)throw fail('CALL_DRIVER_STOP_UNCONFIRMED');
        calls.workerExited(info.generation);
      }
      leases.clear();pendingInvites.length=0;
      const value=grant();
      if(value.enabled!==true){phase='disabled';failureCode=null;return snapshot();}
      if(!Number.isSafeInteger(value.revision)||value.revision<0)throw fail('CALL_DRIVER_NOT_ALLOWED');
      boundRevision=value.revision;
      if(closed)throw fail('CALL_DRIVER_CLOSED');
      relay=makeRelay({session,identity,listenerContract:'windows-listener-object-v1',isAuthorized:authorized,onCallEvent:handleEvent,
        onWorkerExit:info=>{
          calls.workerExited(info.generation);mediaLease=null;
          if(!closed && phase==='ready'){phase='failed';failureCode='CALL_SDK_WORKER_EXITED';}
        },
        onAudio:(bytes,lease)=>{
          if(closed || !mediaLease || !authorized() || lease?.generation!==mediaLease.generation
              || lease?.ref!==mediaLease.ref || lease?.revision!==mediaLease.revision || !calls.snapshot().call?.connected)return;
          return onAudio(bytes,{callId:calls.snapshot().call.callId,peerKey:leases.get(lease.ref)?.peerKey});
        }});
      await relay.start();
      if(closed || !authorized())throw fail('CALL_DRIVER_NOT_ALLOWED');
      phase='ready';failureCode=null;
      for(const event of pendingInvites.splice(0))await handleInvite(event);
      return snapshot();
    })().catch(error=>{
      if(!closed)phase='failed';failureCode=/^(?:CALL|PHONE)_[A-Z_]+$/.test(error?.code??'')?error.code:'CALL_DRIVER_PREPARE_FAILED';
      throw fail(failureCode);
    });
    prepareTask=task;
    task.finally(()=>{if(prepareTask===task)prepareTask=null;}).catch(()=>{});return task;
  }
  async function enqueuePcm(callId,bytes) {
    if(!authorized() || !mediaLease || calls.snapshot().call?.callId!==callId || !calls.snapshot().call?.connected)
      throw fail('CALL_AUDIO_STALE');
    return relay.requestCall('media_write',mediaLease,bytes);
  }
  /** 仅内部电话播放器使用当前callId查询/清空本地队列；不向模型开放原始PCM。 */
  async function mediaControl(operation,callId) {
    if(!authorized() || !mediaLease || calls.snapshot().call?.callId!==callId || !calls.snapshot().call?.connected)
      throw fail('CALL_AUDIO_STALE');
    return relay.requestCall(operation,mediaLease);
  }
  async function close() {
    if(closed && phase==='closed')return snapshot();
    closed=true;phase='closing';clearEndTimer();mediaLease=null;
    const current=calls.snapshot().call;
    if(current && !current.ended)await calls.end(current.callId,'shutdown').catch(()=>{});
    clearEndTimer();
    if(relay) {
      await relay.close();const info=relay.snapshot();
      if(info.workerExited!==true || info.cleanupRequired)throw fail('CALL_DRIVER_STOP_UNCONFIRMED');
      calls.workerExited(info.generation);
    }
    await calls.close();phase='closed';return snapshot();
  }
  function snapshot(){const r=relay?.snapshot();return {phase,failureCode,incomingAvailable:calls.snapshot().available,outgoingAvailable:false,
    ...calls.snapshot(),actualQqCallsVerified:0,diagnostics:{controllerPhase:phase,controllerFailureCode:failureCode,
      relayPhase:r?.state??null,relayFailureCode:r?.failureCode??null,listenerRegistered:r?.listenerRegistered??false,
      listenerRemovalVerified:r?.listenerRemovalVerified??false,cleanupRequired:r?.cleanupRequired??false,
      workerExited:r?.workerExited??false,workerExitCode:r?.workerExitCode??null,
      registrationReturnKind:r?.registrationReturnKind??null,handleKind:r?.handleKind??null,
      removalReturnKind:r?.removalReturnKind??null,removalResultKind:r?.removalResultKind??null}};}
  return Object.freeze({prepare,accept:calls.accept,end:calls.end,start:async()=>{throw fail('CALL_OUTGOING_UNAVAILABLE');},
    /** 仅所属网关内部获取本次私聊归属；不含原生UID、SDK信令或可复用lease。 */
    context:()=>lastContext?{...lastContext}:null,
    enqueuePcm,clearPcm:callId=>mediaControl('media_clear',callId),pcmStatus:callId=>mediaControl('media_status',callId),
    reconcile:()=>calls.reconcile(),close,snapshot});
}
