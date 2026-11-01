import type {NativeScope} from '../../../native-research/native-adapter/scope-policy.mjs';
/// <reference types="node" />
import type {ReasoningEffort} from './inputs.js';
/** 仅投影旧加载器使用的层级；原始字段保持unknown，不替代嵌套配置验证。 */
type RawFields<Key extends string> = Partial<Record<Key,unknown>> & Record<string,unknown>;
export type RawDsh = RawFields<"baseUrl"|"provider"|"model"|"reasoningEffort"|"authToken"|"authHeader"|"authPrefix"|"allowRemote">;
export type RawOnebot = RawFields<"wsUrl"|"accessToken"|"httpUrl"|"homeDir"|"autoDiscover"|"followDiscoveredEndpoint"|"launcherPath">;
export type RawSecurity = RawFields<"interceptNotify">;
export type RawSlang = RawFields<"enabled"|"extractMinMessages"|"extractCooldownMs"|"inferenceThresholds"|"injectMax"|"learnerPreset"|"workspaceTitle"|"autoResearch">;
export type RawSocial = RawFields<"enabled"|"triggerProbability"|"contextWindow"|"activeCheckMinMs"|"activeCheckMaxMs"|"activeReplyDelayMinMs"|"activeReplyDelayMaxMs"|"activeDurationEnabled"|"activeDurationMinMs"|"activeDurationMaxMs"|"idleWindowMs"|"idleRetryProbability"|"idleRetryWaitMs"|"proactiveEnabled"|"proactiveIdleThresholdMs"|"proactiveCheckMinMs"|"proactiveCheckMaxMs"|"proactiveProbability"|"skipProbability"|"surrenderProbability"|"maxReplyChars"|"mustReplyKeywords"|"burstEnabled"|"burstIntervalMinMs"|"burstIntervalMaxMs"|"longGapProbability"|"longGapMinMs"|"longGapMaxMs">;
export type RawTools = RawFields<"getPrompt"|"getUnread"|"getRecent"|"socialState"|"sendGroup"|"sendPrivate"|"reply"|"sendBurst"|"sendMessage"|"waitMessages"|"feedback"|"getMyRecent"|"getMessageDetail"|"getActiveMembers"|"setWakeConfig"|"markRead"|"memory"|"getImages"|"getForwardMsg"|"sendPoke"|"listStickers"|"getStickerImage"|"sendSticker"|"setStickerRemark"|"stickerNote"|"collectSticker"|"getSelfImage"|"slangQuery"|"slangSubmit"|"sendVoice">;
export type RawVoice = RawFields<"enabled"|"dir"|"maxSeconds"|"maxBytes"|"maxPerMinute"|"maxPerHour"|"allowAbsolutePath"|"defaultVolume"|"loudness"|"ffmpegPath"|"autoReadback">;
export type RawCollect = RawFields<"enabled"|"maxPerMinute"|"maxPerHour"|"maxRemarkChars">;
export type RawMedia = RawFields<"maxBytes"|"maxPixels"|"maxCount">;
export type RawRole = RawFields<"maxInjectChars">;
export type RawSticker = RawFields<'enabled'|'syncTtlMs'|'maxListCount'|'includeInPrompt'|'promptMaxStickers'> & {collect?:RawCollect|null};
export type RawWake=RawFields<"defaultMode"|"preSleepWaitEnabled"|"preSleepWaitMs"|"recommendedDefaultInfinite"|"sleepMinMs"|"sleepMaxMs"|"recommendedSleepMinMs"|"recommendedSleepMaxMs"|"recommendedProbability"|"recommendedKeywords"|"recommendedAtMention"|"recommendedNameMention"|"recommendedQuestion"|"recommendedPoke"|"recommendedHint"|"batchWindowMs"|"maxWakePerMinute"|"maxWakePerHour"|"directMaxWakePerMinute"|"directMaxWakePerHour"|"noActionLimit"|"maxWakeConfigReminders">;
export type RawSend=RawFields<"burstEnabled"|"burstMaxMessages"|"burstIntervalMinMs"|"burstIntervalMaxMs"|"longGapProbability"|"longGapMinMs"|"longGapMaxMs"|"maxSendPerMinute"|"maxSendPerHour"|"maxMessageChars"|"maxGapMs"|"gapBaseMs"|"gapPerCharMs"|"recommendedHint">;
export type RawWait=RawFields<"defaultMs"|"minMs"|"maxMs"|"defaultQuietMs"|"minQuietAfterNewMs">;
export type RawProactive=RawFields<"enabled"|"checkIntervalMinMs"|"checkIntervalMaxMs"|"idleThresholdMs"|"probability">;
export type RawFeedback=RawFields<"maxLength"|"notifyOwnerOnError">;
export type RawContext=RawFields<"recentLimit"|"unreadLimit"|"contextWindow"|"inlineWakeMessages"|"wakeMessageLimit"|"wakeRecentLimit"|"wakeMaxChars">;
export type RawSocialV2 = RawFields<"enabled"|"autoReplyCheckMs"|"agentPreset"|"provideRecommendations"|"initialPromptMaxChars"> & {
 tools?:RawTools|null;voice?:RawVoice|null;sticker?:RawSticker|null;media?:RawMedia|null;
 wake?:RawWake|null;send?:RawSend|null;wait?:RawWait|null;
 proactive?:RawProactive|null;feedback?:RawFeedback|null;context?:RawContext|null;
};
interface RawConfiguration extends Record<string,unknown> {dsh?:RawDsh;onebot?:RawOnebot;snowluma?:RawOnebot;security?:RawSecurity;slang?:RawSlang;social?:RawSocial;socialV2?:RawSocialV2;role?:RawRole;
 phone?:{enabled?:unknown;autoAnswer?:unknown};allow?:RawFields<'private'|'privates'|'groups'|'group'>;deny?:RawFields<'private'|'privates'|'groups'|'group'>;}
