// Generated from console/routes/history.ts. Edit the TypeScript source and run build:typed.
/**
 * history功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：agentTokenOk, v2SessionAllowed, v2ToolEnabled, getSocialV2State, readThroughSeqV2, resolveReplyInfo, currentMode, modeAllowed, cfg, seenForwardIds, bot, formatForwardResponse, log, fetchMediaData, allowed, onebotHttpAction, truncateText。
 */
export function createHistoryRoutes(deps) {
    return {
        getSocialV2MyRecent: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/my-recent',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const key = String(url.searchParams.get('key') ?? '').trim();
                const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
                if (!key) {
                    sendJson({ ok: false, error: 'key 不能为空' }, 400);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) {
                    sendJson({ ok: false, error: 'agent token 无效' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) {
                    sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getMyRecent')) {
                    sendJson({ ok: false, error: '工具未启用：qq_get_my_recent_messages' }, 403);
                    return;
                }
                const st = (0, deps.getSocialV2State)(key);
                const mine = st.recentMessages.filter((m) => m.isSelf).slice(-limit);
                sendJson({ ok: true, key, messages: mine, readThroughSeq: (0, deps.readThroughSeqV2)(st) });
                return;
            }
        },
        postSocialV2RecordSent: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/record-sent',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                // 内部接口不对外开放：防止持有会话 token 的调用方伪造“我说过…”的历史记录。
                sendJson({ ok: false, error: '该接口仅桥接内部使用，不接受外部调用' }, 403);
                return;
            }
        },
        getSocialV2MessageDetail: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/message-detail',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const key = String(url.searchParams.get('key') ?? '').trim();
                const messageId = String(url.searchParams.get('messageId') ?? '').trim();
                if (!key || !messageId) {
                    sendJson({ ok: false, error: 'key 和 messageId 不能为空' }, 400);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) {
                    sendJson({ ok: false, error: 'agent token 无效' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) {
                    sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getMessageDetail')) {
                    sendJson({ ok: false, error: '工具未启用：qq_get_message_detail' }, 403);
                    return;
                }
                const keyMatch = /^(group|private):(\d+)$/.exec(key);
                if (!keyMatch) {
                    sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400);
                    return;
                }
                const kind = keyMatch[1];
                const id = Number(keyMatch[2]);
                try {
                    const st = (0, deps.getSocialV2State)(key);
                    const found = (st.recentMessages || []).find((m) => m && (String(m.seq) === messageId || (m.messageId && String(m.messageId) === messageId)));
                    const forwardFields = found ? {
                        forwardIds: Array.isArray(found.forwardIds) ? found.forwardIds : [],
                        hasForward: !!found.hasForward
                    } : {};
                    let info = null;
                    // 如果入参命中本地 seq 且本地存有真实 messageId，优先按 seq 展示，避免与真实 id 冲突。
                    if (found && found.messageId && String(found.messageId) !== messageId) {
                        info = {
                            sender: String(found.sender || ''),
                            text: String(found.text || found.plain || '').slice(0, 200),
                            userId: found.userId ? String(found.userId) : null,
                            messageId: String(found.messageId),
                            seq: found.seq
                        };
                    }
                    else {
                        info = await (0, deps.resolveReplyInfo)(kind, id, messageId);
                        if (!info && found) {
                            info = {
                                sender: String(found.sender || ''),
                                text: String(found.text || found.plain || '').slice(0, 200),
                                userId: found.userId ? String(found.userId) : null,
                                messageId: found.messageId ? String(found.messageId) : null,
                                seq: found.seq
                            };
                        }
                    }
                    // 无论 info 来自本地还是 OneBot，只要本地有 found 就补充转发字段，避免提示词与实现不一致。
                    if (info && found)
                        Object.assign(info, forwardFields);
                    // 正文本就是 200 字符预览；显式告知截断，避免模型把预览当成全文。
                    if (info)
                        info.textTruncated = String(info.text ?? '').length >= 200;
                    sendJson({ ok: true, key, messageId, info });
                }
                catch (error) {
                    sendJson({ ok: false, error: `获取消息详情失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        getSocialV2ForwardMessage: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/forward-message',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const key = String(url.searchParams.get('key') ?? '').trim();
                const id = String(url.searchParams.get('id') ?? '').trim();
                const agentToken = String(req.headers['x-agent-token'] ?? '').trim();
                const keyMatch = /^(group|private):(\d+)$/.exec(key);
                if (!keyMatch) {
                    sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400);
                    return;
                }
                if (!id) {
                    sendJson({ ok: false, error: 'id 不能为空' }, 400);
                    return;
                }
                if (deps.currentMode !== 'reserved2') {
                    sendJson({ ok: false, error: '合并转发查看仅 reserved2 模式可用' }, 403);
                    return;
                }
                if (!agentToken) {
                    sendJson({ ok: false, error: 'reserved2 模式读取合并转发必须携带 agent token' }, 403);
                    return;
                }
                if (!(0, deps.agentTokenOk)(key, agentToken)) {
                    sendJson({ ok: false, error: 'agent token 无效' }, 403);
                    return;
                }
                const kind = keyMatch[1];
                const num = Number(keyMatch[2]);
                if (!Number.isFinite(num) || num <= 0 || !(0, deps.modeAllowed)(key, kind, num, deps.cfg, deps.currentMode)) {
                    sendJson({ ok: false, error: '当前模式不允许读取该会话' }, 403);
                    return;
                }
                if (!(0, deps.v2ToolEnabled)('getForwardMsg')) {
                    sendJson({ ok: false, error: '工具未启用：qq_get_forward_msg' }, 403);
                    return;
                }
                // 安全边界：只允许读取本会话确实收到过的 forward id，防止 AI 任意探测/跨会话读取
                const st = (0, deps.getSocialV2State)(key);
                const seenInRecent = (st?.recentMessages || []).some((m) => Array.isArray(m?.forwardIds) && m.forwardIds.includes(id));
                const seenInUnread = (st?.unread || []).some((m) => Array.isArray(m?.forwardIds) && m.forwardIds.includes(id));
                const seenInMemory = deps.seenForwardIds.get(key)?.has(id) === true;
                if (!seenInRecent && !seenInUnread && !seenInMemory) {
                    sendJson({ ok: false, error: '该转发消息 id 不在当前会话可见范围内，拒绝读取' }, 404);
                    return;
                }
                try {
                    const data = await deps.bot.raw('get_forward_msg', { id });
                    const formatted = (0, deps.formatForwardResponse)(data);
                    const remember = (fid) => {
                        if (!fid)
                            return;
                        let set = deps.seenForwardIds.get(key);
                        if (!set) {
                            set = new Set();
                            deps.seenForwardIds.set(key, set);
                        }
                        set.add(fid);
                        if (set.size > 1000) {
                            for (const old of set) {
                                set.delete(old);
                                if (set.size <= 1000)
                                    break;
                            }
                        }
                    };
                    // 把本层出现的嵌套 forward id 登记为“本会话已见过”，AI 后续可直接再次读取。
                    for (const m of formatted.messages || []) {
                        for (const fid of m.nestedForwardIds || [])
                            remember(fid);
                    }
                    // 抓取嵌套转发的前几条作为预览，让 AI 不需要二次调用也能先看到内容。
                    const nestedPreviews = [];
                    const nestedIds = [];
                    const seenNested = new Set();
                    for (const m of formatted.messages || []) {
                        for (const fid of m.nestedForwardIds || []) {
                            if (!seenNested.has(fid) && nestedIds.length < 5) {
                                seenNested.add(fid);
                                nestedIds.push(fid);
                            }
                        }
                    }
                    for (const fid of nestedIds) {
                        try {
                            const ndata = await deps.bot.raw('get_forward_msg', { id: fid });
                            const nfmt = (0, deps.formatForwardResponse)(ndata, { maxMessages: 3, maxCharsPerMessage: 120 });
                            for (const nm of nfmt.messages || []) {
                                for (const nfid of nm.nestedForwardIds || [])
                                    remember(nfid);
                            }
                            nestedPreviews.push({ id: fid, ...nfmt });
                        }
                        catch (error) {
                            (0, deps.log)(`嵌套转发预览失败 ${key} ${fid}:`, error?.message ?? error);
                            nestedPreviews.push({ id: fid, error: error?.message ?? '嵌套转发读取失败' });
                        }
                    }
                    sendJson({ ok: true, key, id, ...formatted, nestedPreviews });
                }
                catch (error) {
                    (0, deps.log)(`合并转发查询失败 ${key} ${id}: ${error?.message ?? error}`);
                    sendJson({ ok: false, error: `合并转发查询失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        postSocialV2ForwardMedia: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/forward-media',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const body = await readBody();
                const key = String(body.key ?? '').trim();
                const media = Array.isArray(body.media) ? body.media : [];
                if (!key) {
                    sendJson({ ok: false, error: 'key 不能为空' }, 400);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) {
                    sendJson({ ok: false, error: 'agent token 无效' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) {
                    sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getForwardMsg')) {
                    sendJson({ ok: false, error: '工具未启用：qq_get_forward_msg' }, 403);
                    return;
                }
                if (deps.currentMode !== 'reserved2') {
                    sendJson({ ok: false, error: '转发媒体读取仅 reserved2 模式可用' }, 403);
                    return;
                }
                if (!media.length) {
                    sendJson({ ok: true, key, media: [], images: [] });
                    return;
                }
                try {
                    const images = await (0, deps.fetchMediaData)(media);
                    sendJson({ ok: true, key, media, images });
                }
                catch (error) {
                    (0, deps.log)(`转发媒体读取失败 ${key}:`, error?.message ?? error);
                    sendJson({ ok: false, error: `转发媒体读取失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        getSocialV2ActiveMembers: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/active-members',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const key = String(url.searchParams.get('key') ?? '').trim();
                const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 10));
                if (!key) {
                    sendJson({ ok: false, error: 'key 不能为空' }, 400);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) {
                    sendJson({ ok: false, error: 'agent token 无效' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) {
                    sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getActiveMembers')) {
                    sendJson({ ok: false, error: '工具未启用：qq_get_active_members' }, 403);
                    return;
                }
                const st = (0, deps.getSocialV2State)(key);
                const map = new Map();
                for (const m of st.recentMessages) {
                    if (!m || m.isSelf)
                        continue;
                    const uid = m.userId ? String(m.userId) : '';
                    const key2 = uid || String(m.sender || '未知');
                    const cur = map.get(key2) || { sender: m.sender || key2, userId: uid || undefined, count: 0, lastTime: 0, isOwner: !!m.isOwner };
                    if (!cur.userId && uid)
                        cur.userId = uid;
                    cur.count += 1;
                    if (m.time > cur.lastTime)
                        cur.lastTime = m.time;
                    if (m.isOwner)
                        cur.isOwner = true;
                    map.set(key2, cur);
                }
                const members = [...map.values()].sort((a, b) => b.count - a.count || b.lastTime - a.lastTime).slice(0, limit);
                sendJson({ ok: true, key, members });
                return;
            }
        },
        getSocialV2GroupMembers: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/group-members',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const key = String(url.searchParams.get('key') ?? '').trim();
                const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
                if (!key) {
                    sendJson({ ok: false, error: 'key 不能为空' }, 400);
                    return;
                }
                const groupMatch = /^group:(\d+)$/.exec(key);
                if (!groupMatch) {
                    sendJson({ ok: false, error: '群成员只能按 group:群号 查询' }, 400);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) {
                    sendJson({ ok: false, error: 'agent token 无效' }, 403);
                    return;
                }
                // ⚠️ 白名单/模式判定**不能**挂在「有令牌」条件里：closed-agent 的代理调用本来就不带令牌
                // （它走的是操作者路径），只按 header 判断会让它拿任意群号去枚举成员 ——
                // 那正是旧 qq_get_group_members 明确防住的事（先 legacyReadToolAllowed 再 isAllowed）。
                //
                // 也不能直接用 v2SessionAllowed：它的 closed-agent 分支只放行 `private:<ownerQQ>`，
                // 于是「管理员在私聊里让 AI 看看某群成员」会 403 —— 那是旧工具本来支持的能力，
                // 属于这次改动不该带走的回归。所以 closed-agent 下按**同样严格的白名单**放行群读取。
                const groupMembersAllowed = deps.currentMode === 'closed-agent'
                    ? (0, deps.allowed)('group', Number(groupMatch[1]), deps.cfg)
                    : (0, deps.v2SessionAllowed)(key);
                if (!groupMembersAllowed) {
                    sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getGroupMembers')) {
                    sendJson({ ok: false, error: '工具未启用：qq_get_group_members' }, 403);
                    return;
                }
                const groupId = Number(groupMatch[1]);
                try {
                    let response;
                    try {
                        response = await deps.bot.request('get_group_member_list', { group_id: groupId });
                    }
                    catch (wsError) {
                        // 与表情库同步同一条原则：WS 挂了不代表网关挂了，读接口走 HTTP 兜底。
                        response = await (0, deps.onebotHttpAction)('get_group_member_list', { group_id: groupId });
                    }
                    const payload = response && typeof response === 'object' && response.data !== undefined ? response.data : response;
                    const raw = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : null);
                    if (!raw) {
                        sendJson({ ok: false, error: '网关返回的成员列表格式异常，已拒绝' }, 502);
                        return;
                    }
                    const members = raw.slice(0, limit).map((m) => ({
                        userId: m?.user_id != null ? String(m.user_id) : '',
                        nickname: (0, deps.truncateText)(String(m?.nickname ?? ''), 40),
                        card: (0, deps.truncateText)(String(m?.card ?? ''), 40),
                        ...(m?.role ? { role: String(m.role) } : {})
                    })).filter((m) => m.userId);
                    sendJson({ ok: true, key, count: raw.length, returned: members.length, truncated: raw.length > members.length, members });
                }
                catch (error) {
                    (0, deps.log)(`群成员查询失败 ${key}: ${error?.message ?? error}`);
                    sendJson({ ok: false, error: `获取群成员失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        }
    };
}
