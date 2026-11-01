import { randomBytes } from 'node:crypto';
const refused = code => Object.assign(new Error(code), { code });
export const DEFAULT_IDLE_SETTINGS = Object.freeze({ enabled: false, idleMinutes: 30, cooldownMinutes: 120,
  dailyLimit: 3, globalDailyLimit: 12, quietEnabled: true, quietStart: '23:00', quietEnd: '08:00' });
const minuteOfDay = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
const dayAt = time => Math.floor((time + 8 * 3600000) / 86400000);
const groupKey = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value
  : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;

/**
 * 规范化北京时间的冷场策略，缺省关闭；未知字段、字符串布尔及超限数值拒绝。
 * @param {object|undefined|null} value 全量或部分设置；不修改输入。
 * @returns {object} 冻结设置，阈值5~1440分钟、冷却15~10080分钟、单群每日1~10次、全部群每日1~100次。
 * @throws {Error} IDLE_SETTINGS_INVALID；无I/O，不包含用户内容。
 */
export function normalizeIdleSettings(value) {
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_IDLE_SETTINGS, key)))) throw refused('IDLE_SETTINGS_INVALID');
  const settings = { ...DEFAULT_IDLE_SETTINGS, ...value };
  if (typeof settings.enabled !== 'boolean' || typeof settings.quietEnabled !== 'boolean') throw refused('IDLE_SETTINGS_INVALID');
  for (const [key, low, high] of [['idleMinutes', 5, 1440], ['cooldownMinutes', 15, 10080], ['dailyLimit', 1, 10], ['globalDailyLimit', 1, 100]]) {
    if (!Number.isSafeInteger(settings[key]) || settings[key] < low || settings[key] > high) throw refused('IDLE_SETTINGS_INVALID');
  }
  for (const key of ['quietStart', 'quietEnd']) if (typeof settings[key] !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings[key])) throw refused('IDLE_SETTINGS_INVALID');
  if (settings.quietEnabled && settings.quietStart === settings.quietEnd) throw refused('IDLE_SETTINGS_INVALID');
  return Object.freeze(settings);
}

/**
 * 原生网关冷场资格与一次性提交闸门；只记录活动时刻，不读正文、不调用模型或发送。
 * @param {object} options settings为明确选择；allowed(group)须核验当前授权及本次已观察群；now仅供隔离时钟。
 * @returns {object} observe/candidates/claim/validate/consume/close/snapshot；claim消耗每日及冷却预算，不自动退还。
 * @note 单JS线程，最多128群、一个并行草稿，令牌内存存活120秒；新活动、停止及日期回退令资格失效。
 */
export function createIdleGroupPolicy({ settings: input, allowed, now = Date.now }) {
  let settings = normalizeIdleSettings(input);
  const groups = new Map();
  let closed = false, pending = null, globalDay = null, globalAttempts = 0, highWater = 0, clockReversed = false;
  let claimed = 0, consumed = 0, rejected = 0;
  function clock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value < highWater) clockReversed = true;
    highWater = Math.max(highWater, value); return value;
  }
  function quiet(time) {
    if (!settings.quietEnabled) return false;
    const minute = ((Math.floor(time / 60000) + 480) % 1440 + 1440) % 1440;
    const start = minuteOfDay(settings.quietStart), end = minuteOfDay(settings.quietEnd);
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }
  function active(group, time) {
    return !closed && !clockReversed && settings.enabled && groupKey(group) !== null && allowed(String(group)) && !quiet(time);
  }
  function budget(item, time) {
    const day = dayAt(time);
    if (globalDay === null || day > globalDay) { globalDay = day; globalAttempts = 0; }
    if (item.day === null || day > item.day) { item.day = day; item.attempts = 0; }
    return day === globalDay && day === item.day && globalAttempts < settings.globalDailyLimit && item.attempts < settings.dailyLimit;
  }
  function observe(group, nativeId) {
    const time = clock(), key = groupKey(group);
    if (closed || !settings.enabled || key === null) return;
    let item = groups.get(key);
    if (!item) {
      if (groups.size >= 128) return;
      item = { activity: time, lastAttempt: null, day: null, attempts: 0, revision: 0, nativeId: null }; groups.set(key, item);
    }
    if (nativeId !== undefined && nativeId === item.nativeId) return;
    item.nativeId = nativeId ?? null; item.activity = time; item.revision++;
    if (pending?.group === key) pending = null;
  }
  function due(group, item, time) {
    return active(group, time) && budget(item, time) && time - item.activity >= settings.idleMinutes * 60000
      && (item.lastAttempt === null || time - item.lastAttempt >= settings.cooldownMinutes * 60000);
  }
  function candidates() {
    const time = clock(); if (pending && time >= pending.expiresAt) pending = null;
    if (pending) return [];
    return [...groups].filter(([group, item]) => due(group, item, time)).map(([group]) => group).slice(0, 16);
  }
  function claim(group) {
    const time = clock(), key = groupKey(group), item = groups.get(key);
    if (pending && time >= pending.expiresAt) pending = null;
    if (pending || !item || !due(key, item, time)) { rejected++; throw refused('IDLE_NOT_ALLOWED'); }
    item.lastAttempt = time; item.attempts++; globalAttempts++; claimed++;
    pending = { group: key, revision: item.revision, token: 'qqidle_' + randomBytes(24).toString('hex'), expiresAt: time + 120000 };
    return { claim: pending.token, expiresAt: pending.expiresAt };
  }
  function validate(group, token) {
    const time = clock(), key = groupKey(group), item = groups.get(key);
    if (!pending || pending.group !== key || pending.token !== token || time >= pending.expiresAt
        || !active(key, time) || item?.revision !== pending.revision) { rejected++; throw refused('IDLE_CLAIM_INVALID'); }
  }
  function consume(group, token) { validate(group, token); pending = null; consumed++; observe(group); }
  return Object.freeze({ observe, candidates, claim, validate, consume,
    /** 热改冷场阈值并废弃旧草稿资格，保留冷却与日预算。@param {object} value 新设置。@returns {void} 关闭后拒绝。 */
    configure(value) { if (closed) throw refused('IDLE_NOT_ALLOWED'); settings = normalizeIdleSettings(value); pending = null; for (const item of groups.values()) item.revision++; },
    close() { closed = true; pending = null; groups.clear(); },
    snapshot: () => ({ enabled: settings.enabled, trackedGroups: groups.size, pendingDraft: pending !== null,
      claimed, submitted: consumed, rejected, clockReversed, closed }) });
}
