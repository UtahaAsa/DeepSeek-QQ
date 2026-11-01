import { promises as files } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { inspectNativeImage } from './native-image-store.mjs';

const fail = code => Object.assign(new Error(code), { code });
const within = (file, root) => path.dirname(file).toLowerCase() === root.toLowerCase();

/**
 * 检查静态头像容器和像素边界；这不是完整图片解码或视觉内容审查。
 * @param {Buffer} bytes 当前授权会话缓存提供的字节；最大8MiB、4096边长及1600万像素。
 * @returns {object} 尺寸、格式及sha256；只允许静态PNG/JPEG/WebP，异常固定AVATAR_STAGE_IMAGE_INVALID。
 * @note 纯内存检查，无网络、外部解码器、路径和文件I/O；不修改输入。
 */
export function inspectProfileAvatar(bytes) {
  try {
    const info = inspectNativeImage(bytes);
    if (!['png', 'jpeg', 'webp'].includes(info.format) || info.width > 4096 || info.height > 4096
        || info.width * info.height > 16_000_000) throw 0;
    if (info.format === 'png') {
      let offset = 8, image = false, ended = false;
      while (offset + 12 <= bytes.length) {
        const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
        if (size > bytes.length - offset - 12 || ['acTL', 'fcTL', 'fdAT'].includes(type)) throw 0;
        if (type === 'IDAT' && size) image = true;
        offset += 12 + size;
        if (type === 'IEND') { if (size || offset !== bytes.length) throw 0; ended = true; break; }
      }
      if (!image || !ended) throw 0;
    } else if (info.format === 'jpeg') {
      if (!bytes.subarray(-2).equals(Buffer.from([255, 217]))) throw 0;
    } else {
      if (info.animated || bytes.readUInt32LE(4) + 8 !== bytes.length) throw 0;
      let offset = 12, image = false;
      while (offset + 8 <= bytes.length) {
        const size = bytes.readUInt32LE(offset + 4), type = bytes.toString('ascii', offset, offset + 4);
        if (['ANIM', 'ANMF'].includes(type) || size > bytes.length - offset - 8) throw 0;
        if (['VP8 ', 'VP8L'].includes(type) && size) image = true;
        offset += 8 + size + (size & 1);
      }
      if (offset !== bytes.length || !image) throw 0;
    }
    return info;
  } catch { throw fail('AVATAR_STAGE_IMAGE_INVALID'); }
}

/**
 * 构造所属运行目录的头像暂存器；构造不读写磁盘、不联网。
 * @param {object} options root为已存在的受控目录；readImage(handle,context)必须按当前会话核验缓存，
 *   返回由本暂存器接管并擦除的独立Buffer，不能读取任意路径或URL。isCurrent(context)同步再验资格。
 * @returns {object} prepare/close/snapshot；prepare返回内部租约path/sha256/release，不得给模型暴露path。
 * @note 单JS线程，一张在途；首次准备创建随机子目录/随机wx文件。release前保留文件供原生读取。
 *   close禁止新准备；尚有租约时保留文件并报告cleanupRequired，不冒称能回滚已提交头像。
 */
export function createProfileAvatarStager({ root, readImage, isCurrent }) {
  if (!path.isAbsolute(root ?? '') || typeof readImage !== 'function' || typeof isCurrent !== 'function') {
    throw fail('AVATAR_STAGE_OPTIONS_INVALID');
  }
  let closed = false, busy = false, owned = null, cleanupFailed = false;
  const leases = new Set();
  function current(context) {
    let valid = false;
    try { valid = isCurrent(context) === true; } catch {}
    if (closed || !valid) throw fail('AVATAR_STAGE_NOT_ALLOWED');
  }
  async function removeOwned() {
    if (!closed || busy || leases.size || !owned) return;
    const directory = owned;
    try { await files.rmdir(directory); if (owned === directory) owned = null; }
    catch (error) { if (error.code === 'ENOENT') { if (owned === directory) owned = null; } else cleanupFailed = true; }
  }
  async function prepareInner(handle, context) {
    let bytes, destination, leased = false;
    try {
      current(context);
      if (typeof handle !== 'string' || !/^qqimg_[a-f0-9]{32}$/.test(handle)) throw fail('AVATAR_STAGE_HANDLE_INVALID');
      bytes = await readImage(handle, context); current(context);
      const info = inspectProfileAvatar(bytes);
      if (!owned) {
        const parent = await files.realpath(root), stat = await files.lstat(root);
        current(context);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('AVATAR_STAGE_DIRECTORY_INVALID');
        owned = await files.mkdtemp(path.join(parent, 'profile-avatar-'));
      }
      current(context);
      const directory = await files.realpath(owned), stat = await files.lstat(owned);
      if (!stat.isDirectory() || stat.isSymbolicLink() || directory.toLowerCase() !== owned.toLowerCase()) {
        throw fail('AVATAR_STAGE_DIRECTORY_INVALID');
      }
      destination = path.join(directory, randomBytes(16).toString('hex') + '.' + (info.format === 'jpeg' ? 'jpg' : info.format));
      current(context);
      await files.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 }); current(context);
      const token = {};
      leases.add(token); leased = true;
      let releaseTask = null;
      const release = () => releaseTask ??= (async () => {
        try {
          if (!owned || !within(destination, owned)) throw 0;
          await files.unlink(destination); leases.delete(token); await removeOwned();
        } catch (error) {
          if (error?.code === 'ENOENT') { leases.delete(token); await removeOwned(); }
          else { cleanupFailed = true; throw fail('AVATAR_STAGE_CLEANUP_FAILED'); }
        }
      })();
      return Object.freeze({ path: destination, sha256: info.sha256, release });
    } catch (error) {
      if (destination && !leased) {
        try { if (owned && within(destination, owned)) await files.unlink(destination); }
        catch (failure) { if (failure?.code !== 'ENOENT') cleanupFailed = true; }
      }
      const codes = ['AVATAR_STAGE_NOT_ALLOWED', 'AVATAR_STAGE_HANDLE_INVALID', 'AVATAR_STAGE_IMAGE_INVALID', 'AVATAR_STAGE_DIRECTORY_INVALID'];
      throw fail(codes.includes(error?.code) ? error.code : 'AVATAR_STAGE_PREPARATION_FAILED');
    } finally { if (Buffer.isBuffer(bytes)) bytes.fill(0); }
  }
  function prepare(handle, context) {
    if (busy || leases.size) return Promise.reject(fail('AVATAR_STAGE_BUSY'));
    current(context); busy = true;
    return prepareInner(handle, context).finally(async () => { busy = false; await removeOwned(); });
  }
  async function close() {
    closed = true;
    // 不等待可能永不结束的缓存读取或原生租约；结算时各自继续清理。
    await removeOwned(); return snapshot();
  }
  function snapshot() {
    return { closed, busy, activeLeases: leases.size, directoryAllocated: owned !== null, cleanupFailed,
      cleanupRequired: busy || leases.size > 0 || owned !== null || cleanupFailed };
  }
  return Object.freeze({ prepare, close, snapshot });
}
