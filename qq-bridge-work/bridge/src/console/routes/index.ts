import type {NativeSettingsConfiguration, NativeSettingsDependencies, NativeSettingsRoutes, NativeSettingsCapabilities} from './native-settings.js';
import type {StatusConfiguration, StatusModeDependencies, StatusModeRoutes} from './status-mode.js';
import type {SecurityConfiguration, SecurityLifecycleDependencies, SecurityLifecycleRoutes} from './security-lifecycle.js';
import type {MessageToolsConfiguration, MessageToolsState, MessageToolsDependencies, MessageToolsRoutes} from './message-tools.js';
import type {SocialStateConfiguration, SocialRouteState, SocialStateDependencies, SocialStateRoutes} from './social-state.js';
import type {InboxWakeConfiguration, InboxWakeState, InboxWakeDependencies, InboxWakeRoutes} from './inbox-wake.js';
import type {TextSendConfiguration, TextSendState, TextSendDependencies, TextSendRoutes} from './text-send.js';
import type {PokeConfiguration, PokeState, PokeDependencies, PokeRoutes} from './poke.js';
import type {StickerToolsConfiguration, StickerToolsState, StickerToolEntry, StickerToolsDependencies, StickerToolsRoutes} from './sticker-tools.js';
import type {VoiceSendConfiguration, VoiceAudioProbe, VoiceSendDependencies, VoiceSendRoutes} from './voice-send.js';
import type {WaitConfiguration, WaitState, WaitDependencies, WaitRoutes} from './wait.js';
import type {HistoryState, HistoryDependencies, HistoryRoutes} from './history.js';
import type {QQStatusBot} from '../../qq-status-view.js';
/** 合并各功能实际使用的配置切片；外部输入仍由原有运行时边界校验。 */
export type RemainingConsoleConfiguration = NativeSettingsConfiguration & StatusConfiguration & SecurityConfiguration &
  MessageToolsConfiguration & SocialStateConfiguration & InboxWakeConfiguration & TextSendConfiguration &
  PokeConfiguration & StickerToolsConfiguration & VoiceSendConfiguration & WaitConfiguration;
/** 同一个宿主会话对象满足各功能需要，不创建状态副本或转移定时器所有权。 */
export type RemainingConsoleState = MessageToolsState & SocialRouteState & InboxWakeState & TextSendState &
  PokeState & StickerToolsState & WaitState & HistoryState;
/** 状态查询、头像、消息、戳一戳和历史共用的网关能力。 */
export type RemainingConsoleBot<Segment> = QQStatusBot & NativeSettingsDependencies<RemainingConsoleConfiguration>['bot'] &
  MessageToolsDependencies<RemainingConsoleConfiguration,Segment>['bot'] &
  PokeDependencies<RemainingConsoleConfiguration>['bot'] & HistoryDependencies<RemainingConsoleConfiguration>['bot'];
/**
 * 路由组合的实时依赖契约，复用十二组功能接口并保留宿主扩展类型。
 * @remarks 原有十个可写绑定沿用各切片声明；其余顶层属性只读。clearTimeout仅保留旧视图兼容性。
 */
export type RemainingConsoleDependencies<
  Configuration extends RemainingConsoleConfiguration = RemainingConsoleConfiguration,
  State extends RemainingConsoleState = RemainingConsoleState,
  Segment = unknown, Slang = unknown, Sticker extends StickerToolEntry = StickerToolEntry,
  Probe extends VoiceAudioProbe = VoiceAudioProbe
> = NativeSettingsDependencies<Configuration> &
  StatusModeDependencies<RemainingConsoleBot<Segment>,NativeSettingsCapabilities | null,Configuration> &
  SecurityLifecycleDependencies<Configuration> & MessageToolsDependencies<Configuration,Segment,State> &
  SocialStateDependencies<Configuration,State,Slang,Sticker> & InboxWakeDependencies<Configuration,State> &
  TextSendDependencies<Configuration,State> & PokeDependencies<Configuration> &
  StickerToolsDependencies<Configuration,State,Sticker> & VoiceSendDependencies<Configuration,Probe> &
  WaitDependencies<Configuration,State> & HistoryDependencies<Configuration,State> & {
    readonly clearTimeout: (handle: ReturnType<typeof setTimeout> | undefined) => void;
  };
