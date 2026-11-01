import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
/**
 * 只读采集指定组件进程及其监听端口；不读取命令行、环境或凭据。
 * @param {number[]} pids 1到16个明确的所属PID；拒绝任意筛选表达式。
 * @returns {Promise<object>} OS创建时间、父PID、可执行路径、是否当前用户及指定PID监听端口。
 * @throws {Error} 平台、PID、查询失败时仅给固定错误，不转发原始系统输出。
 */
export async function inspectOwnedProcesses(pids) {
  if (process.platform !== 'win32' || !Array.isArray(pids) || !pids.length || pids.length > 16 ||
    !pids.every((pid) => Number.isSafeInteger(pid) && pid > 0 && pid <= 2147483647)) throw new Error('PROCESS_INSPECTION_REFUSED');
  try {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      join(dirname(fileURLToPath(import.meta.url)), 'inspect-owned-processes.ps1'), '-ProcessIdsCsv', [...new Set(pids)].join(',')],
    { windowsHide: true, timeout: 30000, maxBuffer: 131072 });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (!Array.isArray(result.processes) || !Array.isArray(result.listeners)) throw new Error();
    return result;
  } catch (error) {
    const detail = String(error?.stderr ?? '');
    const kind = /PSSecurityException/.test(detail) ? 'SCRIPT_POLICY' : /Get-NetTCPConnection/.test(detail) ? 'TCP_QUERY' :
      /Get-CimInstance|Invoke-CimMethod/.test(detail) ? 'PROCESS_QUERY' : /ParameterBinding|参数/.test(detail) ? 'SCRIPT_ARGUMENT' : 'UNAVAILABLE';
    throw new Error('PROCESS_INSPECTION_' + kind);
  }
}
/**
 * 将OS证据与已核验健康协议关联；不按PID杀进程或修改任何状态。
 * @param {object} input combined/native是当前健康结果，observed来自OS采集，expectedExecutable是固定Node路径；stage=dsh仅核验DSH启动阶段。
 * @returns {object} ok、通过角色和固定失败码；不含账号、SID、命令行或凭据。
 * @note 这是当前时点的组件身份/端口交叉核验；不证明管道ACL或多用户隔离。
 */
