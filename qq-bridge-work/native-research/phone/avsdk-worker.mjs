// 只供avsdk-worker-client通过父子IPC启动；不监听网络、不接受CLI账号或任意SDK命令。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPcmStream } from './pcm-stream.mjs';
import { createNtrtcPcmDevice } from './ntrtc-pcm-device.mjs';
import { waitForAudioEngine } from './audio-engine-ready.mjs';
import { createCallProtocol } from './call-protocol.mjs';
import { createLoopbackCallRouter } from './loopback-call-router.mjs';
import { createWorkerShutdown } from './worker-shutdown.mjs';
import { createSignalShapeObserver } from './signal-shape-observer.mjs';

if (!process.connected || process.argv.length !== 2) throw Error('PHONE_WORKER_OWNER_REQUIRED');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root,'avsdk-offline-probe/audio-node');
const profile = process.cwd();
const relativeProfile = path.relative(path.join(root,'avsdk-offline-probe/profile/private-worker'),profile);
if (path.isAbsolute(relativeProfile) || relativeProfile === '..' || relativeProfile.startsWith('..'+path.sep)
    || !/^[a-f0-9-]{36}$/.test(relativeProfile)) throw Error('PHONE_WORKER_PROFILE_REFUSED');
const manifest = JSON.parse(fs.readFileSync(path.join(folder,'node-host-manifest.json'),'utf8'));
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const loopbackExecutable=path.join(root,'phone/process-loopback-stream-candidate.exe');
if(digest(loopbackExecutable)!=='202a35e76f672ad7cbbd849e468c42cc4fc0d5ec0d7e0b55dd2ff8393efa9997')throw Error('PHONE_LOOPBACK_BASELINE_CHANGED');
const sdk = 'C:/Program Files/Tencent/QQNT/versions/9.9.35-52892/resources/app/avsdk/AVSDKPlugin.dll';
if (digest(process.execPath) !== manifest.nodeSha256 || digest(path.join(folder,'avsdk-host.node')) !== manifest.hostSha256
    || digest(sdk) !== 'b9b2f9d61c7205b9f446aa92bb5784319121efd07fe2889ddf8b9a04b719e6b5'
    || digest(path.join(path.dirname(sdk),'liteav.dll')) !== '364ddd0710372d60e2654a8ddb253a733bded247dab84bd6ec9c9388ddbf9d15')
  throw Error('PHONE_WORKER_BASELINE_CHANGED');
for (const [name,hash] of Object.entries(manifest.shimSha256))
  if (!['QQNT.dll','loader.node'].includes(name) || digest(path.join(folder,name)) !== hash) throw Error('PHONE_WORKER_SHIM_CHANGED');
for (const [name,hash] of Object.entries(manifest.sourceSha256))
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || digest(path.join(folder,'..',name)) !== hash) throw Error('PHONE_WORKER_SOURCE_CHANGED');
const loader = {exports:{}}; process.dlopen(loader,path.join(folder,'loader.node'));
if (loader.exports.ready !== true) throw Error('PHONE_WORKER_SHIM_UNCONFIRMED');
const candidate=path.join(root,'phone/ntrtc-close-candidate');
const candidateManifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json'),'utf8'));
if(candidateManifest.nodeSha256!==digest(process.execPath)||candidateManifest.hostSha256!==digest(path.join(candidate,'avsdk-host.node')))throw Error('NTRTC_HOST_CHANGED');
for(const [name,expected] of Object.entries(candidateManifest.sources)){
 if(!['node-host.cpp','ntrtc-pcm.hpp','private-signaling.hpp'].includes(name)||digest(path.join(candidate,name))!==expected)throw Error('NTRTC_SOURCE_CHANGED');
}
const addon = {exports:{}}; process.dlopen(addon,path.join(candidate,'avsdk-host.node'));
const host = addon.exports;
if (host.startOffline() !== true || host.armPrivateSignals() !== true)
  throw Error('PHONE_WORKER_START_FAILED');

