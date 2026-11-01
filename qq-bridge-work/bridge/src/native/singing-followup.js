// Generated from native/singing-followup.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
/**
 * 将异步歌声完成事件交回原模型会话，不直接发送QQ，不重建任务或重试发送。
 * @param deps 当前归属、轮次、任务状态和既有串行投递入口；只在业务请求成功后登记。
 * @returns 跟踪、完成通知与关闭方法；无构造副作用，关闭会撤销排队中的投递守卫。
 * @note 等原轮结束后再通知；手动已发送、换会话/角色/权限、过期或关闭均丢弃旧通知。
 */
export function createSingingFollowup(deps) {
    const entries = new Map();
    let closed = false;
    const setTimer = deps.setTimer ?? setTimeout, clearTimer = deps.clearTimer ?? clearTimeout;
    function remove(entry) { if (entry.timer !== null)
        clearTimer(entry.timer); entry.timer = null; if (entries.get(entry.job) === entry)
        entries.delete(entry.job); }
    function current(entry) {
        if (closed || entries.get(entry.job) !== entry)
            return false;
        try {
            const context = deps.context(entry.key);
            if (!context || entry.owner !== entry.key + ':' + context)
                return false;
            return ['prepared', 'failed'].includes(deps.status(entry.owner, entry.job).status);
        }
        catch {
            return false;
        }
    }
    function advance(entry) {
        if (entry.queued)
            return;
        if (!current(entry)) {
            remove(entry);
            return;
        }
        if (deps.turnOpen(entry.actorKey)) {
            if (entry.timer === null) {
                entry.timer = setTimer(() => { entry.timer = null; advance(entry); }, 1000);
                entry.timer.unref?.();
            }
            return;
        }
        entry.queued = true;
        const status = deps.status(entry.owner, entry.job).status;
        const text = `【原唱歌任务完成通知】目标会话：${entry.key}；任务：${entry.job}；状态：${status}。这是用户此前请求的同一任务，不是新请求。`
            + (status === 'prepared' ? '请查询qq_song_status确认；仍为prepared时调用qq_send_song发送一次。已发送、已取消或结果未知时不要重发，不要重新生成。' : '请如实说明本次歌声准备失败，不要声称已发送，不要自动重新生成。');
        try {
            void deps.dispatch(entry.actorKey, text, () => current(entry)).catch(() => deps.log('SINGING_FOLLOWUP_UNCONFIRMED')).finally(() => remove(entry));
        }
        catch {
            deps.log('SINGING_FOLLOWUP_UNCONFIRMED');
            remove(entry);
        }
    }
    return {
        /** 登记模型本轮创建的异步任务；同步缓存命中应由原轮直接处理，不登记。 */
        track(job) { if (closed || entries.has(job.job))
            return; entries.set(job.job, { ...job, settled: false, queued: false, timer: null }); },
        /** 接收管理器终态事件；未登记的本机试听任务不会唤醒模型。 */
        settled(event) { const entry = entries.get(event.job); if (!entry || entry.owner !== event.owner || entry.settled)
            return; entry.settled = true; advance(entry); },
        /** 取消所有计时器与未提交通知；已提交的模型工作仍由原生命周期负责停止。 */
        close() { closed = true; for (const entry of entries.values())
            remove(entry); },
    };
}
