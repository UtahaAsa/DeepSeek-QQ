// Generated from libraries/slang-routes.ts. Edit the TypeScript source and run build:typed.
import path from 'node:path';
import { createSlangEntry, SLANG_STATUS } from '../slang-learner.js';
/**
 * 黑话库管理入口；宿主须先完成控制台鉴权与同源检查。
 * @param {object} options store提供实时entries读写、writable和save；learning只操作所属学习队列与窗口。
 * cfg/root及配置读写函数沿用宿主，构造时不读写文件、不启动学习。
 * @returns {function(object):Promise<boolean>} 已处理为true，无关路由为false；异常交由宿主统一响应。
 * @note 单进程异步路由。每次操作读取实时词条；加载失败时在读取请求体之前拒绝库写入。
 */
export function createSlangRoutes({ root: ROOT, cfg, store, learning, readConfigObject, atomicWriteJson, log }) {
    const { windows: slangWindows, extractionCooldowns: slangExtractionCooldowns, submitTimes: slangSubmitTimes, researchingIds: slangResearchingIds, queue: queueSlangTask, extract: runSlangExtraction, research: runSlangResearch, invalidate: invalidateSlangLearnerSession } = learning;
    return async function handleSlangRoute({ req, url, readBody, sendJson }) {
        const single = url.pathname.match(/^\/api\/slang\/([^/]+)(?:\/(confirm|reject))?$/);
        const libraryWrite = req.method !== 'GET' && (url.pathname === '/api/slang'
            || ['/api/slang/clear', '/api/slang/extract', '/api/slang/research'].includes(url.pathname)
            || url.pathname.startsWith('/api/slang/batch-')
            || (single && ((['PATCH', 'DELETE'].includes(req.method) && !single[2])
                || (req.method === 'POST' && !!single[2]))));
        if (libraryWrite && !store.writable) {
            sendJson({ ok: false, error: '黑话库处于只读降级状态（启动时加载失败，未覆盖原文件），本次修改不会落盘；请修复 state/ 下的对应文件后重启桥接' }, 503);
            return true;
        }
        // ── 黑话库管理 ──────────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/api/slang') {
            const status = url.searchParams.get('status') || '';
            const list = status ? store.entries.filter((e) => e.status === status) : store.entries;
            sendJson({ entries: list, config: cfg.slang, writable: store.writable });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/slang') {
            const body = await readBody();
            const content = String(body.content ?? '').trim();
            if (!content) {
                sendJson({ ok: false, error: '黑话内容不能为空' }, 400);
                return true;
            }
            if (store.entries.some((e) => e.content === content)) {
                sendJson({ ok: false, error: `黑话「${content}」已存在` }, 400);
                return true;
            }
            const entry = createSlangEntry({
                content,
                meaning: String(body.meaning ?? '').trim(),
                usage: String(body.usage ?? '').trim(),
                example: String(body.example ?? '').trim(),
                risk: String(body.risk ?? '').trim(),
                sources: Array.isArray(body.sources) ? body.sources.map(String).filter(Boolean) : [],
                status: body.status === SLANG_STATUS.CANDIDATE ? SLANG_STATUS.CANDIDATE : SLANG_STATUS.CONFIRMED,
                source: 'manual',
                evidence: Array.isArray(body.evidence) ? body.evidence : []
            });
            store.entries.push(entry);
            store.save();
            log(`控制台：新增黑话「${content}」`);
            sendJson({ ok: true, entry });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/slang/clear') {
            const body = await readBody();
            const status = String(body.status ?? '').trim();
            if (status && ![SLANG_STATUS.CANDIDATE, SLANG_STATUS.CONFIRMED, SLANG_STATUS.REJECTED].includes(status)) {
                sendJson({ ok: false, error: `无效的 status：${status}，仅支持 candidate/confirmed/rejected 或留空全部删除` }, 400);
                return true;
            }
            let removedCount = 0;
            if (status) {
                removedCount = store.entries.filter((e) => e.status === status).length;
                store.entries = store.entries.filter((e) => e.status !== status);
            }
            else {
                removedCount = store.entries.length;
                store.entries = [];
                // 清空所有时同步清掉待提取窗口和冷却，避免“删了又回来”
                slangWindows.clear();
                slangExtractionCooldowns.clear();
                slangSubmitTimes.clear();
                slangResearchingIds.clear();
            }
            store.save();
            log(`控制台：清空黑话 ${removedCount} 条${status ? `（${status}）` : ''}`);
            sendJson({ ok: true, removedCount });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/slang/batch-delete') {
            const body = await readBody();
            const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
            const status = String(body.status ?? '').trim();
            if (ids.length) {
                const idSet = new Set(ids);
                const before = store.entries.length;
                store.entries = store.entries.filter((e) => !idSet.has(e.id));
                const removedCount = before - store.entries.length;
                if (!removedCount) {
                    sendJson({ ok: false, error: '没有匹配到要删除的黑话' }, 404);
                    return true;
                }
                store.save();
                log(`控制台：批量删除黑话 ${removedCount} 条`);
                sendJson({ ok: true, removedCount });
                return true;
            }
            if (status && ![SLANG_STATUS.CANDIDATE, SLANG_STATUS.CONFIRMED, SLANG_STATUS.REJECTED].includes(status)) {
                sendJson({ ok: false, error: `无效的 status：${status}` }, 400);
                return true;
            }
            if (!status) {
                sendJson({ ok: false, error: '请提供 ids 或 status' }, 400);
                return true;
            }
            const removedCount = store.entries.filter((e) => e.status === status).length;
            store.entries = store.entries.filter((e) => e.status !== status);
            store.save();
            log(`控制台：批量删除黑话 ${removedCount} 条（${status}）`);
            sendJson({ ok: true, removedCount });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/slang/batch-confirm') {
            const body = await readBody();
            const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
            if (!ids.length) {
                sendJson({ ok: false, error: '请选择要确认的黑话' }, 400);
                return true;
            }
            let confirmedCount = 0;
            let skippedCount = 0;
            const skipped = [];
            for (const id of ids) {
                const idx = store.entries.findIndex((e) => e.id === id);
                if (idx < 0) {
                    skippedCount++;
                    skipped.push({ id, reason: '不存在' });
                    continue;
                }
                const entry = store.entries[idx];
                if (entry.status !== SLANG_STATUS.CANDIDATE) {
                    skippedCount++;
                    skipped.push({ id, content: entry.content, reason: '不是候选' });
                    continue;
                }
                if (!entry.meaning || !String(entry.meaning).trim()) {
                    skippedCount++;
                    skipped.push({ id, content: entry.content, reason: '缺少含义' });
                    continue;
                }
                entry.status = SLANG_STATUS.CONFIRMED;
                entry.updatedAt = new Date().toISOString();
                confirmedCount++;
            }
            if (confirmedCount)
                store.save();
            log(`控制台：批量确认黑话 ${confirmedCount} 条，跳过 ${skippedCount} 条`);
            sendJson({ ok: true, confirmedCount, skippedCount, skipped: skipped.slice(0, 20) });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/slang/batch-reject') {
            const body = await readBody();
            const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
            if (!ids.length) {
                sendJson({ ok: false, error: '请选择要拒绝的黑话' }, 400);
                return true;
            }
            let rejectedCount = 0;
            for (const id of ids) {
                const idx = store.entries.findIndex((e) => e.id === id);
                if (idx < 0)
                    continue;
                const entry = store.entries[idx];
                if (entry.status === SLANG_STATUS.REJECTED)
                    continue;
                entry.status = SLANG_STATUS.REJECTED;
                entry.updatedAt = new Date().toISOString();
                rejectedCount++;
            }
            if (rejectedCount)
                store.save();
            log(`控制台：批量拒绝黑话 ${rejectedCount} 条`);
            sendJson({ ok: true, rejectedCount });
            return true;
        }
        const slangMatch = url.pathname.match(/^\/api\/slang\/([^/]+)(?:\/(confirm|reject))?$/);
        if (req.method === 'PATCH' && slangMatch && !slangMatch[2]) {
            const id = slangMatch[1];
            const idx = store.entries.findIndex((e) => e.id === id);
            if (idx < 0) {
                sendJson({ ok: false, error: '黑话不存在' }, 404);
                return true;
            }
            const body = await readBody();
            const entry = { ...store.entries[idx] };
            if (body.content !== undefined)
                entry.content = String(body.content ?? '').trim();
            if (body.content !== undefined && store.entries.some((e) => e.id !== id && e.content === entry.content)) {
                sendJson({ ok: false, error: `黑话「${entry.content}」已存在` }, 400);
                return true;
            }
            if (body.meaning !== undefined)
                entry.meaning = String(body.meaning ?? '').trim();
            if (body.usage !== undefined)
                entry.usage = String(body.usage ?? '').trim();
            if (body.example !== undefined)
                entry.example = String(body.example ?? '').trim();
            if (body.risk !== undefined)
                entry.risk = String(body.risk ?? '').trim();
            if (body.sources !== undefined)
                entry.sources = Array.isArray(body.sources) ? body.sources.map(String).filter(Boolean).slice(0, 10) : [];
            if (body.status !== undefined && [SLANG_STATUS.CANDIDATE, SLANG_STATUS.CONFIRMED, SLANG_STATUS.REJECTED].includes(body.status))
                entry.status = body.status;
            if (!entry.content) {
                sendJson({ ok: false, error: '黑话内容不能为空' }, 400);
                return true;
            }
            entry.updatedAt = new Date().toISOString();
            store.entries[idx] = entry;
            store.save();
            log(`控制台：更新黑话「${entry.content}」`);
            sendJson({ ok: true, entry });
            return true;
        }
        if (req.method === 'POST' && slangMatch && slangMatch[2] === 'confirm') {
            const id = slangMatch[1];
            const idx = store.entries.findIndex((e) => e.id === id);
            if (idx < 0) {
                sendJson({ ok: false, error: '黑话不存在' }, 404);
                return true;
            }
            const body = await readBody();
            const entry = store.entries[idx];
            if (body.meaning !== undefined)
                entry.meaning = String(body.meaning ?? '').trim();
            if (body.usage !== undefined)
                entry.usage = String(body.usage ?? '').trim();
            if (body.example !== undefined)
                entry.example = String(body.example ?? '').trim();
            if (body.risk !== undefined)
                entry.risk = String(body.risk ?? '').trim();
            if (body.sources !== undefined)
                entry.sources = Array.isArray(body.sources) ? body.sources.map(String).filter(Boolean).slice(0, 10) : [];
            if (!entry.meaning) {
                sendJson({ ok: false, error: '请先填写含义再确认，否则不会注入 AI 上下文' }, 400);
                return true;
            }
            entry.status = SLANG_STATUS.CONFIRMED;
            entry.updatedAt = new Date().toISOString();
            store.save();
            log(`控制台：确认黑话「${entry.content}」`);
            sendJson({ ok: true, entry });
            return true;
        }
        if (req.method === 'POST' && slangMatch && slangMatch[2] === 'reject') {
            const id = slangMatch[1];
            const idx = store.entries.findIndex((e) => e.id === id);
            if (idx < 0) {
                sendJson({ ok: false, error: '黑话不存在' }, 404);
                return true;
            }
            const entry = store.entries[idx];
            entry.status = SLANG_STATUS.REJECTED;
            entry.updatedAt = new Date().toISOString();
            store.save();
            log(`控制台：拒绝黑话「${entry.content}」`);
            sendJson({ ok: true, entry });
            return true;
        }
        if (req.method === 'DELETE' && slangMatch && !slangMatch[2]) {
            const id = slangMatch[1];
            const idx = store.entries.findIndex((e) => e.id === id);
            if (idx < 0) {
                sendJson({ ok: false, error: '黑话不存在' }, 404);
                return true;
            }
            const [removed] = store.entries.splice(idx, 1);
            store.save();
            log(`控制台：删除黑话「${removed.content}」`);
            sendJson({ ok: true, removed });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/slang/extract') {
            if (cfg.slang?.enabled === false) {
                sendJson({ ok: false, error: '黑话学习已关闭（slang.enabled=false）' }, 400);
                return true;
            }
            const body = await readBody();
            const key = String(body.key ?? '').trim();
            if (key && slangWindows.has(key)) {
                queueSlangTask(() => runSlangExtraction(key));
                sendJson({ ok: true, key });
            }
            else {
                const firstKey = slangWindows.keys().next().value;
                if (!firstKey) {
                    sendJson({ ok: false, error: '当前没有可学习消息窗口' }, 400);
                    return true;
                }
                queueSlangTask(() => runSlangExtraction(firstKey));
                sendJson({ ok: true, key: firstKey });
            }
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/slang/research') {
            if (cfg.slang?.enabled === false) {
                sendJson({ ok: false, error: '黑话学习已关闭（slang.enabled=false）' }, 400);
                return true;
            }
            const body = await readBody();
            const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
            const candidates = ids.length
                ? store.entries.filter((e) => ids.includes(e.id) && e.status === SLANG_STATUS.CANDIDATE)
                : store.entries.filter((e) => e.status === SLANG_STATUS.CANDIDATE);
            if (!candidates.length) {
                sendJson({ ok: false, error: '没有可研究的候选黑话' }, 400);
                return true;
            }
            queueSlangTask(() => runSlangResearch(candidates));
            sendJson({ ok: true, count: candidates.length });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/slang/config') {
            const body = await readBody();
            const oldPreset = cfg.slang?.learnerPreset;
            const oldWorkspaceTitle = cfg.slang?.workspaceTitle;
            const configFile = path.join(ROOT, 'config.json');
            const file = readConfigObject(configFile);
            const merged = { ...(file.slang ?? {}), ...body };
            if (typeof merged.enabled === 'boolean')
                merged.enabled = merged.enabled;
            else if (merged.enabled !== undefined)
                merged.enabled = merged.enabled === true;
            if (merged.extractMinMessages !== undefined)
                merged.extractMinMessages = Math.max(1, Math.round(Number(merged.extractMinMessages) || 1));
            if (merged.extractCooldownMs !== undefined)
                merged.extractCooldownMs = Math.max(0, Math.round(Number(merged.extractCooldownMs) || 0));
            if (merged.injectMax !== undefined)
                merged.injectMax = Math.min(30, Math.max(1, Math.round(Number(merged.injectMax) || 1)));
            if (merged.autoResearch !== undefined)
                merged.autoResearch = merged.autoResearch === true;
            if (merged.learnerPreset !== undefined)
                merged.learnerPreset = String(merged.learnerPreset ?? '').trim();
            if (merged.workspaceTitle !== undefined)
                merged.workspaceTitle = String(merged.workspaceTitle ?? '').trim() || 'QQ 黑话学习';
            if (body.inferenceThresholds !== undefined) {
                const raw = Array.isArray(body.inferenceThresholds)
                    ? body.inferenceThresholds
                    : String(body.inferenceThresholds).split(/[,，\s]+/);
                merged.inferenceThresholds = [...new Set(raw.map((n) => Math.max(1, Math.round(Number(n) || 1))))].sort((a, b) => a - b);
                if (!merged.inferenceThresholds.length)
                    merged.inferenceThresholds = [2, 4, 8];
            }
            file.slang = merged;
            atomicWriteJson(configFile, file);
            cfg.slang = { ...cfg.slang, ...merged };
            if (body.learnerPreset !== undefined && String(body.learnerPreset ?? '').trim() !== String(oldPreset ?? '')) {
                invalidateSlangLearnerSession();
                log('黑话学习 preset 已变更，已重置学习会话');
            }
            else if (body.workspaceTitle !== undefined && String(body.workspaceTitle ?? '').trim() !== String(oldWorkspaceTitle ?? '')) {
                invalidateSlangLearnerSession();
                log('黑话学习工作区名已变更，已重置学习会话');
            }
            log('控制台：黑话系统配置已更新');
            sendJson({ ok: true, config: cfg.slang });
            return true;
        }
        return false;
    };
}