const ntrtc=createNtrtcPcmDevice(host);
let stopping = false, bindSubmitted = false, pendingOutput = 0, pcm = null, mediaLease = null;
let requests = 0, relayed = 0, sdkMessages = 0;
let lastContractRecord=0,roomEnterCode=null,roomLeftSeen=false,nonSilentRxFrames=0,audioEngineReady=false,mediaPrepareFailure=null;
let lastSdkRecord=0;const sdkCommandCounts={},kernelActionTypes={};
const observedCommands=new Set([1,4,5,8,9,10,55,20001,20004,20005,20006,20007,20011,20050,120043]);
const signalShapes = createSignalShapeObserver();
const send = value => {
  if (!process.connected || pendingOutput >= 48) { shutdown(); return false; }
  pendingOutput++;
  try { process.send(value,error => { pendingOutput--; if (error) shutdown(); }); return true; }
  catch { pendingOutput--; shutdown(); return false; }
};
const shutdown = createWorkerShutdown({
  generation: relativeProfile,
  begin: () => { stopping = true; mediaLease = null; pcm?.stop(); clearInterval(pollTimer); recordContract(true); recordSdk(true); },
  closeHelper: () => loopback.close(),
  report: value => new Promise(resolve => {
    if (!process.connected) { resolve(false); return; }
    try { process.send(value, error => resolve(!error)); } catch { resolve(false); }
  }),
  stopHost: confirmed => { try { host.stop(); } finally { process.exit(confirmed ? 0 : 2); } }
});
const validLease = value => value && ['generation','ref'].every(key =>
  typeof value[key] === 'string' && /^[A-Za-z0-9_:-]{8,160}$/.test(value[key]))
  && Number.isSafeInteger(value.revision) && value.revision >= 0;
const matchingLease = value => mediaLease && validLease(value) && value.generation === mediaLease.generation
  && value.ref === mediaLease.ref && value.revision === mediaLease.revision;
const loopback=createLoopbackCallRouter({executable:loopbackExecutable,
  isCurrent:lease=>!stopping&&mediaLease===lease&&pcm?.snapshot().phase==='running',
  onAudio:(bytes,lease)=>{
    for(let at=0;at<bytes.length;at+=1920){let power=0;for(let index=at;index<at+1920;index+=2){const sample=bytes.readInt16LE(index);power+=sample*sample;}
      if(power/960>=180*180)nonSilentRxFrames++;}
    if(!send({kind:'audio',lease,bytes}))shutdown();
  },
  onFault:()=>{if(!stopping){send({kind:'media_fault',code:'PHONE_PCM_STOPPED'});shutdown();}}});
const callProtocol = createCallProtocol({generation:relativeProfile,submit:(operation,params) => host.submitPrivateSignal(operation,params),
  onAcceptRequested:()=>{
    // NTRTC发送器在入房后才存在；不准备不属于当前QQ通话的TRTC共享实例。
    if(host.ntrtcPcmMetadata().registered)throw Error('PHONE_AUDIO_ALREADY_OWNED');
  },
  onEndRequested:()=>{mediaLease=null;pcm?.stop();void loopback.close().catch(shutdown);},
  emit:event => {
    if (event.type === 'ended') {mediaLease=null;pcm?.stop();void loopback.close().catch(shutdown);}
    send({kind:'call_event',event});
  }});
