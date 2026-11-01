// Generated from lifecycle/instance-lock.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
/**
 * 构造单实例锁操作；构造仅计算文件名，不创建锁或查询进程。
 * @param deps 所属目录、进程探测/退出及同步端口探测能力。
 * @returns acquireLock/releaseLock；占用或无法确认时沿原逻辑退出，释放仅删除当前PID拥有的锁。
 * @note PID探测不等于进程身份证明；保留既有端口辅助判断，不提升为可靠身份验证。
 */
export function createInstanceLock(deps) {
    const LOCK_FILE = deps.path.join(deps.STATE_DIR, 'bridge.lock');
    /**
     * 控制台端口是否已被占用 —— 用来判断「是不是真的还有一个桥接在跑」。
     *
     * 为什么需要它：锁文件只存了 PID，而 Windows 会回收 PID。`process.kill(pid, 0)` 成功
     * 只能证明「有进程占着这个号」，EPERM 更是连这一点都证明不了（受保护进程）。
     * 但桥接一定绑定控制台端口（绑不上会自己 exit 2），所以端口占用是一个可靠的判据。
     * 同步探测一次，只在启动期的可疑分支里跑，不影响正常运行。
     */
    function consolePortInUse() {
        try {
            const cfg = (0, deps.readJsonSafe)(deps.path.join(deps.ROOT, 'config.json'), {});
            const port = Number(cfg?.consolePort) || 3100;
            if (deps.process.platform === 'win32') {
                const out = (0, deps.execFileSync)('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
                return new RegExp(`[:.]${port}\\s+\\S+\\s+LISTENING`, 'i').test(out);
            }
            const out = (0, deps.execFileSync)('sh', ['-c', 'ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
            return new RegExp(`[:.]${port}\\s`).test(out);
        }
        catch {
            // 探测不出来时保守认为「有人在跑」，宁可让用户手动删锁，也不要冒双实例的风险。
            return true;
        }
    }
    function acquireLock() {
        deps.fs.mkdirSync(deps.STATE_DIR, { recursive: true });
        // 原子创建锁文件：把 PID 一次性写入（flag 'wx'），避免“先建空文件再写 PID”的窗口被第二个进程当作过期锁偷走。
        const tryCreate = () => {
            try {
                deps.fs.writeFileSync(LOCK_FILE, String(deps.process.pid), { flag: 'wx', mode: 0o600 });
                return true;
            }
            catch (error) {
                if (error?.code === 'EEXIST')
                    return false;
                throw error;
            }
        };
        if (tryCreate())
            return;
        // 锁文件已存在：检查 PID 是否仍存活；内容为空视为过期锁（仅兼容旧版本遗留），删除后重试一次。
        let stale = false;
        try {
            const content = deps.fs.readFileSync(LOCK_FILE, 'utf8').trim();
            if (!content) {
                stale = true;
            }
            else {
                const pid = Number(content);
                if (!Number.isInteger(pid) || pid <= 0) {
                    stale = true;
                }
                else {
                    try {
                        deps.process.kill(pid, 0);
                        // 没抛异常只说明「存在某个持有该 PID 的进程」，不能证明那就是桥接
                        // （PID 被回收给别的程序时会误判），所以再加一道端口探测。
                        if (!consolePortInUse())
                            stale = true;
                    }
                    catch (error) {
                        if (error.code === 'ESRCH') {
                            stale = true;
                        }
                        else if (error.code === 'EPERM') {
                            // EPERM = 该 PID 属于受保护/系统进程（权限不足，无法发信号）。
                            // 这**不能**证明桥接还在跑，但旧逻辑把它当成「已有实例」直接 exit(2)：
                            // 一旦锁文件里的 PID 被系统回收给一个受保护进程，桥接就永久起不来，
                            // 而且提示信息把人引向「已有实例在运行」这个错误方向。
                            // 这里改成按「疑似过期」处理，但要先确认控制台端口没有被占用。
                            if (consolePortInUse()) {
                                deps.console.error(`[bridge] 控制台端口已被占用，判定已有实例在运行（锁文件 PID ${pid} 无权限探测）。`);
                                deps.process.exit(2);
                            }
                            deps.console.error(`[bridge] 锁文件 PID ${pid} 无权限探测（EPERM）且控制台端口空闲，按过期锁处理。`);
                            stale = true;
                        }
                        else {
                            deps.console.error(`[bridge] 已有实例在运行（PID ${pid}，锁文件 ${LOCK_FILE}）。若确认其已死，删除该文件后重试。`);
                            deps.process.exit(2);
                        }
                    }
                }
            }
        }
        catch (readError) {
            deps.console.error(`[bridge] 无法读取锁文件 ${LOCK_FILE}：${readError?.message ?? readError}`);
            deps.process.exit(1);
        }
        if (stale) {
            deps.console.error(`[bridge] 检测到过期锁文件（PID 不存在或为空），删除后重试…`);
            try {
                deps.fs.unlinkSync(LOCK_FILE);
            }
            catch { }
            if (tryCreate())
                return;
        }
        deps.console.error(`[bridge] 已有实例在运行（锁文件 ${LOCK_FILE}）。若确认其已死，删除该文件后重试。`);
        deps.process.exit(2);
    }
    function releaseLock() {
        try {
            if (deps.fs.existsSync(LOCK_FILE) && Number(deps.fs.readFileSync(LOCK_FILE, 'utf8').trim()) === deps.process.pid) {
                deps.fs.unlinkSync(LOCK_FILE);
            }
        }
        catch { }
    }
    return { consolePortInUse, acquireLock, releaseLock };
}
