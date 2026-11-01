/** 历史反馈仅验证外层数组；元素与额外字段不冒充已校验业务对象。 */
export type FeedbackEntryInput = Record<string,unknown>;
export interface FeedbackStoreDependencies {
  readonly feedbackFile: string; readonly toolLogFile: string;
  readonly readJsonSafe: (file: string, fallback: unknown[]) => unknown;
  readonly atomicWriteJson: (file: string, entries: unknown[]) => void;
  readonly redactSensitiveText: (text: string) => string;
}
/** 同步持久化接口；写反馈错误上抛，工具日志仍按原实现跳过坏行并容错。 */
export interface FeedbackStore {
  readFeedbackEntries: () => unknown[]; appendFeedbackEntry: (entry: FeedbackEntryInput) => void;
  readToolLog: (limit?: unknown) => unknown[]; clearFeedback: () => void; clearToolLog: () => void;
}
import fs from 'node:fs';
/**
 * 反馈历史与工具日志读取器，构造时不读写文件。
 * @param {object} options feedbackFile/toolLogFile限定实例文件；JSON读写与脱敏函数沿用宿主实现。
 * @returns {object} 读取、追加、清空方法；反馈最多500条，工具日志跳过坏行。
 * @note 同步文件操作；反馈写入异常向上抛出，工具日志读取/清空沿用既有容错行为。
 */
export function createFeedbackStore({feedbackFile:FEEDBACK_FILE,toolLogFile:TOOL_LOG_FILE,readJsonSafe,atomicWriteJson,redactSensitiveText}: FeedbackStoreDependencies): FeedbackStore {
  function readFeedbackEntries(): unknown[] {
    const data = readJsonSafe(FEEDBACK_FILE, []);
    return Array.isArray(data) ? data : [];
  }

  function appendFeedbackEntry(entry: FeedbackEntryInput): void {
    const safeEntry = {
      ...entry,
      ...(typeof entry?.message === 'string' ? { message: redactSensitiveText(entry.message) } : {})
    };
    const list = readFeedbackEntries();
    list.push(safeEntry);
    if (list.length > 500) list.splice(0, list.length - 500);
    atomicWriteJson(FEEDBACK_FILE, list);
  }

  function readToolLog(limit: unknown = 200): unknown[] {
    try {
      const raw = fs.readFileSync(TOOL_LOG_FILE, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const parsed: unknown[] = [];
      for (const line of lines.slice(-Math.max(1, Math.min(1000, Number(limit) || 200)))) {
        try { parsed.push(JSON.parse(line)); } catch {}
      }
      return parsed;
    } catch {
      return [];
    }
  }

  return {readFeedbackEntries,appendFeedbackEntry,readToolLog,
    clearFeedback:()=>atomicWriteJson(FEEDBACK_FILE,[]),
    clearToolLog:()=>{try {fs.writeFileSync(TOOL_LOG_FILE,'','utf8');} catch {}}};
}
