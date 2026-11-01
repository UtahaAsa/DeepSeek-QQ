import {createProcessLoopback} from './process-loopback-stream.mjs';
const fail=code=>Object.assign(new Error(code),{code});
/**
 * 将所属进程音频绑定至当前通话，并保留本worker所有助手的退出证据。
 * @param {object} options 固定程序、当前通话守卫、音频及故障回调；makeStream供隔离测试。
 * @returns {object} start/close/snapshot；close幂等，只有全部助手真实退出才返回exited。
 * @note 单线程异步；失败的退出观察不能被下一助手覆盖，无原生操作重试。
 */
export function createLoopbackCallRouter({executable,isCurrent,onAudio,onFault,makeStream=createProcessLoopback}={}){
  if(typeof executable!=='string'||!executable||![isCurrent,onAudio,onFault,makeStream].every(x=>typeof x==='function'))throw fail('LOOPBACK_CONFIG_INVALID');
  let active=null,closing=null,uncertain=false,started=0,exited=0;
  const evidence=()=>({phase:!uncertain&&started===exited?'exited':'unconfirmed',exited:!uncertain&&started===exited});
  function valid(entry){try{return active===entry&&isCurrent(entry.lease)===true;}catch{return false;}}
  function closeEntry(entry){
    if(entry.closeTask)return entry.closeTask;
    entry.closeTask=Promise.resolve().then(async()=>{
      try{const result=await entry.stream?.close();
        if(result?.exited===true&&result.phase==='exited')exited++;else uncertain=true;
      }catch(error){uncertain=true;throw error;}
    });return entry.closeTask;
  }
  async function start(lease){
    if(active||closing||uncertain||!lease||isCurrent(lease)!==true)throw fail('LOOPBACK_CALL_STALE');
    const entry={lease,stream:null,phase:'starting',closeTask:null};active=entry;
    try{
      started++;
      entry.stream=makeStream({executable,onAudio:bytes=>{if(!valid(entry)){bytes.fill(0);return;}onAudio(bytes,entry.lease);},
        onFault:value=>{if(active===entry){entry.phase='failed';onFault(value);}}});
      await entry.stream.ready;
      if(!valid(entry))throw fail('LOOPBACK_CALL_STALE');entry.phase='ready';return snapshot();
    }catch(error){
      if(active===entry)active=null;
      // 与关闭入口共用同一个清理promise，清理未完成时禁止新的助手进入。
      const cleanup=closeEntry(entry).then(evidence);if(!closing)closing=cleanup;
      try{await cleanup;}catch{}finally{if(closing===cleanup)closing=null;}
      throw error;
    }
  }
  function close(){
    if(closing)return closing;
    const entry=active;active=null;
    if(!entry)return Promise.resolve(evidence());
    const task=closeEntry(entry).then(evidence);closing=task;
    task.finally(()=>{if(closing===task)closing=null;}).catch(()=>{});return task;
  }
  function snapshot(){return{phase:active?.phase??(closing?'stopping':'idle'),uncertain,started,exited};}
  return Object.freeze({start,close,snapshot});
}
