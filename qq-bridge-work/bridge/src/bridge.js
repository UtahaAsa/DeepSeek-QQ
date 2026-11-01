// Generated from bridge.ts. Edit the TypeScript source and run build:typed.
import { createOnebotSender } from './messaging/onebot-send.js';
import { createNativeFeatureDelivery } from './native/feature-delivery.js';
import { createLegacyGatewayRecovery } from './lifecycle/legacy-gateway-recovery.js';
import { createNativeObservationCoordinator } from './native/observation-coordinator.js';
import { createNativeFeatureContext } from './native/feature-context.js';
import { createRolePromptContext } from './roles/prompt-context.js';
import { createOutputWarnings } from './messaging/output-warnings.js';
import { createTokenRegistry } from './security/token-registry.js';
import { createToolAudit } from './logging/tool-audit.js';
import { createMessageSegments } from './messaging/segments.js';
import { createGroupMembers } from './messaging/group-members.js';
import { createReplyContext } from './messaging/reply-context.js';
import { MODE_INPUT_ALIASES, VALID_MODES, normalizeModeInput, settingFromDshNamespace } from './config/mode-inputs.js';
import { createModeCoordinator } from './lifecycle/mode-coordinator.js';
import { createGatewayHealth } from './lifecycle/gateway-health.js';
import { createJsonFiles } from './storage/json-files.js';
import { createSessionMappingStore } from './sessions/mapping-store.js';
import { createInstanceLock } from './lifecycle/instance-lock.js';
import { createBridgeLogger } from './logging/capped-logger.js';
import { createImageTools } from './media/image-tools.js';
import { createMediaPipeline } from './media/pipeline.js';
import { createMediaContext } from './media/context.js';
import { createOnebotHttp } from './messaging/onebot-http.js';
import { createStickerLibrary } from './libraries/sticker-store.js';
import { createStickerActions } from './libraries/sticker-actions.js';
import { createVoiceLibrary } from './voice/library.js';
import { createVoiceBudget } from './voice/budget.js';
import { createVoiceDelivery } from './voice/delivery.js';
import { createLegacyContext } from './social/legacy-context.js';
import { createLegacySocialEngine } from './social/legacy-engine.js';
import { createSlangLearning } from './libraries/slang-learning.js';
import { createOwnedTimers } from './wake/owned-timers.js';
import { createWakeConfiguration } from './wake/configuration.js';
import { createV2StateStore } from './social/v2-store.js';
import { createV2Messages } from './social/v2-messages.js';
import { createReadReceipts } from './context/read-receipts.js';
import { createWakeContext } from './context/wake-context.js';
import { createWakeTriggers } from './wake/triggers.js';
import { createWakeDispatcher } from './wake/dispatch.js';
import { createWakeScheduler } from './wake/scheduler.js';
import { createOfflineQueue } from './messaging/offline-queue.js';
import { createIncomingMessages } from './messaging/incoming.js';
import { createPendingRequests } from './sessions/pending-requests.js';
import { createTurnEvents } from './sessions/turn-events.js';
import { createSessionFrameHandler } from './sessions/frame-handler.js';
import { createSessionEventStream } from './sessions/event-stream.js';
import { createPromptQueue } from './messaging/prompt-queue.js';
import { createPromptDispatcher } from './messaging/prompt-dispatch.js';
import { createSessionCreation } from './sessions/creation.js';
import { createSessionRetirement } from './sessions/retirement.js';
import { createRemainingConsoleRoutes } from './console/routes/index.js';
import { confirmedSlangEntries } from './libraries/slang-agent-policy.js';
import { createSlangAgentRoutes } from './libraries/slang-agent-routes.js';
import { createMemoryRoutes } from './social/memory-routes.js';
import { createConversationMemory } from './social/conversation-memory.js';
import { createFeedbackStore } from './console/feedback-store.js';
import { createFeedbackRoutes } from './console/feedback-routes.js';
import { createOperatorNoticeRoutes } from './console/operator-notice.js';
import { createSocialSettingsRoutes } from './social/settings-routes.js';
import { createLegacySocialRoutes } from './social/legacy-routes.js';
import { createSessionAdminRoutes } from './sessions/admin-routes.js';
import { createTokenRoutes } from './usage/token-routes.js';
import { createStickerRoutes } from './libraries/sticker-routes.js';
import { createSlangRoutes } from './libraries/slang-routes.js';
// QQ ↔ DeepSeek Harness 桥接主程序。
//
// 链路：
//   QQ 消息 → QQ原生网关 (OneBot v11 WS) → 本进程 → DSH Web API session.prompt
//   DSH agent 回复/提问/审批 → events.mux 事件流 → 本进程 → send_msg → QQ
//
// 用法：node src/bridge.js （先编辑 ../config.json）
import { createRoleStore } from './roles/role-store.js';
import { validateRoleName, sanitizeRoleName } from './roles/role-policy.js';
import { createConfigLoader } from './config/load-config.js';
import { normalizeOwnerQQ, REASONING_EFFORT_DEFAULT } from './config/inputs.js';
import { createRoleRoutes } from './roles/role-routes.js';
import { createSettingsRoutes } from './config/settings-routes.js';
import { createConsoleRequest } from './console/request-context.js';
import { createConsoleAccess } from './console/access-policy.js';
import { planSocialTimeline } from './messaging/message-segmentation.js';
import { createGapPlanner } from './messaging/gap-planner.js';
import { createOutboundPolicy } from './messaging/outbound-policy.js';
import { createOutboundAudit } from './messaging/outbound-audit.js';
import { createSessionModels } from './models/session-models.js';
import { createUsageObserver } from './sessions/usage-observer.js';
import { createSnapshotRecovery } from './sessions/turn-replay.js';
import { createInitialPromptStore } from './prompts/initial-prompt-store.js';
import { createInitialPromptRoutes } from './prompts/initial-prompt-routes.js';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createPresetStore } from './presets/preset-store.js';
import { createPresetRoutes } from './presets/preset-routes.js';
import { createModelCatalogQuery } from './models/model-catalog.js';
import { isCjkLikeChar, renderRoleInjection } from './role-card.js';
import { fileURLToPath } from 'node:url';
import { OneBotWebSocketClient, text } from './onebot-client.js';
import { connectNativeGateway, applyNativeGatewayConfig } from './native-gateway.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createNativeTurnFence, readNativeTurnBaseline } from './native-turn-fence.js';
import { prepareSelfAvatarSend } from './self-avatar-send.js';
import { createNativeBackgroundObservation, readNativeTerminalTurn } from './native-background-observation.js';
import { createNativeFeatureAccess } from './native-feature-access.js';
import { createNativeFeatureRoutes, isNativeFeatureRoute } from './native-feature-routes.js';
import { createNativeStickerApi } from './native-sticker-api.js';
import { createRoleTrash } from './role-trash.js';
import { nativeScopeAllows, nativeScopeSummary } from '../../native-research/native-adapter/scope-policy.mjs';
import { nativeCapabilitiesFor, nativeChatMessages, nativeChatHint } from './native-chat.js';
import { createVoiceManager } from './voice-manager.js';
import { createSingingManager, singingError } from './singing-manager.js';
import { createSingingFollowup } from './native/singing-followup.js';
import { uploadNativeRecord } from './native-record-upload.js';
import { createBurstSender } from './messaging/burst-sender.js';
import { createSendQueue } from './messaging/send-queue.js';
import { createReplySender } from './messaging/reply-sender.js';
import { createIdleDraftRunner } from './idle-draft.js';
import { createPhoneModel } from './phone-model.js';
import { archivePhoneSession } from './phone-session-archive.js';
import { createPhoneManager } from './phone-manager.js';
import { createNativeIdleLoop } from './native-idle-loop.js';
import { queryQQStatus } from './qq-status-view.js';
import { createQQAvatarReader } from './qq-avatar.js';
import { createImageGenerationApi, IMAGE_GENERATION_API_ERRORS } from './image-generation-api.js';
import { createImagePreferences } from './image-preferences.js';
import { createGroupManagementApi } from './group-management-api.js';
import { createQzoneApi } from './qzone-api.js';
import { createSelfProfileApi } from './self-profile-api.js';
import { NodeApiClient, unwrap, createTurnCollector, discoverDshLaunchToken } from './dsh-client.js';
import { mdToPlain, splitForQQ, truncateText, truncateTextTail } from './md-to-plain.js';
import { SENSITIVE_RE } from './sensitive.js';
import { looksLikeUnfinished } from './v2-wait.js';
import { compactModelMessage, describeAge } from './qq-model-view.js';
import { safeFetchBuffer, looksLikeImageBuffer } from './safe-fetch.js';
import { normalizeImageForModel } from './media-normalize.js';
import { AUDIO_EXTS, cleanupTemp, describeAudio, formatBytes, formatDuration, inspectAudio, listAudioFiles, parseTargetKey, processAudioVolume, resolveAudioProcessing, resolveAudioSource, safeJoinLibrary } from './send-voice-lib.js';
import { discoverLegacyOnebotConnection, persistLegacyOnebotEndpoint, persistToken } from './legacy-onebot-compat.js';
import { hardenDir, manualDirCommand } from './state-acl.mjs';
import { extractForwardIds, forwardIdFromData, sanitizeForwardId, formatForwardResponse } from './forward.js';
import { resolvePriceTable } from './model-prices.js';
import { createTokenLedger } from './token-ledger.js';
import { loadSlang, saveSlang, upsertSlangEntry, buildSlangContext, buildExtractionPrompt, buildResearchPrompt, parseExtractionJson, parseResearchJson, createSlangEntry, mergeEvidence, SLANG_STATUS, SLANG_MAX_ENTRIES } from './slang-learner.js';
import { loadStickerStore, saveStickerStore, mergeStickerLibrary, findSticker, formatStickerList, buildStickerContext, buildStickerStrategyHint, applyStickerNote, markStickerUsed } from './sticker-lib.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(__dirname, '..');
// 显式独立运行目录容纳配置/状态/素材，源文件和依赖仍从只读代码目录加载。
const ROOT = process.env.QQ_BRIDGE_RUNTIME_ROOT ? path.resolve(process.env.QQ_BRIDGE_RUNTIME_ROOT) : SOURCE_ROOT;
const STATE_DIR = path.join(ROOT, 'state');
const STATE_FILE = path.join(STATE_DIR, 'sessions.json');
const ROLE_STATE_FILE = path.join(STATE_DIR, 'current-role.json');
const SLANG_FILE = path.join(STATE_DIR, 'slang.json');
const SLANG_SESSION_FILE = path.join(STATE_DIR, 'slang-session.json');
const SOCIAL_V2_FILE = path.join(STATE_DIR, 'social-v2.json');
// 操作者为每个会话预写的「初始提示词」，由独立存储组件管理。
// 单独一个文件：它属于操作者配置，不能随 social-v2.json 的会话状态一起被重置清掉。
const INITIAL_PROMPTS_FILE = path.join(STATE_DIR, 'initial-prompts.json');
const STICKER_FILE = path.join(STATE_DIR, 'stickers.json');
const FEEDBACK_FILE = path.join(STATE_DIR, 'feedback.json');
const TOOL_LOG_FILE = path.join(STATE_DIR, 'tool-calls.jsonl');
const TOKEN_USAGE_FILE = path.join(STATE_DIR, 'token-usage.jsonl');
const ACTIVITY_LOG = path.join(STATE_DIR, 'qq-activity.log');
const BRIDGE_LOG = path.join(STATE_DIR, 'bridge.log');
const jsonFiles = createJsonFiles({
    get fs() { return fs; },
    get path() { return path; },
    get process() { return process; },
    get crypto() { return crypto; },
    get Atomics() { return Atomics; },
    get Int32Array() { return Int32Array; },
    get SharedArrayBuffer() { return SharedArrayBuffer; }
});
const sessionMappingStore = createSessionMappingStore({
    get fs() { return fs; },
    get STATE_FILE() { return STATE_FILE; },
    get log() { return log; },
    get atomicWriteJson() { return atomicWriteJson; }
});
const instanceLock = createInstanceLock({
    get fs() { return fs; },
    get path() { return path; },
    get ROOT() { return ROOT; },
    get STATE_DIR() { return STATE_DIR; },
    get process() { return process; },
    get console() { return console; },
    get execFileSync() { return execFileSync; },
    get readJsonSafe() { return readJsonSafe; }
});
const bridgeLogger = createBridgeLogger({
    get fs() { return fs; },
    get STATE_DIR() { return STATE_DIR; },
    get BRIDGE_LOG() { return BRIDGE_LOG; },
    get ACTIVITY_LOG() { return ACTIVITY_LOG; },
    get Date() { return Date; },
    get redactSensitiveText() { return redactSensitiveText; },
    get console() { return console; }
});
/**
 * 模式拼写的**唯一**归一入口（输入边界）。
 *
 * `simulation` 是规范名（QSH_PLAN.md §2.1：对用户只暴露 `closed-agent` / `simulation`），
 * `chat` / `reserved` / `reserved2` 是历史拼写 —— 必须继续被**接受**（线上桥接持久化的全局值
 * 就是 `reserved2`），但进程内部一律用历史拼写存储与比较：`currentMode === 'reserved2'` 这类
 * 判断遍布发送闸门、定时器与 preset 解析，把规范名直接塞进 `currentMode` 会让它们全部变成假。
 *
 * 旧写法是 `VALID_MODES = ['chat','closed-agent','reserved','reserved2']`，控制台那处还抄了
 * 一份同样的字面量数组。后果是：在 DSH 设置或 `state/mode.json` 里写 `simulation` 会被**静默
 * 忽略**，`currentMode` 保持上一次的值（进程刚起来时是 `chat`，即一代仿真 —— preset 与工具面
 * 都和二代不同，`v2ToolEnabled` 之类的闸门也不生效）。用户以为切到了仿真，实际跑的是另一套，
 * 而且没有任何日志。规范名与历史名必须在这里收敛成同一个内部值。
 */
/** 内部合法模式集合（由别名表派生，避免"两份名单各自漂移"）。 */
function readJsonSafe(...args) { return (0, jsonFiles.readJsonSafe)(...args); }
function readConfigObject(...args) { return (0, jsonFiles.readConfigObject)(...args); }
function renameWithRetry(...args) { return (0, jsonFiles.renameWithRetry)(...args); }
function atomicWriteJson(...args) { return (0, jsonFiles.atomicWriteJson)(...args); }
function atomicWriteText(...args) { return (0, jsonFiles.atomicWriteText)(...args); }
// 控制台鉴权 token：未配置时自动生成并持久化到 state/console-token，避免默认无鉴权。
function loadOrCreateConsoleToken() {
    const tokenFile = path.join(STATE_DIR, 'console-token');
    try {
        const existing = fs.readFileSync(tokenFile, 'utf8').trim();
        if (existing)
            return existing;
    }
    catch { }
    const token = crypto.randomBytes(24).toString('hex');
    atomicWriteText(tokenFile, token);
    return token;
}
/**
 * 收紧 state/ 的访问权限。
 *
 * **Windows 上 `mode: 0o600` 是空操作**（实测：chmod 之后 ACL 不变），文件继承父目录 ACL ——
 * 本机 state/console-token 实测为 `NT AUTHORITY\Authenticated Users:(M)`，也就是任何能登录
 * 这台机器的用户都能读走控制台令牌、Snowluma accessToken、各会话 agentToken 和全部 QQ 聊天记录。
 * 这里用 icacls 切断 state/ 的继承链，只保留「当前用户 + SYSTEM + Administrators」。
 *
 * ⚠️ 具体实现已抽到 `src/state-acl.mjs`（与 scripts/harden-state-acl.mjs 共用同一份）。
 * 这里原本自带一份**会破坏数据**的实现：
 *   · `icacls DIR /inheritance:r /grant:r "u:(OI)(CI)F" /T` —— (OI)(CI) 是目录专用标志，
 *     套到 /T 展开的文件上会失败，而 /inheritance:r 已摘掉文件的继承 ACE，净结果是
 *     **子文件 DACL 被清空、连属主都读不了**（实测 state/ 下 50 个文件变空，桥接读不到
 *     自己的控制台令牌）；启动日志只报「未能收紧」，看不出已经造成破坏。
 *   · 回读自检用 `/\(I\)/` 扫全文，而 DSH 沙箱的 Low 完整性标签行永远带 (I) ——
 *     于是「已收紧」被误判成「未收紧」，**每次启动都重跑一遍那个破坏性命令**。
 * 两处逻辑各写一份正是漂移的根源，故合并。失败时不能只说"可能可读"就完事，
 * 要给出一条**安全**的可复制命令，并把结果回报到控制台（/api/security 的 stateDirHardened）。
 * 宁可明确报"没做成"，也不要假装已经安全。
 */
