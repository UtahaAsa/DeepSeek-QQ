/**
 * 顺序执行停止媒体、等待助手退出、发送证据及停止SDK宿主。
 * @param {object} options 所属generation及固定回调；timeoutMs只限制助手观察，不代表退出。
 * @returns {function():Promise<void>} 并发调用共享promise；超时、异常、缺少回执均保持未确认。
 * @note 仅父子IPC固定字段；不访问设备、不自行终止进程。
 */
export function createWorkerShutdown({generation,begin,closeHelper,report,stopHost,timeoutMs=3500}) {
  let task;
  const bounded=async(operation,ms)=>{let timer;
    try{return await Promise.race([Promise.resolve().then(operation),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]);}
    finally{clearTimeout(timer);}
  };
  return function shutdown(){
    if(task)return task;
    // begin同步关闭媒体入口，后续清理安排到微任务，避免重入创建第二次清理。
    task=Promise.resolve().then(async()=>{
      let confirmed=false;
      try{const result=await bounded(closeHelper,timeoutMs);confirmed=result?.exited===true&&result.phase==='exited';}catch{}
      try{await bounded(()=>report({kind:'helper-exit',generation,confirmed}),500);}catch{}
      try{await stopHost(confirmed);}catch{}
    });
    try{begin();}catch{}
    return task;
  };
}

/**
 * 在父进程持有的worker对象上关联退出证据，worker退出本身不证明助手退出。
 * @param {object} worker 由父进程创建的子进程对象。
 * @param {string} generation 当前唯一代次。
 * @returns {object} confirmed只在单份有效回执和worker真实exit均出现后为true。
 * @note 同步事件观察；重复、迟到、错代消息不提升证据等级。
 */
export function observeHelperExit(worker,generation){
  let exited=false,seen=false,confirmed=false;
  worker.on('message',value=>{
    if(exited||value?.kind!=='helper-exit'||value.generation!==generation)return;
    confirmed=!seen&&value.confirmed===true;seen=true;
  });
  worker.once('exit',()=>{exited=true;});
  return Object.freeze({confirmed:()=>exited&&confirmed});
}
