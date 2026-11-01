// Generated from libraries/sticker-actions.ts. Edit the TypeScript source and run build:typed.
/** @param deps 所属库、权限、传输和媒体能力；构造无IO。@returns 发送、认知、备注和收藏操作，未知写入结果不自动重试。 */
export function createStickerActions(deps) {
    async function sendStickerV2(key, stickerRef, options = {}) {
        const assertSendAllowed = (0, deps.captureSendGuard)(key);
        // 发送前强制同步一次，确保“刚新增的表情能立即用、刚删除的表情不会继续发”。
        const synced = await (0, deps.syncStickerLibrary)(true);
        const entry = (0, deps.findSticker)(synced?.entries ?? deps.state.entries, stickerRef);
        if (!entry)
            throw new Error(`找不到表情 ${stickerRef}，请先用 qq_list_stickers 获取有效 id`);
        const url = entry.url;
        if (!url)
            throw new Error(`表情 ${entry.id} 没有可发送的图片地址`);
        const [kind, id] = key.split(':');
        const segments = [];
        const replyToMessageId = options.replyToMessageId;
        const atUserId = options.atUserId;
        // 仿真常识：一条消息只能是一张表情，不能在同一气泡里附带文字说明。
        // 想说的话请用 qq_send_message / qq_reply 作为单独气泡发送。
        if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '') {
            const rid = String(replyToMessageId).trim();
            if (!/^-?[1-9]\d*$/.test(rid))
                throw new Error('replyToMessageId 必须是非零整数（消息 id 可能为负数）');
            segments.push({ type: 'reply', data: { id: rid } });
        }
        if (atUserId !== undefined && atUserId !== null && String(atUserId).trim() !== '') {
            const at = String(atUserId).trim();
            if (!/^\d+$/.test(at))
                throw new Error('atUserId 必须是正整数 QQ 号，且不能为 all');
            segments.push({ type: 'at', data: { qq: at } });
        }
        // 在桥接内完成带 DNS 固定、逐跳校验和大小限制的下载；不能把 URL 交给网关重新抓取。
        let image;
        try {
            image = await (0, deps.safeFetchBuffer)(url, deps.MAX_MEDIA_BYTES);
        }
        catch (error) {
            throw new Error(`表情 ${entry.id} 的图片下载失败（QQ CDN 网络异常或地址已失效）：${error?.message ?? error}`);
        }
        segments.push({ type: 'image', data: { file: 'base64://' + image.buffer.toString('base64') } });
        const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
        const params = kind === 'private' ? { user_id: Number(id), message: segments } : { group_id: Number(id), message: segments };
        const httpUrl = String(deps.cfg.onebot?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
        // 与文本发送共用发送队列，保证“先文字后表情”的真人顺序不被并发工具调用打乱。
        let sendResolve;
        let sendReject;
        const sendResult = new Promise((resolve, reject) => {
            sendResolve = resolve;
            sendReject = reject;
        });
        deps.sendQueue.append(async () => {
            try {
                // 真人发表情前通常会有短暂停顿，避免“文字刚发完表情立刻跟上”的机械感。
                await (0, deps.sleep)((0, deps.randInt)(800, 2000));
                assertSendAllowed();
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
                sendResolve(body.data);
            }
            catch (error) {
                sendReject(error);
            }
        }).recover(error => { sendReject(error); });
        const data = await sendResult;
        // 更新本地使用统计
        const updated = (0, deps.markStickerUsed)(deps.state.entries, entry.id, 'sticker');
        deps.state.entries = updated.entries;
        (0, deps.saveStickerStoreSafe)();
        return { entry: updated.entry, messageId: data?.message_id ?? null };
    }
    function applyStickerNoteV2(stickerId, note, tags, usage) {
        const patch = {};
        if (note !== undefined && note !== null)
            patch.note = String(note);
        if (tags !== undefined && tags !== null)
            patch.tags = Array.isArray(tags) ? tags.map(String) : String(tags).split(/[,，\s]+/);
        if (usage !== undefined && usage !== null)
            patch.usage = String(usage);
        const updated = (0, deps.applyStickerNote)(deps.state.entries, stickerId, patch);
        if (!updated.entry)
            return null;
        deps.state.entries = updated.entries;
        (0, deps.saveStickerStoreSafe)();
        return updated.entry;
    }
    async function setStickerRemarkV2(stickerId, remark) {
        const synced = await (0, deps.syncStickerLibrary)(false);
        const entry = (0, deps.findSticker)(synced?.entries ?? deps.state.entries, stickerId);
        if (!entry)
            throw new Error(`找不到表情 ${stickerId}，请先用 qq_list_stickers 获取有效 id`);
        const cleanRemark = String(remark ?? '').trim().slice(0, 50);
        const response = await deps.bot.request('modify_custom_face', { emoji_id: entry.id, desc: cleanRemark });
        if (!response || response.status !== 'ok' || response.retcode !== 0) {
            throw new Error(`modify_custom_face 失败: ${response?.wording || response?.retcode || 'unknown'}`);
        }
        const updated = (0, deps.applyStickerNote)(deps.state.entries, entry.id, {});
        // 直接改 desc（保留本地认知）
        const idx = (updated.entries || []).findIndex((e) => e.id === entry.id);
        if (idx >= 0) {
            updated.entries[idx] = { ...updated.entries[idx], desc: cleanRemark, updatedAt: new deps.Date().toISOString() };
        }
        deps.state.entries = updated.entries;
        (0, deps.saveStickerStoreSafe)();
        return deps.state.entries.find((e) => e.id === entry.id) || null;
    }
    async function collectStickerV2(key, messageRef, remark) {
        const assertSendAllowed = (0, deps.captureSendGuard)(key);
        const st = (0, deps.getSocialV2State)(key);
        const found = (st.recentMessages || []).find((m) => m && (String(m.seq) === String(messageRef) || (m.messageId && String(m.messageId) === String(messageRef))));
        if (!found)
            throw new Error('找不到这条消息，请确认 messageId/seq 有效且属于当前会话');
        if (found.isSelf)
            throw new Error('不能收藏自己发的表情，只能收藏群友发的');
        const mediaList = Array.isArray(found.media) ? found.media : [];
        if (!mediaList.length)
            throw new Error('这条消息没有可收藏的图片/表情');
        const media = mediaList[0];
        let file = '';
        if (media?.kind === 'image') {
            // 优先取图片字节转 base64，避免 OneBot兼容通道 直接下载聊天图片 URL 失败（带签名/防盗链）。
            // 严禁把消息里的原始 media.url / media.file 直接交给 OneBot 去下载：那会绕过 SSRF/本地文件防护。
            const img = await (0, deps.fetchOneBotImage)(media);
            if (img?.buffer) {
                file = 'base64://' + img.buffer.toString('base64');
            }
            else {
                throw new Error('无法安全获取该图片字节，已拒绝收藏');
            }
        }
        else if (media?.kind === 'face') {
            const face = await (0, deps.fetchFaceMedia)(media);
            if (face?.buffer)
                file = 'base64://' + face.buffer.toString('base64');
        }
        if (!file)
            throw new Error('无法获取该表情的图片源');
        assertSendAllowed();
        const addRes = await deps.bot.request('add_custom_face', { file });
        if (!addRes || addRes.status !== 'ok' || addRes.retcode !== 0) {
            throw new Error(`add_custom_face 失败: ${addRes?.wording || addRes?.retcode || 'unknown'}`);
        }
        const emojiId = String(addRes.data?.emoji_id || '');
        if (!emojiId)
            throw new Error('add_custom_face 未返回 emoji_id');
        const maxRemarkChars = Math.max(1, Number(deps.cfg.socialV2?.sticker?.collect?.maxRemarkChars) || 20);
        const cleanRemark = String(remark ?? '').trim().slice(0, maxRemarkChars);
        if (cleanRemark) {
            assertSendAllowed();
            const modRes = await deps.bot.request('modify_custom_face', { emoji_id: emojiId, desc: cleanRemark });
            if (!modRes || modRes.status !== 'ok' || modRes.retcode !== 0) {
                (0, deps.log)(`[sticker] 收藏成功但备注失败 ${emojiId}: ${modRes?.wording || modRes?.retcode || 'unknown'}`);
            }
        }
        // 强制刷新本地库，让刚收藏的表情立即可用。
        const synced = await (0, deps.syncStickerLibrary)(true);
        const entry = (0, deps.findSticker)(synced?.entries ?? deps.state.entries, emojiId);
        return { emojiId, entry: entry || null, remark: cleanRemark };
    }
    return { sendStickerV2, applyStickerNoteV2, setStickerRemarkV2, collectStickerV2 };
}