/** 命名表不可替换；等待和头像保留各自的连接事件上下文。 */
export type RemainingConsoleRoutes = Readonly<NativeSettingsRoutes & StatusModeRoutes & SecurityLifecycleRoutes &
  MessageToolsRoutes & SocialStateRoutes & InboxWakeRoutes & TextSendRoutes & PokeRoutes & StickerToolsRoutes &
  VoiceSendRoutes & WaitRoutes & HistoryRoutes>;

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
function dependencyView<Source, Key extends keyof Source>(source: Source, readKeys: readonly Key[], writeKeys: readonly NoInfer<Key>[]): Readonly<Pick<Source,Key>> {
  const view: Pick<Source,Key> = Object.create(null);
  for (const name of readKeys) Object.defineProperty(view, name, {
    enumerable: true, get: () => source[name],
    ...(writeKeys.includes(name) ? { set: (value: Source[Key]) => { source[name] = value; } } : {})
  });
  return Object.freeze(view);
}
/**
 * 按功能组合控制台路由，不读取依赖值、不启动服务。
 * @param {object} deps 宿主的实时依赖视图，只有原有可变绑定需要setter。
 * @returns {object} 命名路由表；matches同步匹配，handle调用后该请求已处理。
 * @note 统一鉴权仍在宿主，宿主保持原来的匹配顺序。
 */
