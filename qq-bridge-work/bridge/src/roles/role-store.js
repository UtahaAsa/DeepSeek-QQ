// Generated from roles/role-store.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { GEN1_ROLE_LINE_RE, parseRoleSections, roleCharStats } from '../role-card.js';
import { ROLE_INJECT_MAX_CHARS_DEFAULT, applyRoleInjectLimit } from './role-policy.js';
/**
 * 管理所属实例的角色文件、摘要与注入上限，构造时不读写角色或配置。
 * @param {object} options directory/stateFile为固定角色目录与选择记录；读写回调沿用宿主的原子文件操作。
 * @returns {object} 列表、摘要、内容与选择记录方法，以及getInjectLimit/setInjectLimit；各实例状态独立。
 * @throws {Error} 内容及选择记录的IO失败沿用原异常；列表/摘要保留原容错行为。
 * @note 同步方法；调用者须在输入边界使用role-policy校验名称与内容；不启动服务或创建目录。
 */
export function createRoleStore({ directory: ROLES_DIR, stateFile: ROLE_STATE_FILE, readJsonSafe, atomicWriteJson, atomicWriteText }) {
    let roleInjectMaxChars = ROLE_INJECT_MAX_CHARS_DEFAULT;
    function roleFilePath(name) { return path.join(ROLES_DIR, name + '.md'); }
    function readRoleState() { return readJsonSafe(ROLE_STATE_FILE, { role: null, mode: 'active' }); }
    function writeRoleState(role, mode) { atomicWriteJson(ROLE_STATE_FILE, { role: role ?? null, mode: mode ?? 'active' }); }
    function listRoles() {
        try {
            return fs.readdirSync(ROLES_DIR)
                .filter((f) => f.endsWith('.md') && f !== 'README.md')
                .map((f) => f.slice(0, -3))
                .sort((a, b) => a.localeCompare(b, 'zh-CN'));
        }
        catch {
            return [];
        }
    }
    function firstMeaningfulLine(content) {
        for (const line of String(content ?? '').split('\n')) {
            const t = line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim();
            if (t)
                return t.slice(0, 80);
        }
        return '';
    }
    function roleWarnings(content, mode = 'v2') {
        const text = String(content ?? '');
        const warnings = [];
        const stats = roleCharStats(text);
        const injected = mode === 'v1' ? stats.v1 : stats.v2;
        if (injected > roleInjectMaxChars) {
            warnings.push(`超出注入上限：当前模式实际注入 ${injected} 字符，只有前 ${roleInjectMaxChars} 字符会进入提示词（可在配置里调 role.maxInjectChars）`);
        }
        // 只在「没有用模式标记分开」的小节上提示兜底过滤，避免对已正确标记的卡片误报。
        const untagged = parseRoleSections(text)
            .filter((section) => section.mode === 'all')
            .map((section) => section.lines.join('\n'))
            .join('\n');
        if (GEN1_ROLE_LINE_RE.test(untagged)) {
            warnings.push('未标记的小节里含一代仿真专用指令（[SILENT] / 空格分句 / 自动转发…），二代下这些行会被兜底过滤——建议把它们移到带 〔一代〕 标记的小节里');
        }
        if (/回复示例/.test(untagged) && /[\u4e00-\u9fff]\s+[\u4e00-\u9fff]/.test(untagged)) {
            warnings.push('“回复示例”节里的中文空格会被自动改写成逗号（二代不用空格分条），建议直接写逗号，或把该节标记为 〔一代〕');
        }
        return warnings;
    }
    function roleSummaries() {
        return listRoles().map((name) => {
            const file = roleFilePath(name);
            try {
                const stat = fs.statSync(file);
                const content = fs.readFileSync(file, 'utf8');
                const stats = roleCharStats(content);
                return {
                    name,
                    bytes: stat.size,
                    chars: content.length,
                    lines: content.split('\n').length,
                    mtime: stat.mtimeMs,
                    excerpt: firstMeaningfulLine(content),
                    // 两种模式各自实际会注入多少（已按 〔一代〕/〔二代〕 标记筛过）
                    injectedV1: Math.min(stats.v1, roleInjectMaxChars),
                    injectedV2: Math.min(stats.v2, roleInjectMaxChars),
                    charsV1: stats.v1,
                    charsV2: stats.v2,
                    hasModeTags: stats.v1Only > 0 || stats.v2Only > 0,
                    truncated: stats.v1 > roleInjectMaxChars || stats.v2 > roleInjectMaxChars,
                    warnings: roleWarnings(content).length,
                };
            }
            catch {
                return { name, bytes: 0, chars: 0, lines: 0, mtime: 0, excerpt: '', injectedV1: 0, injectedV2: 0, charsV1: 0, charsV2: 0, hasModeTags: false, truncated: false, warnings: 0 };
            }
        });
    }
    function readRoleContent(name) {
        return fs.readFileSync(roleFilePath(name), 'utf8');
    }
    function writeRoleContent(name, content) {
        fs.mkdirSync(ROLES_DIR, { recursive: true });
        atomicWriteText(roleFilePath(name), content + (content.endsWith('\n') ? '' : '\n'));
    }
    return Object.freeze({ listRoles, roleFilePath, roleWarnings, roleSummaries, readRoleContent, writeRoleContent, readRoleState, writeRoleState,
        getInjectLimit: () => roleInjectMaxChars, setInjectLimit: (value) => (roleInjectMaxChars = applyRoleInjectLimit(value)) });
}
