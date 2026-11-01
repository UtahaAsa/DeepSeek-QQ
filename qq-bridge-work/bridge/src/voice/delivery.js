// Generated from voice/delivery.ts. Edit the TypeScript source and run build:typed.
/**
 * 协调兼容语音通道的准备、排队、回执、记账和回读，构造不触发IO。
 * @param deps 所属实例的实际发送与清理能力；发送仍复用全局消息队列。
 * @returns 操作者底层发送和模型语音入口；失败传播，音量临时产物在回执后清理。
 * @note 不重发未知结果，回读确认与发送回执分别返回；路径权限由专门解析器负责。
 */
export function createVoiceDelivery(deps) {
    async function sendVoiceV2(key, filePath, { guard = false, audit = true, audio = null, budgetScope } = {}) {
        const vc = (0, deps.voiceCfg)();
        // 捕获调用时的会话/权限代次，音频准备期间不能重新取得新会话的资格。
        const assertSendAllowed = guard ? (0, deps.captureSendGuard)(key) : null;
        // 注意：这里**不检查** vc.enabled —— 那是「AI 能不能发语音」的开关，判定放在
        // AI 路由（/api/socialV2/send-voice）与 sendVoiceForV2 里。底层只管发，
        // 否则"默认不启用"会连操作者通道（CLI / 控制台面板 / 图形界面）一起封死。
        if (audit)
            (0, deps.assertOutboundAuditOk)(key, `[语音:${deps.path.basename(filePath)}]`);
        let info;
        try {
            info = await (0, deps.inspectAudio)(filePath, { maxBytes: vc.maxBytes, maxSeconds: vc.maxSeconds });
        }
        catch (error) {
            throw new Error(`音频检查失败：${error?.message ?? error}`);
        }
        if (!info.ok)
            throw new Error(`音频不可发送：${info.error}`);
        // 音量处理（默认原样 → 不产生临时文件）
        let processed;
        try {
            processed = await (0, deps.processAudioVolume)(filePath, {
                volume: audio?.volume ?? vc.defaultVolume,
                normalize: audio?.normalize === true,
                loudness: audio?.loudness ?? vc.loudness,
                ffmpegPath: vc.ffmpegPath
            });
        }
        catch (error) {
            throw new Error(`音量处理失败：${error?.message ?? error}`);
        }
        const sendPath = processed.path;
        const [kind, id] = key.split(':');
        const recordSegment = { type: 'record', data: { file: sendPath } };
        let resolveSend;
        let rejectSend;
        const sendPromise = new Promise((resolve, reject) => { resolveSend = resolve; rejectSend = reject; });
        deps.sendQueue.append(async () => {
            try {
                if (assertSendAllowed)
                    assertSendAllowed();
                // 在同一串行发送槽内复查并记账；前置检查仅用于尽早拒绝，不能阻止并发超额。
                if (budgetScope !== undefined)
                    (0, deps.voiceBudgetCheck)(budgetScope, (0, deps.voiceCfg)());
                // 语音条比图片大、要过一次 SILK 转码，给 60s 预算（文本/图片共用同一发送队列，
                // 所以这条语音发完之前后面的文本会自然排队，不会插队到语音前面）。
                const httpUrl = String(deps.cfg.onebot?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
                const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
                const params = kind === 'private'
                    ? { user_id: Number(id), message: [recordSegment] }
                    : { group_id: Number(id), message: [recordSegment] };
                const res = await (0, deps.fetch)(`${httpUrl}/${action}`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        ...(deps.cfg.onebot?.accessToken ? { authorization: `Bearer ${deps.cfg.onebot.accessToken}` } : {})
                    },
                    body: JSON.stringify(params),
                    signal: deps.AbortSignal.timeout(60000)
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
                    const hint = res.status === 426 ? '（HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口）' : '';
                    throw new Error(`OneBot ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
                }
                if (budgetScope !== undefined)
                    (0, deps.voiceBudgetCommit)(budgetScope);
                resolveSend(body.data);
            }
            catch (error) {
                rejectSend(error);
            }
        }).recover(error => { rejectSend(error); });
        try {
            const data = await sendPromise;
            return {
                messageId: data?.message_id ?? null,
                bytes: info.size,
                duration: info.duration ?? null,
                codec: info.codec ?? '',
                warnings: info.warnings ?? [],
                detail: (0, deps.describeAudio)(info),
                // 音量处理信息：mode='original' 表示没动过（没产生临时文件）
                audioProcessing: processed.detail,
                volume: processed.volume,
                loudness: processed.loudness,
                audioMode: processed.mode
            };
        }
        finally {
            // 音量处理产物是一次性的：发完（或失败）就删，别把 temp 撑大
            (0, deps.cleanupTemp)(sendPath, processed.converted);
        }
    }
    function recordVoiceSentV2(key, sent, label) {
        const st = (0, deps.getSocialV2State)(key);
        const display = label || `[语音 ${sent.detail}]`;
        const entry = {
            messageId: sent.messageId ? String(sent.messageId) : null,
            sender: '我',
            text: (0, deps.truncateText)(display, 200),
            plain: (0, deps.truncateText)(display, 200),
            quoteTargetIsSelf: false,
            isOwner: true,
            ownerLabel: '我',
            isSelf: true,
            at: deps.Date.now()
        };
        st.recentMessages.push(entry);
        if (st.recentMessages.length > 200)
            st.recentMessages = st.recentMessages.slice(-200);
        st.lastAiReplyAt = entry.at;
        st.lastActionAt = entry.at;
        st.wakeConfig.noActionCount = 0;
        (0, deps.saveSocialV2State)();
    }
    async function verifyVoiceMessageSent(messageId) {
        if (!messageId)
            return null;
        try {
            const httpUrl = String(deps.cfg.onebot?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
            const res = await (0, deps.fetch)(`${httpUrl}/get_msg`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(deps.cfg.onebot?.accessToken ? { authorization: `Bearer ${deps.cfg.onebot.accessToken}` } : {})
                },
                body: JSON.stringify({ message_id: Number(messageId) }),
                signal: deps.AbortSignal.timeout(30000)
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.status !== 'ok' || body.retcode !== 0)
                return null;
            const segments = Array.isArray(body.data?.message) ? body.data.message : [];
            const record = segments.find((s) => s?.type === 'record');
            if (!record)
                return null;
            // 注意：只回报「确认成功 + 时长」，**不回传 file/url**。
            // 私聊消息里 get_msg 会把源文件路径塞进 url（如 D:\...\audio\xxx.mp3），
            // 回给 AI 就等于把本机路径写进模型上下文（也会被敏感信息审计拦）。
            return {
                confirmed: true,
                duration: record.data?.duration != null ? Number(record.data.duration) : null
            };
        }
        catch (error) {
            (0, deps.log)(`[voice] 发送后回读校验失败（不影响已发送）：${error?.message ?? error}`);
            return null;
        }
    }
    async function sendVoiceForV2(key, voiceRef, { label = '', verify = null, readback = false, audio = null } = {}) {
        const vc = (0, deps.voiceCfg)();
        if (!vc.enabled)
            throw new Error('语音功能已关闭（socialV2.voice.enabled=false）');
        const resolved = (0, deps.resolveVoicePathForV2)(voiceRef);
        // 音量参数校验前置（AI 传错时给出可读错误，而不是让 ffmpeg 报奇怪的错）
        if (audio)
            (0, deps.resolveAudioProcessing)({ volume: audio.volume ?? vc.defaultVolume, normalize: audio.normalize === true, loudness: audio.loudness ?? vc.loudness });
        (0, deps.voiceBudgetCheck)(key, vc);
        const receiptGuard = (0, deps.captureSendGuard)(key);
        const sent = await sendVoiceV2(key, resolved.path, { guard: true, audit: true, audio, budgetScope: key });
        // 已确认发送不能改报失败；身份失效只禁止把旧回执写入重置后的会话。
        let receiptCurrent = true;
        try {
            receiptGuard();
        }
        catch {
            receiptCurrent = false;
        }
        if (receiptCurrent)
            recordVoiceSentV2(key, sent, label);
        else
            (0, deps.log)('[voice] 会话身份已失效，保留成功回执，跳过会话记账');
        (0, deps.log)(`[voice] ${key} 已发送语音 ${deps.path.basename(resolved.path)} (${sent.detail}, messageId=${sent.messageId ?? '?'})`);
        (0, deps.appendActivity)(`${key} [voice] 发送语音 ${deps.path.basename(resolved.path)} (${sent.detail})`);
        let readbackText = null;
        const wantReadback = readback === true;
        if (wantReadback && sent.messageId) {
            try {
                const httpUrl = String(deps.cfg.onebot?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
                const res = await (0, deps.fetch)(`${httpUrl}/fetch_ptt_text`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        ...(deps.cfg.onebot?.accessToken ? { authorization: `Bearer ${deps.cfg.onebot.accessToken}` } : {})
                    },
                    body: JSON.stringify({ message_id: String(sent.messageId) }),
                    signal: deps.AbortSignal.timeout(30000)
                });
                const body = await res.json().catch(() => ({}));
                if (res.ok && body.status === 'ok' && body.retcode === 0)
                    readbackText = body.data?.text ?? '';
            }
            catch (error) {
                (0, deps.log)(`[voice] 语音转写回读失败（不影响已发送）：${error?.message ?? error}`);
            }
        }
        // 默认做「回读到 record 段」的落地校验；转写按需（自己发的语音通常没有转写）。
        const wantVerify = verify === true || (verify !== false && vc.autoReadback);
        const verification = wantVerify ? await verifyVoiceMessageSent(sent.messageId) : null;
        return { ...sent, key, file: resolved.path, via: resolved.via, verification, readback: readbackText };
    }
    return { sendVoiceV2, recordVoiceSentV2, verifyVoiceMessageSent, sendVoiceForV2 };
}
