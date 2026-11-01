import type {ServerResponse} from 'node:http';
import type {ConsoleJsonBody, ConsoleRequestHead} from '../request-context.js';
import type {NamedConsoleRoute, NamedConsoleRoutes, NamedRouteContext} from './contracts.js';
/** 仅描述本路由写回的电话配置；其它配置仍由宿主持有。 */
export interface NativeSettingsConfiguration {phone?: {enabled?: unknown; autoAnswer?: unknown};}
/** 权限仍须在每个异步阶段复核，类型本身不授予原生能力。 */
export interface NativeSettingsCapabilities {
  readAvatar: boolean; readSelfAvatar: boolean; sendImage: boolean; sendText: boolean;
  receiveVoice: boolean; sendVoice: boolean;
}
/** 读取器完成原有头像校验后的最小结果；自身标识由读取路径决定。 */
export interface NativeSettingsAvatar {
  user_id: string; nickname: string; card: string; is_self?: boolean;
  source: string; cacheMaxAgeSeconds: number; image: {mimeType: string; data: string};
}
/** 上传只登记图片，原始回执必须继续经过prepareSelfAvatarSend校验。 */
export type NativeAvatarUpload = (bytes: Buffer, target: {kind: string; id: string}, options: {
  signal?: AbortSignal; timeoutMs: number;
}) => Promise<unknown>;
/** 图片可发送编号不代表已送达。 */
export type NativeAvatarDelivery = {sendable: false; instruction: string} | {sendable: true; file: unknown; instruction: string};
/** 头像上传依赖响应关闭事件，用于取消本次请求的上传。 */
export type NativeAvatarRouteContext = NamedRouteContext & {res: Pick<ServerResponse,'writableEnded'|'once'|'off'>};
/** 仅头像路由要求连接事件，其余管理路由沿用普通宿主上下文。 */
export type NativeSettingsRoutes = NamedConsoleRoutes<'matchSingingPrefix'|'matchImageGenerationPrefix'|'matchPhonePrefix'|'matchVoicePrefix'> & {
  postImagesAvatar: NamedConsoleRoute<NativeAvatarRouteContext>;
};
/** 生图配置管理同步受理，不触发生成；失败分支没有配置快照。 */
export type NativeImageOperatorResult = {ok: true; generation: {settings: unknown}} | {ok: false; error: string};
/** accepted只表示切换受理，不能作为工人已就绪或已退出的证据。 */
export interface NativeVoiceSettingsResult {ok: boolean; accepted?: boolean; operationId?: string;}
/** 电话恢复状态由宿主持有，任务完成和失败均沿用原有阶段。 */
export type PhoneRecoveryPhase = 'idle'|'stopping_call'|'resetting_model'|'warming_voice'|'ready'|'failed';
interface LegacyNativeSettingsError {message: string;}
interface LegacyPhoneSettingsFile extends Record<string,unknown> {phone?: NativeSettingsConfiguration['phone'];}
/**
 * 原生设置的实时依赖切片；构造无IO，不替代请求字段及下游管理器的运行时校验。
 * @remarks 仅电话恢复的三个绑定可写；管理器可能尚未创建，已有宿主初始化假设保持不变。
 */
