// Generated from mcp-tools/profile.ts. Edit the TypeScript source and run build:typed.
/** 注册qq_get_avatar；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetAvatar(deps) {
    const { QQ_AVATAR_MAX_BASE64_CHARS, agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    server.tool('qq_get_avatar', '按需查看当前授权会话中已发言成员的QQ头像（只读）。不枚举成员，不保证动态头像；必须收到本工具图片后才能描述。所有原生聊天模式均可用，需本机允许收图及当前会话资格。', {
        key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/).describe('提示中的当前会话标识'),
        userId: z.string().regex(/^[1-9]\d{0,19}$/).describe('当前会话实际消息中的成员QQ号，不按昵称猜测'),
        featureToken: nativeFeatureTokenSchema,
        token: z.string().optional().describe('若提示中有会话令牌则必须传入')
    }, async ({ key, userId, token, featureToken }) => {
        try {
            const body = await agentApi('/api/images/avatar', {
                method: 'POST', body: JSON.stringify({ key, userId }), timeoutMs: 25000,
                headers: nativeFeatureHeaders(featureToken, token)
            });
            if (body?.user_id !== userId || !['image/png', 'image/jpeg', 'image/webp'].includes(body.image?.mimeType) ||
                typeof body.image?.data !== 'string' || body.image.data.length > QQ_AVATAR_MAX_BASE64_CHARS)
                throw new Error();
            return {
                content: [{
                        type: 'text', text: serializeModelData({
                            user_id: body.user_id, nickname: body.nickname,
                            card: body.card, source: body.source, cacheMaxAgeSeconds: body.cacheMaxAgeSeconds
                        })
                    },
                    { type: 'image', mimeType: body.image.mimeType, data: body.image.data }]
            };
        }
        catch {
            return { content: [{ type: 'text', text: 'QQ_AVATAR_UNAVAILABLE：当前不能读取该成员头像，请勿猜测图片内容。' }], isError: true };
        }
    });
}
/** 注册qq_get_friend_status；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetFriendStatus(deps) {
    const { agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    server.tool('qq_get_friend_status', '只读查询当前聊天已实际观察成员是否为你当前账号的QQ好友。不发好友申请、不枚举好友列表；所有原生模式使用本轮featureToken。成员必须来自当前群实际消息或当前私聊本人，不能凭昵称猜号码。查询不可用不代表不是好友。', {
        key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/), userId: z.string().regex(/^[1-9]\d{0,19}$/),
        featureToken: nativeFeatureTokenSchema, token: z.string().optional()
    }, async ({ key, userId, featureToken, token }) => {
        try {
            const data = await agentApi('/api/native/friend-status?' + new URLSearchParams({ key, userId }), { headers: nativeFeatureHeaders(featureToken, token) });
            if (typeof data?.isFriend !== 'boolean' || data.requestSent !== false)
                throw new Error();
            return { content: [{ type: 'text', text: serializeModelData(data) }] };
        }
        catch {
            return { content: [{ type: 'text', text: 'NATIVE_FRIEND_STATUS_UNAVAILABLE：未能确认当前好友关系；没有发送申请，不能据此说对方不是好友。' }], isError: true };
        }
    });
}
/** 注册qq_get_self_avatar；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetSelfAvatar(deps) {
    const { QQ_AVATAR_MAX_BASE64_CHARS, agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    server.tool('qq_get_self_avatar', '按需查看当前登录QQ账号自己的头像（只读）。只传当前会话标识，不填或猜自己的号码；收到实际图片后才描述。用户要你把自身头像发给他时传forSend:true；只有同时勾选自身头像读取和发送图片/消息才返回可发送file编号，用[[qq-image:完整编号]]发送。无需开启接收图片。不会改头像或资料。所有原生聊天模式可用。', {
        key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/).describe('提示中的当前授权会话标识'),
        forSend: z.boolean().optional().describe('用户明确要接收自身头像图片时为true；只查看时省略'),
        featureToken: nativeFeatureTokenSchema,
        token: z.string().optional().describe('若提示中有会话令牌则必须传入')
    }, async ({ key, token, featureToken, forSend }) => {
        try {
            const body = await agentApi('/api/images/self-avatar', {
                method: 'POST', body: JSON.stringify({ key, ...(forSend !== undefined ? { forSend } : {}) }), timeoutMs: 45000,
                headers: nativeFeatureHeaders(featureToken, token)
            });
            if (body?.is_self !== true || !/^[1-9]\d{0,19}$/.test(body.user_id ?? '') ||
                !['image/png', 'image/jpeg', 'image/webp'].includes(body.image?.mimeType) ||
                typeof body.image?.data !== 'string' || body.image.data.length > QQ_AVATAR_MAX_BASE64_CHARS)
                throw new Error();
            if (body.sendable === true && !/^qqimg_[a-f0-9]{32}$/.test(body.file ?? ''))
                throw new Error();
            return {
                content: [{
                        type: 'text', text: serializeModelData({
                            is_self: true, user_id: body.user_id, nickname: body.nickname,
                            source: body.source, cacheMaxAgeSeconds: body.cacheMaxAgeSeconds,
                            ...(typeof body.sendable === 'boolean' ? { sendable: body.sendable } : {}),
                            ...(body.sendable === true ? { file: body.file, instruction: '图片尚未发送，可用[[qq-image:完整编号]]发送当前自身头像。' } : {})
                        })
                    },
                    { type: 'image', mimeType: body.image.mimeType, data: body.image.data }]
            };
        }
        catch {
            return { content: [{ type: 'text', text: 'QQ_SELF_AVATAR_UNAVAILABLE：当前不能读取自身头像，请勿猜测图片内容，也不要改用其他成员头像代替。' }], isError: true };
        }
    });
}
/** 注册qq_get_self_profile；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetSelfProfile(deps) {
    const { agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    server.tool('qq_get_self_profile', '只读当前登录QQ账号自己的单项资料：nickname昵称、signature签名、birthday生日；各字段须在本机勾选。使用当前会话key和featureToken，不填目标QQ号，不修改资料，不消耗修改资格。只有本次强制读回成功才报告值；生日null表示未设置，失败不能猜测。所有原生聊天模式可用。', {
        key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/), field: z.enum(['nickname', 'signature', 'birthday']),
        featureToken: nativeFeatureTokenSchema, token: z.string().optional()
    }, async ({ key, field, featureToken, token }) => {
        try {
            const body = await agentApi('/api/native/self-profile?' + new URLSearchParams({ key, field }), { headers: nativeFeatureHeaders(featureToken, token), timeoutMs: 10000 });
            if (body?.field !== field || body.submitted !== false || body.confirmed !== true || body.source !== 'forced_self_field_read')
                throw new Error();
            if (field === 'birthday') {
                const value = body.value;
                if (value !== null) {
                    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
                        || Object.keys(value).some(key => !['year', 'month', 'day'].includes(key))
                        || ![value.year, value.month, value.day].every(Number.isSafeInteger) || value.year < 1900 || value.year > 2100)
                        throw new Error();
                    const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
                    if (date.getUTCFullYear() !== value.year || date.getUTCMonth() + 1 !== value.month || date.getUTCDate() !== value.day)
                        throw new Error();
                }
            }
            else if (typeof body.value !== 'string' || body.value.length > 16384 || !body.value.isWellFormed())
                throw new Error();
            return {
                content: [{
                        type: 'text', text: serializeModelData({
                            field, value: body.value, submitted: false,
                            confirmed: true, source: body.source
                        })
                    }]
            };
        }
        catch {
            return { content: [{ type: 'text', text: 'SELF_PROFILE_READ_UNAVAILABLE：当前自身资料未能验证，没有修改资料；不要猜测值或改用其他人的资料。' }], isError: true };
        }
    });
}
/** 注册qq_prepare_self_avatar；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqPrepareSelfAvatar(deps) {
    const { agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    server.tool('qq_prepare_self_avatar', '调整当前聊天图片作为自身头像时的位置和缩放，返回512×512预览和新图片编号，不修改QQ头像。仅在自身头像修改已勾选时可用；中心为图片归一化坐标，默认居中，zoom越大取景越近。确认预览后再用qq_update_self_profile写入；无需开启发送图片，不可把头像专用句柄用于发图。', {
        key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/), file: z.string().regex(/^qqimg_[a-f0-9]{32}$/),
        crop: z.object({
            centerX: z.number().min(0).max(1).optional(), centerY: z.number().min(0).max(1).optional(),
            zoom: z.number().min(1).max(8).optional()
        }).strict().optional(),
        featureToken: nativeFeatureTokenSchema, token: z.string().optional()
    }, async ({ key, file, crop, featureToken, token }) => {
        try {
            const body = await agentApi('/api/native/self-avatar-preview', {
                method: 'POST', body: JSON.stringify({ key, file, crop: crop ?? {} }),
                timeoutMs: 15000, headers: nativeFeatureHeaders(featureToken, token)
            });
            if (!/^qqimg_[a-f0-9]{32}$/.test(body?.file ?? '') || body.submitted !== false || body.image?.mimeType !== 'image/png'
                || typeof body.image.data !== 'string' || body.image.data.length > 2800000)
                throw new Error();
            return {
                content: [{ type: 'text', text: serializeModelData({ file: body.file, crop: body.crop, submitted: false, instruction: body.instruction }) },
                    { type: 'image', mimeType: 'image/png', data: body.image.data }]
            };
        }
        catch {
            return { content: [{ type: 'text', text: 'SELF_AVATAR_PREVIEW_UNAVAILABLE：裁剪未完成，没有修改QQ头像。检查图片是否仍有效及本机头像修改开关，不要声称已换头像。' }], isError: true };
        }
    });
}
/** 注册qq_get_self_avatar_backups；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetSelfAvatarBackups(deps) {
    const { agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
    server.tool('qq_get_self_avatar_backups', '列出当前登录账号在修改头像前自动保存的头像快照编号，不修改头像。需要本机自身头像修改开关。恢复时将有效qqavatar_编号传给qq_update_self_profile的avatar字段；恢复前也会保存当时当前头像，结果backupId是这份可再次换回的备份，restoredFrom是被恢复的旧备份。每份备份只允许一次显式恢复提交，不自动重试。快照非原始上传图。', { key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/), featureToken: nativeFeatureTokenSchema, token: z.string().optional() }, async ({ key, featureToken, token }) => {
        try {
            const body = await agentApi('/api/native/self-avatar-backups?' + new URLSearchParams({ key }), { headers: nativeFeatureHeaders(featureToken, token) });
            if (!Array.isArray(body?.backups) || body.backups.length > 32 || body.backups.some(row => !/^qqavatar_[a-f0-9]{32}$/.test(row.id ?? '')
                || !Number.isSafeInteger(row.createdAt) || typeof row.restorable !== 'boolean'))
                throw new Error();
            return { content: [{ type: 'text', text: serializeModelData({ backups: body.backups }) }] };
        }
        catch {
            return { content: [{ type: 'text', text: 'SELF_AVATAR_BACKUPS_UNAVAILABLE：读取失败，备份数量未知，不能说是0份；没有修改头像，不要编造恢复编号。' }], isError: true };
        }
    });
}
/** 注册qq_post_qzone；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqPostQzone(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_post_qzone', '在所有原生模式中，仅当明确提供一次性说说发布资格时，按情境发表一段原创纯文字说说。账号和可见范围由本机操作员选择，模型不能覆盖。不要复述群聊私聊原文、成员资料、号码、凭据，不接图片路径或URL。资格一次性，失败或未知不能重试；服务端发布编号不代表空间页面已经验收。', {
        key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/), text: z.string().min(1).max(2000).describe('原创纯文字，最多1000个字符'),
        postToken: z.string().regex(/^[a-f0-9]{64}$/).describe('本轮输入的说说发布资格，不可猜测或复用')
    }, async (input) => {
        try {
            const body = await agentApi('/api/native-qzone/post', { method: 'POST', body: JSON.stringify(input), timeoutMs: 45000 });
            if (!['accepted', 'rejected'].includes(body?.outcome) || body.submitted !== true || !['self', 'friends', 'public'].includes(body.audience))
                throw new Error();
            return {
                content: [{
                        type: 'text', text: serializeModelData({
                            outcome: body.outcome, submitted: true,
                            serverReceipt: body.serverReceipt === true, audience: body.audience, ...(body.tid ? { tid: body.tid } : {}), instruction: body.instruction
                        })
                    }],
                ...(body.outcome === 'rejected' ? { isError: true } : {})
            };
        }
        catch {
            return { content: [{ type: 'text', text: 'QZONE_PUBLICATION_UNCONFIRMED：未完成或结果未知，资格已消耗，不可自动重试，不可声称已公开发布。' }], isError: true };
        }
    });
}
/** 注册qq_update_self_profile；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqUpdateSelfProfile(deps) {
    const { agentApi, serializeModelData, server, z } = deps;
    server.tool('qq_update_self_profile', '在所有原生模式中，仅当提供对应字段一次性资格时修改你自己的QQ资料。field为nickname/signature/birthday/avatar；不能传目标账号。头像用有效qqimg_句柄，可先qq_prepare_self_avatar裁剪；自动保存修改前快照。换回头像时先qq_get_self_avatar_backups，再用有效qqavatar_备份编号作为value。禁用路径/URL。每字段本轮一次，失败或未知不重试；accepted不等于QQ实际显示已更新。', {
        key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/),
        field: z.enum(['nickname', 'signature', 'birthday', 'avatar']),
        value: z.union([z.string().max(560), z.object({
                year: z.number().int().min(1900).max(2100),
                month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31)
            }).strict()]),
        profileToken: z.string().regex(/^[a-f0-9]{64}$/).describe('本轮输入中对应field的资料资格，不可猜测或复用')
    }, async (input) => {
        try {
            const body = await agentApi('/api/native-self-profile/update', { method: 'POST', body: JSON.stringify(input), timeoutMs: input.field === 'avatar' ? 35000 : 20000 });
            const notSubmitted = input.field === 'avatar' && body?.outcome === 'not_submitted' && body.submitted === false && body.confirmed === false
                && ['AVATAR_BACKUP_UNAVAILABLE', 'AVATAR_PREPARATION_UNAVAILABLE'].includes(body.reason);
            if (!(['unchanged', 'observed', 'accepted', 'rejected', 'unknown'].includes(body?.outcome) || notSubmitted)
                || body.field !== input.field || typeof body.submitted !== 'boolean' || typeof body.confirmed !== 'boolean')
                throw new Error();
            return {
                content: [{
                        type: 'text', text: serializeModelData({
                            field: body.field, outcome: body.outcome,
                            submitted: body.submitted, confirmed: body.confirmed, ...(notSubmitted ? { reason: body.reason } : {}),
                            ...(body.backupId ? { backupId: body.backupId, restoration: body.restoration === true } : {}), instruction: body.instruction
                        })
                    }],
                ...(['rejected', 'unknown', 'not_submitted'].includes(body.outcome) ? { isError: true } : {})
            };
        }
        catch {
            return { content: [{ type: 'text', text: 'SELF_PROFILE_UPDATE_UNCONFIRMED：未完成或结果未知，不可声称已经修改；对应字段资格已消耗，不要自动重试。' }], isError: true };
        }
    });
}
/** 注册qq_get_self_image；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetSelfImage(deps) {
    const { agentApi, errorText, server, z } = deps;
    server.tool('qq_get_self_image', '查看你自己的默认 Q 版形象图片（DeepSeek 小鲸鱼形象）。当你被问“你长什么样/发张自拍/你是什么形象”时，可以调用这个工具看自己的样子；返回的图片会直接进入你的视觉上下文。', {
        key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
        token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）')
    }, async ({ key, token }) => {
        try {
            const q = new URLSearchParams({ key });
            const data = await agentApi(`/api/socialV2/self-image?${q.toString()}`, { headers: { 'x-agent-token': token } });
            if (!data?.image?.data || !data?.image?.mimeType) {
                return { content: [{ type: 'text', text: `没有可返回的形象图片：${errorText(data?.error, '未知')}` }], isError: true };
            }
            return {
                content: [
                    { type: 'text', text: '这是你的默认 Q 版形象：' },
                    { type: 'image', mimeType: data.image.mimeType, data: data.image.data }
                ]
            };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `获取形象图片失败：${error?.message ?? error}` }], isError: true };
        }
    });
}
