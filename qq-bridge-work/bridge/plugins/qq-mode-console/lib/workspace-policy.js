/** QQ工作台的持久偏好协议；纯JSON数据，不包含凭据或运行中权限。 */
export const WORKSPACE_MODULES = Object.freeze([
  { id: 'messages', label: '文字聊天', description: '接收授权会话中的消息，并按角色回复。', options: { send: '发送文字' } },
  { id: 'images', label: '图片', description: '图片理解、绘图和QQ收藏表情。', options: { receive: '接收图片', send: '发送图片', generate: '生成图片', favorites: '使用QQ收藏表情', collect: '收藏聊天表情' } },
  { id: 'voice', label: '语音', description: '语音转写与语音回复。', options: { receive: '转写理解', send: '语音回复' } },
  { id: 'friends', label: '好友申请', description: '接收新的好友申请；是否自动通过单独选择。', options: { receive: '接收新申请', accept: '自动通过' } },
  { id: 'groups', label: '群管理', description: '仅在已授权群和当前账号权限内使用。', options: { atAll: '全体成员提醒', mute: '禁言', kick: '移出群聊' } },
  { id: 'profile', label: '自身资料', description: '读取头像和修改自己的资料，分别授权。', options: { readAvatar: '读取自身头像', nickname: '修改昵称', signature: '修改签名', birthday: '修改生日', avatar: '修改头像' } },
  { id: 'idle', label: '冷场互动', description: '按静默时段、冷却时间与每日预算主动发言。', options: { enabled: '冷场冒泡' } },
  { id: 'qzone', label: '说说', description: '纯文字发布，可见范围和每日次数单独设置。', options: { enabled: '发布说说' } },
].map(value => Object.freeze({ ...value, options: Object.freeze(value.options) })));

const invalid = () => { throw Object.assign(new Error('WORKSPACE_SETTINGS_INVALID'), { code: 'WORKSPACE_SETTINGS_INVALID' }); };
const record = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) invalid();
  }
};

/**
 * 生成无授权的默认偏好；开启模块不等于授予任何子功能权限。
 * @returns {object} 独立的JSON对象；无I/O或共享可变状态。
 */
export function defaultWorkspaceSettings() {
  return { schemaVersion: 1, reuseLogin: true,
    scope: { private: { mode: 'disabled', ids: [], exclude: [] }, groups: { mode: 'disabled', ids: [], exclude: [] } },
    modules: Object.fromEntries(WORKSPACE_MODULES.map(module => [module.id, { enabled: false,
      options: Object.fromEntries(Object.keys(module.options).map(key => [key, false])) }])),
    idle: { idleMinutes: 30, cooldownMinutes: 120, dailyLimit: 3, globalDailyLimit: 12,
      quietEnabled: true, quietStart: '23:00', quietEnd: '08:00' },
    qzone: { audience: 'self', cooldownMinutes: 120, dailyLimit: 3 } };
}

/**
 * 校验并复制工作台偏好，拒绝未知字段、getter、非布尔、重复号码和越界预算。
 * @param {object|undefined} value 完整持久偏好；undefined使用安全默认值。
 * @returns {object} 独立JSON副本，不含用户配置中的额外字段。
 * @throws {Error} WORKSPACE_SETTINGS_INVALID，不含原始输入。同步纯函数。
 */
