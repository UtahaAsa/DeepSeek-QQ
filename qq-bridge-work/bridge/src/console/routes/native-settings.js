// Generated from console/routes/native-settings.ts. Edit the TypeScript source and run build:typed.
/**
 * native-settings功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：nativeSinging, singingError, nativeBinding, currentMode, avatarReader, nativeCapabilities, agentTokenOk, nativeFeatureAccess, prepareSelfAvatarSend, bot, nativeImageApi, imagePreferences, log, nativePhone, phonePageState, path, ROOT, readConfigObject, atomicWriteJson, cfg, nativeFeatureGrants, phoneRecoveryTask, phoneRecoveryPhase, phoneRecoveryId, crypto, nativePhoneModel, nativeVoice, captureSendGuard。
 */
export function createNativeSettingsRoutes(deps) {
    return {
        matchSingingPrefix: {
            matches: (req, url) => url.pathname.startsWith('/api/singing/'),
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!deps.nativeSinging || req.headers['x-agent-call'] !== undefined || req.headers['x-agent-token'] !== undefined) {
                    sendJson({ ok: false, error: 'SINGING_NOT_READY' }, 403);
                    return;
                }
                try {
                    const action = url.pathname.slice('/api/singing/'.length);
                    if (action === 'state' && req.method === 'GET' && !url.search) {
                        sendJson({ ok: true, songs: deps.nativeSinging.catalog(), worker: deps.nativeSinging.snapshot() });
                        return;
                    }
                    if (req.method !== 'POST')
                        throw Error();
                    const body = await readBody();
                    if (!body || Object.keys(body).some(name => !(action === 'prepare' ? ['songId', 'pitch'] : action === 'audio' ? ['job', 'offset'] : ['job']).includes(name)))
                        throw Error();
                    const value = action === 'prepare' ? deps.nativeSinging.start('operator', body, () => { })
                        : action === 'status' ? deps.nativeSinging.status('operator', body.job)
                            : action === 'audio' ? deps.nativeSinging.audio('operator', body.job, body.offset) : null;
                    if (!value)
                        throw Error();
                    sendJson({ ok: true, ...value });
                }
                catch (error) {
                    sendJson({ ok: false, error: (0, deps.singingError)(error) }, 409);
                }
                return;
            }
        },
        postImagesAvatar: {
            matches: (req, url) => req.method === 'POST' && ['/api/images/avatar', '/api/images/self-avatar'].includes(url.pathname),
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const selfAvatar = url.pathname === '/api/images/self-avatar';
                if (!deps.nativeBinding || !['chat', 'reserved', 'reserved2', 'closed-agent'].includes(deps.currentMode) || !deps.avatarReader || !(selfAvatar ? deps.nativeCapabilities.readSelfAvatar : deps.nativeCapabilities.readAvatar)) {
                    sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 403);
                    return;
                }
                const body = await readBody();
                if (Object.keys(body).some((name) => !(selfAvatar ? ['key', 'forSend'] : ['key', 'userId']).includes(name)) ||
                    selfAvatar && Object.hasOwn(body, 'forSend') && typeof body.forSend !== 'boolean' ||
                    (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(body.key, req.headers['x-agent-token']))) {
                    sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 403);
                    return;
                }
                let assertAvatarAllowed;
                try {
                    assertAvatarAllowed = deps.nativeFeatureAccess.capture(body.key, req.headers['x-native-feature-token'] ?? req.headers['x-agent-token']);
                }
                catch {
                    sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 403);
                    return;
                }
                const permitted = () => { try {
                    assertAvatarAllowed();
                    return (selfAvatar ? deps.nativeCapabilities.readSelfAvatar : deps.nativeCapabilities.readAvatar) === true;
                }
                catch {
                    return false;
                } };
                if (!permitted()) {
                    sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 403);
                    return;
                }
                try {
                    const value = await (selfAvatar ? deps.avatarReader.readSelf(body.key) : deps.avatarReader.read(body.key, body.userId));
                    if (!permitted())
                        throw new Error('QQ_AVATAR_UNAVAILABLE');
                    let delivery = {};
                    if (selfAvatar && body.forSend === true) {
                        const controller = new AbortController();
                        const disconnected = () => { if (!res.writableEnded)
                            controller.abort(); };
                        res.once('close', disconnected);
                        try {
                            delivery = await (0, deps.prepareSelfAvatarSend)({
                                key: body.key, avatar: value,
                                enabled: () => deps.nativeCapabilities.sendImage === true && deps.nativeCapabilities.sendText === true,
                                guard: assertAvatarAllowed, upload: (...args) => deps.bot.uploadNativeImage(...args), signal: controller.signal
                            });
                        }
                        finally {
                            res.off('close', disconnected);
                        }
                    }
                    if (!permitted())
                        throw new Error('QQ_AVATAR_UNAVAILABLE');
                    sendJson({ ok: true, ...value, ...delivery });
                }
                catch {
                    sendJson({ ok: false, error: 'QQ_AVATAR_UNAVAILABLE' }, 503);
                }
                return;
            }
        },
        matchImageGenerationPrefix: {
            matches: (req, url) => url.pathname.startsWith('/api/image-generation/'),
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!deps.nativeImageApi || req.headers['x-agent-call'] !== undefined || req.headers['x-agent-token'] !== undefined) {
                    sendJson({ ok: false, error: 'IMAGE_MANAGEMENT_UNAVAILABLE' }, 403);
                    return;
                }
                const operation = url.pathname.slice('/api/image-generation/'.length);
                if (req.method === 'GET' && operation === 'configuration') {
                    sendJson(deps.nativeImageApi.operator('state'));
                    return;
                }
                if (req.method !== 'POST' || !['apply', 'clear', 'cancel'].includes(operation)) {
                    sendJson({ ok: false, error: 'IMAGE_GENERATION_ROUTE_NOT_FOUND' }, 404);
                    return;
                }
                const result = deps.nativeImageApi.operator(operation, await readBody());
                if (result.ok && ['apply', 'clear'].includes(operation)) {
                    try {
                        deps.imagePreferences.save(result.generation.settings);
                    }
                    catch {
                        (0, deps.log)('生图非敏感参数未保存到磁盘，当前内存配置仍有效。');
                    }
                }
                sendJson(result, result.ok ? 200 : 400);
                return;
            }
        },
        matchPhonePrefix: {
            matches: (req, url) => url.pathname.startsWith('/api/phone/'),
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!deps.nativePhone || req.headers['x-agent-token'] !== undefined || req.headers['x-agent-call'] !== undefined) {
                    sendJson({ ok: false, error: 'PHONE_MANAGEMENT_UNAVAILABLE' }, 403);
                    return;
                }
                try {
                    if (req.method === 'GET' && url.pathname === '/api/phone/status') {
                        sendJson((0, deps.phonePageState)());
                        return;
                    }
                    if (req.method === 'POST' && url.pathname === '/api/phone/configuration') {
                        const body = await readBody();
                        if (!body || Array.isArray(body) || Object.keys(body).length !== 2
                            || Object.keys(body).some(k => !['enabled', 'autoAnswer'].includes(k)) || typeof body.enabled !== 'boolean' || typeof body.autoAnswer !== 'boolean')
                            throw Error();
                        await deps.nativePhone.reconcile();
                        const configFile = deps.path.join(deps.ROOT, 'config.json'), file = (0, deps.readConfigObject)(configFile);
                        file.phone = { enabled: body.enabled, autoAnswer: body.autoAnswer };
                        (0, deps.atomicWriteJson)(configFile, file);
                        deps.cfg.phone = file.phone;
                        for (const grant of deps.nativeFeatureGrants.values())
                            grant.hints?.clear();
                        sendJson({ ok: true, settings: deps.cfg.phone });
                        return;
                    }
                    if (req.method === 'POST' && url.pathname === '/api/phone/recover') {
                        if (!deps.phoneRecoveryTask) {
                            deps.phoneRecoveryPhase = 'stopping_call';
                            deps.phoneRecoveryId = deps.crypto.randomUUID();
                            deps.phoneRecoveryTask = (async () => {
                                await deps.nativePhone.reconcile();
                                deps.phoneRecoveryPhase = 'resetting_model';
                                await deps.nativePhoneModel.recover();
                                if (deps.nativeVoice?.snapshot().failed) {
                                    deps.phoneRecoveryPhase = 'warming_voice';
                                    await deps.nativeVoice.setPermissions({ receiveEnabled: false, sendEnabled: false });
                                    await deps.nativeVoice.setPermissions({ receiveEnabled: deps.nativeCapabilities.receiveVoice, sendEnabled: deps.nativeCapabilities.sendVoice });
                                }
                                await deps.nativePhone.tick();
                                deps.phoneRecoveryPhase = 'ready';
                            })().catch(() => { deps.phoneRecoveryPhase = 'failed'; }).finally(() => { deps.phoneRecoveryTask = null; });
                        }
                        sendJson({ ok: true, accepted: true, recovery: { busy: !!deps.phoneRecoveryTask, phase: deps.phoneRecoveryPhase, id: deps.phoneRecoveryId } }, 202);
                        return;
                    }
                    if (req.method === 'POST' && url.pathname === '/api/phone/action') {
                        const body = await readBody();
                        if (!body || Array.isArray(body) || Object.keys(body).some(k => !['action', 'key', 'callId', 'reason'].includes(k))
                            || !['start', 'accept', 'end'].includes(body.action) || !/^private:[1-9]\d{0,19}$/.test((body.key ?? '')))
                            throw Error();
                        const guard = (0, deps.captureSendGuard)(body.key), result = await deps.nativePhone.control(body.action, body, guard);
                        guard();
                        sendJson({ ok: true, ...result });
                        return;
                    }
                    sendJson({ ok: false, error: 'PHONE_ROUTE_NOT_FOUND' }, 404);
                }
                catch {
                    sendJson({ ok: false, error: 'PHONE_MANAGEMENT_UNCONFIRMED' }, 409);
                }
                return;
            }
        },
        matchVoicePrefix: {
            matches: (req, url) => url.pathname.startsWith('/api/voice/'),
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!deps.nativeVoice || req.headers['x-agent-token'] !== undefined || req.headers['x-agent-call'] !== undefined) {
                    sendJson({ ok: false, error: 'VOICE_MANAGEMENT_UNAVAILABLE' }, 403);
                    return;
                }
                try {
                    if (req.method === 'GET' && url.pathname === '/api/voice/configuration') {
                        sendJson(deps.nativeVoice.configuration());
                        return;
                    }
                    if (req.method === 'POST' && ['/api/voice/validate', '/api/voice/apply', '/api/voice/restore'].includes(url.pathname)) {
                        const body = await readBody(), operation = url.pathname.split('/').at(-1);
                        const keys = operation === 'validate' ? ['config'] : operation === 'apply' ? ['config', 'revision'] : ['revision'];
                        if (!body || Array.isArray(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))) {
                            sendJson({ ok: false, error: 'VOICE_INPUT_INVALID' }, 400);
                            return;
                        }
                        const result = operation === 'validate' ? deps.nativeVoice.validate(body.config) : operation === 'apply'
                            ? deps.nativeVoice.beginApply(body.config, body.revision) : deps.nativeVoice.beginRestore(body.revision);
                        sendJson(result, result.accepted ? 202 : 200);
                        return;
                    }
                    sendJson({ ok: false, error: 'VOICE_ROUTE_NOT_FOUND' }, 404);
                }
                catch (error) {
                    const allowed = ['EXISTING_VOICE_RESOURCES_INVALID', 'VOICE_CONFIG_CONFLICT', 'VOICE_CONFIG_UNCHANGED', 'VOICE_CONFIG_BUSY', 'VOICE_BACKUP_UNAVAILABLE'];
                    sendJson({ ok: false, error: allowed.includes(error.message) ? error.message : 'VOICE_MANAGEMENT_UNAVAILABLE' }, 400);
                }
                return;
            }
        }
    };
}
