import { realpathSync, lstatSync, mkdtempSync, writeFileSync, promises as files } from 'node:fs';
import path from 'node:path';

const fail = () => new Error('PROFILE_AVATAR_OWNER_CLEANUP_UNCONFIRMED');
const markerName = 'owner.json';
const own = (object, key) => object && Object.getOwnPropertyDescriptor(object, key)?.value;
function parseMarker(bytes, root) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 4096) throw fail();
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 7 || Object.keys(value).some(key => !['schemaVersion', 'component', 'leaseProtocol', 'instanceId', 'rootName', 'createdAt', 'fixture'].includes(key))
      || value.schemaVersion !== 1 || value.component !== 'qq-native-avatar-owner' || value.leaseProtocol !== 1
      || typeof value.instanceId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.instanceId)
      || value.rootName !== path.basename(root) || typeof value.fixture !== 'boolean'
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw fail();
  return value;
}
async function sameDirectory(directory) {
  const value = await files.lstat(directory);
  return value.isDirectory() && !value.isSymbolicLink() && (await files.realpath(directory)).toLowerCase() === directory.toLowerCase();
}
async function cleanupRoot(root, canonical, verified, markerBytes = null) {
  if (!verified() || path.dirname(root).toLowerCase() !== canonical.toLowerCase() || !await sameDirectory(root)) throw fail();
  const entries = await files.readdir(root, { withFileTypes: true }), directories = [], plan = [];
  if (entries.length > 33) throw fail();
  if (markerBytes) {
    parseMarker(markerBytes, root);
    const marker = path.join(root, markerName), value = await files.lstat(marker);
    if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || value.size !== markerBytes.length
        || !(await files.readFile(marker)).equals(markerBytes)) throw fail();
  }
  for (const entry of entries) {
    if (entry.name === markerName && markerBytes) continue;
    if (!/^profile-avatar-[A-Za-z0-9]{6}$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) throw fail();
    const directory = path.join(root, entry.name), children = await files.readdir(directory, { withFileTypes: true });
    if (!await sameDirectory(directory) || children.length > 32) throw fail();
    directories.push(directory);
    for (const item of children) {
      if (!/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(item.name) || !item.isFile() || item.isSymbolicLink()) throw fail();
      const file = path.join(directory, item.name), value = await files.lstat(file);
      if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || value.size < 1 || value.size > 8 * 1024 * 1024) throw fail();
      plan.push({ file, stat: value });
    }
  }
  for (const item of plan) {
    if (!verified() || !await sameDirectory(root) || !await sameDirectory(path.dirname(item.file))) throw fail();
    const value = await files.lstat(item.file);
    if (!value.isFile() || value.isSymbolicLink() || value.dev !== item.stat.dev || value.ino !== item.stat.ino
        || value.nlink !== 1 || value.size !== item.stat.size || value.mtimeMs !== item.stat.mtimeMs) throw fail();
    await files.unlink(item.file);
  }
  for (const directory of directories) {
    if (!verified() || !await sameDirectory(root) || !await sameDirectory(directory)) throw fail();
    await files.rmdir(directory);
  }
  if (markerBytes) {
    if (!verified() || !await sameDirectory(root) || !(await files.readFile(path.join(root, markerName))).equals(markerBytes)) throw fail();
    await files.unlink(path.join(root, markerName));
  }
  if (!verified() || !await sameDirectory(root)) throw fail(); await files.rmdir(root);
}

/**
 * 创建本次worker专用头像根；可用持久最小标记支持以后崩溃恢复。
 * @param {object} options parent为核验的数据目录，workerExited由实际子进程终态核验。
 *   ownership仅由持有supervisor租约的宿主提供{instanceId,fixture}；缺省无标记，不可自动恢复。
 * @returns {object} root/cleanup/snapshot；标记仅含所属实例元数据，无账号、图片、凭据或任意路径。
 * @note 不递归删除；未知项、链接、文件身份变化或退出证明不足时保留现场。
 */
