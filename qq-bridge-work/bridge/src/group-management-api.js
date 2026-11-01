// Generated from group-management-api.ts. Edit the TypeScript source and run build:typed.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SENSITIVE_RE } from './sensitive.js';
const fail = (code) => Object.assign(new Error(code), { code });
const actions = ['atAll', 'mute', 'kick'];
const validToken = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (left, right) => validToken(left) && validToken(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
/**
 * 将群管理工具限制到当前普通聊天的一次性资格，构造无I/O。
 * @param {object} options context(key)返回当前会话/模式/角色代次或null；permission返回独立许可。
 *   verify在提交前核验原生会话范围；perform的第四参数为本轮内部操作号，不能由模型指定；safeText检查既有令牌及内容审计。
 *   rememberToken将资格加入既有出站脱敏集合；now仅供隔离时钟。
 * @returns {object} hint/act/cancel/close；每群至多一个十分钟资格，最多128群，一次调用即消耗，不重试。
 * @note 资格在转交前再次检查；已转交的原生操作不能靠清除模型资格撤销，账号停止由原生生命周期负责。
 */
export function createGroupManagementApi({ context, permission, verify, perform, safeText, rememberToken = () => { }, now = Date.now }) {
    if (![context, permission, verify, perform, safeText, rememberToken, now].every(value => typeof value === 'function'))
        throw fail('GROUP_MANAGEMENT_OPTIONS_INVALID');
    const grants = new Map(), versions = new Map();
    let closed = false;
    function current(key, action, token) {
        const grant = grants.get(key), time = now(), stamp = context(key);
        if (closed || !/^group:[1-9]\d{0,19}$/.test(key ?? '') || !actions.includes(action) || permission()?.[action] !== true
            || !grant || !stamp || stamp !== grant.context || time < grant.createdAt || time - grant.createdAt >= 600000
            || !equal(token, grant.token))
            throw fail('GROUP_MANAGEMENT_NOT_AUTHORIZED');
        return grant;
    }
    function hint(key) {
        const enabled = actions.filter(action => permission()?.[action] === true), stamp = context(key), time = now();
        if (closed || !enabled.length || !/^group:[1-9]\d{0,19}$/.test(key ?? '') || typeof stamp !== 'string' || !stamp)
            return '';
        for (const [name, grant] of versions)
            if (time < grant.createdAt || time - grant.createdAt >= 600000) {
                grants.delete(name);
                versions.delete(name);
            }
        if (!versions.has(key) && versions.size >= 128)
            return '';
        const grant = { context: stamp, createdAt: time, token: randomBytes(32).toString('hex'), operationId: randomBytes(32).toString('hex') };
        grants.set(key, grant);
        versions.set(key, grant);
        rememberToken(key, grant.token);
        return '\n【本轮群管理】仅在明确需要且符合当前群实际权限时调用 qq_group_manage；本轮允许动作：' + enabled.join('、')
            + '。key只能用当前群标识；mute/kick的userId必须是本次实际发言成员的号码，不能凭昵称猜测。'
            + 'atAll需要text，不传userId；mute需要整数duration秒，0解除禁言；kick不传duration。每次只执行一个动作，资格一次性使用，失败或结果未知都不能自动重试。'
            + '原生accepted仅表示接收，不能说已经生效；只有工具明确confirmed才可声称相应结果。不要公开资格。'
            + '\n群管理资格：' + grant.token + '\n';
    }
    async function act(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || !actions.includes(input.action))
            throw fail('GROUP_MANAGEMENT_INPUT_INVALID');
        const names = ['key', 'action', 'managementToken', ...(input.action === 'atAll' ? ['text'] : input.action === 'mute' ? ['userId', 'duration'] : ['userId'])];
        if (Object.keys(input).length !== names.length || Object.keys(input).some(key => !names.includes(key)))
            throw fail('GROUP_MANAGEMENT_INPUT_INVALID');
        const grant = current(input.key, input.action, input.managementToken);
        if (input.action === 'atAll') {
            if (typeof input.text !== 'string' || !input.text.trim() || Array.from(input.text).length > 280 || input.text.includes('\0')
                || SENSITIVE_RE.test(input.text) || input.text.includes(input.managementToken) || safeText(input.text) !== true)
                throw fail('GROUP_MANAGEMENT_INPUT_INVALID');
        }
        else if (typeof input.userId !== 'string' || !/^[1-9]\d{0,19}$/.test(input.userId)
            || input.action === 'mute' && (!Number.isSafeInteger(input.duration) || input.duration < 0 || input.duration > 30 * 86400))
            throw fail('GROUP_MANAGEMENT_INPUT_INVALID');
        // 开始异步核验前即消耗，防止并发双提交；不会因预检失败恢复旧资格。
        grants.delete(input.key);
        let result;
        try {
            result = await verify(input.key, input.action);
        }
        catch {
            throw fail('GROUP_MANAGEMENT_NOT_AUTHORIZED');
        }
        if (closed || versions.get(input.key) !== grant || result?.authorized !== true || context(input.key) !== grant.context || permission()?.[input.action] !== true
            || now() < grant.createdAt || now() - grant.createdAt >= 600000)
            throw fail('GROUP_MANAGEMENT_NOT_AUTHORIZED');
        let returned;
        try {
            returned = await perform(input.key, input.action, input.action === 'atAll' ? { text: input.text }
                : { userId: input.userId, ...(input.action === 'mute' ? { duration: input.duration } : {}) }, grant.operationId);
        }
        catch {
            throw fail('GROUP_MANAGEMENT_UNCONFIRMED');
        }
        if (input.action === 'atAll') {
            if (!Number.isSafeInteger(returned?.message_id) || returned.message_id < 1)
                throw fail('GROUP_MANAGEMENT_UNCONFIRMED');
            return { action: input.action, outcome: 'confirmed', submitted: true, confirmed: true,
                instruction: '全体提及消息取得匹配的原生发送回执；不要重复发送正文。' };
        }
        if (returned?.outcome === 'confirmed') {
            if (input.action !== 'mute' || returned.submitted !== true || returned.confirmed !== true
                || returned.confirmation !== 'forced_remote_group_member_read')
                throw fail('GROUP_MANAGEMENT_UNCONFIRMED');
            return { action: input.action, outcome: 'confirmed', submitted: true, confirmed: true,
                confirmation: 'forced_remote_group_member_read',
                instruction: input.duration === 0 ? '强制定向服务器成员回传已观察到解除禁言状态；不重复提交。'
                    : '强制定向服务器成员回传已观察到符合请求时长的禁言状态；不重复提交。' };
        }
        if (!['accepted', 'rejected', 'unknown'].includes(returned?.outcome) || returned.submitted !== true || returned.confirmed !== false)
            throw fail('GROUP_MANAGEMENT_UNCONFIRMED');
        return { action: input.action, outcome: returned.outcome, submitted: true, confirmed: false,
            instruction: returned.outcome === 'accepted' ? '原生已接收，实际生效尚未确认；不能宣称已经完成，不要重试。'
                : '操作被拒绝或结果未知；不要自动重试，不要宣称已经完成。' };
    }
    return Object.freeze({ hint, act, cancel: () => { grants.clear(); versions.clear(); },
        close: () => { closed = true; grants.clear(); versions.clear(); } });
}
