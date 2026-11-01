// Generated from messaging/message-segmentation.ts. Edit the TypeScript source and run build:typed.
/** 将输入转成单行文本。
 * @param {unknown} s 输入。
 * @returns {string} 清理后的文本；同步无副作用。 */
export function singleLineForQQ(s) {
    return String(s ?? '')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}
// 超长段落：先按次要标点拆，再按字符硬拆，保证不丢内容、不退回单条长消息。
// URL 会被当作不可拆分的原子，避免把 https://... 这种整条网页地址拆断。
/** 按原UTF-16长度规则拆长段，URL保持完整。
 * @param {unknown} segment 输入文本。
 * @param {unknown} max 长度上限。
 * @returns {string[]} 分段；空文本返回空数组，无IO。 */
export function splitLongSegment(segment, max) {
    const s = String(segment ?? '').trim();
    if (!s)
        return [];
    const safeMax = typeof max === 'number' && Number.isFinite(max) && max >= 1 ? Math.floor(max) : 500;
    if (s.length <= safeMax)
        return [s];
    const urlRe = /https?:\/\/[^\s，。；、]+/g;
    /** @type {string[]} */
    const urls = [];
    const masked = s.replace(urlRe, (m) => {
        urls.push(m);
        return `\u0000URL${urls.length - 1}\u0000`;
    });
    const raw = masked.split(/([，、；：,;:])/);
    const tokens = [];
    for (let i = 0; i < raw.length; i += 2) {
        tokens.push(((raw[i] ?? '') + (raw[i + 1] ?? '')).trim());
    }
    const out = [];
    let cur = '';
    // ⚠️ 占位符 \u0000URL<n>\u0000 必须是**不可切开的最小单位**。
    // 早先的实现对超长 token 直接按 safeMax 硬切，会把占位符拦腰截断
    // （如 "\u0000UR" + "L0\u0000"），后面的还原正则 \u0000URL(\d+)\u0000 就匹配不上 →
    // **URL 整条丢失 + 裸 NUL + 字面量 "URL0" 被发进 QQ 消息**（实测 13 个偏移里 5 个损坏）。
    // 这里改成按占位符边界切分，宁可某段略超 max 也绝不切碎占位符。
    const PLACEHOLDER_ANY = /\u0000URL\d+\u0000/;
    const PLACEHOLDER_ALL = /\u0000URL\d+\u0000/g;
    /** 把 token 切成 {text, isPlaceholder} 序列（占位符整体一块，绝不拆） */
    /**
   * @param {string} tok */
    const splitByPlaceholder = (tok) => {
        const parts = [];
        let last = 0;
        let m;
        PLACEHOLDER_ALL.lastIndex = 0;
        while ((m = PLACEHOLDER_ALL.exec(tok)) !== null) {
            if (m.index > last)
                parts.push({ text: tok.slice(last, m.index), isPlaceholder: false });
            parts.push({ text: m[0], isPlaceholder: true });
            last = m.index + m[0].length;
        }
        if (last < tok.length)
            parts.push({ text: tok.slice(last), isPlaceholder: false });
        return parts;
    };
    for (const tok of tokens) {
        if (!tok)
            continue;
        if (tok.length > safeMax) {
            if (cur) {
                out.push(cur);
                cur = '';
            }
            for (const piece of splitByPlaceholder(tok)) {
                // 占位符整块输出；普通文本仍按 safeMax 切
                if (piece.isPlaceholder) {
                    out.push(piece.text);
                    continue;
                }
                for (let i = 0; i < piece.text.length;) {
                    let end = Math.min(i + safeMax, piece.text.length);
                    // 绝不在代理对（emoji、部分生僻字）中间下刀：硬切会产生「半个 emoji」，
                    // 两个孤立代理各自成为一条 QQ 消息、永远无法再拼回，群友看到的就是乱码方块。
                    // 退一格把整个字符让给下一段；若退成空串就不退（safeMax 极小时），
                    // 宁可硬切也要保证循环一定前进。逻辑内联在此，函数保持自包含
                    // —— 离线测试直接验证导出的分段函数。
                    if (end < piece.text.length && end - i > 1) {
                        const last = piece.text.charCodeAt(end - 1);
                        if (last >= 0xd800 && last <= 0xdbff)
                            end -= 1;
                    }
                    out.push(piece.text.slice(i, end));
                    i += end > i ? end - i : safeMax;
                }
            }
        }
        else if (cur.length + tok.length <= safeMax) {
            cur += tok;
        }
        else {
            out.push(cur);
            cur = tok;
        }
    }
    if (cur)
        out.push(cur);
    return out
        .map((chunk) => chunk.replace(/\u0000URL(\d+)\u0000/g, (_, i) => urls[Number(i)] ?? ''))
        .filter(Boolean);
}
// 判断字符是否属于“中文汉字”范围，用于识别空格分句意图。
// 注意：这里只认汉字，不认中文标点/全角符号，避免“你好， 世界”这种 AI 排版空格被误拆。
/** 判断单字符是否在原汉字范围内。
 * @param {string} ch 字符。
 * @returns {boolean} 汉字判定；同步纯函数。 */