export interface NativeSettingsDependencies<Configuration extends NativeSettingsConfiguration> {
  readonly cfg: Configuration; readonly currentMode: string; readonly nativeBinding: object | null;
  readonly nativeCapabilities: NativeSettingsCapabilities | null;
  readonly nativeSinging: {
    catalog: () => readonly {id: unknown; title: string; defaultPitch: number}[]; snapshot: () => unknown;
    start: (owner: string, input: ConsoleJsonBody, guard: () => undefined) => {job: unknown};
    status: (owner: string, job: unknown) => {job: unknown};
    audio: (owner: string, job: unknown, offset: unknown) => {job: unknown};
  } | null;
  readonly singingError: (error: unknown) => string;
  readonly avatarReader: {readSelf: (key: unknown) => Promise<NativeSettingsAvatar>;
    read: (key: unknown, userId: unknown) => Promise<NativeSettingsAvatar>} | null;
  readonly agentTokenOk: (key: unknown, token: NonNullable<ConsoleRequestHead['headers'][string]>) => boolean;
  readonly nativeFeatureAccess: {capture: (key: unknown, token: ConsoleRequestHead['headers'][string]) => () => undefined};
  readonly prepareSelfAvatarSend: (input: {key: unknown; avatar: NativeSettingsAvatar; enabled: () => boolean;
    guard: () => undefined; upload: NativeAvatarUpload; signal: AbortSignal}) => Promise<NativeAvatarDelivery>;
  readonly bot: {uploadNativeImage: NativeAvatarUpload};
  readonly nativeImageApi: {operator: (operation: string, input?: ConsoleJsonBody) => NativeImageOperatorResult} | null;
  readonly imagePreferences: {save: (settings: unknown) => void}; readonly log: (...values: unknown[]) => void;
  readonly nativePhone: {reconcile: () => Promise<unknown>; tick: () => Promise<unknown>;
    control: (action: 'start'|'accept'|'end', input: ConsoleJsonBody, guard: () => undefined) => Promise<unknown>} | null;
  readonly phonePageState: () => unknown; readonly path: {join: (...parts: string[]) => string}; readonly ROOT: string;
  readonly readConfigObject: (file: string) => Record<string,unknown>;
  readonly atomicWriteJson: (file: string, value: Record<string,unknown>) => void;
  readonly nativeFeatureGrants: Pick<Map<string,{hints?: {clear: () => void}}>, 'values'>;
  phoneRecoveryTask: Promise<void> | null; phoneRecoveryPhase: PhoneRecoveryPhase; phoneRecoveryId: string | null;
  readonly crypto: {randomUUID: () => string}; readonly nativePhoneModel: {recover: () => Promise<unknown>} | null;
  readonly nativeVoice: {configuration: () => {ok: boolean; revision: string | null; busy: boolean; canRestore: boolean}; validate: (config: unknown) => NativeVoiceSettingsResult;
    beginApply: (config: unknown, revision: unknown) => NativeVoiceSettingsResult;
    beginRestore: (revision: unknown) => NativeVoiceSettingsResult; snapshot: () => {failed?: boolean};
    setPermissions: (permissions: {receiveEnabled: boolean; sendEnabled: boolean}) => Promise<unknown>} | null;
  readonly captureSendGuard: (key: string) => () => undefined;
}

/**
 * native-settings功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：nativeSinging, singingError, nativeBinding, currentMode, avatarReader, nativeCapabilities, agentTokenOk, nativeFeatureAccess, prepareSelfAvatarSend, bot, nativeImageApi, imagePreferences, log, nativePhone, phonePageState, path, ROOT, readConfigObject, atomicWriteJson, cfg, nativeFeatureGrants, phoneRecoveryTask, phoneRecoveryPhase, phoneRecoveryId, crypto, nativePhoneModel, nativeVoice, captureSendGuard。
 */
