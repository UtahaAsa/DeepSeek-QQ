import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadSecurePipeRuntime } from './secure-pipe-runtime.mjs';

/**
 * 获取所属数据目录的进程级排他租约；不加载QQ，不读账号或消息。
 * @param {string} dataRoot 已存在且经过宿主边界核验的数据目录。
 * @param {string} kind supervisor或worker；二者有不同租约，恢复阶段须同时持有。
 * @returns {object} snapshot/close；复用受限Windows管道FIRST_PIPE_INSTANCE实现互斥，进程死亡由OS释放。
 * @throws {Error} 已占用、安全属性或宿主不满足时固定GATEWAY_DATA_LEASE_UNAVAILABLE，不接管或终止占用进程。
 * @note worker租约必须持有到进程实际退出，不能因掉线、destroy返回或停止请求提前close。
 */
export function acquireGatewayDataLease(dataRoot, kind) {
  let api, handle, canonical;
  try {
    if (!['supervisor', 'worker'].includes(kind)) throw 0;
    canonical = realpathSync(dataRoot).toLowerCase();
    const hex = createHash('sha256').update('qq-native-data-lease-v1\0' + kind + '\0' + canonical).digest('hex').slice(0, 32);
    const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    api = loadSecurePipeRuntime();
    handle = api.create('\\\\.\\pipe\\qq-native-gateway-' + id,
      JSON.stringify({ kind: 'data-lease', version: 1 }) + '\n', '{"ok":false}\n');
    if (!['running', 'aclVerified', 'remoteRejectConfigured', 'restrictedTokenDenied'].every(key => api.snapshot(handle)?.[key] === true)) throw 0;
  } catch { if (handle !== undefined) { try { api?.close(handle); } catch {} } throw new Error('GATEWAY_DATA_LEASE_UNAVAILABLE'); }
  let closed = false;
  return Object.freeze({ snapshot() {
    if (closed) return { held: false, kind };
    try { return { held: ['running', 'aclVerified', 'remoteRejectConfigured', 'restrictedTokenDenied'].every(key => api.snapshot(handle)?.[key] === true), kind }; }
    catch { return { held: false, kind }; }
  }, owns(candidate, role) {
    try { return !closed && role === kind && realpathSync(candidate).toLowerCase() === canonical
      && ['running', 'aclVerified', 'remoteRejectConfigured', 'restrictedTokenDenied'].every(key => api.snapshot(handle)?.[key] === true); }
    catch { return false; }
  }, close() {
    if (closed) return; closed = true;
    if (api.close(handle) !== true) throw new Error('GATEWAY_DATA_LEASE_CLOSE_UNCONFIRMED');
  } });
}