// 只保存已验证邀请的枚举/长度和音频计数，不保存UID、关系值、DSP文本、转写或PCM。
function recordContract(force=false){
  if(!force&&Date.now()-lastContractRecord<3000)return;
  const p=callProtocol.snapshot();if(!p.inviteContract)return;
  const a=pcm?.snapshot();lastContractRecord=Date.now();
  const value={checkedAtUtc:new Date().toISOString(),kind:'bounded_phone_contract_metadata',phase:p.phase,
    inviteContract:p.inviteContract,roomEnterCode,roomLeftSeen,nonSilentRxFrames,audioEngineReady,mediaPrepareFailure,nativeMix:ntrtc.snapshot(),
    audio:a?Object.fromEntries(['phase','reason','sentFrames','receivedFrames','silentFrames','lateTicks'].map(key=>[key,a[key]])):null};
  try{const target=path.join(profile,'phone-contract-metadata.json');fs.writeFileSync(target+'.next',JSON.stringify(value,null,2)+'\n');fs.renameSync(target+'.next',target);}catch{}
}
function recordSdk(force=false){
  if(!force&&Date.now()-lastSdkRecord<3000)return;lastSdkRecord=Date.now();
  const p=callProtocol.snapshot(),value={checkedAtUtc:new Date().toISOString(),kind:'bounded_sdk_signal_shape_metadata',
    bindSubmitted,loginConfirmed:p.loginConfirmed,phase:p.phase,privateCommandsRelayed:relayed,sdkMessages,
    sdkCommandCounts,kernelActionTypes,lastInviteShape:p.lastInviteShape,lastEndReceipt:p.lastEndReceipt,lastTerminalEvent:p.lastTerminalEvent,
    signalShapes:signalShapes.snapshot()};
  try{const target=path.join(profile,'sdk-signal-metadata.json');fs.writeFileSync(target+'.next',JSON.stringify(value,null,2)+'\n');fs.renameSync(target+'.next',target);}catch{}
}
process.on('message',async request => {
  if (stopping || !request || !Number.isSafeInteger(request.id) || request.id <= 0) return;
  const {id,operation} = request;
  requests++;
  try {
    if (operation === 'stop') { shutdown(); return; }
    if (operation === 'status') {
      send({kind:'receipt',id,ok:true,value:{bindSubmitted,relayed,sdkMessages,pcm:pcm?.snapshot() ?? null,call:callProtocol.snapshot()}}); return;
    }
    if (operation === 'bind') {
      const {uid,uin} = request;
      if (bindSubmitted || typeof uid !== 'string' || !/^u_[A-Za-z0-9_-]{1,128}$/.test(uid)
          || typeof uin !== 'string' || !/^[1-9]\d{0,19}$/.test(uin)) throw Error();
      const accountCache = path.join(profile,'owned-sdk-cache'); fs.mkdirSync(accountCache,{recursive:true});
      const correlation = host.submitPrivateSignal('login',[uid,uin,uin,accountCache,'']);
      callProtocol.bind(uid,correlation);
      bindSubmitted = true; send({kind:'receipt',id,ok:true,value:{outcome:'accepted',correlation}}); return;
    }
    if (operation === 'kernel_action') {
      if (!bindSubmitted || !Number.isInteger(request.actionType) || request.actionType < 0 || request.actionType > 2147483647
          || typeof request.payload !== 'string' || Buffer.byteLength(request.payload) > 256*1024 || request.payload.includes('\0')) throw Error();
      const correlation = host.submitPrivateSignal('kernel_action',[request.actionType,request.payload]);
      const candidate=request.actionType<=200000?String(request.actionType):'other';
      const type=Object.hasOwn(kernelActionTypes,candidate)||Object.keys(kernelActionTypes).length<32?candidate:'other';
      kernelActionTypes[type]=(kernelActionTypes[type]??0)+1;
      relayed++; send({kind:'receipt',id,ok:true,value:{outcome:'accepted',correlation}}); return;
    }
    if (operation === 'media_open') {
      if (!bindSubmitted || pcm && pcm.snapshot().phase !== 'stopped' || !validLease(request.lease)
          || request.lease.generation !== relativeProfile || !callProtocol.canOpenMedia(request.lease)) throw Error();
      mediaLease = Object.freeze({...request.lease}); const lease = mediaLease;
      try {await waitForAudioEngine({isReady:()=>audioEngineReady,isCurrent:()=>!stopping&&mediaLease===lease&&callProtocol.canOpenMedia(lease)});}
      catch(error){mediaLease=null;mediaPrepareFailure=error.message==='PHONE_AUDIO_ENGINE_TIMEOUT'?'PHONE_AUDIO_ENGINE_TIMEOUT':'PHONE_AUDIO_LEASE_EXPIRED';recordContract(true);throw error;}
      const preparedDevice=ntrtc.device;
      pcm = createPcmStream({device:preparedDevice,lease,isLeaseCurrent:current => !stopping && mediaLease === lease
        && current.generation === lease.generation && current.ref === lease.ref && current.revision === lease.revision});
      try {pcm.start();}catch(error){recordContract(true);throw error;}
      try {
      const readyUntil=Date.now()+3000;
      while(!stopping&&mediaLease===lease&&ntrtc.snapshot().acceptedCallbacks===0&&Date.now()<readyUntil){
        if(ntrtc.snapshot().rejectedCallbacks>0){recordContract(true);throw Error('PHONE_NTRTC_FORMAT_UNCONFIRMED');}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      if(stopping||mediaLease!==lease||pcm.snapshot().phase!=='running'||ntrtc.snapshot().acceptedCallbacks===0){recordContract(true);throw Error('PHONE_NTRTC_CALLBACK_UNCONFIRMED');}
      } catch(error) {mediaLease=null;pcm.stop();recordContract(true);throw error;}
      try {await loopback.start(lease);} catch {mediaLease=null;pcm.stop();throw Error('PHONE_LOOPBACK_UNAVAILABLE');}
      if(stopping||mediaLease!==lease)throw Error('PHONE_LOOPBACK_STALE');
      send({kind:'receipt',id,ok:true,value:{outcome:'accepted'}}); return;
    }
    if (operation === 'media_close') {
      if (!matchingLease(request.lease)) throw Error();
      mediaLease = null; const value = pcm?.stop() ?? {localStopped:host.disarmNtrtcPcm() === true};
      await loopback.close();
      send({kind:'receipt',id,ok:true,value}); return;
    }
    if (operation === 'media_write') {
      if (!pcm || !matchingLease(request.lease)) throw Error();
      send({kind:'receipt',id,ok:true,value:pcm.enqueue(request.bytes)}); return;
    }
    if(operation==='media_clear'||operation==='media_status'){
      if(!pcm||!matchingLease(request.lease))throw Error();
      send({kind:'receipt',id,ok:true,value:operation==='media_clear'?ntrtc.clear(pcm.clearTx()):ntrtc.mergeStatus(pcm.snapshot())});return;
    }
    if (operation === 'call_ignore') {
      if (!bindSubmitted || !validLease(request.lease) || request.lease.generation !== relativeProfile) throw Error();
      send({kind:'receipt',id,ok:true,value:callProtocol.ignore(request.lease)});return;
    }
    if (operation === 'call_accept' || operation === 'call_end') {
      if (!bindSubmitted || !validLease(request.lease) || request.lease.generation !== relativeProfile) throw Error();
      const value=operation === 'call_accept' ? callProtocol.accept(request.lease) : callProtocol.end(request.lease);
      if(operation==='call_end')await loopback.close();
      send({kind:'receipt',id,ok:true,value});return;
    }
    throw Error();
  } catch { send({kind:'receipt',id,ok:false,code:'PHONE_WORKER_REQUEST_REFUSED'}); }
});
process.on('disconnect',shutdown);
process.on('uncaughtException',shutdown);
process.on('unhandledRejection',shutdown);
const pollTimer = setInterval(() => {
  if (stopping) return;
  try {
    const metadata = host.pollMetadata();
    if (!metadata || metadata.droppedMessages || metadata.callbackFailures) throw Error();
    for (const message of host.drainPrivateSignals()) {
      if(message.cmd===20038&&Array.isArray(message.value)&&message.value.length===0)audioEngineReady=true;
      signalShapes.observe(message);
      sdkMessages++;
      const command=observedCommands.has(message.cmd)?String(message.cmd):'other';sdkCommandCounts[command]=(sdkCommandCounts[command]??0)+1;
      callProtocol.observe(message);
      if(message.cmd===20004&&callProtocol.snapshot().phase==='connected')roomEnterCode=Number.isInteger(message.value?.[0])?message.value[0]:null;
      if(message.cmd===20005&&callProtocol.snapshot().phase==='ended')roomLeftSeen=true;
      if([20006,20004,20005,20022].includes(message.cmd)){recordContract(true);recordSdk(true);}
      else if([8,9,10].includes(message.cmd)&&callProtocol.snapshot().lastEndReceipt)recordSdk(true);
      if (!send({kind:'sdk',message})) return;
    }
    if (pcm?.snapshot().phase === 'running') {
      // 原有SDK读取只为及时清空其有界队列，实际输入只走所属进程的播放流。
      const bytes = pcm.drain(25);bytes.fill(0);
      recordContract();
    } else if (pcm && pcm.snapshot().reason !== 'requested') {
      send({kind:'media_fault',code:'PHONE_PCM_STOPPED'}); shutdown();
    }
    recordSdk();
  } catch { send({kind:'fault',code:'PHONE_WORKER_SIGNAL_FAILED'}); shutdown(); }
},20);
send({kind:'ready',audioApiReady:true,accountBindSubmitted:false,signalingReady:false,
  actualCallVerified:false,requests});
