// Generated from config/settings-routes.ts. Edit the TypeScript source and run build:typed.
import path from 'node:path';
import { normalizeOwnerQQ, normalizeReasoningEffort } from './inputs.js';
/**
 * 构造白名单与思考强度设置路由，配置结构与响应契约保持原样。
 * @param {object} options cfg为所属实例的当前配置；scopeLocked和scopeSummary限制原生权限编辑。
 * 其余回调负责安全读写配置、协调会话策略、递增模型选择代次和日志。
 * @returns {function(object):Promise<boolean>} 已处理返回true，否则false；不匹配不读取请求体。
 * @throws {Error} 配置损坏或写入失败交回宿主；内存更新只发生在写盘成功后。
 * @note 调用者先执行统一管理权限检查；构造无IO，不自行启动服务或调用模型。
 */
export function createSettingsRoutes({ root: ROOT, cfg, scopeLocked, scopeSummary, readConfigObject, atomicWriteJson, reconcileSessionPolicies, onEffortChanged, log }) {
    return async function handleSettingsRoute({ method, url, readBody, sendJson }) {
        // ── 白名单可视化编辑（写 config.json + 热更新内存） ───────────────────
        if (method === 'GET' && url.pathname === '/api/whitelist') {
            sendJson({ allow: cfg.allow ?? { private: [], groups: [] }, deny: cfg.deny ?? { private: [], groups: [] }, ownerQQ: cfg.ownerQQ ?? null,
                ...(scopeLocked ? { nativeScopeLocked: true, scopeSummary: scopeSummary() } : {}) });
            return true;
        }
        if (method === 'POST' && url.pathname === '/api/whitelist') {
            if (scopeLocked) {
                sendJson({ ok: false, error: 'NATIVE_SCOPE_LOCKED_USE_GATEWAY' }, 409);
                return true;
            }
            const body = await readBody();
            const toNum = (arr) => Array.isArray(arr) ? [...new Set(arr.map((x) => Number(String(x).trim())).filter((n) => Number.isFinite(n)))] : undefined;
            const configFile = path.join(ROOT, 'config.json');
            // fail-fast：配置文件损坏时直接 500，绝不回写，避免把整个配置清成只剩 allow/deny/ownerQQ
            const file = readConfigObject(configFile);
            const allow = {
                private: toNum(body.allow?.private) ?? (file.allow?.private ?? []),
                groups: toNum(body.allow?.groups) ?? (file.allow?.groups ?? [])
            };
            const deny = {
                private: toNum(body.deny?.private) ?? (file.deny?.private ?? []),
                groups: toNum(body.deny?.groups) ?? (file.deny?.groups ?? [])
            };
            // 管理员 QQ 可在控制台输入；空值=清除管理员（fail-closed），非法值拒绝写入。
            let ownerQQ = cfg.ownerQQ ?? null;
            if (body.ownerQQ !== undefined) {
                try {
                    ownerQQ = normalizeOwnerQQ(body.ownerQQ);
                }
                catch (error) {
                    sendJson({ ok: false, error: error?.message ?? 'ownerQQ 无效' }, 400);
                    return true;
                }
            }
            file.allow = allow;
            file.deny = deny;
            file.ownerQQ = ownerQQ;
            atomicWriteJson(configFile, file);
            cfg.allow = { private: allow.private, groups: allow.groups };
            cfg.deny = { private: deny.private, groups: deny.groups };
            cfg.ownerQQ = ownerQQ;
            reconcileSessionPolicies();
            log(`控制台：白名单已更新（群: ${allow.groups.join(',') || '无'}，私聊: ${allow.private.join(',') || '无'}，管理员: ${ownerQQ ?? '未设置'}）`);
            sendJson({ ok: true, allow, deny, ownerQQ });
            return true;
        }
        if (method === 'POST' && url.pathname === '/api/dsh/effort') {
            const body = await readBody();
            let effort;
            try {
                effort = normalizeReasoningEffort(body.reasoningEffort);
            }
            catch (error) {
                sendJson({ ok: false, error: error?.message ?? '思考强度无效' }, 400);
                return true;
            }
            const configFile = path.join(ROOT, 'config.json');
            // fail-fast：配置损坏时直接 500，绝不回写（与白名单接口同语义）
            const file = readConfigObject(configFile);
            file.dsh = { ...(file.dsh ?? {}), reasoningEffort: effort };
            atomicWriteJson(configFile, file);
            cfg.dsh = { ...(cfg.dsh ?? {}), reasoningEffort: effort };
            // 递增代号：已在运行的会话在下一条消息会重新 selectModel（无需重启桥接或 DSH）
            onEffortChanged();
            log(`控制台：DSH 思考强度已设为 ${effort}（对已有会话于下一条消息生效）`);
            sendJson({ ok: true, reasoningEffort: effort });
            return true;
        }
        return false;
    };
}
