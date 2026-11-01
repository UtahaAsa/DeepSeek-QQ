// Generated from native-feature-routes.ts. Edit the TypeScript source and run build:typed.
import { projectImageGenerationError } from './image-generation-errors.js';
const failure = (code) => Object.assign(new Error(code), { code });
const validKey = (key) => /^(?:private|group):[1-9]\d{0,19}$/.test((key ?? ''));
const qualified = new Map([
    ['/api/images/generate', ['images', 'generate']], ['/api/native-group/action', ['groups', 'act']],
    ['/api/native-qzone/post', ['qzone', 'post']], ['/api/native-self-profile/update', ['profile', 'update']],
]);
const getPaths = new Set(['/api/native/features', '/api/images/message', '/api/socialV2/forward-message', '/api/native/group-members', '/api/native/friend-status', '/api/native/self-avatar-backups', '/api/native/self-profile', '/api/native/stickers/image']);
const postPaths = new Set(['/api/native/send', '/api/socialV2/forward-media', '/api/native/self-avatar-preview',
    ...['catalog', 'prepare', 'status', 'send'].map(action => '/api/native/singing/' + action),
    ...['status', 'accept', 'start', 'end'].map(action => '/api/native/phone/' + action),
    '/api/native/stickers/list', '/api/native/stickers/collect', '/api/native/stickers/send', '/api/native/stickers/note', ...qualified.keys()]);
/** 判断是否属于固定原生功能入口，供外层鉴权和实际分派共用。@param {string} method HTTP方法。@param {string} pathname 精确路径。@returns {boolean} 只表示可进入下层独立会话资格检查，不授予权限。 */
export function isNativeFeatureRoute(method, pathname) {
    return method === 'GET' && getPaths.has(pathname) || method === 'POST' && postPaths.has(pathname);
}
/**
 * 原生功能共用路由：模式只参与会话身份，不决定功能是否开放。
 * @param {object} options access核验调用轮次；capabilities返回当前勾选权限；run使各功能异步资格复核同一轮次。
 *   hints/send/media/forward只接受已授权目标；所有实际写入仍由既有原生实现检查许可与回执。
 * @returns {Function} async({req,url,readBody,sendJson})返回是否处理；不自行登录、请求模型或重试。
 * @note 不处理控制台配置接口；不返回异常正文、账号库或控制台凭据。
 *   生图失败只返回允许列表固定码和本地限流的安全字段，其它功能响应语义不变。
 */
