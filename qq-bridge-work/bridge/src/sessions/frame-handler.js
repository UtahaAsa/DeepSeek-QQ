// Generated from sessions/frame-handler.ts. Edit the TypeScript source and run build:typed.
/**
 * 区分历史快照、实时事件与提问审批；先记账，再核对会话和原生轮次权限。
 * @param {object} deps 实例依赖；动态配置、权限、会话状态通过getter实时读取。
 * @returns {object} 功能操作；异步错误沿原调用边界传播，调用方负责记录或响应。
 */
export function createSessionFrameHandler(deps) {
    async function handleSessionFrame(envelope) {
        // DSH流只解释外层类别；本投影保留旧消费假设，不声称验证了全部业务字段。
        const frame = envelope.payload;
        // 会话开场快照：只喂 token 账本。它含**历史** turn/end，绝不能让它们走
        // session/event 通道 —— 否则桥接会把早已结束的回合当成新回合去发 QQ 回复。
        if (frame.type === 'session/snapshot') {
            (0, deps.recordSessionSnapshot)(frame.sessionId, frame.snapshot);
            return;
        }
        if (frame.type === 'session/event') {
            // Token 记账放在最前面：无论会话是否仍属当前模式/是否学习会话，
            // 花掉的钱都是真的，都必须入账（归属由 resolveKey 决定）。
            (0, deps.recordSessionUsage)(frame.sessionId, frame.event);
            if (deps.nativePhoneModel?.handleEvent(frame.sessionId, frame.event))
                return;
            if (deps.idleDraftRunner?.handleEvent(frame.sessionId, frame.event))
                return;
            const key = deps.reverse.get(frame.sessionId);
            if (!key) {
                // 黑话学习会话：只收集 turn，不发送 QQ，并唤醒等待中的学习任务。
                if (deps.learnerSessions.has(frame.sessionId)) {
                    // 与主 collector 同样的道理（issue #26 的补充）：**只有 turn/start 才建** collector。
                    // 迟到事件（session/end-seed、session/title、model/selection…）不会有 turn/end，
                    // 若在这里顺手建一个，它会永远留在 learnerCollectors 里并吞掉后续 turn 事件，
                    // 等待者要么拿不到结果、要么拿到错位的文本。
                    let learnerCollector = deps.learnerCollectors.get(frame.sessionId) ?? null;
                    if (!learnerCollector && frame.event.type === 'turn/start') {
                        learnerCollector = (0, deps.createTurnCollector)();
                        deps.learnerCollectors.set(frame.sessionId, learnerCollector);
                    }
                    const learnerEnded = learnerCollector ? learnerCollector.push(frame.event) : null;
                    if (learnerEnded) {
                        deps.learnerCollectors.delete(frame.sessionId);
                        const waiters = deps.learnerWaiters.get(frame.sessionId) ?? [];
                        const waiter = waiters.shift();
                        if (waiters.length === 0)
                            deps.learnerWaiters.delete(frame.sessionId);
                        if (waiter) {
                            clearTimeout(waiter.timer);
                            if (learnerEnded.reason.kind === 'completed' && learnerEnded.text.trim()) {
                                waiter.resolve(learnerEnded.text);
                            }
                            else {
                                waiter.reject(new Error(`学习会话 turn 未正常完成：${learnerEnded.reason.kind}`));
                            }
                        }
                        // 旧学习会话 turn 结束后从集合移除，避免残留
                        if (frame.sessionId !== deps.slangLearnerSessionId)
                            deps.learnerSessions.delete(frame.sessionId);
                    }
                }
                return;
            }
            // 追踪当前 turn 是否成功调用过 MCP 发送类工具：
            if (!(0, deps.isCurrentSession)(key, frame.sessionId))
                return;
            if (deps.nativeBinding && !deps.nativeTurnFence.accept(frame.sessionId, frame.event))
                return;
            // 只有“发送成功”才跳过自动转发；如果工具调用失败，仍允许 AI 的文本正常发出。
            if (frame.event.type === 'turn/start') {
                if (deps.nativeBinding)
                    deps.nativeTrackedTurns.set(frame.sessionId, { turn: frame.event.data.turn, startSeq: frame.event.seq, generation: deps.nativePolicyGeneration });
                deps.sendToolSucceededSessions.delete(frame.sessionId);
                deps.pendingSendToolCalls.delete(frame.sessionId);
                deps.v2TurnStartAt.set(frame.sessionId, Date.now());
                deps.turnLeaseNoted.delete(frame.sessionId);
            }
            if (frame.event.type === 'tool/call') {
                const toolName = String(frame.event.data?.name ?? '');
                const callId = frame.event.data?.callId;
                const args = (0, deps.sanitizeToolArgs)(frame.event.data?.arguments ?? frame.event.data?.input ?? frame.event.data);
                (0, deps.appendToolLog)({ type: 'call', time: new Date().toISOString(), key, sessionId: frame.sessionId, tool: toolName, args });
                if (callId != null) {
                    if ((0, deps.isSendToolName)(toolName)) {
                        let pending = deps.pendingSendToolCalls.get(frame.sessionId);
                        if (!pending) {
                            pending = new Set();
                            deps.pendingSendToolCalls.set(frame.sessionId, pending);
                        }
                        pending.add(callId);
                    }
                    let nameMap = deps.toolCallNames.get(frame.sessionId);
                    if (!nameMap) {
                        nameMap = new Map();
                        deps.toolCallNames.set(frame.sessionId, nameMap);
                    }
                    nameMap.set(String(callId), toolName);
                }
            }
            if (frame.event.type === 'tool/result') {
                const callId = frame.event.data?.message?.source?.callId ?? frame.event.data?.message?.toolCallId;
                const toolName = callId != null ? (deps.toolCallNames.get(frame.sessionId)?.get(String(callId)) ?? '') : '';
                const resultBlock = frame.event.data?.message?.content?.[0];
                const resultError = frame.event.data?.message?.isError === true || resultBlock?.isError === true;
                const errorText = resultError ? String(resultBlock?.text ?? resultBlock?.error ?? frame.event.data?.message?.error ?? '') : '';
                (0, deps.appendToolLog)({
                    type: 'result',
                    time: new Date().toISOString(),
                    key,
                    sessionId: frame.sessionId,
                    tool: toolName,
                    ok: !resultError,
                    error: errorText ? (0, deps.sanitizeToolArgs)(errorText) : null
                });
                if (callId != null) {
                    deps.toolCallNames.get(frame.sessionId)?.delete(String(callId));
                    const pending = deps.pendingSendToolCalls.get(frame.sessionId);
                    if (pending?.has(callId)) {
                        pending.delete(callId);
                        if (pending.size === 0)
                            deps.pendingSendToolCalls.delete(frame.sessionId);
                        if (!resultError) {
                            deps.sendToolSucceededSessions.add(frame.sessionId);
                        }
                    }
                }
            }
            // collector 生命周期见 trackTurnEvent()：只为 turn/start 建、空壳 turn/end 即清。
            const { ended } = (0, deps.trackTurnEvent)(frame.sessionId, frame.event);
            if (deps.nativeBinding && deps.currentMode === 'reserved2' && frame.event.type === 'turn/end'
                && frame.event.data?.reason?.kind === 'aborted') {
                // 已通过原生围栏的seq/turn检查，并在此确认turn/end及aborted类别。
                (0, deps.settleNativeTerminal)(key, frame.sessionId, frame.event);
                return;
            }
            if (ended) {
                await (0, deps.finishSessionTurn)(key, frame, ended);
            }
        }
        else if ((frame.type === 'question/requested' || frame.type === 'approval/requested') && deps.learnerSessions.has(frame.sessionId)) {
            // 黑话学习会话不应向用户提问/请求审批；自动跳过，避免阻塞学习任务。
            try {
                if (frame.type === 'question/requested') {
                    await deps.api.respond({
                        clientId: frame.clientId,
                        eventId: frame.eventId,
                        outcome: { kind: 'result', value: { answers: frame.questions.map((q) => ({ id: q.id, selected: [], custom: '' })) } }
                    });
                }
                else {
                    await deps.api.respond({
                        clientId: frame.clientId,
                        eventId: frame.eventId,
                        outcome: { kind: 'result', value: 'rejected' }
                    });
                }
                (0, deps.log)('黑话学习会话自动跳过提问/审批');
            }
            catch (error) {
                (0, deps.log)('自动响应学习会话提问/审批失败:', error?.message ?? error);
            }
        }
        else if (frame.type === 'question/requested') {
            if (deps.nativeBinding && (!deps.nativePolicyCurrent || deps.nativePolicyGeneration > 0 || !deps.nativeTurnFence.hasOpenTurn(frame.sessionId))) {
                await (0, deps.cancelPendingEntry)({ ...frame, kind: 'question' });
                return;
            }
            const key = deps.reverse.get(frame.sessionId);
            if (!key)
                return;
            if (!(0, deps.isCurrentSession)(key, frame.sessionId)) {
                await (0, deps.cancelPendingEntry)({ ...frame, kind: 'question' });
                return;
            }
            const lines = frame.questions.map((q, i) => {
                const qText = String(q.question ?? '');
                const sensitive = (0, deps.shouldAuditKey)(key) && deps.SENSITIVE_RE.test(qText);
                if (sensitive)
                    (0, deps.log)(`⚠️ 提问文本含敏感信息，已隐藏 (${key})`);
                const safeQuestion = sensitive ? '（含敏感信息，已隐藏）' : qText;
                let s = `${i + 1}. ${safeQuestion}`;
                if (q.options?.length) {
                    const opts = q.options.map((o) => {
                        const label = String(o.label ?? '');
                        const optSensitive = (0, deps.shouldAuditKey)(key) && deps.SENSITIVE_RE.test(label);
                        if (optSensitive)
                            (0, deps.log)(`⚠️ 提问选项含敏感信息，已隐藏 (${key})`);
                        return `「${optSensitive ? '（含敏感信息，已隐藏）' : label}」`;
                    });
                    s += '\n   ' + opts.join(' ');
                }
                return s;
            });
            await (0, deps.sendToQQ)(key, '❓ agent 需要你回答：\n' + lines.join('\n') + '\n（直接回复选项文字或输入你的回答）');
            await (0, deps.registerPending)(key, { kind: 'question', rpcId: envelope.rpcId, sessionId: frame.sessionId, clientId: frame.clientId, eventId: frame.eventId, questions: frame.questions });
        }
        else if (frame.type === 'approval/requested') {
            if (deps.nativeBinding && (!deps.nativePolicyCurrent || deps.nativePolicyGeneration > 0 || !deps.nativeTurnFence.hasOpenTurn(frame.sessionId))) {
                await (0, deps.cancelPendingEntry)({ ...frame, kind: 'approval' });
                return;
            }
            const key = deps.reverse.get(frame.sessionId);
            if (!key)
                return;
            if (!(0, deps.isCurrentSession)(key, frame.sessionId)) {
                await (0, deps.cancelPendingEntry)({ ...frame, kind: 'approval' });
                return;
            }
            const rawReason = frame.reason ?? '';
            const sensitiveReason = (0, deps.shouldAuditKey)(key) && deps.SENSITIVE_RE.test(rawReason);
            if (sensitiveReason)
                (0, deps.log)(`⚠️ 审批理由含敏感信息，已隐藏 (${key})`);
            const safeReason = sensitiveReason ? '（含敏感信息，已隐藏）' : rawReason;
            const reason = safeReason ? `\n理由：${safeReason}` : '';
            const rawToolName = frame.toolName ?? '';
            const sensitiveTool = (0, deps.shouldAuditKey)(key) && deps.SENSITIVE_RE.test(rawToolName);
            if (sensitiveTool)
                (0, deps.log)(`⚠️ 审批工具名含敏感信息，已隐藏 (${key})`);
            const safeToolName = sensitiveTool ? '（含敏感信息，已隐藏）' : rawToolName;
            await (0, deps.sendToQQ)(key, `🔐 agent 请求审批：${safeToolName}${reason}\n回复「通过」或「拒绝」`);
            await (0, deps.registerPending)(key, { kind: 'approval', rpcId: envelope.rpcId, sessionId: frame.sessionId, clientId: frame.clientId, eventId: frame.eventId, toolName: frame.toolName });
        }
        else if (frame.type === 'stream/error') {
            (0, deps.log)('事件流错误:', frame.error);
        }
    }
    return { handleSessionFrame };
}
