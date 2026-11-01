// Generated from social/legacy-context.ts. Edit the TypeScript source and run build:typed.
/**
 * 维护一代消息/摘要文本及指向性判断，实时读取所属会话状态。
 * @param deps 所属状态、时钟和文本投影能力；构造无IO，不触发模型调用。
 * @returns 记账和提示构造函数；保留消息顺序、裁剪规则及媒体关联。
 */
export function createLegacyContext(deps) {
    function isDirectAddress(textContent, event, kind) {
        if (kind !== 'group')
            return true;
        const lower = String(textContent ?? '').toLowerCase();
        const selfId = String(event?.self_id ?? '');
        if (selfId && lower.includes('@' + selfId))
            return true;
        if (deps.selfNickname && (lower.includes('@' + deps.selfNickname) || lower.includes(deps.selfNickname)))
            return true;
        for (const kw of (deps.cfg.social?.mustReplyKeywords ?? [])) {
            if (lower.includes(String(kw).toLowerCase()))
                return true;
        }
        if (isDirectedAtAi(textContent))
            return true;
        return false;
    }
    function isDirectedAtAi(textContent) {
        const lower = String(textContent ?? '').toLowerCase();
        const aiMention = /deepseek|claude|chatgpt|gpt|大肥鱼|小鲸鱼|鲸鱼|d指导|d老师|d师傅|深度求索|\bds\b|ai|人工智障|机器人|模型/.test(lower);
        const challenge = /强|弱|行不行|能不能|会不会|是不是|一半|水平|垃圾|废物|白嫖|菜|不如|厉害|赢|输|比.*强|比.*弱/.test(lower);
        const question = /[?？吗呢吧]|怎么|为什么|哪|谁/.test(lower);
        if (aiMention && (question || challenge))
            return true;
        // "你/您" + 疑问/比较/挑战（放宽，避免漏掉"你有claude一半强吗"这类直接问）
        if (/(你|您).{0,10}(吗|呢|？|\?|怎么|是不是|能不能|行不行|有没有|有|没有|比|不如|强|弱|一半|厉害|垃圾|菜|赢|输)/.test(lower))
            return true;
        if (/^(你|您)(是不是|行不行|能不能|会不会|觉得|有|没有)/.test(lower))
            return true;
        // "你是...还是... / 你是...吗 / 你是...？"（如：你是人类还是ai、你是真人吗）
        if (/(你|您)是[^？?。！!]{0,14}(还是|或者|吗|么|？|\?)/.test(lower))
            return true;
        // 追问/催促：AI 没回时的真人式催促
        if (/怎么不说话|人呢|回我|说话啊|理我|别装死|在不在|装死|说话/.test(lower))
            return true;
        return false;
    }
    function isMustReplyText(textContent) {
        const lower = String(textContent ?? '').toLowerCase();
        if (deps.selfNickname && (lower.includes('@' + deps.selfNickname) || lower.includes(deps.selfNickname)))
            return true;
        for (const kw of (deps.cfg.social?.mustReplyKeywords ?? [])) {
            if (lower.includes(String(kw).toLowerCase()))
                return true;
        }
        if (isDirectedAtAi(textContent))
            return true;
        return false;
    }
    function appendRecentMessage(key, sender, textContent, plainText, quoteTargetIsSelf = false, isOwner = false, media = [], messageRef = '') {
        if (!deps.social.recentMessages.has(key))
            deps.social.recentMessages.set(key, []);
        const arr = deps.social.recentMessages.get(key);
        arr.push({
            sender,
            text: (0, deps.truncateText)(String(textContent), 200),
            plain: (0, deps.truncateText)(String(plainText ?? textContent), 200),
            quoteTargetIsSelf: !!quoteTargetIsSelf,
            isOwner: !!isOwner,
            media: Array.isArray(media) ? media : [],
            messageId: messageRef ? String(messageRef) : '',
            hasMedia: Array.isArray(media) && media.length > 0,
            time: deps.Date.now()
        });
        const cap = Math.max(50, Number(deps.cfg.social?.contextWindow ?? 15) * 2);
        while (arr.length > cap)
            arr.shift();
    }
    function appendSummary(key, sender, textContent, plainText, isOwner = false, media = [], messageRef = '') {
        if (!deps.social.pendingSummaries.has(key)) {
            deps.social.pendingSummaries.set(key, { items: [], since: deps.Date.now() });
        }
        const entry = deps.social.pendingSummaries.get(key);
        entry.items.push({ sender, text: (0, deps.truncateText)(String(textContent), 200), plain: (0, deps.truncateText)(String(plainText ?? textContent), 200), isOwner: !!isOwner, media: Array.isArray(media) ? media : [], messageId: messageRef ? String(messageRef) : '', hasMedia: Array.isArray(media) && media.length > 0, time: deps.Date.now() });
        if (entry.items.length > 60)
            entry.items.shift();
    }
    function buildContextBlock(key) {
        const ctx = (deps.social.recentMessages.get(key) ?? []).slice(-Number(deps.cfg.social?.contextWindow ?? 15));
        return ctx.map((m) => `${m.isOwner ? '【管理员】' : ''}${m.sender}：${m.text}${(0, deps.mediaHintFor)(key, m.messageId, m.media)}`).join('\n') || '（无）';
    }
    function buildBatchPrompt(key, newMsgs, allowSilent = true) {
        const lines = newMsgs.map((m) => `${m.isOwner ? '【管理员】' : ''}${m.sender}：${m.text}${(0, deps.mediaHintFor)(key, m.messageId, m.media)}`).join('\n');
        const directionHint = lines.includes('[引用') ? `${deps.DIRECTION_HINT}\n` : '';
        if (!allowSilent) {
            return `【新消息】\n${lines}\n\n${directionHint}请回复消息。\n${deps.SPACE_SPLIT_HINT}`;
        }
        return `【新消息】\n${lines}\n\n${directionHint}请根据情况决定是否回复。如果不需要回应、想潜水/不接话，请只输出 ${deps.SILENT_MARKER}；否则正常回复。\n${deps.SPACE_SPLIT_HINT}`;
    }
    function buildProbePrompt(key) {
        return `【群聊上下文】\n${buildContextBlock(key)}\n\n群里安静了一会儿，你可以说点什么。如果不想说，请只输出 ${deps.SILENT_MARKER}。\n${deps.SPACE_SPLIT_HINT}`;
    }
    function buildActiveExitPrompt(key, roleHint) {
        let p = '';
        if (roleHint)
            p += roleHint + '\n\n';
        p += `【群聊上下文】\n${buildContextBlock(key)}\n\n你已经参与群聊有一阵子了，现在该自然地收尾/潜水了。请说一句简短的退场话（例如“我先潜水了”“你们聊，我摸鱼去了”），说完后就安静下来，不再继续接话。`;
        return p;
    }
    function buildProactivePrompt(key, roleHint) {
        let p = '';
        if (roleHint)
            p += roleHint + '\n\n';
        p += `【群聊上下文】\n${buildContextBlock(key)}\n\n群内已经长时间没人说话了，你打算开启一个新话题。优先结合你的人格/角色设定的兴趣，其次结合群里大家的兴趣，挑一个合适的话题。可以联网搜索一些新鲜话题来聊。如果你觉得现在不适合开口，可以只输出 ${deps.SILENT_MARKER}。\n${deps.SPACE_SPLIT_HINT}`;
        return p;
    }
    return { isDirectAddress, isDirectedAtAi, isMustReplyText, appendRecentMessage, appendSummary, buildContextBlock, buildBatchPrompt, buildProbePrompt, buildActiveExitPrompt, buildProactivePrompt };
}
