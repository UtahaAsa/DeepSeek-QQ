// Generated from roles/role-policy.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
export const ROLE_NAME_MAX = 40;
export const ROLE_CONTENT_MAX_BYTES = 64 * 1024;
export const ROLE_INJECT_MAX_CHARS_DEFAULT = 8000;
const ROLE_RESERVED_NAMES = new Set(['README']);
const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);
/**
 * 计算角色注入上限，保持原来的数值转换及范围规则。
 * @param {unknown} value 配置值。
 * @returns {number} 1000至20000之间的整数；非有限数回退8000。
 * @note 同步纯函数；不修改实例状态。
 */
export function applyRoleInjectLimit(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return ROLE_INJECT_MAX_CHARS_DEFAULT;
    return Math.min(20000, Math.max(1000, Math.round(n)));
}
/**
 * 按历史规则清理角色名，供命令入口与校验共用。
 * @param {unknown} name 输入角色名。
 * @returns {string} 仅含字母、数字、下划线、中文和横线的名称。
 * @note 同步纯函数；空值返回空字符串，完整校验由validateRoleName负责。
 */
export function sanitizeRoleName(name) {
    return String(name ?? '').replace(/[^\w\u4e00-\u9fff-]/g, '');
}
/**
 * 校验清理后的角色名，拒绝空名、超长名与Windows设备名。
 * @param {unknown} raw 输入角色名。
 * @returns {string} 校验后的名称。
 * @throws {Error} 不合法时保留原中文错误信息。
 * @note 同步纯函数；不访问文件系统。
 */
export function validateRoleName(raw) {
    const name = sanitizeRoleName(raw);
    if (!name)
        throw new Error('人格名不能为空（仅限中文 / 字母 / 数字 / 横线）');
    if (name.length > ROLE_NAME_MAX)
        throw new Error(`人格名过长（最多 ${ROLE_NAME_MAX} 字）`);
    if (ROLE_RESERVED_NAMES.has(name))
        throw new Error(`「${name}」是保留名称`);
    if (WINDOWS_RESERVED_NAMES.has(name.toUpperCase()))
        throw new Error(`「${name}」是系统保留名称（Windows 设备名），请换一个`);
    return name;
}
/**
 * 规范化角色正文并按UTF-8字节数检查上限。
 * @param {unknown} raw 输入内容。
 * @returns {string} 换行统一且去除首尾空白的正文。
 * @throws {Error} 正文为空或超过64KiB时保留原中文错误信息。
 * @note 同步纯函数；不保存角色文件。
 */
export function validateRoleContent(raw) {
    const content = String(raw ?? '').replace(/\r\n/g, '\n').trim();
    if (!content)
        throw new Error('人格内容不能为空');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > ROLE_CONTENT_MAX_BYTES) {
        throw new Error(`人格内容过长（${(bytes / 1024).toFixed(1)} KB，上限 ${ROLE_CONTENT_MAX_BYTES / 1024} KB）`);
    }
    return content;
}
