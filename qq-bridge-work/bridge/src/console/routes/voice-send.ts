import type {PlatformPath} from 'node:path';
import type {NamedConsoleRoutes} from './contracts.js';
import type {ConsoleRequestHead} from '../request-context.js';
/** 仅建模既有配置切片；网关配置值不提前视为已验证字符串。 */
export interface VoiceSendConfiguration {allow?: {groups?: unknown[]; private?: unknown[]}; onebot?: {httpUrl?: unknown; accessToken?: unknown};}
/** 宿主已完成默认值及数值转换的语音设置，响度仍由音量解析器验证。 */
export interface VoiceSendSettings {
 enabled: boolean; dir: string; maxSeconds: number; maxBytes: number; maxPerMinute: number; maxPerHour: number;
 defaultVolume: number; loudness: unknown;
}
/** 路径解析失败通过原异常路径响应；成功只承诺解析器输出的路径及来源。 */
export interface ResolvedVoicePath {path: string; via: string;}
/** 来自现有探测器的结果切片；失败时可没有大小、时长或编码信息。 */
export interface VoiceAudioProbe {ok: boolean; size?: number; duration?: number | null; codec?: unknown; warnings?: string[]; error?: unknown;}
/** 请求参数仍保留unknown，是否归一化已由路由严格布尔比较。 */
export interface VoiceAudioOptions {volume: unknown; normalize: boolean; loudness: unknown;}
/** 网关消息标识不保证已验证；回读确认与发送成功分开表示。 */
export interface VoiceSendReceipt {messageId: unknown; detail: string; audioMode: string; audioProcessing: string; volume: number; loudness: unknown;}
/** 回读可能失败；confirmed只用于严格比较，不把发送回执视为已验证证据。 */
export interface VoiceVerification {confirmed: boolean;}
/** 模型通道发送结果含路径供路由取basename，回读正文仍是网关未知载荷。 */
export interface AgentVoiceReceipt extends VoiceSendReceipt {file: string; verification: VoiceVerification | null; readback: unknown; warnings: string[];}
/** 操作者发送、模型发送及库查询继续采用宿主命名路由契约。 */
export type VoiceSendRoutes = NamedConsoleRoutes<'postVoiceSend'|'postSocialV2SendVoice'|'getSocialV2Voices'>;
/** 构造无IO；路径解析和额度检查同步，探测、发送及落地验证保留Promise。 */
export interface VoiceSendDependencies<Configuration extends VoiceSendConfiguration, Probe extends VoiceAudioProbe = VoiceAudioProbe> {
 readonly cfg: Configuration; readonly currentMode: string; readonly voiceCfg: () => VoiceSendSettings;
 readonly parseTargetKey: (key: string) => {kind: string; id: string} | null;
 readonly modeAllowed: (key: string, kind: string, id: number, cfg: Configuration, mode: string) => boolean;
 readonly resolveVoicePathForOperator: (input: unknown) => ResolvedVoicePath; readonly resolveVoicePathForV2: (input: unknown) => ResolvedVoicePath;
 readonly resolveAudioProcessing: (options: VoiceAudioOptions) => unknown;
 readonly inspectAudio: (file: string, limits: {maxBytes: number; maxSeconds: number}) => Promise<Probe>;
 readonly describeAudio: (info: Probe) => string;
 readonly voiceBudgetCheck: (key: string, settings: VoiceSendSettings) => void; readonly voiceBudgetCommit: (key: string, at: number) => void;
 readonly sendVoiceV2: (key: string, file: string, options: {guard: false; audit: true; audio: VoiceAudioOptions; budgetScope:'operator:cli'}) => Promise<VoiceSendReceipt>;
 readonly verifyVoiceMessageSent: (messageId: unknown) => Promise<VoiceVerification | null>;
 readonly sendVoiceForV2: (key: string, voiceRef: unknown, options: {label: string; verify: unknown; readback: boolean; audio: VoiceAudioOptions | null}) => Promise<AgentVoiceReceipt>;
 readonly log: (...values: unknown[]) => void; readonly appendActivity: (message: string) => void;
 readonly path: Pick<PlatformPath,'basename'|'relative'|'sep'>; readonly listAudioFiles: (dir: string) => string[];
 readonly agentTokenOk: (key: string, token: NonNullable<ConsoleRequestHead['headers'][string]>) => boolean;
 readonly v2ToolEnabled: (tool: string) => boolean; readonly v2SessionAllowed: (key: string) => boolean; readonly shouldBlockSilentReply: (key: string) => boolean;
}
/** 旧错误和回读字段假设只作类型标注，不新增JSON或异常校验。 */
interface LegacyVoiceError {message?: unknown;}
interface LegacyVoiceReadback {status?: unknown; retcode?: unknown; data?: {text?: unknown};}
interface VoiceListEntry {name: string; ok?: boolean; bytes?: number; detail?: string | null; seconds?: number | null; error?: unknown;}
/**
 * voice-send功能路由；宿主统一执行鉴权、只读检查和错误响应。
 * @param {object} deps 显式依赖视图，属性访问读取当前值；只对原代码写入的绑定提供setter。
 * @returns {object} 命名路由，每项matches同步匹配，handle处理请求；构造无IO。
 * @note 宿主按原顺序匹配后调用handle，不匹配不产生异步让步。依赖：voiceCfg, parseTargetKey, modeAllowed, cfg, currentMode, resolveVoicePathForOperator, resolveAudioProcessing, inspectAudio, describeAudio, voiceBudgetCheck, sendVoiceV2, voiceBudgetCommit, log, path, appendActivity, verifyVoiceMessageSent, agentTokenOk, v2ToolEnabled, v2SessionAllowed, shouldBlockSilentReply, resolveVoicePathForV2, sendVoiceForV2, listAudioFiles。
 */
