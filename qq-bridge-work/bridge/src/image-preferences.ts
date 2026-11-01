/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { normalizeImageProviderConfig } from './image-provider.js';

/**
 * 只持久化已校验的非敏感生图参数，密钥始终不入盘。
 * @param {string} file 所属state目录的固定偏好文件。
 * @returns {object} load返回合法参数或null；save只接受参数白名单，拒绝密钥和未知字段。
 * @note 同步原子替换；不会调用供应商或恢复任何凭据，损坏文件不会被load覆盖。
 */
export function createImagePreferences(file:string) {
  const checkFile = () => {
    if (!fs.existsSync(file)) return;
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw Error('IMAGE_PREFERENCES_REFUSED');
  };
  return {
    load() { try { checkFile(); return normalizeImageProviderConfig(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; } },
    save(value:unknown) {
      const settings = value === null ? null : normalizeImageProviderConfig(value); checkFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.' + randomBytes(6).toString('hex') + '.next';
      try { fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    },
  };
}
