import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { roleCharStats } from '../bridge/src/role-card.js';

const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 40 && name === name.trim() &&
  !/[\x00-\x1f\\/:*?"<>|]/.test(name) && !name.includes('..') && !/[. ]$/.test(name);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function readCard(root, name) {
  if (!validName(name)) throw Error();
  const directory = fs.lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error();
  const file = path.join(root, name + '.md'), info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw Error();
  const bytes = fs.readFileSync(file);
  if (bytes.length > 65536) throw Error();
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { content, bytes: bytes.length, sha256: digest(bytes) };
}

/**
 * 只读枚举组件角色库，比较运行副本；不保存、不选用、不覆盖卡片。
 * @param {object} options libraryRoot固定为组件bridge/roles，runtimeRoot为自有运行roles目录。
 * @returns {function(string,object=):Promise<object>} list返回有界目录，content只读目录内合法Markdown。
 * @throws {Error} 无法读取、链接、越界、无效UTF-8或超限仅返回固定错误；同步文件读取在异步接口内执行。
 * @note 不返回本机路径；README不作为卡片；最多128张，每张64KiB。内容始终作为文字处理。
 */
export function createRoleLibrary({ libraryRoot, runtimeRoot }) {
  return async (operation, input = {}) => {
    try {
      const directory = fs.lstatSync(libraryRoot);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error();
      const names = fs.readdirSync(libraryRoot).filter(file => file.endsWith('.md') && file.toLowerCase() !== 'readme.md')
        .map(file => file.slice(0, -3)).filter(validName).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      if (names.length > 128) throw Error();
      const entry = name => {
        const card = readCard(libraryRoot, name); let runtimeRelation = 'missing';
        if (runtimeRoot && fs.existsSync(path.join(runtimeRoot, name + '.md'))) {
          try { runtimeRelation = readCard(runtimeRoot, name).sha256 === card.sha256 ? 'same' : 'different'; }
          catch { runtimeRelation = 'unavailable'; }
        }
        return { name, ...card, runtimeRelation, stats: roleCharStats(card.content) };
      };
      if (operation === 'list') { const entries = names.flatMap(name => {
        try { const { content, ...item } = entry(name); return [item]; } catch { return []; }
      }); return { ok: true, available: true, entries, skipped: names.length - entries.length }; }
      if (operation !== 'content' || !validName(input.name) || !names.includes(input.name)) throw Error();
      return { ok: true, ...entry(input.name) };
    } catch { throw Error('ROLE_LIBRARY_UNAVAILABLE'); }
  };
}
