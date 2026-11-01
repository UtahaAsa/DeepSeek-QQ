import path from 'node:path';
import { createHash } from 'node:crypto';
import { nativeMethod } from './manual-login.mjs';
import { inspectNativeImage } from './native-image-store.mjs';
import { createNativeStickerOwner, STICKER_STAGE_MAX_FILES, STICKER_STAGE_MAX_BYTES } from './native-sticker-owner.mjs';

export const STICKER_ERROR_CODES = Object.freeze(['STICKER_DISABLED', 'STICKER_UNAVAILABLE', 'STICKER_INPUT_INVALID',
  'STICKER_NOT_FOUND', 'STICKER_BUSY', 'STICKER_LIMIT', 'STICKER_OUTCOME_UNKNOWN', 'STICKER_CLOCK_INVALID', 'STICKER_CANCELLED']);
const fail = code => Object.assign(new Error(code), { code });
const identifier = /^qqstk_[a-f0-9]{32}$/;
const keyPattern = /^(private|group):[1-9]\d{0,19}$/;
const field = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f\u200b-\u200f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
const day = value => Math.floor((value + 8 * 3600000) / 86400000);

/**
 * 当前登录账号的QQ收藏表情接口；QQ收藏列表是权威源，不以本地库冒充收藏成功。
 * @param {object} options service为已初始化的消息服务；authorize(key,operation)返回当前权限代次或null。
 *   copyImage(file,key)只返回当前会话有效图片句柄的独立字节；root为所属D盘临时目录。
 *   now/wait/timeoutMs仅用于确定性隔离验证；不接受调用方路径、URL或原生资源ID。
 * @returns {object} list/source/collect/close/snapshot；列表只输出无账号标识的随机摘要ID和备注。
 * @throws {Error} 固定STICKER错误；提交后无法通过QQ强制列表读回MD5时记结果未知并阻止重复提交。
 * @note 单事件循环；收藏最多2次/分钟、10次/小时、20次/北京时间日；不自动重复写入。
 */
