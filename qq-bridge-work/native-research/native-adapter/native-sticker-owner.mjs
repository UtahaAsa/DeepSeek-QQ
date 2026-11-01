import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
const fail = () => new Error('STICKER_STAGE_UNVERIFIED');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** 已确认但被QQ持锁的自有暂存上限；仍逐文件核验归属、硬链接数和摘要。 */
export const STICKER_STAGE_MAX_FILES = 128;
/** 全部自有收藏暂存合计字节上限；结果未知和已确认等待解锁均计入。 */
export const STICKER_STAGE_MAX_BYTES = 64 * 1024 * 1024;
const fileName = /^[a-f0-9]{32}\.(png|jpeg|webp|gif)$/;
const directoryIsOwned = directory => fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink()
  && fs.realpathSync(directory).toLowerCase() === directory.toLowerCase();
const ordinary = file => { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail(); return stat; };
const parse = (file, parent, directory, fixture) => {
  if (ordinary(file).size > 32768) throw fail(); const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['protocol', 'kind', 'parent', 'directory', 'fixture', 'files'].includes(key))
      || value.protocol !== 1 || value.kind !== 'qq-native-sticker-stage' || value.parent !== parent || value.directory !== directory
      || value.fixture !== fixture || !Array.isArray(value.files) || value.files.length > STICKER_STAGE_MAX_FILES
      || value.files.some(row => !fileName.test(row.name ?? '') || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 8 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(row.sha256 ?? ''))) throw fail();
  if (value.files.reduce((total, row) => total + row.bytes, 0) > STICKER_STAGE_MAX_BYTES) throw fail();
  return value;
};
const verifyImage = (directory, row) => {
  if (!directoryIsOwned(directory)) throw fail();
  const file = path.resolve(directory, row.name);
  if (!file.startsWith(directory + path.sep)) throw fail();
  try { if (ordinary(file).size !== row.bytes || hash(fs.readFileSync(file)) !== row.sha256) throw fail(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  return true;
};

/**
 * 创建本宿主的有界收藏暂存和所有权清单；只接收已经验证的图片字节。
 * @param {object} options parent为所属数据目录，fixture区分隔离验证与真实宿主。
 * @returns {object} prepare/remove/close；所有路径由内部生成，不接收用户路径。
 * @note 每次先原子记录摘要清单再落图片；最多128张、单张8MiB、总计64MiB；失败保留可恢复证据。
 */
export function createNativeStickerOwner({ parent, fixture = false }) {
  const canonical = fs.realpathSync(parent);
  if (path.resolve(parent).toLowerCase() !== canonical.toLowerCase() || fs.lstatSync(parent).isSymbolicLink() || typeof fixture !== 'boolean') throw fail();
  const directory = fs.mkdtempSync(path.join(canonical, 'sticker-run-'));
  const metadata = path.join(directory, 'owner.json');
  let rows = [], closed = false, pending = null;
  const commitPending = () => {
    if (pending === null) return;
    const next = metadata + '.next';
    // 只续交本实例完整写入且内容未变的清单；未知、被替换或硬链接文件仍保留。
    if (!directoryIsOwned(directory) || ordinary(next).size !== Buffer.byteLength(pending)
        || fs.readFileSync(next, 'utf8') !== pending) throw fail();
    fs.renameSync(next, metadata); pending = null;
  };
  const persist = (files = rows) => {
    commitPending();
    const value = { protocol: 1, kind: 'qq-native-sticker-stage', parent: canonical, directory, fixture, files };
    const content = JSON.stringify(value);
    fs.writeFileSync(metadata + '.next', content, { flag: 'wx', mode: 0o600 }); pending = content; commitPending();
  }; persist();
  return Object.freeze({
    /** @param {Buffer} bytes 当前会话图片副本。@param {string} format 受控容器格式。@returns {string} 仅供原生收藏调用的所属路径。 */
    prepare(bytes, format) {
      if (closed || rows.length >= STICKER_STAGE_MAX_FILES || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8 * 1024 * 1024 ||
          rows.reduce((total, row) => total + row.bytes, 0) + bytes.length > STICKER_STAGE_MAX_BYTES || !['png', 'jpeg', 'gif', 'webp'].includes(format)) throw fail();
      const row = { name: randomBytes(16).toString('hex') + '.' + format, bytes: bytes.length, sha256: hash(bytes) };
      rows = [...rows, row]; persist(); const target = path.join(directory, row.name);
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); return target;
    },
    /** @param {string} file 本实例先前返回的所属路径。@returns {void} 仅摘要匹配时删除，不递归处理。 */
    remove(file) {
      if (closed || path.dirname(file) !== directory) throw fail();
      const row = rows.find(item => item.name === path.basename(file)); if (!row) throw fail();
      if (verifyImage(directory, row)) fs.unlinkSync(file);
      const remaining = rows.filter(item => item !== row); persist(remaining); rows = remaining;
    },
    close() {
      if (closed) return;
      for (const row of rows) if (verifyImage(directory, row)) fs.unlinkSync(path.join(directory, row.name));
      rows = []; persist(); fs.unlinkSync(metadata); fs.rmdirSync(directory); closed = true;
    },
  });
}

/**
 * 仅在自有父/worker租约证明旧宿主已不在时回收收藏暂存，不扫描QQ账号目录。
 * @param {object} options parent为租约所属目录；isolated复核双租约；fixture必须匹配清单。
 * @returns {object} examined/cleaned/preserved/complete；未知目录或摘要漂移保留，不伪称清理完成。
 * @note 最多32个根、每根最多两份有界清单及其图片并集；每份清单最多128张/64MiB，删除前核验全部归属。
 */
export function recoverNativeStickerOwners({ parent, isolated, fixture }) {
  if (typeof isolated !== 'function' || !isolated() || typeof fixture !== 'boolean') throw fail();
  const canonical = fs.realpathSync(parent), result = { examined: 0, cleaned: 0, preserved: 0, complete: true };
  const roots = fs.readdirSync(canonical, { withFileTypes: true }).filter(entry => /^sticker-run-[A-Za-z0-9]{6}$/.test(entry.name));
  if (roots.length > 32) throw fail();
  for (const root of roots) {
    result.examined++; const directory = path.join(canonical, root.name);
    try {
      if (!root.isDirectory() || root.isSymbolicLink() || !directoryIsOwned(directory) || !isolated()) throw fail();
      const files = fs.readdirSync(directory); if (files.length > STICKER_STAGE_MAX_FILES * 2 + 2 || !files.includes('owner.json')) throw fail();
      const records = [parse(path.join(directory, 'owner.json'), canonical, directory, fixture)];
      if (files.includes('owner.json.next')) records.push(parse(path.join(directory, 'owner.json.next'), canonical, directory, fixture));
      const rows = new Map(records.flatMap(value => value.files).map(row => [row.name, row]));
      if (files.some(name => !['owner.json', 'owner.json.next'].includes(name) && !rows.has(name))) throw fail();
      for (const row of rows.values()) verifyImage(directory, row);
      if (!isolated()) throw fail();
      for (const row of rows.values()) if (verifyImage(directory, row)) fs.unlinkSync(path.join(directory, row.name));
      for (const name of ['owner.json.next', 'owner.json']) if (files.includes(name)) fs.unlinkSync(path.join(directory, name));
      fs.rmdirSync(directory); result.cleaned++;
    } catch { result.preserved++; result.complete = false; }
  }
  return result;
}
