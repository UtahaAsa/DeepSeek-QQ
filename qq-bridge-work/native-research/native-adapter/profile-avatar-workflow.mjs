import { promises as files } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createProfileAvatarStager, inspectProfileAvatar } from './profile-avatar-stage.mjs';
import { cropProfileAvatar, normalizeAvatarCrop } from './profile-avatar-crop.mjs';
import { QQ_AVATAR_MAX_BYTES } from '../../bridge/src/qq-avatar-limits.js';

const fail = code => Object.assign(new Error(code), { code });
const backupPattern = /^qqavatar_[a-f0-9]{32}$/;
const imagePattern = /^qqimg_[a-f0-9]{32}$/;
const hash = value => createHash('sha256').update(value).digest('hex');

/**
 * 为当前登录账号提供头像裁剪预览、修改前持久备份和一次显式恢复；构造无I/O。
 * @param {object} options root为原生账号数据下的备份根，stageRoot是本轮暂存根，subject只在内存用于目录摘要。
 *   readImage/registerImage仅接受当前会话缓存；readCurrent只读已核验自身头像服务，不接受模型路径/URL。
 *   isCurrent在每次异步后重验许可；crop仅用于固定解码器或隔离夹具，不授予发送图片权限。
 * @returns {object} prepare/preview/list/close/snapshot；prepare为内部租约，不向模型返回磁盘路径。
 * @note 每次改图及恢复前均备份当前可读取头像，非原上传图；最多32份，不自动清除。恢复提交前持久消耗一次资格。
 */
