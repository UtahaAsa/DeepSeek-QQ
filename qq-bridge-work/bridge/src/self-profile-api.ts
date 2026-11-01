/// <reference types="node" />
import type {ProfileApiDependencies,ProfileGrant,ProfileInput,ProfileField,NativeReceiptView} from './native/operation-contracts.js';
interface BirthdayInput {year:number;month:number;day:number;}
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SENSITIVE_RE } from './sensitive.js';
import { normalizeSelfProfilePermissions } from '../../native-research/native-adapter/native-self-profile.mjs';

const fail = (code:string) => Object.assign(new Error(code), { code });
const fields:ProfileField[] = ['nickname', 'signature', 'birthday', 'avatar'];
const labels = { nickname: '昵称', signature: '个性签名', birthday: '生日', avatar: '头像' };
const token = (value:unknown):value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (left:unknown, right:unknown) => token(left) && token(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const configuration = (permission:unknown) => JSON.stringify(normalizeSelfProfilePermissions(permission));

/**
 * 为当前普通聊天签发四个独立字段的一次性自身资料资格，构造无I/O。
 * @param {object} options permission来自本机操作员；context为当前会话/角色/策略版本，verify重验原生当前聊天与字段许可。
 *   perform仅转交当前聊天、固定字段和值；safeText审计已知令牌；rememberToken接既有出站脱敏集合。
 * @returns {object} hint/update/cancel/close；十分钟、最多128个聊天，每字段一次，新提示撤销旧预检。
 * @note 只能改本次登录账号；不能传账号/路径/URL头像。清除资格不能回滚已经交给原生的写入，不自动重试。
 *   头像准备未提交仅接收两个固定reason；提交后的unknown不能转换为not_submitted。
 */
export function createSelfProfileApi({ permission, context, verify, perform, safeText, rememberToken = () => {}, now = Date.now }:ProfileApiDependencies) {
  if (![permission, context, verify, perform, safeText, rememberToken, now].every(value => typeof value === 'function')) throw fail('SELF_PROFILE_API_OPTIONS_INVALID');
  let closed = false; const versions = new Map<string,ProfileGrant>();
  function hint(key:string) {
    if (closed || !/^(private|group):[1-9]\d{0,19}$/.test(key ?? '')) return '';
    const stamp = context(key), config = configuration(permission()), enabled = fields.filter(field => permission()?.[field] === true), time = now();
    if (!enabled.length || typeof stamp !== 'string' || !stamp) return '';
    for (const [name, grant] of versions) if (time < grant.createdAt || time - grant.createdAt >= 600000) versions.delete(name);
    if (!versions.has(key) && versions.size >= 128) return '';
    const grant = { context: stamp, config, createdAt: time, tokens: new Map<ProfileField,string>() };
    versions.set(key, grant);
    const credentials = enabled.map(field => {
      const value = randomBytes(32).toString('hex'); grant.tokens.set(field, value); rememberToken(key + ':' + field, value);
      return field + '：' + value;
    }).join('\n');
    return '\n【本轮自身QQ资料能力】本机已允许这些字段：' + enabled.map(field => labels[field]).join('、')
      + '。只读昵称/签名/生日时用qq_get_self_profile(key,field,featureToken)，不要把查询变成修改。合适时可自行调用 qq_update_self_profile(key,field,value,profileToken)，只能改当前登录的你自己，不接受目标账号。'
      + '昵称/签名用纯文字（昵称非空，签名可空清除）；生日用{year,month,day}整数；头像用当前聊天有效qqimg_句柄；需要调整位置时先qq_prepare_self_avatar取得裁剪预览和新句柄。修改前自动保存当前可读取头像，恢复时先qq_get_self_avatar_backups，再把有效qqavatar_备份编号作为avatar的value。禁止传路径/URL或编造编号。'
      + '恢复旧头像前也会备份当前头像；返回backupId是恢复前的图，restoredFrom是本次使用的旧备份，不要混淆。不要把聊天原文、成员资料、号码、凭据或资格写入资料。每字段本轮仅一次，失败或未知不得自动重试。observed只说明定向读回相符，accepted只表示原生受理，头像实际显示仍需确认，不要夸大结果。'
      + '\n各字段资料资格（不可公开）：\n' + credentials + '\n';
  }
  async function update(input:unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 4
        || Object.keys(input).some(key => !['key', 'field', 'value', 'profileToken'].includes(key))) throw fail('SELF_PROFILE_API_INPUT_INVALID');
    const { key, field, value, profileToken } = input as ProfileInput, grant = versions.get(key), time = now();
    if (closed || !grant || !fields.includes(field) || !equal(profileToken, grant.tokens.get(field))
        || context(key) !== grant.context || configuration(permission()) !== grant.config || permission()?.[field] !== true
        || time < grant.createdAt || time - grant.createdAt >= 600000) throw fail('SELF_PROFILE_API_NOT_AUTHORIZED');
    if (field === 'avatar') {
      if (typeof value !== 'string' || !/^(?:qqimg|qqavatar)_[a-f0-9]{32}$/.test(value)) throw fail('SELF_PROFILE_API_INPUT_INVALID');
    } else if (field === 'birthday') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
          || Object.keys(value).some(key => !['year', 'month', 'day'].includes(key))
          || ![(value as BirthdayInput).year, (value as BirthdayInput).month, (value as BirthdayInput).day].every(Number.isSafeInteger) || (value as BirthdayInput).year < 1900 || (value as BirthdayInput).year > 2100
          || (value as BirthdayInput).month < 1 || (value as BirthdayInput).month > 12 || (value as BirthdayInput).day < 1 || (value as BirthdayInput).day > 31) throw fail('SELF_PROFILE_API_INPUT_INVALID');
      const date = new Date(Date.UTC((value as BirthdayInput).year, (value as BirthdayInput).month - 1, (value as BirthdayInput).day));
      if (date.getUTCMonth() + 1 !== (value as BirthdayInput).month || date.getUTCDate() !== (value as BirthdayInput).day) throw fail('SELF_PROFILE_API_INPUT_INVALID');
    } else if (typeof value !== 'string' || !value.isWellFormed() || value !== value.trim() || field === 'nickname' && !value
        || Array.from(value).length > (field === 'nickname' ? 64 : 280)
        || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
        || value.includes(profileToken) || SENSITIVE_RE.test(value) || safeText(value) !== true) throw fail('SELF_PROFILE_API_INPUT_INVALID');
    grant.tokens.delete(field);
    let subject:NativeReceiptView|null;
    try { subject = await verify(key, field) as NativeReceiptView|null; } catch { throw fail('SELF_PROFILE_API_NOT_AUTHORIZED'); }
    if (closed || versions.get(key) !== grant || subject?.authorized !== true || subject.field !== field
        || context(key) !== grant.context || configuration(permission()) !== grant.config
        || now() < grant.createdAt || now() - grant.createdAt >= 600000) throw fail('SELF_PROFILE_API_NOT_AUTHORIZED');
    let result:NativeReceiptView|null;
    try { result = await perform(key, field, value) as NativeReceiptView|null; } catch { throw fail('SELF_PROFILE_UPDATE_UNCONFIRMED'); }
    const observed = ['unchanged', 'observed'].includes(result?.outcome as string);
    const notSubmitted = field === 'avatar' && result?.outcome === 'not_submitted'
      && ['AVATAR_BACKUP_UNAVAILABLE','AVATAR_PREPARATION_UNAVAILABLE'].includes(result!.reason as string);
    if (!(['unchanged', 'observed', 'accepted', 'rejected', 'unknown'].includes(result?.outcome as string) || notSubmitted)
        || result!.submitted !== !['unchanged','not_submitted'].includes(result!.outcome as string) || result!.confirmed !== observed
        || observed && (field === 'avatar' || result!.confirmation !== 'forced_self_field_read')) throw fail('SELF_PROFILE_UPDATE_UNCONFIRMED');
    return { field, outcome: result!.outcome, submitted: result!.submitted, confirmed: result!.confirmed,
      ...(notSubmitted ? { reason: result!.reason } : {}),
      ...(field === 'avatar' && /^qqavatar_[a-f0-9]{32}$/.test((result!.backupId ?? '') as string)
        ? { backupId: result!.backupId, restoration: result!.restoration === true,
          ...(/^qqavatar_[a-f0-9]{32}$/.test((result!.restoredFrom ?? '') as string) ? { restoredFrom: result!.restoredFrom } : {}) } : {}),
      ...(observed ? { confirmation: 'forced_self_field_read' } : {}),
      instruction: notSubmitted ? (result!.reason === 'AVATAR_BACKUP_UNAVAILABLE' ? '旧头像备份未完成，因此本次没有向QQ提交头像修改。'
        : '头像上传前的准备未完成，因此本次没有向QQ提交头像修改。') + '对应字段资格已消耗，不要自动重试；修复后需要新的明确请求。'
        : observed ? '本次强制定向读回与请求值一致；不代表其它QQ客户端已刷新，不重复修改。'
        : result!.outcome === 'accepted' ? '原生已受理，但实际显示效果未确认，不可声称已经完成，不重复修改。'
          : '被拒绝或结果未知，不可声称已经完成，不要自动重试。' };
  }
  return Object.freeze({ hint, update, cancel: () => versions.clear(), close: () => { closed = true; versions.clear(); } });
}
