// Generated from mcp-qq-native.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
import { createAgentTransport } from './mcp-tools/transport.js';
import { registerQqStatus, registerQqGetNativeCapabilities } from './mcp-tools/status.js';
import { registerQqGetAvatar, registerQqGetFriendStatus, registerQqGetSelfAvatar, registerQqGetSelfProfile, registerQqPrepareSelfAvatar, registerQqGetSelfAvatarBackups, registerQqPostQzone, registerQqUpdateSelfProfile, registerQqGetSelfImage } from './mcp-tools/profile.js';
import { registerQqSendNativeMessage, registerQqSendGroupMessage, registerQqReply, registerQqSendPrivateMessage, registerQqSendBurst, registerQqSendMessage, registerQqSendPoke } from './mcp-tools/messaging.js';
import { registerQqGenerateImage, registerQqGetMessageImages, registerQqGetForwardMsg } from './mcp-tools/images.js';
import { registerQqGroupManage, registerQqListGroups, registerQqGetGroupMembers, registerQqGetGroupHistory } from './mcp-tools/groups.js';
import { registerQqGetPrompt, registerQqGetUnreadMessages, registerQqGetRecentMessages, registerQqSocialState, registerQqMarkRead, registerQqSetWakeConfig, registerQqWaitForMessages, registerQqReportFeedback, registerQqGetMyRecentMessages, registerQqGetMessageDetail, registerQqGetActiveMembers } from './mcp-tools/conversation.js';
import { registerQqMemoryAppend, registerQqMemoryQuery, registerQqMemoryRemove, registerQqMemoryClear, registerQqSlangQuery, registerQqSlangSubmit } from './mcp-tools/memory.js';
import { registerQqListStickers, registerQqGetStickerImage, registerQqSendSticker, registerQqCollectSticker, registerQqStickerNote, registerQqSetStickerRemark } from './mcp-tools/stickers.js';
import { registerQqSendVoice, registerQqListVoices } from './mcp-tools/voice.js';
// QQ 原生桥接 MCP 服务（stdio）；工具经本项目桥接与独立原生网关执行。
//
// 安全设计：
// - 只暴露聊天所需的**安全动作子集**（查状态/查群/查消息/发消息），
//   原生群管理只通过当前聊天的一次性资格和网关独立许可；不开放旧模式管理接口。
// - 发送类工具强制校验白名单：目标群/私聊必须命中 config.json 的
//   allow.groups / allow.private，否则拒绝 —— agent 只能往被允许的地方发消息。
// - 状态及发送通过桥接内部 API；旧模式的部分只读工具保留 OneBot HTTP。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
// 出站文本的敏感信息拦截**统一由桥接负责**（bridge.js 的 auditAndSend / 各发送端点的
// SENSITIVE_RE 校验）：所有 QQ 发送都经由桥接 HTTP API，因此 MCP 侧不再重复实现一遍。
// 这里 import 只用于「出站审计口径一致」的说明，不在 MCP 内做拦截——
// 在 MCP 里拦会连「安全拒绝理由」都拿不到，反而让模型无法把话说清楚。
import { SENSITIVE_RE } from './sensitive.js';
import { serializeModelData } from './qq-model-view.js';
import { QQ_AVATAR_MAX_BASE64_CHARS } from './qq-avatar-limits.js';
import { registerNativeStickerTools } from './native-sticker-tools.js';
import { registerNativeSingingTools } from './native-singing-tools.js';
import { registerNativePhoneTools } from './native-phone-tools.js';
import { projectImageGenerationError, imageGenerationErrorInstruction } from './image-generation-errors.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QQ_BRIDGE_RUNTIME_ROOT ? path.resolve(process.env.QQ_BRIDGE_RUNTIME_ROOT) : path.resolve(__dirname, '..');
function loadConfig() {
    try {
        let text = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
        if (text.charCodeAt(0) === 0xFEFF)
            text = text.slice(1);
        const value = JSON.parse(text);
        return { ...value, onebot: value.onebot ?? value.snowluma ?? {} };
    }
    catch {
        return {};
    }
}
const cfg = loadConfig();
const { onebot, agentApiBase, readConsoleToken, errorText, agentApi, agentHeaders, agentApiLongPoll } = createAgentTransport({ AbortSignal, Buffer, ROOT, URL, clearTimeout, fetch, fs, getConfig, getOneBotConfig, http, path, projectImageGenerationError, setTimeout });
function getConfig() {
    return loadConfig();
}
function getAccess() {
    const c = getConfig();
    return {
        allowGroups: (c.allow?.groups ?? []).map(String),
        allowPrivate: (c.allow?.private ?? []).map(String),
        denyGroups: (c.deny?.groups ?? []).map(String),
        denyPrivate: (c.deny?.private ?? []).map(String),
        allowAllWhenEmpty: c.allowAllWhenEmpty === true
    };
}
function getOneBotConfig() {
    const c = getConfig();
    return {
        httpUrl: (c.onebot?.httpUrl ?? 'http://127.0.0.1:3000').replace(/\/+$/, ''),
        token: c.onebot?.accessToken ?? ''
    };
}
// 与 bridge.allowed 保持一致：allow 列表为空时按 allowAllWhenEmpty 放行
function isAllowed(allowList, denyList, id, allowAllWhenEmpty) {
    const s = String(id);
    if (denyList.includes(s))
        return false;
    if (allowList.length > 0)
        return allowList.includes(s);
    return allowAllWhenEmpty;
}
// 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
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
async function authorizeRead(key) {
    // 会话令牌必须显式携带：桥接已把空令牌的请求一律拒绝（避免把该端点变成免鉴权入口）。
    // 旧只读工具没有令牌，因此它们改由 legacyReadToolAllowed() 做模式判定，不再调用本函数。
    throw new Error('旧只读工具没有会话令牌；请使用带会话令牌的 v2 读工具');
}
// 旧只读工具（qq_status 之外的 qq_list_groups / qq_get_group_members / qq_get_group_history）
// 没有会话令牌，因此**只能在封闭 agent（管理员私聊）里使用**。
//
// 这里用「确认是 closed-agent 才放行」的白名单写法，而不是「看到 reserved2 就拒绝」的黑名单写法：
// 桥接的 /api/status 在「带 agent 令牌」时返回的是最小状态对象（不含 mode 字段），
// 用 `status?.mode === 'reserved2'` 判断会得到 undefined ⇒ 黑名单判定为假 ⇒ 旧工具被放行，
// 等于在二代仿真模式下把白名单群名、群成员名单注入模型上下文。
async function legacyReadToolAllowed() {
    const status = await agentApi('/api/status');
    return String(status?.mode ?? '') === 'closed-agent';
}
const server = new McpServer({ name: 'qq-native-bridge', version: '0.2.1-r1' });
// ── 工具开关必须在**注册期**生效，而不是只在校验期 ──────────────────────────
//
// 为什么：每个工具的描述 + 参数 schema 都会随 system prompt 在**每一次**请求里重发
// （实测 41 个工具约 8.8k token）。只在校验时 403 的话，被关掉的工具依然占着上下文、
// 依然会让模型看见并调用它（然后拿到一个错误），等于「关了个寂寞」。
//
// 这里用一个注册过滤器统一处理：开关关闭 ⇒ 该工具根本不注册 ⇒ 既省 token 又不给模型误调的机会。
// DSH 在启动时读取工具清单，所以关掉/打开后需要重启 DSH 才会刷新（控制台面板已注明）。
//
// 只列**各模式共用的工具不在其中**：qq_send_group_message / qq_send_private_message / qq_reply
// 同时服务 chat / reserved / closed-agent 模式，用 v2 的开关去决定它们是否注册会误伤其它模式，
// 所以这三个仍然只在调用时由桥接校验。
const TOOL_CONFIG_FLAGS = {
    qq_get_prompt: 'getPrompt',
    qq_get_unread_messages: 'getUnread',
    qq_get_recent_messages: 'getRecent',
    qq_social_state: 'socialState',
    qq_mark_read: 'markRead',
    qq_set_wake_config: 'setWakeConfig',
    qq_send_burst: 'sendBurst',
    qq_send_message: 'sendMessage',
    qq_wait_for_messages: 'waitMessages',
    qq_report_feedback: 'feedback',
    qq_get_my_recent_messages: 'getMyRecent',
    qq_get_message_detail: 'getMessageDetail',
    qq_get_active_members: 'getActiveMembers',
    qq_get_group_members: 'getGroupMembers',
    qq_memory_append: 'memory',
    qq_memory_query: 'memory',
    qq_memory_remove: 'memory',
    qq_memory_clear: 'memory',
    qq_slang_query: 'slangQuery',
    qq_slang_submit: 'slangSubmit',
    qq_send_voice: 'sendVoice',
    qq_list_voices: 'sendVoice',
    // 下面这些曾经漏登记。漏一个不是"多注册一个工具"那么轻：桥接那边按 `v2ToolEnabled(flag)`
    // 在**调用期**一律 403，而这里不登记就等于"控制台显示已关闭、模型每次请求仍收到它的完整
    // 描述与参数 schema，然后调用它、再拿到 403"——既白烧 token（本文件开头 176 行起就是为省这份
    // token 才改注册期过滤的），又诱导模型误调。`qq_set_sticker_remark` 默认就是 `false`
    // （见 bridge.js 的 socialV2.tools 默认表），所以此前它一直是"默认关闭却仍然可见"。
    qq_send_poke: 'sendPoke',
    qq_get_message_images: 'getImages',
    qq_get_forward_msg: 'getForwardMsg',
    qq_list_stickers: 'listStickers',
    qq_get_sticker_image: 'getStickerImage',
    qq_send_sticker: 'sendSticker',
    qq_collect_sticker: 'collectSticker',
    qq_get_self_image: 'getSelfImage',
    qq_sticker_note: 'stickerNote',
    qq_set_sticker_remark: 'setStickerRemark',
};
function nativeFeatureHeaders(featureToken, token) {
    return featureToken ? { 'x-native-feature-token': featureToken } : token ? { 'x-agent-token': token } : {};
}
const nativeSharedTools = new Set(['qq_get_message_images', 'qq_get_forward_msg', 'qq_get_group_members',
    'qq_list_stickers', 'qq_get_sticker_image', 'qq_collect_sticker', 'qq_send_sticker', 'qq_sticker_note']);
