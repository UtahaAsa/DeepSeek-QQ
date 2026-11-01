const invalid = () => Object.assign(new Error('SCOPE_INVALID'), { code: 'SCOPE_INVALID' });
const validId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const objectWithKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));

/**
 * 规范化独立私聊/群聊范围；全部模式不枚举联系人，仅接受所属原生会话在线事件。
 * @param {object} value private/groups分别为{mode:selected|all|disabled,ids:string[],exclude:string[]}。
 * @param {object} options allowEmpty仅用于兼容底层空白名单的拒绝语义，控制台配置默认拒绝全关闭。
 * @returns {object} 深度冻结的副本；每列表最多64项，四个列表合计最多128项，不接受重复或多余字段。
 * @throws {Error} SCOPE_INVALID；不含号码。纯函数，无I/O，单JS线程且不修改输入。
 */
export function normalizeNativeScope(value, { allowEmpty = false } = {}) {
  if (!objectWithKeys(value, ['private', 'groups'])) throw invalid();
  const result = {}; let total = 0, enabled = false;
  for (const key of ['private', 'groups']) {
    const entry = value[key];
    if (!objectWithKeys(entry, ['mode', 'ids', 'exclude']) || !['selected', 'all', 'disabled'].includes(entry.mode)) throw invalid();
    const lists = {};
    for (const field of ['ids', 'exclude']) {
      const values = entry[field];
      if (!Array.isArray(values) || values.length > 64 || values.some(id => !validId(id)) || new Set(values).size !== values.length) throw invalid();
      total += values.length; lists[field] = Object.freeze([...values]);
    }
    if (entry.mode !== 'selected' && lists.ids.length) throw invalid();
    if (entry.mode === 'disabled' && lists.exclude.length) throw invalid();
    if (entry.mode === 'selected' && !lists.ids.length) throw invalid();
    enabled ||= entry.mode !== 'disabled';
    result[key] = Object.freeze({ mode: entry.mode, ...lists });
  }
  if (total > 128 || (!enabled && !allowEmpty)) throw invalid();
  return Object.freeze(result);
}

/**
 * 将旧的显式列表转为同等范围；空列表表示关闭，绝不解释为全部。
 * @param {string[]} privateIds 旧私聊列表；数字需由既有边界先转换为字符串。
 * @param {string[]} groupIds 旧群列表。
 * @returns {object} 规范化冻结范围，可同时关闭；非法输入抛SCOPE_INVALID，无I/O。
 */
export function nativeScopeFromLists(privateIds, groupIds) {
  return normalizeNativeScope(Object.fromEntries([['private', privateIds], ['groups', groupIds]].map(([key, ids]) =>
    [key, { mode: Array.isArray(ids) && ids.length ? 'selected' : 'disabled', ids, exclude: [] }])), { allowEmpty: true });
}

/**
 * 检查已规范化范围；排除名单优先，不推断用户关系、群管理身份或已观察状态。
 * @param {object} scope normalizeNativeScope的结果。
 * @param {string} kind private/group。
 * @param {string|number} id 规范十进制身份；不允许前导零或不安全整数。
 * @returns {boolean} 仅表示配置允许；执行方仍须重新核验所属原生会话及操作权限。纯函数。
 */
export function nativeScopeAllows(scope, kind, id) {
  if (typeof id === 'number' && (!Number.isSafeInteger(id) || id <= 0)) return false;
  const text = String(id), entry = scope?.[kind === 'private' ? 'private' : kind === 'group' ? 'groups' : ''];
  return validId(text) && !!entry && !entry.exclude.includes(text)
    && (entry.mode === 'all' || (entry.mode === 'selected' && entry.ids.includes(text)));
}

/**
 * 不投影号码的控制台摘要。
 * @param {object} scope 已规范化范围。
 * @returns {object} 仅模式与计数；不泄露号码，无I/O。
 */
export function nativeScopeSummary(scope) {
  return Object.fromEntries(['private', 'groups'].map(key => [key, { mode: scope[key].mode,
    selectedCount: scope[key].ids.length, excludedCount: scope[key].exclude.length }]));
}
