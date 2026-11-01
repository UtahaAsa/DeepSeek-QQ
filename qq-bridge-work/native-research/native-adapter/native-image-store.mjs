import fs from 'node:fs';
import { promises as files } from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { nativeMethod } from './manual-login.mjs';
import { sniffImage } from '../../bridge/src/media-normalize.js';

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_CHUNK_BYTES = 24576;
const MAX_RESIDENT = 64 * 1024 * 1024, MAX_RECORDS = 128, TTL = 10 * 60 * 1000;
const fail = (code) => Object.assign(new Error(code), { code });
const field = (object, key) => object && Object.getOwnPropertyDescriptor(object, key)?.value;
const id = (value) => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const handlePattern = /^qqimg_[a-f0-9]{32}$/;
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const within = (file, root) => file.toLowerCase().startsWith((root + path.sep).toLowerCase());

/**
 * 识别图片容器及像素边界，不将元数据或后缀当成已解码内容。
 * @param {Buffer} bytes 图片字节；不会调用解码器、网络或外部程序。
 * @returns {object} 白名单格式、尺寸和字节摘要；完整视觉读取仍由模型链路验证。
 * @throws {Error} 格式、字节数或像素数不符合时返回固定错误。
 */
export function inspectNativeImage(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_MAX_BYTES) throw fail('IMAGE_LIMIT');
  const info = sniffImage(bytes);
  if (!info || !['png', 'jpeg', 'gif', 'webp'].includes(info.format) ||
      info.width > 16384 || info.height > 16384 || info.width * info.height > 40_000_000) throw fail('IMAGE_FORMAT_INVALID');
  if (info.format === 'png' && (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR')) throw fail('IMAGE_FORMAT_INVALID');
  return { size: bytes.length, width: info.width, height: info.height, format: info.format,
    mimeType: 'image/' + info.format, sha256: digest(bytes), md5: digest(bytes, 'md5') };
}

/**
 * 本运行的有界图片句柄仓库：只访问已授权在线消息的图片或显式上传的字节，不接受任意路径/URL。
 * @param {object} options service 为已初始化消息服务；root 是所属数据目录，nativeRoots 限定 QQ 媒体路径。
 *   receiveEnabled/sendEnabled 为独立本机选择；isActive 为宿主存活检查；authorizeTarget 校验上传目标。
 * @returns {object} observe/getImage/copyForAvatar/complete/validateSend/prepareSend/upload/close/snapshot。
 * @note 单 JS 线程；64MiB驻留、128句柄、两路下载/上传、10分钟有效期；失败不自动重试。
 */
export function createNativeImageStore({ service, root, nativeRoots = [], receiveEnabled = false, sendEnabled = false,
  isActive, authorizeTarget, now = Date.now, downloadTimeoutMs = 15000 }) {
  if ((!receiveEnabled && !sendEnabled) || typeof isActive !== 'function' || typeof authorizeTarget !== 'function' ||
      !path.isAbsolute(root ?? '') || !Number.isSafeInteger(downloadTimeoutMs) || downloadTimeoutMs < 10 || downloadTimeoutMs > 30000) throw fail('IMAGE_CONFIG_INVALID');
  const parent = fs.realpathSync(root), owned = fs.mkdtempSync(path.join(parent, 'image-run-'));
  const allowedRoots = [owned, ...nativeRoots.map((value) => fs.realpathSync(value))];
  const records = new Map(), nativeIds = new Map(), downloads = new Map(), uploads = new Map(), ownedFiles = new Map(), preparations = new Set(), deletions = new Set();
  let closed = false, residentBytes = 0, reservedBytes = 0, ownedBytes = 0, cleanup = null;
  const counts = { observed: 0, downloaded: 0, uploaded: 0, downloadFailures: 0, cacheHits: 0, renderedEmojiHits: 0, cacheContentMisses: 0, lastFailureStage: null, lastFailureCode: null };
  // QQ会把收到的PNG静态表情转成JPEG，但仍以原资源MD5命名；只识别该专用原图缓存结构。
  const renderedEmojiPath = (file, record) => record.expectedMd5 && allowedRoots.some(base => {
    const relative=path.relative(base,file).replaceAll('\\','/');
    const match=/^[1-9]\d{0,19}\/nt_qq\/nt_data\/Emoji\/emoji-recv\/\d{4}-\d{2}\/Ori\/([a-f0-9]{32})\.png$/i.exec(relative);
    return match?.[1]?.toLowerCase()===record.expectedMd5;
  });
  const active = () => { if (closed || !isActive()) throw fail('IMAGE_DISABLED'); };
  const discard = (record) => {
    if (record.bytes) { residentBytes -= record.bytes.length; record.bytes.fill(0); record.bytes = null; }
    records.delete(record.handle); if (record.nativeKey) nativeIds.delete(record.nativeKey);
    if (!closed && record.info && record.destination && ownedFiles.has(record.destination)) {
      const task = files.unlink(record.destination).catch((error) => { if (error.code !== 'ENOENT') throw error; }).then(() => {
        ownedBytes -= ownedFiles.get(record.destination) ?? 0; ownedFiles.delete(record.destination);
      });
      deletions.add(task); task.then(() => deletions.delete(task), () => deletions.delete(task));
    }
  };
  const sweep = () => {
    for (const record of records.values()) if (!record.task && now() - record.createdAt > TTL) discard(record);
    for (const [key, upload] of uploads) if (now() - upload.createdAt > 60000) {
      uploads.delete(key); reservedBytes -= upload.size; for (const chunk of upload.chunks) chunk.fill(0);
    }
  };
  const lookup = (file) => {
    active(); sweep();
    if (typeof file !== 'string' || !handlePattern.test(file) || !records.has(file)) throw fail('IMAGE_NOT_CACHED');
    return records.get(file);
  };
  function allocate(value) {
    sweep(); if (records.size >= MAX_RECORDS) throw fail('IMAGE_LIMIT');
    const handle = 'qqimg_' + randomBytes(16).toString('hex');
    const record = { ...value, handle, createdAt: now(), bytes: null, task: null, failure: null };
    records.set(handle, record); if (record.nativeKey) nativeIds.set(record.nativeKey, handle); return record;
  }
  function observe({ chatType, peerUid, msgId, elementId, picture }) {
    if (!receiveEnabled) return null;
    active();
    if (![1, 2].includes(chatType) || !id(msgId) || !id(elementId) || typeof peerUid !== 'string') throw fail('IMAGE_FORMAT_INVALID');
    const nativeKey = [chatType, peerUid, msgId, elementId].join(':');
    let record = records.get(nativeIds.get(nativeKey));
    if (!record) {
      const size = Number(field(picture, 'fileSize')), md5 = field(picture, 'md5HexStr');
      if (!Number.isSafeInteger(size) || size < 1 || size > IMAGE_MAX_BYTES) throw fail('IMAGE_LIMIT');
      const sourcePath = field(picture, 'sourcePath');
      record = allocate({ chatType, peerUid, msgId, elementId, nativeKey, size,
        sourcePath: typeof sourcePath === 'string' && sourcePath.length <= 4096 && path.isAbsolute(sourcePath) ? sourcePath : null,
        expectedMd5: typeof md5 === 'string' && /^[a-f0-9]{32}$/i.test(md5) ? md5.toLowerCase() : null,
        expectedWidth: Number(field(picture,'picWidth')), expectedHeight: Number(field(picture,'picHeight')),
        key: chatType + ':' + peerUid }); counts.observed++;
    }
    return { type: 'image', data: { file: record.handle } };
  }
  async function readVerified(file, record, allowRenderedEmoji = false) {
    if (typeof file !== 'string' || file.length > 4096) throw fail('IMAGE_FILE_REFUSED');
    const real = await files.realpath(file);
    if (!allowedRoots.some((base) => within(real, base)) || (await files.lstat(real)).isSymbolicLink() ||
        (!record.expectedMd5 && real.toLowerCase() !== record.destination.toLowerCase())) throw fail('IMAGE_FILE_REFUSED');
    const input = await files.open(real, 'r');
    try {
      const renderedCandidate=allowRenderedEmoji&&renderedEmojiPath(real,record);
      const before = await input.stat();
      if (!before.isFile() || before.size > IMAGE_MAX_BYTES) throw fail('IMAGE_LIMIT');
      if (before.size !== record.size && !renderedCandidate) throw fail('IMAGE_SIZE_MISMATCH');
      const bytes = Buffer.alloc(before.size); let offset = 0;
      while (offset < bytes.length) {
        const read = await input.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) throw fail('IMAGE_FILE_REFUSED'); offset += read.bytesRead;
      }
      const after = await input.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw fail('IMAGE_FILE_REFUSED');
      const info = inspectNativeImage(bytes);
      const converted=renderedCandidate&&info.format==='jpeg'&&info.width===record.expectedWidth&&info.height===record.expectedHeight;
      if (before.size !== record.size&&!converted) throw fail('IMAGE_SIZE_MISMATCH');
      if (record.expectedMd5 && info.md5 !== record.expectedMd5&&!converted) throw fail('IMAGE_CONTENT_MISMATCH');
      if(converted)counts.renderedEmojiHits++;
      active(); return { bytes, info };
    } finally { await input.close(); }
  }
  async function ensureBytes(record) {
    active(); if (record.bytes) return record;
    if (record.failure) throw fail(record.failure);
    if (record.task) return record.task;
    const reservation=record.expectedMd5?IMAGE_MAX_BYTES:record.size;
    if (downloads.size >= 2 || residentBytes + reservedBytes + reservation > MAX_RESIDENT || ownedBytes + record.size > MAX_RESIDENT) throw fail('IMAGE_LIMIT');
    reservedBytes += reservation;
    record.task = (async () => {
      let stage = 'cache';
      try {
        // 原生已缓存的原图可能不再触发下载完成通知；只接收消息自身给出的路径，且必须有 MD5。
        // readVerified 仍核对所属媒体根、普通文件、完整大小/格式/MD5，不能据此读取任意本机文件。
        if (record.expectedMd5 && record.sourcePath) {
          try {
            const { bytes, info } = await readVerified(record.sourcePath, record, true);
            active(); record.bytes = bytes; record.info = info;
            residentBytes += bytes.length; counts.downloaded++; counts.cacheHits++; return record;
          } catch (error) {
            // QQ的静态表情路径可能指向缩略图或尚未完整落盘的缓存。
            // 仅内容不匹配允许回退一次消息关联下载；路径越界、链接及活动代次错误仍拒绝。
            if (!['ENOENT', 'ENOTDIR', 'IMAGE_SIZE_MISMATCH', 'IMAGE_CONTENT_MISMATCH', 'IMAGE_FORMAT_INVALID'].includes(error.code)) throw error;
            if (error.code.startsWith('IMAGE_')) counts.cacheContentMisses++;
          }
        }
        stage = 'download';
        record.destination = path.join(owned, record.handle + '.download'); ownedFiles.set(record.destination, record.size); ownedBytes += record.size;
        const notification = await new Promise((resolve, reject) => {
          const key = record.chatType + ':' + record.msgId + ':' + record.elementId;
          if (downloads.has(key)) { reject(fail('IMAGE_DOWNLOAD_FAILED')); return; }
          let settled = false;
          const finish = (error, value) => { if (settled) return; settled = true;
            clearTimeout(timer); downloads.delete(key); error ? reject(error) : resolve(value); };
          const timer = setTimeout(() => finish(fail('IMAGE_DOWNLOAD_TIMEOUT')), downloadTimeoutMs);
          downloads.set(key, { finish, record });
          try {
            const result = nativeMethod(service, 'downloadRichMedia')({ fileModelId: '0', downSourceType: 0,
              downloadSourceType: 0, triggerType: 1, msgId: record.msgId, chatType: record.chatType, peerUid: record.peerUid,
              elementId: record.elementId, thumbSize: 0, downloadType: 1, filePath: record.destination });
            if (result instanceof Promise) result.catch(() => finish(fail('IMAGE_DOWNLOAD_FAILED')));
          } catch { finish(fail('IMAGE_DOWNLOAD_FAILED')); }
        });
        stage = 'verify';
        // 首次下载也可能直接返回同一专用表情缓存中的JPEG转换文件。
        // 与热缓存共用资源标识、路径和尺寸验证，不能只在第二次发送时接受。
        const { bytes, info } = await readVerified(notification, record, true);
        active(); record.bytes = bytes; record.info = info; residentBytes += bytes.length; counts.downloaded++; return record;
      } catch (error) {
        counts.lastFailureStage = stage;
        counts.lastFailureCode = ['IMAGE_DOWNLOAD_TIMEOUT','IMAGE_DISABLED','IMAGE_FILE_REFUSED','IMAGE_LIMIT','IMAGE_SIZE_MISMATCH','IMAGE_CONTENT_MISMATCH','IMAGE_FORMAT_INVALID'].includes(error.code) ? error.code : 'IMAGE_DOWNLOAD_FAILED';
        record.failure = ['IMAGE_DOWNLOAD_TIMEOUT', 'IMAGE_DISABLED'].includes(error.code) ? error.code : 'IMAGE_DOWNLOAD_FAILED';
        counts.downloadFailures++; throw fail(record.failure);
      } finally { reservedBytes -= reservation; record.task = null; }
    })();
    return record.task;
  }
  function complete(value) {
    if (closed) return;
    const key = [field(value, 'chatType'), field(value, 'msgId'), field(value, 'msgElementId')].join(':');
    const pending = downloads.get(key); if (!pending) return;
    if (field(value, 'fileErrCode') !== '0' || field(value, 'fileProgress') !== '0' ||
        (field(value, 'fileSrvErrCode') !== undefined && field(value, 'fileSrvErrCode') !== '0')) {
      pending.finish(fail('IMAGE_DOWNLOAD_FAILED')); return;
    }
    pending.finish(null, field(value, 'filePath'));
  }
  async function getImage(file, offset) {
    if (!receiveEnabled && !sendEnabled) throw fail('IMAGE_DISABLED');
    const record = await ensureBytes(lookup(file));
    active(); if (!record.bytes) throw fail('IMAGE_DISABLED');
    if (offset === undefined) return { native_image: { file: record.handle, size: record.info.size,
      mimeType: record.info.mimeType, sha256: record.info.sha256 }, size: record.info.size };
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= record.bytes.length || offset % IMAGE_CHUNK_BYTES) throw fail('IMAGE_CHUNK_INVALID');
    const bytes = record.bytes.subarray(offset, Math.min(offset + IMAGE_CHUNK_BYTES, record.bytes.length));
    return { file: record.handle, offset, size: record.bytes.length, data: bytes.toString('base64') };
  }
  /** 为自身头像暂存器复制当前会话图片；不依赖发图许可。@param {string} file 有效缓存句柄。@param {string} key 原生会话键。@returns {Promise<Buffer>} 调用者须擦除的独立副本；跨会话/过期/撤权拒绝，不返回路径。 */
  async function copyForAvatar(file, key) {
    let record = lookup(file);
    if (typeof key !== 'string' || record.key !== key) throw fail('TARGET_NOT_ALLOWED');
    record = await ensureBytes(record);
    active();
    if (lookup(file) !== record || record.key !== key || !record.bytes) throw fail('IMAGE_NOT_CACHED');
    return Buffer.from(record.bytes);
  }
  /** 注册内部裁剪头像，保持接收和发送许可独立。@param {Buffer} bytes 当前授权图片的处理结果。@param {string} key 原生会话键。@returns {string} 只能用于头像的句柄；不开放任意字节上传。 */
  function registerProfileImage(bytes, key) {
    active(); sweep();
    const info = inspectNativeImage(bytes);
    if (typeof key !== 'string' || !key || residentBytes + reservedBytes + bytes.length > MAX_RESIDENT) throw fail('IMAGE_LIMIT');
    const record = allocate({ key, size: bytes.length, avatarOnly: true });
    record.bytes = Buffer.from(bytes); record.info = info; residentBytes += bytes.length; return record.handle;
  }
  function validateSend(file, key) {
    if (!sendEnabled) throw fail('IMAGE_DISABLED');
    const record = lookup(file);
    if (record.key !== key || record.avatarOnly === true) throw fail('TARGET_NOT_ALLOWED');
    return { elementType: 2, elementId: '', picElement: { sourcePath: '' } };
  }
  async function prepareSendInner(file, key) {
    validateSend(file, key);
    const record = await ensureBytes(lookup(file)), info = record.info;
    active(); validateSend(file, key);
    try {
      const fileName = info.md5 + '.' + (info.format === 'jpeg' ? 'jpg' : info.format);
      const output = nativeMethod(service, 'getRichMediaFilePathForGuild')({ md5HexStr: info.md5, fileName,
        elementType: 2, elementSubType: 0, thumbSize: 0, needCreate: true, downloadType: 1, file_uuid: '' });
      if (typeof output !== 'string' || output.length > 4096) throw new Error();
      const parent = await files.realpath(path.dirname(output));
      if (!allowedRoots.some((base) => parent.toLowerCase() === base.toLowerCase() || within(parent, base)) || path.basename(output) !== fileName) throw new Error();
      const destination = path.join(parent, fileName);
      active();
      try { await files.writeFile(destination, record.bytes, { flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST' || (await files.lstat(destination)).isSymbolicLink() ||
            digest((await readVerified(destination, { ...record, expectedMd5: info.md5 })).bytes) !== info.sha256) throw error;
      }
      active(); return { elementType: 2, elementId: '', picElement: { md5HexStr: info.md5, fileSize: String(info.size),
        picWidth: info.width, picHeight: info.height, fileName, sourcePath: destination, original: true,
        picType: { jpeg: 1000, png: 1001, webp: 1002, gif: 2000 }[info.format], picSubType: 0,
        fileUuid: '', fileSubId: '', thumbFileSize: 0, summary: '' } };
    } catch { throw fail('IMAGE_PREPARATION_FAILED'); }
  }
  function prepareSend(file, key) {
    const task = prepareSendInner(file, key); preparations.add(task);
    task.then(() => preparations.delete(task), () => preparations.delete(task)); return task;
  }
  function upload(params) {
    active(); sweep(); if (!sendEnabled) throw fail('IMAGE_DISABLED');
    const operation = field(params, 'operation');
    if (operation === 'begin') {
      const size = field(params, 'size'), sha256 = field(params, 'sha256'), kind = field(params, 'kind'), target = field(params, 'target');
      const key = authorizeTarget(kind, target);
      if (!Number.isSafeInteger(size) || size < 1 || size > IMAGE_MAX_BYTES || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
          uploads.size >= 2 || records.size + uploads.size >= MAX_RECORDS || residentBytes + reservedBytes + size > MAX_RESIDENT) throw fail('IMAGE_LIMIT');
      const upload = 'qqupload_' + randomBytes(16).toString('hex');
      uploads.set(upload, { key, size, sha256, chunks: [], offset: 0, createdAt: now() }); reservedBytes += size; return { upload };
    }
    const key = field(params, 'upload'), item = uploads.get(key);
    if (typeof key !== 'string' || !/^qqupload_[a-f0-9]{32}$/.test(key) || !item) throw fail('IMAGE_NOT_CACHED');
    const remove = () => { uploads.delete(key); reservedBytes -= item.size; };
    if (operation === 'abort') { remove(); for (const chunk of item.chunks) chunk.fill(0); return { aborted: true }; }
    if (operation === 'append') {
      const encoded = field(params, 'data');
      if (field(params, 'offset') !== item.offset || typeof encoded !== 'string' || encoded.length > IMAGE_CHUNK_BYTES * 4 / 3 ||
          !encoded.length || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) throw fail('IMAGE_CHUNK_INVALID');
      const chunk = Buffer.from(encoded, 'base64');
      if (chunk.toString('base64') !== encoded || !chunk.length || item.offset + chunk.length > item.size) throw fail('IMAGE_CHUNK_INVALID');
      item.chunks.push(chunk); item.offset += chunk.length; return { offset: item.offset };
    }
    if (operation !== 'finish') throw fail('IMAGE_CHUNK_INVALID');
    try {
      if (item.offset !== item.size) throw fail('IMAGE_CHUNK_INVALID');
      const bytes = Buffer.concat(item.chunks, item.size), info = inspectNativeImage(bytes);
      if (info.sha256 !== item.sha256) throw fail('IMAGE_CHUNK_INVALID');
      const record = allocate({ key: item.key, size: bytes.length }); record.bytes = bytes; record.info = info;
      residentBytes += bytes.length; counts.uploaded++; return { file: record.handle, size: bytes.length };
    } finally { remove(); for (const chunk of item.chunks) chunk.fill(0); }
  }
  function close() {
    if (cleanup) return cleanup;
    closed = true;
    const tasks = [...preparations, ...deletions, ...[...records.values()].map((record) => record.task).filter(Boolean)];
    for (const pending of [...downloads.values()]) pending.finish(fail('IMAGE_DISABLED'));
    for (const record of [...records.values()]) discard(record);
    for (const item of uploads.values()) { reservedBytes -= item.size; for (const chunk of item.chunks) chunk.fill(0); }
    uploads.clear();
    cleanup = (async () => {
      await Promise.allSettled(tasks);
      for (const [file, size] of ownedFiles) {
        if (path.dirname(file) !== owned) throw fail('IMAGE_CLEANUP_FAILED');
        try { await files.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw fail('IMAGE_CLEANUP_FAILED'); }
        ownedBytes -= size; ownedFiles.delete(file);
      }
      try { await files.rmdir(owned); } catch (error) { if (error.code !== 'ENOENT') throw fail('IMAGE_CLEANUP_FAILED'); }
    })(); return cleanup;
  }
  return Object.freeze({ observe, complete, getImage, copyForAvatar, registerProfileImage, validateSend, prepareSend, upload, close,
    snapshot: () => ({ ...counts, handles: records.size, pendingDownloads: downloads.size, pendingUploads: uploads.size,
      residentBytes, reservedBytes, ownedBytes, closed }) });
}
