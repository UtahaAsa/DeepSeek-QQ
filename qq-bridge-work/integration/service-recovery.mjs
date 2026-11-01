import { existsSync, readFileSync, lstatSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { inspectOwnedProcesses } from './process-identity.mjs';
import { work, root, gateway, environment } from './environment.mjs';

const localOrigin = value => typeof value === 'string' && /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value)
  && Number(new URL(value).port) <= 65535;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const identity = value => value && /^[a-f0-9-]{36}$/.test(value.instanceId ?? '')
  && Number.isSafeInteger(value.supervisorPid) && value.supervisorPid > 0 && localOrigin(value.controlUrl);
const sameInstance = (a, b) => identity(a) && identity(b) && a.instanceId === b.instanceId
  && a.supervisorPid === b.supervisorPid && a.startedAt === b.startedAt;
const readSmall = file => {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw fail('RECOVERY_STATE_REFUSED');
  return readFileSync(file);
};

/**
 * 判断记录中的PID是否仍可能属于旧组件；证明是较晚创建且父进程/映像不同才排除复用。
 * @param {object} record 来自OS的创建时间、父PID及可执行路径，不读取命令行。
 * @param {object[]} references 捕获的状态文件时刻与该角色父PID；时间或身份不足保持存活判定。
 * @returns {boolean} true表示仍须阻止重复启动，不授予终止进程的权限；纯函数。
 */
export function recoveryProcessMayBeCurrent(record, references) {
  const candidates = references.filter(value => value.pid === record.pid);
  if (!candidates.length) return false;
  const created = Date.parse(record.createdAt);
  return candidates.some(reference => {
    if (!Number.isFinite(created) || !Number.isFinite(reference.snapshotMs) || created <= reference.snapshotMs + 2000) return true;
    const parentChanged = Number.isSafeInteger(reference.parentPid) && Number.isSafeInteger(record.parentPid)
      && reference.parentPid !== record.parentPid;
    const executableChanged = typeof record.executable === 'string' && record.executable.length > 0
      && basename(record.executable.replaceAll('\\', '/')).toLowerCase() !== 'node.exe';
    return !parentChanged && !executableChanged;
  });
}

/**
 * 把组件状态解释为新手可执行的下一步，不改变服务或保存配置。
 * @param {object} input health为已核验健康响应；alive表示记录中的进程仍存在。
 * @returns {object} 固定中文说明与操作枚举；不包含账号、地址、凭据或原始错误。
 * @note 同步纯函数；进程存活但健康未知时拒绝直接覆盖运行实例。
 */
export function describeRecovery({ health = null, alive = false, hasState = false, hasLock = false } = {}) {
  if (health?.bridge?.nativePermissionsCurrent === false && health?.gateway?.status === 'ready') return {
    phase: 'reply_blocked', title: 'QQ已连接，回复通道正在恢复',
    detail: health.bridge.nativePermissionsError === true ? '旧模型任务尚未确认停止，暂时不处理新消息；持续不恢复时请重启服务。'
      : '正在重新核验QQ权限与旧模型任务，确认完成后才恢复回复。', action: 'open', actionLabel: '打开工作台查看状态' };
  if (health?.status === 'degraded' && health.healthCheck) return { phase: 'checking', title: '服务进程仍在，正在重新确认状态',
    detail: '一次检查未完成，服务没有因此被强制停止。可以稍后重新检查；持续无法回复时，再点击重启服务。', action: 'open', actionLabel: '打开工作台' };
  if (health?.status === 'ready') return { phase: 'ready', title: '大肥鱼在线，可以正常聊天',
    detail: '工作台、QQ连接和聊天桥接均已就绪。', action: 'open', actionLabel: '打开工作台' };
  if (health && ['starting', 'stopping'].includes(health.status)) return {
    phase: 'working', title: '服务正在处理，请稍等', detail: '正在启动或结束所属组件，请不要重复点击恢复。', action: 'wait', actionLabel: '稍后重新检查' };
  if (health?.dsh?.status === 'ready') return { phase: 'connection_needed', title: '工作台在线，QQ需要重新连接',
    detail: '点击恢复后会打开本人连接页面；如QQ要求扫码或验证，请由本人完成。', action: 'reconnect', actionLabel: '恢复QQ连接' };
  if (alive || health) return { phase: 'needs_review', title: '检测到服务进程，暂时无法确认状态',
    detail: '为避免重复启动和打断现有会话，本次不强制结束进程。请稍后检查，或保留此状态进行排查。', action: 'wait', actionLabel: '重新检查' };
  return { phase: 'stopped', title: '服务已停止，点击即可重新启动',
    detail: hasState || hasLock ? '会保留原模型、声音、角色和会话；仅处理确认已退出实例留下的启动标记。' : '启动后请在本人连接页面确认QQ连接。',
    action: 'start', actionLabel: '启动服务' };
}

