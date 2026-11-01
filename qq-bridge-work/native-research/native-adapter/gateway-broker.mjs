import { loadSecurePipeRuntime } from './secure-pipe-runtime.mjs';
import { normalizeNativeScope } from './scope-policy.mjs';
import { normalizeIdleSettings } from './idle-policy.mjs';
import { normalizeGroupAdminPermissions } from './native-group-admin.mjs';
import { normalizeFriendRequestPermissions } from './native-friend-requests.mjs';
import { normalizeQzoneSettings } from './native-qzone.mjs';
import { normalizeSelfProfilePermissions } from './native-self-profile.mjs';

const pipeName = (instanceId) => {
  if (!/^[a-f0-9-]{36}$/.test(instanceId)) throw new Error('GATEWAY_INSTANCE_INVALID');
  return '\\\\.\\pipe\\qq-native-gateway-' + instanceId;
};
const request = (instanceId) => JSON.stringify({ version: 1, instanceId, action: 'connection' }) + '\n';

/**
 * 在受限Windows命名管道交接内存连接信息；不写令牌到磁盘、日志或命令行。
 * @param {object} options instanceId为监督器实例；getConnection未就绪时必须返回null。
 * @returns {Promise<object>} refresh必须在发布ready前调用；snapshot仅布尔安全状态；close幂等。
 * @throws {Error} 固定模块、ACL或创建失败时拒绝，不退回默认权限管道。
 * @note 仅当前登录会话SID可访问；创建时拒绝远程连接，双方核对OS进程身份。单客户端有界3秒。
 */
export async function createGatewayBroker({ instanceId, getConnection }) {
  let api, broker, timer, closed = false, last = '';
  try {
    api = loadSecurePipeRuntime();
    broker = api.create(pipeName(instanceId), request(instanceId), '{"ok":false}\n');
    const refresh = () => {
      if (closed) return;
      const security = api.snapshot(broker);
      if (!security.running || !security.aclVerified || !security.restrictedTokenDenied) throw new Error('GATEWAY_BROKER_IDENTITY_CHANGED');
      const connection = getConnection();
      const response = JSON.stringify(connection ? { ok: true, connection } : { ok: false }) + '\n';
      if (Buffer.byteLength(response) > 4096) throw new Error('GATEWAY_BROKER_RESPONSE_REFUSED');
      if (response !== last) { api.update(broker, response); last = response; }
    };
    refresh(); timer = setInterval(refresh, 100); timer.unref();
    return { refresh, snapshot: () => api.snapshot(broker), async close() {
      if (closed) return; closed = true; clearInterval(timer); last = '';
      if (!api.close(broker)) throw new Error('GATEWAY_BROKER_CLOSE_UNCONFIRMED');
    } };
  } catch {
    clearInterval(timer); if (broker) api.close(broker);
    throw new Error('GATEWAY_BROKER_UNAVAILABLE');
  }
}

/**
 * 在发送请求前核验服务端OS PID与登录会话，再读取连接信息；返回值只供内存使用。
 * @param {object} state 来自已核验Status，workerPid为指定服务端进程；fixture必须显式允许。
 * @param {object} options allowFixture默认false，防止生产误接测试实例。
 * @returns {Promise<object>} URL/令牌/目标范围；不得持久化或输出。
 * @throws {Error} 身份、状态、超时或响应不符时固定脱敏错误。
 * @note 同步原生I/O至多阻塞约3秒；不安装依赖、不读取QQ账号数据、不提升权限。
 */
export async function readGatewayConnection(state, { allowFixture = false } = {}) {
  if (state?.status !== 'ready' || (state.fixture !== false && !allowFixture)) throw new Error('GATEWAY_NOT_READY');
  try {
    if (!['running', 'aclVerified', 'remoteRejectConfigured', 'restrictedTokenDenied'].every((key) => state.pipeSecurity?.[key] === true)) throw new Error();
    if (!Number.isSafeInteger(state.workerPid) || state.workerPid <= 0 || state.workerPid > 2147483647) throw new Error();
    const raw = loadSecurePipeRuntime().read(pipeName(state.instanceId), state.workerPid, request(state.instanceId));
    const value = JSON.parse(raw), connection = value.connection;
    if (!value.ok || !/^ws:\/\/127\.0\.0\.1:\d+$/.test(connection?.url) || connection.url !== state.onebotUrl ||
        !/^[a-f0-9]{64}$/.test(connection.accessToken) ||
        typeof connection.allowSend !== 'boolean' || (connection.permissions !== undefined &&
          ['receiveImages', 'sendImages'].some((key) => typeof connection.permissions[key] !== 'boolean'))) throw new Error();
    if (['receiveVoice', 'sendVoice', 'readSelfAvatar', 'generateImages', 'useStickers', 'collectStickers'].some((key) => connection.permissions?.[key] !== undefined && typeof connection.permissions[key] !== 'boolean')) throw new Error();
    if (connection.scope !== undefined) {
      if (connection.allow !== undefined) throw new Error();
      connection.scope = normalizeNativeScope(connection.scope, { allowEmpty: true });
      connection.allow = { private: [...connection.scope.private.ids], groups: [...connection.scope.groups.ids] };
    } else if (![connection.allow?.private, connection.allow?.groups].every(ids => Array.isArray(ids) && ids.length === 1
      && typeof ids[0] === 'string' && /^[1-9]\d{0,19}$/.test(ids[0]))) throw new Error();
    connection.permissions = { receiveImages: connection.permissions?.receiveImages === true, sendImages: connection.permissions?.sendImages === true,
      receiveVoice: connection.permissions?.receiveVoice === true, sendVoice: connection.permissions?.sendVoice === true,
      readSelfAvatar: connection.permissions?.readSelfAvatar === true, generateImages: connection.permissions?.generateImages === true,
      useStickers: connection.permissions?.useStickers === true, collectStickers: connection.permissions?.collectStickers === true };
    if (connection.configurationRevision !== undefined && (!Number.isSafeInteger(connection.configurationRevision) || connection.configurationRevision < 1)) throw new Error();
    if (connection.permissions.generateImages && (!connection.allowSend || !connection.permissions.sendImages)) throw new Error();
    if (connection.permissions.collectStickers && !connection.permissions.receiveImages) throw new Error();
    connection.idleMessages = normalizeIdleSettings(connection.idleMessages);
    connection.groupAdmin = normalizeGroupAdminPermissions(connection.groupAdmin);
    connection.friendRequests = normalizeFriendRequestPermissions(connection.friendRequests);
    connection.qzone = normalizeQzoneSettings(connection.qzone);
    connection.selfProfile = normalizeSelfProfilePermissions(connection.selfProfile);
    if (connection.selfProfile.avatar && !(connection.permissions.receiveImages || connection.permissions.sendImages)) throw new Error();
    if (connection.groupAdmin.atAll && !connection.allowSend || Object.values(connection.groupAdmin).some(Boolean) && connection.scope?.groups.mode === 'disabled') throw new Error();
    if (connection.idleMessages.enabled && (!connection.allowSend || connection.scope?.groups.mode === 'disabled')) throw new Error();
    return connection;
  } catch { throw new Error('GATEWAY_CONNECTION_UNAVAILABLE'); }
}
