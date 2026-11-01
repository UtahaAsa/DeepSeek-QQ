// Generated from logging/tool-audit.ts. Edit the TypeScript source and run build:typed.
/**
 * 创建工具日志与参数脱敏能力，构造仅创建追加器，不写日志。
 * @param deps 既有带容量上限的追加器、文本脱敏和截断能力。
 * @returns 递归字段脱敏、最多四层JSON解包与日志写入；保留原型污染键过滤和写入失败日志。
 * @note 脱敏对象以无原型副本返回，不改原参数；不支持的非JSON值沿用旧序列化失败语义。
 */
export function createToolAudit(deps) {
    const appendToolLogFile = (0, deps.createCappedLogger)(deps.TOOL_LOG_FILE, 2000);
    const SENSITIVE_ARG_KEYS = new Set(['token', 'featuretoken', 'feature_token', 'x-native-feature-token', 'authorization', 'password', 'passwd', 'secret', 'apikey', 'api_key', 'accesskey', 'access_key', 'accesstoken', 'access_token', 'cookie', 'session', 'privatekey', 'private_key', 'clientsecret', 'client_secret', 'refreshtoken', 'refresh_token', 'x-agent-token', 'x_agent_token']);
    function appendToolLog(entry) {
        try {
            const safeEntry = { ...entry };
            if (typeof safeEntry.error === 'string')
                safeEntry.error = (0, deps.redactSensitiveText)(safeEntry.error);
            if (typeof safeEntry.args === 'string') {
                let parsed = safeEntry.args;
                let parsedOk = false;
                for (let i = 0; i < 4; i++) {
                    try {
                        const next = JSON.parse(parsed);
                        parsed = next;
                        parsedOk = true;
                        if (typeof next !== 'string')
                            break;
                    }
                    catch {
                        break;
                    }
                }
                if (parsedOk) {
                    safeEntry.args = JSON.stringify(redactSensitive(parsed));
                }
                else {
                    safeEntry.args = (0, deps.redactSensitiveText)(safeEntry.args);
                }
            }
            // 用内存计数上限的追加器：不再「append 完再读回整个文件数行数」——
            // 那个写法在 2000 行（约 650KB）时单次要 15ms，而每次工具调用要写两条。
            appendToolLogFile(`${JSON.stringify(safeEntry)}\n`);
        }
        catch (error) {
            (0, deps.log)('写入工具调用日志失败:', error?.message ?? error);
        }
    }
    function redactSensitive(obj) {
        if (Array.isArray(obj))
            return obj.map(redactSensitive);
        if (obj && typeof obj === 'object') {
            // 用无原型对象承接，避免日志脱敏时被 __proto__ 等键触发原型链污染。
            const out = Object.create(null);
            for (const [k, v] of Object.entries(obj)) {
                const key = String(k).toLowerCase();
                if (key === '__proto__' || key === 'constructor' || key === 'prototype')
                    continue;
                out[k] = SENSITIVE_ARG_KEYS.has(key) ? '***' : redactSensitive(v);
            }
            return out;
        }
        if (typeof obj === 'string')
            return (0, deps.redactSensitiveText)(obj);
        return obj;
    }
    function sanitizeToolArgs(args) {
        if (args === undefined || args === null)
            return null;
        let parsed = args;
        // DSH 的 tool/call arguments 经常是 JSON 字符串（甚至双层转义），逐层解析后再递归脱敏，避免 token 明文落盘。
        for (let i = 0; i < 4; i++) {
            if (typeof parsed !== 'string')
                break;
            try {
                const next = JSON.parse(parsed);
                parsed = next;
                if (typeof next !== 'string')
                    break;
            }
            catch {
                break;
            }
        }
        const safe = redactSensitive(parsed);
        let text;
        try {
            text = JSON.stringify(safe);
        }
        catch {
            text = String(safe);
        }
        if (text.length > 2000)
            text = (0, deps.truncateText)(text, 2000) + '…(truncated)';
        return text;
    }
    return { appendToolLog, redactSensitive, sanitizeToolArgs };
}
