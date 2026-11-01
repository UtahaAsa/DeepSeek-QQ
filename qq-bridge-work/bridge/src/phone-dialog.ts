/// <reference types="node" />
import type {PhoneDialogOptions,PhoneHistory,PhoneHangupReason,DialogAudioView,DialogStatusView,DialogSegment,DialogSpeech,DialogReplyJob} from './voice/runtime-contracts.js';
import {setTimeout as delay} from 'node:timers/promises';
const fail=(code:string)=>Object.assign(new Error(code),{code});
const frameBytes=1920,frameMs=20;
const diagnosticCodes=new Set(['PHONE_PCM_UNAVAILABLE','PHONE_PCM_INPUT_INVALID','PHONE_PCM_PROCESS_FAILED','PHONE_PCM_TIMEOUT','PHONE_PCM_STOP_UNCONFIRMED','PHONE_PCM_CANCELLED','PHONE_PCM_OUTPUT_LIMIT',
  'PHONE_MODEL_OUTPUT_INVALID','PHONE_MODEL_UNAVAILABLE','PHONE_MODEL_CANCELLED','LOCAL_VOICE_UNAVAILABLE','VOICE_WARMING','PHONE_CALL_STALE','PHONE_DIALOG_MODEL_INVALID','PHONE_DIALOG_AUDIO_INVALID',
  'PHONE_DIALOG_PLAYBACK_TIMEOUT','PHONE_DIALOG_PLAYBACK_UNCONFIRMED','PHONE_DIALOG_ASR_INVALID','PHONE_DIALOG_TRANSCRIPT_LIMIT']);

/**
 * 一通已接通电话的VAD/ASR/模型/TTS播放器，全部媒体绑定当前callId和私聊权限。
 * @param {object} options voice复用现有PCM接口；model.reply只返回speech/hangupReason；
 * sendPcm/clearPcm/pcmStatus由当前电话驱动提供，endCall只接固定原因。
 * @returns {object} feed、close、snapshot、settled；feed只接48k单声道PCM16整帧。
 * @note 12秒分段识别，句末才交模型；插话取消旧回复并清空未提交声音。无QQ语音条、
 * 文件路径或原始SDK接口。缓冲有界，未知提交结果不重放；模型/声音迟到不会跨通话。
 */