export function normalizeWorkspaceSettings(value = defaultWorkspaceSettings()) {
  try {
    record(value, ['schemaVersion', 'reuseLogin', 'scope', 'modules', 'idle', 'qzone']);
    if (value.schemaVersion !== 1) invalid();
    const output = defaultWorkspaceSettings();
    if (value.reuseLogin !== undefined && typeof value.reuseLogin !== 'boolean') invalid();
    output.reuseLogin = value.reuseLogin ?? true;
    record(value.scope, ['private', 'groups']); let total = 0;
    for (const key of ['private', 'groups']) {
      const entry = value.scope[key]; record(entry, ['mode', 'ids', 'exclude']);
      if (!['disabled', 'selected', 'all'].includes(entry.mode)) invalid();
      for (const field of ['ids', 'exclude']) {
        const ids = entry[field];
        if (!Array.isArray(ids) || ids.length > 64 || Object.keys(ids).length !== ids.length) invalid();
        for (let index = 0; index < ids.length; index++) {
          const id = Object.getOwnPropertyDescriptor(ids, String(index))?.value;
          if (typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) invalid();
        }
        if (new Set(ids).size !== ids.length) invalid();
        total += ids.length;
      }
      if (entry.mode === 'selected' && !entry.ids.length || entry.mode !== 'selected' && entry.ids.length
          || entry.mode === 'disabled' && entry.exclude.length) invalid();
      output.scope[key] = { mode: entry.mode, ids: [...entry.ids], exclude: [...entry.exclude] };
    }
    if (total > 128) invalid();
    record(value.modules, WORKSPACE_MODULES.map(module => module.id));
    for (const module of WORKSPACE_MODULES) {
      const entry = value.modules[module.id]; record(entry, ['enabled', 'options']);
      if (typeof entry.enabled !== 'boolean') invalid();
      record(entry.options, Object.keys(module.options));
      output.modules[module.id].enabled = entry.enabled;
      for (const key of Object.keys(module.options)) {
        if (module.id === 'images' && ['favorites', 'collect'].includes(key) && entry.options[key] === undefined) continue;
        if (typeof entry.options[key] !== 'boolean') invalid();
        output.modules[module.id].options[key] = entry.options[key];
      }
    }
    for (const key of ['idle', 'qzone']) {
      record(value[key], Object.keys(output[key]));
      output[key] = { ...output[key], ...value[key] };
    }
    for (const [object, key, min, max] of [['idle', 'idleMinutes', 5, 1440], ['idle', 'cooldownMinutes', 15, 10080],
      ['idle', 'dailyLimit', 1, 10], ['idle', 'globalDailyLimit', 1, 100], ['qzone', 'cooldownMinutes', 5, 1440], ['qzone', 'dailyLimit', 1, 20]]) {
      const item = output[object][key]; if (!Number.isSafeInteger(item) || item < min || item > max) invalid();
    }
    if (typeof output.idle.quietEnabled !== 'boolean' || !['quietStart', 'quietEnd'].every(key =>
      typeof output.idle[key] === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(output.idle[key]))
      || output.idle.quietEnabled && output.idle.quietStart === output.idle.quietEnd
      || !['self', 'friends', 'public'].includes(output.qzone.audience)) invalid();
    return output;
  } catch { invalid(); }
}

/**
 * 只修改一个模块；暂停保留子偏好，全选或清空不改变其他模块。
 * @param {object} value 合法偏好。@param {string} moduleId 模块ID。
 * @param {'enable'|'disable'|'select-all'|'clear-all'} action 明确用户动作。
 * @returns {object} 独立副本；非法动作抛固定错误，无I/O。
 */
export function updateWorkspaceModule(value, moduleId, action) {
  const next = normalizeWorkspaceSettings(value);
  if (typeof moduleId !== 'string' || !Object.hasOwn(next.modules, moduleId)
      || !['enable', 'disable', 'select-all', 'clear-all'].includes(action)) invalid();
  const module = next.modules[moduleId];
  if (action === 'enable' || action === 'disable') module.enabled = action === 'enable';
  else {
    for (const key of Object.keys(module.options)) module.options[key] = action === 'select-all';
    if (action === 'select-all') module.enabled = true;
  }
  return next;
}

/**
 * 投影偏好对应的权限上限；依赖缺失只抑制权限，绝不自动开启其他模块。
 * @param {object} value 已校验或待校验偏好。
 * @returns {object} gateway配置候选，不代表已运行或原生提交授权。
 * @note 不管理熔断、预算、会话或任务资格；运行态须另外核验版本并应用。
 */
export function workspaceGatewayConfig(value) {
  const settings = normalizeWorkspaceSettings(value), modules = settings.modules;
  const on = (module, key) => modules[module].enabled && modules[module].options[key];
  const allowSend = on('messages', 'send'), groups = settings.scope.groups.mode !== 'disabled';
  const receiveImages = on('images', 'receive'), sendImages = allowSend && on('images', 'send');
  return { scope: settings.scope, allowSend, receiveImages, sendImages,
    receiveVoice: on('voice', 'receive'), sendVoice: allowSend && on('voice', 'send'),
    readSelfAvatar: on('profile', 'readAvatar'), generateImages: sendImages && on('images', 'generate'),
    useStickers: on('images', 'favorites'), collectStickers: receiveImages && on('images', 'collect'),
    idleMessages: { ...settings.idle, enabled: allowSend && groups && on('idle', 'enabled') },
    groupAdmin: { atAll: groups && allowSend && on('groups', 'atAll'), mute: groups && on('groups', 'mute'), kick: groups && on('groups', 'kick') },
    friendRequests: { receiveRequests: on('friends', 'receive'), autoAccept: on('friends', 'receive') && on('friends', 'accept') },
    selfProfile: { nickname: on('profile', 'nickname'), signature: on('profile', 'signature'), birthday: on('profile', 'birthday'),
      avatar: on('profile', 'avatar') },
    qzone: { ...settings.qzone, enabled: on('qzone', 'enabled') } };
}
