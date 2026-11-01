/**
 * 将所属NTRTC混音回调接入原有20ms PCM队列；输入仍由现有进程播放流采集。
 * @param {object} host 固定本机宿主，构造不访问设备、不登记回调。
 * @returns {object} device/snapshot/mergeStatus/clear；在途原生缓冲也计入播放等待。
 */
export function createNtrtcPcmDevice(host){
 let lastError=null;
 const names=['prepareNtrtcPcm','writeNtrtcPcm','disarmNtrtcPcm','clearNtrtcPcm','ntrtcPcmMetadata'];
 if(!names.every(name=>typeof host?.[name]==='function'))throw Error('NTRTC_API_UNAVAILABLE');
 function snapshot(){
  const value=host.ntrtcPcmMetadata();
  if(!value||typeof value.registered!=='boolean'||!Number.isSafeInteger(value.queuedBytes)||value.queuedBytes<0||value.queuedBytes>192000||value.queuedBytes%2)throw Error('NTRTC_STATUS_UNCONFIRMED');
  return {...Object.fromEntries(['registered','queuedBytes','callbacks','acceptedCallbacks','consumedSamples','rejectedCallbacks','format0','format1','format2'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])),lastError};
 }
 function invoke(name,...args){try{return host[name](...args);}catch(error){lastError=/^NTRTC_[A-Z_]+$/.test(error?.code??'')?error.code:'NTRTC_OPERATION_UNCONFIRMED';throw error;}}
 return Object.freeze({
  device:{preparePcm:()=>invoke('prepareNtrtcPcm'),writePcm:bytes=>invoke('writeNtrtcPcm',bytes),
   // 原有SDK接收轮询仅用于时钟；实际ASR输入继续走所属进程loopback，不假造收到远端声音。
   readPcm:()=>Buffer.alloc(1920),disarmPcm:()=>invoke('disarmNtrtcPcm')},
  snapshot,
  mergeStatus(stream){const native=snapshot();return {...stream,queuedTxFrames:stream.queuedTxFrames+Math.ceil(native.queuedBytes/1920),nativeMix:native};},
  clear(streamResult){const bytes=host.clearNtrtcPcm();if(!Number.isSafeInteger(bytes)||bytes<0||bytes>192000||bytes%2)throw Error('NTRTC_CLEAR_UNCONFIRMED');return {clearedFrames:streamResult.clearedFrames+Math.ceil(bytes/1920)};},
 });
}
