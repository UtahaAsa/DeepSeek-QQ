// Generated from messaging/incoming.ts. Edit the TypeScript source and run build:typed.
/**
 * 接收文字、媒体及拍一拍消息，按权限和模式分发；普通聊天通过统一投递队列。
 * @param {object} deps 实例依赖；动态配置、权限、会话状态通过getter实时读取。
 * @returns {object} 功能操作；异步错误沿原调用边界传播，调用方负责记录或响应。
 */
export function createIncomingMessages(deps) {
    async function handleIncoming(kind, id, event, cfg) {
        const key = (0, deps.convKey)(kind, id);
        if (!(0, deps.modeAllowed)(key, kind, id, cfg, deps.currentMode)) {
            (0, deps.log)(`忽略未授权会话 ${key}（当前模式 ${deps.currentMode}，来自 ${event.user_id}）`);
            return;
        }
        if (deps.nativeBinding && deps.nativeCapabilities.receiveVoice && event.message?.some((s) => s.type === 'record')) {
            const assertCurrent = (0, deps.captureSendGuard)(key);
            const converted = [];
            for (const segment of event.message) {
                if (segment.type !== 'record') {
                    converted.push(segment);
                    continue;
                }
                try {
                    const transcript = await deps.nativeVoice.transcribe(segment.data?.file);
                    assertCurrent();
                    converted.push({ type: 'text', data: { text: transcript ? '[语音自动转写，可能有误] ' + transcript : '[语音未识别出清楚内容，请勿猜测]' } });
                }
                catch {
                    converted.push({ type: 'text', data: { text: '[本次语音读取失败，请勿猜测内容，请对方重说或改发文字]' } });
                }
            }
            assertCurrent();
            event = { ...event, message: converted };
        }
        const resolveAtName = async (qq) => {
            // 只有群聊才需要把 @QQ号 解析成群名片/昵称；私聊没有群成员概念
            if (kind !== 'group')
                return null;
            return (0, deps.resolveGroupMemberName)(event.group_id, qq);
        };
        const resolveReply = (messageId) => (0, deps.resolveReplyInfo)(kind, id, messageId, event.self_id);
        // textContent 带引用对象信息，供 DSH 判断“这句话在对谁说”；
        // plainContent 只保留当前消息自己的文字，用于命令/指向性判断，避免被引用原文干扰。
        const textContent = await (0, deps.segmentsToText)(event.message ?? [], { resolveAtName, resolveReply });
        const plainContent = await (0, deps.segmentsToText)(event.message ?? [], { resolveAtName, includeReply: false });
        const mediaList = (0, deps.extractMediaFromSegments)(event.message ?? []);
        const messageRef = String(event.message_id ?? event.msg_id ?? event.message_seq ?? '');
        const seqRef = event.message_seq != null ? String(event.message_seq) : '';
        if (deps.nativeBinding) {
            const forwards = (0, deps.extractForwardIds)(event.message ?? []);
            if (forwards.length && (deps.seenForwardIds.has(key) || deps.seenForwardIds.size < 128)) {
                const seen = deps.seenForwardIds.get(key) || new Set();
                for (const id of forwards)
                    seen.add(id);
                while (seen.size > 1000)
                    seen.delete(seen.values().next().value);
                deps.seenForwardIds.set(key, seen);
            }
        }
        const refsToStore = [...new Set([messageRef, seqRef].filter(Boolean))];
        if (refsToStore.length > 0 && mediaList.length > 0) {
            let mediaByRef = deps.messageMediaStore.get(key);
            if (!mediaByRef) {
                mediaByRef = new Map();
                deps.messageMediaStore.set(key, mediaByRef);
            }
            for (const ref of refsToStore)
                mediaByRef.set(ref, mediaList);
            // 防止无限增长：超过上限时删除最旧一条（Map 保持插入序）
            while (mediaByRef.size > deps.MAX_MEDIA_STORE_PER_KEY) {
                const oldestKey = mediaByRef.keys().next().value;
                if (oldestKey === undefined)
                    break;
                mediaByRef.delete(oldestKey);
            }
        }
        // 引用对象是机器人自己时，视为直接对 AI 说（即使当前文字没有 @/关键词）。
        // 因此必须先解析 quoteTargetIsSelf 再做空文本过滤，避免“只引用不附文”被漏掉。
        const quoteTargetIsSelf = await (0, deps.isQuoteTargetSelf)(event.message ?? [], kind, id, event.self_id);
        if (!(0, deps.isSessionAllowedInCurrentMode)(key))
            return;
        if (!plainContent && !quoteTargetIsSelf)
            return;
        const isOwner = String(event.user_id) === String(cfg.ownerQQ ?? '');
        const roleState = (0, deps.readRoleState)();
        // 若该会话有挂起的提问/审批，先当作回答处理（用当前消息自己的文字，不含引用原文）。
        // 审批只有管理员消息会被消费；群友消息不能因为“审批挂起”而被吞掉，应继续走正常处理。
        const p = deps.pending.get(key);
        if (p && (p.kind === 'question' || isOwner)) {
            await (0, deps.handlePendingAnswer)(p, plainContent, key, isOwner);
            return;
        }
        // 静默模式：群友消息不投递给 agent（只记录）；管理员消息照常
        if (roleState.mode === 'silent' && !isOwner) {
            (0, deps.appendActivity)(`${key}（静默模式）群友 ${event.user_id}：${textContent.slice(0, 80)}`);
            (0, deps.log)(`静默模式，忽略群友消息 ${key}`);
            return;
        }
        // 控制类话语：仅管理员（ownerQQ）可下达；群友触发直接拦截
        if (!isOwner && /进入角色扮演|退出角色扮演|切换角色|设置角色|改角色|换角色|关闭角色扮演|开启角色扮演/.test(plainContent)) {
            await (0, deps.sendToQQ)(key, '角色切换仅管理员可在管理端操作，群内不支持。');
            return;
        }
        // 管理命令：仅管理员（ownerQQ）可用，且由桥接直接执行（硬性，不经过模型）
        if (plainContent.startsWith('/')) {
            if (!isOwner) {
                await (0, deps.sendToQQ)(key, '管理命令仅管理员可用。');
                return;
            }
            if (plainContent === '/reset' || plainContent === '/new') {
                const old = deps.state.sessions[key];
                if (old) {
                    deps.sessionEpoch++;
                    delete deps.state.sessions[key];
                    deps.sessionModelManager.forget(old);
                    delete deps.state.sessionPolicies[key];
                    deps.reverse.delete(old);
                    deps.collectors.delete(old);
                    deps.sendToolSucceededSessions.delete(old);
                    deps.pendingSendToolCalls.delete(old);
                    deps.v2TurnStartAt.delete(old);
                    deps.turnLeaseNoted.delete(old);
                    deps.toolCallNames.delete(old);
                    deps.social.silentTurns.delete(old);
                    deps.social.exitingSessions.delete(old);
                    const pe = deps.pending.get(key);
                    if (pe) {
                        clearTimeout(pe.timer);
                        (0, deps.cancelPendingEntry)(pe).catch(() => { });
                    }
                    deps.pending.delete(key);
                    deps.offlineQueue.forget(key);
                    deps.sessionCreation.forget(key);
                    (0, deps.drainPromptQueue)(key, '会话已重置');
                    deps.social.recentMessages.delete(key);
                    deps.messageMediaStore.delete(key);
                    deps.social.pendingSummaries.delete(key);
                    deps.social.states.delete(key);
                    deps.social.silentContext.delete(key);
                    deps.slangWindows.delete(key);
                    deps.slangExtractionCooldowns.delete(key);
                    deps.slangSubmitTimes.delete(key);
                    (0, deps.cancelSocialTimers)(key);
                    (0, deps.clearSocialV2Timers)(key);
                    deps.pendingWakeKeys.delete(key);
                    deps.wakeConfigUpdatedKeys.delete(key);
                    deps.markReadCalledKeys.delete(key);
                    deps.wakeConfigMissCount.delete(key);
                    (0, deps.forgetAgentToken)(key);
                    deps.socialV2.conversations.delete(key);
                    deps.seenForwardIds.delete(key);
                    (0, deps.saveSocialV2State)();
                    (0, deps.saveState)();
                    // 与 retireSession 一致：先终止 DSH 侧排队的工作，再归档（归档只隐藏会话）。
                    try {
                        await (0, deps.withTimeout)((0, deps.stopBridgeSessionWork)(old, 'chat-reset'), deps.DSH_CONTROL_TIMEOUT_MS, 'stopSessionWork');
                    }
                    catch (error) {
                        (0, deps.log)(`⚠️ 停止旧会话失败 ${key}：${error?.message ?? error}；请在 DSH 检查旧任务`);
                    }
                    try {
                        await (0, deps.withTimeout)(deps.api.workspace.archiveSession({ sessionId: old }), deps.DSH_CONTROL_TIMEOUT_MS, 'archiveSession');
                    }
                    catch { }
                    await (0, deps.sendToQQ)(key, '已重置会话，下次消息将开新上下文');
                }
                return;
            }
            if (plainContent === '/status') {
                const rs = (0, deps.readRoleState)();
                await (0, deps.sendToQQ)(key, `会话 ${deps.state.sessions[key] ?? '未创建'}；白名单 ${(0, deps.allowed)(kind, id, cfg) ? '通过' : '拦截'}；角色 ${rs.role ?? '无'}；模式 ${rs.mode}`);
                return;
            }
            if (plainContent === '/role' || plainContent.startsWith('/role ')) {
                const name = (0, deps.sanitizeRoleName)(plainContent.slice(5).trim());
                if (!name || name === 'off' || name === 'clear') {
                    (0, deps.writeRoleState)(null, roleState.mode);
                    await (0, deps.sendToQQ)(key, '已清除角色，恢复正常人格。');
                }
                else {
                    const roleFile = deps.path.join(deps.ROOT, 'roles', name + '.md');
                    if (!deps.fs.existsSync(roleFile)) {
                        await (0, deps.sendToQQ)(key, `角色「${name}」不存在。角色文件放 qq-bridge/roles/ 目录。`);
                    }
                    else {
                        (0, deps.writeRoleState)(name, roleState.mode);
                        await (0, deps.sendToQQ)(key, `已切换角色：${name}。`);
                    }
                }
                return;
            }
            if (plainContent === '/silent' || plainContent === '/quiet') {
                (0, deps.writeRoleState)(roleState.role, 'silent');
                await (0, deps.sendToQQ)(key, '已进入静默模式：群友消息不再回复，仅管理员可对话。');
                return;
            }
            if (plainContent === '/active' || plainContent === '/speak') {
                (0, deps.writeRoleState)(roleState.role, 'active');
                await (0, deps.sendToQQ)(key, '已退出静默模式，恢复正常回复。');
                return;
            }
            // 其余 / 开头内容照常发给 DSH（DSH 的斜杠命令原样执行，如 /model）
        }
        // 二代仿真模式（reserved2）：唤醒调度
        if (deps.currentMode === 'reserved2') {
            const sender = kind === 'group' ? (event.sender?.card || event.sender?.nickname || String(event.user_id)) : '私聊';
            (0, deps.appendSocialV2Message)(key, sender, textContent, plainContent, quoteTargetIsSelf, isOwner, event.message_id ?? event.msg_id ?? null, mediaList, event.user_id ?? null, (0, deps.extractForwardIds)(event.message ?? []));
            // 二代同样收集群聊黑话学习素材（AI 自主提交之外，桥接仍自动提取高频陌生词）
            if (kind === 'group')
                (0, deps.feedSlangWindow)(key, sender, plainContent);
            if (deps.socialV2.paused) {
                (0, deps.appendActivity)(`${key} [reserved2] AI 已暂停，消息仅入库不唤醒：${textContent.slice(0, 80)}`);
                return;
            }
            const st = (0, deps.getSocialV2State)(key);
            if ((0, deps.isDirectWakeMessageV2)(st, event, kind, plainContent, quoteTargetIsSelf))
                st.directWakeSeq = st.lastUnreadSeq;
            if (deps.nativeObservation?.receive(key, st.lastUnreadSeq || 0))
                return;
            if (deps.nativeBinding && (0, deps.isConversationBusyV2)(key, st)) {
                // 后台观察已静默到期时，新消息仍需核对漏收的结束事件，不能再等旧忙碌租约。
                const identity = { st, token: st.agentToken, generation: deps.nativePolicyGeneration, sessionId: deps.state.sessions[key] };
                await (0, deps.reconcileNativeTerminal)(key, identity);
                if (!(0, deps.nativeObservationCurrent)(key, identity))
                    return;
            }
            if (!st.bootstrapSent) {
                st.bootstrapSent = true;
                (0, deps.saveSocialV2State)();
                (0, deps.scheduleWakeV2)(key, 'bootstrap');
            }
            else {
                const reason = (0, deps.evaluateWakeTriggerV2)(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf);
                if (reason) {
                    (0, deps.scheduleWakeV2)(key, reason);
                }
            }
            (0, deps.appendActivity)(`${key} [reserved2] 消息已入未读：${textContent.slice(0, 80)}`);
            return;
        }
        // 黑话学习素材：只从群聊普通消息进入滚动窗口（命令/角色控制语不学；只学当前消息自己的文字，不学引用原文）
        if (kind === 'group') {
            (0, deps.feedSlangWindow)(key, event.sender?.card || event.sender?.nickname || String(event.user_id), plainContent);
        }
        // 角色扮演提示注入（仅注入给 agent，不影响群友之间的正常对话语义）
        const roleHint = (0, deps.currentRoleHint)();
        // 群聊里带发送者信息，私聊不用；角色提示注入到消息开头（agent 可见）；
        // 管理员消息带身份标记（供 agent 识别，但其权限仍受工具面硬限制）
        const promptText = (deps.nativeBinding ? (0, deps.nativeChatHint)(kind, deps.nativeCapabilities, deps.lastSendFailed.get(key) === true) + '【当前会话标识】' + key + '\n' : '') + (roleHint ? roleHint + '\n\n' : '')
            + (kind === 'group' && deps.nativeIdleLoop?.recentSent(String(id)) ? '【你本次最近主动在本群说过】' + deps.nativeIdleLoop.recentSent(String(id)) + '\n' : '')
            + (isOwner ? '【管理员】' : '')
            + (kind === 'group'
                ? `${event.sender?.card || event.sender?.nickname || String(event.user_id)}${deps.nativeBinding ? `（QQ号 ${event.user_id}）` : ''}：${textContent}`
                : textContent)
            + (0, deps.mediaHintFor)(key, messageRef, mediaList);
        (0, deps.appendActivity)(`${key} ${isOwner ? '管理员' : '群友'} ${event.sender?.nickname || event.user_id}：${textContent.slice(0, 80)}`);
        // 仿真群友模式：reserved 走状态机（观望/活跃/试探/退场）
        if ((0, deps.isSocialEnabled)()) {
            const sender = kind === 'group' ? (event.sender?.card || event.sender?.nickname || String(event.user_id)) : '私聊';
            (0, deps.appendRecentMessage)(key, sender, textContent, plainContent, quoteTargetIsSelf, isOwner, mediaList, messageRef); // AI 始终感知
            const st = (0, deps.socialState)(key);
            // 退场中：收尾发言发出前不再接话，新消息进入摘要
            if (st.phase === 'exiting') {
                (0, deps.appendSummary)(key, sender, textContent, plainContent, isOwner, mediaList, messageRef);
                (0, deps.log)(`社交模式：${key} 退场中，新消息转入摘要`);
                return;
            }
            // 活跃超时：即使群里一直有人说话，到达随机上限后也主动收尾退场
            if (st.phase === 'active' && (0, deps.triggerActiveDurationExit)(key, st, Date.now())) {
                (0, deps.appendSummary)(key, sender, textContent, plainContent, isOwner, mediaList, messageRef);
                (0, deps.log)(`社交模式：${key} 活跃超时退场中，新消息转入摘要`);
                return;
            }
            // 活跃 / 试探中：有新消息 → 保持活跃（或从试探回到活跃）
            if (st.phase === 'active' || st.phase === 'probing') {
                st.phase = 'active';
                st.lastActiveMessageAt = Date.now();
                st.probeDeadline = 0;
                // 私聊：发给你就是叫你，直接即时投递，不等轮询、不参与沉默
                if (kind === 'private') {
                    const promptText = `${roleHint ? roleHint + '\n\n' : ''}${isOwner ? '【管理员】' : ''}${textContent}${(0, deps.mediaHintFor)(key, messageRef, mediaList)}`;
                    (0, deps.scheduleSocialReply)(key, promptText, Number(cfg.social?.activeReplyDelayMinMs ?? 2000), Number(cfg.social?.activeReplyDelayMaxMs ?? 8000), '私聊即时回应', false, mediaList);
                    (0, deps.log)(`社交模式：${key} 私聊活跃中收到消息，即时投递`);
                    return;
                }
                (0, deps.log)(`社交模式：${key} 活跃中收到消息，等待批量检测`);
                return;
            }
            // 启动阶段（观望）：触发条件 ① 明确对 AI 说（含引用机器人自己） ② 普通消息小概率
            // 指向性判断只基于当前消息自己的文字，不把引用原文算作“在叫 AI”
            const direct = (0, deps.isDirectAddress)(plainContent, event, kind) || quoteTargetIsSelf;
            const randomTrigger = Math.random() < Number(cfg.social?.triggerProbability ?? 0.15);
            if (!direct && !randomTrigger) {
                (0, deps.appendSummary)(key, sender, textContent, plainContent, isOwner, mediaList, messageRef);
                (0, deps.log)(`社交模式：观望中未触发 ${key}（${sender}：${plainContent.slice(0, 40)}）`);
                return;
            }
            // 触发成功：进入活跃，贴最近上下文 + 当前消息 + 人格（仅此一次），让 AI 回复
            (0, deps.enterActive)(key);
            const triggeredRoleHint = (0, deps.currentRoleHint)();
            const currentLine = (isOwner && kind === 'private') ? `【管理员】${sender}：${textContent}` : `${sender}：${textContent}`;
            const directionHint = textContent.includes('[引用') ? deps.DIRECTION_HINT + '\n' : '';
            const replyInstruction = direct
                ? `请回复消息。\n${directionHint}${deps.SPACE_SPLIT_HINT}`
                : `请根据情况决定是否回复。如果不需要回应、想潜水/不接话，请只输出 ${deps.SILENT_MARKER}；否则正常回复。\n${directionHint}${deps.SPACE_SPLIT_HINT}`;
            const promptText = `${triggeredRoleHint ? triggeredRoleHint + '\n\n' : ''}【群聊上下文】\n${(0, deps.buildContextBlock)(key)}\n【当前消息】${currentLine}${(0, deps.mediaHintFor)(key, messageRef, mediaList)}\n\n${replyInstruction}`;
            if (isOwner && kind === 'private') {
                (0, deps.log)(`社交模式：管理员私聊触发，立即投递 ${key}`);
                await (0, deps.deliverPrompt)(key, promptText, { media: mediaList });
            }
            else {
                (0, deps.scheduleSocialReply)(key, promptText, Number(cfg.social?.activeReplyDelayMinMs ?? 2000), Number(cfg.social?.activeReplyDelayMaxMs ?? 8000), '触发进入活跃', false, mediaList);
            }
            return;
        }
        return deliverOrdinaryMessage(key, promptText, mediaList, cfg);
    }
    async function handlePokeNotice(event) {
        if (!event || event.sub_type !== 'poke')
            return;
        const selfId = event.self_id;
        const groupId = event.group_id ?? event.groupId ?? null;
        const senderIdRaw = event.sender_id ?? event.user_id ?? event.sender?.user_id ?? null;
        const targetIdRaw = event.target_id ?? event.targetId ?? null;
        const senderId = senderIdRaw != null ? String(senderIdRaw) : '';
        const targetId = targetIdRaw != null ? String(targetIdRaw) : '';
        // 自己发出的拍一拍不回灌给 AI（避免把“我拍了别人”当成群友事件）。
        if (senderId && selfId != null && String(senderId) === String(selfId))
            return;
        let key;
        let kind;
        let id;
        if (groupId != null) {
            kind = 'group';
            id = String(groupId);
            key = (0, deps.convKey)('group', id);
        }
        else {
            kind = 'private';
            const peer = event.user_id ?? senderId;
            if (!peer)
                return;
            id = String(peer);
            key = (0, deps.convKey)('private', id);
        }
        if (!(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode))
            return;
        if (deps.currentMode !== 'reserved2') {
            (0, deps.appendActivity)(`${key} 收到拍一拍事件（非 reserved2，仅记录）：${senderId} -> ${targetId}`);
            return;
        }
        let sender = senderId;
        if (kind === 'group' && senderId) {
            try {
                sender = await (0, deps.resolveGroupMemberName)(Number(id), senderId) || senderId;
            }
            catch { }
        }
        const targetIsSelf = !!targetId && selfId != null && String(targetId) === String(selfId);
        const isOwner = String(senderId) === String(deps.cfg.ownerQQ ?? '');
        const msg = (0, deps.appendSocialV2Poke)(key, {
            sender,
            userId: senderId || null,
            targetId: targetId || null,
            targetIsSelf,
            isOwner,
            groupId: groupId != null ? String(groupId) : null,
            action: event.action,
            suffix: event.suffix
        });
        (0, deps.appendActivity)(`${key} 拍一拍事件：${msg.text.slice(0, 80)}`);
        if (deps.currentMode !== 'reserved2')
            return;
        if (deps.socialV2.paused)
            return;
        const st = (0, deps.getSocialV2State)(key);
        if (!st.bootstrapSent) {
            st.bootstrapSent = true;
            (0, deps.saveSocialV2State)();
            (0, deps.scheduleWakeV2)(key, 'bootstrap');
        }
        else if (st.wakeConfig?.triggers?.poke) {
            (0, deps.scheduleWakeV2)(key, 'poke');
        }
    }
    async function deliverOrdinaryMessage(key, promptText, mediaList, cfg) {
        // DSH 重启容错：DSH 不可用时消息入队（不丢），恢复后自动补投
        if (!deps.dshReady) {
            deps.offlineQueue.enqueue(key, promptText, { media: mediaList });
            if (deps.offlineQueue.shouldNotify(key)) {
                await (0, deps.sendToQQ)(key, '⏳ 系统服务重启中，消息已排队，恢复后自动处理。');
            }
            (0, deps.log)(`DSH 不可用，消息入队 (${key})`);
            return;
        }
        // 普通聊天也必须先建立当前权限的轮次屏障；独立prompt分支会让回复被事件收集器拒绝。
        const result = await (0, deps.deliverPrompt)(key, promptText, { media: mediaList });
        if (!result?.ok || result.queued || result.retried || result.command)
            return;
        if (cfg.ackMessage && deps.currentMode !== 'reserved2')
            await (0, deps.sendToQQ)(key, cfg.ackMessage);
        (0, deps.log)(`已投递 ${key}: ${promptText.slice(0, 80)}${promptText.length > 80 ? '…' : ''}`);
    }
    return { handleIncoming, handlePokeNotice, deliverOrdinaryMessage };
}
