// Generated from voice-resources.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
export const voiceResourceKinds = Object.freeze({ selectedVoice: 'file', python: 'file', engine: 'directory',
    pretrained: 'directory', ffmpeg: 'file', asrModel: 'directory' });
const invalid = () => new Error('EXISTING_VOICE_RESOURCES_INVALID');
const local = (value) => typeof value === 'string' && Boolean(value.trim()) && !/[\x00-\x1f]/.test(value) &&
    !/^(?:[\\/]{2}|[a-z]+:\/\/)/i.test(value);
function resolveResource(value, base, kind) {
    if (!local(value))
        throw invalid();
    const resolved = fs.realpathSync(path.resolve(base, value));
    if (!local(resolved))
        throw invalid();
    const info = fs.statSync(resolved);
    if (!(kind === 'file' ? info.isFile() : info.isDirectory()))
        throw invalid();
    return resolved;
}
/**
 * 只读校验本机既有语音资源；不会下载、执行工具或修改外部模型。
 * @param {object} input 六项资源路径；相对路径相对于base。
 * @param {string} base 所属资源清单或runtime.json的目录。
 * @param {object} options inspectSelection为true时检查声音清单结构和引用文件。
 * @returns {object} 规范绝对路径config及安全summary；摘要内容由预热工人实际核验。
 * @throws {Error} 未知字段、网络路径、缺件或不支持的声音结构统一拒绝；同步执行。
 */
export function validateVoiceResources(input, base, { inspectSelection = false } = {}) {
    try {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input).length !== Object.keys(voiceResourceKinds).length ||
            Object.keys(input).some(key => !Object.hasOwn(voiceResourceKinds, key)))
            throw invalid();
        const config = Object.fromEntries(Object.entries(voiceResourceKinds).map(([key, kind]) => [key, resolveResource(input[key], base, kind)]));
        if (!inspectSelection)
            return { config };
        if (fs.statSync(config.selectedVoice).size > 128 * 1024)
            throw invalid();
        const selected = JSON.parse(fs.readFileSync(config.selectedVoice, 'utf8').replace(/^\uFEFF/, ''));
        const modelBase = path.dirname(config.selectedVoice);
        for (const key of ['gpt', 'sovits']) {
            resolveResource(selected?.models?.[key], modelBase, 'file');
            if (!/^[a-f0-9]{64}$/.test((selected.models[key + '_sha256'] ?? '')))
                throw invalid();
        }
        resolveResource(selected?.reference?.inference_audio, modelBase, 'file');
        if (!/^[a-f0-9]{64}$/.test((selected.reference.inference_sha256 ?? '')))
            throw invalid();
        const params = selected.inference_parameters;
        if (!params || typeof params !== 'object' || Array.isArray(params) ||
            typeof params.prompt_text !== 'string' || params.prompt_text.length > 4000 ||
            !['zh', 'all_zh', 'en', 'ja', 'all_ja', 'ko', 'all_ko', 'yue', 'all_yue', 'auto', 'auto_yue'].includes(params.text_lang) ||
            !['zh', 'all_zh', 'en', 'ja', 'all_ja', 'ko', 'all_ko', 'yue', 'all_yue', 'auto', 'auto_yue'].includes(params.prompt_lang) ||
            (params.text_split_method !== undefined && !/^cut[0-5]$/.test(params.text_split_method)))
            throw invalid();
        for (const name of ['chinese-roberta-wwm-ext-large', 'chinese-hubert-base'])
            resolveResource(name, config.pretrained, 'directory');
        return { config, summary: { engine: 'GPT-SoVITS v2', recognition: '本机 Transformers ASR',
                textLanguage: params.text_lang, splitMethod: params.text_split_method === 'cut0' ? 'cut5' : params.text_split_method ?? 'cut5',
                modelHashesVerified: false } };
    }
    catch {
        throw invalid();
    }
}
