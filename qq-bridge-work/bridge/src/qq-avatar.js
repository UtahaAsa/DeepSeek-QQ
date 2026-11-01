// Generated from qq-avatar.ts. Edit the TypeScript source and run build:typed.
import { safeFetchBuffer } from './safe-fetch.js';
import { sniffImage } from './media-normalize.js';
import { QQ_AVATAR_MAX_BYTES, QQ_AVATAR_CACHE_MAX_BYTES } from './qq-avatar-limits.js';
const fail = () => new Error('QQ_AVATAR_UNAVAILABLE');
const id = (value) => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const cleanName = (value) => typeof value === 'string'
    ? Array.from(value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')).slice(0, 128).join('') : '';
export const AVATAR_MAX_BYTES = QQ_AVATAR_MAX_BYTES;
/**
 * 生成按需头像读取器；构造不联网，不读取账号文件或全群成员。
 * @param {object} options bot为所属已鉴权OneBot；enabled来自收图选择，selfEnabled来自独立自身头像选择。
 *   fetchBuffer/now仅用于隔离验证；生产只访问固定QQ头像地址，不跟随重定向。
 * @returns {object} read(key,userId)/readSelf(key)返回对应最小资料及MCP图片；close同步撤销缓存。
 * @note 单线程；最多32张/8MiB、10分钟、两路请求；成员每次重新核验，不自动重试。
 */
export function createQQAvatarReader({ bot, enabled = false, selfEnabled = false, fetchBuffer = safeFetchBuffer, now = Date.now }) {
    const cache = new Map(), pending = new Map(), starts = [];
    let closed = false;
    let configurationRevision = 0, selfRevision = 0, residentBytes = 0;
    const discard = (name, item) => { residentBytes -= item.bytes.length; item.bytes.fill(0); cache.delete(name); };
    const checkActive = (selfAvatar) => { if (closed || !(selfAvatar ? selfEnabled === true : enabled === true) || !bot?.isConnected)
        throw fail(); };
    function close() { closed = true; for (const [name, item] of cache)
        discard(name, item); }
    async function readSubject(key, userId, selfAvatar) {
        const revision = configurationRevision, selfEpoch = selfRevision;
        const active = (selfAvatar) => { checkActive(selfAvatar); if (revision !== configurationRevision || selfAvatar && selfEpoch !== selfRevision)
            throw fail(); };
        try {
            active(selfAvatar);
            const match = /^(private|group):([1-9]\d{0,19})$/.exec((key ?? ''));
            if (!match || (!selfAvatar && !id(userId)))
                throw fail();
            const action = selfAvatar ? 'get_self_avatar_subject' : 'get_observed_member';
            const params = { kind: match[1], peer_id: match[2], ...(!selfAvatar ? { user_id: userId } : {}) };
            const member = await bot.raw(action, params, { timeoutMs: 2500 });
            active(selfAvatar);
            if (selfAvatar) {
                if (member?.is_self !== true)
                    throw fail();
                userId = String(member.user_id);
            }
            if (!id(userId) || String(member?.user_id) !== userId)
                throw fail();
            const cacheKey = (selfAvatar ? 'self:' : 'member:') + key + ':' + userId + ':' + revision + (selfAvatar ? ':' + selfEpoch : '');
            for (const [name, item] of cache)
                if (now() - item.createdAt >= 600000)
                    discard(name, item);
            let item = cache.get(cacheKey);
            if (!item) {
                let task = pending.get(cacheKey);
                if (!task) {
                    while (starts.length && now() - starts[0] >= 3000)
                        starts.shift();
                    if (pending.size >= 2 || starts.length >= 2)
                        throw fail();
                    starts.push(now());
                    task = (async () => {
                        const url = 'https://q1.qlogo.cn/g?b=qq&nk=' + userId + '&s=640' + (selfAvatar && selfEpoch ? '&t=' + now() : '');
                        const result = await fetchBuffer(url, AVATAR_MAX_BYTES, { maxRedirects: 0,
                            acceptUrl: (candidate) => candidate.href === url });
                        active(selfAvatar);
                        const bytes = result?.buffer, info = Buffer.isBuffer(bytes) && sniffImage(bytes);
                        if (!info || bytes.length > AVATAR_MAX_BYTES || !['png', 'jpeg', 'webp'].includes(info.format) ||
                            info.width > 2048 || info.height > 2048 || info.animated)
                            throw fail();
                        const item = { bytes: Buffer.from(bytes), mimeType: 'image/' + info.format, createdAt: now() };
                        while (cache.size >= 32 || residentBytes + item.bytes.length > QQ_AVATAR_CACHE_MAX_BYTES) {
                            const first = cache.keys().next().value;
                            discard(first, cache.get(first));
                        }
                        cache.set(cacheKey, item);
                        residentBytes += item.bytes.length;
                        return item;
                    })();
                    pending.set(cacheKey, task);
                    task.then(() => pending.delete(cacheKey), () => pending.delete(cacheKey));
                }
                item = await task;
            }
            active(selfAvatar);
            const current = await bot.raw(action, params, { timeoutMs: 2500 });
            active(selfAvatar);
            if ((selfAvatar && current?.is_self !== true) || String(current?.user_id) !== userId || cache.get(cacheKey) !== item || now() - item.createdAt >= 600000)
                throw fail();
            return { user_id: userId, nickname: cleanName(current.nickname), card: cleanName(current.card),
                ...(selfAvatar ? { is_self: true } : {}),
                source: 'qq_avatar_service', cacheMaxAgeSeconds: 600,
                image: { mimeType: item.mimeType, data: item.bytes.toString('base64') } };
        }
        catch {
            throw fail();
        }
    }
    return Object.freeze({ read: (key, userId) => readSubject(key, userId, false), readSelf: (key) => readSubject(key, null, true), close,
        /** 自身头像变更受理后撤销旧自身缓存与在途读取；不重置权限或限速，不影响成员缓存。@returns {void} 关闭后不再产生新状态。 */
        invalidateSelf() {
            if (closed)
                return;
            selfRevision++;
            for (const [name, item] of cache)
                if (name.startsWith('self:'))
                    discard(name, item);
        },
        /** 热改头像读取许可，撤销旧任务和缓存，保留限速记录。@param {object} value enabled/selfEnabled布尔。@returns {void} 关闭后拒绝。 */
        configure(value) {
            if (closed || typeof value?.enabled !== 'boolean' || typeof value?.selfEnabled !== 'boolean')
                throw fail();
            configurationRevision++;
            enabled = value.enabled;
            selfEnabled = value.selfEnabled;
            for (const [name, item] of cache)
                discard(name, item);
        } });
}