export function isCjkChar(ch) {
    if (!ch)
        return false;
    const code = ch.codePointAt(0);
    return ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xF900 && code <= 0xFAFF));
}
// 按“有意的空格”拆分：真人不会主动用空格，因此 AI 回复里的空格视为分条信号。
// 空格两侧只要有一侧是中文/中文标点，就按分条处理（包括中英文/数字之间的空格）。
// 注意：该逻辑只用于一代 reserved 的自动转发文本；二代 reserved2 不走这里，二代必须显式用数组分条。
/** 只在空格边界至少一侧为汉字时分条。
 * @param {unknown} src 输入。
 * @returns {string[]} 保留英文短语的分段；同步纯函数。 */
export function splitByCjkSpaces(src) {
    const tokens = String(src ?? '').split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length <= 1)
        return tokens;
    const groups = [];
    let cur = tokens[0];
    for (let i = 1; i < tokens.length; i++) {
        const prevLast = [...cur].pop() || '';
        const currFirst = [...tokens[i]][0] || '';
        // 空格两侧只要有一侧是汉字，就视为分条信号。
        if (isCjkChar(prevLast) || isCjkChar(currFirst)) {
            groups.push(cur);
            cur = tokens[i];
        }
        else {
            cur = cur + ' ' + tokens[i];
        }
    }
    if (cur)
        groups.push(cur);
    return groups;
}
// 新分句逻辑：分句权交给 AI。
// AI 用空格表示“这里要分成下一条消息”，桥接按空格拆条；
// 不想分条时用标点连接、不加空格即可。单条消息只做 maxReplyChars（默认 500 字）安全硬拆。
/** 规划旧式聊天分段。
 * @param {unknown} text 输入文本。
 * @param {{maxReplyChars?:unknown,burstEnabled?:unknown}|null|undefined} socialCfg 当前配置。
 * @returns {{main:string[],followUp:null}} 分段结果；不发送或等待。 */
export function planSocialTimeline(text, socialCfg) {
    const src = String(text ?? '').replace(/\r\n/g, '\n').trim();
    const rawMaxChars = Number(socialCfg?.maxReplyChars ?? 500);
    const maxChars = Number.isFinite(rawMaxChars) && rawMaxChars >= 1 ? Math.floor(rawMaxChars) : 500;
    const enabled = socialCfg?.burstEnabled !== false;
    if (!src)
        return { main: [], followUp: null };
    // 关闭分条：整条作为一条消息发送，只做安全硬拆
    if (!enabled) {
        return { main: splitLongSegment(src, maxChars).map(singleLineForQQ), followUp: null };
    }
    // 按空格（含换行）拆成候选消息；每个候选再按 maxChars 安全硬拆
    const parts = splitByCjkSpaces(src);
    if (parts.length <= 1) {
        return { main: splitLongSegment(parts[0] || src, maxChars).map(singleLineForQQ), followUp: null };
    }
    const main = [];
    for (const part of parts) {
        main.push(...splitLongSegment(part, maxChars).map(singleLineForQQ));
    }
    return { main: main.filter(Boolean), followUp: null };
}
