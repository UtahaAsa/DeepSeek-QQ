// Generated from mcp-tools/conversation.ts. Edit the TypeScript source and run build:typed.
/** 注册qq_get_prompt；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetPrompt(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    // ── 二代仿真模式（reserved2）工具 ─────────────────────────────────────────
    server.tool('qq_get_prompt', '查看当前二代仿真模式的提示词/角色/推荐值/可用工具/当前唤醒配置（只读）。', { key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'), token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）') }, async ({ key, token }) => {
        try {
            const data = await agentApi(`/api/socialV2/prompt?key=${encodeURIComponent(key)}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取提示词失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_get_unread_messages；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetUnreadMessages(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_get_unread_messages', '查看未读消息，不自动标记已读。大量积压或快照 partial=true 时，用 afterSeq=readThroughSeq 从水位后按时间顺序补读；从最早未读开始传 0。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        limit: z.number().optional().describe('最多返回条数，默认 30，最大 100'),
        afterSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().describe('读取本地 seq 大于此水位的最早一页；省略则沿用返回最新一页的旧行为')
    }, async ({ key, token, limit, afterSeq }) => {
        try {
            const data = await agentApi(`/api/socialV2/unread?key=${encodeURIComponent(key)}&limit=${limit ?? 30}${afterSeq === undefined ? '' : `&afterSeq=${afterSeq}`}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取未读消息失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_get_recent_messages；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetRecentMessages(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_get_recent_messages', '查看指定会话的最近消息（只读），支持 offset 扩大范围。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        limit: z.number().optional().describe('最多返回条数，默认 20，最大 100'),
        offset: z.number().optional().describe('跳过最近 N 条，用于向前翻看更早消息，默认 0')
    }, async ({ key, token, limit, offset }) => {
        try {
            const data = await agentApi(`/api/socialV2/recent?key=${encodeURIComponent(key)}&limit=${limit ?? 20}&offset=${offset ?? 0}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取最近消息失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_social_state；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSocialState(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_social_state', '查看指定会话的二代仿真状态：WakeConfig、未读数、上次唤醒原因、上次发言时间等（只读）。', { key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'), token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）') }, async ({ key, token }) => {
        try {
            const data = await agentApi(`/api/socialV2/state?key=${encodeURIComponent(key)}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取状态失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_mark_read；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqMarkRead(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_mark_read', '【后台观察回执优先】qq_wait_for_messages 返回 background=true 时，后台已经接管观察，必须立即结束本轮；不要重复等待，也不要立即调用 qq_mark_read 或 qq_set_wake_config。后台静默到期不调用模型，新消息才会合并后唤醒。此回执优先于下文前台等待和收尾规则，未读水位不因后台交接而确认。将指定会话已查看的未读消息标记为已读。throughSeq 使用最近读取结果的 readThroughSeq，避免清除读取后才到达的新消息；省略 throughSeq 会按旧行为清空当前全部未读，因此推荐始终带上水位。注意：每次设置潜水/下一次唤醒前，桥接要求先用 qq_wait_for_messages(timeoutMs=300000) 完成一次沉睡前观察：5 分钟内没人说话可 mark_read 收尾沉睡；期间有人发新消息则先查看 newMessages，判断不需要你参与也可直接 mark_read 收尾；若你参与了回复，则下次想睡需重新等待观察窗口。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().describe('本次确认已读的消息水位，使用已查看结果中的 readThroughSeq；不会清除更晚到达的消息')
    }, async ({ key, token, throughSeq }) => {
        try {
            const data = await agentApi('/api/socialV2/mark-read', { method: 'POST', body: JSON.stringify({ key, throughSeq }), headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `标记已读失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_set_wake_config；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSetWakeConfig(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_set_wake_config', '【后台观察回执优先】qq_wait_for_messages 返回 background=true 时，后台已经接管观察，必须立即结束本轮；不要重复等待，也不要立即调用 qq_mark_read 或 qq_set_wake_config。后台静默到期不调用模型，新消息才会合并后唤醒。此回执优先于下文前台等待和收尾规则，未读水位不因后台交接而确认。设置指定会话的二代唤醒配置：mode/无限期或有限时间/提前唤醒条件（@、名字、关键词、提问、拍一拍、概率、anyMessage、指定成员）。triggers.speakerIds 是可选的“指定群友发言唤醒”：填一个或多个群友 QQ 号后，只要其中任意一位在群里发言就会唤醒你；不设置则不启用。适合在等某个人回复、或某人反应慢怕错过时使用。triggers.poke 开启后，群里有人拍一拍（包括拍你或拍别人）会唤醒你。注意：每次设置潜水/下一次唤醒前需先用 qq_wait_for_messages(timeoutMs=300000) 完成一次沉睡前观察：5 分钟内没人说话可设置并沉睡；期间有人发新消息则先查看 newMessages，判断不需要你参与可直接设置并沉睡；若你参与了回复，则下次想睡需重新等待观察窗口。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().describe('可同时确认已读：使用已查看结果中的 readThroughSeq，省去额外 qq_mark_read；不传则只设置唤醒配置。若 markRead 工具被关闭，该水位会被忽略，本工具只设置唤醒配置'),
        config: z.object({
            mode: z.enum(['diving', 'active']).optional().describe('diving=潜水，active=活跃（anyMessage 开启）'),
            infinite: z.boolean().optional().describe('true=无限期，只有条件命中才唤醒；false=有限时间'),
            sleepMs: z.number().optional().describe('有限潜水毫秒数（从当前时间起算）'),
            sleepUntil: z.string().optional().describe('有限潜水截止时间 ISO 字符串，优先级高于 sleepMs'),
            triggers: z.object({
                atMention: z.boolean().optional().describe('被 @ 或引用自己时唤醒'),
                nameMention: z.boolean().optional().describe('被叫名字/昵称时唤醒'),
                speakerIds: z.array(z.union([z.number(), z.string()])).max(20).optional().describe('指定群友 QQ 号数组：这些群友中任意一位发言时唤醒（可选，最多 20 个，不设置则不启用；私聊不适用，设置会被桥接清除；可从 qq_get_active_members / qq_get_group_members / qq_get_message_detail 的 userId/user_id 获取）'),
                keywords: z.array(z.string()).optional().describe('出现任意关键词时唤醒'),
                question: z.boolean().optional().describe('被直接提问/点名挑战时唤醒'),
                poke: z.boolean().optional().describe('有人拍一拍时唤醒（群聊包括拍你和拍别人，私聊为对方拍你）'),
                anyMessage: z.boolean().optional().describe('任意新消息都唤醒（活跃模式）'),
                probability: z.number().optional().describe('普通消息按该概率随机唤醒（0~1）')
            }).optional(),
            batchWindowMs: z.number().optional().describe('多条消息合并唤醒窗口（毫秒，>=1000）')
        }).describe('要设置的唤醒配置，缺省字段保留原值')
    }, async ({ key, token, config, throughSeq }) => {
        try {
            const data = await agentApi('/api/socialV2/wake-config', { method: 'POST', body: JSON.stringify({ key, config, throughSeq }), headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `设置唤醒配置失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_wait_for_messages；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqWaitForMessages(deps) {
    const { agentApiLongPoll, serializeModelData, server, z } = deps;
    server.tool('qq_wait_for_messages', '【后台观察回执优先】qq_wait_for_messages 返回 background=true 时，后台已经接管观察，必须立即结束本轮；不要重复等待，也不要立即调用 qq_mark_read 或 qq_set_wake_config。后台静默到期不调用模型，新消息才会合并后唤醒。此回执优先于下文前台等待和收尾规则，未读水位不因后台交接而确认。若返回 background=true，后台已接管观察：请立即结束本轮，不要重复等待，也不要立即调用mark_read或set_wake_config；新消息会由后台唤醒。其他情况等待分两种用途。首答前已读消息、只想确认有没有补充：用 purpose="reply"，按最后来信时间补足 quietMs 静默，已安静足够就立即返回；读取/思考时新到的消息也会返回，新消息重算静默。timeoutMs 是最长预算，不要求等满；预算到但 quiet=false 不代表对方已说完。此用途绝不代替沉睡前观察。等对方继续说、等回复或睡前观察：用默认 purpose="messages"；先等新消息，收到后才按 quietMs 等静默，没有新消息会等到 timeoutMs，单传 quietMs 不会缩短总等待。静默下限由后台配置，默认 3000ms。**返回里的 canSleepNow / countsAsObservation / hint 直接告诉你现在能不能收尾、该用多大的 timeoutMs——照它做，不要反复试**：canSleepNow=true 就可以直接 mark_read / set_wake_config；false 时按 hint 给的 timeoutMs 一次等满（更短的等待不算沉睡前观察，满足不了闸门）。直接看 newMessages、unreadCount 和 readThroughSeq，返回消息无需重复查询；仍有未展示未读才补读。决定潜水/收尾时才用默认用途加 timeoutMs=300000 完成沉睡前观察，不能把 5 分钟观察放在首答之前；短等待不能代替。全程无人说话返回 preSleepWaitSatisfied=true；观察期间来了新消息返回 preSleepWaitObserved=true，读后不需参与可收尾，参与回复则下次收尾重新观察。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        purpose: z.enum(['messages', 'reply']).optional().describe('默认 messages：等新消息/回复/睡前观察；reply：回复前短静默，计入最后来信后已过去的时间，绝不授予睡前观察资格'),
        timeoutMs: z.number().optional().describe('等待预算毫秒数，默认 30000、最大 600000；reply 达到静默即返回，不必等满；沉睡前观察用 messages 并传 300000'),
        minNewMessages: z.number().optional().describe('仅 messages 用途：至少等到多少条新消息才进入静默窗口，默认 1；reply 用途会忽略它'),
        quietMs: z.number().optional().describe('静默窗口毫秒数，建议 3000~6000；reply 从最后来信开始计时，messages 只在等到新消息后计时；后台默认至少 3000')
    }, async ({ key, token, purpose, timeoutMs, minNewMessages, quietMs }) => {
        try {
            // 必须走长轮询通道：全局 fetch（undici）有 300s headersTimeout，
            // 而沉睡前观察的预算就是 300s（见 agentApiLongPoll 的说明）。
            const data = await agentApiLongPoll('/api/socialV2/wait', {
                method: 'POST',
                body: JSON.stringify({ key, purpose, timeoutMs, minNewMessages, quietMs }),
                headers: { 'x-agent-token': token },
                timeoutMs: Math.min(725000, (Number(timeoutMs) || 30000) + Math.max(Number(quietMs) || 0, 10000) + 20000)
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `等待失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_report_feedback；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqReportFeedback(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_report_feedback', '向控制台/管理端反馈 AI 遇到的问题、困惑或需要管理员介入的情况。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        level: z.enum(['info', 'warning', 'error']).optional().describe('反馈级别，默认 info'),
        message: z.string().describe('反馈内容')
    }, async ({ key, token, level, message }) => {
        try {
            const data = await agentApi('/api/socialV2/feedback', {
                method: 'POST',
                body: JSON.stringify({ key, level, message }),
                headers: { 'x-agent-token': token }
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `反馈失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_get_my_recent_messages；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetMyRecentMessages(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_get_my_recent_messages', '查看自己最近发过的消息（只读），避免重复/保持人设。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        limit: z.number().optional().describe('最多返回条数，默认 10，最大 50')
    }, async ({ key, token, limit }) => {
        try {
            const data = await agentApi(`/api/socialV2/my-recent?key=${encodeURIComponent(key)}&limit=${limit ?? 10}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取自己消息失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_get_message_detail；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetMessageDetail(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_get_message_detail', '按 message_id / 本地 seq 查看单条消息的发送者、引用信息与正文（只读）。注意：正文最多返回 200 字符，textTruncated=true 表示被截断，这里不是读取长消息全文的入口。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        messageId: z.union([z.number(), z.string()]).describe('要查看的消息 id（QQ 消息 id 可能为负数）')
    }, async ({ key, token, messageId }) => {
        try {
            const data = await agentApi(`/api/socialV2/message-detail?key=${encodeURIComponent(key)}&messageId=${encodeURIComponent(String(messageId))}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取消息详情失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_get_active_members；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetActiveMembers(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_get_active_members', '查看最近活跃成员列表（只读），帮助判断话题参与者。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        limit: z.number().optional().describe('最多返回人数，默认 10，最大 20')
    }, async ({ key, token, limit }) => {
        try {
            const data = await agentApi(`/api/socialV2/active-members?key=${encodeURIComponent(key)}&limit=${limit ?? 10}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取活跃成员失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