export function createProfileAvatarOwner({ parent, workerExited, ownership = null }) {
  if (!path.isAbsolute(parent ?? '') || typeof workerExited !== 'function') throw fail();
  if (ownership !== null && (typeof own(ownership, 'instanceId') !== 'string' || !/^[a-f0-9-]{36}$/.test(ownership.instanceId)
      || typeof own(ownership, 'fixture') !== 'boolean' || Object.keys(ownership).some(key => !['instanceId', 'fixture'].includes(key)))) throw fail();
  const canonical = realpathSync(parent), stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail();
  const root = mkdtempSync(path.join(canonical, 'avatar-owner-'));
  const markerBytes = ownership ? Buffer.from(JSON.stringify({ schemaVersion: 1, component: 'qq-native-avatar-owner', leaseProtocol: 1,
    instanceId: ownership.instanceId, rootName: path.basename(root), createdAt: new Date().toISOString(), fixture: ownership.fixture })) : null;
  if (markerBytes) writeFileSync(path.join(root, markerName), markerBytes, { flag: 'wx', mode: 0o600 });
  let cleanupComplete = false, cleanupFailed = false, cleanupTask = null;
  function verified() { try { return workerExited() === true; } catch { return false; } }
  function cleanup() {
    if (cleanupTask) return cleanupTask;
    if (!verified()) return Promise.reject(fail());
    cleanupTask = cleanupRoot(root, canonical, verified, markerBytes).then(() => { cleanupComplete = true; return snapshot(); },
      () => { cleanupFailed = true; throw fail(); });
    return cleanupTask;
  }
  function snapshot() { return { cleanupComplete, cleanupFailed }; }
  return Object.freeze({ root, cleanup, snapshot });
}

/**
 * 恢复当前数据目录中带本组件v1标记的遗留头像根；不读账号目录或图片正文。
 * @param {object} options parent为核验的数据目录；isolated须全程确认同时持有supervisor/worker排他租约。
 *   fixture必须与标记一致，不能用测试启动清理真实残留。
 * @returns {Promise<object>} 仅计数；旧无标记/损坏/跨模式目录保留并计preserved，不冒称清理完毕。
 * @note 只枚举第一层avatar-owner前缀，最多64项，不扫描账号/下载目录。
 *   有标记但包含未知项等清理失败则拒绝，由上层保留诊断，不重试或删除其它数据。
 */
export async function recoverProfileAvatarOwners({ parent, isolated, fixture }) {
  if (!path.isAbsolute(parent ?? '') || typeof isolated !== 'function' || typeof fixture !== 'boolean') throw fail();
  const canonical = realpathSync(parent), stat = lstatSync(parent);
  const verified = () => { try { return isolated() === true; } catch { return false; } };
  if (!stat.isDirectory() || stat.isSymbolicLink() || !verified()) throw fail();
  const entries = (await files.readdir(canonical, { withFileTypes: true })).filter(entry => /^avatar-owner-/.test(entry.name));
  if (entries.length > 64) throw fail();
  let cleaned = 0, preserved = 0;
  for (const entry of entries) {
    if (!verified()) throw fail();
    const root = path.join(canonical, entry.name); let bytes;
    if (!/^avatar-owner-[A-Za-z0-9]{6}$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) { preserved++; continue; }
    try {
      if (!await sameDirectory(root)) throw fail();
      const marker = path.join(root, markerName), value = await files.lstat(marker);
      if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || value.size < 1 || value.size > 4096) throw fail();
      bytes = await files.readFile(marker);
      if (parseMarker(bytes, root).fixture !== fixture) throw fail();
    } catch { preserved++; continue; }
    await cleanupRoot(root, canonical, verified, bytes); cleaned++;
  }
  return { examined: entries.length, cleaned, preserved, complete: preserved === 0 };
}