export function createPhoneDialog({callId,key,voice,model,sendPcm,clearPcm,pcmStatus,endCall,isCurrent,
  onTranscript=()=>{},onSpoken=()=>{},onFault=()=>{},vadThreshold=180,silenceFrames=30,chunkFrames=600,
  maxQueuedSegments=4,playbackTailMs=120,wait=delay,clock=Date.now}:PhoneDialogOptions={} as PhoneDialogOptions) {
  if(!/^qqcall_[a-f0-9]{32}$/.test(callId??'')||!/^private:[1-9]\d{0,19}$/.test(key??'')
      ||!voice||!model||typeof voice.transcribePcm!=='function'||typeof voice.synthesizePcm!=='function'||typeof model.reply!=='function'
      ||![sendPcm,clearPcm,pcmStatus,endCall,isCurrent,onTranscript,onSpoken,onFault,wait,clock].every(v=>typeof v==='function')
      ||![vadThreshold,silenceFrames,chunkFrames,maxQueuedSegments,playbackTailMs].every(Number.isInteger)
      ||vadThreshold<1||vadThreshold>5000||silenceFrames<10||silenceFrames>100||chunkFrames<20||chunkFrames>700
      ||maxQueuedSegments<1||maxQueuedSegments>8||playbackTailMs<0||playbackTailMs>1000)throw fail('PHONE_DIALOG_CONFIG_INVALID');
  const abort=new AbortController(),history:PhoneHistory[]=[],queue:DialogSegment[]=[],pre:Buffer[]=[];
  const counts={asrSegments:0,modelTurns:0,spoken:0,interruptions:0};
  let closed=false,faultCode:string|null=null,voiceFrames=0,nextId=0,latestId=0,speech:DialogSpeech|null=null,asrWork:Promise<void>|null=null,replyWork:Promise<void>=Promise.resolve(),replyJob:DialogReplyJob|null=null;
  let currentTranscript:{id:number;text:string[]}={id:0,text:[]},clearWork:Promise<void>=Promise.resolve();
  let faultStage:string|null=null,faultCauseCode:string|null=null;
  const guard=():undefined=>{let current=false;try{current=isCurrent()===true;}catch{}if(closed||abort.signal.aborted||!current)throw fail('PHONE_DIALOG_STALE');};
  function fault(code:string,error?:unknown,stage:string|null=null){if(closed||faultCode)return;faultCode=code;faultStage=stage;
    const detail=error as {code?:unknown;message?:unknown}|null,cause=detail?.code??detail?.message;
    faultCauseCode=typeof cause==='string'&&diagnosticCodes.has(cause)?cause:null;
    abort.abort();replyJob?.abort.abort();clearBuffers();try{onFault({code,stage:faultStage,causeCode:faultCauseCode});}catch{}}
  function clearBuffers(){for(const b of pre)b.fill(0);pre.length=0;if(speech)for(const b of speech.frames)b.fill(0);speech=null;
    for(const s of queue)for(const b of s.frames)b.fill(0);queue.length=0;}
  function interrupt(){if(!replyJob||replyJob.abort.signal.aborted)return;
    replyJob.abort.abort();counts.interruptions++;
    clearWork=clearWork.then(async()=>{guard();const result=await clearPcm() as DialogStatusView|null;guard();
      if(!Number.isInteger(result?.clearedFrames)||(result!.clearedFrames as number)<0)throw fail('PHONE_DIALOG_CLEAR_UNCONFIRMED');
    }).catch(()=>{if(!closed&&!abort.signal.aborted)fault('PHONE_DIALOG_CLEAR_FAILED');});}
  const append=(role:string,text:string)=>{history.push({role,text});while(history.length>12)history.shift();};
  function beginReply(text:string,past:PhoneHistory[]){
    const job:DialogReplyJob={abort:new AbortController(),phase:'model'};replyJob?.abort.abort();replyJob=job;
    const cancel=()=>job.abort.abort();abort.signal.addEventListener('abort',cancel,{once:true});
    const current=():undefined=>{guard();if(job.abort.signal.aborted||replyJob!==job)throw fail('PHONE_DIALOG_CANCELLED');};
    const task=replyWork.then(async()=>{
      await clearWork;current();counts.modelTurns++;const response=await model.reply({callId,key,text,history:past,signal:job.abort.signal,guard:current}) as {speech?:unknown;hangupReason?:unknown}|null;current();
      if(!response||typeof response.speech!=='string'||Array.from(response.speech).length>80
          ||response.hangupReason!==null&&!['user_requested','conversation_done','needs_rest','uncomfortable','busy'].includes(response.hangupReason as string))
        throw fail('PHONE_DIALOG_MODEL_INVALID');
      if(response.speech){
        job.phase='tts';const result=await voice.synthesizePcm(response.speech,current,{signal:job.abort.signal}) as DialogAudioView|null;
        if(!result||result.sampleRate!==48000||result.channels!==1||!Buffer.isBuffer(result.pcm)
            ||!result.pcm.length||result.pcm.length%frameBytes||result.pcm.length>48000*2*45)throw fail('PHONE_DIALOG_AUDIO_INVALID');
        job.phase='playing';const deadline=clock()+result.pcm.length/96+10000;
        try{
          current();
          for(let offset=0;offset<result.pcm.length;){
            current();if(clock()>deadline)throw fail('PHONE_DIALOG_PLAYBACK_TIMEOUT');
            const bytes=result.pcm.subarray(offset,Math.min(result.pcm.length,offset+frameBytes*10)),receipt=await sendPcm(bytes) as DialogStatusView|null;current();
            if(receipt?.accepted===true)offset+=bytes.length;
            else if(receipt?.accepted===false&&receipt.reason==='backpressure')await wait(40,undefined,{signal:job.abort.signal});
            else throw fail('PHONE_DIALOG_PLAYBACK_UNCONFIRMED');
          }
          for(;;){current();if(clock()>deadline)throw fail('PHONE_DIALOG_PLAYBACK_TIMEOUT');const status=await pcmStatus() as DialogStatusView|null;current();
            if(!status||status.phase!=='running'||!Number.isInteger(status.queuedTxFrames)||(status.queuedTxFrames as number)<0)throw fail('PHONE_DIALOG_PLAYBACK_UNCONFIRMED');
            if(status.queuedTxFrames===0)break;await wait(40,undefined,{signal:job.abort.signal});}
          if(playbackTailMs)await wait(playbackTailMs,undefined,{signal:job.abort.signal});current();
          append('assistant',response.speech);counts.spoken++;onSpoken(response.speech,{callId,key});
        }finally{result.pcm.fill(0);}
      }
      if(response.hangupReason){current();job.phase='ending';await endCall(response.hangupReason as PhoneHangupReason);}
    }).catch(error=>{if(!closed&&!abort.signal.aborted&&!job.abort.signal.aborted)fault('PHONE_DIALOG_REPLY_FAILED',error,job.phase);})
      .finally(()=>{abort.signal.removeEventListener('abort',cancel);if(replyJob===job)replyJob=null;});
    replyWork=task;return task;
  }
  function pump(){if(asrWork||!queue.length||closed||faultCode)return;
    const task=(async()=>{while(queue.length&&!closed&&!faultCode){const item=queue.shift()!,bytes=Buffer.concat(item.frames);
      for(const b of item.frames)b.fill(0);
      try{guard();let text:unknown='';if(bytes.length>=19200){counts.asrSegments++;text=await voice.transcribePcm(bytes,guard,{signal:abort.signal});guard();}
        if(typeof text!=='string'||text.length>2000)throw fail('PHONE_DIALOG_ASR_INVALID');
        if(currentTranscript.id!==item.id)currentTranscript={id:item.id,text:[]};
        if(text.trim()){if(currentTranscript.text.join(' ').length+text.length>2000)throw fail('PHONE_DIALOG_TRANSCRIPT_LIMIT');currentTranscript.text.push(text.trim());}
        if(item.last){const heard=currentTranscript.text.join(' ').trim();currentTranscript={id:0,text:[]};
          if(heard){const past=history.map(v=>({...v}));append('user',heard);onTranscript(heard,{callId,key});
            if(item.id===latestId&&(!speech||speech.speechFrames<10))beginReply(heard,past);}}
      }finally{bytes.fill(0);}}})().catch(error=>{if(!closed&&!abort.signal.aborted)fault('PHONE_DIALOG_ASR_FAILED',error,'asr');})
      .finally(()=>{if(asrWork===task)asrWork=null;pump();});asrWork=task;
  }
  function segment(last:boolean){if(!speech)return;
    if(speech.speechFrames<10&&last){for(const b of speech.frames)b.fill(0);return;}
    if(queue.length>=maxQueuedSegments){fault('PHONE_DIALOG_BACKPRESSURE');return;}
    queue.push({id:speech.id,frames:speech.frames,last});speech.frames=[];pump();
  }
  function feed(bytes:unknown){guard();if(faultCode)throw fail(faultCode);
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length%frameBytes||bytes.length>frameBytes*50){fault('PHONE_DIALOG_FRAME_INVALID');throw fail('PHONE_DIALOG_FRAME_INVALID');}
    for(let at=0;at<bytes.length;at+=frameBytes){
      const frame=Buffer.from(bytes.subarray(at,at+frameBytes));let power=0;for(let i=0;i<frameBytes;i+=2)power+=frame.readInt16LE(i)**2;
      const voiced=Math.sqrt(power/(frameBytes/2))>=vadThreshold;voiceFrames=voiced?voiceFrames+1:0;
      if(!speech){pre.push(frame);if(pre.length>10)pre.shift()!.fill(0);
        if(voiceFrames<3)continue;
        speech={id:++nextId,frames:pre.splice(0),speechFrames:voiceFrames,silent:0,interrupted:false};
      }else{speech.frames.push(frame);if(voiced)speech.speechFrames++;speech.silent=voiced?0:speech.silent+1;}
      if(speech.speechFrames>=10&&!speech.interrupted){latestId=speech.id;speech.interrupted=true;interrupt();}
      if(speech.frames.length>=chunkFrames)segment(false);
      if(!speech)break;
      if(speech.silent>=silenceFrames){segment(true);speech=null;voiceFrames=0;}
    }
  }
  async function settled(){for(;;){const a=asrWork,r=replyWork,c=clearWork;await a;await r;await c;if(!asrWork&&r===replyWork&&c===clearWork)return;}}
  async function close(){if(!closed){closed=true;abort.abort();replyJob?.abort.abort();clearBuffers();currentTranscript={id:0,text:[]};history.length=0;}
    await settled();}
  return Object.freeze({feed,settled,close,snapshot:()=>({...counts,closed,faultCode,faultStage,faultCauseCode,queuedSegments:queue.length,
    capturing:!!speech,replyPhase:replyJob?.phase??null,asrBusy:!!asrWork})});
}