export function verifyProcessIdentity({ combined, native, observed, expectedExecutable, stage = 'all' }) {
  const failures = [], checked = [];
  if (!['dsh', 'all'].includes(stage)) return { ok: false, checkedRoles: [], endpointCount: 0, failures: ['INVALID_STAGE'] };
  const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && normalize(a).toLowerCase() === normalize(b).toLowerCase();
  const byPid = new Map((observed?.processes ?? []).map((entry) => [entry.pid, entry]));
  const roles = [
    ['combined', combined?.supervisorPid, null, combined?.startedAt],
    ['dsh', combined?.dsh?.pid, combined?.supervisorPid, null],
    ...(stage === 'all' ? [
      ['gateway', combined?.gateway?.pid, combined?.supervisorPid, native?.startedAt],
      ['worker', native?.workerPid, combined?.gateway?.pid, null],
      ...(combined?.bridge?.pid ? [['bridge', combined.bridge.pid, combined.supervisorPid, null]] : []),
    ] : []),
  ];
  const rolePids = roles.map(([, pid]) => pid);
  if (rolePids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0) || new Set(rolePids).size !== rolePids.length) failures.push('INVALID_OR_DUPLICATE_ROLE_PID');
  if (new Set((observed?.processes ?? []).map((record) => record.pid)).size !== (observed?.processes ?? []).length) failures.push('DUPLICATE_PROCESS_RECORD');
  for (const [role, pid, parent, logicalStart] of roles) {
    const record = byPid.get(pid);
    if (!record) { failures.push(role + '_PROCESS_MISSING'); continue; }
    if (!samePath(record.executable, expectedExecutable)) failures.push(role + '_EXECUTABLE_MISMATCH');
    if (record.ownerMatchesCaller !== true) failures.push(role + '_OWNER_MISMATCH');
    if (parent && record.parentPid !== parent) failures.push(role + '_PARENT_MISMATCH');
    const created = Date.parse(record.createdAt);
    if (!Number.isFinite(created)) failures.push(role + '_CREATION_INVALID');
    if (parent && created < Date.parse(byPid.get(parent)?.createdAt)) failures.push(role + '_CREATION_BEFORE_PARENT');
    if (logicalStart) {
      const interval = Date.parse(logicalStart) - created;
      if (!Number.isFinite(interval) || interval < -1000 || interval > 60000) failures.push(role + '_START_TIME_MISMATCH');
    }
    checked.push(role);
  }
  if (stage === 'all' && native?.supervisorPid !== combined?.gateway?.pid) failures.push('GATEWAY_IDENTITY_MISMATCH');
  const endpoints = [
    ['combined_control', combined?.controlUrl, combined?.supervisorPid],
    ['dsh_http', combined?.dsh?.url, combined?.dsh?.pid],
    ...(stage === 'all' ? [
      ['gateway_control', native?.controlUrl, combined?.gateway?.pid],
      ['gateway_portal', native?.portalUrl, native?.workerPid],
      ...(native?.status === 'ready' ? [['onebot', native.onebotUrl, native.workerPid]] : []),
    ] : []),
  ];
  for (const [role, endpoint, pid] of endpoints) {
    if (typeof endpoint !== 'string' || !/^(?:http|ws):\/\/127\.0\.0\.1:\d+$/.test(endpoint)) {
      failures.push(role + '_ENDPOINT_INVALID'); continue;
    }
    const port = Number(new URL(endpoint).port);
    if (!(observed?.listeners ?? []).some((entry) => entry.pid === pid && entry.port === port && entry.address === '127.0.0.1')) failures.push(role + '_LISTENER_MISMATCH');
  }
  if ((observed?.listeners ?? []).some((entry) => !['127.0.0.1', '::1'].includes(entry.address))) failures.push('OWNED_NON_LOOPBACK_LISTENER');
  return { ok: failures.length === 0, checkedRoles: checked, endpointCount: endpoints.length, failures };
}

/**
 * 在凭据交接前强制核验当前所属进程；查询前后都检查调用方持有的子进程句柄。
 * @param {object} input 与verifyProcessIdentity一致，但不接收observed；对象在查询前复制。
 * @param {object} options stillCurrent必须检查所属句柄及实例未更换；inspect仅供合成测试替换只读OS采集。
 * @returns {Promise<object>} 脱敏核验结果；调用方只有成功返回后才能交接凭据。
 * @throws {Error} OS查询不可用给UNCONFIRMED；组件退出/更换或身份不符给FAILED。不泄露系统详情。
 * @note 单次启动关卡；不能代替持续身份检查、命名管道ACL或同用户恶意进程防护。
 */
export async function enforceProcessIdentity(input, { stillCurrent, inspect = inspectOwnedProcesses } = {}) {
  let observationUnavailable = false;
  try {
    if (typeof stillCurrent !== 'function') throw new Error();
    const snapshot = structuredClone(input);
    if (stillCurrent(snapshot) !== true) throw new Error();
    const pids = [snapshot.combined.supervisorPid, snapshot.combined.dsh.pid,
      ...(snapshot.stage === 'dsh' ? [] : [snapshot.combined.gateway.pid, snapshot.native.workerPid,
        ...(snapshot.combined.bridge.pid ? [snapshot.combined.bridge.pid] : [])])];
    let observed;
    try { observed = await inspect(pids); }
    catch { if (stillCurrent(snapshot) !== true) throw new Error(); observationUnavailable = true; throw new Error(); }
    if (stillCurrent(snapshot) !== true) throw new Error();
    const result = verifyProcessIdentity({ ...snapshot, observed });
    if (!result.ok) throw new Error();
    return result;
  } catch { throw new Error(observationUnavailable ? 'OWNED_PROCESS_IDENTITY_UNCONFIRMED' : 'OWNED_PROCESS_IDENTITY_FAILED'); }
}
