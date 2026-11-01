// Generated from console/routes/status-mode.ts. Edit the TypeScript source and run build:typed.
/**
 * status-mode功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：readRoleState, currentMode, dshReady, socialV2, queryQQStatus, bot, nativeBinding, nativeCapabilities, closedAgentPreset, cfg, gatewayHealthSnapshot, idleAvailable, nativeIdleLoop, idleDraftRunner, readActivityTail, phonePageState, unwrap, api, normalizeModeInput, VALID_MODES, readJsonSafe, path, STATE_DIR, atomicWriteJson, log, cleanupSocialForModeChange, clearAllSocialV2Timers, drainAllPromptQueues, lastMode, reconcileSessionPolicies, setupSleepTimerV2, scheduleProactiveCheckV2, queryModelCatalog。
 */
export function createStatusModeRoutes(deps) {
    return {
        getStatus: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/status',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const rs = (0, deps.readRoleState)();
                // 带 agent token 的调用来自 QQ 群里的 AI：只能拿到它自己该知道的运行状态。
                // activity 是**全局**收发摘要（含其它群的发言片段与告警），ownerQQ/白名单属于管理信息，
                // 都不能给到会话级主体，否则 A 群的 AI 能读到 B 群的内容。
                // 判定「是不是智能体调用」必须同时看 x-agent-call：无令牌的智能体调用
                // （旧只读工具的模式探测）不带 x-agent-token，但它同样**绝不能**拿到管理端字段
                // —— ownerQQ / 白名单 / activity（含其它群的发言片段）是跨群管理信息。
                // 只认 token 会让这类请求落到下面的完整对象上，等于把 A 群的 AI 变成管理端。
                if (req.headers['x-agent-token'] || req.headers['x-agent-call'] !== undefined) {
                    sendJson({
                        mode: deps.currentMode,
                        role: rs.role ?? null,
                        roleMode: rs.mode ?? 'active',
                        dshReady: deps.dshReady,
                        socialV2Paused: deps.socialV2.paused,
                        qq: await (0, deps.queryQQStatus)(deps.bot, deps.nativeBinding ? deps.nativeCapabilities : null),
                    });
                    return;
                }
                sendJson({
                    mode: deps.currentMode,
                    closedAgentPreset: deps.closedAgentPreset,
                    role: rs.role ?? null,
                    roleMode: rs.mode ?? 'active',
                    dshReady: deps.dshReady,
                    ownerQQ: deps.cfg.ownerQQ ?? null,
                    allowGroups: deps.cfg.allow?.groups ?? [],
                    allowPrivate: deps.cfg.allow?.private ?? [],
                    socialV2Paused: deps.socialV2.paused,
                    // 上游健康只给操作者看：它包含网关诊断信息（good/hint），
                    // 属于管理侧观测，不该进 QQ 会话里那个受限的智能体视图。
                    snowluma: (0, deps.gatewayHealthSnapshot)(),
                    qq: await (0, deps.queryQQStatus)(deps.bot, deps.nativeBinding ? deps.nativeCapabilities : null),
                    ...(deps.nativeBinding ? {
                        idleMessages: {
                            settings: deps.nativeBinding.idleMessages,
                            available: (0, deps.idleAvailable)(),
                            loop: deps.nativeIdleLoop?.snapshot() ?? null, draft: deps.idleDraftRunner?.snapshot() ?? null
                        }
                    } : {}),
                    activity: (0, deps.readActivityTail)(100),
                    ...(deps.nativeBinding ? { phone: (0, deps.phonePageState)() } : {})
                });
                return;
            }
        },
        getPresets: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/presets',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                let presets = [];
                try {
                    const { presets: list } = (0, deps.unwrap)(await deps.api.agentPresets.list({}), 'agentPreset.list');
                    presets = list.map((p) => ({ id: p.id, trust: p.trust ?? 'system' }));
                }
                catch { }
                sendJson({ presets });
                return;
            }
        },
        postMode: {
            matches: (req, url) => req.method === 'POST' && url.pathname === '/api/mode',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                const body = await readBody();
                // 规范名与历史名都接受，落盘的始终是内部拼写（见 MODE_INPUT_ALIASES）。
                const requestedMode = (0, deps.normalizeModeInput)(body.mode);
                if (!requestedMode) {
                    sendJson({ ok: false, error: `mode 必须是 ${deps.VALID_MODES.join(' / ')}（simulation 为 reserved2 的规范名）` }, 400);
                    return;
                }
                const existing = (0, deps.readJsonSafe)(deps.path.join(deps.STATE_DIR, 'mode.json'), {});
                const next = {
                    mode: requestedMode,
                    // 未显式传 preset 时保留原值；原值也没有就留空（= 用 DSH 默认 preset）。
                    ...(body.closedAgentPreset !== undefined
                        ? { closedAgentPreset: String(body.closedAgentPreset ?? '') }
                        : { closedAgentPreset: String(existing.closedAgentPreset ?? '') })
                };
                (0, deps.atomicWriteJson)(deps.path.join(deps.STATE_DIR, 'mode.json'), next);
                // 用字符串判断而非真值判断：空串是「显式清空 preset」，也要生效。
                deps.closedAgentPreset = next.closedAgentPreset;
                // 写穿到 DSH 设置。refreshMode() 每 5 秒跑一次且以 DSH 的值为准（插件的 base 保证
                // 该命名空间永远有值），所以只写本地 state/mode.json 会在下一次轮询时被静默回滚。
                // 写穿的是**内部拼写**（`simulation` 会写成 `reserved2`）：DSH 里那份值会被 refreshMode
                // 读回来当 `currentMode` 用，存规范名会让下游那些 `=== 'reserved2'` 判断失效。
                let dshSynced = false;
                try {
                    // unwrap() 在 result.ok 为 false 时直接抛错，所以能执行到下一行即代表写穿已成功
                    // （不要在这里再判断 updated?.ok —— 解包后的值恒为真，那样的分支是死代码）。
                    (0, deps.unwrap)(await deps.api.settings.update({ ns: 'qq-mode', patch: { mode: requestedMode } }), 'settings.update');
                    dshSynced = true;
                }
                catch (error) {
                    (0, deps.log)(`控制台：模式写穿 DSH 设置失败（${error?.message ?? error}）；本次仅写本地，下次 DSH 轮询会覆盖回滚`);
                }
                // 下面这两个判断比较的是「模式真的变了吗」。必须用归一后的值：拿 `body.mode` 比，
                // 把 `simulation` 与 `reserved2` 当成两种模式，会在模式其实没变时清掉二代定时器与排队投递。
                if (deps.currentMode === 'reserved' && requestedMode !== 'reserved') {
                    (0, deps.cleanupSocialForModeChange)();
                    (0, deps.log)('控制台：模式离开一代仿真模式，清理社交状态');
                }
                if (deps.currentMode === 'reserved2' && requestedMode !== 'reserved2') {
                    (0, deps.clearAllSocialV2Timers)();
                    (0, deps.drainAllPromptQueues)('模式切换，已取消排队中的投递');
                    (0, deps.log)('控制台：模式离开二代仿真模式，清理 reserved2 定时器与排队投递');
                }
                deps.currentMode = requestedMode;
                deps.lastMode = requestedMode;
                (0, deps.reconcileSessionPolicies)();
                if (requestedMode === 'reserved2') {
                    for (const key of deps.socialV2.conversations.keys()) {
                        (0, deps.setupSleepTimerV2)(key);
                        (0, deps.scheduleProactiveCheckV2)(key);
                    }
                    (0, deps.log)('控制台：模式进入二代仿真模式，重建有限睡眠定时器');
                }
                (0, deps.log)(`控制台：模式已设置为 ${requestedMode}${next.closedAgentPreset ? `（closed-agent preset: ${next.closedAgentPreset}）` : ''}${dshSynced ? '' : ' [仅本地，DSH 未同步]'}`);
                sendJson({ ok: true, mode: requestedMode, closedAgentPreset: next.closedAgentPreset, dshSynced });
                return;
            }
        },
        getDshModel: {
            matches: (req, url) => req.method === 'GET' && url.pathname === '/api/dsh/model',
            async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
                sendJson(await (0, deps.queryModelCatalog)());
                return;
            }
        }
    };
}
