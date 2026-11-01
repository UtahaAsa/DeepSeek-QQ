/// <reference types="node" />
/** 输入字段沿旧HTTP边界读取；字节/身份/原生句柄检查仍由此函数执行。 */
export interface SelfAvatarSendOptions {key:unknown;avatar:{is_self?:unknown;image?:{data?:unknown;mimeType?:unknown}}|null;enabled:()=>boolean;guard:()=>undefined;upload:(bytes:Buffer,target:{kind:string;id:string},options:{signal?:AbortSignal;timeoutMs:number})=>Promise<unknown>;signal?:AbortSignal;}
export type SelfAvatarDelivery={sendable:false;instruction:string}|{sendable:true;file:unknown;instruction:string};
interface AvatarUploadReply {file?:unknown;size?:unknown;}
import { QQ_AVATAR_MAX_BYTES, QQ_AVATAR_MAX_BASE64_CHARS } from './qq-avatar-limits.js';
import { sniffImage } from './media-normalize.js';
const fail = () => new Error('SELF_AVATAR_SEND_UNAVAILABLE');
/**
 * 将已核验自身头像按需登记为当前会话的可发送图片；不发送消息、不改QQ头像。
 * @param {object} options key为当前会话，avatar为读取器结果，enabled/guard在上传前后重验许可和轮次。
 *   upload只允许既有原生图片分块通道；signal为请求断开信号，不接受路径或URL。
 * @returns {Promise<object>} sendable及可选file；发送许可关闭时仍可保留原只读图片。
 * @throws {Error} 数据异常、撤权或上传结果不符时固定失败；单事件循环，无重试。
 */
export async function prepareSelfAvatarSend({ key, avatar, enabled, guard, upload, signal }:SelfAvatarSendOptions):Promise<SelfAvatarDelivery> {
  const match = /^(private|group):([1-9]\d{0,19})$/.exec((key ?? '') as string);
  if (!match || typeof enabled !== 'function' || typeof guard !== 'function' || typeof upload !== 'function') throw fail();
  const current = () => { signal?.throwIfAborted(); guard(); };
  current();
  if (enabled() !== true) return { sendable: false, instruction: '自身头像可查看，但当前发送图片或发送消息开关未开启，未生成发送编号。' };
  if (avatar?.is_self !== true || typeof avatar.image?.data !== 'string' || avatar.image.data.length > QQ_AVATAR_MAX_BASE64_CHARS) throw fail();
  const bytes = Buffer.from(avatar.image.data, 'base64');
  try {
    const info = sniffImage(bytes);
    if (!bytes.length || bytes.length > QQ_AVATAR_MAX_BYTES || bytes.toString('base64') !== avatar.image.data || !info
        || !['png','jpeg','webp'].includes(info.format) || info.animated || info.width > 2048 || info.height > 2048
        || avatar.image.mimeType !== 'image/' + info.format) throw fail();
    current();
    let result:AvatarUploadReply|null;
    try { result = await upload(bytes, { kind: match[1], id: match[2] }, { signal, timeoutMs: 18000 }) as AvatarUploadReply|null; }
    catch { throw fail(); }
    current();
    if (enabled() !== true || !/^qqimg_[a-f0-9]{32}$/.test((result?.file ?? '') as string) || result!.size !== bytes.length) throw fail();
    return { file: result!.file, sendable: true, instruction: '这是本会话当前自身头像的图片编号；可用[[qq-image:完整编号]]发送，图片尚未发送。' };
  } finally { bytes.fill(0); }
}
