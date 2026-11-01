/**
 * 归一化初始提示词上限，保留原100至8000字符的配置规则。
 * @param {unknown} value 配置值。
 * @returns {number} 有效整数上限；非有限数或非正数回退2000。
 * @throws {TypeError} 无法数值转换的输入沿用原异常。
 * @note 同步纯函数，不修改配置。
 */
export function initialPromptLimit(value: unknown): number {
  const n=Number(value);
  return Number.isFinite(n)&&n>0?Math.min(8000,Math.max(100,Math.round(n))):2000;
}
/**
 * 清理操作者输入的BOM、行尾与控制字符，保留段落和Tab。
 * @param {unknown} raw 输入正文。
 * @returns {string} 清理后正文；不按上限截断。
 * @note 同步纯函数；保存和注入分别执行上限处理，避免加载时丢失历史内容。
 */
export function normalizeInitialPromptText(raw: unknown): string {
  return String(raw??'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim();
}
