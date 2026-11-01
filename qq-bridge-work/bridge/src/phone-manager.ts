/// <reference types="node" />
import type {PhoneManagerOptions,PhoneDialogPort,PhoneGatewayView,PhoneControlInput,VoiceGuard} from './voice/runtime-contracts.js';
import {createPhoneDialog} from './phone-dialog.js';
const fail=(code:string)=>Object.assign(new Error(code),{code});
const privateKey=(key:unknown):key is string=>typeof key==='string'&&/^private:[1-9]\d{0,19}$/.test(key);
const callId=(value:unknown):value is string=>typeof value==='string'&&/^qqcall_[a-f0-9]{32}$/.test(value);

/**
 * 桥接侧电话管理器：轮询受控网关、绑定当前电话对话，沿用现有语音和模型工人。
 * @param {object} options bot.raw为已有鉴权OneBot；ready/captureGuard/settings来自当前本机许可。
 * @returns {object} tick/start/control/close/reconcile/snapshot；没有QQ原始信令或任意目标API。
 * @note 准备超时保持unknown，只查询状态；不因观察超时重启SDK或重拨。关闭须由网关
 * 明确证明本地资源停止；反向音频只在当前电话和私聊守卫下读取，不记录正文。
 */
export function createPhoneManager({bot,voice,model,settings,ready,captureGuard,onTranscript=()=>{},onSpoken=()=>{},
  makeDialog=createPhoneDialog,pollMs=100,clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}:PhoneManagerOptions={} as PhoneManagerOptions) {
  if(!bot||typeof bot.raw!=='function'||!voice||!model||![settings,ready,captureGuard,onTranscript,onSpoken,makeDialog].every(v=>typeof v==='function')
      ||!Number.isInteger(pollMs)||pollMs<50||pollMs>2000)throw fail('PHONE_MANAGER_CONFIG_INVALID');
  let closed=false,phase:unknown='idle',failureCode:string|null=null,prepared=false,prepareUnknown=false,stopUnknown=false;
  let busy=false,timer:ReturnType<typeof setTimeout>|null=null,status:PhoneGatewayView|null=null,lastStatusAt=0,dialog:PhoneDialogPort|null=null,dialogCallId:string|null=null,dialogGuard:VoiceGuard|null=null,closing:Promise<void>|null=null;
  let paused=false;const tickWaiters:(()=>void)[]=[];
  // 只保留最近一次电话故障的固定错误码和阶段，挂断清理后仍可诊断；不保留正文或音频。
  let lastDialogFault:{code:string;stage:string|null;causeCode:string|null}|null=null;
  const raw=(action:string,params:Record<string,unknown>={},timeoutMs=8000)=>bot.raw(action,params,{timeoutMs}) as Promise<PhoneGatewayView|null>;
  const enabled=()=>{try{return settings()?.enabled===true;}catch{return false;}};
  const modelReady=()=>{try{return ready()===true;}catch{return false;}};
  async function stopDialog(){const current=dialog;dialog=null;dialogCallId=null;dialogGuard=null;await current?.close();}
  async function stopPhone(){
    const dialogStopped=stopDialog();
    if(!prepared&&!prepareUnknown&&!stopUnknown){await dialogStopped;return;}
    try{const result=await raw('close_phone');await dialogStopped;if(result?.localStopped!==true)throw fail('PHONE_STOP_UNCONFIRMED');
      prepared=false;prepareUnknown=false;stopUnknown=false;status=null;phase=closed?'closed':'disabled';failureCode=null;
    }catch{await dialogStopped.catch(()=>{});stopUnknown=true;phase='stop_unconfirmed';failureCode='PHONE_STOP_UNCONFIRMED';throw fail(failureCode);}
  }
  const currentCall=()=>status?.call;
  const scoped=(key:unknown,id:unknown)=>privateKey(key)&&currentCall()?.key===key&&currentCall()?.callId===id;
  async function tick(){
    if(closed||paused||busy)return;busy=true;
    try{
      if(!enabled()){await stopPhone();if(!stopUnknown)phase='disabled';return;}
      if(!modelReady()||bot.isConnected!==true){
        if(dialog){const call=currentCall(),stopped=stopDialog();
          if(bot.isConnected===true&&callId(call?.callId)&&privateKey(call!.key))
            await raw('end_phone_call',{key:call!.key,call_id:call!.callId,reason:'technical_error'}).catch(()=>{});
          await stopped;}
        phase='waiting_resources';return;
      }
      if(stopUnknown){phase='stop_unconfirmed';return;}
      if(!prepared&&!prepareUnknown){
        const baseline=await raw('phone_poll');if(closed||paused)return;
        if(baseline?.enabled===true)prepared=true;
        else{
          phase='preparing';prepareUnknown=true;
          try{const result=await raw('prepare_phone',{auto_answer:settings()?.autoAnswer!==false},15000);
            if(result?.accepted!==true)throw fail('PHONE_PREPARE_UNCONFIRMED');prepared=true;prepareUnknown=false;
          }catch{failureCode='PHONE_PREPARE_UNCONFIRMED';}
          if(closed||paused)return;
        }
      }
      const next=await raw('phone_poll');
      if(closed||paused)return;
      if(!next||typeof next.enabled!=='boolean')throw fail('PHONE_STATUS_UNCONFIRMED');
      if(prepareUnknown){
        if(next.enabled===true){prepared=true;prepareUnknown=false;failureCode=null;}
        else{phase='prepare_unconfirmed';return;}
      }
      status=next;lastStatusAt=clock();phase=next.enabled?(next.phase??'ready'):'unavailable';
      if(!next.enabled&&next.localStopped===true){prepared=false;await stopDialog();return;}
      const call=next.call;
      if(dialog && (!call?.connected||call.callId!==dialogCallId)){await stopDialog();}
      if(call?.connected && callId(call.callId) && privateKey(call!.key)){
        if(!dialog){
          const base=captureGuard(call.key),id=call.callId,key=call.key;
          const callGuard=():undefined=>{base();if(closed||paused||!enabled()||!modelReady()||clock()-lastStatusAt>5000||!scoped(key,id)||!currentCall()?.connected)
            throw fail('PHONE_CALL_STALE');};dialogGuard=callGuard;callGuard();
          const end=async (reason:string)=>{callGuard();return raw('end_phone_call',{key,call_id:id,reason});};
          dialog=makeDialog({callId:id,key,voice,model,isCurrent:()=>{try{callGuard();return true;}catch{return false;}},
            sendPcm:async bytes=>{callGuard();const result=await raw('write_phone_audio',{call_id:id,data:bytes.toString('base64')});callGuard();return result;},
            clearPcm:async()=>{callGuard();return raw('clear_phone_audio',{call_id:id});},
            pcmStatus:async()=>{callGuard();return raw('phone_media_status',{call_id:id});},endCall:end,
            onTranscript:(text,context)=>{callGuard();onTranscript(text,context);},onSpoken:(text,context)=>{callGuard();onSpoken(text,context);},
            onFault:({code,stage,causeCode})=>{try{callGuard();}catch{return;}failureCode='PHONE_DIALOG_FAILED';lastDialogFault={code,stage:stage??null,causeCode:causeCode??null};void end('technical_error').catch(()=>{});}});
          dialogCallId=id;
        }
        const guard=dialogGuard!;guard();
        const audio=await raw('read_phone_audio',{call_id:call.callId,max_frames:20});guard();
        if(audio?.call_id!==call.callId||typeof audio!.data!=='string'||audio!.data.length>51200||audio!.sampleRate!==48000||audio!.channels!==1)
          throw fail('PHONE_AUDIO_UNCONFIRMED');
        const bytes=Buffer.from(audio!.data,'base64');
        if(bytes.toString('base64')!==audio!.data||bytes.length%1920||bytes.length>38400)throw fail('PHONE_AUDIO_UNCONFIRMED');
        if(bytes.length)dialog!.feed(bytes);
      }
    }catch{failureCode='PHONE_STATUS_UNCONFIRMED';phase=prepareUnknown?'prepare_unconfirmed':'connection_unconfirmed';}
    finally{busy=false;for(const resolve of tickWaiters.splice(0))resolve();}
  }
  function start(){if(closed||timer!==null)return;const schedule=()=>{timer=setTimer(async()=>{timer=null;await tick();if(!closed)schedule();},pollMs);timer?.unref?.();};schedule();}
  async function control(action:string,input:PhoneControlInput|null|undefined,guard:VoiceGuard){
    if(closed||typeof guard!=='function'||!privateKey(input?.key))throw fail('PHONE_NOT_ALLOWED');guard();
    if(action==='status'){return {enabled:enabled(),phase,incomingAvailable:status?.incomingAvailable===true,
      outgoingAvailable:status?.outgoingAvailable===true,call:currentCall()?.key===input!.key?currentCall():null,failureCode};}
    if(!enabled()||!prepared||prepareUnknown||stopUnknown)throw fail('PHONE_NOT_READY');
    if(action==='start'){
      if(status?.outgoingAvailable!==true)throw fail('CALL_OUTGOING_UNAVAILABLE');
      const value=await raw('start_phone_call',{key:input!.key});guard();return value;
    }
    if(!callId(input!.callId)||!scoped(input!.key,input!.callId))throw fail('CALL_STALE');
    if(action==='accept'){const result=await raw('accept_phone_call',{key:input!.key,call_id:input!.callId});guard();return result;}
    if(action==='end'){
      if(!['user_requested','conversation_done','needs_rest','uncomfortable','busy'].includes(input!.reason as string))throw fail('CALL_REASON_INVALID');
      const result=await raw('end_phone_call',{key:input!.key,call_id:input!.callId,reason:input!.reason});guard();return result;
    }
    throw fail('PHONE_INPUT_INVALID');
  }
  function close(){if(closing)return closing;closed=true;if(timer!==null)clearTimer(timer);timer=null;
    closing=(async()=>{if(busy)await new Promise<void>(resolve=>tickWaiters.push(resolve));await stopPhone();phase='closed';})();closing.catch(()=>{closing=null;});return closing;}
  async function reconcile(){paused=true;try{if(busy)await new Promise<void>(resolve=>tickWaiters.push(resolve));await stopPhone();}finally{paused=false;}}
  return Object.freeze({tick,start,control,close,reconcile,snapshot:()=>({closed,phase,prepared,prepareUnknown,
    stopUnknown,failureCode,busy,incomingAvailable:status?.incomingAvailable===true,outgoingAvailable:status?.outgoingAvailable===true,
    call:status?.call??null,activeCall:dialogCallId!==null,dialog:dialog?.snapshot()??null,lastDialogFault})});
}
