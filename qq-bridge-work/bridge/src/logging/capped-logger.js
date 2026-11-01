// Generated from logging/capped-logger.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
/**
 * 创建桥接与活动日志追加器，构造无IO。
 * @param deps 所属日志路径、脱敏、时钟和同步文件能力。
 * @returns 日志、活动摘要及带行数上限的追加器；stdout/文件失败不向业务调用方抛出。
 * @note 首次追加读取行数，超过上限轮转；轮转失败沿旧逻辑截断当前日志。
 */
export function createBridgeLogger(deps) {
    const LOG_LINE_MAX = 1000;
    const appendActivityLog = createCappedLogger(deps.ACTIVITY_LOG, 500);
    const appendBridgeLog = createCappedLogger(deps.BRIDGE_LOG, 2000);
    function readActivityTail(n) {
        try {
            const raw = deps.fs.readFileSync(deps.ACTIVITY_LOG, 'utf8');
            const lines = raw.split('\n').filter(Boolean);
            return lines.slice(-n).join('\n');
        }
        catch {
            return '';
        }
    }
    function appendActivity(line) {
        // 本地时间：此前用 toISOString() 写的是 UTC，日志时间与本地时间差 8 小时，排查时对不上。
        appendActivityLog(`[${localClock()}] ${(0, deps.redactSensitiveText)(String(line).replace(/[\r\n]+/g, ' '))}\n`);
    }
    /**
     * 带行数上限的追加写日志。
     *
     * 为什么不能「append 之后再读回整个文件数行数」：那样每写一行都要同步读一遍整个文件，
     * 到上限后还要整文件重写一次。实测 bridge.log 到了 2000 行（约 200KB）时，
     * 单次 log() 要 17ms 左右，而每条 QQ 消息会打 2~4 条日志 —— 每条消息白扔几十毫秒的
     * 事件循环。这里改成**内存计数器**：只在启动时数一次，之后 O(1) 追加，
     * 到上限才轮转，轮转用 rename 到 `.1`（不是整文件重写，也不会写坏）。
     */
    function createCappedLogger(file, maxLines) {
        let lines = -1; // -1 = 还没数过
        return function append(text) {
            try {
                deps.fs.mkdirSync(deps.STATE_DIR, { recursive: true });
                if (lines < 0) {
                    try {
                        lines = deps.fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
                    }
                    catch {
                        lines = 0;
                    }
                }
                deps.fs.appendFileSync(file, text, 'utf8');
                lines += 1;
                if (lines > maxLines) {
                    // 轮转：当前文件改名为 .1（覆盖上一个备份），新文件从零开始。
                    try {
                        deps.fs.renameSync(file, `${file}.1`);
                    }
                    catch {
                        // 改名失败（被占用等）就退化成截断，保证文件不会无限增长。
                        deps.fs.writeFileSync(file, '', 'utf8');
                    }
                    lines = 0;
                }
            }
            catch { }
        };
    }
    /** 本地时间 HH:MM:SS。此前用的是 toISOString()，写进日志的是 UTC，和本地时间差 8 小时。 */
    function localClock(atMs = deps.Date.now()) {
        const d = new deps.Date(atMs);
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
    function log(...args) {
        let line;
        try {
            const body = args
                .map((a) => (0, deps.redactSensitiveText)(typeof a === 'string' ? a : JSON.stringify(a)))
                .join(' ')
                .replace(/[\r\n]+/g, ' ');
            line = `${localClock()} [bridge] ${body.length > LOG_LINE_MAX ? `${body.slice(0, LOG_LINE_MAX)}…[截断]` : body}`;
        }
        catch {
            line = `${localClock()} [bridge] (日志参数无法序列化)`;
        }
        // console.log 必须自成一个 try：stdout 的读者（守护窗口）消失时会抛 EPIPE，
        // 而 log() 是从 socket 事件回调里被调用的 —— 一旦抛出就会变成未捕获异常把进程带走。
        try {
            deps.console.log(line);
        }
        catch { }
        appendBridgeLog(`${line}\n`);
    }
    return { readActivityTail, appendActivity, createCappedLogger, localClock, log };
}
