// Generated from image-generation.ts. Edit the TypeScript source and run build:typed.
import { createImageProvider, normalizeImageProviderConfig, IMAGE_PROVIDER_ERROR_CODES } from './image-provider.js';
import { isPublicFlux } from './image-provider-presets.js';
import { projectImageGenerationError } from './image-generation-errors.js';
const fail = (code) => Object.assign(new Error(code), { code });
const keyPattern = /^(private|group):([1-9]\d{0,19})$/;
const handlePattern = /^qqimg_[a-f0-9]{32}$/;
const dayKey = (time) => Math.floor((time + 8 * 3600000) / 86400000);
const safeCodes = new Set([...IMAGE_PROVIDER_ERROR_CODES, 'IMAGE_GENERATION_CLOSED', 'IMAGE_GENERATION_CLOCK_INVALID',
    'IMAGE_GENERATION_CANCELLED', 'IMAGE_GENERATION_NOT_AUTHORIZED', 'IMAGE_GENERATION_RESULT_INVALID', 'IMAGE_GENERATION_UPLOAD_FAILED',
    'IMAGE_GENERATION_RATE_LIMITED', 'IMAGE_GENERATION_FAILED']);
/**
 * 管理独立图片API配置与单路生成，不接管普通QQ发送队列。
 * @param {object} options authorize(key)异步返回当前授权代次字符串，拒绝时抛错；必须含本次生成许可。
 *   upload(bytes,{kind,id},{signal})只上传到已授权会话的原生图片仓库，不发送消息；initialSettings不恢复凭据。
 *   provider/now仅供隔离替身；生产使用受控Images API或固定公共FLUX传输。
 * @returns {object} configure/clear/snapshot/generate/cancel/close；API密钥只存当前闭包，不写磁盘或返回；公共FLUX无需密钥。
 * @note 单事件循环；全局仅一路实际生成，每会话至少60秒、北京日最多20次已尝试请求。
 *   限额为进程内计数，重启清零。本地限流错误附submitted=false、rateLimit及retryAfterSeconds。
 *   取消后等原任务结算才释放槽位；未知结果不自动重试。
 */
