import { randomBytes } from 'node:crypto';
import { createNativeTextBridge, encodeNativeText } from './native-text-bridge.mjs';
import { createOneBotServer } from './onebot-server.mjs';
import { normalizeNativeScope, nativeScopeFromLists, nativeScopeSummary } from './scope-policy.mjs';
import { normalizeIdleSettings } from './idle-policy.mjs';
import { normalizeGroupAdminPermissions } from './native-group-admin.mjs';
import { normalizeFriendRequestPermissions } from './native-friend-requests.mjs';
import { normalizeQzoneSettings } from './native-qzone.mjs';
import { normalizeSelfProfilePermissions } from './native-self-profile.mjs';
import { gatewayFailureCode } from './gateway-diagnostics.mjs';
import { normalizeGatewayConfiguration } from './gateway-config.mjs';

const refused = (code) => Object.assign(new Error(code), { code });

/**
 * 为常驻会话添加每目标串行限速、失败退避和未知结果熔断；不排队或重试发送。
 * @param {object} backend 已有文字适配器；身份、正文仅在内存流转。
 * @param {object} options now 为可注入时钟；minIntervalMs 默认3秒，backoffMs 默认30秒。
 * @returns {object} 兼容 OneBot 后端的接口和仅计数的 policySnapshot。
 * @note 单 JS 线程；未知结果锁定本次会话，需要用户停止后重新建立会话；不自动恢复。
 */
export function withSendPolicy(backend, { now = Date.now, minIntervalMs = 3000, backoffMs = 30000 } = {}) {
  const peers = new Map();
  let circuitOpen = false, rejectedByPolicy = 0;
  async function send(kind, target, message, idle = false, claim = null) {
      if (!['private', 'group'].includes(kind) || !/^[1-9]\d{0,19}$/.test(String(target))) throw refused('TARGET_NOT_ALLOWED');
      if (idle) backend.validateIdleMessage(String(target), claim, message);
      else if (typeof backend.validateMessage === 'function') backend.validateMessage(kind, String(target), message);
      else encodeNativeText(message);
      const key = kind + ':' + String(target);
      if (!peers.has(key) && peers.size >= 128) throw refused('SEND_LIMIT');
      const peer = peers.get(key) ?? { busy: false, next: 0, failures: 0 };
      if (circuitOpen || peer.busy || now() < peer.next) { rejectedByPolicy++; throw refused('SEND_LIMIT'); }
      const previousNext = peer.next;
      peers.set(key, peer); peer.busy = true; peer.next = now() + minIntervalMs;
      try {
        const result = await (idle ? backend.sendIdleText(target, claim, message) : backend.sendText(kind, target, message));
        peer.failures = 0; return result;
      } catch (error) {
        // 这些群身份/额度检查仅查询信息，尚未触达发送；失败不占用后续正常文字的发送时隙。
        if (['GROUP_ADMIN_AT_ALL_REFUSED', 'GROUP_ADMIN_MEMBER_UNVERIFIED', 'GROUP_ADMIN_ROLE_REFUSED',
          'GROUP_ADMIN_NOT_ALLOWED', 'GROUP_ADMIN_CLOCK_INVALID', 'GROUP_ADMIN_BUSY', 'GROUP_ADMIN_TIMEOUT',
          'GROUP_ADMIN_UNAVAILABLE'].includes(error?.code)) peer.next = previousNext;
        // 只有可能触及原生发送的失败才触发退避；格式/权限拒绝不改变发送结论。
        if (['SEND_REJECTED', 'SEND_OUTCOME_UNKNOWN', 'SEND_PREPARATION_FAILED'].includes(error?.code)) {
          peer.failures++;
          peer.next = now() + Math.min(backoffMs * 2 ** Math.min(peer.failures - 1, 5), 900000);
          if (error.code === 'SEND_OUTCOME_UNKNOWN' || peer.failures >= 3) circuitOpen = true;
        }
        throw error;
      } finally { peer.busy = false; }
  }
  return { ...backend, policySnapshot: () => ({ circuitOpen, rejectedByPolicy }),
    getImageGenerationSubject: (kind, target) => { if (circuitOpen) throw refused('SEND_LIMIT'); return backend.getImageGenerationSubject(kind, target); },
    idleCandidates: () => circuitOpen ? [] : backend.idleCandidates?.() ?? [],
    claimIdleGroup: group => { if (circuitOpen) throw refused('SEND_LIMIT'); return backend.claimIdleGroup(group); },
    sendText: (kind, target, message) => send(kind, target, message),
    sendIdleText: (target, claim, message) => send('group', target, message, true, claim) };
}

