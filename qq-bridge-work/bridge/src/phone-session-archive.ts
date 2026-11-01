/// <reference types="node" />
export interface PhoneArchiveOptions {wait?:(ms:number)=>Promise<unknown>;maxAttempts?:number;delayMs?:number;}
interface ArchiveReply {result?:{ok?:unknown;error?:{code?:unknown}};}
import {setTimeout as sleep} from 'node:timers/promises';
const fail=(code:string)=>Object.assign(new Error(code),{code});
/**
 * 等待电话专属会话在取消后真正退出，再归档该会话。
 * @param {Function} archive 调用方提供的固定归档接口，只允许操作当前电话创建的会话。
 * @param {string} sessionId 当前电话专属会话标识。
 * @param {object} options wait为可注入等待；maxAttempts及delayMs限制等待上界。
 * @returns {Promise<void>} 服务端明确确认归档时返回；未知结果或超限抛固定错误。
 * @note 只对服务端明确拒绝的workspace/session-active重试；网络异常和未知结果不重放。
 */
export async function archivePhoneSession(archive:(sessionId:string)=>Promise<unknown>,sessionId:string,{wait=sleep,maxAttempts=40,delayMs=500}:PhoneArchiveOptions={}):Promise<void>{
  if(typeof archive!=='function'||typeof sessionId!=='string'||!sessionId||typeof wait!=='function'||
    !Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>100||!Number.isInteger(delayMs)||delayMs<1||delayMs>2000)
    throw fail('PHONE_ARCHIVE_CONFIG_INVALID');
  for(let attempt=0;attempt<maxAttempts;attempt++){
    let response:ArchiveReply|null;try{response=await archive(sessionId) as ArchiveReply|null;}catch{throw fail('PHONE_ARCHIVE_UNCONFIRMED');}
    if(response?.result?.ok===true)return;
    if(response?.result?.ok!==false||response?.result?.error?.code!=='workspace/session-active')throw fail('PHONE_ARCHIVE_UNCONFIRMED');
    if(attempt+1<maxAttempts)await wait(delayMs);
  }
  throw fail('PHONE_ARCHIVE_STILL_ACTIVE');
}
