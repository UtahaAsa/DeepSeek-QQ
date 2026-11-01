// Generated from console/routes/wait.ts. Edit the TypeScript source and run build:typed.
/**
 * wait功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：agentTokenOk, v2SessionAllowed, v2ToolEnabled, socialV2, getSocialV2State, readThroughSeqV2, cfg, nativeObservation, currentMode, state, nativePolicyCurrent, isCurrentSession, nativeTurnFence, cancelReplyCheckV2, clearTimeout, observationThroughSeqV2, nativePolicyGeneration, canonicalV2Key, activeWaits, ACTIVE_WAIT_LEASE_MS, suggestQuietMsV2, sleep, preSleepWaitBlockedV2, saveSocialV2State, noteModelMessagesV2, looksLikeUnfinished。
 */
export function createWaitRoutes(deps) {
    return {
        postSocialV2Wait: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/wait',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const body = await readBody();
                const key = String(body.key ?? '').trim();
                if (!key) {
                    sendJson({ ok: false, error: 'key 不能为空' }, 400);
                    return;
                }
                if (body.purpose !== undefined && !['messages', 'reply'].includes(body.purpose)) {
                    sendJson({ ok: false, error: 'purpose 必须是 messages（等后续消息）或 reply（回复前短静默）' }, 400);
                    return;
                }
                const replyWait = body.purpose === 'reply';
                if (req.headers['x-agent-token'] && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])) {
                    sendJson({ ok: false, error: 'agent token 无效' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2SessionAllowed)(key)) {
                    sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                    return;
                }
                if (req.headers['x-agent-token'] && !(0, deps.v2ToolEnabled)('waitMessages')) {
                    sendJson({ ok: false, error: '工具未启用：qq_wait_for_messages' }, 403);
                    return;
                }
                if (deps.socialV2.paused) {
                    const st = (0, deps.getSocialV2State)(key);
                    sendJson({ ok: true, key, paused: true, arrived: false, timeout: false, waitedMs: 0, newMessages: [], readThroughSeq: (0, deps.readThroughSeqV2)(st), unreadCount: st.unread.length });
                    return;
                }
                const waitCfg = deps.cfg.socialV2?.wait ?? {};
                const minNew = Math.max(1, Math.round(Number(body.minNewMessages) || 1));
                const defaultMs = Number(waitCfg.defaultMs) || 30000;
                const minMs = Math.max(100, Number(waitCfg.minMs) || 5000);
                const maxMs = Math.max(minMs, Number(waitCfg.maxMs) || 600000);
                const requestedTimeoutMs = Math.min(maxMs, Math.max(minMs, Math.round(Number(body.timeoutMs) || defaultMs)));
                const timeoutMs = deps.nativeObservation && replyWait ? Math.min(45000, requestedTimeoutMs) : requestedTimeoutMs;
                const st = (0, deps.getSocialV2State)(key);
                if (deps.nativeObservation && !replyWait && deps.currentMode === 'reserved2' && deps.cfg.socialV2?.backgroundObservation !== false) {
                    const sessionId = deps.state.sessions[key];
                    if (!req.headers['x-agent-token'] || !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'])
                        || !deps.nativePolicyCurrent || !(0, deps.isCurrentSession)(key, sessionId) || !deps.nativeTurnFence.hasOpenTurn(sessionId)) {
                        sendJson({ ok: false, error: 'NATIVE_OBSERVATION_UNCONFIRMED' }, 403);
                        return;
                    }
                    (0, deps.cancelReplyCheckV2)(key);
                    if (st.pendingWakeTimer) {
                        deps.wakeTimers.cancel(key, 'pendingWakeTimer');
                        st.pendingWakeTimer = null;
                    }
                    st.pendingWakeReasons = [];
                    const observationMs = deps.cfg.socialV2?.wake?.preSleepWaitEnabled === false ? timeoutMs
                        : Math.min(maxMs, Math.max(timeoutMs, Number(deps.cfg.socialV2?.wake?.preSleepWaitMs) || 300000));
                    const receipt = deps.nativeObservation.arm(key, {
                        baseline: (0, deps.observationThroughSeqV2)(st), latestSeq: st.lastUnreadSeq || 0,
                        lastInputAt: st.lastIncomingAt, windowMs: Math.min(600000, Math.max(100, Math.round(observationMs))),
                        quietMs: Number.isFinite(Number(waitCfg.minQuietAfterNewMs))
                            ? Math.min(120000, Math.max(0, Math.round(Number(waitCfg.minQuietAfterNewMs)))) : 3000,
                        identity: { st, token: st.agentToken, generation: deps.nativePolicyGeneration, sessionId }
                    });
                    sendJson({
                        ok: true, ...receipt, arrived: false, readThroughSeq: (0, deps.readThroughSeqV2)(st),
                        hint: '后台已接管观察。请结束本轮，不要重复等待，也不要立即调用mark_read或set_wake_config；新消息将由后台唤醒。'
                    });
                    return;
                }
                // 同一会话只允许一个长轮询等待，避免并发挂起耗尽 HTTP handler。
                // 租约按**归一后的** key 记账：`group:0123` 与 `group:123` 是同一个会话，
                // 用原始 key 会给出两个租约槽（同一会话并发多个 5~10 分钟等待、互相踩水位）。
                // 租约过期则视为残留（handler 异常退出没清干净），允许接管而不是永久 429。
                const leaseKey = (0, deps.canonicalV2Key)(key) ?? key;
                if (deps.activeWaits.has(leaseKey) && Date.now() - deps.activeWaits.get(leaseKey) < deps.ACTIVE_WAIT_LEASE_MS) {
                    sendJson({ ok: false, error: '该会话已有一个等待中的 qq_wait_for_messages，请等待它结束' }, 429);
                    return;
                }
                const leaseStamp = Date.now();
                deps.activeWaits.set(leaseKey, leaseStamp);
                // 只由「自己那一份租约」负责删除：超时接管后，旧等待结束时不能把新租约删掉。
                const finishWait = () => { if (deps.activeWaits.get(leaseKey) === leaseStamp)
                    deps.activeWaits.delete(leaseKey); };
                req.on('close', finishWait);
                // 响应关闭也兜底清租约：handler 中途抛错时由外层 catch 回一个 JSON，
                // 那条路径不会经过下面的 finishWait()，会留下 15 分钟的假 429。
                res.on('close', finishWait);
                const minQuietAfterNewMs = Number.isFinite(Number(waitCfg.minQuietAfterNewMs)) ? Math.max(0, Number(waitCfg.minQuietAfterNewMs)) : 3000;
                const suggestedQuietMs = Math.max((0, deps.suggestQuietMsV2)(st), minQuietAfterNewMs);
                const rawQuietMs = body.quietMs != null ? Number(body.quietMs) : suggestedQuietMs;
                // 从最后一条来信补足 minQuietAfterNewMs（默认3秒），防止抢话；
                // 即使 AI 传了 quietMs=0，也会被抬升到最小静默窗口。
                // 同时给 quietMs 加上限，避免被模型/群友诱导导致 HTTP handler 长时间挂起。
                const maxQuietMs = Math.max(minQuietAfterNewMs, Math.min(120000, Number(waitCfg.maxMs) || 600000));
                const quietMs = Math.min(maxQuietMs, Math.max(minQuietAfterNewMs, Math.round(rawQuietMs) || 0));
                if (st.pendingWakeTimer) {
                    deps.wakeTimers.cancel(key, 'pendingWakeTimer');
                    st.pendingWakeTimer = null;
                }
                (0, deps.cancelReplyCheckV2)(key); // AI 正在主动等待，取消回复检查定时器避免重复唤醒
                // A reply wait must also include messages received while the model
                // was reading/thinking after its snapshot, before this HTTP request.
                const requestSeq = st.lastUnreadSeq || 0;
                const baseline = replyWait && ((0, deps.v2ToolEnabled)('getUnread') || (0, deps.v2ToolEnabled)('getRecent')) ? (0, deps.readThroughSeqV2)(st) : requestSeq;
                const start = Date.now();
                let arrived = false;
                let lastNewAt = 0;
                let aborted = false;
                req.on('close', () => { aborted = true; });
                if (replyWait) {
                    const incomingAt = () => {
                        const value = Number(st.lastIncomingAt);
                        return Number.isFinite(value) && value > 0 ? Math.min(value, Date.now()) : start;
                    };
                    lastNewAt = incomingAt();
                    let observedSeq = st.lastUnreadSeq || 0;
                    // Batch delay and model reading time already count towards quiet.
                    // New arrivals restart quiet, but timeoutMs remains a hard budget.
                    while (!aborted && Date.now() - start < timeoutMs) {
                        if ((st.lastUnreadSeq || 0) !== observedSeq) {
                            observedSeq = st.lastUnreadSeq || 0;
                            lastNewAt = incomingAt();
                        }
                        const remaining = quietMs - (Date.now() - lastNewAt);
                        if (remaining <= 0)
                            break;
                        await (0, deps.sleep)(Math.max(1, Math.min(100, remaining, timeoutMs - (Date.now() - start))));
                    }
                    // A message may arrive during the final sleep, exactly at timeout.
                    // Its timestamp must still invalidate the previous quiet window.
                    lastNewAt = incomingAt();
                    arrived = (st.lastUnreadSeq || 0) > baseline;
                }
                else
                    while (Date.now() - start < timeoutMs && !aborted && deps.activeWaits.get(leaseKey) === leaseStamp) {
                        let nowSeq = st.lastUnreadSeq || 0;
                        if (nowSeq - baseline >= minNew) {
                            arrived = true;
                            lastNewAt = Date.now();
                            // 已等到新消息：继续等到“最后一条新消息之后 quietMs 内不再有新消息”再返回。
                            // 这里不再受原始 timeoutMs 限制，确保对方可能连续发消息时不会抢话。
                            while (Date.now() - lastNewAt < quietMs && Date.now() - start < timeoutMs + maxQuietMs + 5000 && !aborted && deps.activeWaits.get(leaseKey) === leaseStamp) {
                                if ((st.lastUnreadSeq || 0) > nowSeq) {
                                    nowSeq = st.lastUnreadSeq || 0;
                                    lastNewAt = Date.now();
                                }
                                await (0, deps.sleep)(200);
                            }
                            break;
                        }
                        await (0, deps.sleep)(300);
                    }
                const waitedMs = Date.now() - start;
                if (deps.socialV2.conversations.get((0, deps.canonicalV2Key)(key)) !== st ||
                    (req.headers['x-agent-token'] && (deps.currentMode !== 'reserved2' || deps.socialV2.paused || deps.cfg.socialV2?.enabled === false
                        || !(0, deps.agentTokenOk)(key, req.headers['x-agent-token']) || !(0, deps.v2SessionAllowed)(key) || !(0, deps.v2ToolEnabled)('waitMessages')))) {
                    finishWait();
                    sendJson({ ok: false, error: '等待期间会话已重置或权限已变化，请重新读取会话' }, 403);
                    return;
                }
                const preSleepWaitMs = Math.max(0, Number(deps.cfg.socialV2?.wake?.preSleepWaitMs) || 300000);
                // 闸门状态只算一次：既用于 preSleepWaitRemainingMs，也用于下面直接告诉模型"现在能不能收尾"。
                const preSleepBlocked = (0, deps.preSleepWaitBlockedV2)(st);
                const preSleepRemainingMs = preSleepBlocked
                    ? Math.max(0, preSleepWaitMs - ((st.lastIncomingAt || 0) ? Date.now() - st.lastIncomingAt : 0))
                    : 0;
                // 这次等待「算不算沉睡前观察」：闸门只认单次 timeoutMs ≥ 观察窗口的调用。
                // 实测踩过：模型用 timeoutMs=90000 等了 90 秒，以为完成了观察，结果闸门不认，
                // 只能再补一次 180 秒 —— 白花一轮。所以要在返回里把这件事说破，而不是让它自己悟。
                const preSleepCountsAsObservation = !replyWait && timeoutMs >= preSleepWaitMs;
                const quiet = (replyWait || (arrived && quietMs > 0)) && (Date.now() - lastNewAt >= quietMs);
                // 判断这次等待是否是“沉睡前观察尝试”：AI 明确请求等满观察窗口（默认 5 分钟）。
                // 只有这种尝试里等到新消息，才会把“已观察并看到新消息”标记下来，允许 AI 看过新消息后直接决定不参与并沉睡。
                const preSleepAttempt = !replyWait && timeoutMs >= preSleepWaitMs;
                // 只有“没等到新消息且总时长达到观察窗口”或“最后一条新消息之后安静满了观察窗口”才算满足沉睡前等待；
                // 不能因为总时长到了但最后一条消息才刚过 10 秒就误判满足。
                const preSleepSatisfiedNow = !replyWait && (!arrived
                    ? waitedMs >= preSleepWaitMs
                    : (quiet && (Date.now() - lastNewAt) >= preSleepWaitMs));
                if (preSleepSatisfiedNow) {
                    st.preSleepWaitSatisfiedAt = Date.now();
                    st.preSleepWaitObservedAt = 0;
                    st.preSleepWaitAccumMs = 0;
                }
                else if (!replyWait && !arrived) {
                    // 短等待不累计：必须单次等满观察窗口（或实际安静时间已足够时由 preSleepWaitBlockedV2 放行）
                    st.preSleepWaitAccumMs = 0;
                }
                else if (!replyWait) {
                    // 等待期间有新消息：
                    // - 如果这是一次 5 分钟沉睡前观察尝试，则标记“已观察”，AI 看过 newMessages 后可自行决定是否参与；
                    // - 否则只清空累计，不算完成沉睡前观察。
                    if (preSleepAttempt) {
                        st.preSleepWaitObservedAt = Date.now();
                    }
                    st.preSleepWaitAccumMs = 0;
                }
                if (!replyWait)
                    (0, deps.saveSocialV2State)();
                // Each buffer is governed by its own tool switch: the unread buffer by
                // getUnread, the recent buffer by getRecent. A disabled switch must not leak
                // through either newMessages or the watermark, so the buffer is dropped
                // before arrival is judged -- not filtered afterwards.
                const history = replyWait
                    ? [...((0, deps.v2ToolEnabled)('getUnread') ? st.unread : []),
                        ...((0, deps.v2ToolEnabled)('getRecent') ? st.recentMessages : [])]
                    : (Array.isArray(st.recentMessages) ? st.recentMessages : []);
                // ── 漏消息窗口（2026-10-18 修）──────────────────────────────────
                //
                // 旧实现按 `seq > baseline` 取"本次等待期间新到的"，而 baseline 对普通等待是
                // **请求开始时的 lastUnreadSeq**。于是「模型思考/发消息那几秒里到达的消息」
                // 永远落在窗口外：本次不返回、下次请求的 baseline 已经越过它们 ⇒ 既没展示给模型，
                // 也没进 readThroughSeq（连续游标）⇒ 水位从此卡死。
                // 实测：会话末段 readThroughSeq 钉在 185，可模型已经看过 205，
                // 之后每次等待都要多读一次 unread 才能收尾；期间有人 @ 也完全没进本回合。
                //
                // 现在按**已读过水位**取：凡是没有进入 readThroughSeq 的消息，一律补给它。
                // `arrived` 仍按 requestSeq 判（"有没有新动静"语义不变），所以等待不会变成忙轮询；
                // 只要这次确实返回了，返回的就是「从水位起连续的一段」，模型据此能正常推进水位。
                const watermarkAtRequest = (0, deps.readThroughSeqV2)(st);
                const pendingFloor = Math.min(baseline, watermarkAtRequest);
                const fullPending = [...new Map(history
                        .filter((m) => m && !m.isSelf && (m.seq || 0) > pendingFloor)
                        .map((m) => [m.seq, m])).values()].sort((a, b) => a.seq - b.seq);
                // 有上限：一次倒 30 条旧账会把上下文挤爆。**必须从最老的开始取**（连续，
                // 水位才推得动）；被截断时 partial=true，提示模型用 unread 工具续读。
                const waitCap = Math.min(50, Math.max(12, Number(deps.cfg.socialV2?.context?.unreadLimit) || 30));
                const pending = fullPending.length > waitCap ? fullPending.slice(0, waitCap) : fullPending;
                const pendingTruncated = fullPending.length > pending.length;
                // `arrived` is recomputed against what this request may actually hand over,
                // so a suppressed buffer cannot report an arrival it is not allowed to show.
                const newMessages = replyWait ? pending : (arrived ? pending : []);
                const readThroughSeq = req.headers['x-agent-token'] ? (0, deps.noteModelMessagesV2)(st, newMessages) : (0, deps.readThroughSeqV2)(st);
                const lastNew = newMessages.length ? newMessages[newMessages.length - 1]
                    : replyWait ? [...st.recentMessages].reverse().find((m) => m && !m.isSelf) : null;
                const lastMessageUnfinished = lastNew ? (0, deps.looksLikeUnfinished)(String(lastNew.tail || lastNew.plain || lastNew.text || '')) : false;
                finishWait();
                sendJson({
                    ok: true,
                    key,
                    purpose: replyWait ? 'reply' : 'messages',
                    arrived,
                    quiet,
                    quietMs,
                    suggestedQuietMs,
                    speakerLikelyDone: quiet,
                    lastMessageUnfinished,
                    timeout: replyWait ? !quiet : !arrived || (quietMs > 0 && !quiet && Date.now() - start >= timeoutMs),
                    waitedMs,
                    preSleepWaitSatisfied: preSleepSatisfiedNow,
                    preSleepWaitObserved: !replyWait && !!st.preSleepWaitObservedAt,
                    // 补发被上限截断时告诉模型「还有更老的没给」，它才知道要用 unread(afterSeq=readThroughSeq) 续读。
                    ...(pendingTruncated ? { partial: true } : {}),
                    // A reply check has no sleep countdown; showing one here suggests
                    // the model should complete sleep observation before its first reply.
                    ...(!replyWait ? { preSleepWaitMs, preSleepWaitRemainingMs: preSleepRemainingMs } : {}),
                    // ── 直接说「现在能不能收尾、该怎么收」 ────────────────────────────
                    //
                    // 为什么不能只给 preSleepWaitRemainingMs 让模型自己解读：实测它会用一次
                    // timeoutMs=90000 的等待去凑 180 秒的观察窗口（闸门根本不认），然后再补一次 180 秒，
                    // 白花一轮。这里把闸门的判断结果和**该发的参数**直接写给它，
                    // 并且**只在闸门真的放行时**才说「可以收尾」——绝不诱导它提前设置潜水
                    // （那会被桥接 400 拒绝，反而更慢）。
                    ...(!replyWait ? {
                        canSleepNow: !preSleepBlocked,
                        countsAsObservation: preSleepCountsAsObservation,
                        hint: preSleepBlocked
                            ? `还不能收尾：还需约 ${Math.ceil(preSleepRemainingMs / 1000)} 秒没有新消息。要完成沉睡前观察，请用 qq_wait_for_messages(timeoutMs=${preSleepWaitMs}) 一次等满——更短的 timeoutMs 不算观察，满足不了闸门（本次 ${Math.round(timeoutMs)}ms ${preSleepCountsAsObservation ? '达标' : '不达标'}）。`
                            : '现在可以直接收尾：qq_mark_read(throughSeq=已读水位) 或 qq_set_wake_config(throughSeq=已读水位, config=…)。不用再等一轮。'
                    } : {}),
                    newMessages,
                    readThroughSeq,
                    unreadCount: st.unread.length
                });
                return;
            }
        }
    };
}
