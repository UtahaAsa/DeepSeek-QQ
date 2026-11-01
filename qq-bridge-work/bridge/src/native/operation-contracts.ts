/// <reference types="node" />
import type {ConsoleRouteContext} from '../console/request-context.js';
import type {ServerResponse} from 'node:http';
/** 同步读取权限及当前身份；登记资格也必须在本轮同步完成。 */
export interface NativeOperationContext {
 context:(key:string)=>string|null|undefined;safeText:(text:string)=>boolean;
 rememberToken?:(key:string,token:string)=>undefined;now?:()=>number;
}
export type GroupAction='atAll'|'mute'|'kick';
export type ProfileField='nickname'|'signature'|'birthday'|'avatar';
export type QzoneAudience='self'|'friends'|'public';
export interface GroupApiDependencies extends NativeOperationContext {
 permission:()=>Partial<Record<GroupAction,unknown>>|null|undefined;
 verify:(key:string,action:GroupAction)=>Promise<unknown>;
 perform:(key:string,action:GroupAction,payload:{text?:unknown;userId?:unknown;duration?:unknown},operationId:string)=>Promise<unknown>;
}
export interface QzoneSettings {enabled?:unknown;audience?:unknown;cooldownMinutes?:unknown;dailyLimit?:unknown;}
export interface QzoneApiDependencies extends NativeOperationContext {
 settings:()=>QzoneSettings|null|undefined;verify:(key:string)=>Promise<unknown>;perform:(key:string,text:string)=>Promise<unknown>;
}
export interface ProfileApiDependencies extends NativeOperationContext {
 permission:()=>Partial<Record<ProfileField,unknown>>|null|undefined;
 verify:(key:string,field:ProfileField)=>Promise<unknown>;perform:(key:string,field:ProfileField,value:unknown)=>Promise<unknown>;
}
export interface GroupGrant {context:string;createdAt:number;token:string;operationId:string;}
export interface QzoneGrant {context:string;config:string;audience:unknown;createdAt:number;token:string;}
export interface ProfileGrant {context:string;config:string;createdAt:number;tokens:Map<ProfileField,string>;}
/** 旧协议输入的局部投影；调用入口仍执行原有结构/字段检查，类型不授予资格。 */
export interface GroupInput {key:string;action:GroupAction;managementToken:string;text?:string;userId?:string;duration?:number;}
export interface QzoneInput {key:string;text:unknown;postToken:string;}
export interface ProfileInput {key:string;field:ProfileField;value:unknown;profileToken:string;}
export interface NativeReceiptView {authorized?:unknown;audience?:unknown;field?:unknown;message_id?:unknown;outcome?:unknown;submitted?:unknown;confirmed?:unknown;confirmation?:unknown;serverReceipt?:unknown;tid?:unknown;reason?:unknown;backupId?:unknown;restoration?:unknown;restoredFrom?:unknown;}
export type NativeGuard=()=>undefined;
export interface NativeGuardOptions {guard:NativeGuard;signal?:AbortSignal;}
export interface NativeStickerDependencies {
 capabilities:()=>{collectStickers?:unknown;useStickers?:unknown;sendImage?:unknown;sendText?:unknown};
 list:(key:string,options:{count:number})=>Promise<unknown>;source:(key:string,id:string)=>Promise<unknown>;collect:(key:string,file:string)=>Promise<unknown>;
 download:(url:string)=>Promise<{buffer:Buffer}>;
 upload:(bytes:Buffer,target:{kind:string;id:string},options:{signal?:AbortSignal})=>Promise<unknown>;
 send:(key:string,text:string,guard:NativeGuard)=>Promise<unknown>;normalize:(bytes:Buffer,mimeType:string)=>Promise<unknown>;
 notesFile:string;checkLabel?:(key:string,text:string)=>undefined;
}
export interface NativeStickerRow {id:string;desc?:unknown;}
export interface NativeStickerList {stickers:NativeStickerRow[];total?:unknown;truncated?:unknown;}
export interface NativeStickerSource {id?:unknown;url?:unknown;md5?:unknown;}
export interface NativeStickerImage {ok?:unknown;buffer?:unknown;mimeType?:unknown;note?:unknown;}
export interface NativeStickerReceipt {confirmed?:unknown;collected?:unknown;stickerId?:unknown;file?:unknown;}
export type QualifiedApiName='images'|'groups'|'qzone'|'profile';
export type QualifiedMethod='generate'|'act'|'post'|'update';
export type QualifiedHandler=(input:unknown,options:{signal:AbortSignal})=>Promise<unknown>;
export type QualifiedMethods=Partial<Record<QualifiedMethod,QualifiedHandler>>;
export interface NativeFeatureCapabilities {sendVoice?:unknown;receiveImage?:unknown;profile?:Partial<Record<ProfileField,unknown>>;friends?:{receiveRequests?:unknown};}
export interface NativeFeatureRouteDependencies {
 access:{capture:(key:unknown,token:unknown,options:{qualified:boolean})=>NativeGuard};capabilities:()=>NativeFeatureCapabilities;
 run:<T>(key:string,guard:NativeGuard,operation:()=>Promise<T>)=>Promise<T>;hints:(key:string)=>string;
 send:(key:string,text:string,guard:NativeGuard)=>Promise<unknown>;media:(key:string,messageId:string,guard:NativeGuard)=>Promise<unknown>;
 forward:(key:string,id:string,guard:NativeGuard)=>Promise<unknown>;forwardMedia:(key:string,media:unknown[],guard:NativeGuard)=>Promise<unknown>;
 members?:(key:string,limit:number,guard:NativeGuard)=>Promise<unknown>;friends?:(key:string,userId:unknown,guard:NativeGuard)=>Promise<unknown>;
 avatar?:(key:string,input:{operation:string;file?:unknown;crop?:unknown},guard:NativeGuard)=>Promise<unknown>;
 selfProfileRead?:(key:string,field:ProfileField,guard:NativeGuard)=>Promise<unknown>;
 phone?:(action:string,input:Record<string,unknown>,guard:NativeGuard)=>Promise<unknown>;
 singing?:(action:string,input:Record<string,unknown>,guard:NativeGuard)=>Promise<unknown>;
 stickers?:{
  list:(key:string,input:unknown,options:NativeGuardOptions)=>Promise<unknown>;
  note:(key:string,id:string,patch:unknown,options:NativeGuardOptions)=>Promise<unknown>;
  image:(key:string,id:string,options:NativeGuardOptions)=>Promise<unknown>;
  collect:(key:string,file:string,options:NativeGuardOptions)=>Promise<unknown>;
  send:(key:string,id:string,options:NativeGuardOptions)=>Promise<unknown>;
 };
 images?:{generate:QualifiedHandler};groups?:{act:QualifiedHandler};qzone?:{post:QualifiedHandler};profile?:{update:QualifiedHandler};
}
export type NativeFeatureRouteContext=ConsoleRouteContext & {res?:Pick<ServerResponse,'writableEnded'|'once'|'off'>};
