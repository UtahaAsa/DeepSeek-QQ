// Generated from mcp-tools/memory.ts. Edit the TypeScript source and run build:typed.
/** 注册qq_memory_append；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqMemoryAppend(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_memory_append', '记录一条轻量记忆：activeTopic=进行中的话题；pendingThought=你想说但还没说的话；memberImpression=对某位群友的印象。记忆会持久化，并在后续唤醒/qq_get_prompt 中自动出现。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).describe('记忆类别'),
        content: z.string().describe('记忆内容，例如话题、想说的话、对某人的印象标签'),
        extra: z.object({
            target: z.string().optional().describe('memberImpression 时的群友名字/昵称'),
            participants: z.array(z.string()).optional().describe('activeTopic 的参与者列表'),
            pendingQuestion: z.string().optional().describe('activeTopic 里还没问出口的问题'),
            motivation: z.string().optional().describe('pendingThought 的动机，如 curiosity/sociability'),
            expiresAtMs: z.number().optional().describe('pendingThought 过期毫秒数，默认 2 小时')
        }).optional().describe('附加信息')
    }, async ({ key, token, category, content, extra }) => {
        try {
            const data = await agentApi('/api/socialV2/memory-append', {
                method: 'POST',
                body: JSON.stringify({ key, category, content, extra: extra || {} }),
                headers: { 'x-agent-token': token }
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `记忆写入失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_memory_query；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqMemoryQuery(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_memory_query', '查看当前会话的轻量记忆：进行中的话题、你想说但还没说的话、对群友的印象（只读）。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).optional().describe('可选：只看某一类记忆')
    }, async ({ key, token, category }) => {
        try {
            const q = new URLSearchParams({ key });
            if (category)
                q.set('category', category);
            const data = await agentApi(`/api/socialV2/memory?${q.toString()}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `记忆读取失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_memory_remove；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqMemoryRemove(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_memory_remove', '删除一条轻量记忆：activeTopic/pendingThought 用 content 匹配原文删除；memberImpression 用 target 参数指定群友名字删除。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).describe('记忆类别'),
        content: z.string().optional().describe('要删除的话题/想法原文（memberImpression 不需要）'),
        target: z.string().optional().describe('memberImpression 时要删除的群友名字')
    }, async ({ key, token, category, content, target }) => {
        try {
            const data = await agentApi('/api/socialV2/memory-remove', {
                method: 'POST',
                body: JSON.stringify({ key, category, content: content || '', target: target || '' }),
                headers: { 'x-agent-token': token }
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `记忆删除失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_memory_clear；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqMemoryClear(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_memory_clear', '清空轻量记忆：不传 category 清空全部；传 activeTopic/pendingThought/memberImpression 只清空对应类别。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).optional().describe('要清空的类别，缺省清空全部')
    }, async ({ key, token, category }) => {
        try {
            const data = await agentApi('/api/socialV2/memory-clear', {
                method: 'POST',
                body: JSON.stringify({ key, category: category || '' }),
                headers: { 'x-agent-token': token }
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `记忆清空失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_slang_query；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSlangQuery(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_slang_query', '查看当前已确认的群聊黑话/梗/网络表达（只读）。返回已确认词条列表和格式化黑话表；遇到不熟悉的词可先查这里，再决定是否搜索/使用。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().min(1).describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        q: z.string().optional().describe('可选搜索词，按词条/含义/用法/示例过滤')
    }, async ({ key, token, q }) => {
        try {
            const query = q ? `&q=${encodeURIComponent(String(q))}` : '';
            const data = await agentApi(`/api/socialV2/slang/query?key=${encodeURIComponent(key)}${query}`, { headers: { 'x-agent-token': token } });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `查询黑话失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
/** 注册qq_slang_submit；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqSlangSubmit(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_slang_submit', '把你在群里经常看到但不确定含义/用法的陌生词、黑话、梗或网络表达提交给管理员筛选。提交后进入候选库，管理员确认后会被写入黑话提示词，成为你后续可查询和使用的记忆。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
        content: z.string().describe('要提交的陌生词/黑话/梗（最多 50 字）'),
        context: z.string().optional().describe('可选：你是在什么语境/哪条消息里看到的，帮助管理员判断')
    }, async ({ key, token, content, context }) => {
        try {
            const data = await agentApi('/api/socialV2/slang/submit', {
                method: 'POST',
                body: JSON.stringify({ key, content, context: context || '' }),
                headers: { 'x-agent-token': token }
            });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `提交黑话失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
