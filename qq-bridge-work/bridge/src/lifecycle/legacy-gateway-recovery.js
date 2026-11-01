// Generated from lifecycle/legacy-gateway-recovery.ts. Edit the TypeScript source and run build:typed.
/**
 * 协调旧通道连接恢复，构造无IO；原生绑定时所有方法立即跳过发现和持久化。
 * @param deps 当前配置、旧连接、显式发现/写回能力和时钟。
 * @returns 应用端点、连接后写回和有节流的恢复；followDiscoveredEndpoint=false时保留用户端点。
 * @note HTTP与WS凭据分开处理，日志沿旧脱敏入口，不输出凭据值。
 */
export function createLegacyGatewayRecovery(deps) {
    let tokenHealAt = 0;
    /**
       * OneBot兼容通道 恢复连接时自愈 accessToken。
       *
       * 为什么需要：OneBot兼容通道 的 OneBot 配置按账号分文件（config/onebot_<QQ号>.json），
       * 每个账号 token 不同。换账号登录后，config.json 里的旧 token 会 401/连不上，
       * 而 SDK 的重连会一直用**构造时**那个 token 无限重试 —— 表现为"桥接活着但收发全废"。
       * 这里在每次重连失败时重新发现当前账号的 token 并热更新，随后自愈。
       */
    /**
     * 应用自愈结果：**HTTP token 与 WS token 是两个不同的值**。
     *   - cfg.onebot.accessToken → HTTP 调用（发语音、fetch_ptt_text、get_msg 等）与写回 config.json
     *   - bot.accessToken          → WebSocket 连接（桥接的主链路，端口 3001）
     * 只修其中一个的话，桥接仍会以 1006 反复重连（实测踩过）。
     */
    async function applyHealedTokens(r) {
        if (deps.nativeBinding)
            return false;
        const httpToken = r.token;
        const wsToken = r.wsToken || r.token;
        // 旧外部通道兼容约定见 docs/legacy/GATEWAY_COMPATIBILITY_NOTES.md；原生通道使用所属网关状态。
        const followEndpoint = deps.cfg.onebot?.followDiscoveredEndpoint !== false;
        const wsUrl = followEndpoint ? (r.wsUrl || deps.cfg.onebot.wsUrl) : deps.cfg.onebot.wsUrl;
        const wsChanged = deps.bot.accessToken !== wsToken || deps.bot.url !== wsUrl;
        deps.bot.accessToken = wsToken || undefined;
        // 端口也是 per-account 的（实测：换账号后 WS 从 3001 之类变到别的端口），
        // 只换 token 不换 URL 会一直 1006 重连。
        deps.bot.url = wsUrl;
        if (wsChanged)
            (0, deps.log)(`🔄 OneBot兼容通道 WS 连接已更新：${wsUrl}（凭据已隐藏）`);
        if (deps.cfg.onebot.accessToken !== httpToken) {
            (0, deps.log)(`🔄 OneBot兼容通道 HTTP token 已更新（来源 ${r.source}，凭据已隐藏）`);
            deps.cfg.onebot.accessToken = httpToken;
        }
        if (!followEndpoint && r.wsUrl && r.wsUrl !== deps.cfg.onebot.wsUrl) {
            (0, deps.log)(`   （已按 snowluma.followDiscoveredEndpoint=false 忽略发现到的端点 ${r.wsUrl}，继续用配置值 ${deps.cfg.onebot.wsUrl}）`);
        }
        // 把确认可用的端点写回 config.json：下次启动直接就对了，不用再自愈一遍。
        // ⚠️ 必须在**改 cfg 之前**算出要写什么，但写文件时对照的是**文件里**的旧值 ——
        //    这里显式传 wsUrl，且不依赖 cfg 的内存值来判断"是否需要写"。
        // 关掉端点跟随时不写 URL：否则"我设了别处"这件事会被自愈持久化地抹掉。
        const previousWsUrl = deps.cfg.onebot.wsUrl;
        deps.cfg.onebot.wsUrl = wsUrl;
        try {
            const w = (0, deps.persistLegacyOnebotEndpoint)(deps.path.join(deps.ROOT, 'config.json'), {
                accessToken: httpToken,
                ...(followEndpoint ? { wsUrl, httpUrl: r.baseUrl } : {})
            });
            if (w.updated)
                (0, deps.log)(`   已写回 config.json：${Object.keys(w.changed).join(' / ')}`);
            else
                (0, deps.log)('   config.json 端点已是最新，无需改写');
            if (!followEndpoint && previousWsUrl !== wsUrl)
                deps.cfg.onebot.wsUrl = previousWsUrl;
        }
        catch (error) {
            (0, deps.log)(`   ⚠️ 写回 config.json 失败：${error?.message ?? error}`);
        }
        // 更新了就让 SDK 立刻用新参数重连（否则要等下一轮退避，最长要好几秒）
        if (wsChanged) {
            try {
                deps.bot.close(1000, 'token-refresh');
            }
            catch { }
            try {
                deps.bot.connect().catch(() => { });
            }
            catch { }
        }
        return wsChanged;
    }
    /** 只写文件、不动物件（连接已成功时用）。 */
    async function syncTokenToFile() {
        if (deps.nativeBinding)
            return;
        try {
            const r = (0, deps.persistToken)(deps.path.join(deps.ROOT, 'config.json'), deps.cfg.onebot.accessToken ?? '');
            // 只记「已写回」，不打印 token 片段：日志会被贴进 issue / 截图，
            // 前 4 个字符同样是凭据的一部分（CWE-532，见 PR #13）。
            if (r.updated)
                (0, deps.log)('🔄 已把当前 token 写回 config.json');
        }
        catch { }
    }
    async function healTokenIfStale(reason) {
        if (deps.nativeBinding || deps.cfg.onebot?.autoDiscover === false)
            return;
        const now = deps.Date.now();
        if (now - tokenHealAt < 10000)
            return; // 节流：close 事件会连续触发
        tokenHealAt = now;
        try {
            const r = await (0, deps.discoverLegacyOnebotConnection)({ cfg: deps.cfg, timeoutMs: 4000 });
            if (!r.ok) {
                (0, deps.log)(`⚠️ token 自愈失败（${reason}）：${r.error}`);
                return;
            }
            await applyHealedTokens(r);
            (0, deps.log)(`   自愈完成：账号 ${r.self?.user_id ?? '?'}（${reason}）`);
        }
        catch (error) {
            (0, deps.log)(`⚠️ token 自愈异常：${error?.message ?? error}`);
        }
    }
    return { applyHealedTokens, syncTokenToFile, healTokenIfStale };
}
