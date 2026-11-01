// Generated from role-card.ts. Edit the TypeScript source and run build:typed.
import { truncateText } from './md-to-plain.js';
// 人格卡（roles/<名称>.md）的解析与「按仿真模式取用」。
//
// 为什么要分模式：
//   一代仿真（reserved）用空格分条、用 [SILENT] 表示沉默；
//   二代仿真（reserved2）必须用工具发言（qq_send_message 的数组分条），没有 [SILENT]。
//   同一张人格卡被两种模式共用时，一代专属指令会与二代工具协议冲突。
// 以前靠 currentRoleHintV2() 对正文做「逐行猜测 + 正则过滤」，既容易误伤又说不清边界。
//
// 现在改为显式标记：在标题里写模式，桥接只取当前模式适用的小节。
//   ## 表情包体系 〔二代〕      → 只在 reserved2 注入
//   ## 分条方式 〔一代〕        → 只在 reserved/chat 注入
//   ## 你是谁                   → 两种模式都注入
// 标记会在注入前从标题里去掉，模型看到的始终是干净的小节标题。
export const ROLE_INJECT_MODES = ['v1', 'v2'];
// 模式标记：`〔二代〕` / `[v2]` / `（reserved2）` 等写法都认。
const MODE_TAGS = [
    { mode: 'v2', re: /[\[〔（(]\s*(?:二代|2\s*代|v2|reserved2)\s*[\]〕）)]/gi },
    { mode: 'v1', re: /[\[〔（(]\s*(?:一代|1\s*代|v1|reserved)\s*[\]〕）)]/gi },
];
function detectMode(heading) {
    for (const tag of MODE_TAGS) {
        tag.re.lastIndex = 0;
        if (tag.re.test(heading))
            return tag.mode;
    }
    return 'all';
}
function stripModeTags(heading) {
    let out = String(heading);
    for (const tag of MODE_TAGS) {
        tag.re.lastIndex = 0;
        out = out.replace(tag.re, '');
    }
    return out.replace(/[ \t]+$/, '').replace(/[ \t]{2,}/g, ' ').trim();
}
/**
 * 按标题把人格卡拆成小节。
 * @returns {{mode: 'all'|'v1'|'v2', heading: string|null, lines: string[]}[]}
 */
export function parseRoleSections(text) {
    const sections = [];
    let current = null;
    for (const line of String(text ?? '').split('\n')) {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (!heading) {
            if (!current) {
                current = { mode: 'all', heading: null, lines: [] };
                sections.push(current);
            }
            current.lines.push(line);
            continue;
        }
        const title = stripModeTags(heading[2]);
        current = { mode: detectMode(heading[2]), heading: title, lines: [`${heading[1]} ${title}`] };
        sections.push(current);
    }
    return sections;
}
/**
 * 取出某次仿真真正要注入的人格文本（已去掉模式标记）。
 * @param {'v1'|'v2'} mode
 */
export function selectRoleText(text, mode) {
    const want = mode === 'v1' ? 'v1' : 'v2';
    return parseRoleSections(text)
        .filter((section) => section.mode === 'all' || section.mode === want)
        .map((section) => section.lines.join('\n'))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/**
 * 报告每个小节在当前模式下是否会被注入，供控制台预览。
 * @param {'v1'|'v2'} mode
 */
export function roleSectionReport(text, mode) {
    const want = mode === 'v1' ? 'v1' : 'v2';
    return parseRoleSections(text).map((section) => ({
        heading: section.heading ?? '(开头部分)',
        mode: section.mode,
        injected: section.mode === 'all' || section.mode === want,
        chars: section.lines.join('\n').trim().length,
    }));
}
/** 统计各模式的字符数，用于控制台提示「去掉另一模式的专属小节后还剩多少」。 */
export function roleCharStats(text) {
    const source = String(text ?? '');
    const sections = parseRoleSections(source);
    const sum = (list) => list.reduce((total, section) => total + section.lines.join('\n').trim().length, 0);
    return {
        total: source.length,
        common: sum(sections.filter((section) => section.mode === 'all')),
        v1Only: sum(sections.filter((section) => section.mode === 'v1')),
        v2Only: sum(sections.filter((section) => section.mode === 'v2')),
        v1: selectRoleText(source, 'v1').length,
        v2: selectRoleText(source, 'v2').length,
    };
}
// 一代仿真遗留指令：未加模式标记时，这些行在二代下会被兜底过滤。
// 正确做法是给所在小节加上 〔一代〕 标记。
export const GEN1_ROLE_LINE_RE = /\[SILENT\]|空格分隔|按空格|用空格|空格分句|空格代表|自动转发|回复会自动|输出\s*\[SILENT\]/i;
/**
 * 判断单个字符是否为中文或中文标点，不做语言或身份推断。
 * @param {string} ch 待检查字符，空值返回false。
 * @returns {boolean} 是否属于既有中文码点范围；同步纯函数。
 */
export function isCjkLikeChar(ch) {
    if (!ch)
        return false;
    const code = ch.codePointAt(0);
    return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xF900 && code <= 0xFAFF) || (code >= 0x3000 && code <= 0x303F);
}
function convertExampleSpacesToComma(line) {
    const chars = Array.from(String(line ?? ''));
    const blocked = new Set(['/', '\\', '(', ')', '[', ']', '{', '}', '"', "'", '<', '>', '|', '&', '=', ':', ';', ',', '.', '。', '，', '、']);
    let out = '';
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i], prev = chars[i - 1], next = chars[i + 1];
        if ((ch === ' ' || ch === '\t') && (isCjkLikeChar(prev) || isCjkLikeChar(next)) && !blocked.has(prev) && !blocked.has(next))
            out += '，';
        else
            out += ch;
    }
    return out;
}
/**
 * 渲染主程序实际注入的角色正文，供运行与本机预览共用。
 * @param {string} text 原始角色卡；不会修改或执行其内容。
 * @param {'v1'|'v2'} mode 普通聊天/一代取v1，二代取v2。
 * @param {number} maxChars UTF-16注入上限；切点不拆代理对。
 * @returns {string} 先按模式筛选并截断，再执行既有二代遗留指令/示例兼容处理。
 * @note 同步纯函数；不包含桥接额外提示，角色内容不能授予QQ权限。
 */
export function renderRoleInjection(text, mode, maxChars) {
    const selected = selectRoleText(text, mode);
    const raw = selected.length > maxChars ? truncateText(selected, maxChars) : selected;
    if (mode === 'v1' || !raw)
        return raw;
    const kept = [];
    let inExampleSection = false;
    for (const line of raw.split('\n')) {
        if (/^##\s*.*回复示例/.test(line)) {
            inExampleSection = true;
            kept.push(line.replace(/（空格代表前后分两条消息回答）/, '（示例中已用逗号表示停顿；想分多条请用数组）'));
            continue;
        }
        if (inExampleSection && /^##\s/.test(line))
            inExampleSection = false;
        if (inExampleSection)
            kept.push(convertExampleSpacesToComma(line));
        else if (!GEN1_ROLE_LINE_RE.test(line))
            kept.push(line);
    }
    return kept.join('\n');
}
