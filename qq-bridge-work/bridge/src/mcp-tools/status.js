// Generated from mcp-tools/status.ts. Edit the TypeScript source and run build:typed.
/** 注册qq_status；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqStatus(deps) {
    const { agentApi, serializeModelData, server } = deps;
    server.tool('qq_status', '查询 QQ 机器人登录状态与账号信息（只读）。', {}, async () => {
        try {
            const body = await agentApi('/api/status');
            if (body?.qq?.available !== true)
                throw new Error('QQ_STATUS_UNAVAILABLE');
            return { content: [{ type: 'text', text: serializeModelData(body.qq) }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: '查询失败：QQ_STATUS_UNAVAILABLE；桥接或账号状态当前不可用，请由本机操作者检查服务状态。' }], isError: true };
        }
    });
}
/** 注册qq_get_native_capabilities；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetNativeCapabilities(deps) {
    const { agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    server.tool('qq_get_native_capabilities', '查看当前QQ功能勾选和本轮可用资格，所有原生聊天模式共用。需要绘图、群管理、修改自身资料或发说说但没有资格时先查询；仅返回已授权目标的资格。所有模式须传featureToken功能会话令牌。封闭智能体可指定已授权且本次实际观察到的目标；不能扩展范围。不要复述资格或令牌。', { key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/), featureToken: nativeFeatureTokenSchema, token: z.string().optional() }, async ({ key, token, featureToken }) => {
        try {
            const data = await agentApi('/api/native/features?' + new URLSearchParams({ key }), { headers: nativeFeatureHeaders(featureToken, token) });
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch {
            return { content: [{ type: 'text', text: 'NATIVE_FEATURE_UNAVAILABLE：当前功能资格不可用，请检查本机勾选、连接与会话。' }], isError: true };
        }
    });
}