export function createRemainingConsoleRoutes<Configuration extends RemainingConsoleConfiguration, State extends RemainingConsoleState, Segment, Slang, Sticker extends StickerToolEntry, Probe extends VoiceAudioProbe>(deps: RemainingConsoleDependencies<Configuration, State, Segment, Slang, Sticker, Probe>): RemainingConsoleRoutes {
  return Object.freeze({
    ...createNativeSettingsRoutes<Configuration>(dependencyView(deps, ["nativeSinging", "singingError", "nativeBinding", "currentMode", "avatarReader", "nativeCapabilities", "agentTokenOk", "nativeFeatureAccess", "prepareSelfAvatarSend", "bot", "nativeImageApi", "imagePreferences", "log", "nativePhone", "phonePageState", "path", "ROOT", "readConfigObject", "atomicWriteJson", "cfg", "nativeFeatureGrants", "phoneRecoveryTask", "phoneRecoveryPhase", "phoneRecoveryId", "crypto", "nativePhoneModel", "nativeVoice", "captureSendGuard"], ["phoneRecoveryTask", "phoneRecoveryPhase", "phoneRecoveryId"])),
    ...createStatusModeRoutes<RemainingConsoleBot<Segment>, NativeSettingsCapabilities | null, Configuration>(dependencyView(deps, ["readRoleState", "currentMode", "dshReady", "socialV2", "queryQQStatus", "bot", "nativeBinding", "nativeCapabilities", "closedAgentPreset", "cfg", "gatewayHealthSnapshot", "idleAvailable", "nativeIdleLoop", "idleDraftRunner", "readActivityTail", "phonePageState", "unwrap", "api", "normalizeModeInput", "VALID_MODES", "readJsonSafe", "path", "STATE_DIR", "atomicWriteJson", "log", "cleanupSocialForModeChange", "clearAllSocialV2Timers", "drainAllPromptQueues", "lastMode", "reconcileSessionPolicies", "setupSleepTimerV2", "scheduleProactiveCheckV2", "queryModelCatalog"], ["closedAgentPreset", "currentMode", "lastMode"])),
    ...createSecurityLifecycleRoutes<Configuration>(dependencyView(deps, ["cfg", "stateDirHardened", "STATE_DIR", "process", "manualDirCommand", "hardenStateDirAcl", "path", "ROOT", "readConfigObject", "atomicWriteJson", "log", "crypto", "atomicWriteText", "consoleToken", "agentTokenOk", "modeAllowed", "currentMode", "setTimeout", "saveState", "saveSocialV2State", "releaseLock"], ["stateDirHardened", "consoleToken"])),
    ...createMessageToolsRoutes<Configuration, Segment, State>(dependencyView(deps, ["SENSITIVE_RE", "allowed", "cfg", "modeAllowed", "currentMode", "escapeCqText", "redactKnownTokensOnly", "bot", "text", "log", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "findMessageMedia", "fetchMediaData", "unquoteJsonString", "socialV2", "shouldBlockSilentReply", "getSocialV2State", "resolveReplyTargetV2", "sendMessagesV2", "recordSentMessagesV2", "saveSocialV2State", "appendActivity", "scheduleReplyCheckV2"], [])),
    ...createSocialStateRoutes<Configuration, State, Slang, Sticker>(dependencyView(deps, ['wakeTimers',"sessionEpoch", "sessionCreation", "clearAllSocialV2Timers", "drainAllPromptQueues", "socialV2", "state", "stopRetiredSessionWork", "usageObserver", "sessionModelManager", "reverse", "collectors", "v2TurnStartAt", "turnLeaseNoted", "toolCallNames", "pendingSendToolCalls", "sendToolSucceededSessions", "api", "forgetAgentToken", "seenForwardIds", "saveState", "pendingWakeKeys", "clearAllPendingWakeLeases", "wakeConfigUpdatedKeys", "markReadCalledKeys", "wakeConfigMissCount", "atomicWriteJson", "SOCIAL_V2_FILE", "log", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "getSocialV2State", "computeWakeSafetyV2", "nativeObservation", "cfg", "syncStickerLibrary", "readRoleState", "stickerEnabled", "selfDisplayName", "selfUserId", "selfIdentityTextV2", "currentMode", "currentRoleHintV2", "currentRoleHint", "replyTimingV2", "formatMemoryV2", "formatParticipationV2", "confirmedSlangListV2", "buildSlangContext", "slangEntries", "stickerEntries", "buildStickerContext", "buildStickerStrategyHint", "voiceLibrary", "voiceCfg", "modeAllowed", "clearTimeout", "saveSocialV2State", "sendWakePromptV2"], ["sessionEpoch"])),
    ...createInboxWakeRoutes<Configuration, State>(dependencyView(deps, ['wakeTimers',"agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "getSocialV2State", "noteModelMessagesV2", "readThroughSeqV2", "requestedReadThroughSeqV2", "isSleepingConfigV2", "preSleepWaitBlockedV2", "cfg", "acknowledgeMessagesV2", "ensureWakeableV2", "markReadCalledKeys", "saveSocialV2State", "log", "computeWakeSafetyV2", "pickWakeTriggersV2", "normalizeSpeakerIdsV2", "wakeConfigUpdatedKeys", "wakeConfigMissCount", "clearTimeout", "cancelReplyCheckV2", "setupSleepTimerV2"], [])),
    ...createTextSendRoutes<Configuration, State>(dependencyView(deps, ["cfg", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "currentMode", "modeAllowed", "shouldBlockSilentReply", "SENSITIVE_RE", "getSocialV2State", "computeGapsV2", "sendMessagesV2", "recordSentMessagesV2", "saveSocialV2State", "log", "appendActivity", "scheduleReplyCheckV2", "findCjkSpaceWarning", "findSplitBoundaryWarning", "resolveReplyTargetV2"], [])),
    ...createPokeRoutes<Configuration>(dependencyView(deps, ["currentMode", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "socialV2", "modeAllowed", "cfg", "shouldBlockSilentReply", "assertGroupMember", "getSocialV2State", "captureSendGuard", "bot", "saveSocialV2State", "log", "appendActivity"], [])),
    ...createStickerToolsRoutes<Configuration, State, Sticker>(dependencyView(deps, ["stickerEnabled", "agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "getStickerImageData", "safeFetchBuffer", "MAX_MEDIA_BYTES", "getImageDimensions", "MAX_MEDIA_PIXELS", "mimeFromBuffer", "mimeFromUrl", "toModelMedia", "path", "ROOT", "fs", "applyStickerNoteV2", "log", "setStickerRemarkV2", "currentMode", "modeAllowed", "cfg", "shouldBlockSilentReply", "getSocialV2State", "resolveReplyTargetV2", "sendStickerV2", "truncateText", "saveSocialV2State", "scheduleReplyCheckV2", "appendActivity", "collectStickerV2", "syncStickerLibrary", "formatStickerList", "stickerEntries", "stickerSyncedAt", "lastForcedAgentStickerSync"], ["lastForcedAgentStickerSync"])),
    ...createVoiceSendRoutes<Configuration, Probe>(dependencyView(deps, ["voiceCfg", "parseTargetKey", "modeAllowed", "cfg", "currentMode", "resolveVoicePathForOperator", "resolveAudioProcessing", "inspectAudio", "describeAudio", "voiceBudgetCheck", "sendVoiceV2", "voiceBudgetCommit", "log", "path", "appendActivity", "verifyVoiceMessageSent", "agentTokenOk", "v2ToolEnabled", "v2SessionAllowed", "shouldBlockSilentReply", "resolveVoicePathForV2", "sendVoiceForV2", "listAudioFiles"], [])),
    ...createWaitRoutes<Configuration, State>(dependencyView(deps, ['wakeTimers',"agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "socialV2", "getSocialV2State", "readThroughSeqV2", "cfg", "nativeObservation", "currentMode", "state", "nativePolicyCurrent", "isCurrentSession", "nativeTurnFence", "cancelReplyCheckV2", "clearTimeout", "observationThroughSeqV2", "nativePolicyGeneration", "canonicalV2Key", "activeWaits", "ACTIVE_WAIT_LEASE_MS", "suggestQuietMsV2", "sleep", "preSleepWaitBlockedV2", "saveSocialV2State", "noteModelMessagesV2", "looksLikeUnfinished"], [])),
    ...createHistoryRoutes<Configuration, State>(dependencyView(deps, ["agentTokenOk", "v2SessionAllowed", "v2ToolEnabled", "getSocialV2State", "readThroughSeqV2", "resolveReplyInfo", "currentMode", "modeAllowed", "cfg", "seenForwardIds", "bot", "formatForwardResponse", "log", "fetchMediaData", "allowed", "onebotHttpAction", "truncateText"], []))
  });
}
