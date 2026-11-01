// Generated from config/inputs.ts. Edit the TypeScript source and run build:typed.
/** @type {readonly ReasoningEffort[]} */
export const REASONING_EFFORT_OPTIONS = ['low', 'high', 'max'];
/** @type {ReasoningEffort} */
export const REASONING_EFFORT_DEFAULT = 'max';
/**
 * 归一化管理员字段，沿用空值与正安全整数的既有规则。
 * @param {unknown} value 配置或管理接口传入的值。
 * @returns {number|null} 正安全整数；空值返回null。
 * @throws {Error} 非数字、非正值或超过安全整数范围。
 * @note 同步纯函数；不读取账号或修改配置。
 */
export function normalizeOwnerQQ(value) {
    if (value === undefined || value === null)
        return null;
    const s = String(value).trim();
    if (!s)
        return null;
    if (!/^\d+$/.test(s))
        throw new Error('ownerQQ 必须是 QQ 号（正整数）');
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n <= 0)
        throw new Error('ownerQQ 必须是 QQ 号（正整数）');
    return n;
}
/**
 * 归一化白名单和黑名单列表，保留原有别名处理所依赖的数字字符串语义。
 * @param {unknown} value 输入列表。
 * @returns {string[]} 数字字符串数组；非数组返回空列表，保留顺序、重复项和前导零。
 * @note 同步纯函数；不授予权限，调用方决定空列表的策略。
 */
export function normalizeIdList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((v) => String(v).trim()).filter((v) => /^\d+$/.test(v));
}
/**
 * 校验本项目支持的思考强度。
 * @param {unknown} value 输入值，去除首尾空白并转小写。
 * @returns {ReasoningEffort} 明确受支持的强度。
 * @throws {Error} 未知或空值；由调用方决定是否回退。
 * @note 同步纯函数；不调用模型。
 */
export function normalizeReasoningEffort(value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (!REASONING_EFFORT_OPTIONS.some(option => option === v)) {
        throw new Error(`思考强度只能是 ${REASONING_EFFORT_OPTIONS.join(' / ')}`);
    }
    return v;
}
