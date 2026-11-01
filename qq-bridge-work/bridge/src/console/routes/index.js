// Generated from console/routes/index.ts. Edit the TypeScript source and run build:typed.
import { createNativeSettingsRoutes } from './native-settings.js';
import { createStatusModeRoutes } from './status-mode.js';
import { createSecurityLifecycleRoutes } from './security-lifecycle.js';
import { createMessageToolsRoutes } from './message-tools.js';
import { createSocialStateRoutes } from './social-state.js';
import { createInboxWakeRoutes } from './inbox-wake.js';
import { createTextSendRoutes } from './text-send.js';
import { createPokeRoutes } from './poke.js';
import { createStickerToolsRoutes } from './sticker-tools.js';
import { createVoiceSendRoutes } from './voice-send.js';
import { createWaitRoutes } from './wait.js';
import { createHistoryRoutes } from './history.js';
// 属性转发保留实时值；各功能模块只获得实际使用的依赖，不共享完整上下文。
function dependencyView(source, readKeys, writeKeys) {
    const view = Object.create(null);
    for (const name of readKeys)
        Object.defineProperty(view, name, {
            enumerable: true, get: () => source[name],
            ...(writeKeys.includes(name) ? { set: (value) => { source[name] = value; } } : {})
        });
    return Object.freeze(view);
}
/**
 * 按功能组合控制台路由，不读取依赖值、不启动服务。
 * @param {object} deps 宿主的实时依赖视图，只有原有可变绑定需要setter。
 * @returns {object} 命名路由表；matches同步匹配，handle调用后该请求已处理。
 * @note 统一鉴权仍在宿主，宿主保持原来的匹配顺序。
 */
