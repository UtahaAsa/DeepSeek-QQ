// Generated from presets/preset-routes.ts. Edit the TypeScript source and run build:typed.
import fs from 'node:fs';
import path from 'node:path';
import { extractPresetPrefix, presetPromptBlockers, presetPromptWarnings, renderPresetPromptYaml } from '../preset-prompt.js';
/**
 * 处理预设提示词的查询、保存、备份列表与恢复。
 * @param {object} options store为所属预设存储，atomicWriteText与log沿用宿主能力。
 * @returns {function(object):Promise<boolean>} 已响应为true；不匹配为false且不消费请求体。
 * @note 调用前必须经过统一控制台权限、同源和请求体限制；保存失败沿用原源文件回滚。
 */
export function createPresetRoutes({ store, atomicWriteText, log }) {
    const { PRESET_NAMES, PRESET_BACKUP_DIR, knownPresetName, presetSourceYaml, installedPresetYaml, readPresetPromptText, backupPresetFile, listPresetBackups, presetStatus } = store;
    return async function handlePresetRoute({ method, url, readBody, sendJson }) {
        // ── 仿真提示词（一代 / 二代各自的预设内置提示词）──────────────────────
        if (method === 'GET' && url.pathname === '/api/preset/sim-prompt') {
            const preset = knownPresetName(url.searchParams.get('preset'));
            if (!preset) {
                sendJson({ ok: false, error: `未知预设（只支持 ${Object.values(PRESET_NAMES).join(' / ')}）` }, 400);
                return true;
            }
            try {
                const { prefix } = readPresetPromptText(preset);
                sendJson({
                    ok: true,
                    content: prefix,
                    chars: prefix.length,
                    bytes: Buffer.byteLength(prefix, 'utf8'),
                    warnings: presetPromptWarnings(prefix),
                    status: presetStatus(preset),
                    presets: Object.values(PRESET_NAMES).map((n) => presetStatus(n)),
                });
            }
            catch (error) {
                sendJson({ ok: false, error: error?.message ?? '读取预设失败', status: presetStatus(preset) }, 500);
            }
            return true;
        }
        if (method === 'POST' && url.pathname === '/api/preset/sim-prompt') {
            const body = await readBody();
            const preset = knownPresetName(body.preset);
            if (!preset) {
                sendJson({ ok: false, error: `未知预设（只支持 ${Object.values(PRESET_NAMES).join(' / ')}）` }, 400);
                return true;
            }
            let nextText;
            try {
                const { text, prefix } = readPresetPromptText(preset);
                // 内容没变就不要写：写回会把折叠块规整成字面量块（值不变但排版变化），
                // 让一次"打开又保存"把整个提示词块变成全删全加的 diff，失去可复审性。
                const normalized = String(body.content ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
                if (normalized === prefix) {
                    sendJson({ ok: true, unchanged: true, chars: prefix.length, warnings: presetPromptWarnings(prefix), synced: fs.existsSync(installedPresetYaml(preset)), requiresRestart: false, status: presetStatus(preset) });
                    return true;
                }
                nextText = renderPresetPromptYaml(text, body.content, preset === PRESET_NAMES.v1 ? 'v1' : 'v2');
            }
            catch (error) {
                sendJson({ ok: false, error: error?.message ?? '校验失败' }, 400);
                return true;
            }
            const warnings = presetPromptWarnings(body.content);
            let sourceBackup = null;
            try {
                sourceBackup = backupPresetFile(preset);
                atomicWriteText(presetSourceYaml(preset), nextText);
                // 同步到 DSH 实际读取的安装目录。
                // 注意：安装副本**不做仓库内备份**——它的内容与刚写好的源文件一致，
                // 备份它等于把含本机绝对路径的快照塞进仓库工作区，没有额外价值。
                const installed = installedPresetYaml(preset);
                if (fs.existsSync(installed)) {
                    fs.copyFileSync(presetSourceYaml(preset), installed);
                }
            }
            catch (error) {
                // 尽力回滚源文件，避免留下半截状态
                if (sourceBackup && fs.existsSync(sourceBackup)) {
                    try {
                        fs.copyFileSync(sourceBackup, presetSourceYaml(preset));
                    }
                    catch { }
                }
                sendJson({ ok: false, error: `写入失败：${error?.message ?? error}` }, 500);
                return true;
            }
            log(`控制台：${preset} 仿真提示词已更新（${String(body.content ?? '').length} 字符）${warnings.length ? `，${warnings.length} 条警告` : ''}；需重启 DSH 生效`);
            sendJson({
                ok: true,
                chars: String(body.content ?? '').length,
                warnings,
                synced: fs.existsSync(installedPresetYaml(preset)),
                requiresRestart: true,
                status: presetStatus(preset),
            });
            return true;
        }
        if (method === 'GET' && url.pathname === '/api/preset/sim-prompt/backups') {
            const preset = knownPresetName(url.searchParams.get('preset'));
            if (!preset) {
                sendJson({ ok: false, error: `未知预设（只支持 ${Object.values(PRESET_NAMES).join(' / ')}）` }, 400);
                return true;
            }
            try {
                sendJson({ ok: true, backups: listPresetBackups(preset) });
            }
            catch (error) {
                sendJson({ ok: false, error: error?.message ?? '读取备份失败' }, 500);
            }
            return true;
        }
        if (method === 'POST' && url.pathname === '/api/preset/sim-prompt/restore') {
            const body = await readBody();
            const preset = knownPresetName(body.preset);
            if (!preset) {
                sendJson({ ok: false, error: `未知预设（只支持 ${Object.values(PRESET_NAMES).join(' / ')}）` }, 400);
                return true;
            }
            try {
                const requested = String(body.file ?? '').trim();
                const candidates = listPresetBackups(preset).map((b) => b.file);
                const target = requested || candidates[0];
                // 只允许还原本预设目录下的备份文件，拒绝任何路径穿越
                if (!target || !candidates.includes(target)) {
                    sendJson({ ok: false, error: '没有可用的备份' }, 400);
                    return true;
                }
                const backupPath = path.join(PRESET_BACKUP_DIR, target);
                const restored = fs.readFileSync(backupPath, 'utf8');
                const restoredPrefix = extractPresetPrefix(restored);
                if (restoredPrefix === null) {
                    sendJson({ ok: false, error: '备份内容不是有效的预设文件' }, 400);
                    return true;
                }
                // 还原路径必须与保存路径同样严格：旧备份可能来自安全基线加入之前，
                // 直接还原会把弱化版提示词（缺「你没有本地工具」等不变量）写回去。
                // 不变量清单**按预设取**：一代本来就没有「你没有本地工具」这类工具面表述。
                const blockers = presetPromptBlockers(restoredPrefix, preset === PRESET_NAMES.v1 ? 'v1' : 'v2');
                if (blockers.length) {
                    sendJson({ ok: false, error: `该备份不满足当前的安全不变量，拒绝还原：${blockers.join('；')}` }, 400);
                    return true;
                }
                backupPresetFile(preset);
                atomicWriteText(presetSourceYaml(preset), restored);
                const installed = installedPresetYaml(preset);
                if (fs.existsSync(installed))
                    fs.copyFileSync(presetSourceYaml(preset), installed);
                log(`控制台：${preset} 仿真提示词已还原自备份 ${target}；需重启 DSH 生效`);
                sendJson({ ok: true, restoredFrom: target, requiresRestart: true });
            }
            catch (error) {
                sendJson({ ok: false, error: error?.message ?? '还原失败' }, 500);
            }
            return true;
        }
        return false;
    };
}