export function createImageGenerationManager({ authorize, upload, provider = createImageProvider(), now = Date.now, initialSettings = null } = {}) {
    if (typeof authorize !== 'function' || typeof upload !== 'function' || typeof provider !== 'function')
        throw fail('IMAGE_GENERATION_CONFIG_INVALID');
    let settings = initialSettings === null ? null : normalizeImageProviderConfig(initialSettings), apiKey = '', revision = 1, active = null, closed = false, budgetDay = null, used = 0, latestTime = 0;
    const starts = new Map(), counts = { attempted: 0, prepared: 0, failed: 0, cancelled: 0 };
    let lastResult = null;
    const open = () => { if (closed)
        throw fail('IMAGE_GENERATION_CLOSED'); };
    const checkRevision = (expected) => {
        open();
        if (!Number.isSafeInteger(expected) || expected !== revision)
            throw fail('IMAGE_GENERATION_REVISION_CONFLICT');
    };
    function cancel() { active?.controller.abort(); }
    function snapshot() {
        return { revision, configured: !!settings && (isPublicFlux(settings) || !!apiKey), hasApiKey: !!apiKey, settings: settings ? { ...settings } : null,
            closed, busy: !!active, counts: { ...counts }, lastResult,
            limits: { concurrent: 1, cooldownSeconds: 60, dailyAttempts: 20, timezone: 'Asia/Shanghai', persistAcrossRestart: false,
                attemptedToday: budgetDay === dayKey(now()) ? used : 0 },
            credentialsPersisted: false, realQqDeliveryIncluded: false };
    }
    function configure(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['expectedRevision', 'settings', 'apiKey'].includes(key)))
            throw fail('IMAGE_GENERATION_CONFIG_INVALID');
        checkRevision(value.expectedRevision);
        const candidate = normalizeImageProviderConfig(value.settings);
        let secret = apiKey;
        if (isPublicFlux(candidate)) {
            if (Object.hasOwn(value, 'apiKey'))
                throw fail('IMAGE_GENERATION_CONFIG_INVALID');
            secret = '';
        }
        else if (Object.hasOwn(value, 'apiKey')) {
            if (typeof value.apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value.apiKey))
                throw fail('IMAGE_GENERATION_CONFIG_INVALID');
            secret = value.apiKey;
        }
        else if (candidate.endpoint !== settings?.endpoint || !secret)
            throw fail('IMAGE_GENERATION_CREDENTIAL_REQUIRED');
        cancel();
        settings = candidate;
        apiKey = secret;
        revision++;
        lastResult = null;
        return snapshot();
    }
    function clear(expectedRevision) {
        checkRevision(expectedRevision);
        cancel();
        apiKey = '';
        settings = null;
        revision++;
        lastResult = null;
        return snapshot();
    }
    function reserve(key) {
        const time = now(), day = dayKey(time);
        if (!Number.isSafeInteger(time) || time < latestTime)
            throw fail('IMAGE_GENERATION_CLOCK_INVALID');
        latestTime = time;
        if (budgetDay !== null && day < budgetDay)
            throw fail('IMAGE_GENERATION_CLOCK_INVALID');
        if (day !== budgetDay) {
            budgetDay = day;
            used = 0;
        }
        if (used >= 20)
            throw Object.assign(fail('IMAGE_GENERATION_RATE_LIMITED'), { submitted: false, rateLimit: 'daily',
                retryAfterSeconds: Math.ceil(((day + 1) * 86400000 - 8 * 3600000 - time) / 1000) });
        if (starts.has(key) && time - starts.get(key) < 60000)
            throw Object.assign(fail('IMAGE_GENERATION_RATE_LIMITED'), { submitted: false, rateLimit: 'cooldown', retryAfterSeconds: Math.ceil((60000 - time + starts.get(key)) / 1000) });
        for (const [name, start] of starts)
            if (time - start >= 60000)
                starts.delete(name);
        used++;
        starts.set(key, time);
        counts.attempted++;
    }
    async function generate(key, prompt, { signal } = {}) {
        open();
        const match = keyPattern.exec(typeof key === 'string' ? key : '');
        if (!match || typeof prompt !== 'string' || !prompt.trim() || Array.from(prompt).length > 2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(prompt))
            throw fail('IMAGE_GENERATION_INPUT_INVALID');
        if (!settings || !isPublicFlux(settings) && !apiKey)
            throw fail('IMAGE_GENERATION_NOT_CONFIGURED');
        if (active)
            throw fail('IMAGE_GENERATION_BUSY');
        if (signal?.aborted)
            throw fail('IMAGE_GENERATION_CANCELLED');
        const job = { revision, settings, secret: apiKey, controller: new AbortController(), authorization: null };
        active = job;
        const abort = () => job.controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const current = () => {
            if (closed || revision !== job.revision || job.controller.signal.aborted)
                throw fail('IMAGE_GENERATION_CANCELLED');
        };
        const check = async () => {
            current();
            const result = await authorize(key);
            current();
            if (typeof result !== 'string' || !result || result.length > 512 || job.authorization !== null && result !== job.authorization)
                throw fail('IMAGE_GENERATION_NOT_AUTHORIZED');
            job.authorization = result;
        };
        let generated, providerInvoked = false;
        try {
            await check();
            reserve(key);
            providerInvoked = true;
            generated = await provider(job.settings, job.secret, prompt, { signal: job.controller.signal });
            await check();
            if (!Buffer.isBuffer(generated?.bytes) || !generated.bytes.length || generated.bytes.length > 8 * 1024 * 1024 ||
                !['image/png', 'image/jpeg', 'image/webp'].includes(generated.info?.mimeType))
                throw fail('IMAGE_GENERATION_RESULT_INVALID');
            const result = await upload(generated.bytes, { kind: match[1], id: match[2] }, { signal: job.controller.signal });
            await check();
            if (!handlePattern.test((result?.file ?? '')) || result.size !== generated.bytes.length)
                throw fail('IMAGE_GENERATION_UPLOAD_FAILED');
            counts.prepared++;
            lastResult = 'prepared_not_sent';
            return { file: result.file, size: result.size, mimeType: generated.info?.mimeType,
                generated: true, sent: false, maxAgeSeconds: 600 };
        }
        catch (error) {
            const cancelled = closed || revision !== job.revision || job.controller.signal.aborted;
            if (cancelled)
                counts.cancelled++;
            else
                counts.failed++;
            const code = cancelled ? 'IMAGE_GENERATION_CANCELLED' : safeCodes.has(error?.code)
                ? error.code : 'IMAGE_GENERATION_FAILED';
            if (!closed && revision === job.revision)
                lastResult = code;
            const { error: safeCode, ...details } = projectImageGenerationError(code, providerInvoked ? {} : error);
            throw Object.assign(fail(safeCode), details);
        }
        finally {
            if (Buffer.isBuffer(generated?.bytes))
                generated.bytes.fill(0);
            job.secret = '';
            signal?.removeEventListener('abort', abort);
            if (active === job)
                active = null;
        }
    }
    function close() { if (closed)
        return; closed = true; cancel(); apiKey = ''; settings = null; revision++; }
    return Object.freeze({ configure, clear, snapshot, generate, cancel, close });
}
