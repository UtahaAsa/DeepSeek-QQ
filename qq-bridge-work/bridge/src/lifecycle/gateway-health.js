// Generated from lifecycle/gateway-health.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
/**
 * 创建上游网关健康视图，构造无IO且不启动定时器。
 * @param deps 所属网关、配置、时钟和传输；原生通道只调用原生状态接口。
 * @returns 心跳记录、只读快照及显式启动方法；state供连接/账号事件写入同一视图。
 * @note 区分明确good=false与没有心跳，状态告警沿边沿输出，不将静默等同进程退出。
 */
export function createGatewayHealth(deps) {
    let snowlumaWatchStarted = false;
    const SNOWLUMA_STATUS_POLL_MS = 60_000;
    const SNOWLUMA_SILENCE_WARN_MS = Math.max(60_000, Number(deps.cfg.onebot?.silenceWarnMs) || 10 * 60_000);
    const gatewayHealth = {
        lastPacketAt: 0, // 最近一个来自 SnowLuma 的事件包（含 meta/心跳）
        lastPacketKind: '',
        accountOnline: null, // bot_status 的 online/offline（需要较新的 SnowLuma 运行时）
        good: null, // 接收链路健康度：来自心跳 status.good / get_status.good
        goodSource: '', // 'heartbeat' | 'get_status' —— 便于诊断"这条判断从哪来"
        goodError: '',
        goodCheckedAt: 0,
        degraded: false, // 当前是否处于"已告警"状态（边沿触发，避免刷屏）
        reason: '',
    };
    /** 记录一次"上游还活着"的证据。任何来自 SnowLuma 的事件包都算（含心跳）。 */
    function noteUpstreamPacket(kind) {
        gatewayHealth.lastPacketAt = deps.Date.now();
        gatewayHealth.lastPacketKind = String(kind ?? '');
    }
    /** 记下一次接收链路健康度。@param good - boolean；非布尔值忽略。 */
    function noteReceiveHealth(good, source) {
        if (typeof good !== 'boolean')
            return;
        gatewayHealth.good = good;
        gatewayHealth.goodSource = source;
        gatewayHealth.goodError = '';
        gatewayHealth.goodCheckedAt = deps.Date.now();
    }
    /** 供 /api/status 与控制台使用的只读快照。 */
    function gatewayHealthSnapshot() {
        const now = deps.Date.now();
        const agoMs = gatewayHealth.lastPacketAt ? now - gatewayHealth.lastPacketAt : null;
        const silent = gatewayHealth.lastPacketAt > 0 && agoMs > SNOWLUMA_SILENCE_WARN_MS;
        // 只有 OneBot兼容通道 **明确自报** good=false 才算"确认坏了"（接收链路）。
        // 「静默」只能说明连它的进程/WS 都没动静了 —— 那是**另一个**故障面，措辞必须分开。
        const confirmed = gatewayHealth.good === false;
        let hint = null;
        if (confirmed) {
            hint = 'QQ 网关上报接收状态异常（good=false）。'
                + '请检查服务状态、QQ 登录状态及网关和桥接日志；'
                + '仅凭此状态不能确定故障原因。';
        }
        else if (silent) {
            hint = `${Math.round(agoMs / 60000)} 分钟没有收到 QQ 网关事件包（含心跳）。`
                + '这不等于已确认网关进程退出；'
                + '请检查连接和服务状态，并结合网关及桥接日志定位。';
        }
        return {
            // 只读 gatewayHealth.connected（由 bot 的 open/close 维护），**不要**在这里引用
            // `bot`：它在本闭包里声明得晚得多（`const`，TDZ），一旦有人把本函数提前调用就会
            // 抛 "Cannot access 'bot' before initialization"。
            connected: gatewayHealth.connected,
            accountOnline: gatewayHealth.accountOnline,
            good: gatewayHealth.good,
            goodSource: gatewayHealth.goodSource || null,
            goodError: gatewayHealth.goodError || null,
            lastPacketAgoMs: agoMs,
            lastPacketKind: gatewayHealth.lastPacketKind || null,
            silent,
            degraded: confirmed || silent,
            hint,
        };
    }
    /** 边沿触发地告警/恢复，避免每轮探测都刷一行日志。 */
    function reportSnowlumaHealth() {
        const snap = gatewayHealthSnapshot();
        if (snap.degraded && !gatewayHealth.degraded) {
            gatewayHealth.degraded = true;
            gatewayHealth.reason = snap.hint ?? '';
            (0, deps.log)(`⚠️ QQ网关通道不健康：${snap.hint}`);
            (0, deps.log)('   接收状态异常或静默不能单独确定故障原因。');
            (0, deps.log)('   排查：检查服务状态和QQ登录状态，保留网关及桥接日志。');
        }
        else if (!snap.degraded && gatewayHealth.degraded) {
            gatewayHealth.degraded = false;
            gatewayHealth.reason = '';
            (0, deps.log)('✅ QQ网关通道已恢复正常（good≠false 且事件包在流动）');
        }
    }
    /**
       * 问一次 OneBot兼容通道 的 `get_status`：账号在不在线、它自评的接收链路是否健康。
       *
       * ⚠️ 必须用 `get_status` —— `get_login_info` 只返回 `{ user_id, nickname }`，
       *    从它身上取 good 会永远拿到 undefined（而且不会报错，见上方长注释）。
       *    这里只是**兜底轮询**：主路径是每 30 秒一次的心跳（免费，见 onEvent）。
       */
    async function pollSnowlumaStatus() {
        if (deps.nativeBinding) {
            try {
                const status = await deps.bot.getStatus({ timeoutMs: 8000 });
                noteReceiveHealth(status?.good, 'get_status');
                gatewayHealth.accountOnline = status?.online === true;
                gatewayHealth.goodError = null;
            }
            catch {
                gatewayHealth.goodError = 'NATIVE_STATUS_UNAVAILABLE';
            }
            gatewayHealth.goodCheckedAt = deps.Date.now();
            reportSnowlumaHealth();
            return;
        }
        const httpUrl = String(deps.cfg.onebot?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
        try {
            const res = await (0, deps.fetch)(`${httpUrl}/get_status`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(deps.cfg.onebot?.accessToken ? { authorization: `Bearer ${deps.cfg.onebot.accessToken}` } : {}),
                },
                body: '{}',
                signal: deps.AbortSignal.timeout(8000),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.status !== 'ok') {
                gatewayHealth.goodError = `HTTP ${res.status}${body?.wording ? ` ${body.wording}` : ''}`;
            }
            else {
                noteReceiveHealth(body.data?.good, 'get_status');
                if (typeof body.data?.online === 'boolean')
                    gatewayHealth.accountOnline = body.data.online;
            }
        }
        catch (error) {
            gatewayHealth.goodError = error?.message ?? String(error);
        }
        gatewayHealth.goodCheckedAt = deps.Date.now();
        reportSnowlumaHealth();
    }
    function startSnowlumaWatch() {
        if (snowlumaWatchStarted)
            return;
        snowlumaWatchStarted = true;
        // 首次延后一点，避免与启动时的连接/自愈抢时序
        (0, deps.setTimeout)(() => { void pollSnowlumaStatus(); }, 5000);
        (0, deps.setInterval)(() => { void pollSnowlumaStatus(); }, SNOWLUMA_STATUS_POLL_MS);
        // 边沿告警的兜底心跳：主信号（心跳 status.good）到达时会立刻评估，这里只防"心跳也没了"
        (0, deps.setInterval)(reportSnowlumaHealth, 30_000);
    }
    return { noteUpstreamPacket, noteReceiveHealth, gatewayHealthSnapshot, reportSnowlumaHealth, pollSnowlumaStatus, startSnowlumaWatch, state: gatewayHealth };
}