/**
 * 建立无试验倒计时的范围受控文字服务；必须先由用户在本机配置私聊/群聊范围。
 * @param {object} options createBackend/createServer 只供合成测试替换；正式默认复用已验证模块。
 * @returns {object} configure/run/stop/snapshot/connection；connection 只供宿主内存交接，不可写报告。
 * @note run 保持到 AbortSignal/停止/QQ掉线；不自动登录、重登、发送或重放；stop 幂等。
 */
export function createGatewaySession({ createBackend = createNativeTextBridge, createServer = createOneBotServer } = {}) {
  let scope = null, backend = null, server = null, policy = null, credentials = null;
  let state = 'idle', closing = false, setupTask = null, stopTask = null, settle = null, detach = () => {};
  let setupStage = 'not_started', setupFailureCode = null;
  let configurationRevision = 0, configurationFailed = false, mediaConfiguration = null;
  const configure = (value) => {
    if (state !== 'idle') return false;
    try { scope = normalizeGatewayConfiguration(value, scope?.targets); configurationRevision++; return true; }
    catch { return false; }
  };
  /** 热改就绪网关；保留同一发送策略对象和原生账号会话。@param {object} value 新配置。@returns {boolean} 是否应用；失败关闭提交。 */
  const reconfigure = value => {
    if (state === 'idle') return configure(value);
    if (state !== 'ready' || closing) return false;
    let next;
    try { next = normalizeGatewayConfiguration(value, scope?.targets); } catch { return false; }
    configurationRevision++;
    try { backend.reconfigure(next, mediaConfiguration, configurationRevision); scope = next; configurationFailed = false; return true; }
    catch { configurationFailed = true; return false; }
  };
  const snapshot = () => ({ state, setupStage, setupFailureCode, configurationRevision, configurationFailed,
    configured: scope !== null, sendEnabled: !configurationFailed && (scope?.allowSend ?? false),
    receiveImages: scope?.receiveImages ?? false, sendImages: scope?.sendImages ?? false,
    receiveVoice: scope?.receiveVoice ?? false, sendVoice: scope?.sendVoice ?? false,
    readSelfAvatar: scope?.readSelfAvatar ?? false,
    generateImages: scope?.generateImages ?? false,
    useStickers: scope?.useStickers ?? false, collectStickers: scope?.collectStickers ?? false,
    scopeSummary: scope ? nativeScopeSummary(scope.targets) : null,
    idleMessages: scope?.idleMessages ?? normalizeIdleSettings(),
    groupAdmin: scope?.groupAdmin ?? normalizeGroupAdminPermissions(),
    friendRequests: scope?.friendRequests ?? normalizeFriendRequestPermissions(),
    qzone: scope?.qzone ?? normalizeQzoneSettings(),
    selfProfile: scope?.selfProfile ?? normalizeSelfProfilePermissions(),
    onebotUrl: state === 'ready' ? server?.url ?? null : null,
    native: backend?.snapshot() ?? null, policy: policy?.policySnapshot() ?? null });
  async function run({ session, self, signal, media = null }) {
    if (state !== 'idle' || !scope || scope.targets.private.ids.includes(String(self.uin)) || signal?.aborted) throw refused('GATEWAY_START_REFUSED');
    state = 'preparing';
    mediaConfiguration = media;
    const lifetime = new Promise((resolve) => { settle = resolve; });
    const abort = () => { void stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    detach = () => signal?.removeEventListener('abort', abort);
    setupTask = (async () => {
      setupStage = 'backend_create';
      backend = createBackend({ session, self, sessionInitialized: true, scope: scope.targets,
        configurationRevision,
        idleSettings: scope.idleMessages,
        groupAdmin: scope.groupAdmin, friendRequests: scope.friendRequests,
        qzoneSettings: scope.qzone,
        selfProfile: scope.selfProfile, profileAvatarRoot: media?.profileAvatarRoot, profileAvatarBackupRoot: media?.profileAvatarBackupRoot,
        allowReceive: true, allowSend: scope.allowSend, allowReadSelfAvatar: scope.readSelfAvatar,
        allowGenerateImages: scope.generateImages, allowUseStickers: scope.useStickers, allowCollectStickers: scope.collectStickers, stickerRoot: media?.root,
        maxSends: 100000, sendTimeoutMs: 10000,
        imageOptions: scope.receiveImages || scope.sendImages ? { root: media?.root, nativeRoots: media?.nativeRoots,
          receiveEnabled: scope.receiveImages, sendEnabled: scope.sendImages } : null,
        voiceOptions: scope.receiveVoice || scope.sendVoice ? { root: media?.root, nativeRoots: media?.nativeRoots,
          receiveEnabled: scope.receiveVoice, sendEnabled: scope.sendVoice } : null });
      backend.on('status', (status) => { if (!closing && !status.online) { state = 'offline'; queueMicrotask(() => { void stop(); }); } });
      setupStage = 'backend_start'; const started = backend.start();
      if (started.state !== 'active') throw refused('GATEWAY_LISTENER_FAILED');
      if (closing) return;
      setupStage = 'send_policy'; policy = withSendPolicy(backend);
      const accessToken = randomBytes(32).toString('hex');
      setupStage = 'onebot_server'; server = await createServer({ backend: policy, accessToken });
      if (closing) return;
      credentials = { url: server.url, accessToken }; state = 'ready'; setupStage = 'ready';
    })();
    try { await setupTask; } catch (error) { setupFailureCode = gatewayFailureCode(error); state = 'failed'; await stop(); }
    await lifetime;
    return { sessionInitialized: true, completed: false };
  }
  function stop() {
    if (stopTask) return stopTask;
    closing = true; credentials = null; detach();
    stopTask = (async () => {
      try { await setupTask; } catch { /* 固定失败状态，不记录原生异常。 */ }
      try { await server?.close(); } finally {
        try { backend?.stop(); await backend?.closeMedia?.(); }
        catch { state = 'failed'; throw refused('GATEWAY_CLEANUP_FAILED'); } finally {
          if (!['offline', 'failed'].includes(state)) state = 'stopped';
          settle?.();
        }
      }
    })();
    stopTask.catch(() => {});
    return stopTask;
  }
  return { configure, reconfigure, run, stop, snapshot, connection: () => credentials && !configurationFailed ? { ...credentials } : null,
    consumerConnection: () => credentials && !configurationFailed ? { ...credentials, configurationRevision, scope: structuredClone(scope.targets), idleMessages: { ...scope.idleMessages },
      groupAdmin: { ...scope.groupAdmin }, friendRequests: { ...scope.friendRequests }, qzone: { ...scope.qzone }, selfProfile: { ...scope.selfProfile }, allowSend: scope.allowSend,
      permissions: { receiveImages: scope.receiveImages, sendImages: scope.sendImages,
        receiveVoice: scope.receiveVoice, sendVoice: scope.sendVoice, readSelfAvatar: scope.readSelfAvatar,
        generateImages: scope.generateImages, useStickers: scope.useStickers, collectStickers: scope.collectStickers } } : null };
}
