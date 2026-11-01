import { createHash } from 'node:crypto';
import { normalizeWorkspaceSettings, workspaceGatewayConfig } from '../bridge/plugins/qq-mode-console/lib/workspace-policy.js';

const fail = code => Object.assign(new Error(code), { code });
const shape = (input, keys) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw fail('WORKSPACE_REQUEST_REFUSED');
};

/**
 * QQ工作台的组合管理器；只调用所属gateway/bridge的受限服务，设置由DSH持久化。
 * @param {object} options combined返回组合状态；gateway为所属子进程IPC；其他client沿用已有进程身份核验。
 * @returns {object} request/reapply；保存只缓存非敏感偏好，登录入口始终由本人点击准备。
 * @note 不读QQ账号数据库、不生成模型prompt、不导出内部控制凭据；电话动作只在本人显式操作时代理。
 */
export function createWorkspaceManager({ combined, gateway, prepareLogin, roles, library, voice, images, singing,phone,data }) {
  let desired = null, application = { status: 'not_saved', revision: null, configurationRevision: null, error: null };
  let applyTask = null;
  let appliedGatewayPid = null;
  const project = native => {
    const state = combined();
    const effective = { ...application };
    if (effective.status === 'applied') {
      if (native?.gateway?.state !== 'ready') effective.status = 'pending_connection';
      else if (state.bridge.nativePermissionsError === true) { effective.status = 'failed'; effective.error = 'WORKSPACE_MODEL_SYNC_FAILED'; }
      else if (state.bridge.status !== 'ready' || state.bridge.nativePermissionsCurrent !== true
          || state.bridge.nativePolicyRevision !== effective.configurationRevision) effective.status = 'applying_bridge';
    }
    const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    return { fixture: state.fixture === true, checkedAt:new Date().toISOString(),uptimeSeconds:Number.isFinite(Date.parse(state.startedAt))?Math.max(0,Math.floor((Date.now()-Date.parse(state.startedAt))/1000)):null,
      traffic:{privateReceived:count(native?.gateway?.native?.privateReceived),groupReceived:count(native?.gateway?.native?.groupReceived),sentConfirmed:count(native?.gateway?.native?.sendsConfirmed),sendsUnknown:count(native?.gateway?.native?.sendsUnknown)},
      login:native?.login?{phase:native.login.phase,started:native.login.started,hasQr:native.login.hasQr}:null,
      dsh: { status: state.dsh.status }, bridge: { status: state.bridge.status,
      repliesBlocked: state.bridge.nativePermissionsCurrent === false, policyRecoveryFailed: state.bridge.nativePermissionsError === true },
      healthCheck: state.healthCheck && /^[A-Z_]{4,64}$/.test(state.healthCheck.code ?? '')
        ? { code: state.healthCheck.code, checkedAt: state.healthCheck.checkedAt, component: state.healthCheck.component } : null,
      gateway: { status: state.gateway.status, configured: native?.gateway?.configured === true,
        configurationRevision: native?.gateway?.configurationRevision ?? null, configurationFailed: native?.gateway?.configurationFailed === true }, application: effective,
      suspended: { send: native?.gateway?.policy?.circuitOpen === true,
        groups: native?.gateway?.native?.groupAdmin?.uncertain === true, friends: native?.gateway?.native?.friendRequests?.uncertain === true,
        profile: native?.gateway?.native?.selfProfile?.uncertain === true, qzone: native?.gateway?.native?.qzone?.uncertain === true },
      diagnostics: native?.diagnostics ?? state.gateway.terminal?.diagnostics ?? state.gateway.terminal ?? null,
      voice: state.bridge.voice ? { phase: state.bridge.voice.phase, warmupMs: state.bridge.voice.warmupMs } : null };
  };
  async function reapply() {
    if (!desired) return false;
    if (application.status === 'applied' && appliedGatewayPid === combined().gateway.pid) return true;
    if (applyTask) return applyTask;
    applyTask = (async () => {
      application = { ...application, status: 'applying', error: null };
      try {
        const native = await gateway('configure', { ...workspaceGatewayConfig(desired.settings), reuseLogin: desired.settings.reuseLogin });
        application = { status: 'applied', revision: desired.revision,
          configurationRevision: native.gateway.configurationRevision, error: null };
        appliedGatewayPid = combined().gateway.pid;
        return true;
      } catch {
        application = { ...application, status: combined().gateway.status === 'ready' ? 'failed' : 'pending', error: 'WORKSPACE_APPLY_FAILED' }; return false;
      }
    })().finally(() => { applyTask = null; });
    return applyTask;
  }
  async function state() {
    let native = null; try { native = await gateway('state'); } catch {}
    return project(native);
  }
  async function request(operation, payload = {}) {
    if(operation.startsWith('data-')){
      if(!data)throw fail('WORKSPACE_REQUEST_REFUSED');
      return data(operation.slice(5),payload);
    }
    if (operation === 'state') { shape(payload, []); return state(); }
    if(['login-state','login-connect','login-refresh','login-stop'].includes(operation)){
      shape(payload,[]);
      if(operation==='login-connect'){
        if(!desired)throw fail('WORKSPACE_SETTINGS_INVALID');
        await prepareLogin();await reapply();
      }
      const native=await gateway(operation),login=native?.login??{};
      const qr=typeof login.qrData==='string'&&login.qrData.length<=270000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(login.qrData)?login.qrData:null;
      return {phase:login.phase,started:login.started===true,hasQr:login.hasQr===true,qrVersion:login.qrVersion,qrRequests:login.qrRequests,ready:native?.gateway?.state==='ready',...(operation==='login-state'?{qrData:qr}:{})};
    }
    if (operation === 'apply') {
      shape(payload, ['revision', 'settings']);
      if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) throw fail('WORKSPACE_SETTINGS_INVALID');
      const settings = normalizeWorkspaceSettings(payload.settings);
      const digest = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
      if (desired && payload.revision < desired.revision) throw fail('WORKSPACE_SETTINGS_CONFLICT');
      if (desired?.revision === payload.revision && desired.digest !== digest) throw fail('WORKSPACE_SETTINGS_CONFLICT');
      if (desired?.digest === digest && application.status === 'applied' && appliedGatewayPid === combined().gateway.pid) {
        desired.revision = payload.revision; application.revision = payload.revision; return state();
      }
      desired = { revision: payload.revision, digest, settings };
      application = { ...application, status: 'pending', revision: payload.revision }; await reapply(); return state();
    }
    if (operation === 'login-start') {
      shape(payload, []);
      if (!desired) throw fail('WORKSPACE_SETTINGS_INVALID');
      const url = await prepareLogin();
      if (desired) await reapply();
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url ?? '')) throw fail('WORKSPACE_UNAVAILABLE');
      return { url };
    }
    if (operation === 'roles-library') { shape(payload, []); return library('list'); }
    if (operation === 'roles-import') { shape(payload, ['name']); return library('content', payload); }
    if (operation.startsWith('roles-')) {
      const action = operation.slice(6);
      if (!['list', 'content', 'create', 'update', 'select', 'delete', 'restore'].includes(action)) throw fail('WORKSPACE_REQUEST_REFUSED');
      shape(payload, action === 'list' ? [] : ['create', 'update'].includes(action) ? ['name', 'content']
        : action === 'delete' ? ['name', 'clearCurrent'] : action === 'restore' ? ['restoreId'] : ['name']);
      if (!['list', 'restore'].includes(action) && (typeof payload.name !== 'string' || !payload.name || payload.name.length > 40)) throw fail('WORKSPACE_REQUEST_REFUSED');
      if (action === 'delete' && typeof payload.clearCurrent !== 'boolean') throw fail('WORKSPACE_REQUEST_REFUSED');
      if (action === 'restore' && (typeof payload.restoreId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(payload.restoreId))) throw fail('WORKSPACE_REQUEST_REFUSED');
      if (['create', 'update'].includes(action) && (typeof payload.content !== 'string' || Buffer.byteLength(payload.content) > 65536)) throw fail('WORKSPACE_REQUEST_REFUSED');
      return roles(action, action === 'select' ? { role: payload.name } : payload);
    }
    if (operation.startsWith('voice-')) {
      const action = operation.slice(6);
      if (!['state', 'validate', 'apply', 'restore'].includes(action)) throw fail('WORKSPACE_REQUEST_REFUSED');
      shape(payload, action === 'state' ? [] : action === 'validate' ? ['config'] : action === 'apply' ? ['config', 'revision'] : ['revision']);
      return voice(action, payload);
    }
    if (operation.startsWith('images-')) {
      const action = operation.slice(7);
      if (!['state', 'apply', 'clear', 'cancel'].includes(action)) throw fail('WORKSPACE_REQUEST_REFUSED');
      shape(payload, action === 'state' ? [] : action === 'apply' ? ['expectedRevision', 'settings', 'apiKey'] : ['expectedRevision']);
      return images(action, payload);
    }
    if(operation.startsWith('phone-')){
      const action=operation.slice(6);if(!phone||!['state','configure','recover','action'].includes(action))throw fail('WORKSPACE_REQUEST_REFUSED');
      shape(payload,action==='state'||action==='recover'?[]:action==='configure'?['enabled','autoAnswer']:['action','key','callId','reason']);
      if(action==='configure'&&(typeof payload.enabled!=='boolean'||typeof payload.autoAnswer!=='boolean'))throw fail('WORKSPACE_REQUEST_REFUSED');
      if(action==='action'&&(!['start','accept','end'].includes(payload.action)||!/^private:[1-9]\d{0,19}$/.test(payload.key??'')
        ||payload.action!=='start'&&!/^qqcall_[a-f0-9]{32}$/.test(payload.callId??'')
        ||payload.action==='end'&&!['user_requested','conversation_done','needs_rest','uncomfortable','busy'].includes(payload.reason)))throw fail('WORKSPACE_REQUEST_REFUSED');
      return phone(action,payload);
    }
    if (operation.startsWith('singing-')) {
      const action = operation.slice(8);
      if (!singing || !['state', 'prepare', 'status', 'audio'].includes(action)) throw fail('WORKSPACE_REQUEST_REFUSED');
      shape(payload, action === 'state' ? [] : action === 'prepare' ? ['songId', 'pitch'] : action === 'audio' ? ['job', 'offset'] : ['job']);
      return singing(action, payload);
    }
    throw fail('WORKSPACE_REQUEST_REFUSED');
  }
  return { request, reapply };
}
