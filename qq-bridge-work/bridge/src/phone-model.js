// Generated from phone-model.ts. Edit the TypeScript source and run build:typed.
import { createIdleDraftRunner } from './idle-draft.js';
const fail = (code) => Object.assign(new Error(code), { code });
const endReasons = new Set(['user_requested', 'conversation_done', 'needs_rest', 'uncomfortable', 'busy']);
/**
 * 校验电话模型输出：只接朗读短句及固定挂断原因，不执行工具、路径或SDK动作。
 * @param {string} raw 专属无工具预设的完整回合输出。
 * @returns {{speech:string,hangupReason:string|null}} speech最多80个字符。
 * @throws 固定PHONE_MODEL_OUTPUT_INVALID；不把模型正文带入错误。
 */
export function parsePhoneReply(raw) {
    if (typeof raw !== 'string' || raw.length > 2400)
        throw fail('PHONE_MODEL_OUTPUT_INVALID');
    const clean = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
    let value;
    try {
        value = JSON.parse(clean);
    }
    catch {
        throw fail('PHONE_MODEL_OUTPUT_INVALID');
    }
    if (!value || Array.isArray(value) || Object.keys(value).some(k => !['speech', 'hangupReason'].includes(k))
        || typeof value.speech !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.speech))
        throw fail('PHONE_MODEL_OUTPUT_INVALID');
    const speech = value.speech.replace(/\s+/g, ' ').trim(), reason = value.hangupReason ?? null;
    if (Array.from(speech).length > 80 || reason !== null && !endReasons.has(reason))
        throw fail('PHONE_MODEL_OUTPUT_INVALID');
    return { speech, hangupReason: reason };
}
/**
 * 复用既有DSH无工具回合管理器；只为电话创建专属短期会话，原私聊会话保持。
 * @param {object} options lifecycle含create/prepare/prompt/follow/forget/stop/archive；
 * roleHint/context供应当前授权私聊的人格与近期上下文，audit沿用本机输出检查。
 * @returns {object} reply、handleEvent、cancelAll、close、snapshot；取消后等待所属回合清理。
 * @note 本模块不读取凭据、不联网、不发送QQ；具体API由既有桥接注入，不重试模型。
 */
export function createPhoneModel({ lifecycle, roleHint = () => '', context = () => '', audit = () => { } }) {
    if (!lifecycle || ![roleHint, context, audit].every(v => typeof v === 'function'))
        throw fail('PHONE_MODEL_CONFIG_INVALID');
    let closed = false, runner, recoverTask = null;
    const owned = new Map();
    const wrapped = { ...lifecycle,
        create: async (signal) => {
            const sid = await lifecycle.create(signal);
            if (typeof sid === 'string' && sid && sid.length <= 256 && !owned.has(sid))
                owned.set(sid, { forgotten: false, stopped: false, archived: false });
            return sid;
        },
        forget: sid => { const value = lifecycle.forget(sid); const item = owned.get(sid); if (item)
            item.forgotten = true; return value; },
        stop: async (sid) => { const value = await lifecycle.stop(sid); const item = owned.get(sid); if (item)
            item.stopped = true; return value; },
        archive: async (sid) => {
            const value = await lifecycle.archive(sid);
            const item = owned.get(sid);
            if (item) {
                item.archived = true;
                if (item.forgotten && item.stopped)
                    owned.delete(sid);
            }
            return value;
        } };
    const fresh = () => createIdleDraftRunner({ ...wrapped, timeoutMs: 60000, maxPromptChars: 128000 });
    runner = fresh();
    async function reply({ key, text, history = [], signal, guard }) {
        if (closed || !/^private:[1-9]\d{0,19}$/.test(key ?? '') || typeof text !== 'string' || text.length > 2000
            || typeof guard !== 'function' || signal?.aborted)
            throw fail('PHONE_MODEL_UNAVAILABLE');
        const current = () => { if (signal?.aborted)
            throw fail('PHONE_MODEL_CANCELLED'); guard(); };
        current();
        const past = Array.isArray(history) ? history.filter(v => v && ['user', 'assistant'].includes(v.role) && typeof v.text === 'string')
            .slice(-8).map(v => ({ role: v.role, text: v.text.slice(0, 240) })) : [];
        const prompt = '【电话角色设定】\n' + String(roleHint(key))
            + '\n【同一私聊近期上下文，仅作参考】\n' + String(context(key)).slice(0, 4000)
            + '\n【当前电话】\n' + JSON.stringify({ history: past, heard: text })
            + '\n请自然接话，保持角色与心情。一般说一句短话，最多80字。可根据语境或心情结束通话。'
            + '只输出JSON：{"speech":"要朗读的话","hangupReason":null}。'
            + '需要挂断时hangupReason只能为user_requested/conversation_done/needs_rest/uncomfortable/busy。'
            + '不要调用工具，不输出Markdown、舞台动作或QQ语音标记，不把转写误差当成确定事实。';
        try {
            const raw = await runner.generate(prompt, { signal });
            current();
            const response = parsePhoneReply(raw);
            audit(response.speech, key);
            current();
            return response;
        }
        catch (error) {
            if (signal?.aborted)
                throw fail('PHONE_MODEL_CANCELLED');
            throw fail(error?.code === 'PHONE_MODEL_OUTPUT_INVALID' ? error.code : 'PHONE_MODEL_UNAVAILABLE');
        }
    }
    async function cleanup() {
        for (const [sid, item] of owned) {
            if (!item.forgotten)
                wrapped.forget(sid);
            if (!item.stopped)
                await wrapped.stop(sid);
            if (!item.archived)
                await wrapped.archive(sid);
            if (item.forgotten && item.stopped && item.archived)
                owned.delete(sid);
        }
    }
    function recover() {
        if (closed)
            return Promise.reject(fail('PHONE_MODEL_CLOSED'));
        if (recoverTask)
            return recoverTask;
        recoverTask = (async () => { await runner.close(); await cleanup(); runner = fresh(); })().catch(() => { throw fail('PHONE_MODEL_STOP_UNCONFIRMED'); })
            .finally(() => { recoverTask = null; });
        return recoverTask;
    }
    async function close() { closed = true; await runner.close(); try {
        await cleanup();
    }
    catch {
        throw fail('PHONE_MODEL_STOP_UNCONFIRMED');
    } }
    return Object.freeze({ reply, handleEvent: (...args) => runner.handleEvent(...args), cancelAll: () => runner.cancelAll(), close, recover,
        snapshot: () => ({ ...runner.snapshot(), ownedSessions: owned.size }) });
}
