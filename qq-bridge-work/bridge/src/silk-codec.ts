/// <reference types="node" />
/** 固定本地3.7.1包自带的声明，只用于类型；运行仍走原逐文件摘要校验后的动态导入。 */
export type SilkCodec=typeof import('../../vendor/silk-wasm/lib/index.js');
interface SilkLock {version?:unknown;files:{path:string;sha256:unknown}[];}
import fs from 'node:fs';
import { createHash } from 'node:crypto';

let codec:Promise<SilkCodec>|undefined;
/**
 * 加载固定版本且逐文件校验的本地 SILK WASM；不联网、不安装软件。
 * @returns {Promise<object>} 3.7.1 编解码接口；摘要不符时拒绝加载。
 * @note 单事件循环，首次调用共享加载任务；不修改第三方文件。
 */
export function loadSilkCodec() {
  codec ??= (async () => {
    const base = new URL('../../vendor/', import.meta.url);
    const lock = JSON.parse(fs.readFileSync(new URL('silk-wasm.lock.json', base), 'utf8')) as SilkLock;
    if (lock.version !== '3.7.1' || lock.files.length !== 8) throw new Error('VOICE_CODEC_CHANGED');
    for (const entry of lock.files) {
      if (!/^(?:LICENSE|README\.md|package\.json|lib\/[a-z.]+)$/.test(entry.path)) throw new Error('VOICE_CODEC_CHANGED');
      const bytes = fs.readFileSync(new URL('silk-wasm/' + entry.path, base));
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('VOICE_CODEC_CHANGED');
    }
    return import(new URL('silk-wasm/lib/index.mjs', base).href) as Promise<SilkCodec>;
  })();
  return codec;
}

/**
 * 核验 QQ SILK 容器的帧边界及最多60秒时长；完整解码另由WASM执行。
 * @param {Buffer} bytes 完整语音字节，最多2MiB。
 * @returns {object} 字节数、时长、MD5和SHA256，不含路径或正文。
 * @throws {Error} 非白名单容器、截断帧或超限均拒绝；无副作用。
 */
export function inspectSilk(bytes:Buffer) {
  const fail = () => { throw Object.assign(new Error('VOICE_FORMAT_INVALID'), { code: 'VOICE_FORMAT_INVALID' }); };
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > 2 * 1024 * 1024) fail();
  const start = bytes[0] === 2 ? 1 : 0;
  if (bytes.toString('ascii', start, start + 9) !== '#!SILK_V3') fail();
  let offset = start + 9, frames = 0;
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) fail();
    const size = bytes.readInt16LE(offset); offset += 2;
    if (size === -1 && offset === bytes.length) break;
    if (size < 1 || size > 1250 || offset + size > bytes.length || ++frames > 3000) fail();
    offset += size;
  }
  if (!frames) fail();
  return { size: bytes.length, durationMs: frames * 20,
    md5: createHash('md5').update(bytes).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