export function createNativeStickers({ service, authorize, copyImage, root, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 5000 } = {}) {
  if (typeof authorize !== 'function' || typeof copyImage !== 'function' || !path.isAbsolute(root ?? '') ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000) throw fail('STICKER_INPUT_INVALID');
  let closed = false, busy = false, owned = null, latestTime = 0;
  const unknown = new Set(), starts = [], staged = new Set(), reclaimable = new Set(), stageSizes = new Map();
  let stagedBytes = 0;
  const reclaimConfirmed = () => {
    for (const file of reclaimable) {
      try {
        owned.remove(file); reclaimable.delete(file); staged.delete(file);
        stagedBytes -= stageSizes.get(file) ?? 0; stageSizes.delete(file);
      } catch { /* Windows共享冲突继续保留；不关闭SDK句柄，不放宽归属核验。 */ }
    }
  };
  const counts = { listReads: 0, collectAttempts: 0, confirmed: 0, alreadyCollected: 0, unknown: 0 };
  const guard = (key, operation) => {
    if (closed || !keyPattern.test(key ?? '')) throw fail('STICKER_DISABLED');
    const stamp = authorize(key, operation);
    if (typeof stamp !== 'string' || !stamp) throw fail('STICKER_DISABLED');
    return () => { if (closed || authorize(key, operation) !== stamp) throw fail('STICKER_CANCELLED'); };
  };
  async function bounded(task, submitted = false) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail(submitted ? 'STICKER_OUTCOME_UNKNOWN' : 'STICKER_UNAVAILABLE')), timeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  function normalize(value) {
    const md5 = field(value, 'md5'), resId = field(value, 'resId');
    if (typeof md5 !== 'string' || !/^[a-f0-9]{32}$/i.test(md5) || typeof resId !== 'string' || !resId || resId.length > 512 || /[\x00-\x20]/.test(resId)) return null;
    const id = 'qqstk_' + createHash('sha256').update(resId + ':' + md5.toLowerCase()).digest('hex').slice(0, 32);
    const rawUrl = field(value, 'url');
    let url = null;
    try { const parsed = new URL(rawUrl); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash && rawUrl.length < 2048) url = parsed.href; } catch {}
    return { id, md5: md5.toLowerCase(), desc: text(field(value, 'desc')), url };
  }
  async function read(key, operation = 'read') {
    const current = guard(key, operation);
    let result;
    try { result = await bounded(() => nativeMethod(service, 'fetchFavEmojiList')('', 1000, true, true)); }
    catch (error) { if (error.code === 'STICKER_UNAVAILABLE') throw error; throw fail('STICKER_UNAVAILABLE'); }
    current(); counts.listReads++;
    const values = field(result, 'emojiInfoList');
    if (field(result, 'result') !== 0 || !Array.isArray(values) || values.length > 1000) throw fail('STICKER_UNAVAILABLE');
    const entries = values.map(normalize).filter(Boolean);
    // 畸形单项不能默默消失，否则会将真实已有收藏误判为缺失并再次写入。
    if (entries.length !== values.length) throw fail('STICKER_UNAVAILABLE');
    return { entries, truncated: values.length === 1000 };
  }
  async function list(key, { query = '', count = 48 } = {}) {
    if (typeof query !== 'string' || query.length > 200 || !Number.isSafeInteger(count) || count < 1 || count > 1000) throw fail('STICKER_INPUT_INVALID');
    const result = await read(key), q = query.toLowerCase();
    const matched = result.entries.filter(entry => !q || entry.desc.toLowerCase().includes(q));
    return { total: result.entries.length, matched: matched.length, truncated: result.truncated || matched.length > count,
      source: 'qq_favorites', stickers: matched.slice(0, count).map(({ id, desc }) => ({ id, desc })) };
  }
  async function source(key, id) {
    if (!identifier.test(id ?? '')) throw fail('STICKER_INPUT_INVALID');
    const { entries } = await read(key), entry = entries.find(item => item.id === id);
    if (!entry) throw fail('STICKER_NOT_FOUND');
    if (!entry.url) throw fail('STICKER_UNAVAILABLE');
    // 只供所属桥接安全下载；模型路由必须去除URL，不能将其作为可发送图片。
    return { ...entry };
  }
  function reserve() {
    const time = now();
    if (!Number.isSafeInteger(time) || time < latestTime) throw fail('STICKER_CLOCK_INVALID'); latestTime = time;
    while (starts.length && day(starts[0]) < day(time) && time - starts[0] >= 3600000) starts.shift();
    if (starts.filter(start => time - start < 60000).length >= 2 || starts.filter(start => time - start < 3600000).length >= 10 ||
        starts.filter(start => day(start) === day(time)).length >= 20) throw fail('STICKER_LIMIT');
    starts.push(time); counts.collectAttempts++;
  }
  async function collect(key, file) {
    if (!/^qqimg_[a-f0-9]{32}$/.test(file ?? '')) throw fail('STICKER_INPUT_INVALID');
    const current = guard(key, 'collect'); if (busy) throw fail('STICKER_BUSY'); busy = true;
    let bytes, stagedFile, submitted = false, confirmed = false;
    try {
      reclaimConfirmed(); current();
      // 收藏前确保本版本存在该方法；不可在盲调用失败后重试不同参数。
      const add = nativeMethod(service, 'addFavEmoji');
      bytes = await copyImage(file, key); current();
      const info = inspectNativeImage(bytes), md5 = info.md5.toLowerCase();
      const before = await read(key, 'collect'); current();
      const existing = before.entries.find(item => item.md5 === md5);
      if (existing) { counts.alreadyCollected++; return { collected: true, confirmed: true, submitted: false, alreadyCollected: true, stickerId: existing.id }; }
      if (before.truncated) throw fail('STICKER_LIMIT');
      if (unknown.has(md5) || unknown.size >= 32) throw fail('STICKER_OUTCOME_UNKNOWN');
      if (staged.size - reclaimable.size >= 2 || staged.size >= STICKER_STAGE_MAX_FILES || stagedBytes + bytes.length > STICKER_STAGE_MAX_BYTES) throw fail('STICKER_LIMIT');
      reserve();
      if (!owned) owned = createNativeStickerOwner({ parent: root });
      stagedFile = owned.prepare(bytes, info.format); staged.add(stagedFile); stageSizes.set(stagedFile, bytes.length); stagedBytes += bytes.length; current();
      submitted = true;
      await bounded(() => add({ emojiId: '', packageId: 0, emojiPath: stagedFile, fileSize: String(bytes.length),
        fileName: path.basename(stagedFile), md5, isMarkFace: false, isOrigin: true }), true);
      current();
      for (const delay of [300, 700, 1500]) {
        await wait(delay); current();
        const after = await read(key, 'collect'); current();
        const found = after.entries.find(item => item.md5 === md5);
        if (found) { confirmed = true; counts.confirmed++; unknown.delete(md5); return { collected: true, confirmed: true,
          submitted: true, alreadyCollected: false, stickerId: found.id }; }
      }
      throw fail('STICKER_OUTCOME_UNKNOWN');
    } catch (error) {
      if (submitted && !confirmed) { if (bytes) unknown.add(createHash('md5').update(bytes).digest('hex')); counts.unknown++; throw fail('STICKER_OUTCOME_UNKNOWN'); }
      if (STICKER_ERROR_CODES.includes(error.code)) throw error;
      throw fail('STICKER_UNAVAILABLE');
    } finally {
      if (bytes) bytes.fill(0);
      // 未知提交保留所属暂存，避免QQ异步读取已提交文件时被提前删除；关闭时统一清理。
      if (stagedFile && (!submitted || confirmed)) {
        reclaimable.add(stagedFile); reclaimConfirmed();
      }
      busy = false;
    }
  }
  async function close() {
    closed = true;
    const deadline = Date.now() + 7000;
    while (busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (busy) throw fail('STICKER_BUSY');
    if (owned) { owned.close(); owned = null; staged.clear(); reclaimable.clear(); stageSizes.clear(); stagedBytes = 0; }
  }
  return Object.freeze({ list, source, collect, close, snapshot: () => ({ ...counts, busy, closed, stagedFiles: staged.size,
    stagedBytes, confirmedWaitingCleanup: reclaimable.size, pendingStages: staged.size - reclaimable.size }) });
}
