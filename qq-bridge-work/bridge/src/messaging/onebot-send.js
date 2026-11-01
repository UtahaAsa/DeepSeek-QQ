// Generated from messaging/onebot-send.ts. Edit the TypeScript source and run build:typed.
/**
 * 构造已选通道的低层文字发送器，构造不联网。
 * @param deps 当前原生绑定、令牌集合、旧HTTP传输及文本转义能力。
 * @returns onebotSend验证引用/@标识并阻止令牌外发；原生目标保持字符串且不回退HTTP。
 * @note 本层不授予发送权限；调用方须在队列提交前复核所属身份。
 */
export function createOnebotSender(deps) {
    async function onebotSend(kind, id, message, replyToMessageId, atUserId = null) {
        const segments = [];
        if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '') {
            const rid = String(replyToMessageId).trim();
            if (!/^-?[1-9]\d*$/.test(rid))
                throw new Error('replyToMessageId 必须是非零整数（消息 id 可能为负数）');
            segments.push({ type: 'reply', data: { id: rid } });
        }
        if (atUserId !== undefined && atUserId !== null && String(atUserId).trim() !== '') {
            const at = String(atUserId).trim();
            // 只允许正整数 QQ 号，禁止 @all，避免被滥用成 @全体成员
            if (!/^\d+$/.test(at))
                throw new Error('atUserId 必须是正整数 QQ 号，且不能为 all');
            segments.push({ type: 'at', data: { qq: at } });
        }
        const rawMessage = String(message ?? '');
        const hasKnownToken = [...deps.KNOWN_AGENT_TOKENS].some((t) => t && rawMessage.includes(t));
        if (hasKnownToken) {
            (0, deps.log)(`发送内容包含会话令牌，已阻止发送 (${kind}:${id})`);
            throw new Error('发送内容包含会话令牌，已阻止发送');
        }
        segments.push({ type: 'text', data: { text: (0, deps.escapeCqText)(rawMessage) } });
        const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
        const targetId = deps.nativeBinding ? String(id) : Number(id);
        const params = kind === 'private' ? { user_id: targetId, message: segments } : { group_id: targetId, message: segments };
        if (deps.nativeBinding)
            return deps.bot.raw(action, { ...params, message: segments.map((segment) => segment.type === 'text' ? { type: 'text', data: { text: rawMessage } } : segment) });
        const httpUrl = String(deps.cfg.onebot?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
        const res = await (0, deps.fetch)(`${httpUrl}/${action}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(deps.cfg.onebot?.accessToken ? { authorization: `Bearer ${deps.cfg.onebot.accessToken}` } : {})
            },
            body: JSON.stringify(params),
            signal: deps.AbortSignal.timeout(15000)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
            const hint = res.status === 426 ? '（HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口，请检查 config.json 的 snowluma.httpUrl 是否为 OneBot HTTP API 地址）' : '';
            throw new Error(`OneBot ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
        }
        return body.data;
    }
    return { onebotSend };
}