const nativeFeatureTokenSchema = cfg.nativeFeatureProtocol === 1
    ? z.string().regex(/^[a-f0-9]{64}$/).describe('本轮QQ功能会话令牌featureToken，所有原生模式必填；从当前提示读取，不可猜测或复述')
    : z.string().optional().describe('若当前提示提供QQ功能会话令牌，传入featureToken');
const disabledTools = [];
{
    const registerTool = server.tool.bind(server);
    server.tool = ((name, ...rest) => {
        const flag = TOOL_CONFIG_FLAGS[name];
        if (flag && cfg.socialV2?.tools?.[flag] === false && !(cfg.nativeFeatureProtocol === 1 && nativeSharedTools.has(name))) {
            disabledTools.push(`${name}(${flag})`);
            return undefined;
        }
        return registerTool(name, ...rest);
    });
}
registerQqStatus({ agentApi, serializeModelData, server });
registerQqGetAvatar({ QQ_AVATAR_MAX_BASE64_CHARS, agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
registerQqGetNativeCapabilities({ agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
registerQqSendNativeMessage({ agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
if (cfg.nativeFeatureProtocol === 1)
    registerQqGetFriendStatus({ agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
registerQqGetSelfAvatar({ QQ_AVATAR_MAX_BASE64_CHARS, agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
if (cfg.nativeFeatureProtocol === 1)
    registerQqGetSelfProfile({ agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
if (cfg.nativeFeatureProtocol === 1)
    registerQqPrepareSelfAvatar({ agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
if (cfg.nativeFeatureProtocol === 1)
    registerQqGetSelfAvatarBackups({ agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
registerQqGenerateImage({ agentApi, imageGenerationErrorInstruction, projectImageGenerationError, serializeModelData, server, z });
registerQqGroupManage({ agentApi, serializeModelData, server, z });
registerQqPostQzone({ agentApi, serializeModelData, server, z });
registerQqUpdateSelfProfile({ agentApi, serializeModelData, server, z });
// ── 旧只读工具：**按启动时的桥接模式决定是否注册** ─────────────────────────
//
// 为什么必须在注册期就砍掉（而不是只在调用期 403）：
//   每个工具的描述 + 参数 schema 都随 system prompt 在**每一次**请求里重发。
//   实测一份 reserved2 会话的请求头是「58 个工具 / 45.5 KB schema（≈14k token/次）」，
//   其中 3 个旧只读工具在 reserved2 下**必然**返回 403，却照样占着 2500+ 字节；
//   更要命的是它们会诱导模型误调（实测 turn10 有一次 qq_get_group_members → 403，白烧一步）。
//   本文件开头（TOOL_CONFIG_FLAGS 那段）已经为「关掉的工具」立过同样的规矩，这里补齐模式维度。
//
// 语义：旧只读工具没有会话令牌，`legacyReadToolAllowed()` 只放行 closed-agent。
//   所以只有在 closed-agent 下注册它们才有意义。探测失败（读不到状态文件）时按「注册」处理：
//   那种情况下所有 QQ 工具都不可用，少注册只会让模型看到更少的失败路径，不必激进。
//
// ⚠️ 为什么读 `state/mode.json` 而**不**去问 `/api/status`：
//   注册发生在模块加载期，走网络就得用 top-level await；而本文件会被若干离线回归
//   （test-audit-security-mcp.mjs）用 `vm`/`new Function` 求值，那里没有 TLA —— 会直接
//   `ReferenceError: await is not defined`，把整批断言打红。模式文件是桥接每次切换模式时
//   原子写出的（bridge.js 的 writeMode），与 `/api/status` 同源，读盘既准确又是同步的。
const bootBridgeMode = (() => {
    try {
        const raw = fs.readFileSync(path.join(ROOT, 'state', 'mode.json'), 'utf8');
        const parsed = JSON.parse(raw);
        return String(parsed?.mode ?? '').trim();
    }
    catch {
        return '';
    }
})();
const registerLegacyReadTools = bootBridgeMode === '' || bootBridgeMode === 'closed-agent';
if (!registerLegacyReadTools) {
    console.error(`[qq-native] 当前桥接模式 ${bootBridgeMode}：不注册旧只读工具（qq_list_groups / qq_get_group_history），改用带令牌的 v2 读工具`);
}
if (registerLegacyReadTools) {
    registerQqListGroups({ getAccess, isAllowed, legacyReadToolAllowed, onebot, serializeModelData, server });
}
registerQqGetGroupMembers({ agentApi, cfg, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
if (registerLegacyReadTools) {
    registerQqGetGroupHistory({ getAccess, isAllowed, legacyReadToolAllowed, onebot, serializeModelData, server, z });
}
registerQqSendGroupMessage({ agentApi, serializeModelData, server, unquoteJsonString, z });
registerQqReply({ agentApi, serializeModelData, server, unquoteJsonString, z });
registerQqSendPrivateMessage({ agentApi, serializeModelData, server, unquoteJsonString, z });
registerQqGetPrompt({ agentApi, serializeModelData, server, z });
registerQqGetUnreadMessages({ agentApi, serializeModelData, server, z });
registerQqGetRecentMessages({ agentApi, serializeModelData, server, z });
registerQqSocialState({ agentApi, serializeModelData, server, z });
registerQqMarkRead({ agentApi, serializeModelData, server, z });
registerQqSetWakeConfig({ agentApi, serializeModelData, server, z });
registerQqSendBurst({ agentApi, serializeModelData, server, z });
registerQqSendMessage({ agentApi, serializeModelData, server, z });
if (cfg.socialV2?.tools?.sendPoke !== false) {
    registerQqSendPoke({ agentApi, serializeModelData, server, z });
}
registerQqWaitForMessages({ agentApiLongPoll, serializeModelData, server, z });
registerQqReportFeedback({ agentApi, serializeModelData, server, z });
registerQqGetMyRecentMessages({ agentApi, serializeModelData, server, z });
registerQqGetMessageDetail({ agentApi, serializeModelData, server, z });
registerQqGetActiveMembers({ agentApi, serializeModelData, server, z });
registerQqMemoryAppend({ agentApi, serializeModelData, server, z });
registerQqMemoryQuery({ agentApi, serializeModelData, server, z });
registerQqMemoryRemove({ agentApi, serializeModelData, server, z });
registerQqMemoryClear({ agentApi, serializeModelData, server, z });
registerQqSlangQuery({ agentApi, serializeModelData, server, z });
registerQqSlangSubmit({ agentApi, serializeModelData, server, z });
// ── 图片/表情查看工具（一代/二代仿真共用） ─────────────────────────────────
if (cfg.nativeFeatureProtocol === 1 || cfg.socialV2?.tools?.getImages !== false) {
    registerQqGetMessageImages({ agentApi, cfg, nativeFeatureHeaders, nativeFeatureTokenSchema, server, z });
}
if (cfg.nativeFeatureProtocol === 1)
    registerNativeStickerTools({ server, z, agentApi,
        headers: nativeFeatureHeaders, featureTokenSchema: nativeFeatureTokenSchema, serialize: serializeModelData });
if (cfg.nativeFeatureProtocol === 1)
    registerNativeSingingTools({ server, z, agentApi,
        headers: nativeFeatureHeaders, featureTokenSchema: nativeFeatureTokenSchema, serialize: serializeModelData });
if (cfg.nativeFeatureProtocol === 1)
    registerNativePhoneTools({ server, z, agentApi, headers: nativeFeatureHeaders,
        featureTokenSchema: nativeFeatureTokenSchema, serialize: serializeModelData });
// 旧兼容通道保留原协议；原生模式不得进入旧HTTP收藏路径。
if (cfg.nativeFeatureProtocol !== 1 && cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.listStickers !== false) {
    registerQqListStickers({ agentApi, serializeModelData, server, z });
}
if (cfg.nativeFeatureProtocol !== 1 && cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.getStickerImage !== false) {
    registerQqGetStickerImage({ agentApi, errorText, server, z });
}
if (cfg.nativeFeatureProtocol !== 1 && cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.sendSticker !== false) {
    registerQqSendSticker({ agentApi, serializeModelData, server, z });
}
if (cfg.nativeFeatureProtocol !== 1 && cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.collectSticker !== false) {
    registerQqCollectSticker({ agentApi, serializeModelData, server, z });
}
if (cfg.socialV2?.voice?.enabled !== false && cfg.socialV2?.tools?.sendVoice !== false) {
    registerQqSendVoice({ agentApi, serializeModelData, server, z });
    registerQqListVoices({ agentApi, serializeModelData, server, z });
}
if (cfg.socialV2?.tools?.getSelfImage !== false) {
    registerQqGetSelfImage({ agentApi, errorText, server, z });
}
if (cfg.nativeFeatureProtocol !== 1 && cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.stickerNote !== false) {
    registerQqStickerNote({ agentApi, serializeModelData, server, z });
}
if (cfg.nativeFeatureProtocol !== 1 && cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.setStickerRemark !== false) {
    registerQqSetStickerRemark({ agentApi, serializeModelData, server, z });
}
// ── 合并转发消息查看工具（二代仿真模式） ────────────────────────────────────
if (cfg.nativeFeatureProtocol === 1 || cfg.socialV2?.tools?.getForwardMsg !== false) {
    registerQqGetForwardMsg({ agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z });
}
await server.connect(new StdioServerTransport());
