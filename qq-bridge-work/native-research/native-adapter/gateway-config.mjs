import { normalizeNativeScope, nativeScopeFromLists } from './scope-policy.mjs';
import { normalizeIdleSettings } from './idle-policy.mjs';
import { normalizeGroupAdminPermissions } from './native-group-admin.mjs';
import { normalizeFriendRequestPermissions } from './native-friend-requests.mjs';
import { normalizeQzoneSettings } from './native-qzone.mjs';
import { normalizeSelfProfilePermissions } from './native-self-profile.mjs';

/**
 * 规范化网关启动及热改配置；允许范围全关闭以保留登录和独立管理服务。
 * @param {object} value 完整许可及范围，旧单好友/单群格式继续兼容。
 * @param {object|null} previousTargets 只在未重述范围时复用本实例原范围。
 * @returns {object} 新对象；无I/O、无账号票据，不改变任何权限预算。
 * @throws {Error} GATEWAY_CONFIG_INVALID，不包含输入值。
 */
export function normalizeGatewayConfiguration(value, previousTargets = null) {
  try {
    const keys = ['friendUin', 'groupUin', 'scope', 'idleMessages', 'groupAdmin', 'friendRequests', 'qzone', 'selfProfile',
      'allowSend', 'receiveImages', 'sendImages', 'receiveVoice', 'sendVoice', 'readSelfAvatar', 'generateImages', 'useStickers', 'collectStickers'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).some(key => !keys.includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || typeof value.allowSend !== 'boolean'
        || ['receiveImages', 'sendImages', 'receiveVoice', 'sendVoice', 'readSelfAvatar', 'generateImages', 'useStickers', 'collectStickers'].some(key =>
          value[key] !== undefined && typeof value[key] !== 'boolean')) throw 0;
    const idleMessages = normalizeIdleSettings(value.idleMessages), groupAdmin = normalizeGroupAdminPermissions(value.groupAdmin);
    const friendRequests = normalizeFriendRequestPermissions(value.friendRequests), qzone = normalizeQzoneSettings(value.qzone);
    const selfProfile = normalizeSelfProfilePermissions(value.selfProfile); let targets;
    if (value.scope !== undefined) {
      if (value.friendUin !== undefined || value.groupUin !== undefined) throw 0;
      targets = normalizeNativeScope(value.scope, { allowEmpty: true });
    } else if (value.friendUin === undefined && value.groupUin === undefined && previousTargets) targets = previousTargets;
    else {
      if (![value.friendUin, value.groupUin].every(id => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id))) throw 0;
      targets = nativeScopeFromLists([value.friendUin], [value.groupUin]);
    }
    if ((value.sendImages || value.sendVoice || value.generateImages) && !value.allowSend || value.generateImages && !value.sendImages || value.collectStickers && !value.receiveImages
        || idleMessages.enabled && (!value.allowSend || targets.groups.mode === 'disabled')
        || groupAdmin.atAll && !value.allowSend || Object.values(groupAdmin).some(Boolean) && targets.groups.mode === 'disabled') throw 0;
    return { targets, idleMessages, groupAdmin, friendRequests, qzone, selfProfile, allowSend: value.allowSend,
      ...Object.fromEntries(['receiveImages', 'sendImages', 'receiveVoice', 'sendVoice', 'readSelfAvatar', 'generateImages', 'useStickers', 'collectStickers'].map(key => [key, value[key] === true])) };
  } catch { throw Object.assign(new Error('GATEWAY_CONFIG_INVALID'), { code: 'GATEWAY_CONFIG_INVALID' }); }
}
