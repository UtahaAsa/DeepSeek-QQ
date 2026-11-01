/// <reference types="node" />
/** 固定所属目录与实时宿主位置，构造无IO；文件操作同步完成或抛错。 */
export interface PresetStoreDependencies {readonly root: string; readonly stateDirectory: string; readonly getDshHome: () => string;}
import fs from 'node:fs';import path from 'node:path';
import {extractPresetPrefix} from '../preset-prompt.js';
/**
 * 管理两个固定预设的源文件、备份和安装副本位置。
 * @param {object} options root/stateDirectory为所属实例目录，getDshHome返回当前宿主目录。
 * @returns {object} 名称校验、读取、备份和状态方法；调用文件方法前须先通过knownPresetName。
 * @throws {Error} 文件IO失败沿用原语义；列表读取失败返回空数组。
 * @note 构造无IO；同步文件操作，不启动DSH，不读取账号或模型凭据。
 */
export function createPresetStore({root:ROOT,stateDirectory:STATE_DIR,getDshHome}: PresetStoreDependencies) {
  const PRESET_NAMES = { v1: 'qq-chat', v2: 'qq-chat-v2' };
  const PRESET_BACKUP_DIR = path.join(STATE_DIR, 'preset-backups');
  const PRESET_BACKUP_KEEP = 10;

  /**
   * 控制台的 preset 参数校验：只接受本项目这两个预置名（缺省 = 二代）。
   *
   * 为什么必须在拼路径**之前**校验：main() 里的 resolvePresetName() 在「DSH preset 清单为空」
   * （DSH 还没连上 / 正在启动）时会把调用方给的字符串**原样返回**。那四个 preset 控制台路由
   * 都拿它去 path.join(ROOT, 'dsh', 'agent-presets', name, 'agent.cordis.yml')，
   * 于是 `preset=..\..\..\x` 会读写/备份 <x>/agent.cordis.yml，越出仓库。
   * 返回 null 由调用方回 400。
   */
  function knownPresetName(raw: unknown) {
    const name = String(raw ?? '').trim();
    if (!name) return PRESET_NAMES.v2;
    return Object.values(PRESET_NAMES).includes(name) ? name : null;
  }

  function presetSourceYaml(name: string) {
    return path.join(ROOT, 'dsh', 'agent-presets', name, 'agent.cordis.yml');
  }



  function installedPresetYaml(name: string) {
    return path.join(getDshHome(), '.agent-presets', name, 'agent.cordis.yml');
  }

  function readPresetPromptText(name: string) {
    const file = presetSourceYaml(name);
    if (!fs.existsSync(file)) throw new Error(`找不到预设文件 ${path.relative(ROOT, file)}`);
    const text = fs.readFileSync(file, 'utf8');
    const prefix = extractPresetPrefix(text);
    if (prefix === null) throw new Error('预设里找不到 persona.prefix（结构可能已变化）');
    return { text, prefix };
  }

  // 备份文件名带上预设名：两个预设的主文件名都叫 agent.cordis.yml，
  // 不加前缀会让「还原」列到另一个预设的备份。
  function presetBackupPrefix(name: string) {
    return `${name}.${path.basename(presetSourceYaml(name))}`;
  }

  function backupPresetFile(name: string) {
    const file = presetSourceYaml(name);
    if (!fs.existsSync(file)) return null;
    fs.mkdirSync(PRESET_BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(PRESET_BACKUP_DIR, `${presetBackupPrefix(name)}.${stamp}`);
    fs.copyFileSync(file, dest);
    const prefix = presetBackupPrefix(name) + '.';
    const backups = fs.readdirSync(PRESET_BACKUP_DIR).filter((f) => f.startsWith(prefix)).sort();
    for (const stale of backups.slice(0, Math.max(0, backups.length - PRESET_BACKUP_KEEP))) {
      try { fs.rmSync(path.join(PRESET_BACKUP_DIR, stale)); } catch {}
    }
    return dest;
  }

  function listPresetBackups(name: string) {
    try {
      const prefix = presetBackupPrefix(name) + '.';
      return fs.readdirSync(PRESET_BACKUP_DIR)
        .filter((f) => f.startsWith(prefix))
        .sort().reverse()
        .map((f) => ({ file: f, mtime: fs.statSync(path.join(PRESET_BACKUP_DIR, f)).mtimeMs }));
    } catch {
      return [];
    }
  }

  function presetStatus(name: string) {
    // 只回传控制台需要的信息：不回传 DSH_HOME / 安装副本的绝对路径，减少无谓的信息暴露
    // （路径已经写在服务端日志里，排查时看日志即可）。
    return {
      preset: name,
      label: name === PRESET_NAMES.v1 ? '一代仿真（reserved）' : '二代仿真（reserved2）',
      sourceFile: path.relative(ROOT, presetSourceYaml(name)),
      installed: fs.existsSync(installedPresetYaml(name)),
      requiresRestart: true,
    };
  }


  return Object.freeze({PRESET_NAMES,PRESET_BACKUP_DIR,knownPresetName,presetSourceYaml,installedPresetYaml,readPresetPromptText,backupPresetFile,listPresetBackups,presetStatus});
}
