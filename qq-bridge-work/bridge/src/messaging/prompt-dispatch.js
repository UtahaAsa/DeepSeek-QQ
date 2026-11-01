// Generated from messaging/prompt-dispatch.ts. Edit the TypeScript source and run build:typed.
/**
 * 执行一次prompt投递，队列由独立模块负责；每次await后继续核对当前权限与会话。
 * @param {object} deps 实时依赖视图；getter避免模式、代次、配置在异步期间变成旧快照。
 * @returns {object|function} 所属实例的操作；错误语义与原调用方保持一致。
 * @note 不启动服务、不安装依赖。
 */
export function createPromptDispatcher(deps) {
    // 实际的 DSH prompt 投递（不再直接对外暴露，统一走 promptQueues 串行队列）。
    async function deliverPromptNow(key, promptText, opts = {}) {
        const checkNativePolicy = () => {
            if (opts.offlineCurrent && !opts.offlineCurrent())
                throw new Error('OFFLINE_QUEUE_INVALIDATED');
            if (deps.nativeBinding && (!deps.nativePolicyCurrent || opts.nativeGeneration !== deps.nativePolicyGeneration))
                throw new Error('NATIVE_POLICY_CHANGED');
            if (opts.nativeObservationIdentity && !(0, deps.nativeObservationCurrent)(key, opts.nativeObservationIdentity))
                throw new Error('NATIVE_OBSERVATION_UNCONFIRMED');
        };
        checkNativePolicy();
        if (!(0, deps.isSessionAllowedInCurrentMode)(key))
            throw new Error(`当前模式不允许会话 ${key}`);
        // Recheck queued wakes at dispatch time: no model call while paused/disabled
        // and no reserved2 prompt leaking into an ordinary chat after a mode switch.
        const wakeBlocked = () => opts.wakeReason && (deps.currentMode !== 'reserved2' || deps.socialV2.paused || deps.cfg.socialV2?.enabled === false);
        const skipWake = () => {
            deps.pendingWakeKeys.delete(key);
            (0, deps.disarmPendingWakeLease)(key);
            return { ok: true, skipped: true };
        };
        if (wakeBlocked())
            return skipWake();
        if (!deps.dshReady) {
            if (opts.nativeObservationIdentity)
                return { ok: false, error: 'NATIVE_OBSERVATION_UNCONFIRMED' };
            deps.offlineQueue.enqueue(key, promptText, { farewell: !!opts.farewell, silent: !!opts.silent, media: opts.media ?? [], wakeReason: opts.wakeReason });
            return { ok: true, queued: true };
        }
        let sessionId;
        const previousSessionId = deps.state.sessions[key];
        try {
            (0, deps.traceNativeReceive)('session_begin');
            sessionId = await (0, deps.ensureSession)(key);
            (0, deps.traceNativeReceive)('session_end');
        }
        catch (error) {
            if (String(error?.message ?? error).includes('会话创建期间已重置')) {
                checkNativePolicy();
                (0, deps.enqueueForRetry)(key, promptText, opts);
                return { ok: true, retried: true };
            }
            throw error;
        }
        if (deps.nativeBinding && !deps.nativeTurnFence.has(sessionId)) {
            let baseline = -1;
            if (sessionId === previousSessionId) {
                await (0, deps.stopBridgeSessionWork)(sessionId, 'native-baseline');
                baseline = await (0, deps.readNativeTurnBaseline)(deps.api, sessionId);
            }
            checkNativePolicy();
            deps.nativeTurnFence.open(sessionId, baseline);
        }
        checkNativePolicy();
        let wakeState;
        let wakeToken;
        let wakeSnapshot;
        let wakeInputSeq = 0;
        if (opts.wakeReason) {
            if (wakeBlocked())
                return skipWake();
            // Build only after session creation: retries may rotate the token, and an
            // offline queue may have received more messages since this wake was queued.
            wakeState = (0, deps.getSocialV2State)(key);
            wakeToken = wakeState.agentToken;
            wakeInputSeq = Number.isSafeInteger(wakeState.lastUnreadSeq) ? wakeState.lastUnreadSeq : 0;
            promptText = (0, deps.buildWakePromptV2)(key, opts.wakeReason);
            wakeSnapshot = (0, deps.buildWakeSnapshotV2)(key);
            if (wakeSnapshot) {
                promptText += `\n\n【本次消息快照】\n${JSON.stringify(wakeSnapshot)}\n以上消息已提供，无需重复查询；partial=true 时用 qq_get_unread_messages(afterSeq=readThroughSeq) 继续读取。先处理当前消息；回复前如需确认后续补充，用 qq_wait_for_messages(purpose="reply") 补足短静默，已安静够久会立即返回，不要先长等。收尾只确认你已处理的 readThroughSeq（本地 seq，非 QQ messageId），传给 qq_mark_read 或 qq_set_wake_config 的 throughSeq；新到消息留待处理。`;
            }
        }
        let content = [{ type: 'text', text: (0, deps.withSlangContext)(promptText) }];
        if (Array.isArray(opts.media) && opts.media.length > 0) {
            const imageParts = await (0, deps.resolveMediaList)(opts.media);
            content = [{ type: 'text', text: (0, deps.withSlangContext)(promptText) }, ...imageParts];
        }
        if (deps.nativeBinding) {
            content[0].text += (0, deps.buildNativeFeatureHints)(key);
            if (deps.currentMode === 'reserved2')
                content[0].text += (0, deps.nativeChatHint)(key.split(':')[0], deps.nativeCapabilities)
                    .replace('普通聊天的回复由桥接自动发送，无需另调用发送工具。', '本模式通过发送工具发言；图片、语音标记可放入qq_send_message或qq_send_native_message的正文。');
        }
        checkNativePolicy();
        // 媒体解析成功后再标记退场，避免解析异常时残留退场标记。
        if (!(0, deps.isCurrentSession)(key, sessionId))
            throw new Error('投递前会话已重置或权限已变化');
        if (opts.farewell)
            deps.social.exitingSessions.add(sessionId);
        let accepted;
        try {
            (0, deps.traceNativeReceive)('prompt_begin');
            accepted = await deps.api.sessions.prompt({ sessionId, mode: 'queue', content });
            (0, deps.traceNativeReceive)('prompt_end');
            checkNativePolicy();
        }
        catch (error) {
            if (opts.farewell)
                deps.social.exitingSessions.delete(sessionId);
            throw error;
        }
        if (!accepted.result.ok) {
            if (opts.farewell)
                deps.social.exitingSessions.delete(sessionId);
            const errText = `${accepted.result.error.code}: ${accepted.result.error.message}`;
            const safeErrText = (0, deps.shouldAuditKey)(key) && deps.SENSITIVE_RE.test(errText) ? '（含敏感信息，已隐藏）' : errText;
            if (!opts.silent)
                await (0, deps.sendToQQ)(key, `⚠️ 消息未被接受：${safeErrText}`);
            return { ok: false, error: safeErrText };
        }
        if (wakeState && (0, deps.isCurrentSession)(key, sessionId)
            && deps.socialV2.conversations.get((0, deps.canonicalV2Key)(key)) === wakeState
            && wakeState.agentToken === wakeToken) {
            // Acceptance grants visibility, never acknowledgement. New arrivals and
            // rejected/stale deliveries must not be cleared by an old cursor.
            // 输入触发已交给本轮，不等于消息正文全部可确认已读；只记提交前捕获的输入序号。
            wakeState.lastWakeInputSeq = Math.max(wakeState.lastWakeInputSeq || 0, wakeInputSeq);
            if (wakeSnapshot)
                (0, deps.noteModelMessagesV2)(wakeState, [...wakeSnapshot.messages, ...wakeSnapshot.recent]);
        }
        if (accepted.result.value.command?.text && !opts.silent && deps.currentMode !== 'reserved2') {
            if (opts.farewell)
                deps.social.exitingSessions.delete(sessionId);
            await (0, deps.auditAndSend)(key, (0, deps.mdToPlain)(accepted.result.value.command.text));
        }
        else if (accepted.result.value.command?.text && opts.silent && opts.farewell) {
            deps.social.exitingSessions.delete(sessionId);
        }
        return { ok: true, command: Boolean(accepted.result.value.command) };
    }
    return deliverPromptNow;
}
