// Generated from mcp-tools/messaging.ts. Edit the TypeScript source and run build:typed.
/** 注册qq_send_native_message；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSendNativeMessage(deps) {
    const { agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    server.tool('qq_send_native_message', '在所有原生模式向当前授权目标发送消息，支持文字、[[qq-at:成员号码]]、[[qq-image:完整图片编号]]和[[qq-voice:自然中文短句]]。功能必须已勾选，图片编号须来自本会话；不接受文件路径或URL。所有模式须传featureToken功能会话令牌。发送后无需再重复正文或补发“已发送”；失败或未知不可自动重试。', { key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/), text: z.string().min(1).max(12000), featureToken: nativeFeatureTokenSchema, token: z.string().optional() }, async ({ key, text, token, featureToken }) => {
        try {
            const data = await agentApi('/api/native/send', {
                method: 'POST', body: JSON.stringify({ key, text }),
                headers: nativeFeatureHeaders(featureToken, token), timeoutMs: 180000
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch {
            return { content: [{ type: 'text', text: 'NATIVE_SEND_UNCONFIRMED：未完整确认，不要自动补发或声称已全部送达。' }], isError: true };
        }
    });
}
/** 注册qq_send_group_message；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSendGroupMessage(deps) {
    const { agentApi, serializeModelData, server, unquoteJsonString, z } = deps;
    server.tool('qq_send_group_message', '向指定 QQ 群发送一条纯文本消息；如需引用某条消息，可传 replyToMessageId（非零整数，可为负数），可先用 qq_get_recent_messages / qq_get_message_detail 查询。二代模式（reserved2）下这是可用的发送工具之一，但优先使用 qq_send_message；reserved2 下调用时必须携带会话令牌 token，否则会被拒绝。不要在发送后输出“已发送”类汇报。目标群必须命中系统白名单（config.json 的 allow.groups），否则拒绝。', {
        groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
        message: z.string().describe('消息文本，纯文本，不要用 Markdown 或 CQ 码'),
        replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
        token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
    }, async ({ groupId, message, replyToMessageId, token }) => {
        try {
            const cleanMessage = unquoteJsonString(message);
            const data = await agentApi('/api/send/group', {
                method: 'POST',
                // token 既放 body（兼容旧调用）又放 header：桥接的「agent 流量」判定基于 header，
                // 只带 body 会让这条请求在桥接眼里像控制台请求，绕过 agent 专用的闸门与审计。
                ...(token ? { headers: { 'x-agent-token': token } } : {}),
                body: JSON.stringify({ groupId: String(groupId), message: cleanMessage, replyToMessageId, token: token || undefined })
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_reply；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqReply(deps) {
    const { agentApi, serializeModelData, server, unquoteJsonString, z } = deps;
    server.tool('qq_reply', '在指定 QQ 群里引用/回复某条消息，并发送一条文本。适合群消息很多、需要明确“我回的是哪条”时使用；replyToMessageId 是被引用消息的 id（非零整数，QQ 消息 id 可能为负数），可先用 qq_get_recent_messages / qq_get_unread_messages / qq_get_message_detail 查到具体消息内容和 id。发送前桥接会校验该 id 存在且属于当前会话。二代模式下这是你正常可用的引用工具，但不要每条都引用。只有以下情况才需要引用：① 你这条消息指向的人或消息并非最新一条别人的消息（也就是你在回更早的某条）；② 你连续几句话里不同消息指代的是不同的消息或不同的人。其他情况（上下文唯一、刚在接同一条最新消息）不要引用，别让对方猜，也别为了用工具而用。reserved2 下调用时必须携带会话令牌 token。目标群必须命中系统白名单（config.json 的 allow.groups），否则拒绝。', {
        groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
        replyToMessageId: z.union([z.number(), z.string()]).describe('被引用/回复的消息 id（非零整数，可为负数）'),
        message: z.string().describe('要发送的文本，纯文本，不要用 Markdown 或 CQ 码'),
        token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
    }, async ({ groupId, replyToMessageId, message, token }) => {
        try {
            const cleanMessage = unquoteJsonString(message);
            const data = await agentApi('/api/send/reply', {
                method: 'POST',
                ...(token ? { headers: { 'x-agent-token': token } } : {}),
                body: JSON.stringify({ groupId: String(groupId), replyToMessageId, message: cleanMessage, token: token || undefined })
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_send_private_message；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSendPrivateMessage(deps) {
    const { agentApi, serializeModelData, server, unquoteJsonString, z } = deps;
    server.tool('qq_send_private_message', '向指定 QQ 好友发送一条私聊消息。若提供 replyToMessageId，会以 QQ 引用/回复形式发出（引用条 + 文本）。replyToMessageId 必须是非零整数消息 id（QQ 消息 id 可能为负数），可先用 qq_get_message_detail 查询。二代模式（reserved2）下这是可用的发送工具之一，但优先使用 qq_send_message；调用时必须携带会话令牌 token，否则会被拒绝。不要在发送后输出“已发送”类汇报。目标 QQ 必须命中系统白名单（config.json 的 allow.private），否则拒绝。', {
        userId: z.union([z.number(), z.string()]).describe('好友 QQ 号（必须在白名单内）'),
        message: z.string().describe('消息文本，纯文本，不要用 Markdown 或 CQ 码'),
        replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
        token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
    }, async ({ userId, message, replyToMessageId, token }) => {
        try {
            const cleanMessage = unquoteJsonString(message);
            const data = await agentApi('/api/send/private', {
                method: 'POST',
                ...(token ? { headers: { 'x-agent-token': token } } : {}),
                body: JSON.stringify({ userId: String(userId), message: cleanMessage, replyToMessageId, token: token || undefined })
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_send_burst；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSendBurst(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_send_burst', '在指定 QQ 群分多条发送消息（二代仿真模式专用），桥接会按真人化随机间隔发送。暂不支持引用，需要引用请用 qq_reply。注意：数组里的每个字符串就是一条 QQ 消息，字符串内部不要用空格分隔中文短句，需要多条请用数组元素；每条消息要读起来完整，不要把同一句话拆到两条里。', {
        groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        messages: z.union([z.array(z.string()).min(1), z.string()]).describe('要发送的消息数组，每条为纯文本；也兼容传入 JSON 数组字符串')
    }, async ({ groupId, token, messages }) => {
        try {
            const key = `group:${groupId}`;
            let finalMessages = messages;
            if (typeof finalMessages === 'string') {
                const trimmed = finalMessages.trim();
                // 兼容模型把数组序列化成 JSON 字符串传入的情况，例如 "[...]"。
                if (trimmed.startsWith('[')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (Array.isArray(parsed))
                            finalMessages = parsed.map(String);
                    }
                    catch { }
                }
                else if (trimmed.startsWith('"')) {
                    // 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (typeof parsed === 'string')
                            finalMessages = parsed;
                        else if (Array.isArray(parsed))
                            finalMessages = parsed.map(String);
                    }
                    catch { }
                }
            }
            const data = await agentApi('/api/socialV2/send-burst', {
                method: 'POST',
                body: JSON.stringify({ key, messages: finalMessages }),
                headers: { 'x-agent-token': token },
                timeoutMs: 300000
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `分条发送失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_send_message；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSendMessage(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_send_message', '统一发送工具：可发一条或多条，可引用某条消息，可自定义/按字数计算条间时间差。二代仿真模式专用。注意：字符串=一条消息，数组=多条消息；每个字符串内部不要用空格分隔中文短句，需要多条请用数组元素；每条消息要读起来完整，不要把同一句话拆到两条里。只有以下情况才需要传 replyToMessageId 引用：① 你这条消息指向的人或消息并非最新一条别人的消息（也就是你在回更早的某条）；② 你连续几句话里不同消息指代的是不同的消息或不同的人。其他情况（上下文唯一、刚在接同一条最新消息）不要引用，别让对方猜，也别为了用工具而用。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        messages: z.union([z.string(), z.array(z.string()).min(1)]).describe('要发送的内容：字符串=一条；数组=分多条'),
        replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
        atUserId: z.union([z.number(), z.string()]).optional().describe('要 @ 的群成员 QQ 号（群聊中用于点名某个人；与引用二选一即可，不要滥用）'),
        gapMode: z.enum(['auto', 'fixed', 'byLength']).optional().describe('auto=桥接随机；fixed=固定间隔；byLength=按字数计算'),
        gapMs: z.number().optional().describe('fixed 模式下的统一间隔（毫秒）'),
        gaps: z.array(z.number()).optional().describe('fixed 模式下逐条间隔（长度=条数-1）')
    }, async ({ key, token, messages, replyToMessageId, atUserId, gapMode, gapMs, gaps }) => {
        try {
            let finalMessages = messages;
            if (typeof finalMessages === 'string') {
                const trimmed = finalMessages.trim();
                // 兼容模型把数组序列化成 JSON 字符串传入的情况，例如 "[...]"。
                if (trimmed.startsWith('[')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (Array.isArray(parsed))
                            finalMessages = parsed.map(String);
                    }
                    catch { }
                }
                else if (trimmed.startsWith('"')) {
                    // 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (typeof parsed === 'string')
                            finalMessages = parsed;
                        else if (Array.isArray(parsed))
                            finalMessages = parsed.map(String);
                    }
                    catch { }
                }
            }
            const data = await agentApi('/api/socialV2/send-message', {
                method: 'POST',
                body: JSON.stringify({ key, messages: finalMessages, replyToMessageId, atUserId: atUserId ?? null, gapMode, gapMs, gaps }),
                headers: { 'x-agent-token': token },
                timeoutMs: 300000
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_send_poke；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSendPoke(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_send_poke', '发送 QQ 拍一拍（群聊/私聊）。适合用“戳一下”代替一句废话、提醒对方、自然回应别人的拍一拍，或偶尔主动戳一下正在聊的人/熟人——这样更拟真；但别频繁，真人不会一直戳人。群聊必须传 targetUserId（要拍的群友 QQ 号，可从 qq_get_active_members / qq_get_message_detail 的 userId 获取）；私聊可不传 targetUserId（默认拍当前私聊对象）。reserved2 下必须携带会话令牌 token，发送会受桥接白名单与发送频率限制。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        targetUserId: z.union([z.number(), z.string()]).optional().describe('要拍的群友 QQ 号（群聊必填；私聊可选）')
    }, async ({ key, token, targetUserId }) => {
        try {
            const data = await agentApi('/api/socialV2/send-poke', {
                method: 'POST',
                body: JSON.stringify({ key, targetUserId: targetUserId != null ? String(targetUserId) : '' }),
                headers: { 'x-agent-token': token },
                timeoutMs: 60000
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `拍一拍失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
