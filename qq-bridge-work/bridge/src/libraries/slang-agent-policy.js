// Generated from libraries/slang-agent-policy.ts. Edit the TypeScript source and run build:typed.
/**
 * 构造所属实例的提交限频检查，构造时不修改额度表。
 * @param slangSubmitTimes 按会话记录成功占用额度的时间，继续由宿主在清理会话时管理。
 * @param clock 毫秒时钟。
 * @returns 检查函数：每分钟2次、每小时10次；允许时记账，拒绝不更新表。
 */
export function createSlangSubmitLimiter(slangSubmitTimes, clock = Date.now) {
    return function allowSlangSubmit(key) {
        const now = clock();
        const arr = (slangSubmitTimes.get(key) ?? []).filter((t) => now - t < 60 * 60 * 1000);
        const recentMinute = arr.filter((t) => now - t < 60 * 1000).length;
        const MAX_PER_MINUTE = 2;
        const MAX_PER_HOUR = 10;
        if (recentMinute >= MAX_PER_MINUTE || arr.length >= MAX_PER_HOUR)
            return false;
        arr.push(now);
        slangSubmitTimes.set(key, arr);
        return true;
    };
}
/**
 * 只投影白名单字段，不包含证据和内部研究信息；无副作用。
 * @param e 已加载的词条，缺失字段沿用原默认值。
 * @returns 可向会话展示的字段副本。
 */
export function publicSlangEntry(e) {
    return {
        id: e?.id ?? '',
        content: e?.content ?? '',
        meaning: e?.meaning ?? '',
        usage: e?.usage ?? '',
        example: e?.example ?? '',
        risk: e?.risk ?? '',
        status: e?.status ?? 'candidate',
        source: e?.source ?? 'ai',
        count: Number(e?.count) || 0,
        updatedAt: e?.updatedAt ?? ''
    };
}
/**
 * 只读筛选有效已确认词条，不修改来源数组。
 * @param slangEntries 已加载的词条列表。
 * @param injectMax 显示上限，沿用原转换规则，默认8条并限制在1至30条。
 * @returns 按次数降序排列的公开字段副本。
 */
export function confirmedSlangEntries(slangEntries, injectMax) {
    const max = Math.max(1, Math.min(30, Number(injectMax) || 8));
    return slangEntries
        .filter((e) => e.status === 'confirmed' && e.content && e.meaning)
        .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
        .slice(0, max)
        .map(publicSlangEntry);
}
