import { promises as files, realpathSync } from 'node:fs';
import path from 'node:path';
import { acquireGatewayDataLease } from './gateway-data-lease.mjs';
import { recoverProfileAvatarOwners } from './profile-avatar-owner.mjs';
import { recoverNativeStickerOwners } from './native-sticker-owner.mjs';

const fail = code => new Error(code);
async function readOrdinary(file, limit) {
  const stat = await files.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit) throw fail('GATEWAY_RECOVERY_METADATA_REFUSED');
  const value = await files.readFile(file), after = await files.lstat(file);
  if (stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw fail('GATEWAY_RECOVERY_METADATA_REFUSED');
  return { value, stat };
}

/**
 * 在父宿主持有数据租约时回收同目录v1协议残留；不杀进程、不登录、不扫描账号目录。
 * @param {object} options dataRoot为所属核验目录；supervisorLease必须绑定该目录；fixture隔离测试与真实模式。
 * @returns {Promise<object>} 仅计数与staleLockRemoved；恢复期间同时持有worker租约，活着的旧worker会使获取失败。
 * @note 旧无租约协议的残留锁拒绝自动回收，要求先人工核验；未知头像根保留计数。
 *   新协议根据OS排他租约证明旧宿主不在，不按记忆PID杀进程，也不受PID复用影响。
 */
export async function recoverGatewayArtifacts({ dataRoot, supervisorLease, fixture }) {
  const canonical = realpathSync(dataRoot);
  if (typeof fixture !== 'boolean' || typeof supervisorLease?.owns !== 'function'
      || !supervisorLease.owns(canonical, 'supervisor')) throw fail('GATEWAY_RECOVERY_NOT_ISOLATED');
  const workerLease = acquireGatewayDataLease(canonical, 'worker');
  const isolated = () => supervisorLease.owns(canonical, 'supervisor') && workerLease.owns(canonical, 'worker');
  try {
    const lockFile = path.join(canonical, 'owner.lock'), stateFile = path.join(canonical, 'status.json');
    let lock = null, previous = null, stateBytes = null;
    try { lock = await readOrdinary(lockFile, 0); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { stateBytes = (await readOrdinary(stateFile, 65536)).value; previous = JSON.parse(stateBytes.toString('utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw fail('GATEWAY_RECOVERY_METADATA_REFUSED'); }
    if (previous !== null) {
      if (!previous || typeof previous !== 'object' || Array.isArray(previous) || previous.component !== 'qq-native-gateway'
          || previous.schemaVersion !== 1 || previous.fixture !== fixture || typeof previous.instanceId !== 'string'
          || !/^[a-f0-9-]{36}$/.test(previous.instanceId) || typeof previous.dataDirectory !== 'string'
          || path.resolve(previous.dataDirectory).toLowerCase() !== canonical.toLowerCase()) throw fail('GATEWAY_RECOVERY_METADATA_REFUSED');
      if (previous.artifactLeaseProtocol !== 1 && (lock || previous.status !== 'stopped' || previous.workerExitCode !== 0)) {
        throw fail('LEGACY_GATEWAY_ARTIFACTS_REQUIRE_REVIEW');
      }
    } else if (lock) throw fail('GATEWAY_RECOVERY_METADATA_REFUSED');
    const avatars = await recoverProfileAvatarOwners({ parent: canonical, isolated, fixture });
    const stickers = recoverNativeStickerOwners({ parent: canonical, isolated, fixture });
    if (lock) {
      if (!isolated() || !stateBytes || !(await readOrdinary(stateFile, 65536)).value.equals(stateBytes)) throw fail('GATEWAY_RECOVERY_METADATA_CHANGED');
      const fresh = await readOrdinary(lockFile, 0);
      if (fresh.stat.dev !== lock.stat.dev || fresh.stat.ino !== lock.stat.ino || fresh.stat.mtimeMs !== lock.stat.mtimeMs) throw fail('GATEWAY_RECOVERY_METADATA_CHANGED');
      await files.unlink(lockFile);
    }
    return { staleLockRemoved: lock !== null, avatars, stickers };
  } finally { workerLease.close(); }
}