/**
 * 查询自有组合及网关状态，并交叉检查记录中的明确PID。
 * @param {object} options dataRoot/nativeRoot为所属目录，inspect/fetchImpl用于隔离验证。
 * @returns {Promise<object>} 内部检查结果；调用者只能公开view，不能透传disk/health。
 * @throws {Error} 状态文件不可信、OS检查失败时拒绝；只读，不自动重启。
 */
export async function inspectRecovery({ dataRoot = root, nativeRoot = join(gateway, 'service-data', 'combined'),
  inspect = inspectOwnedProcesses, fetchImpl = fetch } = {}) {
  const stateFile = join(dataRoot, 'status.json'), lockFile = join(dataRoot, 'owner.lock');
  const nativeStateFile = join(nativeRoot, 'status.json'), nativeLockFile = join(nativeRoot, 'owner.lock');
  const diskBytes = existsSync(stateFile) ? readSmall(stateFile) : null;
  const diskSnapshotMs = diskBytes ? lstatSync(stateFile).mtimeMs : null;
  const disk = diskBytes ? JSON.parse(diskBytes) : null;
  if (disk && !identity(disk)) throw fail('RECOVERY_STATE_REFUSED');
  const nativeBytes = existsSync(nativeStateFile) ? readSmall(nativeStateFile) : null;
  const nativeSnapshotMs = nativeBytes ? lstatSync(nativeStateFile).mtimeMs : null;
  const native = nativeBytes ? JSON.parse(nativeBytes) : null;
  if (native && !identity(native)) throw fail('RECOVERY_STATE_REFUSED');
  let health = null;
  if (disk) {
    try {
      const response = await fetchImpl(disk.controlUrl + '/health', { headers: { 'X-QQ-Combined-Instance': disk.instanceId },
        redirect: 'error', signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 256 * 1024) throw fail('RECOVERY_HEALTH_REFUSED');
        const value = JSON.parse(bytes);
        if (sameInstance(disk, value)) health = value;
      }
    } catch { /* 连接失败不等于进程已退出，下面必须独立查询OS。 */ }
  }
  const pids = [...new Set([disk?.supervisorPid, disk?.dsh?.pid, disk?.gateway?.pid, disk?.bridge?.pid,
    native?.supervisorPid, native?.workerPid].filter(value => Number.isSafeInteger(value) && value > 0))];
  const observed = pids.length ? await inspect(pids) : { processes: [], listeners: [] };
  const processReferences = [
    { pid: disk?.supervisorPid, parentPid: null, snapshotMs: diskSnapshotMs },
    ...[disk?.dsh?.pid, disk?.gateway?.pid, disk?.bridge?.pid].map(pid => ({ pid, parentPid: disk?.supervisorPid, snapshotMs: diskSnapshotMs })),
    { pid: native?.supervisorPid, parentPid: native?.supervisorPid === disk?.gateway?.pid ? disk?.supervisorPid : null, snapshotMs: nativeSnapshotMs },
    { pid: native?.workerPid, parentPid: native?.supervisorPid, snapshotMs: nativeSnapshotMs },
  ].filter(value => Number.isSafeInteger(value.pid) && value.pid > 0);
  const alive = observed.processes.some(item => recoveryProcessMayBeCurrent(item, processReferences));
  const files = [[stateFile, diskBytes, diskSnapshotMs], [nativeStateFile, nativeBytes, nativeSnapshotMs]]
    .filter(([,bytes]) => bytes).map(([file,bytes,mtimeMs]) => ({ file, hash: digest(bytes), mtimeMs }));
  const locks = [lockFile, nativeLockFile].filter(existsSync).map(file => {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw fail('RECOVERY_LOCK_REFUSED');
    return { file, hash: digest(readFileSync(file)), mtimeMs: stat.mtimeMs, ino: stat.ino };
  });
  return { view: describeRecovery({ health, alive, hasState: !!disk, hasLock: locks.length > 0 }),
    disk, health, pids, alive, files, locks, dataRoot, nativeRoot, processReferences };
}

/**
 * 在用户点击启动后保存确认已失去进程的锁标记，绝不删除账号文件或按PID查杀。
 * @param {object} before inspectRecovery的结果；inspect再次核验所有明确PID。
 * @returns {Promise<object>} 备份标记数；任何活进程、版本变化或检查失败均拒绝。
 * @note 异步；保留原状态与锁的字节副本，目标严格限制在两个所属owner.lock。
 */
