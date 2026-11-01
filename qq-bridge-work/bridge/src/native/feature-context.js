// Generated from native/feature-context.ts. Edit the TypeScript source and run build:typed.
/**
 * 持有功能会话资格、提示复用缓存与异步请求作用域；构造不查询或调用功能。
 * @param deps 实时权限/模式/会话快照与已有授权校验器，功能提示提供者按调用读取。
 * @returns 请求作用域、资格表、授权器与提示/上下文操作，宿主撤销沿同一视图清理。
 * @note 签发标记仅在同步提示生成期间有效；异步请求必须匹配目标并复核guard，查询不重签已消耗资格。
 */
export function createNativeFeatureContext(deps) {
    let nativeFeatureIssuing = false;
    const nativeFeatureRequests = new deps.AsyncLocalStorage();
    const nativeFeatureGrants = new Map();
    const nativeFeatureAccess = (0, deps.createNativeFeatureAccess)({ snapshot: key => {
            const match = /^(private|group):([1-9]\d{0,19})$/.exec((key ?? ''));
            const actorKey = deps.modeCoordinator.state.currentMode === 'closed-agent' ? `private:${String(deps.cfg.ownerQQ ?? '')}` : key;
            const sessionId = deps.state.sessions[actorKey];
            const targetAllowed = !!match && (actorKey === key ? (0, deps.isSessionAllowedInCurrentMode)(key)
                : !!deps.cfg.nativeScope && (0, deps.nativeScopeAllows)(deps.cfg.nativeScope, match[1], match[2]));
            const grant = nativeFeatureGrants.get(actorKey);
            const featureToken = grant && grant.sessionId === sessionId && grant.mode === deps.modeCoordinator.state.currentMode && grant.generation === deps.nativePolicyGeneration ? grant.token : undefined;
            return { native: !!deps.nativeBinding, mode: deps.modeCoordinator.state.currentMode, generation: deps.nativePolicyGeneration, featureToken,
                policyCurrent: deps.nativePolicyCurrent, ready: deps.modeCoordinator.state.dshReady && deps.bot.isConnected, actorKey, sessionId, targetAllowed,
                sessionCurrent: !!sessionId && (0, deps.isCurrentSession)(actorKey, sessionId) && (0, deps.isSessionAllowedInCurrentMode)(actorKey),
                paused: deps.modeCoordinator.state.currentMode === 'reserved2' && (deps.socialV2.paused || deps.cfg.socialV2?.enabled === false),
                silent: (0, deps.shouldBlockSilentReply)(actorKey), open: deps.nativeTurnFence?.hasOpenTurn(sessionId) === true,
                turn: deps.nativeTrackedTurns.get(sessionId), agentToken: deps.socialV2.conversations.get(actorKey)?.agentToken,
                fingerprint: JSON.stringify([(0, deps.sessionPolicy)(actorKey), (0, deps.currentRoleHint)(), (0, deps.readRoleState)().mode]) };
        } });
    function nativeFeatureContext(key) {
        try {
            const request = nativeFeatureRequests.getStore();
            if (request) {
                if (request.key !== key)
                    return null;
                request.guard();
            }
            return nativeFeatureAccess.context(key, nativeFeatureIssuing);
        }
        catch {
            return null;
        }
    }
    function buildNativeFeatureHints(key, { reuse = false } = {}) {
        const previous = nativeFeatureIssuing;
        nativeFeatureIssuing = true;
        try {
            const actorKey = deps.modeCoordinator.state.currentMode === 'closed-agent' ? `private:${String(deps.cfg.ownerQQ ?? '')}` : key;
            const sessionId = deps.state.sessions[actorKey];
            let grant = nativeFeatureGrants.get(actorKey);
            if (!sessionId || !(0, deps.isCurrentSession)(actorKey, sessionId))
                return '';
            if (!grant || grant.sessionId !== sessionId || grant.mode !== deps.modeCoordinator.state.currentMode || grant.generation !== deps.nativePolicyGeneration) {
                if (!grant && nativeFeatureGrants.size >= 128)
                    return '';
                grant = { sessionId, mode: deps.modeCoordinator.state.currentMode, generation: deps.nativePolicyGeneration, token: deps.crypto.randomBytes(32).toString('hex') };
                nativeFeatureGrants.set(actorKey, grant);
                (0, deps.rememberAgentToken)('feature:' + actorKey, grant.token);
            }
            // 只有新输入投递时轮换本轮提示；查询能力不能重新签发已消耗的写入资格。
            if (!reuse || !grant.hints)
                grant.hints = new Map();
            if (reuse && grant.hints.has(key))
                return grant.hints.get(key);
            if (grant.hints.size >= 128)
                return '';
            let hint = `\n【QQ功能会话令牌】${grant.token}\n所有模式的头像、媒体查询、功能资格查询和原生发送工具都传featureToken参数；仅用于当前会话及管理员明确指定的已授权目标，不能复述令牌。二代原有token仍用于二代调度工具。\n`
                + [deps.nativeImageApi?.hint(key), deps.nativeStickerApi?.hint(key), deps.nativeGroupApi?.hint(key), deps.nativeQzoneApi?.hint(key), deps.nativeSelfProfileApi?.hint(key)].filter(Boolean).join('')
                + (deps.nativeSinging && deps.nativeCapabilities.sendVoice ? '\n【RVC唱歌】可用qq_list_songs读取真实曲库，再用qq_prepare_song生成、qq_song_status查看任务，prepared后用qq_send_song发送。首次加载较慢；原会话与权限仍有效时，系统会在异步准备结束后通知你继续处理同一任务。准备中如实说明，不密集轮询；收到完成通知后先核对状态，再发送一次，不重新生成、不把普通TTS当唱歌，不得声称未确认的发送已送达。\n' : '');
            if (deps.cfg.phone?.enabled === true && key.startsWith('private:'))
                hint += '\n【QQ电话】可用qq_get_call_status查询当前私聊；incomingAvailable/outgoingAvailable分别决定接听与主动拨号是否可用。只操作返回的当前callId，可根据语境或心情用qq_end_call结束；受理不代表接通/挂断，未知结果不自动重拨。';
            grant.hints.set(key, hint);
            return hint;
        }
        finally {
            nativeFeatureIssuing = previous;
        }
    }
    return { nativeFeatureContext, buildNativeFeatureHints, nativeFeatureRequests, nativeFeatureGrants, nativeFeatureAccess };
}
