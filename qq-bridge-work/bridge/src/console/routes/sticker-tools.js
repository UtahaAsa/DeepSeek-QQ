// Generated from console/routes/sticker-tools.ts. Edit the TypeScript source and run build:typed.
/**
 * sticker-tools功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：stickerEnabled, agentTokenOk, v2SessionAllowed, v2ToolEnabled, getStickerImageData, safeFetchBuffer, MAX_MEDIA_BYTES, getImageDimensions, MAX_MEDIA_PIXELS, mimeFromBuffer, mimeFromUrl, toModelMedia, path, ROOT, fs, applyStickerNoteV2, log, setStickerRemarkV2, currentMode, modeAllowed, cfg, shouldBlockSilentReply, getSocialV2State, resolveReplyTargetV2, sendStickerV2, truncateText, saveSocialV2State, scheduleReplyCheckV2, appendActivity, collectStickerV2, syncStickerLibrary, formatStickerList, stickerEntries, stickerSyncedAt, lastForcedAgentStickerSync。
 */
export function createStickerToolsRoutes(deps) {
    return {
        getSocialV2StickerImage: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/sticker-image',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!(0, deps.stickerEnabled)()) {
                    sendJson({ ok: false, error: '表情包体系已关闭' }, 403);
                    return;
                }
                const key = String(url.searchParams.get('key') ?? '').trim();
                const stickerId = String(url.searchParams.get('stickerId') ?? '').trim();
                if (!key || !stickerId) {
                    sendJson({ ok: false, error: 'key 和 stickerId 不能为空' }, 400);
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
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getStickerImage')) {
                    sendJson({ ok: false, error: '工具未启用：qq_get_sticker_image' }, 403);
                    return;
                }
                try {
                    const entry = await (0, deps.getStickerImageData)(stickerId);
                    const fetched = await (0, deps.safeFetchBuffer)(entry.url, deps.MAX_MEDIA_BYTES);
                    const dims = (0, deps.getImageDimensions)(fetched.buffer);
                    if (dims && dims.width * dims.height > deps.MAX_MEDIA_PIXELS) {
                        sendJson({ ok: false, error: `表情图片像素超限（${dims.width}x${dims.height}），已拒绝` }, 400);
                        return;
                    }
                    const mimeType = (0, deps.mimeFromBuffer)(fetched.buffer) || (0, deps.mimeFromUrl)(entry.url);
                    const prep = await (0, deps.toModelMedia)(fetched.buffer, mimeType, `收藏表情 ${entry.id}`);
                    if (!prep.ok) {
                        sendJson({ ok: false, error: `表情图片无法提供给模型：${prep.error}` }, 413);
                        return;
                    }
                    sendJson({
                        ok: true,
                        key,
                        sticker: {
                            id: entry.id,
                            desc: entry.desc || '',
                            localNote: entry.localNote || '',
                            tags: entry.tags || [],
                            url: entry.url,
                            md5: entry.md5
                        },
                        image: { mimeType: prep.mimeType, data: prep.buffer.toString('base64') },
                        ...(prep.note ? { note: prep.note } : {})
                    });
                }
                catch (error) {
                    sendJson({ ok: false, error: `获取表情图片失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        getSocialV2SelfImage: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/self-image',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const key = String(url.searchParams.get('key') ?? '').trim();
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
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('getSelfImage')) {
                    sendJson({ ok: false, error: '工具未启用：qq_get_self_image' }, 403);
                    return;
                }
                const selfPath = deps.path.join(deps.ROOT, 'assets', 'deepseek娘.png');
                try {
                    if (!deps.fs.existsSync(selfPath)) {
                        sendJson({ ok: false, error: '未找到 AI 形象图片 assets/deepseek娘.png' }, 404);
                        return;
                    }
                    const buf = deps.fs.readFileSync(selfPath);
                    const mimeType = (0, deps.mimeFromBuffer)(buf) || 'image/png';
                    sendJson({ ok: true, key, image: { mimeType, data: buf.toString('base64') } });
                }
                catch (error) {
                    sendJson({ ok: false, error: `读取 AI 形象图片失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        postSocialV2StickerNote: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/sticker-note',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!(0, deps.stickerEnabled)()) {
                    sendJson({ ok: false, error: '表情包体系已关闭' }, 403);
                    return;
                }
                const body = await readBody();
                const key = String(body.key ?? '').trim();
                const stickerId = String(body.stickerId ?? '').trim();
                if (!key || !stickerId) {
                    sendJson({ ok: false, error: 'key 和 stickerId 不能为空' }, 400);
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
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('stickerNote')) {
                    sendJson({ ok: false, error: '工具未启用：qq_sticker_note' }, 403);
                    return;
                }
                const note = body.note !== undefined && body.note !== null ? String(body.note).trim().slice(0, 200) : undefined;
                const tags = body.tags !== undefined && body.tags !== null ? (Array.isArray(body.tags) ? body.tags.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : []) : undefined;
                const usage = body.usage !== undefined && body.usage !== null ? String(body.usage).trim().slice(0, 200) : undefined;
                const entry = (0, deps.applyStickerNoteV2)(stickerId, note, tags, usage);
                if (!entry) {
                    sendJson({ ok: false, error: `找不到表情 ${stickerId}` }, 404);
                    return;
                }
                (0, deps.log)(`[sticker] 更新表情本地认知 ${key}: ${entry.id}`);
                sendJson({ ok: true, key, sticker: entry });
                return;
            }
        },
        postSocialV2StickerRemark: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/sticker-remark',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!(0, deps.stickerEnabled)()) {
                    sendJson({ ok: false, error: '表情包体系已关闭' }, 403);
                    return;
                }
                const body = await readBody();
                const key = String(body.key ?? '').trim();
                const stickerId = String(body.stickerId ?? '').trim();
                if (!key || !stickerId) {
                    sendJson({ ok: false, error: 'key 和 stickerId 不能为空' }, 400);
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
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('setStickerRemark')) {
                    sendJson({ ok: false, error: '工具未启用：qq_set_sticker_remark' }, 403);
                    return;
                }
                try {
                    const entry = await (0, deps.setStickerRemarkV2)(stickerId, String(body.remark ?? ''));
                    (0, deps.log)(`[sticker] 修改 QQ 收藏表情备注 ${key}: ${entry.id} -> ${entry.desc}`);
                    sendJson({ ok: true, key, sticker: entry });
                }
                catch (error) {
                    sendJson({ ok: false, error: `修改备注失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        postSocialV2SendSticker: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/send-sticker',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!(0, deps.stickerEnabled)()) {
                    sendJson({ ok: false, error: '表情包体系已关闭' }, 403);
                    return;
                }
                const body = await readBody();
                const key = String(body.key ?? '').trim();
                const stickerId = String(body.stickerId ?? '').trim();
                const caption = String(body.message ?? body.caption ?? '').trim();
                const replyToMessageId = body.replyToMessageId;
                const atUserId = body.atUserId ?? null;
                if (!key || !stickerId) {
                    sendJson({ ok: false, error: 'key 和 stickerId 不能为空' }, 400);
                    return;
                }
                // 仿真常识：表情消息只能是一张表情，不能在同一气泡里附带文字说明。
                if (caption) {
                    sendJson({ ok: false, error: '表情消息不能附带文字；请先用 qq_send_message / qq_reply 把想说的话作为单独气泡发送，再单独 qq_send_sticker 发表情' }, 400);
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
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('sendSticker')) {
                    sendJson({ ok: false, error: '工具未启用：qq_send_sticker' }, 403);
                    return;
                }
                if (deps.currentMode !== 'reserved2') {
                    sendJson({ ok: false, error: '该接口仅 reserved2 模式可用' }, 403);
                    return;
                }
                if (!req.headers['x-agent-token']) {
                    sendJson({ ok: false, error: 'reserved2 模式发送必须携带 agent token' }, 403);
                    return;
                }
                const keyMatch = /^(group|private):(\d+)$/.exec(key);
                if (!keyMatch) {
                    sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400);
                    return;
                }
                const kind = keyMatch[1];
                const id = Number(keyMatch[2]);
                if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
                    sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                    return;
                }
                if (kind === 'private' && atUserId) {
                    sendJson({ ok: false, error: '私聊不需要 @' }, 400);
                    return;
                }
                if ((0, deps.shouldBlockSilentReply)(key)) {
                    sendJson({ ok: false, error: '静默模式已开启，当前不允许发送' }, 403);
                    return;
                }
                if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '' && !/^-?[1-9]\d*$/.test(String(replyToMessageId).trim())) {
                    sendJson({ ok: false, error: 'replyToMessageId 必须是非零整数（消息 id 可能为负数）' }, 400);
                    return;
                }
                let quotedInfo = null;
                let actualReplyToMessageId = replyToMessageId;
                if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '') {
                    const stForReply = (0, deps.getSocialV2State)(key);
                    const resolved = await (0, deps.resolveReplyTargetV2)(stForReply, kind, id, String(replyToMessageId).trim());
                    if (!resolved) {
                        sendJson({ ok: false, error: '无法解析被引用消息，请确认 message id 正确且属于当前会话（可用 qq_get_message_detail 查看）' }, 400);
                        return;
                    }
                    quotedInfo = resolved.info;
                    actualReplyToMessageId = resolved.messageId;
                }
                const sendCfg = deps.cfg.socialV2?.send ?? {};
                const now = Date.now();
                try {
                    const st = (0, deps.getSocialV2State)(key);
                    const maxPerMinute = Number(sendCfg.maxSendPerMinute) || 0;
                    const maxPerHour = Number(sendCfg.maxSendPerHour) || 0;
                    const recentMinute = (st.sendTimes || []).filter((t) => now - t < 60000).length;
                    const recentHour = (st.sendTimes || []).filter((t) => now - t < 3600000).length;
                    if ((maxPerMinute > 0 && recentMinute + 1 > maxPerMinute) || (maxPerHour > 0 && recentHour + 1 > maxPerHour)) {
                        sendJson({ ok: false, error: '发送频率超限，请稍后再试' }, 429);
                        return;
                    }
                    st.sendTimes.push(now);
                    if (st.sendTimes.length > 500)
                        st.sendTimes = st.sendTimes.slice(-500);
                    const sent = await (0, deps.sendStickerV2)(key, stickerId, {
                        replyToMessageId: actualReplyToMessageId,
                        atUserId
                    });
                    // 记录到二代会话的 recentMessages，让 AI 知道自己发过这个表情
                    const label = sent.entry?.desc || sent.entry?.localNote || '表情包';
                    const text = `[表情包:${label}]`;
                    st.recentMessages.push({
                        messageId: sent.messageId ? String(sent.messageId) : null,
                        sender: '我',
                        text: (0, deps.truncateText)(text, 200),
                        plain: (0, deps.truncateText)(text, 200),
                        quoteTargetIsSelf: false,
                        isOwner: true,
                        ownerLabel: '我',
                        isSelf: true,
                        media: [],
                        hasMedia: false,
                        forwardIds: [],
                        hasForward: false,
                        sticker: { id: sent.entry?.id || stickerId, desc: sent.entry?.desc || '', localNote: sent.entry?.localNote || '' },
                        time: Date.now()
                    });
                    const recentLimit = Number(deps.cfg.socialV2?.context?.recentLimit) || 100;
                    if (st.recentMessages.length > recentLimit)
                        st.recentMessages.splice(0, st.recentMessages.length - recentLimit);
                    st.lastAiReplyAt = now;
                    st.lastActionAt = now;
                    st.wakeConfig.noActionCount = 0;
                    st.preSleepWaitSatisfiedAt = 0;
                    st.preSleepWaitObservedAt = 0;
                    st.preSleepWaitAccumMs = 0;
                    (0, deps.saveSocialV2State)();
                    (0, deps.scheduleReplyCheckV2)(key);
                    (0, deps.log)(`[sticker] 工具发送表情 ${key}: ${sent.entry?.id || stickerId}`);
                    (0, deps.appendActivity)(`${key} [sticker] 工具发送表情：${label}`);
                    sendJson({ ok: true, key, sticker: sent.entry, sent: 1, failed: 0, quoted: quotedInfo });
                }
                catch (error) {
                    const st = (0, deps.getSocialV2State)(key);
                    const idx = st.sendTimes.indexOf(now);
                    if (idx >= 0)
                        st.sendTimes.splice(idx, 1);
                    if (st.sendTimes.length > 500)
                        st.sendTimes = st.sendTimes.slice(-500);
                    (0, deps.saveSocialV2State)();
                    (0, deps.log)(`[sticker] 工具发送表情失败 ${key}: ${error?.message ?? error}`);
                    sendJson({ ok: false, error: `发送表情失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        postSocialV2CollectSticker: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/collect-sticker',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!(0, deps.stickerEnabled)()) {
                    sendJson({ ok: false, error: '表情包体系已关闭' }, 403);
                    return;
                }
                const body = await readBody();
                const key = String(body.key ?? '').trim();
                const messageRef = String(body.messageId ?? body.seq ?? '').trim();
                const remark = String(body.remark ?? '').trim();
                if (!key || !messageRef) {
                    sendJson({ ok: false, error: 'key 和 messageId/seq 不能为空' }, 400);
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
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('collectSticker')) {
                    sendJson({ ok: false, error: '工具未启用：qq_collect_sticker' }, 403);
                    return;
                }
                const keyMatch = /^(group|private):(\d+)$/.exec(key);
                if (!keyMatch) {
                    sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400);
                    return;
                }
                const st = (0, deps.getSocialV2State)(key);
                const collectCfg = deps.cfg.socialV2?.sticker?.collect ?? {};
                if (collectCfg.enabled === false) {
                    sendJson({ ok: false, error: 'AI 收藏表情功能已关闭' }, 403);
                    return;
                }
                const now = Date.now();
                const maxPerMinute = Math.max(0, Number(collectCfg.maxPerMinute) || 0);
                const maxPerHour = Math.max(0, Number(collectCfg.maxPerHour) || 0);
                const recentMinute = (st.stickerCollectTimes || []).filter((t) => now - t < 60000).length;
                const recentHour = (st.stickerCollectTimes || []).filter((t) => now - t < 3600000).length;
                if ((maxPerMinute > 0 && recentMinute + 1 > maxPerMinute) || (maxPerHour > 0 && recentHour + 1 > maxPerHour)) {
                    sendJson({ ok: false, error: '收藏表情太频繁了，请过一会儿再偷图' }, 429);
                    return;
                }
                // 先预占收藏次数，避免并发调用绕过限频；失败时回滚。
                st.stickerCollectTimes = st.stickerCollectTimes || [];
                st.stickerCollectTimes.push(now);
                if (st.stickerCollectTimes.length > 500)
                    st.stickerCollectTimes = st.stickerCollectTimes.slice(-500);
                try {
                    const result = await (0, deps.collectStickerV2)(key, messageRef, remark);
                    (0, deps.saveSocialV2State)();
                    (0, deps.log)(`[sticker] AI 收藏表情 ${key}: ${result.emojiId}${result.remark ? '（备注：' + result.remark + '）' : ''}`);
                    (0, deps.appendActivity)(`${key} [sticker] AI 收藏表情：${result.remark || result.emojiId}`);
                    sendJson({ ok: true, key, sticker: result.entry, emojiId: result.emojiId, remark: result.remark });
                }
                catch (error) {
                    const idx = st.stickerCollectTimes.indexOf(now);
                    if (idx >= 0)
                        st.stickerCollectTimes.splice(idx, 1);
                    if (st.stickerCollectTimes.length > 500)
                        st.stickerCollectTimes = st.stickerCollectTimes.slice(-500);
                    (0, deps.saveSocialV2State)();
                    (0, deps.log)(`[sticker] AI 收藏表情失败 ${key}: ${error?.message ?? error}`);
                    sendJson({ ok: false, error: `收藏表情失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        getSocialV2StickerList: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/socialV2/sticker-list',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!(0, deps.stickerEnabled)()) {
                    sendJson({ ok: false, error: '表情包体系已关闭' }, 403);
                    return;
                }
                const key = String(url.searchParams.get('key') ?? '').trim();
                const query = String(url.searchParams.get('query') ?? '').trim();
                const maxCount = Math.max(1, Number(deps.cfg.socialV2?.sticker?.maxListCount) || 100);
                const count = Math.min(500, Math.max(1, Math.min(Number(url.searchParams.get('count')) || 48, maxCount)));
                // GET 上**不再支持** refresh：强制同步是有副作用的写操作（拉 OneBot 收藏表情并落盘），
                // 挂在 GET 上会绕开「非 GET 必须 application/json + 同源 Origin」的 CSRF 防护。
                // 需要强制同步时请用同一路径的 POST，或控制台的 POST /api/stickers/sync。
                const force = false;
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
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('listStickers')) {
                    sendJson({ ok: false, error: '工具未启用：qq_list_stickers' }, 403);
                    return;
                }
                try {
                    const synced = await (0, deps.syncStickerLibrary)(force);
                    const list = (0, deps.formatStickerList)(synced?.entries ?? deps.stickerEntries, query, count);
                    sendJson({ ok: true, key, ...list, syncedAt: synced?.syncedAt ?? deps.stickerSyncedAt, fromCache: synced?.fromCache ?? false });
                }
                catch (error) {
                    sendJson({ ok: false, error: `获取表情列表失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        },
        postSocialV2StickerList: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/sticker-list',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                if (!(0, deps.stickerEnabled)()) {
                    sendJson({ ok: false, error: '表情包体系已关闭' }, 403);
                    return;
                }
                const body = await readBody();
                const key = String(body.key ?? '').trim();
                const query = String(body.query ?? '').trim();
                const maxCount = Math.max(1, Number(deps.cfg.socialV2?.sticker?.maxListCount) || 100);
                const count = Math.min(500, Math.max(1, Math.min(Number(body.count) || 48, maxCount)));
                let force = body.refresh === true;
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
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('listStickers')) {
                    sendJson({ ok: false, error: '工具未启用：qq_list_stickers' }, 403);
                    return;
                }
                // AI 强制刷新加最小间隔，避免反复调用 OneBot 表情接口造成限频/负载。
                if (req.headers['x-agent-token'] && force) {
                    const now = Date.now();
                    if (now - deps.lastForcedAgentStickerSync < 10000)
                        force = false;
                    else
                        deps.lastForcedAgentStickerSync = now;
                }
                try {
                    const synced = await (0, deps.syncStickerLibrary)(force);
                    const list = (0, deps.formatStickerList)(synced?.entries ?? deps.stickerEntries, query, count);
                    sendJson({ ok: true, key, ...list, syncedAt: synced?.syncedAt ?? deps.stickerSyncedAt, fromCache: synced?.fromCache ?? false });
                }
                catch (error) {
                    sendJson({ ok: false, error: `获取表情列表失败：${error?.message ?? error}` }, 500);
                }
                return;
            }
        }
    };
}
