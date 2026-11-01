// Generated from wake/triggers.ts. Edit the TypeScript source and run build:typed.
/**
 * 解析唤醒条件和优先级，区分消息触发与定时触发。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createWakeTriggers(deps) {
    const WAKE_PRIORITY = {
        private: 100,
        atMention: 90,
        question: 80,
        speaker: 75,
        nameMention: 70,
        keyword: 60,
        anyMessage: 50,
        replyCheck: 40,
        timeout: 30,
        proactiveCheck: 20
    };
    const TIMER_WAKE_REASONS = new Set(['timeout', 'replyCheck', 'proactiveCheck', 'bootstrap', 'admin']);
    function evaluateWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf) {
        if (kind === 'private')
            return 'private';
        const tr = st.wakeConfig?.triggers ?? {};
        if (tr.anyMessage)
            return 'anyMessage';
        if (tr.atMention) {
            const atSelf = Array.isArray(event?.message) && event.message.some((seg) => seg?.type === 'at' && String(seg.data?.qq) === String(event?.self_id ?? ''));
            if (atSelf || quoteTargetIsSelf)
                return 'atMention';
        }
        if (tr.nameMention && deps.selfNickname) {
            // 用 plainContent（当前消息自己的文字）：textContent 含 `[引用 某人：原文]`，
            // 引用一条恰好提到机器人昵称的旧消息不该算「叫了名字」（那是被动触发的付费回合）。
            const lower = String(plainContent ?? '').toLowerCase();
            if (lower.includes('@' + deps.selfNickname.toLowerCase()) || lower.includes(deps.selfNickname.toLowerCase()))
                return 'nameMention';
        }
        if (Array.isArray(tr.keywords) && tr.keywords.length) {
            const lower = String(plainContent ?? '').toLowerCase();
            for (const kw of tr.keywords) {
                const kwStr = String(kw ?? '').toLowerCase();
                if (!kwStr)
                    continue;
                // 短英文/数字关键词（如 DS/R1）用词边界匹配，避免 ADS/BDSM/DSL 误触发。
                if (/^[a-z0-9]+$/.test(kwStr) && kwStr.length <= 4) {
                    if (new RegExp(`\\b${kwStr}\\b`, 'i').test(lower))
                        return `keyword:${kw}`;
                }
                else if (lower.includes(kwStr)) {
                    return `keyword:${kw}`;
                }
            }
        }
        if (tr.question && (0, deps.isDirectedAtAi)(plainContent))
            return 'question';
        if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) {
            const speakerId = String(event?.user_id ?? event?.sender?.user_id ?? '');
            if (speakerId && tr.speakerIds.some((id) => String(id) === speakerId)) {
                const senderLabel = event?.sender?.card || event?.sender?.nickname || speakerId;
                return `speaker:${senderLabel}`;
            }
        }
        if (Number(tr.probability) > 0 && deps.Math.random() < Number(tr.probability))
            return 'probability';
        return null;
    }
    // 仅依据本次真实来信及已开启的触发条件识别直接对话，不信任模型传入的原因文字。
    function isDirectWakeMessageV2(st, event, kind, plainContent, quoteTargetIsSelf) {
        if (kind === 'private')
            return true;
        const tr = st.wakeConfig?.triggers ?? {};
        if (tr.atMention && (quoteTargetIsSelf || Array.isArray(event?.message)
            && event.message.some(seg => seg?.type === 'at' && String(seg.data?.qq) === String(event?.self_id ?? ''))))
            return true;
        if (tr.nameMention && deps.selfNickname && String(plainContent ?? '').toLowerCase().includes(deps.selfNickname.toLowerCase()))
            return true;
        return tr.question === true && (0, deps.isDirectedAtAi)(plainContent);
    }
    function hasDirectUnreadV2(st) {
        return Number.isSafeInteger(st?.directWakeSeq) && st.directWakeSeq > (0, deps.readThroughSeqV2)(st)
            && st.unread.some(message => message.seq === st.directWakeSeq && !message.isSelf);
    }
    // 唤醒原因可能带子类型（如 keyword:小鲸鱼、speaker:昵称），取冒号前的基名计算优先级。
    function wakePriorityV2(reason) {
        const base = String(reason ?? '').split(':')[0];
        return WAKE_PRIORITY[base] ?? 0;
    }
    function isTimerWakeReason(reason) {
        return TIMER_WAKE_REASONS.has(String(reason ?? '').split(':')[0]);
    }
    return { evaluateWakeTriggerV2, isDirectWakeMessageV2, hasDirectUnreadV2, wakePriorityV2, isTimerWakeReason };
}
