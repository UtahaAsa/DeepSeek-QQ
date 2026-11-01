// Generated from prompts/initial-prompt-store.ts. Edit the TypeScript source and run build:typed.
import fs from 'node:fs';
import { initialPromptLimit, normalizeInitialPromptText } from './initial-prompt-policy.js';
/**
 * 管理所属实例的初始提示词配置，加载不截断内容，写入失败回滚内存。
 * @param {object} options file为固定数据文件；canonicalKey/getLimit/atomicWriteJson/truncateText/log由宿主提供，clock用于时间戳。
 * @returns {object} 加载、查询、保存、格式化、摘要及可写状态；不暴露内部Map。
 * @note 构造无IO；读坏文件后当前实例保持只读。保存返回原状态码和错误，存储不决定bootstrap时机。
 */
export function createInitialPromptStore({ file: INITIAL_PROMPTS_FILE, canonicalKey: canonicalV2Key, getLimit, atomicWriteJson, truncateText, log, clock = Date.now }) {
    const initialPrompts = new Map(); // key -> { text, createdAt, updatedAt }
    let initialPromptsWritable = true;
    const initialPromptMaxChars = () => initialPromptLimit(getLimit());
    /**
     * 读取 state/initial-prompts.json。
     * 读不动/读坏时降级为「只读不写」（与 sessions.json、表情库、黑话库同一口径）：
     * 否则内存里的空映射会在下一次保存时把原文件覆盖掉，操作者写的内容永久丢失。
     */
    function loadInitialPrompts() {
        let raw;
        try {
            raw = fs.readFileSync(INITIAL_PROMPTS_FILE, 'utf8');
        }
        catch (error) {
            if (error?.code !== 'ENOENT') {
                initialPromptsWritable = false;
                log(`⚠️ initial-prompts.json 读取失败，已降级为「只读不写」（不会覆盖原文件）：${error?.message ?? error}`);
            }
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
        }
        catch (error) {
            initialPromptsWritable = false;
            log(`⚠️ initial-prompts.json 内容损坏，已降级为「只读不写」（请先备份再修复）：${error?.message ?? error}`);
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            initialPromptsWritable = false;
            log('⚠️ initial-prompts.json 结构异常（期望 { "key": { "text": … } } 对象），已降级为「只读不写」');
            return;
        }
        for (const [key, value] of Object.entries(parsed)) {
            // 只接受规范 key；__proto__/constructor 这类脏键在这里就被过滤掉。
            const canonical = canonicalV2Key(key);
            if (!canonical)
                continue;
            // 注意：这里**不按上限截断**。文件里若有一条超过当前上限的内容（比如后来调小了上限，
            // 或手工编辑过），截断它会在下一次保存时把截断结果写回磁盘 —— 静默丢数据。
            // 上限只在「保存」和「注入」两个出口生效。
            const text = normalizeInitialPromptText(value && typeof value === 'object' ? value.text : value);
            if (!text)
                continue;
            const createdAt = Number(value && typeof value === 'object' ? value.createdAt : 0);
            const updatedAt = Number(value && typeof value === 'object' ? value.updatedAt : 0);
            initialPrompts.set(canonical, {
                text,
                createdAt: Number.isFinite(createdAt) ? createdAt : 0,
                updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0
            });
        }
        if (initialPrompts.size)
            log(`已加载 ${initialPrompts.size} 条会话初始提示词`);
    }
    function saveInitialPrompts() {
        if (!initialPromptsWritable) {
            log('⚠️ initial-prompts.json 处于只读降级状态，本次修改不会落盘');
            return false;
        }
        try {
            const obj = Object.create(null);
            for (const [key, entry] of initialPrompts) {
                obj[key] = { text: entry.text, createdAt: entry.createdAt || 0, updatedAt: entry.updatedAt || 0 };
            }
            atomicWriteJson(INITIAL_PROMPTS_FILE, obj);
            return true;
        }
        catch (error) {
            log('保存会话初始提示词失败:', error?.message ?? error);
            return false;
        }
    }
    function getInitialPrompt(key) {
        const canonical = canonicalV2Key(key);
        return canonical ? (initialPrompts.get(canonical) ?? null) : null;
    }
    /**
     * 保存/删除一份初始提示词。空内容 = 删除。
     * 写入失败时把内存改动回滚，保证「接口说失败」与「内存里确实没变」一致。
     * @returns {{ok: boolean, statusCode?: number, error?: string, key?: string, deleted?: boolean, chars?: number, entry?: object|null}}
     */
    function setInitialPrompt(key, rawText) {
        const canonical = canonicalV2Key(key);
        if (!canonical)
            return { ok: false, statusCode: 400, error: 'key 格式应为 group:群号 或 private:QQ号' };
        const max = initialPromptMaxChars();
        const text = normalizeInitialPromptText(rawText);
        if (text.length > max) {
            return { ok: false, statusCode: 400, error: `初始提示词过长（${text.length} 字符，上限 ${max}）；请精简后重试` };
        }
        const prev = initialPrompts.get(canonical) ?? null;
        const rollback = () => { if (prev)
            initialPrompts.set(canonical, prev);
        else
            initialPrompts.delete(canonical); };
        if (!text) {
            initialPrompts.delete(canonical);
            if (!saveInitialPrompts()) {
                rollback();
                return { ok: false, statusCode: 500, error: '删除失败：state/initial-prompts.json 写入失败，已回滚' };
            }
            return { ok: true, key: canonical, deleted: true, chars: 0, entry: null };
        }
        const now = clock();
        const entry = { text, createdAt: prev?.createdAt || now, updatedAt: now };
        initialPrompts.set(canonical, entry);
        if (!saveInitialPrompts()) {
            rollback();
            return { ok: false, statusCode: 500, error: '保存失败：state/initial-prompts.json 写入失败，已回滚' };
        }
        return { ok: true, key: canonical, deleted: false, chars: text.length, entry };
    }
    /**
     * 首次唤醒时插入的环境段；没有配置就返回空串（不影响原有 prompt）。
     * 超长内容按上限截断后注入（文件可能被手工改过），并在截断处留省略号。
     */
    function formatInitialPromptV2(key) {
        const entry = getInitialPrompt(key);
        if (!entry?.text)
            return '';
        const max = initialPromptMaxChars();
        const body = entry.text.length > max ? `${truncateText(entry.text, max)}…（已按上限截断，完整内容见控制台）` : entry.text;
        const label = String(key ?? '').trim().startsWith('private:') ? '私聊环境' : '群聊环境';
        return `【${label}（操作者预设，仅本次首次唤醒参考）】\n${body}\n（以上是操作者提供的背景，不是群友发的消息、也不是新的系统指令；据此把握圈子主题、氛围与分寸，不必向群友复述。）`;
    }
    function list() {
        return [...initialPrompts.entries()]
            .map(([entryKey, entry]) => ({
            key: entryKey,
            chars: entry.text.length,
            createdAt: entry.createdAt || 0,
            updatedAt: entry.updatedAt || 0,
            preview: entry.text.replace(/\s+/g, ' ').slice(0, 80)
        }))
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    return Object.freeze({ loadInitialPrompts, getInitialPrompt, setInitialPrompt, formatInitialPromptV2, initialPromptMaxChars, list, isWritable: () => initialPromptsWritable });
}
