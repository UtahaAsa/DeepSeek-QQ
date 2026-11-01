/**
 * 归一化一代社交参数，保留历史数字转换、范围交换及未知字段语义。
 * @param current 文件中的现有社交配置，空值视为空对象。
 * @param body 本次请求字段；不修改调用方对象。
 * @returns 合并后的独立顶层对象；无IO。非法数字仍沿用历史NaN行为，由JSON写入层处理。
 */
export function normalizeLegacySocial(current: Record<string, unknown> | null | undefined, body: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(current ?? {}), ...body };
  // 新分句逻辑不再使用旧字段：保存时统一清理，避免旧配置残留
  for (const k of ['burstProbability', 'burstMaxMessages', 'followUpEnabled', 'followUpProbability', 'followUpDelayMinMs', 'followUpDelayMaxMs', 'followUpCooldownMs']) {
    delete merged[k];
  }
  for (const k of ['triggerProbability', 'activeCheckMinMs', 'activeCheckMaxMs', 'activeReplyDelayMinMs', 'activeReplyDelayMaxMs', 'activeDurationMinMs', 'activeDurationMaxMs', 'idleWindowMs', 'idleRetryProbability', 'idleRetryWaitMs', 'proactiveIdleThresholdMs', 'proactiveCheckMinMs', 'proactiveCheckMaxMs', 'proactiveProbability', 'maxReplyChars', 'contextWindow', 'burstIntervalMinMs', 'burstIntervalMaxMs', 'longGapMinMs', 'longGapMaxMs']) {
    if (merged[k] !== undefined) {
      const n = Number(merged[k]);
      if (Number.isFinite(n) && n >= 0) merged[k] = n;
    }
  }
  // 分条间隔 clamp 到非负
  for (const k of ['burstIntervalMinMs', 'burstIntervalMaxMs', 'longGapMinMs', 'longGapMaxMs']) {
    if (merged[k] !== undefined) merged[k] = Math.max(0, Number(merged[k]) || 0);
  }
  // 概率字段 clamp 到 0~1
  for (const k of ['triggerProbability', 'idleRetryProbability', 'proactiveProbability', 'skipProbability', 'surrenderProbability', 'longGapProbability']) {
    if (merged[k] !== undefined) merged[k] = Math.min(1, Math.max(0, Number(merged[k])));
  }
  // contextWindow 限制 1~100
  if (merged.contextWindow !== undefined) {
    merged.contextWindow = Math.min(100, Math.max(1, Math.round(Number(merged.contextWindow))));
  }
  // 布尔字段
  for (const k of ['activeDurationEnabled', 'proactiveEnabled', 'burstEnabled']) {
    if (merged[k] !== undefined) merged[k] = Boolean(merged[k]);
  }
  // 范围字段保证 min <= max
  for (const [minK, maxK] of [['activeCheckMinMs', 'activeCheckMaxMs'], ['activeReplyDelayMinMs', 'activeReplyDelayMaxMs'], ['activeDurationMinMs', 'activeDurationMaxMs'], ['proactiveCheckMinMs', 'proactiveCheckMaxMs'], ['burstIntervalMinMs', 'burstIntervalMaxMs'], ['longGapMinMs', 'longGapMaxMs']]) {
    if (merged[minK] !== undefined && merged[maxK] !== undefined && Number(merged[minK]) > Number(merged[maxK])) {
      [merged[minK], merged[maxK]] = [merged[maxK], merged[minK]];
    }
  }
  if (Array.isArray(body.mustReplyKeywords)) merged.mustReplyKeywords = body.mustReplyKeywords.map(String);
  return merged;
}
