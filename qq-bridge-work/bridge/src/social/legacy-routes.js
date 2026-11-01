// Generated from social/legacy-routes.ts. Edit the TypeScript source and run build:typed.
import path from 'node:path';
import { normalizeLegacySocial } from './legacy-policy.js';
/**
 * 一代社交管理路由；调用前须完成控制台鉴权与同源检查。
 * @param {object} options cfg为生效配置，getSocial按请求读取所属状态；状态切换与摘要提交由宿主负责。
 * @returns {function(object):Promise<boolean>} 已处理为true，否则false；读写异常交由宿主响应。
 * @note 构造无IO；保存成功后才替换内存配置，不修改模型、会话和其它配置段。
 */
export function createLegacySocialRoutes({ root: ROOT, cfg, getSocial, enterActive, leaveActive, flushSummaries, readConfigObject, atomicWriteJson, log }) {
    return async function handleLegacySocialRoute({ req, url, readBody, sendJson }) {
        if (req.method === 'POST' && url.pathname === '/api/social/state') {
            const body = await readBody();
            const key = String(body.key ?? '').trim();
            if (!key) {
                sendJson({ ok: false, error: 'key 不能为空' }, 400);
                return true;
            }
            const phase = body.phase;
            if (phase === 'active') {
                // 手动进入活跃：相当于第四种触发方式，之后按正常活跃流程跑
                enterActive(key);
                log(`控制台：手动将 ${key} 设为活跃`);
                sendJson({ ok: true, key, phase: 'active' });
            }
            else if (phase === 'idle') {
                leaveActive(key);
                log(`控制台：手动将 ${key} 设为观望`);
                sendJson({ ok: true, key, phase: 'idle' });
            }
            else {
                sendJson({ ok: false, error: 'phase 必须是 active 或 idle' }, 400);
            }
            return true;
        }
        // ── 仿真群友模式（社交引擎）配置 ──────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/api/social') {
            const social = getSocial();
            const stats = {};
            for (const [k, e] of social.pendingSummaries.entries())
                stats[k] = e.items.length;
            const states = {};
            const keys = new Set([...social.states.keys(), ...social.recentMessages.keys()]);
            for (const k of keys) {
                const st = social.states.get(k);
                states[k] = { phase: st?.phase ?? 'idle' };
            }
            sendJson({ config: cfg.social, pendingSummaries: stats, states });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/social') {
            const body = await readBody();
            const configFile = path.join(ROOT, 'config.json');
            // fail-fast：配置文件损坏时直接 500，绝不回写，避免把整个配置清成只剩 social
            const file = readConfigObject(configFile);
            const merged = normalizeLegacySocial(file.social, body);
            file.social = merged;
            atomicWriteJson(configFile, file);
            cfg.social = { ...cfg.social, ...merged };
            log('控制台：社交配置已更新');
            sendJson({ ok: true, config: cfg.social });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/social/flush') {
            const body = await readBody();
            await flushSummaries(body.key || null);
            sendJson({ ok: true });
            return true;
        }
        return false;
    };
}
