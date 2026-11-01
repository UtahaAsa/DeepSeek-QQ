/// <reference types="node" />
import type {ChildProcess,SpawnOptions} from 'node:child_process';
import type {IdleDraftDependencies} from '../idle-draft.js';
import type {NativeRecordSegment} from '../native-record-upload.js';
/** 权限、记账和审计均同步执行；异步工作必须显式返回Promise。 */
export type VoiceGuard=()=>undefined;
export interface VoiceSignalOptions {signal?:AbortSignal;}
export type VoiceProcess=Pick<ChildProcess,'pid'|'killed'|'kill'|'once'|'on'|'removeListener'|'stdin'|'stdout'|'stderr'>;
export type VoiceSpawner=(command:string,args:string[],options:SpawnOptions)=>VoiceProcess;
export interface VoiceBot {isConnected:boolean;raw:(action:string,params:Record<string,unknown>,options?:{timeoutMs:number})=>Promise<unknown>;}
export interface LocalVoiceOptions {bot:VoiceBot;dataRoot:string;receiveEnabled?:boolean;sendEnabled?:boolean;timeoutMs?:number;stopTimeoutMs?:number;spawnProcess?:VoiceSpawner;}
/** 只描述运行配置中已被旧代码使用的路径，不授予其它文件访问。 */
export interface VoiceRuntimePaths {python:string;engine:string;ffmpeg:string;pretrained:string;}
export type VoiceOperation='warmup'|'asr'|'tts'|'asr_pcm';
export interface VoiceParams {file?:string;text?:string;pcm?:string;receive?:boolean;send?:boolean;}
export interface WorkerResult {file?:unknown;text?:unknown;processingMs?:unknown;asrReady?:unknown;ttsReady?:unknown;warmupMs?:unknown;asrLoadMs?:unknown;ttsLoadMs?:unknown;[key:string]:unknown;}
export interface VoiceInferenceResult extends WorkerResult {id:string;}
export interface VoiceJob {id:string;op:VoiceOperation;params:VoiceParams;finish:(error:unknown,value?:WorkerResult|null)=>void;}
export interface VoicePacket {id?:unknown;ok?:unknown;error?:unknown;errorType?:unknown;progress?:{phase?:unknown;elapsedMs?:unknown};result?:WorkerResult|null;}
export interface VoiceWarmup {asrReady:boolean;ttsReady:boolean;warmupMs:number;asrLoadMs:number;ttsLoadMs:number;}
export interface PcmAudio {pcm:Buffer;sampleRate:48000;channels:1;frameMs:20;}
export interface VoiceActorSnapshot {phase:string;running?:boolean;failed?:boolean;receiveEnabled?:boolean;sendEnabled?:boolean;asrReady?:boolean;ttsReady?:boolean;queued?:number;busy?:boolean;elapsedMs?:number;warmupMs?:number|null;asrLoadMs?:number|null;ttsLoadMs?:number|null;lastProcessingMs?:number|null;}
export interface VoiceActorPort {warmup:()=>Promise<unknown>;close:()=>Promise<unknown>;snapshot:()=>VoiceActorSnapshot;transcribe:(handle:unknown)=>Promise<string>;synthesize:(key:string,text:unknown,guard:VoiceGuard,options?:VoiceSignalOptions)=>Promise<NativeRecordSegment>;transcribePcm:(bytes:Buffer,guard:VoiceGuard,options?:VoiceSignalOptions)=>Promise<string>;synthesizePcm:(text:unknown,guard:VoiceGuard,options?:VoiceSignalOptions)=>Promise<PcmAudio>;}
export interface VoiceManagerOptions extends LocalVoiceOptions {factory?:(options:LocalVoiceOptions)=>VoiceActorPort;}
export interface VoiceSwitchOperation {id:string;kind:'apply'|'restore';outcome:'running'|'applied'|'saved_disabled'|'cancelled'|'stop_failed'|'rolled_back'|'rollback_failed';error:string|null;}
export interface VoiceTransfer {native_record?:{file?:unknown;size?:unknown;sha256?:unknown};file?:unknown;size?:unknown;offset?:unknown;data?:unknown;upload?:unknown;}
export interface ControllerError {code?:unknown;message?:unknown;}
export interface PhoneHistory {role:string;text:string;}
export interface PhoneReplyRequest {callId?:string;key:string;text:unknown;history?:unknown;signal?:AbortSignal;guard:VoiceGuard;}
export type PhoneHangupReason='user_requested'|'conversation_done'|'needs_rest'|'uncomfortable'|'busy';
export interface PhoneReply {speech:string;hangupReason:PhoneHangupReason|null;}
export interface PhoneModelOptions {lifecycle:IdleDraftDependencies;roleHint?:(key:string)=>string;context?:(key:string)=>string;audit?:(text:string,key:string)=>undefined;}
export interface PhoneVoicePort {transcribePcm:(bytes:Buffer,guard:VoiceGuard,options:VoiceSignalOptions)=>Promise<unknown>;synthesizePcm:(text:string,guard:VoiceGuard,options:VoiceSignalOptions)=>Promise<unknown>;}
export interface PhoneModelPort {reply:(request:PhoneReplyRequest)=>Promise<unknown>;}
export interface PhoneContext {callId:string;key:string;}
export type PhoneWait=(ms:number,value?:undefined,options?:{signal:AbortSignal})=>Promise<unknown>;
export interface PhoneDialogOptions extends PhoneContext {
 voice:PhoneVoicePort;model:PhoneModelPort;sendPcm:(bytes:Buffer)=>Promise<unknown>;clearPcm:()=>Promise<unknown>;pcmStatus:()=>Promise<unknown>;endCall:(reason:PhoneHangupReason)=>Promise<unknown>;isCurrent:()=>boolean;
 onTranscript?:(text:string,context:PhoneContext)=>undefined;onSpoken?:(text:string,context:PhoneContext)=>undefined;onFault?:(failure:{code:string;stage?:string|null;causeCode?:string|null})=>undefined;
 vadThreshold?:number;silenceFrames?:number;chunkFrames?:number;maxQueuedSegments?:number;playbackTailMs?:number;wait?:PhoneWait;clock?:()=>number;
}
export interface DialogAudioView {sampleRate?:unknown;channels?:unknown;pcm?:unknown;}
export interface DialogStatusView {clearedFrames?:unknown;accepted?:unknown;reason?:unknown;phase?:unknown;queuedTxFrames?:unknown;}
export interface DialogSegment {id:number;frames:Buffer[];last:boolean;}
export interface DialogSpeech {id:number;frames:Buffer[];speechFrames:number;silent:number;interrupted:boolean;}
export interface DialogReplyJob {abort:AbortController;phase:'model'|'tts'|'playing'|'ending';}
/** 网关载荷仅在现有条件判断处投影，不能把poll受理当成已连通。 */
export interface PhoneGatewayView {enabled?:unknown;accepted?:unknown;localStopped?:unknown;phase?:unknown;incomingAvailable?:unknown;outgoingAvailable?:unknown;call?:{key?:unknown;callId?:unknown;connected?:unknown}|null;call_id?:unknown;data?:unknown;sampleRate?:unknown;channels?:unknown;}
export interface PhoneDialogPort {close:()=>Promise<unknown>;feed:(bytes:Buffer)=>void;snapshot:()=>unknown;}
export interface PhoneManagerOptions {bot:VoiceBot;voice:PhoneVoicePort;model:PhoneModelPort;settings:()=>{enabled?:unknown;autoAnswer?:unknown}|null|undefined;ready:()=>boolean;captureGuard:(key:string)=>VoiceGuard;onTranscript?:(text:string,context:PhoneContext)=>undefined;onSpoken?:(text:string,context:PhoneContext)=>undefined;makeDialog?:(options:PhoneDialogOptions)=>PhoneDialogPort;pollMs?:number;clock?:()=>number;setTimer?:typeof setTimeout;clearTimer?:typeof clearTimeout;}
export interface PhoneControlInput {key?:unknown;callId?:unknown;reason?:unknown;}
export interface SingingRequest {id:string;op:'convert';pitch:unknown;backingGain:number;}
export interface SingingWorkerOptions {root:string;spawnProcess?:VoiceSpawner;timeoutMs?:number;idleMs?:number;}
export interface SingingWorkerPort {convert:(request:SingingRequest)=>Promise<unknown>;close:()=>Promise<unknown>;snapshot:()=>{phase:string;busy?:boolean;running?:boolean};}
export interface SingingOptions {root:string;worker?:SingingWorkerPort;upload?:(bytes:Buffer,key:string,guard:VoiceGuard)=>Promise<NativeRecordSegment>;send?:(key:string,segment:NativeRecordSegment,guard:VoiceGuard)=>Promise<unknown>;now?:()=>number;
 /** 异步准备终态的同步通知；不授予发送权限，回调异常不改变已经核验的任务结果。 */
 onSettled?:(event:{job:string;owner:string;status:'prepared'|'failed'|'cancelled'})=>void;}
/** 目录及工人结果沿旧协议检查，外部字段未检查的仍保留unknown。 */
export interface SingingFile {path:unknown;sha256:unknown;}
export interface SingingPrepared extends SingingFile {pitch:unknown;guideSha256:unknown;modelSha256:unknown;runtimeSha256:unknown;durationMs:unknown;}
export interface SingingSong {id:unknown;title:string;pitch:number;guide:SingingFile;backing?:SingingFile;prepared?:SingingPrepared;}
export interface SingingResult {file?:unknown;path?:unknown;sha256?:unknown;durationMs?:unknown;actualRvcInference?:unknown;sent?:unknown;}
export interface SingingJob {id:string;owner:string;song:SingingSong;createdAt:number;status:'preparing'|'prepared'|'sending'|'sent'|'send_unconfirmed'|'cancelled'|'failed';result?:SingingResult;error?:string;cached?:boolean;}