export function createRemainingConsoleRoutes(deps) {
    return Object.freeze({
        ...createNativeSettingsRoutes(dependencyView(deps, ["nativeSinging", "singingError", "nativeBinding", "currentMode", "avatarReader", "nativeCapabilities", "agentTokenOk", "nativeFeatureAccess", "prepareSelfAvatarSend", "bot", "nativeImageApi", "imagePreferences", "log", "nativePhone", "phonePageState", "path", "ROOT", "readConfigObject", "atomicWriteJson", "cfg", "nativeFeatureGrants", "phoneRecoveryTask", "phoneRecoveryPhase", "phoneRecoveryId", "crypto", "nativePhoneModel", "nativeVoice", "captureSendGuard"], ["phoneRecoveryTask", "phoneRecoveryPhase", "phoneRecoveryId"])),
        ...createStatusModeRoutes(dependencyView(deps, ["readRoleState", "currentMode", "dshReady", "socialV2", "queryQQStatus", "bot", "nativeBinding", "nativeCapabilities", "closedAgentPreset", "cfg", "gatewayHealthSnapshot", "idleAvailable", "nativeIdleLoop", "idleDraftRunner", "readActivityTail", "phonePageState", "unwrap", "api", "normalizeModeInput", "VALID_MODES", "readJsonSafe", "path", "STATE_DIR", "atomicWriteJson", "log", "cleanupSocialForModeChange", "clearAllSocialV2Timers", "drainAllPromptQueues", "lastMode", "reconcileSessionPolicies", "setupSleepTimerV2", "scheduleProactiveCheckV2", "queryModelCatalog"], ["closedAgentPreset", "currentMode", "lastMode"])),
        ...createSecurityLifecycleRoutes(dependencyView(deps, ["cfg", "stateDirHardened", "STATE_DIR", "process", "manualDirCommand", "hardenStateDirAcl", "path", "ROOT", "readConfigObject", "atomicWriteJson", "log", "crypto", "atomicWriteText", "consoleToken", "agentTokenOk", "modeAllowed", "currentMode", "setTimeout", "saveState", "saveSocialV2State", "releaseLock"], ["stateDirHardened", "consoleToken"])),
        ...createMessageToolsRoutes(dependencyView(deps, ["SENSITIVE_RE", "allowed", "cfg", "modeAllowed", "currentMode", "escapeCqText", "redactKnownTokensOnly", "bot", "text", "log", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "findMessageMedia", "fetchMediaData", "unquoteJsonString", "socialV2", "shouldBlockSilentReply", "getSocialV2State", "resolveReplyTargetV2", "sendMessagesV2", "recordSentMessagesV2", "saveSocialV2State", "appendActivity", "scheduleReplyCheckV2"], [])),
        ...createSocialStateRoutes(dependencyView(deps, ['wakeTimers', "sessionEpoch", "sessionCreation", "clearAllSocialV2Timers", "drainAllPromptQueues", "socialV2", "state", "stopRetiredSessionWork", "usageObserver", "sessionModelManager", "reverse", "collectors", "v2TurnStartAt", "turnLeaseNoted", "toolCallNames", "pendingSendToolCalls", "sendToolSucceededSessions", "api", "forgetAgentToken", "seenForwardIds", "saveState", "pendingWakeKeys", "clearAllPendingWakeLeases", "wakeConfigUpdatedKeys", "markReadCalledKeys", "wakeConfigMissCount", "atomicWriteJson", "SOCIAL_V2_FILE", "log", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "getSocialV2State", "computeWakeSafetyV2", "nativeObservation", "cfg", "syncStickerLibrary", "readRoleState", "stickerEnabled", "selfDisplayName", "selfUserId", "selfIdentityTextV2", "currentMode", "currentRoleHintV2", "currentRoleHint", "replyTimingV2", "formatMemoryV2", "formatParticipationV2", "confirmedSlangListV2", "buildSlangContext", "slangEntries", "stickerEntries", "buildStickerContext", "buildStickerStrategyHint", "voiceLibrary", "voiceCfg", "modeAllowed", "clearTimeout", "saveSocialV2State", "sendWakePromptV2"], ["sessionEpoch"])),
        ...createInboxWakeRoutes(dependencyView(deps, ['wakeTimers', "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "getSocialV2State", "noteModelMessagesV2", "readThroughSeqV2", "requestedReadThroughSeqV2", "isSleepingConfigV2", "preSleepWaitBlockedV2", "cfg", "acknowledgeMessagesV2", "ensureWakeableV2", "markReadCalledKeys", "saveSocialV2State", "log", "computeWakeSafetyV2", "pickWakeTriggersV2", "normalizeSpeakerIdsV2", "wakeConfigUpdatedKeys", "wakeConfigMissCount", "clearTimeout", "cancelReplyCheckV2", "setupSleepTimerV2"], [])),
        ...createTextSendRoutes(dependencyView(deps, ["cfg", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "currentMode", "modeAllowed", "shouldBlockSilentReply", "SENSITIVE_RE", "getSocialV2State", "computeGapsV2", "sendMessagesV2", "recordSentMessagesV2", "saveSocialV2State", "log", "appendActivity", "scheduleReplyCheckV2", "findCjkSpaceWarning", "findSplitBoundaryWarning", "resolveReplyTargetV2"], [])),
        ...createPokeRoutes(dependencyView(deps, ["currentMode", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "socialV2", "modeAllowed", "cfg", "shouldBlockSilentReply", "assertGroupMember", "getSocialV2State", "captureSendGuard", "bot", "saveSocialV2State", "log", "appendActivity"], [])),
        ...createStickerToolsRoutes(dependencyView(deps, ["stickerEnabled", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "getStickerImageData", "safeFetchBuffer", "MAX_MEDIA_BYTES", "getImageDimensions", "MAX_MEDIA_PIXELS", "mimeFromBuffer", "mimeFromUrl", "toModelMedia", "path", "ROOT", "fs", "applyStickerNoteV2", "log", "setStickerRemarkV2", "currentMode", "modeAllowed", "cfg", "shouldBlockSilentReply", "getSocialV2State", "resolveReplyTargetV2", "sendStickerV2", "truncateText", "saveSocialV2State", "scheduleReplyCheckV2", "appendActivity", "collectStickerV2", "syncStickerLibrary", "formatStickerList", "stickerEntries", "stickerSyncedAt", "lastForcedAgentStickerSync"], ["lastForcedAgentStickerSync"])),
        ...createVoiceSendRoutes(dependencyView(deps, ["voiceCfg", "parseTargetKey", "modeAllowed", "cfg", "currentMode", "resolveVoicePathForOperator", "resolveAudioProcessing", "inspectAudio", "describeAudio", "voiceBudgetCheck", "sendVoiceV2", "voiceBudgetCommit", "log", "path", "appendActivity", "verifyVoiceMessageSent", "agentTokenOk", "v2ToolEnabled", "v2SessionAllowed", "shouldBlockSilentReply", "resolveVoicePathForV2", "sendVoiceForV2", "listAudioFiles"], [])),
        ...createWaitRoutes(dependencyView(deps, ['wakeTimers', "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "socialV2", "getSocialV2State", "readThroughSeqV2", "cfg", "nativeObservation", "currentMode", "state", "nativePolicyCurrent", "isCurrentSession", "nativeTurnFence", "cancelReplyCheckV2", "clearTimeout", "observationThroughSeqV2", "nativePolicyGeneration", "canonicalV2Key", "activeWaits", "ACTIVE_WAIT_LEASE_MS", "suggestQuietMsV2", "sleep", "preSleepWaitBlockedV2", "saveSocialV2State", "noteModelMessagesV2", "looksLikeUnfinished"], [])),
        ...createHistoryRoutes(dependencyView(deps, ["agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "getSocialV2State", "readThroughSeqV2", "resolveReplyInfo", "currentMode", "modeAllowed", "cfg", "seenForwardIds", "bot", "formatForwardResponse", "log", "fetchMediaData", "allowed", "onebotHttpAction", "truncateText"], []))
    });
}
