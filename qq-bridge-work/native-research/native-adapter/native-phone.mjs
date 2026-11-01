import {createNativeCallController} from '../phone/native-call-controller.mjs';
const fail=code=>Object.assign(new Error(code),{code});
const validId=value=>typeof value==='string'&&/^qqcall_[a-f0-9]{32}$/.test(value);
const validKey=value=>typeof value==='string'&&/^private:[1-9]\d{0,19}$/.test(value);

/**
 * 本机OneBot电话后端；只由当前原生会话供应身份、私聊范围和UID映射。
 * @param {object} options context返回allowed/revision；allowsPeer和resolveCaller只使用当前授权私聊。
 * @returns {object} prepare/poll/readAudio/writeAudio/clearAudio/mediaStatus/accept/start/end/close/checkLease/snapshot。
 * @note 不接原始SDK操作、地址、文件或其它QQ账号。音频仅在内存有界排队；消费者租约
 * 过期会明确请求结束所属通话并停止SDK，不把超时当成进程退出。停止未确认时禁止新实例。
 */
export function createNativePhone({session,identity,context,allowsPeer,resolveCaller,makeController=createNativeCallController,
  clock=Date.now,setWatch=setInterval,clearWatch=clearInterval,consumerLeaseMs=5000,maxRxFrames=200}={}){
  if(!session||![context,allowsPeer,resolveCaller,makeController,clock,setWatch,clearWatch].every(v=>typeof v==='function')
      ||!Number.isInteger(consumerLeaseMs)||consumerLeaseMs<1000||consumerLeaseMs>60000
      ||!Number.isInteger(maxRxFrames)||maxRxFrames<20||maxRxFrames>500)throw fail('PHONE_CONFIG_INVALID');
  let controller=null,enabled=false,autoAnswer=true,phase='disabled',localStopped=true,revision=null;
  let preparing=null,closing=null,watch=null,lastPoll=0,startedAt=0,failureCode=null,rxCall=null,lastAudioContext=null;
  const rx=[];let faultedCall=null;
  const info=()=>{try{return context();}catch{return {};}};
  const allowed=()=>{const value=info();return value.allowed===true&&value.revision===revision;};
  const alive=()=>clock()-lastPoll<=consumerLeaseMs || phase==='preparing'&&clock()-startedAt<30000;
  const policy=()=>({enabled:enabled&&!closing&&allowed()&&alive(),revision:info().revision,autoAnswer});
  const peerAllowed=key=>{try{return validKey(key)&&allowsPeer(key)===true;}catch{return false;}};
  function clearRx(){for(const b of rx)b.fill(0);rx.length=0;rxCall=null;}
  function ownedCall(id,key){const call=controller?.snapshot().call,owner=controller?.context()??lastAudioContext;
    if(!enabled||!allowed()||!validId(id)||call?.callId!==id||owner?.callId!==id||!peerAllowed(owner.peerKey)
        ||key!==undefined&&key!==owner.peerKey)throw fail('CALL_STALE');return call;}
  function receive(bytes,owner){
    if(!enabled||closing||!allowed()||!alive()||!validId(owner?.callId)||!peerAllowed(owner?.peerKey))return;
    if(!Buffer.isBuffer(bytes)||bytes.length%1920||bytes.length>1920*50)return;
    lastAudioContext={...owner};if(rxCall!==owner.callId){clearRx();rxCall=owner.callId;}
    if(rx.length+bytes.length/1920>maxRxFrames){
      clearRx();failureCode='PHONE_AUDIO_BACKPRESSURE';
      if(faultedCall!==owner.callId){faultedCall=owner.callId;void controller.end(owner.callId,'technical_error').catch(()=>{});}return;
    }
    for(let at=0;at<bytes.length;at+=1920)rx.push(Buffer.from(bytes.subarray(at,at+1920)));
  }
  async function prepare(input={}){
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>k!=='auto_answer')||typeof input.auto_answer!=='boolean')throw fail('PHONE_INPUT_INVALID');
    const value=info();if(value.allowed!==true||!Number.isSafeInteger(value.revision)||value.revision<0)throw fail('PHONE_NOT_ALLOWED');
    if(preparing)return preparing;if(closing)await closing;
    if(!localStopped&&failureCode==='PHONE_STOP_UNCONFIRMED')throw fail('PHONE_STOP_UNCONFIRMED');
    if(enabled)return {accepted:true,alreadyPrepared:true};
    enabled=true;autoAnswer=input.auto_answer;phase='preparing';localStopped=false;revision=value.revision;startedAt=lastPoll=clock();
    controller=makeController({session,identity,policy,allowsPeer:peerAllowed,resolveCaller,onAudio:receive});
    preparing=(async()=>{
      try{await controller.prepare();if(closing||!allowed())throw fail('PHONE_NOT_ALLOWED');phase='ready';lastPoll=clock();
        if(watch===null){watch=setWatch(()=>{void checkLease().catch(()=>{});},1000);watch?.unref?.();}return {accepted:true};
      }catch{if(!localStopped){failureCode='PHONE_PREPARE_UNCONFIRMED';phase='prepare_unconfirmed';}throw fail('PHONE_PREPARE_UNCONFIRMED');}
      finally{preparing=null;}
    })();return preparing;
  }
  function poll(){
    if(enabled&&!closing&&allowed())lastPoll=clock();
    const state=controller?.snapshot(),owner=controller?.context()??lastAudioContext;
    const call=state?.call&&owner?.callId===state.call.callId&&peerAllowed(owner.peerKey)?{...state.call,key:owner.peerKey}:null;
    if(rxCall&&(!call||call.callId!==rxCall||!call.connected))clearRx();
    return {enabled,localStopped,phase:failureCode?phase:state?.phase??phase,incomingAvailable:allowed()&&state?.incomingAvailable===true,
      outgoingAvailable:allowed()&&state?.outgoingAvailable===true,call,failureCode,diagnostics:state?.diagnostics??null};
  }
  function readAudio(input){
    if(!input||Object.keys(input).some(k=>!['call_id','max_frames'].includes(k))||!Number.isInteger(input.max_frames)||input.max_frames<1||input.max_frames>20)
      throw fail('PHONE_INPUT_INVALID');
    const call=ownedCall(input.call_id);if(!call.connected)throw fail('PHONE_NOT_CONNECTED');lastPoll=clock();
    const frames=rxCall===input.call_id?rx.splice(0,input.max_frames):[],bytes=Buffer.concat(frames);for(const b of frames)b.fill(0);
    const result={call_id:input.call_id,data:bytes.toString('base64'),sampleRate:48000,channels:1};bytes.fill(0);return result;
  }
  async function writeAudio(input){
    if(!input||Object.keys(input).some(k=>!['call_id','data'].includes(k))||typeof input.data!=='string'||!input.data.length||input.data.length>25600)
      throw fail('PHONE_INPUT_INVALID');const call=ownedCall(input.call_id);if(!call.connected)throw fail('PHONE_NOT_CONNECTED');
    const bytes=Buffer.from(input.data,'base64');if(bytes.toString('base64')!==input.data||!bytes.length||bytes.length%1920)throw fail('PHONE_INPUT_INVALID');
    lastPoll=clock();try{return await controller.enqueuePcm(input.call_id,bytes);}finally{bytes.fill(0);}
  }
  function media(input,clear=false){if(!input||Object.keys(input).length!==1)throw fail('PHONE_INPUT_INVALID');
    const call=ownedCall(input.call_id);if(!call.connected)throw fail('PHONE_NOT_CONNECTED');lastPoll=clock();
    return clear?controller.clearPcm(input.call_id):controller.pcmStatus(input.call_id);}
  function accept(input){if(!input||!validKey(input.key)||Object.keys(input).some(k=>!['key','call_id'].includes(k)))throw fail('PHONE_INPUT_INVALID');
    ownedCall(input.call_id,input.key);return controller.accept(input.call_id);}
  function start(input){if(!input||Object.keys(input).length!==1||!peerAllowed(input.key)||!enabled||!allowed())throw fail('PHONE_NOT_ALLOWED');
    return controller.start(input.key);}
  function end(input){if(!input||!validKey(input.key)||Object.keys(input).some(k=>!['key','call_id','reason'].includes(k))
      ||!['user_requested','conversation_done','needs_rest','uncomfortable','busy','technical_error'].includes(input.reason))throw fail('PHONE_INPUT_INVALID');
    ownedCall(input.call_id,input.key);clearRx();return controller.end(input.call_id,input.reason);}
  function close(){if(closing)return closing;
    phase='stopping';if(watch!==null)clearWatch(watch);watch=null;clearRx();
    const target=controller;
    closing=(async()=>{try{await target?.close();if(target&&target.snapshot().phase!=='closed')throw fail('PHONE_STOP_UNCONFIRMED');
      enabled=false;localStopped=true;phase='disabled';failureCode=null;lastAudioContext=null;return {localStopped:true};
    }catch{localStopped=false;failureCode='PHONE_STOP_UNCONFIRMED';phase='stop_unconfirmed';throw fail(failureCode);}
    finally{closing=null;}})();return closing;
  }
  async function checkLease(){if(!enabled||closing)return;if(!allowed()||!alive())await close();else controller?.reconcile();}
  return Object.freeze({prepare,poll,readAudio,writeAudio,clearAudio:input=>media(input,true),mediaStatus:input=>media(input),accept,start,end,close,checkLease,
    snapshot:()=>({enabled,phase,localStopped,failureCode,bufferedFrames:rx.length,consumerAlive:enabled&&alive(),diagnostics:controller?.snapshot().diagnostics??null})});
}