interface ConfigurationDraft<SocialV2=RawSocialV2> extends Record<string,unknown> {
 dsh:RawDsh & {authTokenExplicit?:boolean};onebot:RawOnebot;security:RawSecurity;slang:RawSlang;social:RawSocial;socialV2:SocialV2;role?:RawRole;
 ownerQQ:number|null;allow:{private:string[];groups:string[]};deny:{private:string[];groups:string[]};allowAllWhenEmpty:boolean;
 phone:{enabled:boolean;autoAnswer:boolean};nativeFeatureProtocol?:number;nativeScope?:NativeScope;
 sessionCwd:unknown;agentPreset:unknown;workspaceTitle:unknown;ackMessage:unknown;sendDelayMs:unknown;questionTimeoutMs:unknown;consolePort:unknown;consoleToken:unknown;pricing:unknown;
}
/** 仅强化本函数真正完成归一化/赋值的字段；其它用户覆盖值继续保留unknown。 */
export type LoadedConfiguration = ConfigurationDraft<RawSocialV2 & {
 tools:RawTools;voice:RawVoice;sticker:RawSticker & {collect:RawCollect};media:RawMedia;initialPromptMaxChars:number}> & {
 dsh:RawDsh & {reasoningEffort:ReasoningEffort;authTokenExplicit:boolean};role:RawRole};
export interface ConfigLoaderDependencies {readonly root:string;readonly readJsonSafe:(file:string,fallback:null,required:true)=>unknown;
 readonly discoverLaunchToken:()=>string;readonly log:(message:string)=>void;readonly setRoleInjectLimit:(value:unknown)=>number;readonly isNativeGateway?:()=>boolean;}
