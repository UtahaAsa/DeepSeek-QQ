import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './environment.mjs';
import { validateVoiceResources } from '../bridge/src/voice-resources.js';

const refused = () => new Error('EXISTING_VOICE_RESOURCES_INVALID');

/**
 * 根据用户明确指定的本机资源清单创建语音配置；不安装、不下载、不启动推理。
 * @param {object} options configFile为资源JSON，dataRoot为本任务语音数据目录。
 * @returns {object} 无本机路径的准备结果；既有runtime.json永不覆盖。
 * @throws {Error} 缺件、非本地路径、未知字段或配置已存在时拒绝；同步执行。
 */
export function prepareVoiceResources({ configFile, dataRoot }) {
  if (typeof configFile !== 'string' || !configFile.trim()) throw new Error('VOICE_RESOURCES_REQUIRED');
  if (/^(?:[\\/]{2}|[a-z]+:\/\/)/i.test(configFile)) throw refused();
  const source = path.resolve(configFile), base = path.dirname(source);
  const input = JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, ''));
  const { config } = validateVoiceResources(input, base);
  const targetRoot = path.resolve(dataRoot), target = path.join(targetRoot, 'runtime.json');
  if (fs.existsSync(target)) throw new Error('VOICE_CONFIG_EXISTS_REVIEW_WITHOUT_OVERWRITING');
  fs.mkdirSync(path.join(targetRoot, 'cache', 'temp'), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(config, null, 2), { flag: 'wx' });
  return { prepared: true, retraining: false, dependenciesInstalled: false, externalResourcesReadOnly: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--resources') throw new Error('VOICE_RESOURCES_REQUIRED');
    console.log(JSON.stringify(prepareVoiceResources({ configFile: process.argv[3], dataRoot: path.join(root, 'voice') })));
  } catch (error) {
    const code = ['VOICE_RESOURCES_REQUIRED', 'VOICE_CONFIG_EXISTS_REVIEW_WITHOUT_OVERWRITING'].includes(error.message)
      ? error.message : 'EXISTING_VOICE_RESOURCES_INVALID';
    console.error(JSON.stringify({ prepared: false, error: code }));
    process.exitCode = 1;
  }
}
