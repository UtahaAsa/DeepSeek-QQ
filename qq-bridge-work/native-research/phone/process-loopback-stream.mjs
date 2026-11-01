import {spawn} from 'node:child_process';

const fail=code=>Object.assign(new Error(code),{code});
/**
 * 启动当前进程的受限播放流读取器；读取器只包含其父进程及子进程。
 * @param {object} options executable为已验证的固定程序，onAudio只接收20ms整数帧。
 * @returns {object} ready、close、snapshot；关闭依赖真实进程退出，不保存PCM。
 * @note 仅在当前授权电话期间使用；超限、意外退出或身份失效必须停止，不回退系统全局音频。
 */
export function createProcessLoopback({executable,onAudio,onFault,spawnImpl=spawn,timeoutMs=8000}={}) {
  if(typeof executable!=='string'||!executable||typeof onAudio!=='function'||typeof onFault!=='function'||
    typeof spawnImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw fail('LOOPBACK_CONFIG_INVALID');
  const child=spawnImpl(executable,['--stream'],{stdio:['ignore','pipe','ignore'],windowsHide:true});
  if(!child?.stdout||typeof child.once!=='function'||typeof child.kill!=='function')throw fail('LOOPBACK_START_FAILED');
  let phase='starting',pending=Buffer.alloc(0),started=false,exited=false,resolveReady,rejectReady,resolveExit,closing=null;
  let frameCount=0;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
  const exit=new Promise(resolve=>{resolveExit=resolve;});
  const timer=setTimeout(()=>fault('LOOPBACK_START_TIMEOUT'),timeoutMs);timer.unref?.();
  function fault(code){if(['stopping','exited','failed'].includes(phase))return;phase='failed';clearTimeout(timer);
    pending.fill(0);pending=Buffer.alloc(0);rejectReady(fail(code));try{onFault({code});}catch{}try{child.kill();}catch{}}
  child.stdout.on('data',chunk=>{
    if(!['starting','ready'].includes(phase))return;
    if(!Buffer.isBuffer(chunk)||chunk.length>262144||pending.length+chunk.length>262144){fault('LOOPBACK_BACKPRESSURE');return;}
    pending=Buffer.concat([pending,chunk]);
    if(!started){if(pending.length<4)return;if(pending.subarray(0,4).toString('ascii')!=='PLB1'){fault('LOOPBACK_PROTOCOL_INVALID');return;}
      pending=pending.subarray(4);started=true;phase='ready';clearTimeout(timer);resolveReady(snapshot());}
    while(pending.length>=1920&&phase==='ready'){
      const frames=Math.min(Math.floor(pending.length/1920),10),size=frames*1920;
      const block=Buffer.from(pending.subarray(0,size));pending=pending.subarray(size);frameCount+=frames;
      try{onAudio(block);}catch{block.fill(0);fault('LOOPBACK_CONSUMER_FAILED');return;}
    }
  });
  child.stdout.once('error',()=>fault('LOOPBACK_STREAM_FAILED'));
  child.once('error',()=>fault('LOOPBACK_START_FAILED'));
  child.once('exit',()=>{const unexpected=!['stopping','failed'].includes(phase);exited=true;phase='exited';clearTimeout(timer);
    pending.fill(0);pending=Buffer.alloc(0);if(!started)rejectReady(fail('LOOPBACK_START_FAILED'));resolveExit();
    if(unexpected)try{onFault({code:'LOOPBACK_EXIT_UNEXPECTED'});}catch{} });
  function close(){if(closing)return closing;closing=(async()=>{if(exited)return snapshot();phase='stopping';clearTimeout(timer);
    try{child.kill();}catch{};let timeout;
    const finished=await Promise.race([exit.then(()=>true),new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),3000);})]);
    clearTimeout(timeout);if(!finished)throw fail('LOOPBACK_STOP_UNCONFIRMED');return snapshot();})();return closing;}
  function snapshot(){return{phase,started,exited,frameCount};}
  return Object.freeze({ready,close,snapshot});
}