export function createNativeSettingsRoutes<Configuration extends NativeSettingsConfiguration>(deps: NativeSettingsDependencies<Configuration>): NativeSettingsRoutes {
  return {
    matchSingingPrefix: {
      matches: (req, url) => url.pathname.startsWith('/api/singing/'),
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        if (!deps.nativeSinging || req.headers['x-agent-call'] !== undefined || req.headers['x-agent-token'] !== undefined) {
          sendJson({ ok: false, error: 'SINGING_NOT_READY' }, 403); return;
        }
        try {
          const action = url.pathname.slice('/api/singing/'.length);
          if (action === 'state' && req.method === 'GET' && !url.search) {
            sendJson({ ok: true, songs: deps.nativeSinging.catalog(), worker: deps.nativeSinging.snapshot() }); return;
          }
          if (req.method !== 'POST') throw Error();
          const body = await readBody();
          if (!body || Object.keys(body).some(name => !(action === 'prepare' ? ['songId', 'pitch'] : action === 'audio' ? ['job', 'offset'] : ['job']).includes(name))) throw Error();
          const value = action === 'prepare' ? deps.nativeSinging.start('operator', body, () => { })
            : action === 'status' ? deps.nativeSinging.status('operator', body.job)
              : action === 'audio' ? deps.nativeSinging.audio('operator', body.job, body.offset) : null;
          if (!value) throw Error(); sendJson({ ok: true, ...value });
        } catch (error) { sendJson({ ok: false, error: (0, deps.singingError)(error) }, 409); }
        return;

      }
    },
    postImagesAvatar: {
      matches: (req, url) => req.method === 'POST' && ['/api/images/avatar', '/api/images/self-avatar'].includes(url.pathname),
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const selfAvatar = url.pathname === '/api/images/self-avatar';
        if (!deps.nativeBinding || !['chat', 'reserved', 'reserved2', 'closed-agent'].includes(deps.currentMode) || !deps.avatarReader || !(selfAvatar ? deps.nativeCapabilities!.readSelfAvatar : deps.nativeCapabilities!.readAvatar)) {
          sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 403); return;
        }
        const body = await readBody();
        if (Object.keys(body).some((name) => !(selfAvatar ? ['key', 'forSend'] : ['key', 'userId']).includes(name)) ||
          selfAvatar && Object.hasOwn(body, 'forSend') && typeof body.forSend !== 'boolean' ||
          (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(body.key, req.headers['x-agent-token']))) {
          sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 403); return;
        }
        let assertAvatarAllowed;
        try { assertAvatarAllowed = deps.nativeFeatureAccess.capture(body.key, req.headers['x-native-feature-token'] ?? req.headers['x-agent-token']); }
        catch { sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 403); return; }
        const permitted = () => { try { assertAvatarAllowed(); return (selfAvatar ? deps.nativeCapabilities!.readSelfAvatar : deps.nativeCapabilities!.readAvatar) === true; } catch { return false; } };
        if (!permitted()) { sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 403); return; }
        try {
          const value = await (selfAvatar ? deps.avatarReader.readSelf(body.key) : deps.avatarReader.read(body.key, body.userId));
          if (!permitted()) throw new Error('QQ_AVATAR_UNAVAILABLE');
          let delivery = {};
          if (selfAvatar && body.forSend === true) {
            const controller = new AbortController();
            const disconnected = () => { if (!res.writableEnded) controller.abort(); };
            res.once('close', disconnected);
            try {
              delivery = await (0, deps.prepareSelfAvatarSend)({
                key: body.key, avatar: value,
                enabled: () => deps.nativeCapabilities!.sendImage === true && deps.nativeCapabilities!.sendText === true,
                guard: assertAvatarAllowed, upload: (...args) => deps.bot.uploadNativeImage(...args), signal: controller.signal
              });
            }
            finally { res.off('close', disconnected); }
          }
          if (!permitted()) throw new Error('QQ_AVATAR_UNAVAILABLE');
          sendJson({ ok: true, ...value, ...delivery });
        }
        catch { sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 503); }
        return;

      }
    },
    matchImageGenerationPrefix: {
      matches: (req, url) => url.pathname.startsWith('/api/image-generation/'),
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        if (!deps.nativeImageApi || req.headers['x-agent-call'] !== undefined || req.headers['x-agent-token'] !== undefined) {
          sendJson({ ok: false, error: 'IMAGE_MANAGEMENT_UNAVAILABLE' }, 403); return;
        }
        const operation = url.pathname.slice('/api/image-generation/'.length);
        if (req.method === 'GET' && operation === 'configuration') { sendJson(deps.nativeImageApi.operator('state')); return; }
        if (req.method !== 'POST' || !['apply', 'clear', 'cancel'].includes(operation)) {
          sendJson({ ok: false, error: 'IMAGE_GENERATION_ROUTE_NOT_FOUND' }, 404); return;
        }
        const result = deps.nativeImageApi.operator(operation, await readBody());
        if (result.ok && ['apply', 'clear'].includes(operation)) {
          try { deps.imagePreferences.save(result.generation.settings); } catch { (0, deps.log)('生图非敏感参数未保存到磁盘，当前内存配置仍有效。'); }
        }
        sendJson(result, result.ok ? 200 : 400); return;

      }
    },
    matchPhonePrefix: {
      matches: (req, url) => url.pathname.startsWith('/api/phone/'),
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        if (!deps.nativePhone || req.headers['x-agent-token'] !== undefined || req.headers['x-agent-call'] !== undefined) { sendJson({ ok: false, error: 'PHONE_MANAGEMENT_UNAVAILABLE' }, 403); return; }
        try {
          if (req.method === 'GET' && url.pathname === '/api/phone/status') { sendJson((0, deps.phonePageState)()); return; }
          if (req.method === 'POST' && url.pathname === '/api/phone/configuration') {
            const body = await readBody(); if (!body || Array.isArray(body) || Object.keys(body).length !== 2
              || Object.keys(body).some(k => !['enabled', 'autoAnswer'].includes(k)) || typeof body.enabled !== 'boolean' || typeof body.autoAnswer !== 'boolean') throw Error();
            await deps.nativePhone!.reconcile(); const configFile = deps.path.join(deps.ROOT, 'config.json'), file = (0, deps.readConfigObject)(configFile) as LegacyPhoneSettingsFile;
            file.phone = { enabled: body.enabled, autoAnswer: body.autoAnswer }; (0, deps.atomicWriteJson)(configFile, file); deps.cfg.phone = file.phone;
            for (const grant of deps.nativeFeatureGrants.values()) grant.hints?.clear(); sendJson({ ok: true, settings: deps.cfg.phone }); return;
          }
          if (req.method === 'POST' && url.pathname === '/api/phone/recover') {
            if (!deps.phoneRecoveryTask) {              
deps.phoneRecoveryPhase = 'stopping_call'; deps.phoneRecoveryId = deps.crypto.randomUUID();
              deps.phoneRecoveryTask = (async () => {                
await deps.nativePhone!.reconcile(); deps.phoneRecoveryPhase = 'resetting_model'; await deps.nativePhoneModel!.recover();
                if (deps.nativeVoice?.snapshot().failed) {                  
deps.phoneRecoveryPhase = 'warming_voice';
                  await deps.nativeVoice.setPermissions({ receiveEnabled: false, sendEnabled: false });
                  await deps.nativeVoice.setPermissions({ receiveEnabled: deps.nativeCapabilities!.receiveVoice, sendEnabled: deps.nativeCapabilities!.sendVoice });                
}
                await deps.nativePhone!.tick(); deps.phoneRecoveryPhase = 'ready';
              })().catch(() => { deps.phoneRecoveryPhase = 'failed'; }).finally(() => { deps.phoneRecoveryTask = null; });
            }
            sendJson({ ok: true, accepted: true, recovery: { busy: !!deps.phoneRecoveryTask, phase: deps.phoneRecoveryPhase, id: deps.phoneRecoveryId } }, 202); return;
          }
          if (req.method === 'POST' && url.pathname === '/api/phone/action') {
            const body = await readBody(); if (!body || Array.isArray(body) || Object.keys(body).some(k => !['action', 'key', 'callId', 'reason'].includes(k))
              || !['start', 'accept', 'end'].includes(body.action as string) || !/^private:[1-9]\d{0,19}$/.test((body.key ?? '') as string)) throw Error();
            const guard = (0, deps.captureSendGuard)(body.key as string), result = await deps.nativePhone!.control(body.action as 'start'|'accept'|'end', body, guard); guard(); sendJson({ ok: true, ...result as object }); return;
          }
          sendJson({ ok: false, error: 'PHONE_ROUTE_NOT_FOUND' }, 404);
        } catch { sendJson({ ok: false, error: 'PHONE_MANAGEMENT_UNCONFIRMED' }, 409); } return;

      }
    },
    matchVoicePrefix: {
      matches: (req, url) => url.pathname.startsWith('/api/voice/'),
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        if (!deps.nativeVoice || req.headers['x-agent-token'] !== undefined || req.headers['x-agent-call'] !== undefined) {
          sendJson({ ok: false, error: 'VOICE_MANAGEMENT_UNAVAILABLE' }, 403); return;
        }
        try {
          if (req.method === 'GET' && url.pathname === '/api/voice/configuration') {
            sendJson(deps.nativeVoice.configuration()); return;
          }
          if (req.method === 'POST' && ['/api/voice/validate', '/api/voice/apply', '/api/voice/restore'].includes(url.pathname)) {
            const body = await readBody(), operation = url.pathname.split('/').at(-1);
            const keys = operation === 'validate' ? ['config'] : operation === 'apply' ? ['config', 'revision'] : ['revision'];
            if (!body || Array.isArray(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))) {
              sendJson({ ok: false, error: 'VOICE_INPUT_INVALID' }, 400); return;
            }
            const result = operation === 'validate' ? deps.nativeVoice.validate(body.config) : operation === 'apply'
              ? deps.nativeVoice.beginApply(body.config, body.revision) : deps.nativeVoice.beginRestore(body.revision);
            sendJson(result, result.accepted ? 202 : 200); return;
          }
          sendJson({ ok: false, error: 'VOICE_ROUTE_NOT_FOUND' }, 404);
        } catch (error) {
          const allowed = ['EXISTING_VOICE_RESOURCES_INVALID', 'VOICE_CONFIG_CONFLICT', 'VOICE_CONFIG_UNCHANGED', 'VOICE_CONFIG_BUSY', 'VOICE_BACKUP_UNAVAILABLE'];
          sendJson({ ok: false, error: allowed.includes((error as LegacyNativeSettingsError).message) ? (error as LegacyNativeSettingsError).message : 'VOICE_MANAGEMENT_UNAVAILABLE' }, 400);
        }
        return;

      }
    }
  };
}
