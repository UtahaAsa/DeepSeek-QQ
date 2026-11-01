/// <reference types="node" />
import type {PublicDnsRequest,PublicResolverOptions} from '../public-dns.js';
/** 已通过原有白名单校验的非敏感供应商配置；不携带密钥。 */
export interface ImageProviderConfig {
 readonly provider?:'openai'|'hf-flux-schnell-public';readonly endpoint:string;readonly model:string;readonly size:string;
 readonly quality:''|'auto'|'low'|'medium'|'high'|'xhigh'|'max';readonly responseFormat:'default'|'b64_json'|'url';
}
export interface ImageOperationOptions {signal?:AbortSignal;}
/** 传输保留现有运行时组合检查，GET禁带凭据/正文，POST未知结果不重试。 */
export interface ImageTransportOptions extends ImageOperationOptions {
 method?:'GET'|'POST';body?:Buffer;apiKey?:string;maxBytes?:number;timeoutMs?:number;publicFlux?:boolean;eventStream?:boolean;
}
export type ImageTransport=(url:string,options?:ImageTransportOptions)=>Promise<Buffer>;
export interface ImageTransportDependencies {resolveHost?:(hostname:string,options:PublicResolverOptions)=>Promise<string[]>;request?:PublicDnsRequest;}
/** 供应商和网关的返回值仍未知，管理器按原有字节/格式/句柄校验使用。 */
export type ImageGenerator=(settings:ImageProviderConfig,apiKey:string,prompt:string,options:ImageOperationOptions)=>Promise<unknown>;
export type ImageUpload=(bytes:Buffer,target:{kind:string;id:string},options:ImageOperationOptions)=>Promise<unknown>;
export interface ImageManagerDependencies {authorize:(key:string)=>Promise<unknown>;upload:ImageUpload;provider?:ImageGenerator;now?:()=>number;initialSettings?:unknown;}
export interface ImageApiDependencies {
 context:(key:string)=>string|null|undefined;permission:()=>boolean;verify:(key:string)=>Promise<unknown>;upload:ImageUpload;
 rememberToken?:(key:string,token:string)=>undefined;provider?:ImageGenerator;now?:()=>number;initialSettings?:unknown;
}
/** 仅投影已有代码访问的外部字段，不将类型断言当成运行时验证。 */
export interface ImageErrorView {code?:unknown;submitted?:unknown;}
export interface GeneratedImageView {bytes?:unknown;info?:{mimeType?:unknown};}
export interface UploadedImageView {file?:unknown;size?:unknown;}
export interface GenerationJob {revision:number;settings:ImageProviderConfig;secret:string;controller:AbortController;authorization:string|null;}
export interface ImageGrant {context:string;token:string;createdAt:number;}
/** 句柄仅经原正则转换检查，保留unknown；字节数经过数值相等检查。上传从不代表送达。 */
export interface PreparedImageResult {file:unknown;size:number;mimeType:string;generated:true;sent:false;maxAgeSeconds:600;}
/** 同步配置操作结果必须先区分成功和失败，失败不携带配置快照。 */
export type ImageOperatorResult<Snapshot>={ok:true;generation:Snapshot}|{ok:false;error:string};
