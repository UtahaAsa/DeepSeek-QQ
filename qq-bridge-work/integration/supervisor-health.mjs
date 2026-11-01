const identityErrors = new Set(['GATEWAY_IDENTITY_FAILED', 'OWNED_PROCESS_IDENTITY_FAILED']);
const fixedCodes = new Set([...identityErrors, 'OWNED_PROCESS_IDENTITY_UNCONFIRMED', 'GATEWAY_HEALTH_FAILED', 'GATEWAY_TERMINAL', 'BRIDGE_HEARTBEAT_TIMEOUT']);

/**
 * 将检查错误限制为固定诊断码，避免把网络诊断或输入内容写入状态。
 * @param {unknown} error 检查异常；不保存原始message/stack。
 * @returns {string} 固定故障码；同步、无副作用。
 */
export function supervisorProbeCode(error) {
  if (fixedCodes.has(error?.message)) return error.message;
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return 'HEALTH_PROBE_TIMEOUT';
  return 'HEALTH_PROBE_UNCONFIRMED';
}

/**
 * 区分观察失败、身份冲突和明确退出；活进程的超时不得触发整套停服。
 * @param {unknown} error 观察异常。
 * @param {object} processes dshAlive/gatewayAlive来自持有的子进程句柄，不取自状态文件。
 * @returns {object} action为observe/isolate_gateway/stop；code为固定诊断码。
 */
export function classifySupervisorFailure(error, { dshAlive, gatewayAlive }) {
  const code = supervisorProbeCode(error);
  if (!dshAlive) return { action: 'stop', code: 'DSH_PROCESS_EXITED' };
  if (!gatewayAlive || identityErrors.has(code) || code === 'GATEWAY_TERMINAL') return { action: 'isolate_gateway', code };
  return { action: 'observe', code };
}

/**
 * 桥接冷启动和运行分别计时；只生成诊断，不终止进程。
 * @param {object} timing startedAt/heartbeatAt/now为毫秒，firstHeartbeat表示已收到有效健康消息。
 * @returns {string|null} 固定故障码或null；冷启动120秒，运行心跳15秒。
 */
export function bridgeHeartbeatIssue({ startedAt, heartbeatAt, firstHeartbeat, now }) {
  const elapsed = now - (firstHeartbeat ? heartbeatAt : startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'HEALTH_CLOCK_UNCONFIRMED';
  if (!firstHeartbeat) return elapsed > 120000 ? 'BRIDGE_STARTUP_UNCONFIRMED' : null;
  return elapsed > 15000 ? 'BRIDGE_HEARTBEAT_TIMEOUT' : null;
}
