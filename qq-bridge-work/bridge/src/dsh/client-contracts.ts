/// <reference types="node" />
/** 本地 SDK 运行方法名；桥接覆写callUnary，所有业务value仍未知。 */
type UnaryMethods={
 sessions:'list'|'search'|'create'|'history'|'models'|'selectModel'|'rename'|'fork'|'prompt'|'attachment'|'updateQueue'|'cancel';
 subagents:'list'|'history'|'prompt'|'interrupt';
 host:'describe'|'pickDirectory'|'listDirectory'|'createDirectory'|'openPath';
 workspace:'list'|'create'|'rename'|'delete'|'insertBefore'|'insertSessionBefore'|'archiveSession';
 skills:'list';goals:'create'|'edit'|'pause'|'resume'|'complete'|'clear';
 settings:'describe'|'openDocument'|'update'|'replace'|'mutate';
 credentials:'describe'|'set'|'unset';llm:'providers'|'models'|'discoverModels';
};
export type DshSdkSurface={readonly [Group in keyof UnaryMethods]:{[Method in UnaryMethods[Group]]:(payload:unknown,signal?:AbortSignal)=>Promise<DshRpcReply>}} & {
 subscribeEnvelopes:(listener:(batch:readonly unknown[])=>void)=>()=>void;
};
/**
 * 只声明已核对的SDK运行表面。agentPresets/events/respond被现有子类替换，不继承不存在的静态承诺。
 * 目标为本地@deepseek-ai/dsh-host-apiproxy 0.1.1-rc.2；不新增构造器包装、不修改第三方声明。
 */
export type DshSdkConstructor=abstract new(timeoutMs?:number)=>DshSdkSurface;
export type DshTimeoutPolicy='default'|'caller-signal-only';
/** SDK声明为private但当前运行JS可调用的唯一接缝；只在两个既有调用点投影，不向客户端公开。 */
export interface DshPostJsonRuntime {postJson:(path:string,body:unknown,signal?:AbortSignal,timeoutPolicy?:DshTimeoutPolicy)=>Promise<Response>;}
export interface DshAuthOptions {token?:unknown;tokenExplicit?:unknown;launchTokenOnly?:unknown;allowRemote?:unknown;
 /** 保留旧宿主传入字段；当前客户端使用既有Cookie鉴权，不消费这两个值。 */
 header?:unknown;prefix?:unknown;}
export interface DshClientError {message?:unknown;code?:unknown;}
/** 仅表示旧外层回执使用的结构假设，ok及value未额外校验。 */
export interface DshRpcResult {ok?:unknown;value?:unknown;error?:{code?:unknown;message?:unknown}|null;}
export interface DshRpcReply {rpcId:unknown;result:DshRpcResult;}
export interface DshServerReply {type?:unknown;rpcId?:unknown;result?:DshRpcResult;}
export interface DshResponseInput {clientId?:unknown;eventId?:unknown;outcome?:unknown;[key:string]:unknown;}
export interface DshRemoteValue {type?:unknown;clientId?:unknown;event?:unknown;eventId?:unknown;agentId?:unknown;
 request?:{toolName?:unknown;callId?:unknown;reason?:unknown;questions?:unknown};[key:string]:unknown;}
export interface DshRemoteFrame {type?:unknown;streamId?:unknown;value?:DshRemoteValue|null;error?:{code?:unknown}|null;}
/** 映射后的帧明确区分快照与增量事件，未经检查的远端身份/正文仍未知。 */
export type DshStreamPayload=
 {type:'approval/requested';sessionId:unknown;clientId:unknown;eventId:unknown;toolName:unknown;callId:unknown;reason:unknown}|
 {type:'question/requested';sessionId:unknown;clientId:unknown;eventId:unknown;questions:unknown}|
 {type:'session/event';sessionId:string;event:unknown}|
 {type:'session/snapshot';sessionId:string;snapshot:unknown}|
 {type:'stream/error';error:unknown};
export interface DshStreamEnvelope {rpcId:unknown;payload:DshStreamPayload;}
export type DshMuxItem={kind:'end'}|{kind:'frame';envelope:DshStreamEnvelope};
export interface DshRemoteEventStream extends AsyncIterable<DshStreamEnvelope> {follow:(sessionId:unknown)=>void;forget:(sessionId:unknown)=>void;}