function hardenStateDirAcl() {
    const result = hardenDir(STATE_DIR);
    if (result.ok) {
        stateDirHardened = true;
        return;
    }
    stateDirHardened = false;
    if (process.platform !== 'win32') {
        log(`⚠️ 收紧 state/ 权限失败（chmod 700）：${result.detail}`);
        return;
    }
    log('⚠️ 未能收紧 state/ 目录权限：本机任何已登录用户都可能读到控制台令牌与 QQ 聊天记录。');
    log(`   原因：${String(result.detail).slice(0, 300)}`);
    log('   改 ACL 需要管理员权限。请用**管理员身份**打开终端后执行下面这几条命令（或在控制台「访问与安全」页点按钮）：');
    log(`   ${manualDirCommand(STATE_DIR)}`);
}
function readActivityTail(...args) { return (0, bridgeLogger.readActivityTail)(...args); }
const ROLES_DIR = path.join(ROOT, 'roles');
const roleStore = createRoleStore({ directory: ROLES_DIR, stateFile: ROLE_STATE_FILE, readJsonSafe, atomicWriteJson, atomicWriteText });
const { listRoles, readRoleState, writeRoleState } = roleStore;
const roleTrash = createRoleTrash({ directory: ROLES_DIR, validateName: validateRoleName, readState: readRoleState, writeState: writeRoleState });
// ── 二代仿真预设提示词（「仿真」层）────────────────────────────────────────
// 与「人格」层的边界：
//   仿真提示词 = 预设内置，规定 AI 怎么调工具、怎么参与群聊（行为与协议）
//   人格提示词 = roles/<名称>.md，规定 AI 是谁、什么性格（人设与语气）
// 仿真层改完需要重启 DSH 才生效（preset 由 DSH 在会话创建时装配）；
// 人格层由桥接每条消息注入，保存即生效。
// 两代仿真各自有独立的预设提示词：一代 qq-chat（空格分条 / [SILENT]），
// 二代 qq-chat-v2（一切皆工具）。控制台可分别查看与修改。
const presetStore = createPresetStore({ root: ROOT, stateDirectory: STATE_DIR,
    getDshHome: () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh') });
// 回复审计：agent 回复若命中以下特征（本机路径/凭据），硬性拦截不发送。
// 宁可误拦，不可泄露。
// 社交模式“静默标记”：模型输出该标记时，桥接不把内容发到 QQ。
// 用于让 AI 在“不想接话/潜水”时有合法沉默出口，而不是写“（内心戏）”被当成消息发出去。
const SILENT_MARKER = '[SILENT]';
function isSilentMarker(text) {
    return /^\s*\[SILENT\]\s*$/i.test(String(text ?? '').trim());
}
// DSH MCP 发送类工具：一旦 AI 在回合里调用过这些工具，说明消息已经由工具发出，
// 桥接应跳过该回合的自动转发，避免“工具发一条 + 自动转发一条”的重复。
const SEND_TOOL_RE = /^mcp__qq_native__qq_(send_group_message|send_private_message|reply|send_burst|send_message|send_native_message)$/;
function isSendToolName(name) {
    return SEND_TOOL_RE.test(String(name ?? ''));
}
// 分句规则提示：真人聊天不会主动用空格，因此空格被桥接当作“分条信号”。
// 中英文/数字之间的空格同样会分条，所以不想分条就不要加空格。
const SPACE_SPLIT_HINT = '想分多条消息时用空格分隔；不想分条就不要加空格，用标点连接。注意：中英文/数字之间的空格也会被当作分条信号。';
// 群聊指向性提示：引用/回复段表示“这句话是在对被引用的人说”，避免 AI 把群友之间的对话误当成指向自己。
const DIRECTION_HINT = '注意：消息里的 [引用 某人：...] 表示这句话是在回应被引用的人；引用的是你的消息才是在找你，引用别人时别默认是在找你。';
// 已知的二代 agent token 集合：日志/活动/出站文本统一脱敏，防止令牌被模型泄露到 QQ。
const tokenRegistry = createTokenRegistry({
    get SENSITIVE_RE() { return SENSITIVE_RE; }
});
const KNOWN_AGENT_TOKENS = tokenRegistry.knownTokens;
// 会话 → 该会话「当前代 + 上一代」agentToken 的索引（见 rememberAgentToken）。
//
// 为什么必须有这份索引：retireSession() 每次轮换 token 都会把**新** token 塞进
// KNOWN_AGENT_TOKENS，而 reconcileSessionPolicies() 在**任何**策略变化（切模式、改白名单、
// preset 清单变动）时都会退役全部会话 —— 于是每切一次模式，每个会话就在集合里永久多留一个
// token，且只有 /reset、/api/session/reset、/api/socialV2/reset 会删。集合只增不减，而
// redactSensitiveText()（每写一行日志）和 redactKnownTokensOnly()/onebotSend()（每条出站消息）
// 都要先复制整个集合再线性扫，长期运行后这两条热路径会被拖垮。
//
// 选择「按会话替换」而不是硬性 LRU 上限：硬上限在会话多的时候会淘汰掉**仍然有效**的 token，
// 那等于把活令牌漏到 QQ，属于削弱安全边界。按会话记账时集合大小 ≈ 会话数 × 2，且每个会话
// 一定保留当前代（活令牌必然可脱敏）与上一代（模型上下文里最可能残留的那一个）；会话被删除
// 时用 forgetAgentToken() 整体摘除。第三代已经在两次轮换之前，不可能还在上下文里，直接丢弃。
const CONVERSATION_TOKENS = tokenRegistry.conversationTokens;
function rememberAgentToken(...args) { return (0, tokenRegistry.rememberAgentToken)(...args); }
function forgetAgentToken(...args) { return (0, tokenRegistry.forgetAgentToken)(...args); }
function redactSensitiveText(...args) { return (0, tokenRegistry.redactSensitiveText)(...args); }
// 防止底层网关把文本中的 [CQ: 当作 CQ 码解析：替换为全角冒号。
function escapeCqText(text) {
    return String(text ?? '').replace(/\[CQ:/gi, '[CQ：');
}
function unquoteJsonString(value) {
    if (typeof value !== 'string')
        return value;
    const t = value.trim();
    if (t.startsWith('"')) {
        try {
            const parsed = JSON.parse(t);
            if (typeof parsed === 'string')
                return parsed;
        }
        catch { }
    }
    return value;
}
// QQ 活动日志：每次收发都追加一行，供 WebUI 侧 agent 汇报 QQ 动态。
function appendActivity(...args) { return (0, bridgeLogger.appendActivity)(...args); }
// ── 配置 ────────────────────────────────────────────────────────────────────
const loadConfig = createConfigLoader({ root: ROOT, readJsonSafe, discoverLaunchToken: discoverDshLaunchToken,
    log, setRoleInjectLimit: roleStore.setInjectLimit });
// ── 状态持久化（QQ 会话 ↔ DSH 会话映射） ─────────────────────────────────────
let state = sessionMappingStore.state;
// sessions.json 读不动/读坏时必须**大声失败**，不能静默回落成空映射：
// 那会让每个 QQ 会话都拿到一个全新的 DSH 会话（上下文全丢），而紧接着的
// saveState() 会把这份空映射原子写回磁盘 —— 一次截断/占用/写满就变成永久丢失。
// 与表情库、黑话库一样走「只读不写」降级：保留原文件，等人来处理。
function loadState() { sessionMappingStore.loadState(); state = sessionMappingStore.state; }
function saveState(...args) { return (0, sessionMappingStore.saveState)(...args); }
// ── 单实例锁 ─────────────────────────────────────────────────────────────────
// 防止多个桥接进程同时运行（双实例会抢消息、互相覆盖映射）。
// 锁文件存 PID；启动时若该 PID 仍存活则退出（exit 2 = 已有实例），
// 否则接管。进程退出/崩溃后锁自动失效（PID 校验）。
function consolePortInUse(...args) { return (0, instanceLock.consolePortInUse)(...args); }
function acquireLock(...args) { return (0, instanceLock.acquireLock)(...args); }
function releaseLock(...args) { return (0, instanceLock.releaseLock)(...args); }
// ── 工具 ────────────────────────────────────────────────────────────────────
// 日志同时输出到 stdout 与 state/bridge.log（守护窗口不可见时也能排查）
/** 单条日志的最大长度：一条异常巨大的错误对象不能把整个日志文件变成 5MB。 */
function createCappedLogger(...args) { return (0, bridgeLogger.createCappedLogger)(...args); }
function localClock(...args) { return (0, bridgeLogger.localClock)(...args); }
function log(...args) { return (0, bridgeLogger.log)(...args); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const convKey = (kind, id) => `${kind}:${id}`;
const SEND_TIMEOUT_MS = 15000;
// DSH 控制类调用（停任务/归档会话）的超时。这些 await 以前是裸的：DSH 接受了连接但
// 不返回响应时，HTTP handler 永不返回，控制台与群消息一起失去响应（issue #32）。
// 超时后走各自的 catch 记日志，最坏情况只是「这一次重置没做成」，而不是整体挂死。
const DSH_CONTROL_TIMEOUT_MS = 15000;
function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`操作超时(${ms}ms)：${label}`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const messageSegments = createMessageSegments({
    get forwardIdFromData() { return forwardIdFromData; },
    get truncateText() { return truncateText; }
});
function segmentsToText(...args) { return (0, messageSegments.segmentsToText)(...args); }
function sanitizeMediaSummary(...args) { return (0, messageSegments.sanitizeMediaSummary)(...args); }
function extractMediaFromSegments(...args) { return (0, messageSegments.extractMediaFromSegments)(...args); }
function allowed(kind, id, cfg) {
    // OneBot 事件里的 id 可能是数字也可能是字符串（int64 序列化差异），统一转字符串比较。
    // 配置字段兼容单数（group/private）与复数（groups/privates）两种写法。
    const s = String(id);
    const denyList = cfg.deny[kind] ?? cfg.deny[kind + 's'] ?? [];
    if (denyList.map(String).includes(s))
        return false;
    if (cfg.nativeScope)
        return nativeScopeAllows(cfg.nativeScope, kind, id);
    const allowList = cfg.allow[kind] ?? cfg.allow[kind + 's'] ?? [];
    if (allowList.length > 0)
        return allowList.map(String).includes(s);
    return cfg.allowAllWhenEmpty;
}
// 二代会话 key 规范化：只接受 group:正整数 / private:正整数，并去掉前导零，避免同一会话出现多个别名。
function canonicalV2Key(key) {
    const m = /^(group|private):(\d+)$/.exec(String(key ?? '').trim());
    if (!m)
        return null;
    const id = Number(m[2]);
    if (!Number.isSafeInteger(id) || id <= 0)
        return null;
    return `${m[1]}:${id}`;
}
const APPROVE_WORDS = new Set(['通过', '同意', '允许', '批准', 'yes', 'y', 'approve', 'ok']);
const REJECT_WORDS = new Set(['拒绝', '不同意', '不允许', '驳回', 'no', 'n', 'reject', 'deny']);
// state/ 的 ACL 是否已收紧（hardenStateDirAcl 的结果；控制台「访问与安全」页会显示，
// 未收紧时给出可复制的提权命令）。null = 还没跑/平台不适用。
let stateDirHardened = null;
// ── 主流程 ──────────────────────────────────────────────────────────────────
let startupPhase = 'config';
const receiveDiagnosticStages = new Set(['native_connect_begin', 'native_connect_end', 'native_refresh_begin', 'native_refresh_end',
    'session_begin', 'session_end', 'media_get_begin', 'media_get_end', 'media_decode_begin', 'media_decode_end',
    'normalize_begin', 'normalize_end', 'prompt_begin', 'prompt_end']);
const receiveDiagnosticEvents = [];
let receiveDiagnosticSeq = 0;
/** 原生故障定位只保留24个固定阶段和有界字节数，不记录消息、会话标识、文件或凭据；写失败不影响业务。 */
function traceNativeReceive(stage, bytes) {
    if (!process.env.QQ_NATIVE_GATEWAY_STATUS || !receiveDiagnosticStages.has(stage))
        return;
    const row = { seq: ++receiveDiagnosticSeq, at: new Date().toISOString(), stage };
    if (Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 8 * 1024 * 1024)
        row.bytes = bytes;
    receiveDiagnosticEvents.push(row);
    if (receiveDiagnosticEvents.length > 24)
        receiveDiagnosticEvents.shift();
    const target = path.join(STATE_DIR, 'native-receive-diagnostic.json'), temporary = target + '.' + process.pid + '.next';
    try {
        if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
            return;
        fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, pid: process.pid, events: receiveDiagnosticEvents }), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, target);
    }
    catch { }
}
function reportOwnedFailure(error) {
    if (!process.connected || !process.env.QQ_NATIVE_GATEWAY_STATUS)
        return false;
    const code = /^NATIVE_GATEWAY_(PATH|STATUS|HEALTH|BROKER|SEND_PERMISSION)_FAILED$/.test(error?.code ?? '')
        ? error.code : 'BRIDGE_FATAL';
    // 只交接固定枚举；不把异常正文、配置或聊天带进组合状态。
    process.send({ kind: 'qq-bridge-failure', phase: startupPhase, code }, () => process.exit(1));
    setTimeout(() => process.exit(1), 500).unref();
    return true;
}
let closeNativeIdleTasks = async () => { };
let closeNativePhoneTasks = async () => { };
async function main() {
    const cfg = loadConfig();
    const conversationMemory = createConversationMemory({ redactKnownTokensOnly, truncateText, save: saveSocialV2State });
    const { formatMemoryV2 } = conversationMemory;
    // 仅供旧协议辅助模块读取的内存别名；原生运行配置与新写入均使用onebot。
    cfg.snowluma = cfg.onebot;
    startupPhase = 'gateway';
    traceNativeReceive('native_connect_begin');
    const nativeBinding = await connectNativeGateway(process.env.QQ_NATIVE_GATEWAY_STATUS, {
        allowedRoot: path.join(SOURCE_ROOT, '..', 'native-research', 'native-adapter', 'service-data'),
        allowFixture: process.env.QQ_NATIVE_GATEWAY_ALLOW_FIXTURE === '1' && ROOT.toLowerCase().startsWith((path.join(SOURCE_ROOT, '..', 'integration-tests') + path.sep).toLowerCase()),
        requireSend: false,
    });
    traceNativeReceive('native_connect_end');
    if (nativeBinding) {
        applyNativeGatewayConfig(cfg, nativeBinding);
        if (!process.env.DSH_BRIDGE_LAUNCH_TOKEN)
            throw new Error('NATIVE_DSH_LAUNCH_CREDENTIAL_REQUIRED');
    }
    const nativeCapabilities = nativeBinding ? nativeCapabilitiesFor(nativeBinding) : null;
    let nativePolicyCurrent = true, nativePolicyGeneration = 0;
    let nativePolicyStopFailed = false;
    const nativeInboundPolicy = new AsyncLocalStorage();
    const nativeTurnFence = nativeBinding ? createNativeTurnFence() : null;
    const nativeObservationCoordinator = createNativeObservationCoordinator({
        get nativePolicyGeneration() { return nativePolicyGeneration; },
        get nativePolicyCurrent() { return nativePolicyCurrent; },
        get modeCoordinator() { return modeCoordinator; },
        get socialV2() { return socialV2; },
        get cfg() { return cfg; },
        get state() { return state; },
        get isCurrentSession() { return isCurrentSession; },
        get isSessionAllowedInCurrentMode() { return isSessionAllowedInCurrentMode; },
        get nativeBinding() { return nativeBinding; },
        get createNativeBackgroundObservation() { return createNativeBackgroundObservation; },
        get observationThroughSeqV2() { return observationThroughSeqV2; },
        get Date() { return Date; },
        get isConversationBusyV2() { return isConversationBusyV2; },
        get sendWakePromptV2() { return sendWakePromptV2; },
        get pendingWakeKeys() { return pendingWakeKeys; },
        get nativeTurnFence() { return nativeTurnFence; },
        get collectors() { return collectors; },
        get v2TurnStartAt() { return v2TurnStartAt; },
        get turnLeaseNoted() { return turnLeaseNoted; },
        get pendingSendToolCalls() { return pendingSendToolCalls; },
        get sendToolSucceededSessions() { return sendToolSucceededSessions; },
        get toolCallNames() { return toolCallNames; },
        get disarmPendingWakeLease() { return disarmPendingWakeLease; },
        get activeWaits() { return activeWaits; },
        get canonicalV2Key() { return canonicalV2Key; },
        get crypto() { return crypto; },
        get rememberAgentToken() { return rememberAgentToken; },
        get log() { return log; },
        get readNativeTerminalTurn() { return readNativeTerminalTurn; },
        get api() { return api; }
    });
    const nativeTrackedTurns = nativeObservationCoordinator.nativeTrackedTurns;
    function nativeObservationCurrent(...args) { return (0, nativeObservationCoordinator.nativeObservationCurrent)(...args); }
    const nativeObservation = nativeObservationCoordinator.nativeObservation;
    function settleNativeTerminal(...args) { return (0, nativeObservationCoordinator.settleNativeTerminal)(...args); }
    function reconcileNativeTerminal(...args) { return (0, nativeObservationCoordinator.reconcileNativeTerminal)(...args); }
    let avatarReader = null;
    let nativeImageApi = null, nativeSinging = null;
    let nativePhone = null, nativePhoneModel = null;
    let phoneRecoveryTask = null, phoneRecoveryPhase = 'idle', phoneRecoveryId = null;
    const phonePageState = () => ({ settings: { enabled: cfg.phone?.enabled === true, autoAnswer: cfg.phone?.autoAnswer !== false },
        ...nativePhone?.snapshot(), model: nativePhoneModel?.snapshot() ?? null, recovery: { busy: !!phoneRecoveryTask, phase: phoneRecoveryPhase, id: phoneRecoveryId },
        resources: { qq: bot.isConnected && nativePolicyCurrent, receiveVoice: nativeCapabilities?.receiveVoice === true, sendVoice: nativeCapabilities?.sendVoice === true,
            asr: nativeVoice?.snapshot().asrReady === true, tts: nativeVoice?.snapshot().ttsReady === true,
            model: modeCoordinator.state.dshReady && modeCoordinator.state.dshPresetIds.includes('qq-phone'), speaking: readRoleState().mode !== 'silent' } });
    const imagePreferences = createImagePreferences(path.join(STATE_DIR, 'image-preferences.json'));
    let nativeStickerApi = null;
    let nativeGroupApi = null;
    let nativeQzoneApi = null;
    let nativeSelfProfileApi = null;
    let idleDraftRunner = null, nativeIdleLoop = null, idleAvailable = () => false;
    let nativeFeatureRoutes = null;
    const mediaContext = createMediaContext({
        get nativeBinding() { return nativeBinding; },
        get currentMode() { return modeCoordinator.state.currentMode; },
        get nativePolicyCurrent() { return nativePolicyCurrent; },
        get nativeScopeAllows() { return nativeScopeAllows; },
        get cfg() { return cfg; },
        get nativeCapabilities() { return nativeCapabilities; },
        get extractMediaFromSegments() { return extractMediaFromSegments; },
        get MAX_MEDIA_STORE_PER_KEY() { return MAX_MEDIA_STORE_PER_KEY; },
        get extractForwardIds() { return extractForwardIds; },
        get socialV2() { return socialV2; },
        get getSocialV2State() { return getSocialV2State; }
    });
    const nativeFeatures = createNativeFeatureContext({
        get AsyncLocalStorage() { return AsyncLocalStorage; },
        get createNativeFeatureAccess() { return createNativeFeatureAccess; },
        get modeCoordinator() { return modeCoordinator; },
        get cfg() { return cfg; },
        get state() { return state; },
        get isSessionAllowedInCurrentMode() { return isSessionAllowedInCurrentMode; },
        get nativeScopeAllows() { return nativeScopeAllows; },
        get nativePolicyGeneration() { return nativePolicyGeneration; },
        get nativeBinding() { return nativeBinding; },
        get nativePolicyCurrent() { return nativePolicyCurrent; },
        get bot() { return bot; },
        get isCurrentSession() { return isCurrentSession; },
        get socialV2() { return socialV2; },
        get shouldBlockSilentReply() { return shouldBlockSilentReply; },
        get nativeTurnFence() { return nativeTurnFence; },
        get nativeTrackedTurns() { return nativeTrackedTurns; },
        get sessionPolicy() { return sessionPolicy; },
        get currentRoleHint() { return currentRoleHint; },
        get readRoleState() { return readRoleState; },
        get crypto() { return crypto; },
        get rememberAgentToken() { return rememberAgentToken; },
        get nativeImageApi() { return nativeImageApi; },
        get nativeStickerApi() { return nativeStickerApi; },
        get nativeGroupApi() { return nativeGroupApi; },
        get nativeQzoneApi() { return nativeQzoneApi; },
        get nativeSelfProfileApi() { return nativeSelfProfileApi; },
        get nativeSinging() { return nativeSinging; },
        get nativeCapabilities() { return nativeCapabilities; }
    });
    const nativeFeatureRequests = nativeFeatures.nativeFeatureRequests, nativeForwardMedia = mediaContext.nativeForwardMedia, nativeFeatureGrants = nativeFeatures.nativeFeatureGrants;
    const nativeFeatureAccess = nativeFeatures.nativeFeatureAccess;
    function nativeFeatureContext(...args) { return (0, nativeFeatures.nativeFeatureContext)(...args); }
    function buildNativeFeatureHints(...args) { return (0, nativeFeatures.buildNativeFeatureHints)(...args); }
    startupPhase = 'state';
    fs.mkdirSync(STATE_DIR, { recursive: true });
    hardenStateDirAcl();
    acquireLock();
    loadState();
    startupPhase = 'services';
    // ── 群聊黑话/网络用语学习（slang） ──────────────────────────────────────
    let slangEntries = [];
    // 读失败时（被占用 / 权限 / JSON 损坏）必须**暂停写入**：否则内存里的空数组
    // 会在下一次 saveSlangStore() 时覆盖掉磁盘上那份数据，学到的词条全丢。
    let slangStoreWritable = true;
    try {
        slangEntries = loadSlang(SLANG_FILE, { onCorrupt: (message) => log(`⚠️ ${message}`) });
    }
    catch (error) {
        slangStoreWritable = false;
        log(`⚠️ 黑话库加载失败，已暂停写入以免覆盖磁盘数据（修好后重启即可恢复）：${error?.message ?? error}`);
    }
    const slangWindows = new Map(); // key -> [{sender,text,time}]：待学习消息窗口
    const slangExtractionCooldowns = new Map(); // key -> timestamp
    const slangSubmitTimes = new Map(); // key -> [timestamp]：AI 提交黑话候选限频（内存态）
    const feedbackTimes = new Map(); // key -> [timestamp]：AI 反馈限频（内存态）
    const slangResearchingIds = new Set(); // 正在研究中的候选 id，防止重复排队
    const learnerSessions = new Set(); // sessionId -> 学习会话（不映射 QQ，不发送）
    const learnerCollectors = new Map(); // sessionId -> turn collector
    const learnerWaiters = new Map(); // sessionId -> [{resolve,reject,timer}]
    const slangLearning = createSlangLearning({
        get slangStoreWritable() { return slangStoreWritable; },
        get log() { return log; },
        get saveSlang() { return saveSlang; },
        get SLANG_FILE() { return SLANG_FILE; },
        get slangEntries() { return slangEntries; }, set slangEntries(value) { slangEntries = value; },
        get SLANG_MAX_ENTRIES() { return SLANG_MAX_ENTRIES; },
        get cfg() { return cfg; },
        get resolvePresetName() { return resolvePresetName; },
        get readJsonSafe() { return readJsonSafe; },
        get SLANG_SESSION_FILE() { return SLANG_SESSION_FILE; },
        get learnerSessions() { return learnerSessions; },
        get api() { return api; },
        get ensureChatModel() { return ensureChatModel; },
        get STATE_DIR() { return STATE_DIR; },
        get path() { return path; },
        get fs() { return fs; },
        get unwrap() { return unwrap; },
        get atomicWriteJson() { return atomicWriteJson; },
        get learnerWaiters() { return learnerWaiters; },
        get learnerCollectors() { return learnerCollectors; },
        get dshReady() { return modeCoordinator.state.dshReady; },
        get slangWindows() { return slangWindows; },
        get buildExtractionPrompt() { return buildExtractionPrompt; },
        get parseExtractionJson() { return parseExtractionJson; },
        get upsertSlangEntry() { return upsertSlangEntry; },
        get SLANG_STATUS() { return SLANG_STATUS; },
        get slangResearchingIds() { return slangResearchingIds; },
        get buildResearchPrompt() { return buildResearchPrompt; },
        get parseResearchJson() { return parseResearchJson; },
        get slangExtractionCooldowns() { return slangExtractionCooldowns; },
        get truncateText() { return truncateText; },
        get confirmedSlangEntries() { return confirmedSlangEntries; },
        get buildSlangContext() { return buildSlangContext; },
        get setTimeout() { return setTimeout; },
        get Date() { return Date; }
    });
    // ── 表情包体系（二代仿真）本地知识库 ────────────────────────────────────
    // 库文件损坏/读不动时**不能当成空库继续**：下面任何一次 saveStickerStoreSafe 都会把
    // 「空库」写回去，把 AI 学到的 localNote/tags/usage 永久清零。读失败就显式降级为
    // 「只读不写」，并留下醒目日志（与 loadSlang 的 slangStoreWritable 同一套路）。
    const onebotHttp = createOnebotHttp({
        get cfg() { return cfg; },
        get fetch() { return fetch; },
        get AbortSignal() { return AbortSignal; }
    });
    const stickerLibraryService = createStickerLibrary({
        get nativeBinding() { return nativeBinding; },
        get cfg() { return cfg; },
        get saveStickerStore() { return saveStickerStore; },
        get STICKER_FILE() { return STICKER_FILE; },
        get log() { return log; },
        get Date() { return Date; },
        get bot() { return bot; },
        get onebotHttpAction() { return onebotHttpAction; },
        get mergeStickerLibrary() { return mergeStickerLibrary; },
        get formatStickerList() { return formatStickerList; },
        get findSticker() { return findSticker; },
        get loadStickerStore() { return loadStickerStore; }
    });
    const stickerState = stickerLibraryService.state;
    stickerLibraryService.load();
    const stickerActions = createStickerActions({
        get captureSendGuard() { return captureSendGuard; },
        get syncStickerLibrary() { return syncStickerLibrary; },
        get findSticker() { return findSticker; },
        get safeFetchBuffer() { return safeFetchBuffer; },
        get MAX_MEDIA_BYTES() { return MAX_MEDIA_BYTES; },
        get cfg() { return cfg; },
        get sendQueue() { return sendQueue; },
        get sleep() { return sleep; },
        get randInt() { return randInt; },
        get fetch() { return fetch; },
        get AbortSignal() { return AbortSignal; },
        get markStickerUsed() { return markStickerUsed; },
        get saveStickerStoreSafe() { return saveStickerStoreSafe; },
        get applyStickerNote() { return applyStickerNote; },
        get bot() { return bot; },
        get Date() { return Date; },
        get getSocialV2State() { return getSocialV2State; },
        get fetchOneBotImage() { return fetchOneBotImage; },
        get fetchFaceMedia() { return fetchFaceMedia; },
        get log() { return log; },
        get state() { return stickerState; }
    }); // AI 强制刷新表情库的最小间隔保护
    function stickerEnabled(...args) { return (0, stickerLibraryService.stickerEnabled)(...args); }
    function saveStickerStoreSafe(...args) { return (0, stickerLibraryService.saveStickerStoreSafe)(...args); }
    // 旧外部通道兼容约定见 docs/legacy/GATEWAY_COMPATIBILITY_NOTES.md；原生通道使用所属网关状态。
    function onebotHttpAction(...args) { return (0, onebotHttp.onebotHttpAction)(...args); }
    // force=true 时忽略 TTL 强制刷新；失败时返回 null（调用方决定是否使用缓存）。
    function syncStickerLibrary(...args) { return (0, stickerLibraryService.syncStickerLibrary)(...args); }
    // 返回给 AI 的表情列表（带本地认知）。
    function listStickersForV2(...args) { return (0, stickerLibraryService.listStickersForV2)(...args); }
    // 取单个表情的图片字节（多模态用）。
    function getStickerImageData(...args) { return (0, stickerLibraryService.getStickerImageData)(...args); }
    // 旧外部通道兼容约定见 docs/legacy/GATEWAY_COMPATIBILITY_NOTES.md；原生通道使用所属网关状态。
    const voiceLibraryService = createVoiceLibrary({
        get cfg() { return cfg; },
        get path() { return path; },
        get ROOT() { return ROOT; },
        get process() { return process; },
        get listAudioFiles() { return listAudioFiles; },
        get fs() { return fs; },
        get safeJoinLibrary() { return safeJoinLibrary; },
        get resolveAudioSource() { return resolveAudioSource; },
        get AUDIO_EXTS() { return AUDIO_EXTS; }
    });
    const voiceBudget = createVoiceBudget({
        get Date() { return Date; }
    });
    const voiceDelivery = createVoiceDelivery({
        get voiceCfg() { return voiceCfg; },
        get assertOutboundAuditOk() { return assertOutboundAuditOk; },
        get path() { return path; },
        get inspectAudio() { return inspectAudio; },
        get processAudioVolume() { return processAudioVolume; },
        get captureSendGuard() { return captureSendGuard; },
        get sendQueue() { return sendQueue; },
        get cfg() { return cfg; },
        get fetch() { return fetch; },
        get AbortSignal() { return AbortSignal; },
        get describeAudio() { return describeAudio; },
        get cleanupTemp() { return cleanupTemp; },
        get getSocialV2State() { return getSocialV2State; },
        get truncateText() { return truncateText; },
        get Date() { return Date; },
        get saveSocialV2State() { return saveSocialV2State; },
        get log() { return log; },
        get resolveVoicePathForV2() { return resolveVoicePathForV2; },
        get resolveAudioProcessing() { return resolveAudioProcessing; },
        get voiceBudgetCheck() { return voiceBudgetCheck; },
        get voiceBudgetCommit() { return voiceBudgetCommit; },
        get appendActivity() { return appendActivity; }
    });
    /**
     * 出站语音的内容审计：与文本一致，凡是「疑似敏感信息 / 含会话令牌」的**文件名**
     * 都不允许外发（语音的音频内容本身无法审计，但文件名同样会泄露路径与项目信息）。
     */
    const { shouldAuditKey, captureSendGuard, shouldBlockSilentReply } = createOutboundPolicy({
        getMode: () => modeCoordinator.state.currentMode, getOwner: () => cfg.ownerQQ, getSessionId: key => state.sessions[key], sessionPolicy,
        isAllowed: isSessionAllowedInCurrentMode, readRoleState,
        getNativeState: () => ({ bound: Boolean(nativeBinding), current: nativePolicyCurrent, allowSend: nativeBinding?.allowSend,
            generation: nativePolicyGeneration, inboundGeneration: nativeInboundPolicy.getStore() })
    });
    const { assertOutboundAuditOk, auditAndSend } = createOutboundAudit({ shouldAuditKey, knownTokens: () => KNOWN_AGENT_TOKENS,
        isSensitive: subject => SENSITIVE_RE.test(subject), shouldNotify: () => cfg.security?.interceptNotify !== false,
        send: (key, subject) => sendToQQ(key, subject), log, appendActivity });
    function voiceCfg(...args) { return (0, voiceLibraryService.voiceCfg)(...args); }
    function voiceLibrary(...args) { return (0, voiceLibraryService.voiceLibrary)(...args); }
    /**
     * 把「AI 给的语音引用」解析成可发送的本地绝对路径。
     *
     * 安全边界：**AI 只能从语音库目录里取文件**（防 prompt injection 拿任意本地文件当语音外发）。
     *
     * 历史坑（已修）：这里曾经在 `socialV2.voice.allowAbsolutePath: true` 时直接把 AI 给的
     * 绝对路径交给 resolveAudioSource 解析，于是「AI 传 C:\Users\x\Music\任意.mp3」
     * 就能把本机任意音频（< 20 MB）发到群里 —— 而 inspectAudio 对「没有音频流」或
     * ffprobe 不可用的情况是放行的，等于把开关变成了任意文件外发通道。
     * 现在即使开了这个开关，也要求绝对路径**必须落在语音库目录之内**；
     * 真要从库外发文件请走操作者通道（resolveVoicePathForOperator / CLI）。
     */
    function voicePathInsideLibrary(...args) { return (0, voiceLibraryService.voicePathInsideLibrary)(...args); }
    function resolveVoicePathForV2(...args) { return (0, voiceLibraryService.resolveVoicePathForV2)(...args); }
    /**
     * 操作者通道（CLI）的路径解析：允许绝对路径（操作者本来就能读本机文件），
     * 相对路径先按「语音库」解析，再按当前工作目录解析 —— 这样两种直觉写法都成立。
     * base64/http 来源仍然禁止：语音应来自本地文件，别让 CLI 变成任意 URL 的外发口子。
     */
    function resolveVoicePathForOperator(...args) { return (0, voiceLibraryService.resolveVoicePathForOperator)(...args); }
    /**
     * 语音发送限流：与文本发送分开计数，避免语音吃掉聊天额度（也避免聊天把语音额度耗光）。
     *
     * 只**检查**不占额度：额度在真正发出去之后才由 voiceBudgetCommit 记账 ——
     * 这样参数错、被审计拦截、网关失败都不会白白吃掉配额（否则连失败几次就被假 429 卡住）。
     */
    function voiceBudgetCheck(...args) { return (0, voiceBudget.voiceBudgetCheck)(...args); }
    /** 语音真正发出后记账（顺带裁掉超过 1 小时的旧时间戳，避免数组无界增长）。 */
    function voiceBudgetCommit(...args) { return (0, voiceBudget.voiceBudgetCommit)(...args); }
    /**
     * 底层发送：把音频作为 record 段交给 OneBot兼容通道。
     * guard=true（agent 通道）时，发送前必须通过 captureSendGuard —— 会话/模式/白名单任一变
     * 就放弃发送；guard=false（操作者通道）时不套会话闸门（操作者可能不在任何会话里）。
     *
     * audio 可传音量设置 { volume, normalize, loudness }：OneBot兼容通道 的 record 段没有增益字段，
     * 所以音量必须在本地用 ffmpeg 调好再发（临时文件发完即删）。
     */
    function sendVoiceV2(...args) { return (0, voiceDelivery.sendVoiceV2)(...args); }
    /** 把「我发了条语音」写进二代会话的 recentMessages，让 AI 自己知道刚发过什么。 */
    function recordVoiceSentV2(...args) { return (0, voiceDelivery.recordVoiceSentV2)(...args); }
    /**
     * 发完语音后的**落地验证**：把这条消息从网关读回来，确认它真的带着 record 段。
     *
     * 为什么不用 fetch_ptt_text 做这件事：那个动作依赖 QQ 侧的语音转写结果，
     * 而**自己发出去的**语音根本不会产生转写（实测 retcode=100「消息中不包含语音」）。
     * 想让 AI 确认「语音真的发出去了」，唯一可靠的证据是 get_msg 回读到的 record 段。
     * 返回 { confirmed, file, duration } 或 null（读不回来不影响"已发送"这个事实）。
     */
    function verifyVoiceMessageSent(...args) { return (0, voiceDelivery.verifyVoiceMessageSent)(...args); }
    /**
     * AI 通道入口：解析引用 → 限流 → 发送 → 记账 → 回读校验。
     * 返回 { messageId, detail, verified, readback }。
     */
    function sendVoiceForV2(...args) { return (0, voiceDelivery.sendVoiceForV2)(...args); }
    // 发送一个收藏表情（按 emoji_id/url/md5 解析，发图片段）。
    function sendStickerV2(...args) { return (0, stickerActions.sendStickerV2)(...args); }
    // 更新本地 AI 认知（含义/标签/用法）。
    function applyStickerNoteV2(...args) { return (0, stickerActions.applyStickerNoteV2)(...args); }
    // 修改 QQ 账号里的收藏表情备注（modify_custom_face），并同步本地 desc。
    function setStickerRemarkV2(...args) { return (0, stickerActions.setStickerRemarkV2)(...args); }
    // 收藏聊天里的一张表情（add_custom_face），并按 AI 看到的含义写简短备注（modify_custom_face）。
    function collectStickerV2(...args) { return (0, stickerActions.collectStickerV2)(...args); }
    function saveSlangStore(...args) { return (0, slangLearning.saveSlangStore)(...args); }
    function queueSlangTask(...args) { return (0, slangLearning.queueSlangTask)(...args); }
    function ensureSlangLearnerSession(...args) { return (0, slangLearning.ensureSlangLearnerSession)(...args); }
    function invalidateSlangLearnerSession(...args) { return (0, slangLearning.invalidateSlangLearnerSession)(...args); }
    function waitLearnerTurn(...args) { return (0, slangLearning.waitLearnerTurn)(...args); }
    function runSlangExtraction(...args) { return (0, slangLearning.runSlangExtraction)(...args); }
    function runSlangResearch(...args) { return (0, slangLearning.runSlangResearch)(...args); }
    function maybeQueueSlangExtraction(...args) { return (0, slangLearning.maybeQueueSlangExtraction)(...args); }
    function feedSlangWindow(...args) { return (0, slangLearning.feedSlangWindow)(...args); }
    function confirmedSlangListV2(...args) { return (0, slangLearning.confirmedSlangListV2)(...args); }
    function withSlangContext(...args) { return (0, slangLearning.withSlangContext)(...args); }
    if (!cfg.allow.private.length && !cfg.allow.groups.length && cfg.allowAllWhenEmpty) {
        log('⚠️  白名单为空且 allowAllWhenEmpty=true：将转发所有私聊/群聊消息给 agent');
    }
    else if (!cfg.allow.private.length && !cfg.allow.groups.length) {
        // 否则这是一个「静默无响应」陷阱：消息全被丢弃，用户只看到 QQ 上毫无反应。
        log(`⚠️  白名单为空且 allowAllWhenEmpty=false：不会响应任何 QQ 消息。请在 config.json 填 allow.private / allow.groups，或在控制台 http://127.0.0.1:${cfg.consolePort} 填写白名单`);
    }
    // 未配置管理员 QQ 时，一串功能会「静默失灵」：审批永远无法被回答（agent 一直等到超时）、
    // 管理命令全部被拒、封闭 agent 模式实际不可达。这里在启动日志里说清楚，避免排查时误判。
    if (!cfg.ownerQQ) {
        log('⚠️  未配置 ownerQQ：审批/管理命令/封闭 agent 模式将全部不可用。请在 config.json 或控制台「访问与安全」页填写管理员 QQ');
    }
    if (cfg.socialV2?.voice?.allowAbsolutePath === true) {
        // 该开关曾经允许 AI 发送语音库之外的任意本机音频文件（prompt injection 可用来外发文件）。
        // 现在无论开关如何，AI 通道都只接受语音库内的文件；这里提示它已经不再放宽边界。
        log('ℹ️  socialV2.voice.allowAbsolutePath=true 已不再放宽 AI 通道：AI 发的语音始终只允许来自语音库（库外文件请用语音工具/CLI 发送）');
    }
    // DSH 侧
    const api = new NodeApiClient(cfg.dsh.baseUrl, undefined, {
        token: nativeBinding ? process.env.DSH_BRIDGE_LAUNCH_TOKEN : cfg.dsh.authToken,
        launchTokenOnly: nativeBinding !== null,
        // true=用户在 config.json 里显式填的；false=从日志猜的。猜来的不优先于离线铸造。
        tokenExplicit: cfg.dsh.authTokenExplicit === true,
        header: cfg.dsh.authHeader,
        prefix: cfg.dsh.authPrefix,
        // 默认只允许把 launch token 交给回环地址；远程 DSH 需要显式 opt-in（见 dsh-client.ensureAuth）。
        allowRemote: cfg.dsh.allowRemote === true
    });
    // DSH 的模型目录 RPC：0.1.5 是 `session/modelCatalog`。**不能走基类门面**
    // `api.sessions.modelCatalog` —— 桥接钉住的 `@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2`
    // 的 sessions 门面里根本没有这个方法（只有 `models` → 已下线的 `session/models`），
    // 调用会抛 “api.sessions.modelCatalog is not a function”，让思考强度档位静默退回内置清单。
    // 这里直接用桥接自己覆写的 callUnary（它本来就是为「不依赖旧版客户端域方法」而存在的），
    // 并保留一次 `session/models` 回落以兼容更老的 DSH。
    // 只记固定取消来源，不记录会话、正文、账号或凭据；user枚举不等于人工点击证明。
    function stopBridgeSessionWork(sessionId, origin) {
        if (nativeBinding)
            log(`原生DSH取消请求：bridge/${origin}`);
        return api.stopSessionWork(sessionId);
    }
    const queryModelCatalog = createModelCatalogQuery({ getConfiguration: () => cfg,
        callUnary: (method, input) => api.callUnary(method, input), unwrap, withTimeout, log });
    const collectors = new Map(); // sessionId -> turn collector
    const sendToolSucceededSessions = new Set(); // sessionId：当前 turn 内 MCP 发送类工具至少成功一次
    const v2TurnStartAt = new Map(); // sessionId -> timestamp：reserved2 turn 开始时间，用于判断是否“无行动”
    const toolCallNames = new Map(); // sessionId -> Map<callId, toolName>：用于结果日志关联工具名
    const pendingSendToolCalls = new Map(); // sessionId -> Set<callId>：等待 tool/result 的发送类调用
    // reserved2 防“忘记设置唤醒条件”：key -> 当前是否等待 AI 处理唤醒回合 / 本回合已更新唤醒配置 / 连续未设置次数
    const pendingWakeKeys = new Set();
    // key -> 开始等待的时间戳（带租约）：正在执行 qq_wait_for_messages 长轮询的会话，防止同一会话并发挂起。
    // 存时间戳而不是单纯放进 Set，是因为 handler 中间任何异常都会跳过 finishWait ——
    // 那样这个 key 会被永远 429 掉（DSH 的 fetch 不会主动断开连接，req 'close' 也不会触发）。
    const activeWaits = new Map();
    /**
     * 单次等待的租约上限：正常等待最长 = timeout 预算 + 静默窗口 + 5s 余量，
     * 这里给足余量；超过就认为上一次是异常退出留下的残留，允许新的等待接管。
     */
    const ACTIVE_WAIT_LEASE_MS = 15 * 60 * 1000;
    /**
     * 回合判忙租约：只要 `turn/start` 的结束信号（turn/end）丢了，会话就会**永久**判忙，
     * 之后所有唤醒只进 pendingWakeReasons、QQ 上表现为「它不理我了」，只能重启（issue #11/#23/#26/#19）。
     * 正常回合 1~3 分钟，最长工具调用（DSH 的 toolCallTimeoutMs）≈12 分钟，15 分钟足以覆盖任何
     * **还活着**的回合。过期只是不再判忙：collector 本身保留，真回复照常 flush，只是允许新唤醒排队。
     */
    const TURN_BUSY_LEASE_MS = 15 * 60 * 1000;
    const turnLeaseNoted = new Set(); // 租约过期的日志去重（每个 session 只记一次）
    // key -> timeout：防止 accepted 但无 turn/end 的唤醒把 key 永久标记为 busy
    const wakeConfigUpdatedKeys = new Set();
    const markReadCalledKeys = new Set();
    const wakeConfigMissCount = new Map();
    const reverse = new Map(); // sessionId -> conv key
    for (const [key, sessionId] of Object.entries(state.sessions))
        reverse.set(sessionId, key);
    // 新版 DSH 事件流需要显式 follow；启动时为已持久化的 QQ 会话补上。
    for (const sessionId of Object.values(state.sessions))
        api.events.follow(sessionId);
    const wakeConfiguration = createWakeConfiguration({ get wakeTimers() { return wakeTimers; },
        get Date() { return Date; },
        get Math() { return Math; },
        get cfg() { return cfg; },
        get clearTimeout() { return clearTimeout; },
        get log() { return log; },
        get saveSocialV2State() { return saveSocialV2State; },
        get setupSleepTimerV2() { return setupSleepTimerV2; },
        get socialV2() { return socialV2; }
    });
    function normalizeSpeakerIdsV2(...args) { return (0, wakeConfiguration.normalizeSpeakerIdsV2)(...args); }
    function pickWakeTriggersV2(...args) { return (0, wakeConfiguration.pickWakeTriggersV2)(...args); }
    function defaultWakeConfigV2(...args) { return (0, wakeConfiguration.defaultWakeConfigV2)(...args); }
    function refreshDefaultWakeConfigV2(...args) { return (0, wakeConfiguration.refreshDefaultWakeConfigV2)(...args); }
    function refreshAllDefaultWakeConfigsV2(...args) { return (0, wakeConfiguration.refreshAllDefaultWakeConfigsV2)(...args); }
    function hasExplicitEndV2(...args) { return (0, wakeConfiguration.hasExplicitEndV2)(...args); }
    function isSleepingConfigV2(...args) { return (0, wakeConfiguration.isSleepingConfigV2)(...args); }
    function preSleepWaitBlockedV2(...args) { return (0, wakeConfiguration.preSleepWaitBlockedV2)(...args); }
    function computeWakeSafetyV2(...args) { return (0, wakeConfiguration.computeWakeSafetyV2)(...args); }
    function ensureWakeableV2(...args) { return (0, wakeConfiguration.ensureWakeableV2)(...args); }
    const v2StateStore = createV2StateStore({
        get Math() { return Math; },
        get SOCIAL_V2_FILE() { return SOCIAL_V2_FILE; },
        get atomicWriteJson() { return atomicWriteJson; },
        get canonicalV2Key() { return canonicalV2Key; },
        get crypto() { return crypto; },
        get defaultWakeConfigV2() { return defaultWakeConfigV2; },
        get ensureWakeableV2() { return ensureWakeableV2; },
        get fs() { return fs; },
        get log() { return log; },
        get normalizeSpeakerIdsV2() { return normalizeSpeakerIdsV2; },
        get pickWakeTriggersV2() { return pickWakeTriggersV2; },
        get readJsonSafe() { return readJsonSafe; },
        get refreshDefaultWakeConfigV2() { return refreshDefaultWakeConfigV2; },
        get rememberAgentToken() { return rememberAgentToken; },
        get sanitizeForwardId() { return sanitizeForwardId; },
        get scheduleProactiveCheckV2() { return scheduleProactiveCheckV2; },
        get seenForwardIds() { return seenForwardIds; },
        get setupSleepTimerV2() { return setupSleepTimerV2; }
    });
    function getSocialV2State(...args) { return (0, v2StateStore.getSocialV2State)(...args); }
    function loadSocialV2State(...args) { return (0, v2StateStore.loadSocialV2State)(...args); }
    function saveSocialV2State(...args) { return (0, v2StateStore.saveSocialV2State)(...args); }
    const v2Messages = createV2Messages({
        get Date() { return Date; },
        get cfg() { return cfg; },
        get getSocialV2State() { return getSocialV2State; },
        get redactKnownTokensOnly() { return redactKnownTokensOnly; },
        get sanitizeForwardId() { return sanitizeForwardId; },
        get sanitizeMediaSummary() { return sanitizeMediaSummary; },
        get saveSocialV2State() { return saveSocialV2State; },
        get seenForwardIds() { return seenForwardIds; },
        get truncateText() { return truncateText; },
        get truncateTextTail() { return truncateTextTail; }
    });
    function appendSocialV2Message(...args) { return (0, v2Messages.appendSocialV2Message)(...args); }
    function appendSocialV2Poke(...args) { return (0, v2Messages.appendSocialV2Poke)(...args); }
    function recordSentMessagesV2(...args) { return (0, v2Messages.recordSentMessagesV2)(...args); }
    const readReceipts = createReadReceipts({
        get Math() { return Math; }
    });
    function readThroughSeqV2(...args) { return (0, readReceipts.readThroughSeqV2)(...args); }
    function observationThroughSeqV2(...args) { return (0, readReceipts.observationThroughSeqV2)(...args); }
    function noteModelMessagesV2(...args) { return (0, readReceipts.noteModelMessagesV2)(...args); }
    function requestedReadThroughSeqV2(...args) { return (0, readReceipts.requestedReadThroughSeqV2)(...args); }
    function acknowledgeMessagesV2(...args) { return (0, readReceipts.acknowledgeMessagesV2)(...args); }
    const wakeContext = createWakeContext({
        get Date() { return Date; },
        get Math() { return Math; },
        get buildStickerContext() { return buildStickerContext; },
        get buildStickerStrategyHint() { return buildStickerStrategyHint; },
        get cfg() { return cfg; },
        get compactModelMessage() { return compactModelMessage; },
        get describeAge() { return describeAge; },
        get formatInitialPromptV2() { return formatInitialPromptV2; },
        get formatMemoryV2() { return formatMemoryV2; },
        get getSocialV2State() { return getSocialV2State; },
        get isDirectedAtAi() { return isDirectedAtAi; },
        get looksLikeUnfinished() { return looksLikeUnfinished; },
        get readRoleState() { return readRoleState; },
        get readThroughSeqV2() { return readThroughSeqV2; },
        get selfDisplayName() { return selfDisplayName; },
        get selfUserId() { return selfUserId; },
        get stickerEntries() { return stickerState.entries; },
        get v2ToolEnabled() { return v2ToolEnabled; }
    });
    function formatParticipationV2(...args) { return (0, wakeContext.formatParticipationV2)(...args); }
    function suggestQuietMsV2(...args) { return (0, wakeContext.suggestQuietMsV2)(...args); }
    function localClockText(...args) { return (0, wakeContext.localClockText)(...args); }
    function timeSenseCfg(...args) { return (0, wakeContext.timeSenseCfg)(...args); }
    function wakeReasonSeq(...args) { return (0, wakeContext.wakeReasonSeq)(...args); }
    function findV2MessageBySeq(...args) { return (0, wakeContext.findV2MessageBySeq)(...args); }
    function buildTimeSenseLine(...args) { return (0, wakeContext.buildTimeSenseLine)(...args); }
    function buildWakeSnapshotV2(...args) { return (0, wakeContext.buildWakeSnapshotV2)(...args); }
    function replyTimingV2(...args) { return (0, wakeContext.replyTimingV2)(...args); }
    function selfIdentityTextV2(...args) { return (0, wakeContext.selfIdentityTextV2)(...args); }
    function buildWakePromptV2(...args) { return (0, wakeContext.buildWakePromptV2)(...args); }
    function buildWakeReminderPromptV2(...args) { return (0, wakeContext.buildWakeReminderPromptV2)(...args); }
    const wakeTriggers = createWakeTriggers({
        get Math() { return Math; },
        get isDirectedAtAi() { return isDirectedAtAi; },
        get readThroughSeqV2() { return readThroughSeqV2; },
        get selfNickname() { return selfNickname; }
    });
    function evaluateWakeTriggerV2(...args) { return (0, wakeTriggers.evaluateWakeTriggerV2)(...args); }
    function isDirectWakeMessageV2(...args) { return (0, wakeTriggers.isDirectWakeMessageV2)(...args); }
    function hasDirectUnreadV2(...args) { return (0, wakeTriggers.hasDirectUnreadV2)(...args); }
    function wakePriorityV2(...args) { return (0, wakeTriggers.wakePriorityV2)(...args); }
    function isTimerWakeReason(...args) { return (0, wakeTriggers.isTimerWakeReason)(...args); }
    const wakeDispatcher = createWakeDispatcher({ get wakeTimers() { return wakeTimers; }, get isWakeLeaseCurrent() { return isWakeLeaseCurrent; },
        get Date() { return Date; },
        get Math() { return Math; },
        get armPendingWakeLease() { return armPendingWakeLease; },
        get buildWakePromptV2() { return buildWakePromptV2; },
        get busyReasonV2() { return busyReasonV2; },
        get cancelReplyCheckV2() { return cancelReplyCheckV2; },
        get cfg() { return cfg; },
        get clearTimeout() { return clearTimeout; },
        get currentMode() { return modeCoordinator.state.currentMode; },
        get deliverPrompt() { return deliverPrompt; },
        get disarmPendingWakeLease() { return disarmPendingWakeLease; },
        get getSocialV2State() { return getSocialV2State; },
        get hasDirectUnreadV2() { return hasDirectUnreadV2; },
        get isConversationBusyV2() { return isConversationBusyV2; },
        get isSessionAllowedInCurrentMode() { return isSessionAllowedInCurrentMode; },
        get isTimerWakeReason() { return isTimerWakeReason; },
        get log() { return log; },
        get nativeObservationCurrent() { return nativeObservationCurrent; },
        get pendingWakeKeys() { return pendingWakeKeys; },
        get saveSocialV2State() { return saveSocialV2State; },
        get setTimeout() { return setTimeout; },
        get setupSleepTimerV2() { return setupSleepTimerV2; },
        get socialV2() { return socialV2; }
    });
    function sendWakePromptV2(...args) { return (0, wakeDispatcher.sendWakePromptV2)(...args); }
    const wakeScheduler = createWakeScheduler({ get wakeTimers() { return wakeTimers; }, get isWakeLeaseCurrent() { return isWakeLeaseCurrent; },
        get Date() { return Date; },
        get Math() { return Math; },
        get TURN_BUSY_LEASE_MS() { return TURN_BUSY_LEASE_MS; },
        get cfg() { return cfg; },
        get clearTimeout() { return clearTimeout; },
        get collectors() { return collectors; },
        get currentMode() { return modeCoordinator.state.currentMode; },
        get ensureWakeableV2() { return ensureWakeableV2; },
        get getSocialV2State() { return getSocialV2State; },
        get isSessionAllowedInCurrentMode() { return isSessionAllowedInCurrentMode; },
        get isTimerWakeReason() { return isTimerWakeReason; },
        get log() { return log; },
        get markReadCalledKeys() { return markReadCalledKeys; },
        get messageMediaStore() { return messageMediaStore; },
        get nativeBinding() { return nativeBinding; },
        get nativeObservation() { return nativeObservation; },
        get pendingWakeKeys() { return pendingWakeKeys; },
        get promptQueue() { return promptQueue; },
        get sendWakePromptV2() { return sendWakePromptV2; },
        get setTimeout() { return setTimeout; },
        get socialV2() { return socialV2; },
        get state() { return state; },
        get turnLeaseNoted() { return turnLeaseNoted; },
        get v2TurnStartAt() { return v2TurnStartAt; },
        get wakeConfigMissCount() { return wakeConfigMissCount; },
        get wakeConfigUpdatedKeys() { return wakeConfigUpdatedKeys; },
        get wakePriorityV2() { return wakePriorityV2; } });
    function cancelReplyCheckV2(...args) { return (0, wakeScheduler.cancelReplyCheckV2)(...args); }
    function scheduleReplyCheckV2(...args) { return (0, wakeScheduler.scheduleReplyCheckV2)(...args); }
    function busyReasonV2(...args) { return (0, wakeScheduler.busyReasonV2)(...args); }
    function isConversationBusyV2(...args) { return (0, wakeScheduler.isConversationBusyV2)(...args); }
    function scheduleWakeV2(...args) { return (0, wakeScheduler.scheduleWakeV2)(...args); }
    function replayPendingWakeReasonsV2(...args) { return (0, wakeScheduler.replayPendingWakeReasonsV2)(...args); }
    function setupSleepTimerV2(...args) { return (0, wakeScheduler.setupSleepTimerV2)(...args); }
    function cancelProactiveCheckV2(...args) { return (0, wakeScheduler.cancelProactiveCheckV2)(...args); }
    function scheduleProactiveCheckV2(...args) { return (0, wakeScheduler.scheduleProactiveCheckV2)(...args); }
    function clearSocialV2Timers(...args) { return (0, wakeScheduler.clearSocialV2Timers)(...args); }
    function clearAllSocialV2Timers(...args) { return (0, wakeScheduler.clearAllSocialV2Timers)(...args); }
    const wakeTimers = createOwnedTimers({ getOwner: key => socialV2.conversations.get(key), normalizeKey: key => canonicalV2Key(key) || key,
        setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: timer => clearTimeout(timer) });
    function armPendingWakeLease(key) { return wakeTimers.schedule(key, getSocialV2State(key), 'pendingWakeLeaseTimer', () => pendingWakeKeys.delete(key), 30 * 60 * 1000); }
    function disarmPendingWakeLease(key) { wakeTimers.cancel(key, 'pendingWakeLeaseTimer'); }
    function clearAllPendingWakeLeases() { wakeTimers.cancelSlot('pendingWakeLeaseTimer'); }
    function isWakeLeaseCurrent(key, lease) { return wakeTimers.isCurrent(key, 'pendingWakeLeaseTimer', lease); }
    const incomingMessages = createIncomingMessages({ get DIRECTION_HINT() { return DIRECTION_HINT; },
        get DSH_CONTROL_TIMEOUT_MS() { return DSH_CONTROL_TIMEOUT_MS; },
        get MAX_MEDIA_STORE_PER_KEY() { return MAX_MEDIA_STORE_PER_KEY; },
        get ROOT() { return ROOT; },
        get SILENT_MARKER() { return SILENT_MARKER; },
        get SPACE_SPLIT_HINT() { return SPACE_SPLIT_HINT; },
        get allowed() { return allowed; },
        get api() { return api; },
        get appendActivity() { return appendActivity; },
        get appendRecentMessage() { return appendRecentMessage; },
        get appendSocialV2Message() { return appendSocialV2Message; },
        get appendSocialV2Poke() { return appendSocialV2Poke; },
        get appendSummary() { return appendSummary; },
        get buildContextBlock() { return buildContextBlock; },
        get cancelPendingEntry() { return cancelPendingEntry; },
        get cancelSocialTimers() { return cancelSocialTimers; },
        get captureSendGuard() { return captureSendGuard; },
        get cfg() { return cfg; },
        get clearSocialV2Timers() { return clearSocialV2Timers; },
        get collectors() { return collectors; },
        get convKey() { return convKey; },
        get currentMode() { return modeCoordinator.state.currentMode; },
        get currentRoleHint() { return currentRoleHint; },
        get deliverPrompt() { return deliverPrompt; },
        get drainPromptQueue() { return drainPromptQueue; },
        get dshReady() { return modeCoordinator.state.dshReady; }, set dshReady(value) { modeCoordinator.state.dshReady = value; },
        get enterActive() { return enterActive; },
        get evaluateWakeTriggerV2() { return evaluateWakeTriggerV2; },
        get extractForwardIds() { return extractForwardIds; },
        get extractMediaFromSegments() { return extractMediaFromSegments; },
        get feedSlangWindow() { return feedSlangWindow; },
        get forgetAgentToken() { return forgetAgentToken; },
        get fs() { return fs; },
        get getSocialV2State() { return getSocialV2State; },
        get handlePendingAnswer() { return handlePendingAnswer; },
        get isConversationBusyV2() { return isConversationBusyV2; },
        get isDirectAddress() { return isDirectAddress; },
        get isDirectWakeMessageV2() { return isDirectWakeMessageV2; },
        get isQuoteTargetSelf() { return isQuoteTargetSelf; },
        get isSessionAllowedInCurrentMode() { return isSessionAllowedInCurrentMode; },
        get isSocialEnabled() { return isSocialEnabled; },
        get lastSendFailed() { return lastSendFailed; },
        get log() { return log; },
        get markReadCalledKeys() { return markReadCalledKeys; },
        get mediaHintFor() { return mediaHintFor; },
        get messageMediaStore() { return messageMediaStore; },
        get modeAllowed() { return modeAllowed; },
        get nativeBinding() { return nativeBinding; },
        get nativeCapabilities() { return nativeCapabilities; },
        get nativeChatHint() { return nativeChatHint; },
        get nativeIdleLoop() { return nativeIdleLoop; },
        get nativeObservation() { return nativeObservation; },
        get nativeObservationCurrent() { return nativeObservationCurrent; },
        get nativePolicyGeneration() { return nativePolicyGeneration; },
        get nativeVoice() { return nativeVoice; },
        get path() { return path; },
        get pending() { return pending; },
        get pendingSendToolCalls() { return pendingSendToolCalls; },
        get pendingWakeKeys() { return pendingWakeKeys; },
        get offlineQueue() { return offlineQueue; },
        get readRoleState() { return readRoleState; },
        get reconcileNativeTerminal() { return reconcileNativeTerminal; },
        get resolveGroupMemberName() { return resolveGroupMemberName; },
        get resolveReplyInfo() { return resolveReplyInfo; },
        get reverse() { return reverse; },
        get sanitizeRoleName() { return sanitizeRoleName; },
        get saveSocialV2State() { return saveSocialV2State; },
        get saveState() { return saveState; },
        get scheduleSocialReply() { return scheduleSocialReply; },
        get scheduleWakeV2() { return scheduleWakeV2; },
        get seenForwardIds() { return seenForwardIds; },
        get segmentsToText() { return segmentsToText; },
        get sendToQQ() { return sendToQQ; },
        get sendToolSucceededSessions() { return sendToolSucceededSessions; },
        get sessionCreation() { return sessionCreation; },
        get sessionEpoch() { return sessionEpoch; }, set sessionEpoch(value) { sessionEpoch = value; },
        get sessionModelManager() { return sessionModelManager; },
        get slangExtractionCooldowns() { return slangExtractionCooldowns; },
        get slangSubmitTimes() { return slangSubmitTimes; },
        get slangWindows() { return slangWindows; },
        get social() { return social; },
        get socialState() { return socialState; },
        get socialV2() { return socialV2; },
        get state() { return state; },
        get stopBridgeSessionWork() { return stopBridgeSessionWork; },
        get toolCallNames() { return toolCallNames; },
        get triggerActiveDurationExit() { return triggerActiveDurationExit; },
        get turnLeaseNoted() { return turnLeaseNoted; },
        get v2TurnStartAt() { return v2TurnStartAt; },
        get wakeConfigMissCount() { return wakeConfigMissCount; },
        get wakeConfigUpdatedKeys() { return wakeConfigUpdatedKeys; },
        get withTimeout() { return withTimeout; },
        get writeRoleState() { return writeRoleState; } });
    const { handleIncoming, handlePokeNotice } = incomingMessages;
    const pendingRequests = createPendingRequests({ setTimeout, clearTimeout,
        isCurrentSession: (key, id) => isCurrentSession(key, id) && (!nativeBinding || (nativePolicyCurrent && nativePolicyGeneration === 0 && nativeTurnFence.hasOpenTurn(id))),
        get APPROVE_WORDS() { return APPROVE_WORDS; },
        get REJECT_WORDS() { return REJECT_WORDS; },
        get api() { return api; },
        get cfg() { return cfg; },
        get log() { return log; },
        get sendToQQ() { return sendToQQ; },
        get withTimeout() { return withTimeout; } });
    const { cancelPendingEntry, handlePendingAnswer, registerPending } = pendingRequests;
    const turnEvents = createTurnEvents({ get isWakeLeaseCurrent() { return isWakeLeaseCurrent; }, get KNOWN_AGENT_TOKENS() { return KNOWN_AGENT_TOKENS; },
        get SENSITIVE_RE() { return SENSITIVE_RE; },
        get SILENT_MARKER() { return SILENT_MARKER; },
        get SILENT_TURN_TIMEOUT_MS() { return SILENT_TURN_TIMEOUT_MS; },
        get appendActivity() { return appendActivity; },
        get armPendingWakeLease() { return armPendingWakeLease; },
        get buildWakeReminderPromptV2() { return buildWakeReminderPromptV2; },
        get cfg() { return cfg; },
        get collectors() { return collectors; },
        get createTurnCollector() { return createTurnCollector; },
        get currentMode() { return modeCoordinator.state.currentMode; },
        get defaultWakeConfigV2() { return defaultWakeConfigV2; },
        get deliverPrompt() { return deliverPrompt; },
        get disarmPendingWakeLease() { return disarmPendingWakeLease; },
        get ensureWakeableV2() { return ensureWakeableV2; },
        get getSocialV2State() { return getSocialV2State; },
        get isSilentMarker() { return isSilentMarker; },
        get isSocialEnabled() { return isSocialEnabled; },
        get lastSendSucceeded() { return lastSendSucceeded; },
        get log() { return log; },
        get markReadCalledKeys() { return markReadCalledKeys; },
        get mdToPlain() { return mdToPlain; },
        get nativeBinding() { return nativeBinding; },
        get nativeObservation() { return nativeObservation; },
        get nativeTrackedTurns() { return nativeTrackedTurns; },
        get pendingSendToolCalls() { return pendingSendToolCalls; },
        get pendingWakeKeys() { return pendingWakeKeys; },
        get planSocialTimeline() { return planSocialTimeline; },
        get replayPendingWakeReasonsV2() { return replayPendingWakeReasonsV2; },
        get saveSocialV2State() { return saveSocialV2State; },
        get sendBurstToQQ() { return sendBurstToQQ; },
        get sendToQQ() { return sendToQQ; },
        get sendToolSucceededSessions() { return sendToolSucceededSessions; },
        get shouldAuditKey() { return shouldAuditKey; },
        get shouldBlockSilentReply() { return shouldBlockSilentReply; },
        get social() { return social; },
        get socialState() { return socialState; },
        get toolCallNames() { return toolCallNames; },
        get turnLeaseNoted() { return turnLeaseNoted; },
        get v2TurnStartAt() { return v2TurnStartAt; },
        get wakeConfigMissCount() { return wakeConfigMissCount; },
        get wakeConfigUpdatedKeys() { return wakeConfigUpdatedKeys; } });
    const { trackTurnEvent, finishSessionTurn } = turnEvents;
    const sessionFrames = createSessionFrameHandler({ get SENSITIVE_RE() { return SENSITIVE_RE; },
        get api() { return api; },
        get appendToolLog() { return appendToolLog; },
        get cancelPendingEntry() { return cancelPendingEntry; },
        get createTurnCollector() { return createTurnCollector; },
        get currentMode() { return modeCoordinator.state.currentMode; },
        get finishSessionTurn() { return finishSessionTurn; },
        get idleDraftRunner() { return idleDraftRunner; },
        get isCurrentSession() { return isCurrentSession; },
        get isSendToolName() { return isSendToolName; },
        get learnerCollectors() { return learnerCollectors; },
        get learnerSessions() { return learnerSessions; },
        get learnerWaiters() { return learnerWaiters; },
        get log() { return log; },
        get nativeBinding() { return nativeBinding; },
        get nativePhoneModel() { return nativePhoneModel; },
        get nativePolicyCurrent() { return nativePolicyCurrent; }, set nativePolicyCurrent(value) { nativePolicyCurrent = value; },
        get nativePolicyGeneration() { return nativePolicyGeneration; },
        get nativeTrackedTurns() { return nativeTrackedTurns; },
        get nativeTurnFence() { return nativeTurnFence; },
        get pendingSendToolCalls() { return pendingSendToolCalls; },
        get recordSessionSnapshot() { return recordSessionSnapshot; },
        get recordSessionUsage() { return recordSessionUsage; },
        get registerPending() { return registerPending; },
        get reverse() { return reverse; },
        get sanitizeToolArgs() { return sanitizeToolArgs; },
        get sendToQQ() { return sendToQQ; },
        get sendToolSucceededSessions() { return sendToolSucceededSessions; },
        get settleNativeTerminal() { return settleNativeTerminal; },
        get shouldAuditKey() { return shouldAuditKey; },
        get slangLearnerSessionId() { return slangLearning.sessionId; },
        get toolCallNames() { return toolCallNames; },
        get trackTurnEvent() { return trackTurnEvent; },
        get turnLeaseNoted() { return turnLeaseNoted; },
        get v2TurnStartAt() { return v2TurnStartAt; } });
    const { handleSessionFrame } = sessionFrames;
    const sessionEvents = createSessionEventStream({ get activeWaits() { return activeWaits; },
        get api() { return api; },
        get clearAllPendingWakeLeases() { return clearAllPendingWakeLeases; },
        get collectors() { return collectors; },
        get handleSessionFrame() { return handleSessionFrame; },
        get idleDraftRunner() { return idleDraftRunner; },
        get log() { return log; },
        get markReadCalledKeys() { return markReadCalledKeys; },
        get nativeIdleLoop() { return nativeIdleLoop; },
        get nativePhone() { return nativePhone; },
        get nativePhoneModel() { return nativePhoneModel; },
        get pendingSendToolCalls() { return pendingSendToolCalls; },
        get pendingWakeKeys() { return pendingWakeKeys; },
        get sendToolSucceededSessions() { return sendToolSucceededSessions; },
        get sleep() { return sleep; },
        get social() { return social; },
        get toolCallNames() { return toolCallNames; },
        get v2TurnStartAt() { return v2TurnStartAt; },
        get wakeConfigMissCount() { return wakeConfigMissCount; },
        get wakeConfigUpdatedKeys() { return wakeConfigUpdatedKeys; } });
    const { pumpMux } = sessionEvents;
    const sessionRetirement = createSessionRetirement({ get offlineQueue() { return offlineQueue; },
        get clearTimeout() { return clearTimeout; },
        get DSH_CONTROL_TIMEOUT_MS() { return DSH_CONTROL_TIMEOUT_MS; },
        get activeWaits() { return activeWaits; },
        get api() { return api; },
        get cancelPendingEntry() { return cancelPendingEntry; },
        get cancelSocialTimers() { return cancelSocialTimers; },
        get clearSocialV2Timers() { return clearSocialV2Timers; },
        get collectors() { return collectors; },
        get crypto() { return crypto; },
        get disarmPendingWakeLease() { return disarmPendingWakeLease; },
        get feedbackTimes() { return feedbackTimes; },
        get lastSendFailed() { return lastSendFailed; },
        get log() { return log; },
        get markReadCalledKeys() { return markReadCalledKeys; },
        get pending() { return pending; },
        get pendingSendToolCalls() { return pendingSendToolCalls; },
        get pendingWakeKeys() { return pendingWakeKeys; },
        get rememberAgentToken() { return rememberAgentToken; },
        get reverse() { return reverse; },
        get saveSocialV2State() { return saveSocialV2State; },
        get saveState() { return saveState; },
        get sendToolSucceededSessions() { return sendToolSucceededSessions; },
        get sessionModelManager() { return sessionModelManager; },
        get slangSubmitTimes() { return slangSubmitTimes; },
        get social() { return social; },
        get socialV2() { return socialV2; },
        get state() { return state; },
        get stopBridgeSessionWork() { return stopBridgeSessionWork; },
        get toolCallNames() { return toolCallNames; },
        get turnLeaseNoted() { return turnLeaseNoted; },
        get usageObserver() { return usageObserver; },
        get v2TurnStartAt() { return v2TurnStartAt; },
        get wakeConfigMissCount() { return wakeConfigMissCount; },
        get wakeConfigUpdatedKeys() { return wakeConfigUpdatedKeys; },
        get withTimeout() { return withTimeout; } });
    const sessionCreation = createSessionCreation({
        get DSH_CONTROL_TIMEOUT_MS() { return DSH_CONTROL_TIMEOUT_MS; },
        get STATE_DIR() { return STATE_DIR; },
        get api() { return api; },
        get cfg() { return cfg; },
        get currentMode() { return modeCoordinator.state.currentMode; },
        get dshPresetIds() { return modeCoordinator.state.dshPresetIds; },
        get ensureChatModel() { return ensureChatModel; },
        get fs() { return fs; },
        get isCurrentSession() { return isCurrentSession; },
        get isSessionAllowedInCurrentMode() { return isSessionAllowedInCurrentMode; },
        get log() { return log; },
        get modePreset() { return modePreset; },
        get path() { return path; },
        get retireSession() { return retireSession; },
        get reverse() { return reverse; },
        get saveState() { return saveState; },
        get sessionEpoch() { return sessionEpoch; },
        get sessionPolicy() { return sessionPolicy; },
        get state() { return state; },
        get unwrap() { return unwrap; },
        get withTimeout() { return withTimeout; }
    });
    const promptDispatcher = createPromptDispatcher({
        get SENSITIVE_RE() { return SENSITIVE_RE; },
        get api() { return api; },
        get auditAndSend() { return auditAndSend; },
        get buildNativeFeatureHints() { return buildNativeFeatureHints; },
        get buildWakePromptV2() { return buildWakePromptV2; },
        get buildWakeSnapshotV2() { return buildWakeSnapshotV2; },
        get canonicalV2Key() { return canonicalV2Key; },
        get cfg() { return cfg; },
        get currentMode() { return modeCoordinator.state.currentMode; },
        get disarmPendingWakeLease() { return disarmPendingWakeLease; },
        get dshReady() { return modeCoordinator.state.dshReady; },
        get enqueueForRetry() { return enqueueForRetry; },
        get ensureSession() { return ensureSession; },
        get getSocialV2State() { return getSocialV2State; },
        get isCurrentSession() { return isCurrentSession; },
        get isSessionAllowedInCurrentMode() { return isSessionAllowedInCurrentMode; },
        get log() { return log; },
        get mdToPlain() { return mdToPlain; },
        get nativeBinding() { return nativeBinding; },
        get nativeCapabilities() { return nativeCapabilities; },
        get nativeChatHint() { return nativeChatHint; },
        get nativeObservationCurrent() { return nativeObservationCurrent; },
        get nativePolicyCurrent() { return nativePolicyCurrent; },
        get nativePolicyGeneration() { return nativePolicyGeneration; },
        get nativeTurnFence() { return nativeTurnFence; },
        get noteModelMessagesV2() { return noteModelMessagesV2; },
        get pendingWakeKeys() { return pendingWakeKeys; },
        get offlineQueue() { return offlineQueue; },
        get readNativeTurnBaseline() { return readNativeTurnBaseline; },
        get resolveMediaList() { return resolveMediaList; },
        get sendToQQ() { return sendToQQ; },
        get shouldAuditKey() { return shouldAuditKey; },
        get social() { return social; },
        get socialV2() { return socialV2; },
        get state() { return state; },
        get stopBridgeSessionWork() { return stopBridgeSessionWork; },
        get traceNativeReceive() { return traceNativeReceive; },
        get withSlangContext() { return withSlangContext; }
    });
    const promptQueue = createPromptQueue({ dispatch: (key, promptText, opts) => promptDispatcher(key, promptText, opts),
        prepareOptions: opts => nativeBinding ? { ...opts, nativeGeneration: nativeInboundPolicy.getStore() ?? nativePolicyGeneration } : opts });
    function ensureSession(key) { return sessionCreation.ensure(key); }
    function stopRetiredSessionWork(sessionId, key = '') { return sessionRetirement.stopRetiredSessionWork(sessionId, key); }
    function forgetConversationCaches(key) { return sessionRetirement.forgetConversationCaches(key); }
    function retireSession(key) { return sessionRetirement.retireSession(key); }
    function deliverPrompt(key, promptText, opts = {}) { return promptQueue.submit(key, promptText, opts); }
    function drainPromptQueue(key, errorMsg) { promptQueue.drain(key, errorMsg); }
    function drainAllPromptQueues(errorMsg) { promptQueue.drainAll(errorMsg); }
    // ── Token 用量账本（控制台「令牌与花费」） ───────────────────────────────
    // 权威总量取 DSH 的 tokenUsage 投影（整条会话日志累计，含桥接启动前的历史），
    // 逐轮明细由 assistant/message 的 usage 折叠而来；花费在读取时按价目表折算。
    const priceTable = resolvePriceTable(cfg.pricing);
    const tokenLedger = createTokenLedger({
        file: TOKEN_USAGE_FILE,
        log: (...args) => log(...args),
        priceTable,
        // 会话 → QQ 会话归属：学习会话单独记账，其余未知会话归入「未归属」。
        resolveKey: (sessionId) => reverse.get(sessionId)
            ?? (learnerSessions.has(sessionId) || (slangLearning.sessionId && sessionId === slangLearning.sessionId)
                ? 'internal:黑话学习'
                : undefined)
    });
    const rebuildInFlightCollector = createSnapshotRecovery({
        canRestore: sessionId => !nativeBinding || nativeTurnFence.has(sessionId),
        accept: (sessionId, event) => !nativeBinding || nativeTurnFence.accept(sessionId, event),
        onStart: (sessionId, event) => {
            if (nativeBinding)
                nativeTrackedTurns.set(sessionId, { turn: event.data.turn, startSeq: event.seq, generation: nativePolicyGeneration });
        },
        createCollector: createTurnCollector, installCollector: (sessionId, collector) => collectors.set(sessionId, collector),
        ensureStartTime: sessionId => { if (!v2TurnStartAt.has(sessionId))
            v2TurnStartAt.set(sessionId, Date.now()); }, log
    });
    const usageObserver = createUsageObserver({ tokenLedger, nominalModel: () => cfg.dsh?.model || 'deepseek-flash',
        fallbackProvider: () => cfg.dsh?.provider, rebuildInFlightCollector, log, now: () => Date.now() });
    const { recordSessionUsage, recordSessionSnapshot } = usageObserver;
    // DSH 可用性探活 + 重启容错队列：
    // DSH 重启期间收到的 QQ 消息先入队（不丢），DSH 恢复后按序补投。
    const modeCoordinator = createModeCoordinator({
        get unwrap() { return unwrap; },
        get api() { return api; },
        get settingFromDshNamespace() { return settingFromDshNamespace; },
        get normalizeModeInput() { return normalizeModeInput; },
        get nativeBinding() { return nativeBinding; },
        get cfg() { return cfg; },
        get normalizeOwnerQQ() { return normalizeOwnerQQ; },
        get log() { return log; },
        get readJsonSafe() { return readJsonSafe; },
        get path() { return path; },
        get STATE_DIR() { return STATE_DIR; },
        get allowed() { return allowed; },
        get state() { return state; },
        get retireSession() { return retireSession; },
        get socialV2() { return socialV2; },
        get setupSleepTimerV2() { return setupSleepTimerV2; },
        get scheduleProactiveCheckV2() { return scheduleProactiveCheckV2; },
        get flushQueue() { return flushQueue; },
        get slangWindows() { return slangWindows; },
        get maybeQueueSlangExtraction() { return maybeQueueSlangExtraction; },
        get cleanupSocialForModeChange() { return cleanupSocialForModeChange; },
        get clearAllSocialV2Timers() { return clearAllSocialV2Timers; },
        get drainAllPromptQueues() { return drainAllPromptQueues; },
        get setInterval() { return setInterval; }
    });
    // QQ网关通道健康探测只启动一次（见 startSnowlumaWatch）
    // chat | closed-agent | reserved（仿真模式，由 DSH settings / state/mode.json 驱动）
    // closed-agent 模式使用的 DSH agent preset：留空表示「用 DSH 自己声明的默认 preset」。
    // 旧版本这里硬编码 'router-standard'，但 DSH 0.1.5 已移除该 preset，硬编码会导致
    // 创建出的会话挂不上 preset，进而被 DSH 套上 standard（含本地工具）。
    // DSH 侧真实的 preset 清单与默认 preset：旧版本这里是硬编码的 'router-standard'，
    // 但 DSH 0.1.5 已不存在该 preset，硬编码会让 closed-agent 模式永远挂不上 preset。
    // 当前 DSH 可用的 preset id 列表（agentPresets/list）
    // DSH settings `agent-presets.default`，取不到时用列表里的 isDefault
    const offlineQueue = createOfflineQueue({
        dispatch: (key, text, options, isCurrent) => deliverPrompt(key, text, { ...options, offlineCurrent: isCurrent }),
        allowed: key => isSessionAllowedInCurrentMode(key), schedule: (fn, ms) => setTimeout(fn, ms), cancel: timer => clearTimeout(timer), log,
    });
    const enqueueForRetry = (key, promptText, opts = {}) => offlineQueue.enqueue(key, promptText, { farewell: !!opts.farewell, silent: !!opts.silent, media: opts.media ?? [], wakeReason: opts.wakeReason }, true);
    const flushQueue = () => offlineQueue.flush();
    function refreshMode(...args) { return (0, modeCoordinator.refreshMode)(...args); }
    function refreshPresetList(...args) { return (0, modeCoordinator.refreshPresetList)(...args); }
    function modeAllowed(...args) { return (0, modeCoordinator.modeAllowed)(...args); }
    function resolvePresetName(...args) { return (0, modeCoordinator.resolvePresetName)(...args); }
    function modePreset(...args) { return (0, modeCoordinator.modePreset)(...args); }
    function isSessionAllowedInCurrentMode(...args) { return (0, modeCoordinator.isSessionAllowedInCurrentMode)(...args); }
    function sessionPolicy(...args) { return (0, modeCoordinator.sessionPolicy)(...args); }
    function isCurrentSession(...args) { return (0, modeCoordinator.isCurrentSession)(...args); }
    function reconcileSessionPolicies(...args) { return (0, modeCoordinator.reconcileSessionPolicies)(...args); }
    const checkDsh = (...args) => (0, modeCoordinator.checkDsh)(...args);
    function startDshWatch(...args) { return (0, modeCoordinator.startDshWatch)(...args); }
    // 旧外部通道兼容约定见 docs/legacy/GATEWAY_COMPATIBILITY_NOTES.md；原生通道使用所属网关状态。
    const gatewayMonitor = createGatewayHealth({
        get cfg() { return cfg; },
        get Date() { return Date; },
        get log() { return log; },
        get nativeBinding() { return nativeBinding; },
        get bot() { return bot; },
        get fetch() { return fetch; },
        get AbortSignal() { return AbortSignal; },
        get setTimeout() { return setTimeout; },
        get setInterval() { return setInterval; }
    });
    const gatewayHealth = gatewayMonitor.state;
    function noteUpstreamPacket(...args) { return (0, gatewayMonitor.noteUpstreamPacket)(...args); }
    function noteReceiveHealth(...args) { return (0, gatewayMonitor.noteReceiveHealth)(...args); }
    function gatewayHealthSnapshot(...args) { return (0, gatewayMonitor.gatewayHealthSnapshot)(...args); }
    function reportSnowlumaHealth(...args) { return (0, gatewayMonitor.reportSnowlumaHealth)(...args); }
    function pollSnowlumaStatus(...args) { return (0, gatewayMonitor.pollSnowlumaStatus)(...args); }
    function startSnowlumaWatch(...args) { return (0, gatewayMonitor.startSnowlumaWatch)(...args); }
    // ── 本地控制台（独立 Web 面板，不依赖 DSH WebUI） ───────────────────────────
    // 模式/角色/静默状态都存 state/*.json，桥接即时感知；此服务只读写这些文件。
    function v2ToolEnabled(flag) {
        return cfg.socialV2?.tools?.[flag] !== false;
    }
    function startConsoleServer() {
        const handleSlangAgentRoute = createSlangAgentRoutes({ cfg, submitTimes: slangSubmitTimes,
            store: { get entries() { return slangEntries; }, get writable() { return slangStoreWritable; }, save: saveSlangStore },
            agentTokenOk: (key, token) => agentTokenOk(key, token), v2SessionAllowed: isSessionAllowedInCurrentMode,
            v2ToolEnabled, redactKnownTokensOnly, queueSlangTask, runSlangResearch, log, appendActivity });
        const handleMemoryRoute = createMemoryRoutes({ getState: getSocialV2State, memory: conversationMemory,
            save: saveSocialV2State, redactKnownTokensOnly, agentTokenOk: (key, token) => agentTokenOk(key, token),
            v2SessionAllowed: isSessionAllowedInCurrentMode, v2ToolEnabled });
        const feedbackStore = createFeedbackStore({ feedbackFile: FEEDBACK_FILE, toolLogFile: TOOL_LOG_FILE,
            readJsonSafe, atomicWriteJson, redactSensitiveText });
        const handleFeedbackRoute = createFeedbackRoutes({ cfg, store: feedbackStore, feedbackTimes,
            agentTokenOk: (key, token) => agentTokenOk(key, token),
            v2SessionAllowed: isSessionAllowedInCurrentMode, v2ToolEnabled, truncateText, log, appendActivity });
        const handleOperatorNotice = createOperatorNoticeRoutes({ cfg,
            getRuntime: () => ({ currentMode: modeCoordinator.state.currentMode, dshReady: modeCoordinator.state.dshReady, sessions: state.sessions, silentTurns: social.silentTurns }),
            modeAllowed, allowed, readRoleState, getSocialV2State, ensureSession, deliverPrompt, log, appendActivity });
        const handleLegacySocialRoute = createLegacySocialRoutes({ root: ROOT, cfg, getSocial: () => social,
            enterActive, leaveActive, flushSummaries, readConfigObject, atomicWriteJson, log });
        const handleSocialSettingsRoute = createSocialSettingsRoutes({ root: ROOT, cfg, getSocialV2: () => socialV2,
            readConfigObject, atomicWriteJson, refreshAllDefaultWakeConfigsV2, clearAllSocialV2Timers,
            setupSleepTimerV2, scheduleProactiveCheckV2, saveSocialV2State, log });
        // 延迟取状态：pending等集合在启动组合阶段之后声明，不在工厂构造时访问。
        const handleSessionAdminRoute = createSessionAdminRoutes({ stateDir: STATE_DIR, activityLog: ACTIVITY_LOG,
            controlTimeoutMs: DSH_CONTROL_TIMEOUT_MS, log, advanceEpoch: () => { sessionEpoch++; },
            getContext: () => ({ state: state, cfg, pending, sessionModelManager, reverse, collectors, sendToolSucceededSessions,
                pendingSendToolCalls, v2TurnStartAt, turnLeaseNoted, toolCallNames, offlineQueue, sessionCreation,
                social, messageMediaStore, slangWindows, slangExtractionCooldowns, slangSubmitTimes, pendingWakeKeys,
                wakeConfigUpdatedKeys, markReadCalledKeys, wakeConfigMissCount, socialV2, seenForwardIds,
                CONVERSATION_TOKENS, KNOWN_AGENT_TOKENS, cancelPendingEntry, drainPromptQueue, drainAllPromptQueues,
                cancelSocialTimers, clearSocialV2Timers, cancelAllSocialTimers, clearAllSocialV2Timers, forgetAgentToken,
                saveSocialV2State, saveState, withTimeout, stopBridgeSessionWork, api }) });
        const handleSlangRoute = createSlangRoutes({ root: ROOT, cfg, readConfigObject, atomicWriteJson, log,
            store: { get entries() { return slangEntries; }, set entries(value) { slangEntries = value; },
                get writable() { return slangStoreWritable; }, save: saveSlangStore },
            learning: { windows: slangWindows, extractionCooldowns: slangExtractionCooldowns, submitTimes: slangSubmitTimes,
                researchingIds: slangResearchingIds, queue: queueSlangTask, extract: runSlangExtraction,
                research: runSlangResearch, invalidate: invalidateSlangLearnerSession } });
        const handleStickerRoute = createStickerRoutes({ cfg,
            store: { get entries() { return stickerState.entries; }, get syncedAt() { return stickerState.syncedAt; }, get writable() { return stickerState.writable; } },
            sync: syncStickerLibrary, note: applyStickerNoteV2, remark: setStickerRemarkV2 });
        const handleTokenRoute = createTokenRoutes({ ledger: tokenLedger, getSymbol: () => priceTable.symbol, log });
        const handleInitialPromptRoute = createInitialPromptRoutes({ store: initialPromptStore, canonicalKey: canonicalV2Key, log });
        const handlePresetRoute = createPresetRoutes({ store: presetStore, atomicWriteText, log });
        const handleRoleRoute = createRoleRoutes({ root: ROOT, store: roleStore, trash: roleTrash, readConfigObject, atomicWriteJson, log,
            onLimitChanged: next => { cfg.role = { ...(cfg.role ?? {}), maxInjectChars: next }; } });
        const handleSettingsRoute = createSettingsRoutes({ root: ROOT, cfg, scopeLocked: Boolean(nativeBinding),
            scopeSummary: () => nativeScopeSummary(cfg.nativeScope), readConfigObject, atomicWriteJson, reconcileSessionPolicies,
            onEffortChanged: () => sessionModelManager.invalidateAll(), log });
        const port = (cfg.consolePort ?? 3100);
        // 控制台鉴权：优先用 config.consoleToken，未配置则自动生成并持久化，不再默认无鉴权。
        // 使用 let 以便控制台内手动修改令牌后热更新。
        const configuredToken = String(cfg.consoleToken ?? '').trim();
        const tokenValid = configuredToken.length >= 16 && configuredToken.length <= 128 && /^[A-Za-z0-9_-]+$/.test(configuredToken);
        let consoleToken = tokenValid ? configuredToken : loadOrCreateConsoleToken();
        // 令牌必须非空才继续。下面鉴权处原来的写法是「令牌为空 ⇒ return true（放行）」，
        // 注释写着"启动时已自动生成并持久化"—— 等于承认那一行不可达，可它是一条**失败开放**的分支：
        // 一旦真的空了（写盘异常被吞、以后新增"关闭鉴权"之类的配置），控制台上那些
        // 改配置 / 发消息 / 读聊天记录的接口会变成完全免鉴权，而 Host 白名单只挡跨机访问、
        // 挡不住本机进程。这里改成失败关闭：宁可启动时报错，也不要静默开着一个无鉴权的管理 API。
        if (!consoleToken)
            throw new Error('控制台令牌为空：拒绝以无鉴权方式启动控制台 API');
        if (!tokenValid && configuredToken)
            log(`控制台 config.consoleToken 长度/字符不合法，已忽略并回退到自动生成令牌`);
        if (!configuredToken)
            log('控制台未配置 consoleToken，已自动生成（完整值仅保存在 state/console-token）');
        // 二代会话级隔离：MCP 工具调用时若带 x-agent-token，则必须匹配该会话的 agentToken。
        // 控制台/管理端请求不带此头，仍走 consoleToken 管理通道。
        //
        // 定长比较：会话令牌同样是凭据，`===` 会在首个不同字符处短路，本机进程理论上
        // 可用响应时延逐字节试探。与控制台令牌（见下方 timingSafeEqual）保持一致。
        const tokenEq = (a, b) => {
            if (typeof a !== 'string' || typeof b !== 'string' || !a || !b)
                return false;
            const x = Buffer.from(a, 'utf8');
            const y = Buffer.from(b, 'utf8');
            return x.length === y.length && crypto.timingSafeEqual(x, y);
        };
        const agentTokenOk = (key, token) => {
            const canonical = canonicalV2Key(key);
            const st = socialV2.conversations.get((canonical ?? key));
            return !!st && !!st.agentToken && tokenEq(token, st.agentToken);
        };
        /**
         * 令牌是否匹配**任意**一个活跃二代会话。
         *
         * 用途是集中式纵深防御（见下方 x-agent-call 关卡）：各端点自己那套
         * `if (x-agent-token && !agentTokenOk(key, token))` 把关的是「这个令牌能不能动这个
         * 会话」；这里把关的是「这到底是不是一次智能体调用」。两层都需要，因为前者在
         * 端点漏写时会整个失效。
         */
        const isLiveAgentToken = (token) => {
            if (typeof token !== 'string' || !token)
                return false;
            for (const st of socialV2.conversations.values()) {
                if (st?.agentToken && tokenEq(token, st.agentToken))
                    return true;
            }
            return false;
        };
        // 二代会话工具必须仍命中当前模式的白名单/准入；避免白名单移除后旧 agentToken 继续读状态。
        const v2SessionAllowed = isSessionAllowedInCurrentMode;
        const access = createConsoleAccess({ getPort: () => server.address()?.port ?? port, getToken: () => consoleToken,
            getAgentPolicy: () => ({ paused: socialV2.paused, enabled: cfg.socialV2?.enabled, currentMode: modeCoordinator.state.currentMode }), isLiveAgentToken, isNativeFeatureRoute });
        // 读取实时绑定，保留跨await的模式、代次和恢复状态；不复制可变状态。
        const routeDependencies = { get wakeTimers() { return wakeTimers; },
            get acknowledgeMessagesV2() { return acknowledgeMessagesV2; },
            get ACTIVE_WAIT_LEASE_MS() { return ACTIVE_WAIT_LEASE_MS; },
            get activeWaits() { return activeWaits; },
            get agentTokenOk() { return agentTokenOk; },
            get allowed() { return allowed; },
            get api() { return api; },
            get appendActivity() { return appendActivity; },
            get applyStickerNoteV2() { return applyStickerNoteV2; },
            get assertGroupMember() { return assertGroupMember; },
            get atomicWriteJson() { return atomicWriteJson; },
            get atomicWriteText() { return atomicWriteText; },
            get avatarReader() { return avatarReader; },
            get bot() { return bot; },
            get buildSlangContext() { return buildSlangContext; },
            get buildStickerContext() { return buildStickerContext; },
            get buildStickerStrategyHint() { return buildStickerStrategyHint; },
            get cancelReplyCheckV2() { return cancelReplyCheckV2; },
            get canonicalV2Key() { return canonicalV2Key; },
            get captureSendGuard() { return captureSendGuard; },
            get cfg() { return cfg; },
            get cleanupSocialForModeChange() { return cleanupSocialForModeChange; },
            get clearAllPendingWakeLeases() { return clearAllPendingWakeLeases; },
            get clearAllSocialV2Timers() { return clearAllSocialV2Timers; },
            get clearTimeout() { return clearTimeout; },
            get closedAgentPreset() { return modeCoordinator.state.closedAgentPreset; }, set closedAgentPreset(value) { modeCoordinator.state.closedAgentPreset = value; },
            get collectors() { return collectors; },
            get collectStickerV2() { return collectStickerV2; },
            get computeGapsV2() { return computeGapsV2; },
            get computeWakeSafetyV2() { return computeWakeSafetyV2; },
            get confirmedSlangListV2() { return confirmedSlangListV2; },
            get consoleToken() { return consoleToken; }, set consoleToken(value) { consoleToken = value; },
            get crypto() { return crypto; },
            get currentMode() { return modeCoordinator.state.currentMode; }, set currentMode(value) { modeCoordinator.state.currentMode = value; },
            get currentRoleHint() { return currentRoleHint; },
            get currentRoleHintV2() { return currentRoleHintV2; },
            get describeAudio() { return describeAudio; },
            get drainAllPromptQueues() { return drainAllPromptQueues; },
            get dshReady() { return modeCoordinator.state.dshReady; },
            get ensureWakeableV2() { return ensureWakeableV2; },
            get escapeCqText() { return escapeCqText; },
            get fetchMediaData() { return fetchMediaData; },
            get findCjkSpaceWarning() { return findCjkSpaceWarning; },
            get findMessageMedia() { return findMessageMedia; },
            get findSplitBoundaryWarning() { return findSplitBoundaryWarning; },
            get forgetAgentToken() { return forgetAgentToken; },
            get formatForwardResponse() { return formatForwardResponse; },
            get formatMemoryV2() { return formatMemoryV2; },
            get formatParticipationV2() { return formatParticipationV2; },
            get formatStickerList() { return formatStickerList; },
            get fs() { return fs; },
            get gatewayHealthSnapshot() { return gatewayHealthSnapshot; },
            get getImageDimensions() { return getImageDimensions; },
            get getSocialV2State() { return getSocialV2State; },
            get getStickerImageData() { return getStickerImageData; },
            get hardenStateDirAcl() { return hardenStateDirAcl; },
            get idleAvailable() { return idleAvailable; },
            get idleDraftRunner() { return idleDraftRunner; },
            get imagePreferences() { return imagePreferences; },
            get inspectAudio() { return inspectAudio; },
            get isCurrentSession() { return isCurrentSession; },
            get isSleepingConfigV2() { return isSleepingConfigV2; },
            get lastForcedAgentStickerSync() { return stickerState.lastForcedAgentSyncAt; }, set lastForcedAgentStickerSync(value) { stickerState.lastForcedAgentSyncAt = value; },
            get lastMode() { return modeCoordinator.state.lastMode; }, set lastMode(value) { modeCoordinator.state.lastMode = value; },
            get listAudioFiles() { return listAudioFiles; },
            get log() { return log; },
            get looksLikeUnfinished() { return looksLikeUnfinished; },
            get manualDirCommand() { return manualDirCommand; },
            get markReadCalledKeys() { return markReadCalledKeys; },
            get MAX_MEDIA_BYTES() { return MAX_MEDIA_BYTES; },
            get MAX_MEDIA_PIXELS() { return MAX_MEDIA_PIXELS; },
            get mimeFromBuffer() { return mimeFromBuffer; },
            get mimeFromUrl() { return mimeFromUrl; },
            get modeAllowed() { return modeAllowed; },
            get nativeBinding() { return nativeBinding; },
            get nativeCapabilities() { return nativeCapabilities; },
            get nativeFeatureAccess() { return nativeFeatureAccess; },
            get nativeFeatureGrants() { return nativeFeatureGrants; },
            get nativeIdleLoop() { return nativeIdleLoop; },
            get nativeImageApi() { return nativeImageApi; },
            get nativeObservation() { return nativeObservation; },
            get nativePhone() { return nativePhone; },
            get nativePhoneModel() { return nativePhoneModel; },
            get nativePolicyCurrent() { return nativePolicyCurrent; },
            get nativePolicyGeneration() { return nativePolicyGeneration; },
            get nativeSinging() { return nativeSinging; },
            get nativeTurnFence() { return nativeTurnFence; },
            get nativeVoice() { return nativeVoice; },
            get normalizeModeInput() { return normalizeModeInput; },
            get normalizeSpeakerIdsV2() { return normalizeSpeakerIdsV2; },
            get noteModelMessagesV2() { return noteModelMessagesV2; },
            get observationThroughSeqV2() { return observationThroughSeqV2; },
            get onebotHttpAction() { return onebotHttpAction; },
            get parseTargetKey() { return parseTargetKey; },
            get path() { return path; },
            get pendingSendToolCalls() { return pendingSendToolCalls; },
            get pendingWakeKeys() { return pendingWakeKeys; },
            get phonePageState() { return phonePageState; },
            get phoneRecoveryId() { return phoneRecoveryId; }, set phoneRecoveryId(value) { phoneRecoveryId = value; },
            get phoneRecoveryPhase() { return phoneRecoveryPhase; }, set phoneRecoveryPhase(value) { phoneRecoveryPhase = value; },
            get phoneRecoveryTask() { return phoneRecoveryTask; }, set phoneRecoveryTask(value) { phoneRecoveryTask = value; },
            get pickWakeTriggersV2() { return pickWakeTriggersV2; },
            get prepareSelfAvatarSend() { return prepareSelfAvatarSend; },
            get preSleepWaitBlockedV2() { return preSleepWaitBlockedV2; },
            get process() { return process; },
            get queryModelCatalog() { return queryModelCatalog; },
            get queryQQStatus() { return queryQQStatus; },
            get readActivityTail() { return readActivityTail; },
            get readConfigObject() { return readConfigObject; },
            get readJsonSafe() { return readJsonSafe; },
            get readRoleState() { return readRoleState; },
            get readThroughSeqV2() { return readThroughSeqV2; },
            get reconcileSessionPolicies() { return reconcileSessionPolicies; },
            get recordSentMessagesV2() { return recordSentMessagesV2; },
            get redactKnownTokensOnly() { return redactKnownTokensOnly; },
            get releaseLock() { return releaseLock; },
            get replyTimingV2() { return replyTimingV2; },
            get requestedReadThroughSeqV2() { return requestedReadThroughSeqV2; },
            get resolveAudioProcessing() { return resolveAudioProcessing; },
            get resolveReplyInfo() { return resolveReplyInfo; },
            get resolveReplyTargetV2() { return resolveReplyTargetV2; },
            get resolveVoicePathForOperator() { return resolveVoicePathForOperator; },
            get resolveVoicePathForV2() { return resolveVoicePathForV2; },
            get reverse() { return reverse; },
            get ROOT() { return ROOT; },
            get safeFetchBuffer() { return safeFetchBuffer; },
            get saveSocialV2State() { return saveSocialV2State; },
            get saveState() { return saveState; },
            get scheduleProactiveCheckV2() { return scheduleProactiveCheckV2; },
            get scheduleReplyCheckV2() { return scheduleReplyCheckV2; },
            get seenForwardIds() { return seenForwardIds; },
            get selfDisplayName() { return selfDisplayName; },
            get selfIdentityTextV2() { return selfIdentityTextV2; },
            get selfUserId() { return selfUserId; },
            get sendMessagesV2() { return sendMessagesV2; },
            get sendStickerV2() { return sendStickerV2; },
            get sendToolSucceededSessions() { return sendToolSucceededSessions; },
            get sendVoiceForV2() { return sendVoiceForV2; },
            get sendVoiceV2() { return sendVoiceV2; },
            get sendWakePromptV2() { return sendWakePromptV2; },
            get SENSITIVE_RE() { return SENSITIVE_RE; },
            get sessionEpoch() { return sessionEpoch; }, set sessionEpoch(value) { sessionEpoch = value; },
            get sessionModelManager() { return sessionModelManager; },
            get sessionCreation() { return sessionCreation; },
            get setStickerRemarkV2() { return setStickerRemarkV2; },
            get setTimeout() { return setTimeout; },
            get setupSleepTimerV2() { return setupSleepTimerV2; },
            get shouldBlockSilentReply() { return shouldBlockSilentReply; },
            get singingError() { return singingError; },
            get slangEntries() { return slangEntries; },
            get sleep() { return sleep; },
            get SOCIAL_V2_FILE() { return SOCIAL_V2_FILE; },
            get socialV2() { return socialV2; },
            get state() { return state; },
            get STATE_DIR() { return STATE_DIR; },
            get stateDirHardened() { return stateDirHardened; }, set stateDirHardened(value) { stateDirHardened = value; },
            get stickerEnabled() { return stickerEnabled; },
            get stickerEntries() { return stickerState.entries; },
            get stickerSyncedAt() { return stickerState.syncedAt; },
            get stopRetiredSessionWork() { return stopRetiredSessionWork; },
            get suggestQuietMsV2() { return suggestQuietMsV2; },
            get syncStickerLibrary() { return syncStickerLibrary; },
            get text() { return text; },
            get toModelMedia() { return toModelMedia; },
            get toolCallNames() { return toolCallNames; },
            get truncateText() { return truncateText; },
            get turnLeaseNoted() { return turnLeaseNoted; },
            get unquoteJsonString() { return unquoteJsonString; },
            get unwrap() { return unwrap; },
            get usageObserver() { return usageObserver; },
            get v2SessionAllowed() { return v2SessionAllowed; },
            get v2ToolEnabled() { return v2ToolEnabled; },
            get v2TurnStartAt() { return v2TurnStartAt; },
            get VALID_MODES() { return VALID_MODES; },
            get verifyVoiceMessageSent() { return verifyVoiceMessageSent; },
            get voiceBudgetCheck() { return voiceBudgetCheck; },
            get voiceBudgetCommit() { return voiceBudgetCommit; },
            get voiceCfg() { return voiceCfg; },
            get voiceLibrary() { return voiceLibrary; },
            get wakeConfigMissCount() { return wakeConfigMissCount; },
            get wakeConfigUpdatedKeys() { return wakeConfigUpdatedKeys; } };
        const remainingConsoleRoutes = createRemainingConsoleRoutes(routeDependencies);
        const server = http.createServer(async (req, res) => {
            const request = createConsoleRequest(req, res, { port });
            if (!request)
                return;
            const { url, SECURITY_HEADERS, sendJson, readBody, sendError } = request;
            if (!access.allowRequest(req, res, request))
                return;
            try {
                if (!access.allowAgentRequest(req, request))
                    return;
                // 只读降级：黑话库/表情库在启动时加载失败时，写接口必须**明确失败**。
                // 旧行为是 save 函数里只打一行日志就 return，而接口照样回 {ok:true}：
                // 控制台显示"✅ 已保存"，实际只改在内存里，重启后全部消失。
                if (req.method !== 'GET') {
                    // 管理接口的只读检查随模块维护；会话工具仍在此处拦截。
                    const readonlyStore = (!stickerState.writable && ['/api/socialV2/sticker-note', '/api/socialV2/sticker-remark', '/api/socialV2/collect-sticker'].includes(url.pathname)) ? '表情库' : '';
                    if (readonlyStore) {
                        sendJson({ ok: false, error: `${readonlyStore}处于只读降级状态（启动时加载失败，未覆盖原文件），本次修改不会落盘；请修复 state/ 下的对应文件后重启桥接` }, 503);
                        return;
                    }
                }
                if (req.method === 'GET' && url.pathname === '/') {
                    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
                    try {
                        res.end(fs.readFileSync(path.join(ROOT, 'public', 'console.html'), 'utf8'));
                    }
                    catch {
                        res.end('控制台页面缺失：qq-bridge/public/console.html');
                    }
                    return;
                }
                if (nativeFeatureRoutes && await nativeFeatureRoutes({ req, res, url, readBody, sendJson }))
                    return;
                if (remainingConsoleRoutes.matchSingingPrefix.matches(req, url)) {
                    await remainingConsoleRoutes.matchSingingPrefix.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postImagesAvatar.matches(req, url)) {
                    await remainingConsoleRoutes.postImagesAvatar.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.matchImageGenerationPrefix.matches(req, url)) {
                    await remainingConsoleRoutes.matchImageGenerationPrefix.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getStatus.matches(req, url)) {
                    await remainingConsoleRoutes.getStatus.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getPresets.matches(req, url)) {
                    await remainingConsoleRoutes.getPresets.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postMode.matches(req, url)) {
                    await remainingConsoleRoutes.postMode.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.matchPhonePrefix.matches(req, url)) {
                    await remainingConsoleRoutes.matchPhonePrefix.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.matchVoicePrefix.matches(req, url)) {
                    await remainingConsoleRoutes.matchVoicePrefix.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (await handleRoleRoute({ method: req.method, url, readBody, sendJson }))
                    return;
                if (await handlePresetRoute({ method: req.method, url, readBody, sendJson }))
                    return;
                if (await handleSlangRoute({ req, url, readBody, sendJson }))
                    return;
                if (await handleSessionAdminRoute({ req, url, readBody, sendJson }))
                    return;
                if (await handleSettingsRoute({ method: req.method, url, readBody, sendJson }))
                    return;
                if (remainingConsoleRoutes.getDshModel.matches(req, url)) {
                    await remainingConsoleRoutes.getDshModel.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 安全拦截通知设置 ─────────────────────────────────────────────────
                if (remainingConsoleRoutes.getSecurity.matches(req, url)) {
                    await remainingConsoleRoutes.getSecurity.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSecurity.matches(req, url)) {
                    await remainingConsoleRoutes.postSecurity.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 控制台访问令牌（可手动修改/生成随机） ─────────────────────────────
                if (remainingConsoleRoutes.postConsoleToken.matches(req, url)) {
                    await remainingConsoleRoutes.postConsoleToken.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 测试发送消息（强制走白名单校验） ───────────────────────────────────
                if (await handleLegacySocialRoute({ req, url, readBody, sendJson }))
                    return;
                if (await handleOperatorNotice({ req, url, readBody, sendJson }))
                    return;
                // ── 二代仿真模式（reserved2）内部 Agent API ─────────────────────────
                if (await handleSocialSettingsRoute({ req, url, readBody, sendJson }))
                    return;
                if (remainingConsoleRoutes.postSocialV2Reset.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2Reset.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2State.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2State.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2Prompt.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2Prompt.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2Unread.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2Unread.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2Recent.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2Recent.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2MarkRead.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2MarkRead.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2WakeConfig.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2WakeConfig.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2States.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2States.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2Wake.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2Wake.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // 操作者预写的「会话初始提示词」：控制台专用（AI 既读不到也改不了 —— adminOnlyV2Paths）。
                // 内容只在该会话**首次唤醒**（bootstrap）时注入一次，见 buildWakePromptV2。
                if (await handleInitialPromptRoute({ method: req.method, url, readBody, sendJson }))
                    return;
                if (remainingConsoleRoutes.postSocialV2SendBurst.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2SendBurst.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2SendMessage.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2SendMessage.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2SendPoke.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2SendPoke.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 表情包体系（reserved2） ──────────────────────────────────────
                if (remainingConsoleRoutes.getSocialV2StickerImage.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2StickerImage.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2SelfImage.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2SelfImage.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2StickerNote.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2StickerNote.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2StickerRemark.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2StickerRemark.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 语音发送（操作者通道：CLI / 控制台，凭 consoleToken） ──────────────
                //
                // 与 /api/send/* 的 agent 通道分开：操作者可能不在任何 QQ 会话里，
                // 所以不套「会话/模式」闸门，但白名单 + 语音限流 + 文件名审计一个都不少。
                if (remainingConsoleRoutes.postVoiceSend.matches(req, url)) {
                    await remainingConsoleRoutes.postVoiceSend.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 语音发送（AI 通道：reserved2 + agent token，只能发自己那个会话） ────
                if (remainingConsoleRoutes.postSocialV2SendVoice.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2SendVoice.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2SendSticker.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2SendSticker.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2CollectSticker.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2CollectSticker.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // 语音库列表。两条通道共用：
                //   - 带 agent token（AI 的 qq_list_voices）→ 必须带 key，校验会话白名单/工具开关；
                //   - 不带 agent token（控制台调试面板 / CLI）→ 只需控制台令牌，不需要 key。
                // 返回一律只有文件名/大小/时长，**不含绝对路径**（AI 侧防路径外泄，控制台侧由试发接口解析）。
                if (remainingConsoleRoutes.getSocialV2Voices.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2Voices.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2StickerList.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2StickerList.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2StickerList.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2StickerList.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (await handleStickerRoute({ req, url, readBody, sendJson }))
                    return;
                if (remainingConsoleRoutes.postSocialV2Wait.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2Wait.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2CheckSend.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2CheckSend.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── Token 用量 / 花费（控制台专用） ──────────────────────────────────
                // 路径刻意不放在 /api/socialV2/ 下：那一整个前缀对持有 x-agent-token 的
                // QQ 侧 AI 是放行的（见上方 agentAllowed 白名单），而跨群花费属于管理信息，
                // 不应让某个群里的 AI 读到别的群烧了多少钱。这里再显式拒绝一次做双保险。
                if (await handleTokenRoute({ req, url, sendJson }))
                    return;
                if (await handleFeedbackRoute({ req, url, readBody, sendJson }))
                    return;
                if (remainingConsoleRoutes.getSocialV2MyRecent.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2MyRecent.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2RecordSent.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2RecordSent.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2MessageDetail.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2MessageDetail.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 合并转发消息查询端点（MCP qq_get_forward_msg 走这里） ────────────
                if (remainingConsoleRoutes.getSocialV2ForwardMessage.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2ForwardMessage.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.postSocialV2ForwardMedia.matches(req, url)) {
                    await remainingConsoleRoutes.postSocialV2ForwardMedia.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (remainingConsoleRoutes.getSocialV2ActiveMembers.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2ActiveMembers.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 群成员列表（v2 读工具；替代只有 closed-agent 才能用的旧只读工具）────────
                //
                // 为什么需要这一条：qq-chat-v2 预设第 6 条明确要求「QQ 号从 qq_get_group_members 的
                // user_id 拿」，但旧版是无令牌工具、在 reserved2 下必然 403 —— 模型被自己的提示词
                // 引到一个永远失败的工具上（实测 turn10 白烧一步）。这里给它一个带会话令牌的 v2 形态。
                if (remainingConsoleRoutes.getSocialV2GroupMembers.matches(req, url)) {
                    await remainingConsoleRoutes.getSocialV2GroupMembers.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                if (await handleMemoryRoute({ req, url, readBody, sendJson }))
                    return;
                if (await handleSlangAgentRoute({ req, url, readBody, sendJson }))
                    return;
                if (remainingConsoleRoutes.postAuthorizeRead.matches(req, url)) {
                    await remainingConsoleRoutes.postAuthorizeRead.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 图片/表情查询端点（MCP qq_get_message_images 走这里） ────────────
                if (remainingConsoleRoutes.getImagesMessage.matches(req, url)) {
                    await remainingConsoleRoutes.getImagesMessage.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 统一发送端点（MCP 旧发送工具也走这里） ───────────────────────────
                if (remainingConsoleRoutes.postSendGroup.matches(req, url)) {
                    await remainingConsoleRoutes.postSendGroup.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                // ── 重启桥接（守护模式下 5 秒后自动拉起） ──────────────────────────────
                if (remainingConsoleRoutes.postRestart.matches(req, url)) {
                    await remainingConsoleRoutes.postRestart.handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS });
                    return;
                }
                sendJson({ ok: false, error: 'not found' }, 404);
            }
            catch (error) {
                sendError(error);
            }
        });
        server.listen(port, '127.0.0.1', () => {
            log(`本地控制台已启动：http://127.0.0.1:${port}`);
        });
        // 端口被占用说明已有实例在跑：以 exit 2 退出，守护脚本会识别为"已有实例"而不是无限重启
        server.on('error', (error) => {
            log(`控制台服务错误: ${error?.message ?? error}`);
            if (error?.code === 'EADDRINUSE') {
                console.error(`[bridge] 控制台端口 ${port} 已被占用（可能已有实例在运行），退出。`);
                process.exit(2);
            }
            process.exit(1);
        });
        return server;
    }
    // 会话代际：reset/清空工作区时递增，防止在途 ensureSession 把旧会话"复活"
    let sessionEpoch = 0;
    // 待应答的提问/审批：convKey -> pending
    const pending = pendingRequests; // 状态与定时器归pendingRequests持有
    // QQ 发送队列（顺序发送 + 间隔，避免触发频率限制）
    const sendQueue = createSendQueue({ sleep, getNativeDelay: () => Math.max(3000, cfg.sendDelayMs) });
    function redactKnownTokensOnly(...args) { return (0, tokenRegistry.redactKnownTokensOnly)(...args); }
    // 最近一次发送是否全部成功（按 key）。调用方据此决定要不要刷新「我发过言了」的时间戳 ——
    // 旧实现把发送失败吞成一行日志后**照常 resolve**，于是调用方以为发言成功，
    // 更新 lastAiReplyAt / 活跃调度，实际群里什么都没收到，而且只有一行滚动日志能看出问题。
    const { sendToQQ, lastSendSucceeded, lastSendFailed, nativeReplyQueue, enqueueNativeSend, nativeSendBatches } = createReplySender({
        sendQueue, nativeBinding, getTransport: () => ({ nativeVoice, bot }), cfg, captureSendGuard, redactKnownTokensOnly, splitForQQ, text, escapeCqText,
        withTimeout, SEND_TIMEOUT_MS, sleep, log
    });
    if (nativeReplyQueue)
        process.once('exit', () => nativeReplyQueue.close());
    // ── 真人式分条发送 ──────────────────────────────────────────────────────
    // 分条发送：与 sendToQQ 共用同一发送队列，严格顺序；条间随机间隔，
    // 有概率使用长间隔（错落感）；最后一条后不再 sleep。
    const { sendBurstToQQ, sendMessagesV2 } = createBurstSender({
        getTransport: () => ({ bot, nativeBinding, nativeReplyQueue }), sendQueue, lastSendFailed, onebotSend, captureSendGuard,
        redactKnownTokensOnly, text, escapeCqText, withTimeout, SEND_TIMEOUT_MS, randInt: (min, max) => randInt(min, max), sleep, log
    });
    const onebotSender = createOnebotSender({
        get KNOWN_AGENT_TOKENS() { return KNOWN_AGENT_TOKENS; },
        get log() { return log; },
        get escapeCqText() { return escapeCqText; },
        get nativeBinding() { return nativeBinding; },
        get bot() { return bot; },
        get cfg() { return cfg; },
        get fetch() { return fetch; },
        get AbortSignal() { return AbortSignal; }
    });
    function onebotSend(...args) { return (0, onebotSender.onebotSend)(...args); }
    // ── 图片/表情字节解析（供一代自动内联与二代按需工具） ────────────────────
    const imageTools = createImageTools({
        get looksLikeImageBuffer() { return looksLikeImageBuffer; },
        get MAX_MEDIA_PIXELS() { return MAX_MEDIA_PIXELS; },
        get log() { return log; }
    });
    const mediaPipeline = createMediaPipeline({
        get traceNativeReceive() { return traceNativeReceive; },
        get normalizeImageForModel() { return normalizeImageForModel; },
        get modelMediaLimits() { return modelMediaLimits; },
        get log() { return log; },
        get fs() { return fs; },
        get cfg() { return cfg; },
        get path() { return path; },
        get emojiIdFromFileName() { return emojiIdFromFileName; },
        get emojiCdnCandidates() { return emojiCdnCandidates; },
        get safeFetchBuffer() { return safeFetchBuffer; },
        get MAX_MEDIA_BYTES() { return MAX_MEDIA_BYTES; },
        get acceptImageBuffer() { return acceptImageBuffer; },
        get mimeFromUrl() { return mimeFromUrl; },
        get base64FromMaybe() { return base64FromMaybe; },
        get isProbablySafeImageFileRef() { return isProbablySafeImageFileRef; },
        get bot() { return bot; },
        get Buffer() { return Buffer; },
        get Math() { return Math; },
        get MAX_MEDIA_COUNT() { return MAX_MEDIA_COUNT; }
    });
    function mimeFromBuffer(...args) { return (0, imageTools.mimeFromBuffer)(...args); }
    function mimeFromUrl(...args) { return (0, imageTools.mimeFromUrl)(...args); }
    // 解析常见图片宽高（PNG/JPEG/GIF；WebP 暂不解析返回 null）。
    // 用于限制“图片炸弹”的解码像素量。
    function getImageDimensions(...args) { return (0, imageTools.getImageDimensions)(...args); }
    function base64FromMaybe(...args) { return (0, imageTools.base64FromMaybe)(...args); }
    // 媒体上限（config.json 可调，但必须收敛到安全区间）：
    //   maxBytes  —— 单条消息里图片/表情的总字节上限。8MB 能覆盖绝大多数动图表情；
    //                太大会让 base64 常驻内存（×1.33）并拖慢 DSH 上传。
    //   maxPixels —— 单张图解码像素上限（防图片炸弹），与 DSH 的 64MP 默认一致。
    //   maxCount  —— 单条消息最多处理几张（防止一次 @ 带 20 张图把模型上下文撑爆）。
    const maxMediaBytesLimit = (() => {
        const n = Number(cfg.socialV2?.media?.maxBytes);
        return Number.isFinite(n) && n > 0 ? Math.min(20 * 1024 * 1024, Math.max(256 * 1024, Math.round(n))) : 8 * 1024 * 1024;
    })();
    const MAX_MEDIA_COUNT = (() => {
        const n = Number(cfg.socialV2?.media?.maxCount);
        return Number.isFinite(n) && n > 0 ? Math.min(8, Math.max(1, Math.round(n))) : 5;
    })();
    const MAX_MEDIA_BYTES = maxMediaBytesLimit; // 单条消息图片总字节上限
    const MAX_MEDIA_PIXELS = (() => {
        const n = Number(cfg.socialV2?.media?.maxPixels);
        return Number.isFinite(n) && n > 0 ? Math.min(64_000_000, Math.max(1_000_000, Math.round(n))) : 64_000_000;
    })(); // 单张图片像素上限，防止“图片炸弹”解码拖垮 DSH
    const MAX_MEDIA_STORE_PER_KEY = 500; // 每个会话最多缓存多少条消息的媒体元数据，防止无限增长
    // ── 喂给模型的那一份：体积与动图形态归一化 ────────────────────────────────
    //
    // 为什么必须在这里动手（而不是"让 DSH 自己处理"）：
    //   ① DSH 的 MCP 图片入口用正则校验 base64，实测量级 ≥4,474,880 字符（原始字节 ≥3.20 MiB）
    //      必抛 RangeError: Maximum call stack size exceeded，工具结果被降级成
    //      `[image unavailable: image/gif; Maximum call stack size exceeded; …]` —— 模型只看到一行错误。
    //      而下面的 MAX_MEDIA_BYTES 是**抓取**上限（默认 8 MiB），故意留着不动：
    //      得先把大图抓下来，才有机会压小它。
    //   ② DSH 对 image/gif 一律归一化成单帧，模型永远只看第一帧，且不知道那是动图。
    //      动图在桥接侧抽帧拼图后，信息量反而更高（实测 4.83MB/200 帧 → 92KB/269ms）。
    //
    // 上限默认值见 media-normalize.js 的 MEDIA_DEFAULTS；config.json 的 socialV2.media 可覆盖。
    // ⚠️ 只用于**喂模型**的出口。collectStickerV2 走 fetchOneBotImage 的原始字节，不能经过这里，
    //    否则收藏下来的表情会变成拼图/降采样版本。
    const modelMediaLimits = (() => {
        const m = cfg.socialV2?.media ?? {};
        return {
            enabled: m.normalize !== false,
            maxModelBytes: m.maxModelBytes,
            maxLongEdge: m.maxLongEdge,
            gifFrames: m.gifFrames,
            gifTile: m.gifTile,
            timeoutMs: m.normalizeTimeoutMs,
            ffmpegPath: process.env.FFMPEG_PATH || cfg.socialV2?.voice?.ffmpegPath || null
        };
    })();
    /**
     * 把一张已抓到的图片整理成模型可安全消费的形态。
     * @returns {Promise<{ok:boolean, buffer?:Buffer, mimeType?:string, note?:string, error?:string}>}
     *          ok=false 表示"压不到可用体积"——调用方必须把它变成一句可读的失败原因，
     *          绝不发注定被 DSH 丢掉的字节（那样模型只会看到看不懂的英文错误）。
     */
    function toModelMedia(...args) { return (0, mediaPipeline.toModelMedia)(...args); }
    function isSafeLocalMediaPath(...args) { return (0, mediaPipeline.isSafeLocalMediaPath)(...args); }
    // OneBot 图片 file 字段只应接受简单缓存文件名；拒绝路径、URL、盘符、协议前缀等，
    // 防止把任意本地路径/内网 URL 交给网关 get_image 造成 SSRF/任意文件读取。
    function isProbablySafeImageFileRef(...args) { return (0, imageTools.isProbablySafeImageFileRef)(...args); }
    // QQ 表情包 CDN 的地址可以只靠 emoji_id 推出来（实测形态：
    // https://gxh.vip.qq.com/club/item/parcel/item/<id 前两位>/<id>/raw300.gif）。
    // 市场表情不在网关缓存里（get_image 返回 image not found in cache），url 又可能缺失，
    // 这条兜底能救回这一类；只接受纯十六进制 id，绝不把任意字符串拼进 URL。
    function emojiCdnCandidates(...args) { return (0, imageTools.emojiCdnCandidates)(...args); }
    // 有些网关不带 emoji_id，但 file 名里就嵌着它（实测 "f9-<32 位 hex>.gif"）。
    function emojiIdFromFileName(...args) { return (0, imageTools.emojiIdFromFileName)(...args); }
    /** 校验一张图片字节：格式、大小（调用方已限）、像素上限；不通过返回 null。 */
    function acceptImageBuffer(...args) { return (0, imageTools.acceptImageBuffer)(...args); }
    function fetchOneBotImage(...args) { return (0, mediaPipeline.fetchOneBotImage)(...args); }
    function fetchFaceMedia(...args) { return (0, mediaPipeline.fetchFaceMedia)(...args); }
    function resolveMediaList(...args) { return (0, mediaPipeline.resolveMediaList)(...args); }
    function fetchMediaData(...args) { return (0, mediaPipeline.fetchMediaData)(...args); }
    function mediaHintFor(...args) { return (0, mediaContext.mediaHintFor)(...args); }
    // 功能缓存不依赖谁能触发模型；管理员模式也只缓存已授权、已观察消息的媒体元数据。
    function rememberNativeIncomingFeatureMetadata(...args) { return (0, mediaContext.rememberNativeIncomingFeatureMetadata)(...args); }
    function rememberNativeForwardResult(...args) { return (0, mediaContext.rememberNativeForwardResult)(...args); }
    function findMessageMedia(...args) { return (0, mediaContext.findMessageMedia)(...args); }
    const { computeGapsV2 } = createGapPlanner({ randInt: (min, max) => randInt(min, max) });
    const sessionModelManager = createSessionModels({ getConfiguration: () => cfg.dsh,
        selectModel: request => api.sessions.selectModel(request), unwrap, sleep, log });
    const ensureChatModel = sessionModelManager.ensure;
    // ── 仿真群友社交引擎（仿真模式，内部标识 reserved） ────────────────────────
    const randInt = (min, max) => {
        if (min > max)
            [min, max] = [max, min];
        return Math.floor(min + Math.random() * (max - min + 1));
    };
    let selfNickname = 'deepseek'; // 机器人昵称（小写；启动时从网关获取，识别"被提到"用）
    // 给 agent 看的身份（保留原始大小写）与机器人自己的 QQ 号。
    // 为什么必须单独存：消息里只有 "@樰" 这一串文本，agent 没有任何途径知道"樰"就是它自己，
    // 于是会把 @自己 当成 @别人、已读不回（issue #29）。昵称与 QQ 号要显式写进 prompt。
    let selfDisplayName = '';
    let selfUserId = '';
    const SILENT_TURN_TIMEOUT_MS = 300000; // 摘要静默名额 5 分钟未消费则作废，避免吞掉后续正常回复
    const legacyEngine = createLegacySocialEngine({
        get currentMode() { return modeCoordinator.state.currentMode; },
        get cfg() { return cfg; },
        get Date() { return Date; },
        get Math() { return Math; },
        get randInt() { return randInt; },
        get clearTimeout() { return clearTimeout; },
        get messageMediaStore() { return messageMediaStore; },
        get promptQueue() { return promptQueue; },
        get currentRoleHint() { return currentRoleHint; },
        get buildActiveExitPrompt() { return buildActiveExitPrompt; },
        get log() { return log; },
        get setTimeout() { return setTimeout; },
        get deliverPrompt() { return deliverPrompt; },
        get nativeBinding() { return nativeBinding; },
        get buildProactivePrompt() { return buildProactivePrompt; },
        get isMustReplyText() { return isMustReplyText; },
        get appendSummary() { return appendSummary; },
        get buildBatchPrompt() { return buildBatchPrompt; },
        get buildProbePrompt() { return buildProbePrompt; },
        get state() { return state; },
        get clearInterval() { return clearInterval; },
        get setInterval() { return setInterval; },
        get mediaHintFor() { return mediaHintFor; },
        get ensureSession() { return ensureSession; },
        get buildContextBlock() { return buildContextBlock; }
    });
    const social = legacyEngine.state;
    const legacyContext = createLegacyContext({
        get selfNickname() { return selfNickname; },
        get cfg() { return cfg; },
        get social() { return social; },
        get truncateText() { return truncateText; },
        get Date() { return Date; },
        get mediaHintFor() { return mediaHintFor; },
        get DIRECTION_HINT() { return DIRECTION_HINT; },
        get SPACE_SPLIT_HINT() { return SPACE_SPLIT_HINT; },
        get SILENT_MARKER() { return SILENT_MARKER; }
    });
    // ── 二代仿真模式（reserved2）运行时状态与唤醒配置 ────────────────────────
    const socialV2 = v2StateStore.state;
    // 一代/普通模式的图片/表情元数据存储：key -> Map<messageId/seq, media[]>
    // 二代模式则直接存在 socialV2 会话的 recentMessages/unread 消息对象上。
    const messageMediaStore = mediaContext.messageMediaStore;
    // 二代会话见过的 forward id（有界，避免 recentMessages 滚动淘汰后无法读取刚见过的转发）
    const seenForwardIds = mediaContext.seenForwardIds;
    // ── 二代仿真：操作者预写的「初始提示词」（每个会话一份，只在首次唤醒时注入） ──────
    //
    // 用途：让操作者在控制台提前告诉 AI「这个群是什么圈子、什么氛围、有什么忌讳」。
    // 为什么单独一个文件、而不是塞进 social-v2.json 的会话状态：
    //   · 会话状态会被 /api/session/reset 与 /api/socialV2/reset 整体删除，而这份是操作者
    //     手写的配置 —— 重置一次 AI 上下文不该把它一起清掉；
    //   · 控制台需要能在群还没说过话（连会话状态都还不存在）时就写好。
    // 为什么只在首次唤醒（bootstrap）注入：这是一份「接入这个群时的背景介绍」，每轮都塞
    // 既白烧 token，又会让 AI 把它当成新指令；首次唤醒后它已在 DSH 会话上下文里。
    const initialPromptStore = createInitialPromptStore({ file: INITIAL_PROMPTS_FILE, canonicalKey: canonicalV2Key,
        getLimit: () => cfg.socialV2?.initialPromptMaxChars, atomicWriteJson, truncateText, log, clock: () => Date.now() });
    const { getInitialPrompt, setInitialPrompt, loadInitialPrompts, formatInitialPromptV2, initialPromptMaxChars } = initialPromptStore;
    loadSocialV2State();
    // 操作者预写的会话初始提示词（与控制台入口同样在 main() 里；损坏时只读降级，不阻塞启动）。
    loadInitialPrompts();
    function isSocialEnabled(...args) { return (0, legacyEngine.isSocialEnabled)(...args); }
    function socialState(...args) { return (0, legacyEngine.socialState)(...args); }
    // 启动阶段的"明确与 AI 有关"：@ / 提到名字 / 必回关键词 / 管理员私聊
    function isDirectAddress(...args) { return (0, legacyContext.isDirectAddress)(...args); }
    // 是否"直接针对 AI"的提问/挑战：提到 AI 相关词且带疑问/比较，或对"你"开火，或追问催促
    function isDirectedAtAi(...args) { return (0, legacyContext.isDirectedAtAi)(...args); }
    // 活跃期批量检测用的"必须回"判断：不依赖 event，只认昵称/关键词/直接针对 AI 的提问
    function isMustReplyText(...args) { return (0, legacyContext.isMustReplyText)(...args); }
    function appendRecentMessage(...args) { return (0, legacyContext.appendRecentMessage)(...args); }
    function appendSummary(...args) { return (0, legacyContext.appendSummary)(...args); }
    function buildContextBlock(...args) { return (0, legacyContext.buildContextBlock)(...args); }
    // 触发进入活跃（启动阶段 → 活跃阶段）
    function enterActive(...args) { return (0, legacyEngine.enterActive)(...args); }
    function cancelSocialTimers(...args) { return (0, legacyEngine.cancelSocialTimers)(...args); }
    function cancelAllSocialTimers(...args) { return (0, legacyEngine.cancelAllSocialTimers)(...args); }
    // 离开仿真模式时清理全部社交运行时状态，避免旧定时器/状态残留。
    function cleanupSocialForModeChange(...args) { return (0, legacyEngine.cleanupSocialForModeChange)(...args); }
    function leaveActive(...args) { return (0, legacyEngine.leaveActive)(...args); }
    // 活跃阶段：只贴"没给过 AI 的新消息"（上下文在会话历史里，不重复贴，不贴人格）
    // allowSilent=false 表示这条必须回（被 @/点名/私聊等），不提供 [SILENT] 出口。
    function buildBatchPrompt(...args) { return (0, legacyContext.buildBatchPrompt)(...args); }
    // 冷场试探：让 AI 基于会话自然说一句（只给状态背景，不注入"试探"意图）
    function buildProbePrompt(...args) { return (0, legacyContext.buildProbePrompt)(...args); }
    // 活跃超时退场：让 AI 自然地说一句收尾/潜水话，说完后安静下来。
    // 只给“该收尾了”的暗示，不暴露桥接的计时机制。
    function buildActiveExitPrompt(...args) { return (0, legacyContext.buildActiveExitPrompt)(...args); }
    // 活跃超时判定：到达进入活跃时随机出的最长时间后，安排一次“收尾退场”投递，
    // 并把状态切到 exiting（退场中），等待 AI 的退场发言完成后再回到观望。
    function triggerActiveDurationExit(...args) { return (0, legacyEngine.triggerActiveDurationExit)(...args); }
    // 二期：观望阶段主动开话题（第三种触发）
    function buildProactivePrompt(...args) { return (0, legacyContext.buildProactivePrompt)(...args); }
    // 实际投递由独立调度器处理，串行顺序由promptQueue管理。
    function scheduleSocialReply(...args) { return (0, legacyEngine.scheduleSocialReply)(...args); }
    // 全局扫描：驱动观望期主动开话题、活跃期检测、冷场处理、试探回退
    function socialLoopTick(...args) { return (0, legacyEngine.socialLoopTick)(...args); }
    function startSocialLoop(...args) { return (0, legacyEngine.startSocialLoop)(...args); }
    function flushSummaries(...args) { return (0, legacyEngine.flushSummaries)(...args); }
    // 旧写法是 `isSocialEnabled() || cfg.social?.enabled !== false` —— 恒等于右边那一项
    // （isSocialEnabled() 本身就蕴含 cfg.social?.enabled !== false，左侧永远不可能单独为真），
    // 留着只会让人误以为"reserved 模式下才启动循环"。这里启动的只是一个 5 秒心跳，
    // 每跳自己会用 isSocialEnabled() 判断当前模式（见 socialLoopTick 第一行）；
    // 真正决定启不启动的只有配置里的显式关闭开关。
    if (cfg.social?.enabled !== false) {
        startSocialLoop();
    }
    // 当前角色扮演提示：读 state/current-role.json + roles/<角色>.md，
    // 由桥接注入到 QQ 群消息（群友无法通过对话修改，只能由管理端写该文件）。
    // 缓存 key 为两个文件的 mtime，mtime 未变时直接返回，避免每次同步读文件。
    const rolePrompts = createRolePromptContext({
        get readRoleState() { return readRoleState; },
        get sanitizeRoleName() { return sanitizeRoleName; },
        get path() { return path; },
        get ROLES_DIR() { return ROLES_DIR; },
        get fs() { return fs; },
        get ROLE_STATE_FILE() { return ROLE_STATE_FILE; },
        get renderRoleInjection() { return renderRoleInjection; },
        get roleStore() { return roleStore; }
    });
    function roleRawContent(...args) { return (0, rolePrompts.roleRawContent)(...args); }
    function currentRoleHint(...args) { return (0, rolePrompts.currentRoleHint)(...args); }
    const outputWarnings = createOutputWarnings({
        get isCjkLikeChar() { return isCjkLikeChar; }
    });
    function findCjkSpaceWarning(...args) { return (0, outputWarnings.findCjkSpaceWarning)(...args); }
    function findSplitBoundaryWarning(...args) { return (0, outputWarnings.findSplitBoundaryWarning)(...args); }
    function currentRoleHintV2(...args) { return (0, rolePrompts.currentRoleHintV2)(...args); }
    // QQ 群成员名片/昵称缓存：@ 段解析用，避免每条消息都调一次 OneBot API。
    const groupMembers = createGroupMembers({
        get Date() { return Date; },
        get bot() { return bot; }
    }); // `groupId:userId` -> { name, ts }
    function pruneGroupMemberNameCache(...args) { return (0, groupMembers.pruneGroupMemberNameCache)(...args); }
    // 群成员集合缓存：用于「拍一拍目标必须是本群成员」的校验。
    // 不校验的话，群友只要让 AI 传一个任意 QQ 号，桥接就会向网关发 group_poke，
    // 等于把机器人账号变成任意 QQ 号的探测/骚扰工具（工具描述里承诺了白名单约束）。
    // groupId -> { ids:Set<string>, ts }
    function assertGroupMember(...args) { return (0, groupMembers.assertGroupMember)(...args); }
    function resolveGroupMemberName(...args) { return (0, groupMembers.resolveGroupMemberName)(...args); }
    // QQ 引用/回复解析缓存：messageId -> { sender, text, ts }，避免每条引用都调一次 OneBot API。
    const replyContext = createReplyContext({
        get Date() { return Date; },
        get log() { return log; },
        get bot() { return bot; },
        get segmentsToText() { return segmentsToText; },
        get resolveGroupMemberName() { return resolveGroupMemberName; },
        get nativeBinding() { return nativeBinding; }
    }); // `kind:convId:messageId` -> { info, ts }
    function pruneReplyInfoCache(...args) { return (0, replyContext.pruneReplyInfoCache)(...args); }
    function resolveReplyInfo(...args) { return (0, replyContext.resolveReplyInfo)(...args); }
    function resolveReplyTargetV2(...args) { return (0, replyContext.resolveReplyTargetV2)(...args); }
    function isQuoteTargetSelf(...args) { return (0, replyContext.isQuoteTargetSelf)(...args); }
    const toolAudit = createToolAudit({
        get createCappedLogger() { return createCappedLogger; },
        get TOOL_LOG_FILE() { return TOOL_LOG_FILE; },
        get redactSensitiveText() { return redactSensitiveText; },
        get log() { return log; },
        get truncateText() { return truncateText; }
    });
    function appendToolLog(...args) { return (0, toolAudit.appendToolLog)(...args); }
    function redactSensitive(...args) { return (0, toolAudit.redactSensitive)(...args); }
    function sanitizeToolArgs(...args) { return (0, toolAudit.sanitizeToolArgs)(...args); }
    // 消息、挂起请求及DSH事件处理由上方功能模块组合。
    // QQ 侧（OneBot兼容通道 OneBot WebSocket 客户端）
    const bot = new OneBotWebSocketClient({
        url: cfg.onebot.wsUrl,
        accessToken: nativeBinding ? nativeBinding.accessToken : cfg.onebot.accessToken || undefined,
        ...(nativeBinding ? { policyRevision: nativeBinding.configurationRevision } : {}),
        reconnect: true
    });
    // 原生组件在下面的nativeBinding分支内构造一次；回调登记在构造后，退出不把引用置空。
    const nativeVoice = nativeBinding
        ? createVoiceManager({ bot, dataRoot: path.join(SOURCE_ROOT, '..', 'integration', 'data', 'voice'),
            receiveEnabled: nativeCapabilities.receiveVoice, sendEnabled: nativeCapabilities.sendVoice }) : null;
    const singingRoot = path.join(SOURCE_ROOT, '..', 'singing-rvc');
    let singingFollowup = null;
    if (nativeBinding && fs.existsSync(path.join(singingRoot, 'runtime.json')) && fs.existsSync(path.join(singingRoot, 'catalog.json'))) {
        singingFollowup = createSingingFollowup({
            context: key => nativeCapabilities?.sendVoice && nativeCapabilities?.sendText ? nativeFeatureAccess.context(key, true) : null,
            turnOpen: actorKey => nativeTurnFence?.hasOpenTurn(state.sessions[actorKey]) === true,
            status: (owner, job) => nativeSinging.status(owner, job),
            dispatch: (actorKey, text, isCurrent) => nativeFeatureRequests.exit(() => nativeInboundPolicy.exit(() => deliverPrompt(actorKey, text, { offlineCurrent: isCurrent }))),
            log: code => log('歌声完成通知未确认：' + code),
        });
        nativeSinging = createSingingManager({ root: singingRoot,
            onSettled: event => singingFollowup.settled(event),
            upload: (bytes, key, guard) => uploadNativeRecord(bot, bytes, key, guard),
            send: async (key, segment, guard) => {
                if (!nativeCapabilities.sendVoice || !nativeCapabilities.sendText)
                    throw Error('SINGING_DISABLED');
                assertOutboundAuditOk(key, '[RVC歌声]');
                guard();
                const result = await nativeReplyQueue.submit(key, [[segment]], guard);
                if (result.failed)
                    throw Error('SINGING_SEND_UNCONFIRMED');
            } });
        closeNativeSinging = () => { singingFollowup?.close(); return nativeSinging.close(); };
        bot.on('close', () => nativeSinging.cancel());
    }
    if (nativeVoice)
        process.once('exit', () => { void nativeVoice.close().catch(() => { }); });
    if (nativeVoice)
        bot.on('open', () => {
            void nativeVoice.warmup().catch(() => log('本机语音预热未完成；文字通道保持可用。'));
        });
    if (nativeBinding) {
        avatarReader = createQQAvatarReader({ bot, enabled: nativeCapabilities.readAvatar, selfEnabled: nativeCapabilities.readSelfAvatar });
        process.once('exit', () => avatarReader.close());
        nativeImageApi = createImageGenerationApi({
            initialSettings: imagePreferences.load(),
            permission: () => nativeCapabilities.generateImage,
            context: key => nativeFeatureContext(key),
            verify: async (key) => {
                const [kind, peer_id] = key.split(':');
                return bot.raw('get_image_generation_subject', { kind, peer_id }, { timeoutMs: 2500 });
            },
            upload: (bytes, target, options) => bot.uploadNativeImage(bytes, target, options),
            rememberToken: (key, token) => rememberAgentToken('image:' + key, token),
        });
        bot.on('close', () => nativeImageApi.cancel());
        process.once('exit', () => nativeImageApi.close());
        nativeGroupApi = createGroupManagementApi({
            permission: () => nativeBinding.groupAdmin ?? {},
            context: key => /^group:[1-9]\d{0,19}$/.test(key ?? '') ? nativeFeatureContext(key) : null,
            verify: (key, action) => bot.raw('get_group_admin_subject', { action, group_id: key.slice(6) }, { timeoutMs: 2500 }),
            perform: (key, action, input, operationId) => action === 'atAll'
                ? bot.raw('send_group_at_all', { group_id: key.slice(6), text: input.text }, { timeoutMs: 15000 })
                : bot.raw('execute_group_action', { action, group: key.slice(6), user: input.userId,
                    ...(action === 'mute' ? { duration: input.duration } : {}), operationId }, { timeoutMs: 6000 }),
            safeText: text => redactKnownTokensOnly(text) === text,
            rememberToken: (key, token) => rememberAgentToken('group-admin:' + key, token),
        });
        bot.on('close', () => nativeGroupApi.cancel());
        process.once('exit', () => nativeGroupApi.close());
        nativeQzoneApi = createQzoneApi({
            settings: () => nativeBinding.qzone ?? {},
            context: key => nativeFeatureContext(key),
            verify: key => { const [kind, peer_id] = key.split(':'); return bot.raw('get_qzone_subject', { kind, peer_id }, { timeoutMs: 2500 }); },
            perform: (key, text) => { const [kind, peer_id] = key.split(':'); return bot.raw('publish_qzone', { kind, peer_id, text }, { timeoutMs: 35000 }); },
            safeText: text => redactKnownTokensOnly(text) === text,
            rememberToken: (key, token) => rememberAgentToken('qzone:' + key, token),
        });
        bot.on('close', () => nativeQzoneApi.cancel());
        process.once('exit', () => nativeQzoneApi.close());
        nativeSelfProfileApi = createSelfProfileApi({
            permission: () => nativeBinding.selfProfile ?? {},
            context: key => nativeFeatureContext(key),
            verify: (key, field) => { const [kind, peer_id] = key.split(':'); return bot.raw('get_self_profile_subject', { kind, peer_id, field }, { timeoutMs: 2500 }); },
            perform: async (key, field, value) => {
                const [kind, peer_id] = key.split(':');
                const result = await bot.raw('update_self_profile', { kind, peer_id, field, value }, { timeoutMs: field === 'avatar' ? 30000 : 12000 });
                if (field === 'avatar' && result?.submitted === true && ['accepted', 'observed'].includes(result.outcome))
                    avatarReader?.invalidateSelf();
                return result;
            },
            safeText: text => redactKnownTokensOnly(text) === text,
            rememberToken: (key, token) => rememberAgentToken('self-profile:' + key, token),
        });
        bot.on('close', () => nativeSelfProfileApi.cancel());
        process.once('exit', () => nativeSelfProfileApi.close());
    }
    const nativeFeatureDelivery = createNativeFeatureDelivery({
        get nativeCapabilities() { return nativeCapabilities; },
        get assertOutboundAuditOk() { return assertOutboundAuditOk; },
        get nativeSendBatches() { return nativeSendBatches; },
        get nativeReplyQueue() { return nativeReplyQueue; },
        get nativeChatMessages() { return nativeChatMessages; },
        get modeCoordinator() { return modeCoordinator; },
        get recordSentMessagesV2() { return recordSentMessagesV2; },
        get getSocialV2State() { return getSocialV2State; },
        get Date() { return Date; }
    });
    function sendNativeFeatureReply(...args) { return (0, nativeFeatureDelivery.sendNativeFeatureReply)(...args); }
    if (nativeBinding) {
        let phoneWorkspace = null;
        nativePhoneModel = createPhoneModel({ roleHint: currentRoleHint, context: key => buildContextBlock(key), audit: (speech, key) => assertOutboundAuditOk(key, speech),
            lifecycle: {
                create: async (signal) => {
                    if (!modeCoordinator.state.dshPresetIds.includes('qq-phone'))
                        throw Error('PHONE_PRESET_UNAVAILABLE');
                    if (!phoneWorkspace) {
                        const dir = path.join(STATE_DIR, 'phone-drafts');
                        fs.mkdirSync(dir, { recursive: true });
                        phoneWorkspace = unwrap(await api.callUnary('workspace.create', { path: dir }, signal), 'phone workspace').workspace.workspaceId;
                    }
                    return unwrap(await api.callUnary('session.create', { workspaceId: phoneWorkspace, agentPreset: 'qq-phone' }, signal), 'phone session').sessionId;
                },
                prepare: async (sid, signal) => {
                    unwrap(await api.callUnary('session.selectModel', { sessionId: sid,
                        provider: String(cfg.dsh?.provider || 'deepseek-official'), model: String(cfg.dsh?.model || 'deepseek-flash'),
                        reasoningEffort: String(cfg.dsh?.reasoningEffort || REASONING_EFFORT_DEFAULT) }, signal), 'phone model');
                },
                follow: sid => api.events.follow(sid), forget: sid => api.events.forget(sid),
                prompt: async (sid, prompt, signal) => { unwrap(await api.callUnary('session.prompt', { sessionId: sid, mode: 'queue', content: [{ type: 'text', text: prompt }] }, signal), 'phone prompt'); },
                stop: sid => stopBridgeSessionWork(sid, 'phone'), archive: sid => archivePhoneSession(id => api.workspace.archiveSession({ sessionId: id }), sid),
            } });
        nativePhone = createPhoneManager({ bot, voice: nativeVoice, model: nativePhoneModel, settings: () => cfg.phone ?? { enabled: false, autoAnswer: true },
            ready: () => nativePolicyCurrent && bot.isConnected && modeCoordinator.state.dshReady && nativeCapabilities.receiveVoice && nativeCapabilities.sendVoice
                && nativeBinding.allowSend && nativeVoice?.snapshot().asrReady === true && nativeVoice?.snapshot().ttsReady === true
                && modeCoordinator.state.dshPresetIds.includes('qq-phone') && !nativePhoneModel.snapshot().cleanupFailed && readRoleState().mode !== 'silent',
            captureGuard: key => {
                const base = captureSendGuard(key), generation = nativePolicyGeneration, role = currentRoleHint(), mode = modeCoordinator.state.currentMode;
                return () => { base(); if (generation !== nativePolicyGeneration || mode !== modeCoordinator.state.currentMode || role !== currentRoleHint())
                    throw Error('PHONE_CALL_STALE'); };
            },
            onTranscript: (value, { key }) => appendRecentMessage(key, '对方（电话转写）', value, value),
            onSpoken: (value, { key }) => appendRecentMessage(key, selfDisplayName || '我（电话）', value, value), });
        closeNativePhoneTasks = async () => { await nativePhone.close(); await nativePhoneModel.close(); };
        bot.on('close', () => { nativePhoneModel.cancelAll(); void nativePhone.reconcile().catch(() => { }); });
        nativePhone.start();
    }
    if (nativeBinding)
        nativeStickerApi = createNativeStickerApi({
            capabilities: () => nativeCapabilities, notesFile: path.join(STATE_DIR, 'native-sticker-notes.json'),
            list: (key, input) => {
                const [kind, peer_id] = key.split(':');
                return bot.raw('list_favorite_stickers', { kind, peer_id, ...input }, { timeoutMs: 8000 });
            },
            source: (key, sticker_id) => {
                const [kind, peer_id] = key.split(':');
                return bot.raw('get_favorite_sticker_source', { kind, peer_id, sticker_id }, { timeoutMs: 8000 });
            },
            collect: (key, file) => {
                const [kind, peer_id] = key.split(':');
                return bot.raw('collect_favorite_sticker', { kind, peer_id, file }, { timeoutMs: 45000 });
            },
            download: url => safeFetchBuffer(url, MAX_MEDIA_BYTES),
            normalize: (bytes, mimeType) => {
                // 复用本机语音链路已使用的所属FFmpeg；不安装或探测其它项目程序。
                const ownedFfmpeg = path.join(ROOT, 'ffmpeg.exe');
                const available = fs.existsSync(ownedFfmpeg) && fs.lstatSync(ownedFfmpeg).isFile() && !fs.lstatSync(ownedFfmpeg).isSymbolicLink();
                return normalizeImageForModel(bytes, mimeType, { ...modelMediaLimits,
                    ffmpegPath: modelMediaLimits.ffmpegPath || (available ? ownedFfmpeg : null), label: 'QQ收藏表情' });
            },
            upload: (...args) => bot.uploadNativeImage(...args), send: sendNativeFeatureReply,
            checkLabel: (key, text) => assertOutboundAuditOk(key, text),
        });
    if (nativeBinding)
        nativeFeatureRoutes = createNativeFeatureRoutes({
            access: nativeFeatureAccess, capabilities: () => ({ ...nativeCapabilities, groups: { ...nativeBinding.groupAdmin },
                profile: { ...nativeBinding.selfProfile }, friends: { ...nativeBinding.friendRequests }, qzone: { enabled: nativeBinding.qzone?.enabled === true } }),
            run: (key, guard, callback) => nativeFeatureRequests.run({ key, guard }, callback), hints: key => buildNativeFeatureHints(key, { reuse: true }),
            images: { generate: (...args) => nativeImageApi.generate(...args) }, groups: { act: input => nativeGroupApi.act(input) },
            stickers: nativeStickerApi,
            phone: (action, input, guard) => { if (!nativePhone)
                throw Error('PHONE_NOT_READY'); return nativePhone.control(action, input, guard); },
            singing: async (action, input, guard) => {
                if (!nativeSinging)
                    throw Error('SINGING_NOT_READY');
                const owner = input.key + ':' + nativeFeatureContext(input.key);
                if (action === 'catalog')
                    return { songs: nativeSinging.catalog(), sent: false };
                if (action === 'prepare') {
                    const result = nativeSinging.start(owner, Object.fromEntries(['songId', 'pitch']
                        .filter(name => Object.hasOwn(input, name)).map(name => [name, input[name]])), guard);
                    if (result.status === 'preparing')
                        singingFollowup.track({ key: input.key,
                            actorKey: modeCoordinator.state.currentMode === 'closed-agent' ? `private:${String(cfg.ownerQQ ?? '')}` : input.key,
                            owner, job: result.job });
                    return result;
                }
                if (action === 'status')
                    return nativeSinging.status(owner, input.job);
                const result = await nativeSinging.send(owner, input.job, input.key, guard);
                return { ...result, confirmed: result.sent === true };
            },
            qzone: { post: input => nativeQzoneApi.post(input) }, profile: { update: input => nativeSelfProfileApi.update(input) },
            avatar: async (key, input, guard) => {
                const [kind, peer_id] = key.split(':');
                const result = await bot.raw('prepare_self_avatar', { kind, peer_id, ...input }, { timeoutMs: 12000 });
                guard();
                return result;
            },
            selfProfileRead: async (key, field, guard) => {
                const [kind, peer_id] = key.split(':');
                const result = await bot.raw('read_self_profile', { kind, peer_id, field }, { timeoutMs: 7000 });
                guard();
                return result;
            },
            members: async (key, limit, guard) => {
                const result = await bot.raw('get_observed_group_members', { group_id: key.slice(6), limit }, { timeoutMs: 2500 });
                guard();
                return result;
            },
            friends: async (key, userId, guard) => {
                const [kind, peer_id] = key.split(':');
                const result = await bot.raw('get_observed_friend_status', { kind, peer_id, user_id: userId }, { timeoutMs: 2500 });
                guard();
                return result;
            },
            send: sendNativeFeatureReply,
            media: async (key, messageId, guard) => {
                const media = findMessageMedia(key, messageId), images = await fetchMediaData(media);
                guard();
                return { messageId, media, images };
            },
            forward: async (key, id, guard) => {
                if (!seenForwardIds.get(key)?.has(id))
                    throw new Error('NATIVE_FORWARD_NOT_AUTHORIZED');
                const formatted = formatForwardResponse(await bot.raw('get_forward_msg', { id }));
                guard();
                return rememberNativeForwardResult(key, formatted);
            },
            forwardMedia: async (key, media, guard) => {
                if (media.some(item => !nativeForwardMedia.get(key)?.has(JSON.stringify(item))))
                    throw new Error('NATIVE_FORWARD_NOT_AUTHORIZED');
                const images = await fetchMediaData(media);
                guard();
                return { key, media, images };
            },
        });
    if (nativeBinding) {
        let idleWorkspace = null;
        idleDraftRunner = createIdleDraftRunner({
            create: async (signal) => {
                if (!modeCoordinator.state.dshPresetIds.includes('qq-idle-draft'))
                    throw new Error('IDLE_PRESET_UNAVAILABLE');
                if (!idleWorkspace) {
                    const dir = path.join(STATE_DIR, 'idle-drafts');
                    fs.mkdirSync(dir, { recursive: true });
                    idleWorkspace = unwrap(await api.callUnary('workspace.create', { path: dir }, signal), 'idle workspace').workspace.workspaceId;
                }
                return unwrap(await api.callUnary('session.create', { workspaceId: idleWorkspace, agentPreset: 'qq-idle-draft' }, signal), 'idle session').sessionId;
            },
            prepare: async (sessionId, signal) => {
                unwrap(await api.callUnary('session.selectModel', { sessionId,
                    provider: String(cfg.dsh?.provider || 'deepseek-official'), model: String(cfg.dsh?.model || 'deepseek-flash'),
                    reasoningEffort: String(cfg.dsh?.reasoningEffort || REASONING_EFFORT_DEFAULT) }, signal), 'idle model');
            },
            follow: sid => api.events.follow(sid), forget: sid => api.events.forget(sid),
            prompt: async (sessionId, text, signal) => {
                unwrap(await api.callUnary('session.prompt', { sessionId, mode: 'queue',
                    content: [{ type: 'text', text }] }, signal), 'idle prompt');
            },
            stop: sid => stopBridgeSessionWork(sid, 'idle'),
            archive: async (sid) => unwrap(await api.workspace.archiveSession({ sessionId: sid }), 'idle archive'),
        });
        idleAvailable = () => nativePolicyCurrent && nativeCapabilities.idleMessages && bot.isConnected && modeCoordinator.state.dshReady && ['chat', 'reserved', 'reserved2', 'closed-agent'].includes(modeCoordinator.state.currentMode)
            && (modeCoordinator.state.currentMode !== 'reserved2' || !socialV2.paused) && readRoleState().mode !== 'silent'
            && modeCoordinator.state.dshPresetIds.includes('qq-idle-draft') && !idleDraftRunner.snapshot().cleanupFailed
            && !idleDraftRunner.snapshot().closed && nativeIdleLoop?.snapshot().closed === false;
        const idleReady = (key) => idleAvailable() && !shouldBlockSilentReply(key) && nativeScopeAllows(cfg.nativeScope, 'group', key.slice(6))
            && !promptQueue.has(key) && !offlineQueue.has(key)
            && !nativeSendBatches.has(key) && !(state.sessions[key] && collectors.has(state.sessions[key]));
        nativeIdleLoop = createNativeIdleLoop({ bot, ready: idleReady,
            captureGuard: key => {
                const generation = nativePolicyGeneration, mode = modeCoordinator.state.currentMode, role = currentRoleHint();
                const sendGuard = () => {
                    if (!nativePolicyCurrent || generation !== nativePolicyGeneration || mode !== modeCoordinator.state.currentMode
                        || !nativeBinding.allowSend || !nativeScopeAllows(cfg.nativeScope, 'group', key.slice(6)))
                        throw new Error('IDLE_CANCELLED');
                };
                return () => { sendGuard(); if (!idleReady(key) || role !== currentRoleHint())
                    throw new Error('IDLE_CANCELLED'); };
            },
            generate: (prompt, options) => idleDraftRunner.generate(prompt, options), roleHint: currentRoleHint,
            audit: (text, key) => assertOutboundAuditOk(key, text),
            submit: (group, claim, text, guard) => enqueueNativeSend(() => {
                guard();
                return bot.raw('send_idle_group_msg', { group_id: group, claim, message: text }, { timeoutMs: 15000 });
            }),
            onSent: (key, text) => {
                appendRecentMessage(key, selfDisplayName || '我', text, text);
                if (modeCoordinator.state.currentMode === 'reserved2')
                    recordSentMessagesV2(key, [text]);
            }, });
        bot.onNotice('native_group_activity', event => nativeIdleLoop.activity(event.group_id));
        bot.on('close', () => { nativeIdleLoop.cancel(); idleDraftRunner.cancelAll(); });
        nativeIdleLoop.start();
        closeNativeIdleTasks = async () => { nativeObservation.cancelAll(); await nativeIdleLoop.close(); await idleDraftRunner.close(); };
    }
    if (nativeBinding) {
        let requiredRevision = nativeBinding.configurationRevision ?? 1, refreshTask = null;
        let retiredNativeWork = null, lastPolicyFailureCode = null;
        const stopRetiredNativeWork = () => {
            const retired = retiredNativeWork;
            if (!retired || retired.pending.size === 0)
                return Promise.resolve();
            if (retired.task)
                return retired.task;
            if (retired.pending.size > 256) {
                nativePolicyStopFailed = true;
                return Promise.reject(new Error('NATIVE_POLICY_SESSION_LIMIT'));
            }
            // 只重试本次撤权时捕获、且尚未确认停止的旧会话；不重新扫入后来出现的会话。
            if (retired.attempts >= 4)
                return Promise.reject(new Error('NATIVE_POLICY_STOP_RETRY_EXHAUSTED'));
            if (Date.now() < retired.retryAt)
                return Promise.reject(new Error('NATIVE_POLICY_STOP_BACKOFF'));
            retired.attempts++;
            retired.task = (async () => {
                const sessions = [...retired.pending];
                for (let index = 0; index < sessions.length; index += 8) {
                    const batch = sessions.slice(index, index + 8);
                    const results = await Promise.allSettled(batch.map(id => Promise.resolve().then(() => withTimeout(stopBridgeSessionWork(id, 'policy'), DSH_CONTROL_TIMEOUT_MS, 'native policy stop'))));
                    results.forEach((result, offset) => { if (result.status === 'fulfilled')
                        retired.pending.delete(batch[offset]); });
                }
                if (retired.pending.size)
                    throw new Error('NATIVE_POLICY_STOP_UNCONFIRMED');
            })().then(() => { nativePolicyStopFailed = false; }, () => {
                nativePolicyStopFailed = true;
                retired.retryAt = Date.now() + Math.min(5000 * 2 ** (retired.attempts - 1), 60000);
                log('原生权限旧任务停止未确认：NATIVE_POLICY_STOP_UNCONFIRMED；保持阻断，有限退避复核。');
                throw new Error('NATIVE_POLICY_STOP_UNCONFIRMED');
            }).finally(() => { retired.task = null; });
            return retired.task;
        };
        const invalidateNativePolicy = () => {
            if (!nativePolicyCurrent)
                return;
            nativePolicyCurrent = false;
            nativePolicyGeneration++;
            sessionEpoch++;
            nativePhoneModel?.cancelAll();
            void nativePhone?.reconcile().catch(() => { });
            nativePolicyStopFailed = false;
            const activeSessions = [...new Set(Object.values(state.sessions))];
            retiredNativeWork = { pending: new Set(activeSessions), attempts: 0, retryAt: 0, task: null };
            nativeTurnFence.revoke();
            nativeFeatureGrants.clear();
            nativeForwardMedia.clear();
            nativeTrackedTurns.clear();
            nativeObservation.cancelAll();
            nativeReplyQueue?.cancelAll();
            nativeIdleLoop?.cancel();
            idleDraftRunner?.cancelAll();
            nativeImageApi?.cancel();
            nativeGroupApi?.cancel();
            nativeQzoneApi?.cancel();
            nativeSelfProfileApi?.cancel();
            avatarReader?.configure({ enabled: false, selfEnabled: false });
            collectors.clear();
            offlineQueue.clear();
            promptQueue.rejectPending('NATIVE_POLICY_CHANGED');
            for (const [key, entry] of pending) {
                clearTimeout(entry.timer);
                void cancelPendingEntry(entry).catch(() => { });
            }
            pending.clear();
            cancelAllSocialTimers();
            for (const key of socialV2.conversations.keys())
                clearSocialV2Timers(key);
            clearAllPendingWakeLeases();
            pendingWakeKeys.clear();
            activeWaits.clear();
            for (const [key, value] of socialV2.conversations) {
                value.agentToken = crypto.randomBytes(24).toString('hex');
                rememberAgentToken(key, value.agentToken);
                value.bootstrapSent = false;
                value.modelSeenSeqs = new Set();
            }
            // 停止旧轮次，保留角色、模型、声音和已有会话映射；没有自动新prompt。
            void stopRetiredNativeWork().catch(() => { });
        };
        const readCurrentNativePolicy = async () => {
            traceNativeReceive('native_refresh_begin');
            const next = await connectNativeGateway(process.env.QQ_NATIVE_GATEWAY_STATUS, {
                allowedRoot: path.join(SOURCE_ROOT, '..', 'native-research', 'native-adapter', 'service-data'),
                allowFixture: process.env.QQ_NATIVE_GATEWAY_ALLOW_FIXTURE === '1' && ROOT.toLowerCase().startsWith((path.join(SOURCE_ROOT, '..', 'integration-tests') + path.sep).toLowerCase()),
                requireSend: false
            });
            traceNativeReceive('native_refresh_end');
            if (next.url !== nativeBinding.url || next.accessToken !== nativeBinding.accessToken)
                throw new Error('NATIVE_POLICY_INSTANCE_CHANGED');
            const revision = next.configurationRevision ?? 1;
            if (!Number.isSafeInteger(revision) || revision < requiredRevision)
                throw new Error('NATIVE_POLICY_NOT_CURRENT');
            requiredRevision = Math.max(requiredRevision, revision);
            return next;
        };
        const refreshNativePolicy = () => {
            if (refreshTask)
                return refreshTask;
            refreshTask = (async () => {
                let next = await readCurrentNativePolicy();
                if ((next.configurationRevision ?? 1) === (nativeBinding.configurationRevision ?? 1) && nativePolicyCurrent)
                    return;
                invalidateNativePolicy();
                await stopRetiredNativeWork();
                // 停旧任务可能等待数秒；恢复前再次核验实例和最新代次，不使用等待前的许可快照。
                next = await readCurrentNativePolicy();
                const revision = next.configurationRevision ?? 1;
                Object.assign(nativeBinding, next);
                applyNativeGatewayConfig(cfg, nativeBinding);
                Object.assign(nativeCapabilities, nativeCapabilitiesFor(nativeBinding));
                bot.policyRevision = revision;
                avatarReader.configure({ enabled: nativeCapabilities.readAvatar, selfEnabled: nativeCapabilities.readSelfAvatar });
                void nativeVoice?.setPermissions({ receiveEnabled: nativeCapabilities.receiveVoice, sendEnabled: nativeCapabilities.sendVoice })
                    .catch(() => log('语音权限已更新，预热未完成；其他功能继续。'));
                nativePolicyCurrent = true;
                nativePolicyStopFailed = false;
                reconcileSessionPolicies();
                lastPolicyFailureCode = null;
                retiredNativeWork = null;
                log('原生权限复核已恢复；旧轮次已确认停止，不补投历史消息。');
            })().catch(error => {
                // 仅记录固定阶段，禁止输出原始异常、连接信息、账号或令牌。
                const codes = ['NATIVE_GATEWAY_PATH_FAILED', 'NATIVE_GATEWAY_STATUS_FAILED', 'NATIVE_GATEWAY_HEALTH_FAILED',
                    'NATIVE_GATEWAY_BROKER_FAILED', 'NATIVE_GATEWAY_SEND_PERMISSION_FAILED'];
                const reasons = ['NATIVE_POLICY_INSTANCE_CHANGED', 'NATIVE_POLICY_NOT_CURRENT', 'NATIVE_POLICY_SESSION_LIMIT',
                    'NATIVE_POLICY_STOP_UNCONFIRMED', 'NATIVE_POLICY_STOP_BACKOFF', 'NATIVE_POLICY_STOP_RETRY_EXHAUSTED'];
                const reason = codes.includes(error?.code) ? error.code : reasons.includes(error?.message) ? error.message : 'NATIVE_POLICY_REFRESH_FAILED';
                if (nativePolicyCurrent || reason !== lastPolicyFailureCode) {
                    log(`原生权限复核失败：${reason}；撤销旧轮次。`);
                }
                lastPolicyFailureCode = reason;
                invalidateNativePolicy();
            }).finally(() => { refreshTask = null; });
            return refreshTask;
        };
        bot.on('event', packet => {
            if (packet.post_type === 'meta_event' && packet.meta_event_type === 'native_policy_changed'
                && Number.isSafeInteger(packet.configurationRevision) && packet.configurationRevision > requiredRevision) {
                requiredRevision = packet.configurationRevision;
                invalidateNativePolicy();
                void refreshNativePolicy();
            }
        });
        const policyTimer = setInterval(() => void refreshNativePolicy(), 1000);
        policyTimer.unref();
        process.once('exit', () => clearInterval(policyTimer));
    }
    bot.onPrivateMessage(async (event) => {
        if (nativeBinding && !nativePolicyCurrent)
            return;
        // 统一按字符串比较：网关可能把 id 序列化成 number/string 混用，
        // 用 `===` 漏掉自己发的消息会进入正常处理（reserved2 下 AI 会回答自己 / chat 下可能回复循环）。
        if (String(event?.user_id ?? '') === String(event?.self_id ?? ''))
            return;
        rememberNativeIncomingFeatureMetadata('private', event.user_id, event);
        try {
            await nativeInboundPolicy.run(nativePolicyGeneration, () => handleIncoming('private', event.user_id, event, cfg));
        }
        catch (error) {
            log('处理私聊消息出错:', error?.message ?? error);
        }
    });
    bot.onGroupMessage(async (event) => {
        if (nativeBinding && !nativePolicyCurrent)
            return;
        if (String(event?.sender?.user_id ?? '') === String(event?.self_id ?? '')
            || String(event?.user_id ?? '') === String(event?.self_id ?? ''))
            return;
        nativeIdleLoop?.observeMessage(event);
        rememberNativeIncomingFeatureMetadata('group', event.group_id, event);
        try {
            await nativeInboundPolicy.run(nativePolicyGeneration, () => handleIncoming('group', event.group_id, event, cfg));
        }
        catch (error) {
            log('处理群消息出错:', error?.message ?? error);
        }
    });
    bot.onNotice('notify', async (event) => {
        try {
            await handlePokeNotice(event);
        }
        catch (error) {
            log('处理拍一拍事件出错:', error?.message ?? error);
        }
    });
    // 旧外部通道兼容约定见 docs/legacy/GATEWAY_COMPATIBILITY_NOTES.md；原生通道使用所属网关状态。
    try {
        bot.onEvent((event) => {
            const post = event?.post_type;
            noteUpstreamPacket(post
                ? `${post}${event.notice_type ? `/${event.notice_type}` : ''}${event.meta_event_type ? `/${event.meta_event_type}` : ''}${event.message_type ? `/${event.message_type}` : ''}`
                : 'event');
            if (post === 'meta_event' && event?.meta_event_type === 'heartbeat') {
                // status 未在 SDK 类型里声明（OneBotMetaEvent 只声明 meta_event_type），
                // 但 OneBotBaseEvent 是 JsonObject，读取合法。
                noteReceiveHealth(event.status?.good, 'heartbeat');
                if (typeof event.status?.online === 'boolean')
                    gatewayHealth.accountOnline = event.status.online;
                reportSnowlumaHealth();
            }
        });
    }
    catch (error) {
        log(`（上游事件旁路订阅不可用，健康检测退化：${error?.message ?? error}）`);
    }
    // OneBot兼容通道 1.14.17 起新增 bot_status（账号会话边沿）。老运行时不会发这个事件，
    // 所以它只是加分项：收到就记下来，收不到不影响其它判断。
    try {
        bot.onBotStatus((event) => {
            noteUpstreamPacket('notice/bot_status');
            const sub = String(event?.sub_type ?? '');
            gatewayHealth.accountOnline = sub === 'online';
            if (sub === 'offline') {
                log('⚠️ OneBot兼容通道 报告 QQ 账号会话已离线（bot_status: offline）—— QQ 侧掉线或被顶号，'
                    + '在重新登录之前群里不会有任何消息进来。');
            }
            else if (sub === 'online') {
                log('OneBot兼容通道 报告 QQ 账号会话已上线（bot_status: online）');
            }
        });
    }
    catch (error) {
        log(`（bot_status 订阅不可用（OneBot兼容通道 运行时较旧？）：${error?.message ?? error}）`);
    }
    bot.on('open', () => {
        // 用实际连接地址（自愈后可能与 config 里的初值不同，别打印过期的那个）
        const connectedUrl = bot.url ?? cfg.onebot.wsUrl;
        gatewayHealth.connected = true;
        log(`QQ网关 已连接：${connectedUrl}`);
        // 「已连接」只说明与 OneBot兼容通道 的 WebSocket 通了，**不说明 QQ 侧收得到消息** ——
        // 这个区别见 startSnowlumaWatch 的说明。这里顺手把上游健康快照刷一次。
        void pollSnowlumaStatus();
        // 读取机器人昵称（用于社交模式"被提到"识别）；重连后也会刷新
        bot.getLoginInfo().then((login) => {
            if (login?.nickname) {
                selfNickname = String(login.nickname).toLowerCase();
                selfDisplayName = String(login.nickname).trim();
                log(`机器人昵称: ${login.nickname}`);
            }
            if (login?.user_id != null)
                selfUserId = String(login.user_id);
        }).catch(() => { });
        // 连接成功后顺手确认一下 token 是否已跟当前账号对齐；不一致就写回 config.json，
        // 让 MCP 工具（另一个进程）也能拿到正确的 token。
        void syncTokenToFile();
    });
    const legacyGatewayRecovery = createLegacyGatewayRecovery({
        get nativeBinding() { return nativeBinding; },
        get cfg() { return cfg; },
        get bot() { return bot; },
        get log() { return log; },
        get persistLegacyOnebotEndpoint() { return persistLegacyOnebotEndpoint; },
        get path() { return path; },
        get ROOT() { return ROOT; },
        get persistToken() { return persistToken; },
        get Date() { return Date; },
        get discoverLegacyOnebotConnection() { return discoverLegacyOnebotConnection; }
    });
    function applyHealedTokens(...args) { return (0, legacyGatewayRecovery.applyHealedTokens)(...args); }
    function syncTokenToFile(...args) { return (0, legacyGatewayRecovery.syncTokenToFile)(...args); }
    function healTokenIfStale(...args) { return (0, legacyGatewayRecovery.healTokenIfStale)(...args); }
    bot.on('close', (info) => {
        gatewayHealth.connected = false;
        log(`QQ网关连接断开（code=${info?.code ?? '?'}），重连中…`);
        // 连不上时最常见的原因就是换了 QQ 账号 → token 变了；顺手自愈。
        // 注意 1006 在**每次启动**都可能出现一次：HTTP token 与 WS token 是两个不同的值，
        // config.json 里存的是前者，WS 需要用自愈发现的那个（详见 bot.connect() 处的说明）。
        void healTokenIfStale(`close code=${info?.code ?? '?'}`);
    });
    bot.on('error', (error) => {
        // SDK 在 WS 升级被拒（401 / 建连失败）时可能**只 emit error、不 emit close**，
        // 于是挂在 close 上的 token 自愈永远不会触发 —— 表现为「桥接活着但收发全废」，
        // 用户只能靠手工改 token 绕过去（issue #19）。这里同样尝试一次（内部有 10s 节流）。
        const detail = error && typeof error === 'object'
            ? [error.code, error.message, error.reason, error.type].filter(Boolean).join(' | ') || JSON.stringify(error)
            : String(error ?? '');
        log(`OneBot兼容通道 错误：${detail || '(无详情)'}`);
        void healTokenIfStale(`error ${detail}`.trim().slice(0, 200));
    });
    // OneBot兼容通道 尚未就绪时不阻塞桥接启动：SDK 自带后台重连，DSH 侧照常连接。
    bot.connect().catch((error) => {
        // 说明为什么"第一次连不上"在这里几乎是**必然**的，避免用户把它当成故障：
        // OneBot兼容通道 的 **HTTP token（默认 3000）与 WS token（默认 3001）是两个不同的值**
        // （实测：同一个账号，两者不同；config.json 只能存一个，存的是 HTTP 那个）。
        // 所以 WS 首次连接通常会被拒 → close(1006) → 触发 token 自愈（重新发现 WS token）
        // → 重连成功后才是「QQ网关 已连接」。若 homeDir 没配/被移动/读不到 OneBot兼容通道 的
        // config/onebot_<QQ>.json，自愈就无从下手，这时才会一直连不上 —— 那种情况请查
        // 日志里的「token 自愈失败」与 config.json 的 onebot.homeDir。
        log(`OneBot兼容通道 首次连接未成功（将在后台自动重连并尝试自愈 WS token）: ${error?.message ?? error}`);
    });
    log('桥接已启动。按 Ctrl+C 退出。');
    // 预热表情库：启动时同步一次 QQ 收藏表情，失败不阻塞（AI 首次调用工具时还会再试）。
    if (cfg.socialV2?.sticker?.enabled !== false) {
        syncStickerLibrary(true).catch((error) => log('启动预热表情库失败:', error?.message ?? error));
    }
    startDshWatch();
    startSnowlumaWatch();
    startConsoleServer();
    // 所属组合监督器只接收脱敏健康/语音阶段摘要，不传账号、正文或凭据。
    if (nativeBinding && process.connected) {
        startupPhase = 'running';
        setInterval(() => {
            if (process.connected)
                process.send({ kind: 'qq-bridge-health', dshReady: modeCoordinator.state.dshReady,
                    // 仅诊断所属IPC使用带随机nonce的证明；不传管理员账号，也不保存到健康状态。
                    ...(process.env.PHONE_DIAGNOSTIC_SUPERVISOR === '1' && process.env.PHONE_DIAGNOSTIC_OWNER_NONCE
                        ? { diagnosticOwnerProof: crypto.createHmac('sha256', process.env.PHONE_DIAGNOSTIC_OWNER_NONCE).update(String(cfg.ownerQQ ?? '')).digest('hex') } : {}),
                    nativePermissionsCurrent: nativePolicyCurrent, nativePolicyRevision: nativeBinding?.configurationRevision ?? null,
                    nativePermissionsError: nativePolicyStopFailed,
                    upstreamConnected: gatewayHealth.connected === true, voice: nativeVoice?.snapshot() ?? { phase: 'disabled' } }, () => { });
        }, 1000).unref();
    }
    await pumpMux();
}
let closeNativeSinging = async () => { };
async function closeIdleBeforeExit() {
    try {
        await withTimeout(closeNativePhoneTasks(), 15000, 'PHONE_SHUTDOWN');
    }
    catch {
        log('电话清理未确认；不启动新实例。');
    }
    try {
        await closeNativeSinging();
    }
    catch {
        log('歌声工人退出未确认；不再启动新工人。');
    }
    try {
        await withTimeout(closeNativeIdleTasks(), 8000, 'IDLE_SHUTDOWN');
    }
    catch {
        log('冷场草稿清理未确认；不会重发，随所属模型服务结束。');
    }
}
process.on('SIGINT', async () => {
    log('退出中…');
    await closeIdleBeforeExit();
    saveState();
    releaseLock();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await closeIdleBeforeExit();
    saveState();
    releaseLock();
    process.exit(0);
});
if (process.send && process.env.QQ_NATIVE_GATEWAY_STATUS) {
    const ownedStop = async () => { await closeIdleBeforeExit(); saveState(); releaseLock(); process.exit(0); };
    process.on('message', (message) => { if (message?.kind === 'qq-bridge-stop')
        ownedStop(); });
    process.once('disconnect', ownedStop);
}
process.on('unhandledRejection', (error) => {
    // 打出 stack：只记 message 的话，「偶发一次」和「已经坏了六小时」看起来一模一样。
    log('未处理异常:', error?.stack ?? error?.message ?? error);
});
/**
 * 未捕获异常兜底。
 *
 * 为什么必须有：`log()` 是从 OneBot兼容通道 SDK 的 socket 事件回调里被调用的，而 SDK 的
 * emitter 逐个调用监听器、不做任何保护。stdout 的读者（守护 cmd 窗口）一旦消失，
 * `console.log` 会抛 EPIPE —— 这个异常会一路穿过 log() → 监听器 → emit → socket 回调，
 * 变成 uncaughtException。没有兜底的话整个 24/7 进程直接死掉且不留堆栈，
 * 在 start.bat 的重启循环里就变成「每 5 秒崩一次」。
 */
process.on('uncaughtException', (error) => {
    const reported = reportOwnedFailure(error);
    try {
        log('致命异常（进程即将退出）:', error?.stack ?? error?.message ?? error);
    }
    catch { }
    try {
        saveState();
    }
    catch { }
    releaseLock();
    if (!reported)
        process.exit(1);
});
process.on('exit', () => releaseLock());
main().catch((error) => {
    if (reportOwnedFailure(error))
        return;
    console.error('[bridge] 启动失败:', error);
    process.exit(1);
});