interface ConfigError {message?:unknown;}
import path from 'node:path';
import {normalizeOwnerQQ,normalizeIdList,normalizeReasoningEffort,REASONING_EFFORT_DEFAULT} from './inputs.js';
import {ROLE_INJECT_MAX_CHARS_DEFAULT} from '../roles/role-policy.js';
/**
 * 构造既有配置加载器；显式传入路径与副作用，不读取模块级全局状态。
 * @param {object} options root为配置根目录；readJsonSafe、discoverLaunchToken、log、setRoleInjectLimit为所属实例提供的能力。
 * @returns {function():object} 同步加载并应用角色注入上限；保留历史默认值、合并顺序及错误语义。
 * @throws {Error} 必需配置缺失、损坏或管理员字段非法；不会改写配置文件。
 * @note 构造阶段无IO；调用阶段同步，同一实例负责串行管理配置和角色状态。
 */
export function createConfigLoader({root:ROOT,readJsonSafe,discoverLaunchToken,log,setRoleInjectLimit,
  isNativeGateway=()=>Boolean(process.env.QQ_NATIVE_GATEWAY_STATUS)}:ConfigLoaderDependencies) {
return function loadConfig():LoadedConfiguration {
  const p = path.join(ROOT, 'config.json');
  const file = readJsonSafe(p, null, true) as RawConfiguration|null;
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error(`配置格式错误：${p}`);
  const cfg:ConfigurationDraft = {
    dsh: {
      baseUrl: 'http://127.0.0.1:3080',
      provider: 'deepseek-official',
      // 多模态模型：DeepSeek-V41-Flash（DSH 模型目录里 inputModalities 含 image）。
      // 旧默认 deepseek-v4-flash-vision-exp 已被取代；config.json 未配置时用此兜底。
      model: 'deepseek-flash',
      reasoningEffort: 'max',
      // 兼容新版 DSH 的 API 鉴权：如果 DSH 升级后要求非浏览器客户端带 token，
      // 在这里配置 token；默认走 Authorization: Bearer <token>。
      authToken: '',
      authHeader: 'authorization',
      authPrefix: 'Bearer',
      // 是否允许把 DSH launch token 发往非回环地址（默认 false：那是进程启动凭据）
      allowRemote: false,
      ...(file.dsh ?? {})
    },
    onebot: { wsUrl: 'ws://127.0.0.1:3001', accessToken: '', ...(file.snowluma ?? {}), ...(file.onebot ?? {}) },
    // 空 => 每个会话在 state/agents/<key> 下建独立工作目录
    sessionCwd: file.sessionCwd ?? '',
    agentPreset: file.agentPreset ?? 'qq-chat',
    phone: { enabled: file.phone?.enabled === true, autoAnswer: file.phone?.autoAnswer !== false },
    ...(file.nativeFeatureProtocol === 1 ? { nativeFeatureProtocol: 1 } : {}),
    workspaceTitle: file.workspaceTitle ?? 'QQ 聊天',
    ownerQQ: normalizeOwnerQQ(file.ownerQQ),
    allow: {
      private: normalizeIdList(file.allow?.private ?? file.allow?.privates ?? []),
      groups: normalizeIdList(file.allow?.groups ?? file.allow?.group ?? [])
    },
    deny: {
      private: normalizeIdList(file.deny?.private ?? file.deny?.privates ?? []),
      groups: normalizeIdList(file.deny?.groups ?? file.deny?.group ?? [])
    },
    // 私聊/群聊均未配置白名单时是否放行所有（true 时启动会打警告）
    allowAllWhenEmpty: file.allowAllWhenEmpty === true,
    ackMessage: file.ackMessage ?? '🤔 收到，正在思考…',
    sendDelayMs: file.sendDelayMs ?? 300,
    questionTimeoutMs: file.questionTimeoutMs ?? 5 * 60 * 1000,
    consolePort: file.consolePort ?? 3100,
    consoleToken: file.consoleToken ?? '',
    // 价目表覆盖项（可选）。留空即用 src/model-prices.js 的官方默认价。
    pricing: file.pricing ?? null,
    security: {
      interceptNotify: true,
      ...(file.security ?? {})
    },
    slang: {
      enabled: true,
      extractMinMessages: 10,
      extractCooldownMs: 5 * 60 * 1000,
      inferenceThresholds: [2, 4, 8],
      injectMax: 8,
      learnerPreset: 'qq-chat',
      workspaceTitle: 'QQ 黑话学习',
      autoResearch: true,
      ...(file.slang ?? {})
    },
    social: {
      enabled: true,
      // 启动阶段（观望）
      triggerProbability: 0.1,        // 普通消息触发进入活跃的概率
      contextWindow: 20,              // 触发/活跃回复时附带的上下文条数
      // 活跃阶段（对话进行中）
      activeCheckMinMs: 10 * 1000,    // 活跃期检测间隔范围（当前控制台保存值）
      activeCheckMaxMs: 30 * 1000,
      activeReplyDelayMinMs: 2 * 1000, // 活跃期回复延迟范围（当前控制台保存值）
      activeReplyDelayMaxMs: 8 * 1000,
      // 活跃超时主动退出（防止活跃群中一直保持活跃）
      activeDurationEnabled: true,     // 总开关：是否启用“活跃超过时长后主动收尾退场”
      activeDurationMinMs: 15 * 60 * 1000, // 活跃状态最长持续时间下限（进入活跃那一刻起算，分钟）
      activeDurationMaxMs: 30 * 60 * 1000, // 活跃状态最长持续时间上限（分钟）
      // 冷场处理
      idleWindowMs: 6 * 60 * 1000,    // 活跃期多久没人说话算冷场
      idleRetryProbability: 0.25,     // 冷场时 AI 继续说一句（试探群友意愿）的概率
      idleRetryWaitMs: 2 * 60 * 1000, // 试探后等待回应的窗口，仍无人说话则 100% 回观望
      // 二期：观望阶段主动开话题（第三种触发）
      proactiveEnabled: true,         // 总开关
      proactiveIdleThresholdMs: 30 * 60 * 1000, // 群安静多久才进入可判定状态
      proactiveCheckMinMs: 45 * 60 * 1000,      // 判定间隔范围
      proactiveCheckMaxMs: 90 * 60 * 1000,
      proactiveProbability: 0.2,      // 每次判定的成功概率（小概率开口）
      // 选择性沉默/退让
      skipProbability: 0.15,          // 普通闲聊沉默概率（当前控制台保存值）
      surrenderProbability: 0,        // 已弃用：桥接不再直接生成退让短句（避免割裂），保留字段兼容旧配置
      // 摘要与展示
      maxReplyChars: 500,             // 单条 QQ 消息安全长度上限（防 AI 出 bug；分句交给 AI 用空格控制）
      mustReplyKeywords: ['deepseek', '小鲸鱼', '大肥鱼', '鲸鱼', 'd指导', '在吗'],
      // 真人式多消息分条发送：按空格分句，AI 用空格表示“这里要分成下一条”
      burstEnabled: true,             // 总开关：是否允许按空格拆成多条 QQ 消息
      burstIntervalMinMs: 1000,       // 条间随机间隔下限（毫秒）
      burstIntervalMaxMs: 3000,       // 条间随机间隔上限（毫秒）
      longGapProbability: 0.1,        // 长间隔概率（当前控制台保存值）
      longGapMinMs: 2500,             // 长间隔下限（当前控制台保存值）
      longGapMaxMs: 5000,             // 长间隔上限（当前控制台保存值）
      ...(file.social ?? {})
    },
    socialV2: {
      enabled: true,
      autoReplyCheckMs: 30000,
      agentPreset: 'qq-chat-v2',
      provideRecommendations: true,
      tools: {
        getPrompt: true,
        getUnread: true,
        getRecent: true,
        socialState: true,
        sendGroup: true,
        sendPrivate: true,
        reply: true,
        sendBurst: true,
        sendMessage: true,
        waitMessages: true,
        feedback: true,
        getMyRecent: true,
        getMessageDetail: true,
        getActiveMembers: true,
        setWakeConfig: true,
        markRead: true,
        memory: true,
        getImages: true,
        getForwardMsg: true,
        sendPoke: true,
        listStickers: true,
        getStickerImage: true,
        sendSticker: true,
        setStickerRemark: false,
        stickerNote: true,
        collectSticker: true,
        getSelfImage: true
      },
      wake: {
        defaultMode: 'diving',
        preSleepWaitEnabled: true,      // 沉睡前强制观察窗口开关：防止 AI 聊两句就潜水
        preSleepWaitMs: 300000,          // 默认沉睡前至少等待/观察 5 分钟（后台可调）
        recommendedDefaultInfinite: true, // 默认下一次唤醒是否无限期（true=永久潜水等条件；false=有限时长）
        sleepMinMs: 60000,
        sleepMaxMs: 0,
        recommendedSleepMinMs: 300000,
        recommendedSleepMaxMs: 7200000,
        recommendedProbability: 0.05,
        recommendedKeywords: ['小鲸鱼', 'DeepSeek', 'deepseek', 'DS', 'D老师', 'd老师', 'D指导', 'd指导', 'D师傅', 'd师傅', '深度求索', '大肥鱼', '鲸鱼', 'DeepSeek V3', 'DeepSeek R1', 'R1'],
        recommendedAtMention: true,
        recommendedNameMention: true,
        recommendedQuestion: true,
        recommendedPoke: true,
        recommendedHint: '【后台观察回执优先】qq_wait_for_messages 返回 background=true 时，后台已经接管观察，必须立即结束本轮；不要重复等待，也不要立即调用 qq_mark_read 或 qq_set_wake_config。后台静默到期不调用模型，新消息才会合并后唤醒。此回执优先于下文前台等待和收尾规则，未读水位不因后台交接而确认。如果你要潜水，推荐先调用 qq_wait_for_messages(timeoutMs=300000) 完成一次沉睡前观察：5 分钟内没人说话就可以设置下一次唤醒并沉睡；若期间有人发新消息，先查看 newMessages，判断不需要你参与可直接沉睡，若参与了则下次想睡需再等观察窗口。潜水时长推荐 5~120 分钟，普通消息概率 0.05；@/名字/关键词/提问唤醒建议保持开启。需要等特定某人/某几人时，可额外设置 triggers.speakerIds。',
        batchWindowMs: 2000,
        maxWakePerMinute: 1,
        maxWakePerHour: 12,
        directMaxWakePerMinute: 12,
        directMaxWakePerHour: 120,
        noActionLimit: 3,
        maxWakeConfigReminders: 2
      },
      send: {
        burstEnabled: true,
        burstMaxMessages: 8,
        burstIntervalMinMs: 1000,
        burstIntervalMaxMs: 3000,
        longGapProbability: 0.2,
        longGapMinMs: 5000,
        longGapMaxMs: 10000,
        maxSendPerMinute: 8,
        maxSendPerHour: 60,
        maxMessageChars: 500,
        maxGapMs: 10000,
        gapBaseMs: 800,
        gapPerCharMs: 20,
        recommendedHint: '普通闲聊建议一次 1~3 条，条间 1~3 秒；讲故事/回忆可以 5~10 秒间隔；不要连续刷屏。'
      },
      wait: {
        defaultMs: 30000,
        minMs: 5000,
        maxMs: 600000,
        defaultQuietMs: 3000,
        minQuietAfterNewMs: 3000    // 从最后来信补足3秒静默；连续短消息合并处理
      },
      sticker: {
        enabled: true,             // 表情包体系总开关
        syncTtlMs: 60000,          // QQ 收藏表情刷新缓存 TTL（毫秒）
        maxListCount: 100,         // qq_list_stickers 单次最大返回数
        includeInPrompt: true,     // 是否在 qq_get_prompt / 唤醒提示里附带表情摘要与策略
        promptMaxStickers: 8,      // 提示里最多列出的常用表情数
        collect: {
          enabled: true,           // AI 收藏他人表情总开关
          maxPerMinute: 2,         // 每分钟最多收藏次数
          maxPerHour: 10,          // 每小时最多收藏次数
          maxRemarkChars: 20       // 收藏时备注最大长度
        }
      },
      proactive: {
        enabled: true,
        checkIntervalMinMs: 30 * 60 * 1000,
        checkIntervalMaxMs: 90 * 60 * 1000,
        idleThresholdMs: 15 * 60 * 1000,
        probability: 0.3
      },
      feedback: {
        maxLength: 500,
        notifyOwnerOnError: false
      },
      context: {
        recentLimit: 100,
        unreadLimit: 30,
        contextWindow: 20,
        inlineWakeMessages: true,
        wakeMessageLimit: 12,
        wakeRecentLimit: 4,
        wakeMaxChars: 6000
      },
      // 操作者在控制台为单个会话预写的「初始提示词」的字数上限（只在首次唤醒时注入一次）。
      // 它不是安全边界，只是防止误粘贴一篇长文把首次唤醒的 prompt 撑爆。
      initialPromptMaxChars: 2000,
      // 图片/表情（含动图）的数量与体积上限。QQ 的动图表情常见 1~4MB，
      // 旧的 4MB 单条总上限会误伤；这里默认 8MB，仍受 DSH 的 20MB/64MP 限制约束。
      media: {
        maxBytes: 8 * 1024 * 1024,
        maxPixels: 64_000_000,
        maxCount: 5
      },
      ...(file.socialV2 ?? {})
    }
  };

  // socialV2.tools 需要与默认值深度合并：旧 config.json 若缺少新增工具开关，
  // 不能因为外层 spread 覆盖而丢失默认开关。
  cfg.socialV2.tools = {
    getPrompt: true,
    getUnread: true,
    getRecent: true,
    socialState: true,
    sendGroup: true,
    sendPrivate: true,
    reply: true,
    sendBurst: true,
    sendMessage: true,
    waitMessages: true,
    feedback: true,
    getMyRecent: true,
    getMessageDetail: true,
    getActiveMembers: true,
    setWakeConfig: true,
    markRead: true,
    memory: true,
    slangQuery: true,
    slangSubmit: true,
    getImages: true,
    getForwardMsg: true,
    sendPoke: true,
    listStickers: true,
    getStickerImage: true,
    sendSticker: true,
    setStickerRemark: false,
    stickerNote: true,
    collectSticker: true,
    getSelfImage: true,
    sendVoice: false,
    ...(cfg.socialV2.tools ?? {})
  };

  // socialV2.voice：语音发送（把准备好的音频文件当 QQ 语音发出去）。
  // dir 为相对仓库根目录的语音库路径；AI 的 qq_send_voice 默认只能从这个目录取文件，
  // 绝对路径需要显式开 allowAbsolutePath（默认关，避免 prompt injection 读到任意本地文件）。
  //
  // 默认**关闭**（enabled/sendVoice 均为 false）：语音是"开口说话"的强表达，且需要你先准备好
  // 语音库内容。没放音频就让 AI 发语音只会得到一串错误。把音频放进 audio/ 后，
  // 在控制台「二代仿真 → 语音库与语音发送」里打开开关即可。
  cfg.socialV2.voice = {
    enabled: false,
    dir: 'audio',
    maxSeconds: 300,
    maxBytes: 20 * 1024 * 1024,
    maxPerMinute: 2,
    maxPerHour: 10,
    allowAbsolutePath: false,
    // 音量：默认倍数（1 = 原样）+ 智能音量档位 + ffmpeg 位置（空 = 走 PATH）。
    // OneBot兼容通道 的 record 段没有增益字段，所以音量必须在本地先调好再发。
    defaultVolume: 1,
    loudness: 'normal',
    ffmpegPath: '',
    autoReadback: true,
    ...(cfg.socialV2?.voice ?? {})
  };

  // socialV2.sticker.collect 也需要深度合并，避免旧配置缺失 collect 子项时丢默认值。
  cfg.socialV2.sticker = {
    enabled: true,
    syncTtlMs: 60000,
    maxListCount: 100,
    includeInPrompt: true,
    promptMaxStickers: 8,
    ...{collect: {
      enabled: true,
      maxPerMinute: 2,
      maxPerHour: 10,
      maxRemarkChars: 20,
      ...((cfg.socialV2?.sticker?.collect) ?? {})
    }},
    ...(cfg.socialV2?.sticker ?? {}),
    collect: {
      enabled: true,
      maxPerMinute: 2,
      maxPerHour: 10,
      maxRemarkChars: 20,
      ...((cfg.socialV2?.sticker?.collect) ?? {})
    }
  };

  // socialV2.media：图片/表情的数量与体积上限。旧配置没有这一段，必须深度合并出默认值，
  // 否则 `{...defaults, ...file.socialV2}` 里缺失的 media 会取到 undefined（等于无上限判断）。
  cfg.socialV2.media = {
    maxBytes: 8 * 1024 * 1024,
    maxPixels: 64_000_000,
    maxCount: 5,
    ...((cfg.socialV2?.media && typeof cfg.socialV2.media === 'object' && !Array.isArray(cfg.socialV2.media)) ? cfg.socialV2.media : {})
  };

  // socialV2.initialPromptMaxChars：会话「初始提示词」的字数上限。config.json 是用户可编辑的，
  // 手工写进字符串/负数/超大值时要收敛到安全区间，否则要么保存接口永远报"过长"，要么等于没上限。
  {
    const raw = Number(cfg.socialV2?.initialPromptMaxChars);
    cfg.socialV2.initialPromptMaxChars = Number.isFinite(raw) && raw > 0
      ? Math.min(8000, Math.max(100, Math.round(raw)))
      : 2000;
  }

  // DSH 0.1.7 起 launch token 是**每进程现生成的 32 字节随机数，只存在内存里**，
  // 不落盘、不可推导；只有启动器把 `dsh web` 的 stdout 重定向到文件时才能从日志读到。
  // 所以这里发现的 token 只是兜底，主路径是客户端用 ~/.dsh 里持久化的签名密钥
  // 离线铸造会话 Cookie（见 dsh-client 的 mintBrowserSessionCookie）。
  // authTokenExplicit 记录「token 是用户填的还是这里猜的」，客户端据此排优先级。
  cfg.dsh.authTokenExplicit = Boolean(cfg.dsh.authToken);
  if (!isNativeGateway() && !cfg.dsh.authToken) cfg.dsh.authToken = discoverLaunchToken();

  // 思考强度可能被手工改成非法值（config.json 是用户可编辑的）。DeepSeek 适配器对非法值
  // 会硬拒绝，若直接透传会让每个会话的 selectModel 每次都失败；这里统一规范化并告警。
  try {
    cfg.dsh.reasoningEffort = normalizeReasoningEffort(cfg.dsh.reasoningEffort ?? REASONING_EFFORT_DEFAULT);
  } catch (error) {
    log(`⚠️ config.json 的 dsh.reasoningEffort「${cfg.dsh.reasoningEffort}」非法，已回退 ${REASONING_EFFORT_DEFAULT}（${(error as ConfigError|null)?.message ?? error}）`);
    cfg.dsh.reasoningEffort = REASONING_EFFORT_DEFAULT;
  }

  // 人格卡注入上限（字符）。历史硬编码 6000，现在可配：每条约 4~6k token 的成本护栏。
  cfg.role = { maxInjectChars: ROLE_INJECT_MAX_CHARS_DEFAULT, ...(file.role ?? {}) };
  const roleInjectMaxChars = setRoleInjectLimit(cfg.role.maxInjectChars);
  if (roleInjectMaxChars !== cfg.role.maxInjectChars) {
    log(`人格注入上限已按范围校正为 ${roleInjectMaxChars} 字符（配置值 ${cfg.role.maxInjectChars}，允许 1000~20000）`);
  }

  return cfg as LoadedConfiguration;
}

}
