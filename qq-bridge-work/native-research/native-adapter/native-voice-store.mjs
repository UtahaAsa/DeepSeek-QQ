import fs from 'node:fs';
import { promises as files } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { nativeMethod } from './manual-login.mjs';
import { inspectSilk } from '../../bridge/src/silk-codec.js';

const fail = (code) => Object.assign(new Error(code), { code });
const field = (obj, key) => obj && Object.getOwnPropertyDescriptor(obj, key)?.value;
const within = (name, root) => name.toLowerCase().startsWith((root + path.sep).toLowerCase());
const maxBytes = 2 * 1024 * 1024, chunkBytes = 24576, budget = 12 * 1024 * 1024;

/**
 * 保存当前授权会话的有界语音句柄，不接受调用方指定的路径或URL。
 * @param {object} options 已初始化service、所属root/nativeRoots、独立收发开关及目标/存活检查。
 * @returns {object} observe/complete/getRecord/upload/validateSend/prepareSend/close/snapshot。
 * @note 单事件循环；24句柄、12MiB预算、60秒/条、十分钟有效，下载超时不重试。
 */
export function createNativeVoiceStore({ service, root, nativeRoots = [], receiveEnabled = false,
  sendEnabled = false, isActive, authorizeTarget, now = Date.now, downloadTimeoutMs = 15000 }) {
  if ((!receiveEnabled && !sendEnabled) || !path.isAbsolute(root ?? '') || typeof isActive !== 'function' ||
      typeof authorizeTarget !== 'function' || !Number.isSafeInteger(downloadTimeoutMs) || downloadTimeoutMs < 10 || downloadTimeoutMs > 30000) throw fail('VOICE_CONFIG_INVALID');
  const owned = fs.mkdtempSync(path.join(fs.realpathSync(root), 'voice-run-'));
  const roots = [owned, ...nativeRoots.map((p) => fs.realpathSync(p))];
  const records = new Map(), uploads = new Map(), downloads = new Map(), tasks = new Set();
  const ownedFiles = new Set(); let closed = false, used = 0, reserved = 0, diskReserved = 0, cleanup;
  const counts = { observed: 0, downloaded: 0, uploaded: 0, downloadFailures: 0 };
  const active = () => { if (closed || !isActive()) throw fail('VOICE_DISABLED'); };
  const sweep = () => {
    for (const [id, item] of records) if (!item.task && now() - item.at > 600000) {
      if (item.bytes) { used -= item.bytes.length; item.bytes.fill(0); } records.delete(id);
    }
    for (const [id, item] of uploads) if (now() - item.at > 60000) {
      for (const part of item.parts) part.fill(0); reserved -= item.size; uploads.delete(id);
    }
  };
  const allocate = (item) => {
    active(); sweep(); if (records.size >= 24) throw fail('VOICE_LIMIT');
    const handle = 'qqvoice_' + randomBytes(16).toString('hex');
    const record = { ...item, handle, at: now() }; records.set(handle, record); return record;
  };
  const lookup = (handle) => {
    active(); sweep(); if (!/^qqvoice_[a-f0-9]{32}$/.test(handle ?? '') || !records.has(handle)) throw fail('VOICE_NOT_CACHED');
    return records.get(handle);
  };
  function observe({ chatType, peerUid, msgId, elementId, voice }) {
    active(); if (!receiveEnabled) return null;
    sweep();
    const prior = [...records.values()].find((i) => i.chatType === chatType && i.peerUid === peerUid && i.msgId === msgId && i.elementId === elementId);
    if (prior) return { type: 'record', data: { file: prior.handle } };
    const size = Number(field(voice, 'fileSize')), duration = Number(field(voice, 'duration'));
    const md5 = field(voice, 'md5HexStr'), source = field(voice, 'filePath');
    if (![1, 2].includes(chatType) || typeof peerUid !== 'string' || !/^[1-9]\d{0,19}$/.test(msgId ?? '') ||
        !/^[1-9]\d{0,19}$/.test(elementId ?? '') || !Number.isSafeInteger(size) || size < 12 || size > maxBytes ||
        !Number.isFinite(duration) || duration <= 0 || duration > 60) throw fail('VOICE_LIMIT');
    const item = allocate({ key: chatType + ':' + peerUid, chatType, peerUid, msgId, elementId, size,
      md5: typeof md5 === 'string' && /^[a-f0-9]{32}$/i.test(md5) ? md5.toLowerCase() : null,
      source: typeof source === 'string' && path.isAbsolute(source) ? source : null });
    counts.observed++; return { type: 'record', data: { file: item.handle } };
  }
  async function readVerified(file, item) {
    if (typeof file !== 'string' || file.length > 4096) throw fail('VOICE_FILE_REFUSED');
    const real = await files.realpath(file);
    if (!roots.some((r) => within(real, r)) || (await files.lstat(file)).isSymbolicLink() ||
        (!item.md5 && real.toLowerCase() !== item.destination?.toLowerCase())) throw fail('VOICE_FILE_REFUSED');
    const fd = await files.open(real, 'r');
    try {
      const before = await fd.stat();
      if (!before.isFile() || before.size !== item.size || before.size > maxBytes) throw fail('VOICE_LIMIT');
      const bytes = Buffer.alloc(before.size); let offset = 0;
      while (offset < bytes.length) { const r = await fd.read(bytes, offset, bytes.length - offset, offset); if (!r.bytesRead) throw fail('VOICE_FILE_REFUSED'); offset += r.bytesRead; }
      const after = await fd.stat(), info = inspectSilk(bytes);
      if (before.mtimeMs !== after.mtimeMs || after.size !== before.size || (item.md5 && info.md5 !== item.md5)) throw fail('VOICE_FILE_REFUSED');
      active(); return { bytes, info };
    } finally { await fd.close(); }
  }
  async function ensure(item) {
    active(); if (item.bytes) return item;
    if (item.failure) throw fail(item.failure); if (item.task) return item.task;
    if (downloads.size >= 2 || used + reserved + item.size > budget || diskReserved + item.size > budget) throw fail('VOICE_LIMIT');
    reserved += item.size;
    item.task = (async () => {
      try {
        let result;
        if (item.md5 && item.source) {
          try { result = await readVerified(item.source, item); }
          catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; }
        }
        if (!result) {
          item.destination = path.join(owned, item.handle + '.silk'); ownedFiles.add(item.destination); diskReserved += item.size;
          const file = await new Promise((resolve, reject) => {
            const key = [item.chatType, item.msgId, item.elementId].join(':');
            const finish = (err, value) => { clearTimeout(timer); downloads.delete(key); err ? reject(err) : resolve(value); };
            const timer = setTimeout(() => finish(fail('VOICE_DOWNLOAD_TIMEOUT')), downloadTimeoutMs);
            downloads.set(key, { finish });
            try { Promise.resolve(nativeMethod(service, 'downloadRichMedia')({ fileModelId: '0', downSourceType: 0,
              downloadSourceType: 0, triggerType: 1, msgId: item.msgId, chatType: item.chatType, peerUid: item.peerUid,
              elementId: item.elementId, thumbSize: 0, downloadType: 1, filePath: item.destination })).catch(() => finish(fail('VOICE_DOWNLOAD_FAILED'))); }
            catch { finish(fail('VOICE_DOWNLOAD_FAILED')); }
          });
          result = await readVerified(file, item);
        }
        active(); item.bytes = result.bytes; item.info = result.info; used += item.size; counts.downloaded++; return item;
      } catch (err) { item.failure = err.code === 'VOICE_DISABLED' ? 'VOICE_DISABLED' : 'VOICE_DOWNLOAD_FAILED'; counts.downloadFailures++; throw fail(item.failure); }
      finally { reserved -= item.size; item.task = null; }
    })(); return item.task;
  }
  function complete(value) {
    const pending = downloads.get([field(value, 'chatType'), field(value, 'msgId'), field(value, 'msgElementId')].join(':'));
    if (!pending) return;
    if (field(value, 'fileErrCode') !== '0' || field(value, 'fileProgress') !== '0' ||
        (field(value, 'fileSrvErrCode') !== undefined && field(value, 'fileSrvErrCode') !== '0')) pending.finish(fail('VOICE_DOWNLOAD_FAILED'));
    else pending.finish(null, field(value, 'filePath'));
  }
  async function getRecord(params) {
    const item = await ensure(lookup(field(params, 'file'))); active();
    const offset = field(params, 'offset');
    if (offset === undefined) return { native_record: { file: item.handle, size: item.size, sha256: item.info.sha256, durationMs: item.info.durationMs } };
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= item.size || offset % chunkBytes) throw fail('VOICE_CHUNK_INVALID');
    return { file: item.handle, size: item.size, offset, data: item.bytes.subarray(offset, offset + chunkBytes).toString('base64') };
  }
  function validateSend(file, key) {
    if (!sendEnabled) throw fail('VOICE_DISABLED');
    const item = lookup(file); if (item.key !== key) throw fail('TARGET_NOT_ALLOWED');
    return { elementType: 4, elementId: '', pttElement: {} };
  }
  async function prepareInner(file, key) {
    validateSend(file, key); const item = await ensure(lookup(file)); validateSend(file, key);
    const info = item.info, fileName = info.md5 + '.silk';
    const output = nativeMethod(service, 'getRichMediaFilePathForGuild')({ md5HexStr: info.md5, fileName,
      elementType: 4, elementSubType: 0, thumbSize: 0, needCreate: true, downloadType: 1, file_uuid: '' });
    if (typeof output !== 'string' || output.length > 4096 || path.basename(output) !== fileName) throw fail('VOICE_PREPARATION_FAILED');
    const parent = await files.realpath(path.dirname(output));
    if (!roots.some((r) => parent.toLowerCase() === r.toLowerCase() || within(parent, r))) throw fail('VOICE_FILE_REFUSED');
    const destination = path.join(parent, fileName); active();
    try { await files.writeFile(destination, item.bytes, { flag: 'wx' }); }
    catch (err) { if (err.code !== 'EEXIST' || (await readVerified(destination, { ...item, md5: info.md5 })).info.sha256 !== info.sha256) throw fail('VOICE_PREPARATION_FAILED'); }
    active(); validateSend(file, key);
    return { elementType: 4, elementId: '', pttElement: { fileName, filePath: destination, md5HexStr: info.md5,
      fileSize: String(info.size), duration: Math.max(1, Math.ceil(info.durationMs / 1000)), formatType: 1,
      voiceType: 1, voiceChangeType: 0, canConvert2Text: true, waveAmplitudes: [], fileSubId: '',
      playState: 1, autoConvertText: 0, storeID: 0, otherBusinessInfo: { aiVoiceType: 0 } } };
  }
  function prepareSend(file, key) {
    const task = prepareInner(file, key); tasks.add(task); task.then(() => tasks.delete(task), () => tasks.delete(task)); return task;
  }
  function upload(params) {
    active(); sweep(); if (!sendEnabled) throw fail('VOICE_DISABLED');
    const op = field(params, 'operation');
    if (op === 'begin') {
      const key = authorizeTarget(field(params, 'kind'), field(params, 'target')), size = field(params, 'size'), sha256 = field(params, 'sha256');
      if (!Number.isSafeInteger(size) || size < 12 || size > maxBytes || !/^[a-f0-9]{64}$/.test(sha256 ?? '') ||
          records.size + uploads.size >= 24 || uploads.size >= 2 || used + reserved + size > budget) throw fail('VOICE_LIMIT');
      const id = 'qqvu_' + randomBytes(16).toString('hex'); uploads.set(id, { key, size, sha256, at: now(), offset: 0, parts: [] }); reserved += size; return { upload: id };
    }
    const id = field(params, 'upload'), item = uploads.get(id); if (!item) throw fail('VOICE_NOT_CACHED');
    const remove = () => { for (const part of item.parts) part.fill(0); reserved -= item.size; uploads.delete(id); };
    if (op === 'abort') { remove(); return { aborted: true }; }
    if (op === 'append') {
      const raw = field(params, 'data');
      if (typeof raw !== 'string' || !raw.length || raw.length > chunkBytes * 4 / 3 || raw.length % 4 || /[^A-Za-z0-9+/=]/.test(raw)) throw fail('VOICE_CHUNK_INVALID');
      const bytes = Buffer.from(raw, 'base64');
      if (raw !== bytes.toString('base64') || field(params, 'offset') !== item.offset || item.offset + bytes.length > item.size) throw fail('VOICE_CHUNK_INVALID');
      item.parts.push(bytes); item.offset += bytes.length; return { offset: item.offset };
    }
    if (op !== 'finish') throw fail('VOICE_CHUNK_INVALID');
    try {
      if (item.offset !== item.size) throw fail('VOICE_CHUNK_INVALID');
      const bytes = Buffer.concat(item.parts), info = inspectSilk(bytes);
      if (info.sha256 !== item.sha256) throw fail('VOICE_CHUNK_INVALID');
      const record = allocate({ key: item.key, size: item.size, bytes, info }); used += item.size; counts.uploaded++; return { file: record.handle, size: item.size };
    } finally { remove(); }
  }
  function close() {
    if (cleanup) return cleanup; closed = true;
    const running = [...tasks, ...[...records.values()].map((i) => i.task).filter(Boolean)];
    for (const pending of [...downloads.values()]) pending.finish(fail('VOICE_DISABLED'));
    for (const item of uploads.values()) { for (const part of item.parts) part.fill(0); reserved -= item.size; } uploads.clear();
    for (const item of records.values()) item.bytes?.fill(0); records.clear(); used = 0;
    cleanup = (async () => { await Promise.allSettled(running); for (const file of ownedFiles) {
      try { await files.unlink(file); } catch (e) { if (e.code !== 'ENOENT') throw fail('VOICE_CLEANUP_FAILED'); }
    } await files.rmdir(owned); })(); return cleanup;
  }
  return Object.freeze({ observe, complete, getRecord, upload, validateSend, prepareSend, close,
    snapshot: () => ({ ...counts, handles: records.size, pendingDownloads: downloads.size, pendingUploads: uploads.size, residentBytes: used, reservedBytes: reserved, closed }) });
}
