// Generated from voice/library.ts. Edit the TypeScript source and run build:typed.
/**
 * 提供语音配置、文件列表与模型/操作者路径解析，构造无IO。
 * @param deps 所属配置和文件解析能力，不引入新的读取或外发目录。
 * @returns 同步解析接口；拒绝条件与原异常保持一致，不处理音频或发送消息。
 */
export function createVoiceLibrary(deps) {
    function voiceCfg() {
        const v = deps.cfg.socialV2?.voice ?? {};
        return {
            enabled: v.enabled !== false,
            dir: deps.path.resolve(deps.ROOT, String(v.dir ?? 'audio')),
            maxSeconds: Number(v.maxSeconds) > 0 ? Number(v.maxSeconds) : 300,
            maxBytes: Number(v.maxBytes) > 0 ? Number(v.maxBytes) : 20 * 1024 * 1024,
            maxPerMinute: Number(v.maxPerMinute) >= 0 ? Number(v.maxPerMinute) : 2,
            maxPerHour: Number(v.maxPerHour) >= 0 ? Number(v.maxPerHour) : 10,
            allowAbsolutePath: v.allowAbsolutePath === true,
            defaultVolume: Number(v.defaultVolume) > 0 ? Number(v.defaultVolume) : 1,
            loudness: v.loudness || 'normal',
            ffmpegPath: deps.process.env.FFMPEG_PATH || v.ffmpegPath || null,
            autoReadback: v.autoReadback !== false
        };
    }
    function voiceLibrary() {
        const dir = voiceCfg().dir;
        const files = (0, deps.listAudioFiles)(dir);
        return files.map((f) => {
            let stat = null;
            try {
                stat = deps.fs.statSync(f);
            }
            catch { }
            return { name: deps.path.relative(dir, f).split(deps.path.sep).join('/'), bytes: stat?.size ?? 0, mtimeMs: stat?.mtimeMs ?? 0 };
        });
    }
    function voicePathInsideLibrary(vc, absPath) {
        const rel = deps.path.relative(vc.dir, absPath);
        if (!rel || rel.startsWith('..') || deps.path.isAbsolute(rel))
            return null;
        if (!deps.fs.existsSync(absPath) || !deps.fs.statSync(absPath).isFile())
            return null;
        return (0, deps.safeJoinLibrary)(vc.dir, rel);
    }
    function resolveVoicePathForV2(input) {
        const vc = voiceCfg();
        const raw = String(input ?? '').trim();
        if (!raw)
            throw new Error('缺少音频：给语音库里的文件名（可用 qq_list_voices 查看）');
        if (/^(base64:\/\/|data:|https?:\/\/)/i.test(raw)) {
            throw new Error('语音只接受语音库里的本地文件；不接受 base64://、data: 或 http(s):// 来源');
        }
        const isAbs = deps.path.isAbsolute(raw) || /^file:\/\//i.test(raw) || raw.startsWith('~');
        let resolved = null;
        if (isAbs) {
            const r = (0, deps.resolveAudioSource)(raw, {});
            const confined = r.path ? voicePathInsideLibrary(vc, r.path) : null;
            if (confined) {
                resolved = { path: confined, via: `${r.via}+library-confined` };
            }
            else {
                // 只报目录名，不报绝对路径：这条消息会经 MCP 工具错误回给模型，
                // 而模型面对的是不可信的群聊内容（prompt injection 可能诱导它复述本机路径）。
                throw new Error(`语音只能从语音库取文件（语音库目录：${deps.path.basename(vc.dir)}）；即使是绝对路径也必须位于语音库之内（socialV2.voice.allowAbsolutePath 已不再放宽 AI 通道）。请把音频放进语音库，或用操作者通道（CLI / 控制台）发送库外文件。`);
            }
        }
        else {
            // ⚠️ 安全关键：相对路径**只能**在语音库内解析。
            //
            // 不能直接丢给 resolveAudioSource —— 它会**先用 process.cwd() 解析相对路径**
            // （voice-core.js 的 cwd 分支），于是 AI 传 `..\..\某个\本机文件.mp3` 就能读库外文件，
            // 把 allowAbsolutePath=false 这个闸门整个绕过去（实测可复现）。
            // 相对路径一律先过 safeJoinLibrary（含 realpath 复核，挡 symlink 逃逸）。
            const joined = (0, deps.safeJoinLibrary)(vc.dir, raw);
            if (joined && deps.fs.existsSync(joined) && deps.fs.statSync(joined).isFile()) {
                resolved = { path: joined, via: 'voice-dir-safe' };
            }
            else {
                // 允许省略扩展名：逐个补常见扩展名再在库内试一次（仍然不越出语音库）
                if (!deps.path.extname(raw)) {
                    for (const ext of deps.AUDIO_EXTS) {
                        const cand = (0, deps.safeJoinLibrary)(vc.dir, `${raw}${ext}`);
                        if (cand && deps.fs.existsSync(cand) && deps.fs.statSync(cand).isFile()) {
                            resolved = { path: cand, via: 'voice-dir-safe+ext' };
                            break;
                        }
                    }
                }
                if (!resolved) {
                    // 库内没找到：检查是不是"想读库外文件"（这条错误要说清楚，避免误以为是名字写错）
                    const looksLikeEscape = /(^|[\\/])\.\.([\\/]|$)/.test(raw) || deps.path.isAbsolute(raw);
                    if (looksLikeEscape) {
                        throw new Error('语音只能从语音库取文件：路径里出现了「..」或绝对路径，已拒绝（防止读到库外的本机文件）');
                    }
                }
            }
        }
        if (resolved)
            return { path: resolved.path, via: resolved.via, resolvedFrom: raw };
        // 模糊提示：只列库内文件（绝不回显库外路径）
        const library = voiceLibrary();
        const hint = library.length
            ? `语音库里现有：${library.slice(0, 12).map((x) => x.name).join('、')}${library.length > 12 ? ` 等 ${library.length} 个` : ''}`
            : `语音库（${deps.path.basename(vc.dir)}）目前是空的，先把音频文件放进去`;
        // 按 basename 去扩展名做近似匹配（只用于提示）
        const want = deps.path.basename(raw).toLowerCase();
        const wantNoExt = want.replace(/\.[^.]+$/, '');
        const fuzzyHits = library
            .filter((x) => {
            const base = deps.path.basename(x.name).toLowerCase();
            return base === want || base.replace(/\.[^.]+$/, '') === wantNoExt;
        })
            .map((x) => x.name);
        const fuzzy = fuzzyHits.length ? `；近似匹配：${fuzzyHits.join('、')}` : '';
        throw new Error(`语音库里找不到「${raw}」${fuzzy}。${hint}`);
    }
    function resolveVoicePathForOperator(input) {
        const vc = voiceCfg();
        const raw = String(input ?? '').trim();
        if (!raw)
            throw new Error('缺少音频路径');
        if (/^(base64:\/\/|data:|https?:\/\/)/i.test(raw)) {
            throw new Error('语音只接受本地文件；不接受 base64://、data: 或 http(s):// 来源');
        }
        const r = (0, deps.resolveAudioSource)(raw, { voiceDir: vc.dir });
        if (r.path)
            return { path: r.path, via: r.via, resolvedFrom: raw };
        const fuzzy = r.candidates?.length ? `；语音库近似匹配：${r.candidates.map((c) => deps.path.basename(c.path)).join('、')}` : '';
        throw new Error(`找不到音频「${raw}」${fuzzy}`);
    }
    return { voiceCfg, voiceLibrary, voicePathInsideLibrary, resolveVoicePathForV2, resolveVoicePathForOperator };
}
