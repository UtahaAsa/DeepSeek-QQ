/** 已有原生范围校验器的消费声明；实现仍为受测的 MJS。 */
export interface NativeScopeEntry {readonly mode:'selected'|'all'|'disabled';readonly ids:readonly string[];readonly exclude:readonly string[];}
export interface NativeScope {readonly private:NativeScopeEntry;readonly groups:NativeScopeEntry;}
/** 校验输入并返回深冻结副本；非法输入抛出脱敏 SCOPE_INVALID，不修改输入。 */
export function normalizeNativeScope(value:unknown,options?:{allowEmpty?:boolean}):NativeScope;
/** 将旧列表归一化；空列表关闭范围，非法输入抛出 SCOPE_INVALID。 */
export function nativeScopeFromLists(privateIds:readonly string[],groupIds:readonly string[]):NativeScope;
/** 只检查范围，调用方仍须核验所属会话与权限；身份沿既有String转换。缺失范围拒绝，畸形范围可抛错，不替代normalizeNativeScope。 */
export function nativeScopeAllows(scope:unknown,kind:string,id:unknown):boolean;
/** 返回不含身份的计数摘要；无副作用。 */
export function nativeScopeSummary(scope:NativeScope):Record<string,unknown>;