export async function preserveStaleRecoveryLocks(before, inspect = inspectOwnedProcesses) {
  if (before.view.action !== 'start' || before.health || before.alive) throw fail('RECOVERY_LIVE_INSTANCE');
  const again = before.pids.length ? await inspect(before.pids) : { processes: [] };
  if (again.processes.some(item => before.processReferences
    ? recoveryProcessMayBeCurrent(item, before.processReferences) : before.pids.includes(item.pid))) throw fail('RECOVERY_LIVE_INSTANCE');
  for (const file of before.files) if (digest(readSmall(file.file)) !== file.hash || file.mtimeMs !== undefined && lstatSync(file.file).mtimeMs !== file.mtimeMs) throw fail('RECOVERY_STATE_CHANGED');
  const allowed = new Set([join(before.dataRoot, 'owner.lock'), join(before.nativeRoot, 'owner.lock')]);
  for (const lock of before.locks) {
    const stat = lstatSync(lock.file);
    if (!allowed.has(lock.file) || !stat.isFile() || stat.isSymbolicLink() || stat.ino !== lock.ino || stat.mtimeMs !== lock.mtimeMs
        || digest(readFileSync(lock.file)) !== lock.hash) throw fail('RECOVERY_STATE_CHANGED');
  }
  if (!before.locks.length) return { preservedLocks: 0 };
  const backup = join(before.dataRoot, 'recovery-backups', randomUUID());
  mkdirSync(backup, { recursive: true });
  for (let index = 0; index < before.files.length; index++) writeFileSync(join(backup, 'state-' + index + '.json'), readSmall(before.files[index].file), { flag: 'wx' });
  for (let index = 0; index < before.locks.length; index++) renameSync(before.locks[index].file, join(backup, 'owner-' + index + '.lock'));
  return { preservedLocks: before.locks.length };
}

/**
 * 经本人明确确认后，先正常结束同一实例，确认所属进程全退出再启动。
 * @param {object} current 已核验的检查结果；options包含确认值和隔离测试替身。
 * @returns {Promise<object>} 新启动阶段；停止未确认、代次变化或超时均拒绝启动。
 * @note 不强杀进程、不重试停止、不自动QQ登录；单线程，最多等待90秒。
 */
