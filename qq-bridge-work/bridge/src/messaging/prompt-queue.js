// Generated from messaging/prompt-queue.ts. Edit the TypeScript source and run build:typed.
/**
 * 创建按会话串行、跨会话独立的投递队列；队列状态仅归此实例持有。
 * @param options dispatch执行一次投递；prepareOptions在入队前捕获当前权限代次。
 * @returns 提交、状态查询与清理接口。清理拒绝待执行任务，不冒充取消已经在途的RPC。
 * @note drain撤销旧队列归属后可以新建队列；旧任务完成仅收尾自己的队列，不能删除替代队列。
 */
export function createPromptQueue({ dispatch, prepareOptions = value => value }) {
    const entries = new Map();
    let generation = 0;
    async function run(key) {
        const entry = entries.get(key);
        if (!entry || entry.running)
            return;
        const item = entry.queue.shift();
        if (!item) {
            if (!entry.queue.length)
                entries.delete(key);
            return;
        }
        entry.running = true;
        try {
            item.resolve(await dispatch(key, item.text, item.options));
        }
        catch (error) {
            item.reject(error);
        }
        finally {
            entry.running = false;
            if (entries.get(key) === entry) {
                if (entry.queue.length)
                    void run(key);
                else
                    entries.delete(key);
            }
        }
    }
    /** 入队前转换参数；转换失败同步抛出，投递成功或失败通过返回Promise传递。 */
    function submit(key, text, options) {
        const prepared = prepareOptions(options);
        return new Promise((resolve, reject) => {
            let entry = entries.get(key);
            if (!entry) {
                entry = { generation: ++generation, running: false, queue: [] };
                entries.set(key, entry);
            }
            entry.queue.push({ text, options: prepared, resolve, reject });
            void run(key);
        });
    }
    /** 查询状态副本；不存在时返回undefined，不改变队列。 */
    function status(key) {
        const entry = entries.get(key);
        return entry ? Object.freeze({ generation: entry.generation, running: entry.running, pending: entry.queue.length }) : undefined;
    }
    /** 拒绝指定会话待执行任务并撤销队列归属；在途任务由调度器权限检查收尾。 */
    function drain(key, reason) {
        const entry = entries.get(key);
        if (!entry)
            return;
        for (const item of entry.queue.splice(0))
            item.reject(new Error(reason));
        entries.delete(key);
    }
    /** 拒绝所有待执行任务并撤销全部队列归属。 */
    function drainAll(reason) { for (const key of entries.keys())
        drain(key, reason); }
    /** 拒绝待执行任务，保留在途队列归属，供权限撤销流程等待旧请求结束。 */
    function rejectPending(reason) {
        for (const entry of entries.values())
            for (const item of entry.queue.splice(0))
                item.reject(new Error(reason));
    }
    return Object.freeze({ submit, status, has: (key) => entries.has(key), drain, drainAll, rejectPending });
}
