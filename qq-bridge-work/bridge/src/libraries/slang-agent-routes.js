// Generated from libraries/slang-agent-routes.ts. Edit the TypeScript source and run build:typed.
import { createSlangEntry, SLANG_STATUS, mergeEvidence, buildSlangContext } from '../slang-learner.js';
import { publicSlangEntry, confirmedSlangEntries, createSlangSubmitLimiter } from './slang-agent-policy.js';
/**
 * 会话侧黑话查询与候选提交，调用前须完成统一控制台鉴权。
 * @param {object} options store提供实时entries/writable及save；submitTimes是宿主的限频表；权限、学习队列与脱敏由宿主提供。
 * @returns {function(object):Promise<boolean>} 已处理为true，否则false；未知错误交由宿主统一响应。
 * @note 构造无IO；提交只入队研究任务，不等待模型；响应不含证据或来源会话。只读时在读取请求体前拒绝提交。
 */
export function createSlangAgentRoutes({ cfg, store, submitTimes, agentTokenOk, v2SessionAllowed, v2ToolEnabled, redactKnownTokensOnly, queueSlangTask, runSlangResearch, log, appendActivity, now = Date.now }) {
    const allowSlangSubmit = createSlangSubmitLimiter(submitTimes, now);
    const confirmedSlangListV2 = () => confirmedSlangEntries(store.entries, cfg.slang?.injectMax);
    return async function handleSlangAgentRoute({ req, url, readBody, sendJson }) {
        if (req.method !== 'GET' && url.pathname === '/api/socialV2/slang/submit' && !store.writable) {
            sendJson({ ok: false, error: '黑话库处于只读降级状态（启动时加载失败，未覆盖原文件），本次修改不会落盘；请修复 state/ 下的对应文件后重启桥接' }, 503);
            return true;
        }
        // ── 二代黑话学习（reserved2）：AI 查询/提交黑话候选 ─────────────────
        if (req.method === 'GET' && url.pathname === '/api/socialV2/slang/query') {
            const key = String(url.searchParams.get('key') ?? '').trim();
            const q = String(url.searchParams.get('q') ?? '').trim().toLowerCase();
            if (!key) {
                sendJson({ ok: false, error: 'key 不能为空' }, 400);
                return true;
            }
            if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) {
                sendJson({ ok: false, error: 'agent token 无效' }, 403);
                return true;
            }
            if (req.headers['x-agent-token'] && !v2SessionAllowed(key)) {
                sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                return true;
            }
            if (req.headers['x-agent-token'] && !v2ToolEnabled('slangQuery')) {
                sendJson({ ok: false, error: '工具未启用：qq_slang_query' }, 403);
                return true;
            }
            const list = confirmedSlangListV2().filter((e) => {
                if (!q)
                    return true;
                return e.content.toLowerCase().includes(q)
                    || e.meaning.toLowerCase().includes(q)
                    || e.usage.toLowerCase().includes(q)
                    || e.example.toLowerCase().includes(q);
            });
            sendJson({
                ok: true,
                key,
                total: list.length,
                entries: list,
                block: buildSlangContext(store.entries, cfg.slang?.injectMax ?? 8)
            });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/socialV2/slang/submit') {
            const body = await readBody();
            const key = String(body.key ?? '').trim();
            const token = String(body.token ?? '').trim();
            const content = redactKnownTokensOnly(String(body.content ?? '')).trim();
            const context = redactKnownTokensOnly(String(body.context ?? '')).trim();
            if (!key) {
                sendJson({ ok: false, error: 'key 不能为空' }, 400);
                return true;
            }
            if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) {
                sendJson({ ok: false, error: 'agent token 无效' }, 403);
                return true;
            }
            if (req.headers['x-agent-token'] && !v2SessionAllowed(key)) {
                sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
                return true;
            }
            if (req.headers['x-agent-token'] && !v2ToolEnabled('slangSubmit')) {
                sendJson({ ok: false, error: '工具未启用：qq_slang_submit' }, 403);
                return true;
            }
            if (cfg.slang?.enabled === false) {
                sendJson({ ok: false, error: '黑话学习已关闭（slang.enabled=false）' }, 403);
                return true;
            }
            if (!content) {
                sendJson({ ok: false, error: 'content 不能为空' }, 400);
                return true;
            }
            if (content.length > 50) {
                sendJson({ ok: false, error: '黑话词条过长（最多 50 字）' }, 400);
                return true;
            }
            if (!allowSlangSubmit(key)) {
                sendJson({ ok: false, error: '黑话提交过于频繁，请稍后再试' }, 429);
                return true;
            }
            const existing = store.entries.find((e) => e.content === content);
            if (existing) {
                if (existing.status === SLANG_STATUS.CONFIRMED) {
                    sendJson({ ok: true, duplicate: true, status: 'confirmed', entry: publicSlangEntry(existing) });
                    return true;
                }
                if (existing.status === SLANG_STATUS.REJECTED) {
                    sendJson({ ok: false, error: '该词已被管理员拒绝，如需重新收录请联系管理员' }, 403);
                    return true;
                }
                // candidate：累计出现次数并追加语境证据
                existing.count = (Number(existing.count) || 0) + 1;
                if (context) {
                    existing.evidence = mergeEvidence(existing.evidence, [{ key, sender: 'AI提交', text: context.slice(0, 200), time: Date.now() }]);
                }
                existing.updatedAt = new Date().toISOString();
                store.save();
                if (cfg.slang?.autoResearch !== false) {
                    const thresholds = Array.isArray(cfg.slang?.inferenceThresholds) ? cfg.slang.inferenceThresholds.map(Number).filter(Boolean) : [2, 4, 8];
                    if (thresholds.includes(existing.count) && existing.count > (Number(existing.lastInferenceCount) || 0)) {
                        queueSlangTask(() => runSlangResearch([existing]));
                    }
                }
                log(`[reserved2] AI 再次提交黑话候选「${content}」(${key})，累计 ${existing.count} 次`);
                sendJson({ ok: true, duplicate: true, status: 'candidate', entry: publicSlangEntry(existing) });
                return true;
            }
            const entry = createSlangEntry({
                content,
                source: 'ai',
                status: SLANG_STATUS.CANDIDATE,
                evidence: context ? [{ key, sender: 'AI提交', text: context.slice(0, 200), time: Date.now() }] : []
            });
            store.entries.push(entry);
            store.save();
            if (cfg.slang?.autoResearch !== false) {
                queueSlangTask(() => runSlangResearch([entry]));
            }
            log(`[reserved2] AI 提交黑话候选「${content}」(${key})`);
            appendActivity(`${key} [reserved2] AI 提交黑话候选：${content}${context ? '（附语境）' : ''}`);
            sendJson({ ok: true, entry: publicSlangEntry(entry) });
            return true;
        }
        return false;
    };
}