export function createNativeFeatureRoutes(options) {
    const { access, capabilities, run, hints, send, media, forward, forwardMedia, members, friends, avatar, selfProfileRead } = options;
    return async ({ req, res, url, readBody, sendJson }) => {
        if (!isNativeFeatureRoute(req.method, url.pathname))
            return false;
        const controller = new AbortController();
        const disconnected = () => { if (!res?.writableEnded)
            controller.abort(); };
        res?.once?.('close', disconnected);
        try {
            if (req.headers['x-agent-call'] !== '1')
                throw failure('NATIVE_FEATURE_NOT_AUTHORIZED');
            const input = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await readBody();
            const key = input.key;
            if (!validKey(key))
                throw failure('NATIVE_FEATURE_INPUT_INVALID');
            const captured = access.capture(key, req.headers['x-native-feature-token'] ?? req.headers['x-agent-token'], { qualified: qualified.has(url.pathname) });
            const guard = () => { if (controller.signal.aborted)
                throw failure('NATIVE_FEATURE_NOT_AUTHORIZED'); captured(); };
            guard();
            const result = await run(key, guard, async () => {
                if (url.pathname.startsWith('/api/native/phone/')) {
                    if (!key.startsWith('private:') || !options.phone)
                        throw failure('PHONE_NOT_ALLOWED');
                    const action = url.pathname.split('/').at(-1), names = { status: ['key'], start: ['key'], accept: ['key', 'callId'], end: ['key', 'callId', 'reason'] }[action];
                    if (!names || Object.keys(input).some(name => !names.includes(name)))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await options.phone(action, input, guard);
                }
                if (url.pathname.startsWith('/api/native/singing/')) {
                    if (capabilities().sendVoice !== true || !options.singing)
                        throw failure('SINGING_DISABLED');
                    const action = url.pathname.slice('/api/native/singing/'.length);
                    const names = action === 'catalog' ? ['key'] : action === 'prepare' ? ['key', 'songId', 'pitch'] : ['key', 'job'];
                    if (Object.keys(input).some(name => !names.includes(name)))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await options.singing(action, input, guard);
                }
                if (url.pathname === '/api/native/features') {
                    if (Object.keys(input).some(name => name !== 'key'))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return { capabilities: capabilities(), instructions: hints(key) };
                }
                if (url.pathname.startsWith('/api/native/stickers/')) {
                    const operation = url.pathname.slice('/api/native/stickers/'.length);
                    if (!options.stickers || !['list', 'image', 'collect', 'send', 'note'].includes(operation))
                        throw failure('NATIVE_FEATURE_UNAVAILABLE');
                    const names = { list: ['key', 'query', 'count'], image: ['key', 'stickerId'], collect: ['key', 'file'],
                        send: ['key', 'stickerId'], note: ['key', 'stickerId', 'note', 'tags', 'usage'] }[operation];
                    if (Object.keys(input).some(name => !names.includes(name)))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    const opts = { guard, signal: controller.signal };
                    if (operation === 'list')
                        return await options.stickers.list(key, { query: input.query ?? '', count: input.count ?? 48 }, opts);
                    if (operation === 'note')
                        return await options.stickers.note(key, input.stickerId, Object.fromEntries(['note', 'tags', 'usage'].filter(name => Object.hasOwn(input, name)).map(name => [name, input[name]])), opts);
                    return await options.stickers[operation](key, (operation === 'collect' ? input.file : input.stickerId), opts);
                }
                if (url.pathname === '/api/native/self-profile') {
                    if (!['nickname', 'signature', 'birthday'].includes(input.field) || Object.keys(input).some(name => !['key', 'field'].includes(name)))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    if (capabilities().profile?.[input.field] !== true || !selfProfileRead)
                        throw failure('NATIVE_PROFILE_READ_DISABLED');
                    return await selfProfileRead(key, input.field, guard);
                }
                if (url.pathname === '/api/native/group-members') {
                    if (!key.startsWith('group:') || Object.keys(input).some(name => !['key', 'limit'].includes(name)))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    const limit = input.limit === undefined ? 50 : Number(input.limit);
                    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !members)
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await members(key, limit, guard);
                }
                if (url.pathname === '/api/native/friend-status') {
                    if (!capabilities().friends?.receiveRequests)
                        throw failure('NATIVE_FRIEND_READ_DISABLED');
                    if (Object.keys(input).some(name => !['key', 'userId'].includes(name)) || !/^[1-9]\d{0,19}$/.test((input.userId ?? '')) || !friends)
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await friends(key, input.userId, guard);
                }
                if (['/api/native/self-avatar-backups', '/api/native/self-avatar-preview'].includes(url.pathname)) {
                    if (capabilities().profile?.avatar !== true || !avatar)
                        throw failure('NATIVE_AVATAR_WRITE_DISABLED');
                    const preview = url.pathname.endsWith('-preview');
                    if (Object.keys(input).some(name => !(preview ? ['key', 'file', 'crop'] : ['key']).includes(name))
                        || preview && !/^qqimg_[a-f0-9]{32}$/.test((input.file ?? '')))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await avatar(key, preview ? { operation: 'preview', file: input.file, crop: input.crop ?? {} } : { operation: 'backups' }, guard);
                }
                if (url.pathname === '/api/native/send') {
                    if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'text') || typeof input.text !== 'string'
                        || !input.text.trim() || input.text.length > 12000)
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await send(key, input.text, guard);
                }
                if (url.pathname === '/api/images/message') {
                    if (capabilities().receiveImage !== true)
                        throw failure('NATIVE_IMAGE_READ_DISABLED');
                    if (typeof input.messageId !== 'string' || !/^-?[1-9]\d{0,29}$/.test(input.messageId)
                        || Object.keys(input).some(name => !['key', 'messageId'].includes(name)))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await media(key, input.messageId, guard);
                }
                if (url.pathname === '/api/socialV2/forward-message') {
                    if (typeof input.id !== 'string' || !input.id || input.id.length > 256
                        || Object.keys(input).some(name => !['key', 'id'].includes(name)))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await forward(key, input.id, guard);
                }
                if (url.pathname === '/api/socialV2/forward-media') {
                    if (capabilities().receiveImage !== true)
                        throw failure('NATIVE_IMAGE_READ_DISABLED');
                    if (!Array.isArray(input.media) || input.media.length > 32 || Object.keys(input).some(name => !['key', 'media'].includes(name)))
                        throw failure('NATIVE_FEATURE_INPUT_INVALID');
                    return await forwardMedia(key, input.media, guard);
                }
                const [api, method] = qualified.get(url.pathname);
                if (!options[api]?.[method])
                    throw failure('NATIVE_FEATURE_UNAVAILABLE');
                return await options[api][method](input, { signal: controller.signal });
            });
            guard();
            sendJson({ ok: true, ...result });
        }
        catch (error) {
            if (url.pathname === '/api/images/generate') {
                const projected = projectImageGenerationError(error?.code || error?.message, error);
                sendJson({ ok: false, ...projected }, projected.error === 'IMAGE_GENERATION_NOT_AUTHORIZED' ? 403 : 409);
                return true;
            }
            const code = error.code || error.message;
            sendJson({ ok: false, error: typeof code === 'string' && /^[A-Z_]{3,80}$/.test(code) ? code : 'NATIVE_FEATURE_UNCONFIRMED' }, /NOT_AUTHORIZED|DISABLED|UNAVAILABLE/.test((code ?? '')) ? 403 : 409);
        }
        finally {
            res?.off?.('close', disconnected);
        }
        return true;
    };
}
