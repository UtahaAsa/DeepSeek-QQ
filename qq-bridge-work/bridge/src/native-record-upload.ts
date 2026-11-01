/// <reference types="node" />
export interface RecordUploadBot {raw:(action:'upload_record',params:Record<string,unknown>)=>Promise<unknown>;}
interface RecordUploadReply {upload?:unknown;offset?:unknown;file?:unknown;}
/** 返回上传句柄不表示已发送；原句柄仅有正则转换检查，保留未知字段类型。 */
export interface NativeRecordSegment {type:'record';data:{file:unknown};}
import { createHash } from 'node:crypto';
import { loadSilkCodec, inspectSilk } from './silk-codec.js';

/**
 * 把已校验PCM WAV上传到当前许可的QQ语音仓库，返回record段，不发送。
 * @param {object} bot 所属鉴权OneBot客户端。@param {Buffer} wav 本机生成音频。
 * @param {string} key 当前目标。@param {Function} guard 每个上传阶段复核当前轮次与权限。
 * @returns {Promise<object>} 当前会话专用record消息段；失败中止分块上传，不自动重试。
 */
export async function uploadNativeRecord(bot:RecordUploadBot, wav:Buffer, key:string, guard:()=>undefined):Promise<NativeRecordSegment> {
  guard();
  const codec = await loadSilkCodec();
  const bytes = Buffer.from((await codec.encode(wav, 0)).data); inspectSilk(bytes); guard();
  const [kind, target] = key.split(':');
  const started = await bot.raw('upload_record', { operation: 'begin', kind, target, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') }) as RecordUploadReply|null;
  if (!/^qqvu_[a-f0-9]{32}$/.test((started?.upload ?? '') as string)) throw Error('SINGING_NOT_READY');
  try {
    for (let offset = 0; offset < bytes.length; offset += 24576) {
      guard(); const data = bytes.subarray(offset, offset + 24576);
      const result = await bot.raw('upload_record', { operation: 'append', upload: started!.upload, offset, data: data.toString('base64') }) as RecordUploadReply;
      if (result.offset !== offset + data.length) throw Error('SINGING_NOT_READY');
    }
    guard(); const result = await bot.raw('upload_record', { operation: 'finish', upload: started!.upload }) as RecordUploadReply|null; guard();
    if (!/^qqvoice_[a-f0-9]{32}$/.test((result?.file ?? '') as string)) throw Error('SINGING_NOT_READY');
    return { type: 'record', data: { file: result!.file } };
  } catch (error) { await bot.raw('upload_record', { operation: 'abort', upload: started!.upload }).catch(() => {}); throw error; }
}
