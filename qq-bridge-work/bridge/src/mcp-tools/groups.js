// Generated from mcp-tools/groups.ts. Edit the TypeScript source and run build:typed.
/** 注册qq_group_manage；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGroupManage(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_group_manage', '所有原生模式中，本轮明确提供一次性群管理资格时可用。atAll发送一条带真正全体提及的通知，mute禁言/解除，kick移除成员；各自需要本机独立许可和当前群实际权限。目标仅限当前群本次发言成员，不能猜号码或管理员身份；每轮一次，失败或未知不能重试。accepted不是已生效。', {
        key: z.string().regex(/^group:[1-9]\d{0,19}$/), action: z.enum(['atAll', 'mute', 'kick']),
        managementToken: z.string().regex(/^[a-f0-9]{64}$/),
        userId: z.string().regex(/^[1-9]\d{0,19}$/).optional().describe('仅mute/kick必填，当前群实际发言成员号码'),
        duration: z.number().int().min(0).max(2592000).optional().describe('仅mute必填，秒数，0解除禁言'),
        text: z.string().min(1).max(560).optional().describe('仅atAll必填，通知正文最多280字符，不包含凭据或资格')
    }, async (input) => {
        try {
            const body = await agentApi('/api/native-group/action', { method: 'POST', body: JSON.stringify(input), timeoutMs: 22000 });
            if (!['confirmed', 'accepted', 'rejected', 'unknown'].includes(body?.outcome) || body.submitted !== true || typeof body.confirmed !== 'boolean')
                throw new Error();
            return {
                content: [{
                        type: 'text', text: serializeModelData({
                            action: body.action, outcome: body.outcome,
                            submitted: true, confirmed: body.confirmed, instruction: body.instruction
                        })
                    }],
                ...(['rejected', 'unknown'].includes(body.outcome) ? { isError: true } : {})
            };
        }
        catch {
            return { content: [{ type: 'text', text: 'GROUP_MANAGEMENT_UNCONFIRMED：本次未完成或结果未知，不能声称已生效；资格已消耗，不要自动重试。' }], isError: true };
        }
    });
}
/** 注册qq_list_groups；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqListGroups(deps) {
    const { getAccess, isAllowed, legacyReadToolAllowed, onebot, serializeModelData, server } = deps;
    server.tool('qq_list_groups', '列出机器人所在的全部 QQ 群（只读）：群号、群名。', {}, async () => {
        // 旧只读工具没有 agent token：只允许在封闭 agent（管理员私聊）里使用。
        // 判定失败一律拒绝（fail-closed），不依赖「看到某个模式才拒绝」的黑名单写法。
        try {
            if (!(await legacyReadToolAllowed())) {
                return { content: [{ type: 'text', text: '旧只读工具仅在封闭 agent（管理员私聊）模式可用；其它模式请使用带会话令牌的 v2 读工具' }], isError: true };
            }
        }
        catch (error) {
            return { content: [{ type: 'text', text: `无法确认当前模式，拒绝执行：${error?.message ?? error}` }], isError: true };
        }
        try {
            const a = getAccess();
            const data = await onebot('get_group_list');
            const list = (Array.isArray(data) ? data : (data?.data ?? []))
                .filter((g) => isAllowed(a.allowGroups, a.denyGroups, g.group_id, a.allowAllWhenEmpty))
                .map((g) => ({ group_id: g.group_id, group_name: g.group_name }));
            return { content: [{ type: 'text', text: serializeModelData(list) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_get_group_members；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetGroupMembers(deps) {
    const { agentApi, cfg, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    // 群成员列表：**换成 v2 形态**（key + token）。
    //
    // 为什么不再沿用旧的无令牌版本：它是 qq-chat-v2 预设里唯一被点名的"拿 QQ 号"的途径
    // （见 dsh/agent-presets/qq-chat-v2/agent.cordis.yml 第 6 条），但旧版在 reserved2 下必然 403
    // —— 预设教模型用一个永远失败的工具，等于每次都白烧一步。改成 v2 后同一个名字在两种模式下都成立。
    server.tool('qq_get_group_members', cfg.nativeFeatureProtocol === 1
        ? '只读列出当前授权群本次连接已实际发言且身份核验无冲突的成员：QQ号、昵称、群名片；始终partial=true，不是完整群名单。要@或核对身份时使用返回userId，不猜号码。所有原生模式须传本轮featureToken。'
        : '列出指定群的成员（只读）：QQ号、昵称、群名片。只返回桥接允许的群；QQ号取返回userId。', {
        key: z.string().describe('会话 key，格式 group:群号'),
        token: z.string().optional().describe('会话令牌（见唤醒提示中的【会话令牌】；closed-agent 模式不需要）'),
        ...(cfg.nativeFeatureProtocol === 1 ? { featureToken: nativeFeatureTokenSchema } : {}),
        limit: z.number().optional().describe('最多返回多少成员，默认 50，最大 100')
    }, async ({ key, token, featureToken, limit }) => {
        try {
            const q = new URLSearchParams({ key });
            if (limit != null)
                q.set('limit', String(limit));
            // token 可选：closed-agent（管理员私聊）里代理没有会话令牌，走的是操作者路径；
            // 桥接那边的白名单/模式判定对**这条**请求同样生效（不依赖 header 是否存在）。
            const data = cfg.nativeFeatureProtocol === 1
                ? await agentApi('/api/native/group-members?' + q.toString(), { headers: nativeFeatureHeaders(featureToken, token) })
                : await agentApi(`/api/socialV2/group-members?${q.toString()}`, token ? { headers: { 'x-agent-token': token } } : {});
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取群成员失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_get_group_history；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetGroupHistory(deps) {
    const { getAccess, isAllowed, legacyReadToolAllowed, onebot, serializeModelData, server, z } = deps;
    server.tool('qq_get_group_history', '获取兼容网关提供的指定群最近消息（只读）。messageSeq可选；是否可用取决于该兼容通道是否实现get_group_msg_history。原生通道不通过此接口读取历史。', { groupId: z.union([z.number(), z.string()]).describe('群号'), messageSeq: z.number().optional().describe('起始消息序号（可选）') }, async ({ groupId, messageSeq }) => {
        const g = String(groupId);
        try {
            if (!(await legacyReadToolAllowed())) {
                return { content: [{ type: 'text', text: '旧只读工具仅在封闭 agent（管理员私聊）模式可用；其它模式请使用带会话令牌的 v2 读工具' }], isError: true };
            }
        }
        catch (error) {
            return { content: [{ type: 'text', text: `无法确认当前模式，拒绝读取：${error?.message ?? error}` }], isError: true };
        }
        const a = getAccess();
        if (!isAllowed(a.allowGroups, a.denyGroups, g, a.allowAllWhenEmpty)) {
            return { content: [{ type: 'text', text: `拒绝：群 ${g} 不在只读白名单中` }], isError: true };
        }
        try {
            const params = { group_id: Number(g) };
            if (messageSeq !== undefined)
                params.message_seq = messageSeq;
            const data = await onebot('get_group_msg_history', params);
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