export function createVoiceSendRoutes<Configuration extends VoiceSendConfiguration, Probe extends VoiceAudioProbe>(deps: VoiceSendDependencies<Configuration, Probe>): VoiceSendRoutes {
  return {
    postVoiceSend: {
      matches: (req, url) => req.method === 'POST' && (url.pathname === '/api/voice/send' || url.pathname === '/api/send/voice'),
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const agentToken = String(req.headers['x-agent-token'] ?? '').trim();
        const voice = (0, deps.voiceCfg)();
        // 注意：这里是**操作者通道**（CLI / 控制台面板 / 图形界面），由控制台令牌鉴权。
        // socialV2.voice.enabled 是「AI 能不能发语音」的总闸，不该连你手动试发一起关掉——
        // 否则"默认不启用"会变成"谁都发不了"，连放音频试一下都做不到。
        // AI 通道的开关在 /api/socialV2/send-voice 里单独判定。
        // /api/send/voice 是 AI 工具入口：带 agent token 时一律按 agent 规则走，
        // 避免 AI 借用操作者通道绕过「只能发自己会话」的限制。
        if (url.pathname === '/api/send/voice' && agentToken) {
          sendJson({
            ok: false,
            error: 'AI 请改用 /api/socialV2/send-voice（带 key + token）'
          }, 403);
          return;
        }
        const key = String(body.target ?? body.key ?? '').trim();
        const parsedTarget = (0, deps.parseTargetKey)(key);
        if (!parsedTarget) { sendJson({ ok: false, error: 'target 格式应为 group:群号 或 private:QQ号' }, 400); return; }
        if (!(0, deps.modeAllowed)(key, parsedTarget.kind, Number(parsedTarget.id), deps.cfg, deps.currentMode)) {
          const a = deps.cfg.allow ?? {};
          sendJson({
            ok: false,
            error: `目标 ${key} 不在白名单内（config.json allow.groups / allow.private：群 ${(a.groups ?? []).join(', ') || '空'}；私聊 ${(a.private ?? []).join(', ') || '空'}）`
          }, 403);
          return;
        }
        let resolved;
        try {
          resolved = (0, deps.resolveVoicePathForOperator)(body.file ?? body.path ?? '');
        } catch (error) {
          sendJson({ ok: false, error: (error as LegacyVoiceError | null)?.message ?? String(error) }, 400);
          return;
        }
        // 音量参数先校验（写错了当场告诉你，不要等到发的时候才炸）
        try {
          (0, deps.resolveAudioProcessing)({
            volume: body.volume ?? voice.defaultVolume,
            normalize: body.normalize === true,
            loudness: body.loudness ?? voice.loudness
          });
        } catch (error) {
          sendJson({ ok: false, error: (error as LegacyVoiceError).message }, 400);
          return;
        }
        const probe = await (0, deps.inspectAudio)(resolved.path, { maxBytes: voice.maxBytes, maxSeconds: voice.maxSeconds });
        if (!probe.ok) { sendJson({ ok: false, error: probe.error }, 400); return; }
        const preview = {
          key,
          file: resolved.path,
          via: resolved.via,
          bytes: probe.size,
          duration: probe.duration,
          codec: probe.codec,
          detail: (0, deps.describeAudio)(probe),
          warnings: probe.warnings ?? [],
          limits: { maxSeconds: voice.maxSeconds, maxBytes: voice.maxBytes, maxPerMinute: voice.maxPerMinute, maxPerHour: voice.maxPerHour }
        };
        if (body.dryRun === true) { sendJson({ ok: true, dryRun: true, ...preview }); return; }
        try {
          (0, deps.voiceBudgetCheck)('operator:cli', voice);
          const sent = await (0, deps.sendVoiceV2)(key, resolved.path, {
            guard: false,
            audit: true,
            budgetScope: 'operator:cli',
            audio: {
              volume: body.volume ?? voice.defaultVolume,
              normalize: body.normalize === true,
              loudness: body.loudness ?? voice.loudness
            }
          });
          (0, deps.log)(`[voice] (操作者) ${key} 已发送语音 ${deps.path.basename(resolved.path)} (${sent.detail}${sent.audioMode === 'original' ? '' : '，' + sent.audioProcessing}, messageId=${sent.messageId ?? '?'})`);
          (0, deps.appendActivity)(`${key} [voice] (操作者) 发送语音 ${deps.path.basename(resolved.path)} (${sent.detail})`);
          // CLI 默认要落地校验（--verify 之外也能给出可信证据）；readback 仅在做"收到的语音"实验时用。
          const verification = body.verify === false ? null : await (0, deps.verifyVoiceMessageSent)(sent.messageId);
          let readbackText: unknown = null;
          if (body.readback === true && sent.messageId) {
            try {
              const httpUrl = String(deps.cfg.onebot?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
              const res = await fetch(`${httpUrl}/fetch_ptt_text`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  ...(deps.cfg.onebot?.accessToken ? { authorization: `Bearer ${deps.cfg.onebot.accessToken}` } : {})
                },
                body: JSON.stringify({ message_id: String(sent.messageId) }),
                signal: AbortSignal.timeout(30000)
              });
              const rb = await res.json().catch(() => ({})) as LegacyVoiceReadback;
              if (res.ok && rb.status === 'ok' && rb.retcode === 0) readbackText = rb.data?.text ?? '';
            } catch (error) {
              (0, deps.log)(`[voice] 转写回读失败：${(error as LegacyVoiceError | null)?.message ?? error}`);
            }
          }
          sendJson({
            ok: true,
            ...preview,
            messageId: sent.messageId,
            verified: verification?.confirmed === true,
            readback: readbackText,
            audioProcessing: sent.audioProcessing,
            volume: sent.volume,
            loudness: sent.loudness
          });
        } catch (error) {
          sendJson({ ok: false, error: (error as LegacyVoiceError | null)?.message ?? String(error) }, 500);
        }
        return;

      }
    },
    postSocialV2SendVoice: {
      matches: (req, url) => req.method === 'POST' && url.pathname === '/api/socialV2/send-voice',
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const body = await readBody();
        const token = String(body.token ?? req.headers['x-agent-token'] ?? '').trim();
        const key = String(body.key ?? body.target ?? '').trim();
        const voice = (0, deps.voiceCfg)();
        if (!voice.enabled) { sendJson({ ok: false, error: '语音功能已关闭' }, 403); return; }
        if (!key) { sendJson({ ok: false, error: 'key 不能为空（格式 group:群号 或 private:QQ号）' }, 400); return; }
        if (deps.currentMode !== 'reserved2') { sendJson({ ok: false, error: '该接口仅 reserved2 模式可用' }, 403); return; }
        if (!token) { sendJson({ ok: false, error: 'reserved2 模式发送必须携带 agent token' }, 403); return; }
        if (!(0, deps.agentTokenOk)(key, token)) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (!(0, deps.v2ToolEnabled)('sendVoice')) { sendJson({ ok: false, error: '工具未启用：qq_send_voice' }, 403); return; }
        if (!(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if ((0, deps.shouldBlockSilentReply)(key)) { sendJson({ ok: false, error: '静默模式已开启，当前不允许发送' }, 403); return; }
        const keyMatch = /^(group|private):(\d+)$/.exec(key);
        if (!keyMatch) { sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400); return; }
        const kind = keyMatch[1];
        const id = Number(keyMatch[2]);
        if (!Number.isFinite(id) || id <= 0 || !(0, deps.modeAllowed)(key, kind, id, deps.cfg, deps.currentMode)) {
          sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403);
          return;
        }
        // 只要名字（解析）不要内容（预览）：dry-run 也必须经过与真发相同的解析与校验。
        let resolved;
        try {
          resolved = (0, deps.resolveVoicePathForV2)(body.voice ?? body.file ?? '');
        } catch (error) {
          sendJson({ ok: false, error: (error as LegacyVoiceError | null)?.message ?? String(error) }, 400);
          return;
        }
        try {
          (0, deps.voiceBudgetCheck)(key, voice);
          if (body.dryRun === true) {
            const probe = await (0, deps.inspectAudio)(resolved.path, { maxBytes: voice.maxBytes, maxSeconds: voice.maxSeconds });
            if (!probe.ok) { sendJson({ ok: false, error: probe.error }, 400); return; }
            sendJson({ ok: true, dryRun: true, key, file: resolved.path, detail: (0, deps.describeAudio)(probe) });
            return;
          }
          const sent = await (0, deps.sendVoiceForV2)(key, body.voice ?? body.file, {
            label: body.label ? String(body.label).slice(0, 100) : '',
            verify: body.verify,
            readback: body.readback === true,
            // AI 也可以调音量（默认走 config 的 defaultVolume）
            audio: (body.volume !== undefined || body.normalize === true || body.loudness !== undefined)
              ? { volume: body.volume, normalize: body.normalize === true, loudness: body.loudness }
              : null
          });
          sendJson({
            ok: true,
            key,
            messageId: sent.messageId,
            file: deps.path.basename(sent.file),
            detail: sent.detail,
            audioProcessing: sent.audioProcessing,
            // verified=true 表示已用 get_msg 回读到这条消息的 record 段（"真的发出去了"的硬证据）
            verified: sent.verification?.confirmed === true,
            readback: sent.readback,
            warnings: sent.warnings
          });
        } catch (error) {
          // 额度只在真正发出后才记账（voiceBudgetCommit），所以失败路径无需回滚。
          sendJson({ ok: false, error: (error as LegacyVoiceError | null)?.message ?? String(error) }, 500);
        }
        return;

      }
    },
    getSocialV2Voices: {
      matches: (req, url) => req.method === 'GET' && (url.pathname === '/api/socialV2/voices' || url.pathname === '/api/voice/list'),
      async handle({ req, res, url, readBody, sendJson, SECURITY_HEADERS }) {
        const key = String(url.searchParams.get('key') ?? '').trim();
        const voice = (0, deps.voiceCfg)();
        const agentCall = Boolean(req.headers['x-agent-token']);
        // 与发送接口同样的分层：voice.enabled 只关 AI 通道；操作者（控制台面板）仍可列语音库。
        if (agentCall && !voice.enabled) { sendJson({ ok: false, error: '语音功能已关闭' }, 403); return; }
        if (agentCall && !key) { sendJson({ ok: false, error: 'key 不能为空' }, 400); return; }
        if (agentCall && !(0, deps.agentTokenOk)(key, req.headers['x-agent-token'] as NonNullable<ConsoleRequestHead['headers'][string]>)) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return; }
        if (agentCall && !(0, deps.v2SessionAllowed)(key)) { sendJson({ ok: false, error: '目标不在当前模式允许范围内' }, 403); return; }
        if (agentCall && !(0, deps.v2ToolEnabled)('sendVoice')) { sendJson({ ok: false, error: '工具未启用：qq_send_voice' }, 403); return; }
        const wantProbe = url.searchParams.get('probe') !== '0';
        try {
          const files = (0, deps.listAudioFiles)(voice.dir);
          const items = [];
          for (const f of files.slice(0, 100)) {
            const entry: VoiceListEntry = { name: deps.path.relative(voice.dir, f).split(deps.path.sep).join('/') };
            if (wantProbe) {
              const info = await (0, deps.inspectAudio)(f, { maxBytes: voice.maxBytes, maxSeconds: voice.maxSeconds });
              entry.ok = info.ok;
              entry.bytes = info.size;
              entry.detail = info.ok ? (0, deps.describeAudio)(info) : null;
              entry.seconds = info.duration ?? null;
              if (!info.ok) entry.error = info.error;
            }
            items.push(entry);
          }
          sendJson({
            ok: true,
            key: key || null,
            dir: agentCall ? undefined : voice.dir,
            count: items.length,
            voices: items,
            limits: { maxSeconds: voice.maxSeconds, maxBytes: voice.maxBytes, maxPerMinute: voice.maxPerMinute, maxPerHour: voice.maxPerHour },
            // ⚠️ 提示语里也不能出现绝对路径：AI 通道下同样要脱敏（dir 字段已经抑制了，
            // 但这里的模板字符串曾无条件插值 voice.dir —— 等于从旁边的字段又漏出去一次）。
            hint: items.length
              ? '用 qq_send_voice 传 name 即可把其中一个当语音发出去'
              : (agentCall ? '语音库为空：请让管理员先把音频放进语音库' : `语音库为空：把音频文件放进 ${voice.dir} 后重试`)
          });
        } catch (error) {
          sendJson({ ok: false, error: `读取语音库失败：${(error as LegacyVoiceError | null)?.message ?? error}` }, 500);
        }
        return;

      }
    }
  };
}
