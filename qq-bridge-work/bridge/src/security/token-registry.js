// Generated from security/token-registry.ts. Edit the TypeScript source and run build:typed.
/**
 * 维护当前实例的会话令牌索引与脱敏集合，构造不读取或生成凭据。
 * @param deps 既有敏感文本规则。
 * @returns 登记/遗忘与两种脱敏方法、共享集合视图；重置沿用同一集合清理。
 * @note 每会话保留当前和上一代；软上限只淘汰非活代，绝不因数量上限漏掉活令牌。
 */
export function createTokenRegistry(deps) {
    const KNOWN_AGENT_TOKENS = new Set();
    const CONVERSATION_TOKENS = new Map();
    const MAX_KNOWN_AGENT_TOKENS = 512;
    /**
     * 记录某会话的当前 agentToken：丢掉它两代之前的旧 token，避免集合无界增长。
     * 另加一层上限兜底（防止异常路径下会话 key 无界增多），淘汰顺序是「先扔非活代」。
     */
    function rememberAgentToken(key, token) {
        const tk = String(token ?? '');
        if (!tk)
            return;
        const prev = CONVERSATION_TOKENS.get(key);
        if (prev && prev[0] === tk)
            return;
        const next = prev ? [tk, prev[0]] : [tk];
        if (prev && prev[1])
            KNOWN_AGENT_TOKENS.delete(prev[1]);
        CONVERSATION_TOKENS.set(key, next);
        KNOWN_AGENT_TOKENS.add(tk);
        if (KNOWN_AGENT_TOKENS.size > MAX_KNOWN_AGENT_TOKENS) {
            // 只淘汰已经不属于任何会话**当前代**的 token（即更早的旧代）。
            // 当前代一个都不能丢：脱敏漏掉活令牌就是把令牌发到 QQ，比内存占用严重得多。
            const live = new Set([...CONVERSATION_TOKENS.values()].map((pair) => pair[0]));
            for (const old of [...KNOWN_AGENT_TOKENS]) {
                if (KNOWN_AGENT_TOKENS.size <= MAX_KNOWN_AGENT_TOKENS)
                    break;
                if (!live.has(old))
                    KNOWN_AGENT_TOKENS.delete(old);
            }
        }
    }
    /** 会话被彻底移除（重置/清空工作区/退订）时，连同它的 token 一起从脱敏集合摘掉。 */
    function forgetAgentToken(key) {
        const prev = CONVERSATION_TOKENS.get(key);
        if (!prev)
            return;
        for (const tk of prev)
            KNOWN_AGENT_TOKENS.delete(tk);
        CONVERSATION_TOKENS.delete(key);
    }
    // 敏感文本脱敏：把 SENSITIVE_RE 命中的片段替换为 ***，供日志/反馈/活动记录写入前使用。
    // SENSITIVE_RE 未带 g 标志，这里动态补 g 以替换所有命中片段。
    function redactSensitiveText(text) {
        let raw = String(text ?? '');
        try {
            const flags = deps.SENSITIVE_RE.flags.includes('g') ? deps.SENSITIVE_RE.flags : deps.SENSITIVE_RE.flags + 'g';
            raw = raw.replace(new RegExp(deps.SENSITIVE_RE.source, flags), '***');
        }
        catch { }
        for (const token of KNOWN_AGENT_TOKENS) {
            if (token && raw.includes(token))
                raw = raw.split(token).join('***');
        }
        return raw;
    }
    function redactKnownTokensOnly(text) {
        let s = String(text ?? '');
        for (const token of KNOWN_AGENT_TOKENS) {
            if (token && s.includes(token))
                s = s.split(token).join('***');
        }
        return s;
    }
    return { rememberAgentToken, forgetAgentToken, redactSensitiveText, redactKnownTokensOnly, knownTokens: KNOWN_AGENT_TOKENS, conversationTokens: CONVERSATION_TOKENS };
}