export function createProfileAvatarWorkflow({ root, stageRoot, subject, readImage, registerImage, readCurrent,
  isCurrent, crop = cropProfileAvatar, now = Date.now }) {
  if (!path.isAbsolute(root ?? '') || !path.isAbsolute(stageRoot ?? '') || typeof subject !== 'string' || !subject
      || ![readImage, registerImage, readCurrent, isCurrent, crop, now].every(value => typeof value === 'function'))
    throw fail('AVATAR_WORKFLOW_OPTIONS_INVALID');
  const accountRoot = path.join(root, hash(subject));
  let closed = false, busy = false;
  function current(context) {
    if (closed || isCurrent(context) !== true) throw fail('AVATAR_WORKFLOW_NOT_ALLOWED');
  }
  async function directory(context, create) {
    current(context);
    // 所有已存在祖先都必须是普通目录；拒绝链接/Junction，备份不落到外部目录。
    let part = path.parse(accountRoot).root;
    for (const name of accountRoot.slice(part.length).split(path.sep).filter(Boolean)) {
      part = path.join(part, name); let stat;
      try { stat = await files.lstat(part); }
      catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error;
        current(context); await files.mkdir(part); stat = await files.lstat(part);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('AVATAR_BACKUP_REFUSED');
    }
    current(context); return accountRoot;
  }
  async function readBackup(id, context) {
    if (!backupPattern.test(id ?? '')) throw fail('AVATAR_BACKUP_REFUSED');
    const base = await directory(context, false), location = path.join(base, id);
    const stat = await files.lstat(location);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('AVATAR_BACKUP_REFUSED');
    const read = async (name, limit) => {
      const filename = path.join(location, name), stat = await files.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit) throw fail('AVATAR_BACKUP_REFUSED');
      const bytes = await files.readFile(filename); current(context); return bytes;
    };
    const meta = JSON.parse((await read('meta.json', 4096)).toString('utf8'));
    const bytes = await read('image', QQ_AVATAR_MAX_BYTES);
    try {
      const info = inspectProfileAvatar(bytes);
      if (meta.id !== id || meta.version !== 1 || meta.sha256 !== info.sha256 || !Number.isSafeInteger(meta.createdAt))
        throw fail('AVATAR_BACKUP_REFUSED');
      let used = false;
      try { await files.lstat(path.join(location, 'restore-attempt')); used = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      current(context); return { bytes, meta, used, location };
    } catch (error) { bytes.fill(0); throw error; }
  }
  async function list(context) {
    current(context); let base;
    try { base = await directory(context, false); } catch (error) { if (error.code === 'ENOENT') return { backups: [] }; throw error; }
    const rows = (await files.readdir(base)).filter(value => backupPattern.test(value));
    if (rows.length > 32) throw fail('AVATAR_BACKUP_LIMIT');
    const backups = [];
    for (const id of rows) {
      const value = await readBackup(id, context);
      try { backups.push({ id, createdAt: value.meta.createdAt, restorable: !value.used, source: 'qq_avatar_service_snapshot' }); }
      finally { value.bytes.fill(0); }
    }
    return { backups: backups.sort((a, b) => b.createdAt - a.createdAt) };
  }
  async function saveCurrent(context) {
    const base = await directory(context, true);
    if ((await files.readdir(base)).filter(value => backupPattern.test(value)).length >= 32) throw fail('AVATAR_BACKUP_LIMIT');
    let bytes;
    try {
      bytes = await readCurrent(context); current(context); const info = inspectProfileAvatar(bytes);
      if (bytes.length > QQ_AVATAR_MAX_BYTES) throw fail('AVATAR_BACKUP_REFUSED');
      const id = 'qqavatar_' + randomBytes(16).toString('hex'), location = path.join(base, id);
      const createdAt = now(); if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw fail('AVATAR_BACKUP_REFUSED');
      current(context); await files.mkdir(location); current(context);
      await files.writeFile(path.join(location, 'image'), bytes, { flag: 'wx', mode: 0o600 }); current(context);
      await files.writeFile(path.join(location, 'meta.json'), JSON.stringify({ version: 1, id, createdAt,
        sha256: info.sha256, format: info.format }), { flag: 'wx', mode: 0o600 }); current(context);
      return id;
    } catch { throw fail('AVATAR_BACKUP_UNAVAILABLE'); }
    finally { bytes?.fill(0); }
  }
  const stage = createProfileAvatarStager({ root: stageRoot, isCurrent: context => !closed && isCurrent(context) === true,
    readImage: async (handle, context) => {
      if (imagePattern.test(handle)) return readImage(handle, context);
      throw fail('AVATAR_BACKUP_REFUSED');
    } });
  const restoreStage = createProfileAvatarStager({ root: stageRoot, isCurrent: context => !closed && isCurrent(context) === true,
    readImage: async (handle, context) => {
      const item = restoration;
      if (!item || handle !== item.handle || item.context !== context) throw fail('AVATAR_BACKUP_REFUSED');
      return Buffer.from(item.bytes);
    } });
  let restoration = null;
  async function prepare(value, context) {
    current(context); if (busy) throw fail('AVATAR_WORKFLOW_BUSY'); busy = true;
    let backup, lease;
    try {
      if (backupPattern.test(value ?? '')) {
        backup = await readBackup(value, context);
        if (backup.used) throw fail('AVATAR_BACKUP_ALREADY_RESTORED');
        const handle = 'qqimg_' + randomBytes(16).toString('hex');
        restoration = { handle, context, bytes: backup.bytes };
        lease = await restoreStage.prepare(handle, context); current(context);
        // 恢复也是一次头像修改；先保留当前图，才能显式撤销这次恢复。
        const backupId = await saveCurrent(context); current(context);
        const location = backup.location;
        return Object.freeze({ ...lease, backupId, restoredFrom: value, restoration: true,
          commit: async () => { current(context); await files.writeFile(path.join(location, 'restore-attempt'),
            'one_explicit_attempt', { flag: 'wx', mode: 0o600 }); current(context); } });
      }
      if (!imagePattern.test(value ?? '')) throw fail('AVATAR_BACKUP_REFUSED');
      // 先验证并暂存当前图片，再读取备份；任何准备失败都不调用QQ setter。
      lease = await stage.prepare(value, context); current(context);
      const backupId = await saveCurrent(context); current(context);
      return Object.freeze({ ...lease, backupId, restoration: false });
    } catch (error) { await lease?.release(); throw error; }
    finally { backup?.bytes.fill(0); restoration = null; busy = false; }
  }
  async function preview(handle, spec, context) {
    current(context); const cropSpec = normalizeAvatarCrop(spec);
    if (busy || !imagePattern.test(handle ?? '')) throw fail('AVATAR_WORKFLOW_BUSY'); busy = true;
    let bytes, output;
    try {
      bytes = await readImage(handle, context); current(context); inspectProfileAvatar(bytes);
      output = await crop(bytes, cropSpec); current(context);
      const info = inspectProfileAvatar(output);
      const file = registerImage(output, context); current(context);
      return { file, size: info.size, crop: cropSpec, image: { mimeType: info.mimeType, data: output.toString('base64') },
        submitted: false, instruction: '这里只生成512×512头像预览，没有修改QQ头像。确认位置后用该file调用qq_update_self_profile，勿用它发送图片。' };
    } finally { bytes?.fill(0); output?.fill(0); busy = false; }
  }
  return Object.freeze({ prepare, preview, list,
    close: async () => { closed = true; return Promise.all([stage.close(), restoreStage.close()]); },
    snapshot: () => {
      const normal = stage.snapshot(), restore = restoreStage.snapshot();
      return { closed, busy, stage: normal, restoreStage: restore, activeLeases: normal.activeLeases + restore.activeLeases,
        cleanupRequired: normal.cleanupRequired || restore.cleanupRequired, cleanupFailed: normal.cleanupFailed || restore.cleanupFailed,
        backupsPersistAcrossRestart: true };
    } });
}
