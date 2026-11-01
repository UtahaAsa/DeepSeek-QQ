// Generated from storage/json-files.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
/**
 * 创建同步JSON/文本持久化能力，构造不访问文件。
 * @param deps 文件、随机临时名及同步退避能力；只在方法调用时使用。
 * @returns 必需读取失败抛错，非必需读取返回原fallback；写入失败清理临时文件后保留原异常。
 * @note 沿用唯一临时文件和有界rename重试，同一线程同步执行。
 */
export function createJsonFiles(deps) {
    // 读取 JSON 文件并容错：Windows 下常见 UTF-8 BOM（\uFEFF）会令 JSON.parse 失败。
    // required=true 时文件缺失或解析失败直接抛错（用于启动必需配置，fail-fast）。
    function readJsonSafe(file, fallback, required = false) {
        try {
            let text = deps.fs.readFileSync(file, 'utf8');
            if (text.charCodeAt(0) === 0xFEFF)
                text = text.slice(1);
            return JSON.parse(text);
        }
        catch (error) {
            if (required)
                throw new Error(`配置文件读取/解析失败：${file}（${error?.message ?? error}）`);
            return fallback;
        }
    }
    /**
     * 读取 config.json，并保证拿到一个**可安全改写的普通对象**。
     *
     * 为什么不是 `readJsonSafe(file, null, true) ?? {}`：控制台这些端点都是
     * 「读整份 config → 改一个字段 → 原子写回」。JSON.parse 对字面量 `null` 是**成功**的，
     * 于是 `file` 可能是 null：`file.socialV2` 直接 TypeError（保存接口 500，且错误信息
     * 完全指不出"配置文件顶层是 null"）；而用 `?? {}` 兜底更糟 —— 回写会把整份配置替换成
     * 只含本次提交字段的新对象，用户的白名单、令牌、模式全被抹掉。
     * 所以：不是普通对象就抛错，让调用方的 try/catch 返回 500（与各端点注释里
     * "配置文件损坏时直接 500，绝不回写" 的既有约定一致）。
     */
    function readConfigObject(file) {
        const parsed = readJsonSafe(file, null, true);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            const kind = parsed === null ? 'null' : Array.isArray(parsed) ? '数组' : typeof parsed;
            throw new Error(`config.json 顶层不是对象（实际是 ${kind}），已拒绝改写以免覆盖整份配置：${file}`);
        }
        return parsed;
    }
    /**
     * 原子替换：`fs.renameSync` 覆盖一个「正被别人打开」的目标，在 Windows 上会抛 EPERM
     * （Defender / 编辑器 / 资源管理器预览 / 云同步都可能在这个窗口里碰它）。
     * 实测本机可复现。这里退避重试几次；实在不行才抛，让调用方决定怎么提示。
     */
    function renameWithRetry(from, to, attempts = 4) {
        let lastError;
        for (let i = 0; i < attempts; i += 1) {
            try {
                deps.fs.renameSync(from, to);
                return;
            }
            catch (error) {
                lastError = error;
                if (error?.code !== 'EPERM' && error?.code !== 'EBUSY' && error?.code !== 'EACCES')
                    throw error;
                // 同步忙等一小会儿：调用点大多在启动/收尾路径，不值得为它改成异步。
                try {
                    deps.Atomics.wait(new deps.Int32Array(new deps.SharedArrayBuffer(4)), 0, 0, 40 * (i + 1));
                }
                catch { }
            }
        }
        throw lastError;
    }
    // 原子写 JSON 文件：先写唯一临时文件再 rename，避免进程中断写坏配置，也避免固定临时名被并发/符号链接攻击利用。
    function atomicWriteJson(file, obj) {
        deps.fs.mkdirSync(deps.path.dirname(file), { recursive: true });
        const tmp = `${file}.${deps.process.pid}.${deps.crypto.randomBytes(6).toString('hex')}.tmp`;
        try {
            deps.fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
            renameWithRetry(tmp, file);
        }
        catch (error) {
            // 失败时别把随机名临时文件留在 state/ 里当垃圾。
            try {
                deps.fs.unlinkSync(tmp);
            }
            catch { }
            throw error;
        }
    }
    // 原子写文本文件。
    function atomicWriteText(file, text) {
        deps.fs.mkdirSync(deps.path.dirname(file), { recursive: true });
        const tmp = `${file}.${deps.process.pid}.${deps.crypto.randomBytes(6).toString('hex')}.tmp`;
        try {
            deps.fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
            renameWithRetry(tmp, file);
        }
        catch (error) {
            try {
                deps.fs.unlinkSync(tmp);
            }
            catch { }
            throw error;
        }
    }
    return { readJsonSafe, readConfigObject, renameWithRetry, atomicWriteJson, atomicWriteText };
}