export async function restartOwnedRecovery(current, { confirmed = false, fetchImpl = fetch,
  inspect = inspectRecovery, start, wait = ms => new Promise(done => setTimeout(done, ms)), now = Date.now } = {}) {
  if (!confirmed || !sameInstance(current.disk, current.health) || typeof start !== 'function') throw fail('RECOVERY_RESTART_CONFIRMATION_REQUIRED');
  const response = await fetchImpl(current.disk.controlUrl + '/stop', { method: 'POST',
    headers: { 'X-QQ-Combined-Instance': current.disk.instanceId }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw fail('RECOVERY_STOP_UNCONFIRMED');
  const until = now() + 90000;
  while (now() < until) {
    await wait(1500);
    let next;
    try { next = await inspect(); }
    catch (error) {
      if (/^PROCESS_INSPECTION_(UNAVAILABLE|TCP_QUERY|PROCESS_QUERY)$/.test(error?.message ?? '')) continue;
      throw error;
    } // 仅重复暂时不可用的OS退出观察；不重发stop，不从检查失败推定已经停止。
    if (now() >= until) throw fail('RECOVERY_STOP_UNCONFIRMED');
    if (next.disk?.instanceId !== current.disk.instanceId) throw fail('RECOVERY_STATE_CHANGED');
    if (!next.alive && !next.health) return start();
  }
  throw fail('RECOVERY_STOP_UNCONFIRMED');
}

/**
 * 正常停止所属实例，失联时只依据重新取得的OS证据报告结果。
 * @param {object} options inspect/requestStop/wait/now为隔离验证替身；不按旧PID结束进程。
 * @returns {Promise<object>} 中文停止结果；未确认或检查失败不宣称退出。
 * @note 单线程异步；最多观察90秒，保留状态、锁、模型及会话；并发调用不重发正在停止的请求。
 */
export async function stopOwnedRecovery({ inspect = inspectRecovery, requestStop = async state => {
  const response = await fetch(state.controlUrl + '/stop', { method: 'POST',
    headers: { 'X-QQ-Combined-Instance': state.instanceId }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok || !sameInstance(state, await response.json())) throw fail('RECOVERY_STOP_UNCONFIRMED');
}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeoutMs = 90000 } = {}) {
  const result = (status, code, detail) => ({ status, code, detail, productionReady: false });
  const unknown = () => result('unknown', 'STOP_UNCONFIRMED', '仍有所属进程或退出证据不足，停止尚未确认；请保留当前状态进行排查。');
  try {
    let current = await inspect();
    const initial = current.disk;
    const sameGeneration = next => !initial ? !next.disk : sameInstance(initial, next.disk);
    const stopped = value => result('stopped', value.files?.length || value.locks?.length ? 'STOPPED_WITH_RESIDUE' : 'ALREADY_STOPPED',
      '已确认记录中的服务进程退出；原状态记录、模型和会话均已保留。');
    if (!current.health && !current.alive) {
      const again = await inspect();
      return sameGeneration(again) && !again.health && !again.alive ? stopped(again) : unknown();
    }
    if (!sameInstance(current.disk, current.health)) return unknown();
    if (current.health.status !== 'stopping') {
      try { await requestStop(current.health); } catch { /* 请求失联后仍必须独立观察OS。 */ }
    }
    const until = now() + timeoutMs;
    while (now() < until) {
      await wait(1000); current = await inspect();
      if (!sameGeneration(current)) return result('unknown', 'STOP_INSTANCE_CHANGED', '服务实例已变化，本次未操作新实例，请重新检查。');
      if (!current.health && !current.alive) return stopped(current);
      // 控制端点可先于最后一个进程退出；继续观察，不能把端点失联当作退出。
    }
    return current.health?.status === 'stopping'
      ? result('stopping', 'STOP_IN_PROGRESS', '所属实例仍在执行停止，尚未确认全部退出，请稍后再次检查。') : unknown();
  } catch {
    return result('unknown', 'STOP_INSPECTION_UNAVAILABLE', '暂时无法核验所属进程，不能确认停止；请稍后重新检查。');
  }
}

async function main(action = process.argv[2] ?? 'Status') {
  if (!['Status', 'Start', 'Reconnect', 'Restart'].includes(action)) throw fail('RECOVERY_ACTION_REFUSED');
  const current = await inspectRecovery();
  if (action === 'Status') return { ...current.view, canRestart: !!current.health && !['starting', 'stopping'].includes(current.health.status) };
  if (action === 'Restart') {
    return restartOwnedRecovery(current, { confirmed: process.argv.includes('--confirm-restart'), start: () => main('Start') });
  }
  if (action === 'Reconnect') {
    if (current.view.action !== 'reconnect' || !sameInstance(current.disk, current.health)) throw fail('RECOVERY_STATE_CHANGED');
    const response = await fetch(current.disk.controlUrl + '/qq-restart', { method: 'POST',
      headers: { 'X-QQ-Local-Action': '1' }, redirect: 'error', signal: AbortSignal.timeout(25000) });
    if (!response.ok) {
      // 已准备但未登录时复用既有页面，不循环重新创建网关。
      const url = current.health.gateway?.portalUrl;
      if (response.status === 409 && localOrigin(url)) return { ...current.view, openUrl: url };
      throw fail('RECOVERY_CONNECTION_FAILED');
    }
    const result = await response.json();
    if (!localOrigin(result.url)) throw fail('RECOVERY_ENDPOINT_REFUSED');
    return { ...current.view, openUrl: result.url };
  }
  if (current.view.action === 'open') return { ...current.view, openUrl: current.disk.controlUrl };
  if (current.view.action !== 'start') throw fail('RECOVERY_LIVE_INSTANCE');
  const app = join('C:\\Program Files\\Tencent\\QQNT', 'versions', '9.9.35-52892', 'resources', 'app');
  if (!existsSync(join(app, 'wrapper.node'))) throw fail('RECOVERY_QQ_VERSION_MISSING');
  await preserveStaleRecoveryLocks(current);
  // 此命令仅启动项目自身的受控监督器，QQ登录仍由本人完成。
  const child = spawn(process.execPath, [join(work, 'integration', 'control.mjs'), 'Start'], {
    cwd: work, env: { ...environment(), QQ_GATEWAY_APP: app }, windowsHide: true, detached: true,
    stdio: 'ignore' });
  await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
  child.unref();
  return { phase: 'working', title: '服务正在启动', detail: '可以保持此窗口打开，状态会自动刷新。需要QQ验证时请由本人完成。', action: 'wait', actionLabel: '正在启动' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.log(JSON.stringify({ phase: 'needs_review', title: '暂时无法安全恢复服务',
    detail: '请保留当前状态。没有强制结束进程，也没有改动原模型、声音、角色或会话。',
    action: 'wait', actionLabel: '重新检查', error: /^RECOVERY_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'RECOVERY_UNAVAILABLE' })); process.exitCode = 1; }
}
