// Generated from config/mode-inputs.ts. Edit the TypeScript source and run build:typed.
/** 内部模式别名；输入接受simulation，内部统一使用reserved2。 */
export const MODE_INPUT_ALIASES = Object.freeze({
    chat: 'chat',
    reserved: 'reserved',
    reserved2: 'reserved2',
    simulation: 'reserved2',
    'closed-agent': 'closed-agent'
});
export const VALID_MODES = Object.freeze([...new Set(Object.values(MODE_INPUT_ALIASES))]);
/** @param value 未验证的模式输入。@returns 内部模式名；未知输入返回null，不修改外部状态。 */
export function normalizeModeInput(value) {
    if (typeof value !== 'string')
        return null;
    const key = value.trim();
    return Object.prototype.hasOwnProperty.call(MODE_INPUT_ALIASES, key) ? MODE_INPUT_ALIASES[key] : null;
}
/** @param ns 未验证的DSH命名空间。@param key 设置键。@returns user层优先、value回退的原始值；缺失返回undefined。 */
export function settingFromDshNamespace(ns, key) {
    if (!ns || typeof ns !== 'object')
        return undefined;
    for (const layer of [ns.user, ns.value]) {
        if (!layer || typeof layer !== 'object' || Array.isArray(layer))
            continue;
        if (Object.prototype.hasOwnProperty.call(layer, key) && layer[key] !== undefined)
            return layer[key];
    }
    return undefined;
}
