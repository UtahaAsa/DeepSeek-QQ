/// <reference types="node" />
import type {ChildProcess,SpawnOptions} from 'node:child_process';
/** 工人仅需这些事件/管道能力；pid与kill返回不能替代真实close。 */
export type PcmProcess=Pick<ChildProcess,'pid'|'kill'|'once'|'stdin'|'stdout'>;
export interface PhonePcmOptions {ffmpeg:string;tempRoot:string;spawnProcess?:(command:string,args:string[],options:SpawnOptions)=>PcmProcess;timeoutMs?:number;stopTimeoutMs?:number;}
interface PcmJob {actualExit:Promise<void>;cancel:()=>void;}
import {spawn} from 'node:child_process';
import path from 'node:path';
const fail=(code:string)=>Object.assign(new Error(code),{code});

/**
 * 将电话48k单声道PCM16转换为ASR的16k PCM，或将已选TTS生成的WAV转换为48k PCM。
 * @param {object} options ffmpeg来自本机已验证资源配置；不接受调用方格式、协议或CLI参数。
 * @returns {object} convert(bytes,'asr'|'tts',{signal})、close、snapshot；所有媒体仅走管道。
 * @note 最多两项作业，输出有界；只开放pipe协议。取消后等待所属进程真实close，
 * 停止超时明确失败并保留作业占位，不把kill请求当作退出，不记录音频或stderr。
 */
export function createPhonePcmConverter({ffmpeg,tempRoot,spawnProcess=spawn,timeoutMs=10000,stopTimeoutMs=3000}:PhonePcmOptions) {
  if(!path.isAbsolute(ffmpeg??'') || !path.isAbsolute(tempRoot??'') || typeof spawnProcess!=='function'
      || ![timeoutMs,stopTimeoutMs].every(v=>Number.isInteger(v)&&v>0&&v<=60000))throw fail('PHONE_PCM_CONFIG_INVALID');
  let closed=false,failed=false;const jobs=new Set<PcmJob>();
  function convert(input:unknown,mode:'asr'|'tts',{signal}:{signal?:AbortSignal}={}):Promise<Buffer> {
    if(closed||failed||jobs.size>=2||signal?.aborted)return Promise.reject(fail('PHONE_PCM_UNAVAILABLE'));
    if(!Buffer.isBuffer(input)||!['asr','tts'].includes(mode)||input.length<1||input.length>5*1024*1024
        || mode==='asr' && (input.length%2 || input.length>48000*2*15 || input.length<19200)
        || mode==='tts' && (input.length<44||input.toString('ascii',0,4)!=='RIFF'||input.toString('ascii',8,12)!=='WAVE'))
      return Promise.reject(fail('PHONE_PCM_INPUT_INVALID'));
    const bytes=Buffer.from(input),rate=mode==='asr'?16000:48000,maxBytes=rate*2*45;
    const args=['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','pipe',
      ...(mode==='asr'?['-f','s16le','-ar','48000','-ac','1']:['-f','wav']),
      '-i','pipe:0','-map','0:a:0','-ac','1','-ar',String(rate),'-c:a','pcm_s16le','-f','s16le','pipe:1'];
    const env:NodeJS.ProcessEnv={...process.env,TEMP:tempRoot,TMP:tempRoot};
    for(const key of Object.keys(env))if(/KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|COOKIE/i.test(key))delete env[key];
    let child:PcmProcess;try{child=spawnProcess(ffmpeg,args,{windowsHide:true,stdio:['pipe','pipe','ignore'],env});}
    catch{bytes.fill(0);return Promise.reject(fail('PHONE_PCM_PROCESS_FAILED'));}
    let resolveExit!:()=>void;const actualExit=new Promise<void>(resolve=>{resolveExit=resolve;});
    const job={actualExit,cancel:()=>{}};jobs.add(job);
    return new Promise<Buffer>((resolve,reject)=>{
      const chunks:Buffer[]=[];let total=0,settled=false,exited=false,errorCode:string|null=null,killTimer:ReturnType<typeof setTimeout>|null=null;
      const clear=()=>{clearTimeout(deadline);clearTimeout(killTimer!);signal?.removeEventListener('abort',abort);};
      function finishError(code:string){for(const chunk of chunks)chunk.fill(0);chunks.length=0;
        if(!settled){settled=true;reject(fail(code));}}
      function cancel(code='PHONE_PCM_CANCELLED') {
        errorCode??=code;if(exited)return;
        try{child.kill();}catch{}
        if(killTimer===null)killTimer=setTimeout(()=>{failed=true;clear();finishError('PHONE_PCM_STOP_UNCONFIRMED');},stopTimeoutMs);
      }
      job.cancel=()=>cancel();
      const abort=()=>cancel(),deadline=setTimeout(()=>cancel('PHONE_PCM_TIMEOUT'),timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      child.stdout!.on('data',(chunk:Buffer)=>{
        if(errorCode||settled)return;
        total+=chunk.length;if(total>maxBytes){cancel('PHONE_PCM_OUTPUT_LIMIT');return;}chunks.push(Buffer.from(chunk));
      });
      child.stdin!.on('error',()=>{if(!exited)cancel('PHONE_PCM_PROCESS_FAILED');});
      const done=(code:number|null)=>{
        if(exited)return;exited=true;clear();bytes.fill(0);jobs.delete(job);resolveExit();
        // 只有全部所属进程已真实退出，才解除停止未知的阻塞；close()仍永久禁止新作业。
        if(jobs.size===0)failed=false;
        if(errorCode||code!==0||total<2||total%2){finishError(errorCode??'PHONE_PCM_PROCESS_FAILED');return;}
        if(!settled){settled=true;const output=Buffer.concat(chunks);for(const chunk of chunks)chunk.fill(0);resolve(output);}
      };
      child.once('error',()=>{if(!child.pid){errorCode='PHONE_PCM_PROCESS_FAILED';done(null);}else cancel('PHONE_PCM_PROCESS_FAILED');});
      child.once('close',done);
      child.stdin!.end(bytes);
      if(signal?.aborted)abort();
    });
  }
  async function close() {
    closed=true;for(const job of jobs)job.cancel();let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([Promise.all([...jobs].map(job=>job.actualExit)),new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(fail('PHONE_PCM_STOP_UNCONFIRMED')),stopTimeoutMs);
    })]);}finally{clearTimeout(timer);}
  }
  return Object.freeze({convert,close,snapshot:()=>({closed,failed,activeProcesses:jobs.size})});
}
