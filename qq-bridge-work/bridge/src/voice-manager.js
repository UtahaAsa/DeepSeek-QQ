// Generated from voice-manager.ts. Edit the TypeScript source and run build:typed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalVoice } from './local-voice.js';
import { validateVoiceResources, voiceResourceKinds } from './voice-resources.js';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => new Error(code);
const readPlain = (file) => {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024)
        throw fail('VOICE_CONFIG_INVALID');
    return fs.readFileSync(file);
};
/**
 * 管理所属语音工人的本机配置和受控切换；保留外部声音文件，只写dataRoot。
 * @param {object} options 沿用createLocalVoice参数；factory仅供隔离生命周期测试。
 * @returns {object} 兼容语音条和电话PCM推理接口，另含configuration/validate/beginApply/beginRestore。
 * @note 切换异步执行；accepted不代表就绪。单个切换串行；新工人必须在旧工人确认退出后创建。
 *   新配置加载失败尝试恢复原配置；退出未确认或发现外部修改时拒绝覆盖/重启。
 */
export function createVoiceManager({ factory = createLocalVoice, ...options }) {
    const root = path.resolve(options.dataRoot), target = path.join(root, 'runtime.json');
    const metadata = path.join(root, 'configuration-status.json');
    let actor = null, operation = null, task = null, closed = false, stopPromise = null;
    let stage = null, startedAt = null;
    let enabled = options.receiveEnabled || options.sendEnabled, permissionGeneration = 0, permissionTask = null;
    const assertOpen = () => { if (closed)
        throw fail('LOCAL_VOICE_UNAVAILABLE'); };
    const readCurrent = () => {
        if (!fs.existsSync(target))
            return { bytes: null, revision: digest(Buffer.alloc(0)) };
        const bytes = readPlain(target);
        return { bytes, revision: digest(bytes) };
    };
    const checkRevision = (revision) => {
        const current = readCurrent();
        if (!/^[a-f0-9]{64}$/.test((revision ?? '')) || current.revision !== revision)
            throw fail('VOICE_CONFIG_CONFLICT');
        return current;
    };
    function atomic(file, bytes) {
        if (fs.existsSync(file))
            readPlain(file);
        const temp = file + '.' + randomUUID() + '.next';
        try {
            fs.writeFileSync(temp, bytes, { flag: 'wx' });
            fs.renameSync(temp, file);
        }
        finally {
            if (fs.existsSync(temp))
                fs.unlinkSync(temp);
        }
    }
    function backup(bytes) {
        const revision = digest(bytes), file = path.join(root, 'configuration-' + revision + '.json');
        if (!fs.existsSync(file))
            fs.writeFileSync(file, bytes, { flag: 'wx' });
        if (digest(readPlain(file)) !== revision)
            throw fail('VOICE_BACKUP_INVALID');
        return revision;
    }
    function previousRevision() {
        try {
            const saved = JSON.parse(readPlain(metadata));
            if (saved.appliedRevision !== readCurrent().revision || !/^[a-f0-9]{64}$/.test(saved.previousRevision))
                return null;
            const bytes = readPlain(path.join(root, 'configuration-' + saved.previousRevision + '.json'));
            return digest(bytes) === saved.previousRevision ? saved.previousRevision : null;
        }
        catch {
            return null;
        }
    }
    const createActor = () => { assertOpen(); actor = enabled ? factory(options) : null; return actor; };
    async function loadActor() { const next = createActor(); if (next)
        await next.warmup(); assertOpen(); }
    const active = () => { assertOpen(); if (stage)
        throw fail(['switching', 'rolling_back'].includes(stage) ? 'VOICE_WARMING' : 'LOCAL_VOICE_UNAVAILABLE'); if (!actor)
        throw fail('LOCAL_VOICE_UNAVAILABLE'); return actor; };
    const validate = (input) => validateVoiceResources(input, root, { inspectSelection: true });
    function begin(bytes, revision, kind) {
        assertOpen();
        if (task || permissionTask || stage === 'stop_failed')
            throw fail('VOICE_CONFIG_BUSY');
        const before = checkRevision(revision);
        if (digest(bytes) === before.revision)
            throw fail('VOICE_CONFIG_UNCHANGED');
        operation = { id: randomUUID(), kind, outcome: 'running', error: null };
        stage = 'switching';
        startedAt = Date.now();
        const run = async () => {
            let written = false;
            try {
                // close()必须确认退出；killed标记不能作为GPU已释放的依据。
                await actor?.close();
                actor = null;
                assertOpen();
                checkRevision(before.revision);
                validate(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
                fs.mkdirSync(path.join(root, 'cache', 'temp'), { recursive: true });
                const oldRevision = before.bytes ? backup(before.bytes) : null;
                atomic(target, bytes);
                written = true;
                atomic(metadata, JSON.stringify({ appliedRevision: digest(bytes), previousRevision: oldRevision }));
                await loadActor();
                operation.outcome = enabled ? 'applied' : 'saved_disabled';
                stage = null;
            }
            catch (error) {
                operation.error = error?.message === 'VOICE_WORKER_STOP_UNCONFIRMED' ? 'VOICE_WORKER_STOP_UNCONFIRMED' : 'VOICE_CONFIG_APPLY_FAILED';
                if (closed) {
                    operation.outcome = 'cancelled';
                    return;
                }
                if (error?.message === 'VOICE_WORKER_STOP_UNCONFIRMED') {
                    operation.outcome = 'stop_failed';
                    stage = 'stop_failed';
                    return;
                }
                stage = 'rolling_back';
                try {
                    await actor?.close();
                    actor = null;
                    assertOpen();
                    // 配置被外部修改时只停止，不能覆盖用户的新文件。
                    checkRevision(written ? digest(bytes) : before.revision);
                    if (written) {
                        backup(bytes);
                        if (before.bytes)
                            atomic(target, before.bytes);
                        else
                            fs.unlinkSync(target);
                        atomic(metadata, JSON.stringify({ appliedRevision: before.revision, previousRevision: before.bytes ? digest(bytes) : null }));
                    }
                    await loadActor();
                    operation.outcome = 'rolled_back';
                    stage = null;
                }
                catch (rollbackError) {
                    operation.outcome = closed ? 'cancelled' : 'rollback_failed';
                    stage = rollbackError?.message === 'VOICE_WORKER_STOP_UNCONFIRMED' ? 'stop_failed' : 'failed';
                }
            }
        };
        task = run().finally(() => { task = null; });
        return { ok: true, accepted: true, operationId: operation.id };
    }
    function beginApply(input, revision) {
        const { config } = validate(input);
        const current = checkRevision(revision);
        if (current.bytes) {
            const previous = JSON.parse(current.bytes.toString('utf8').replace(/^\uFEFF/, ''));
            if (Object.keys(voiceResourceKinds).every(key => previous?.[key] === config[key]))
                throw fail('VOICE_CONFIG_UNCHANGED');
        }
        return begin(Buffer.from(JSON.stringify(config, null, 2)), revision, 'apply');
    }
    function beginRestore(revision) {
        checkRevision(revision);
        const previous = previousRevision();
        if (!previous)
            throw fail('VOICE_BACKUP_UNAVAILABLE');
        const bytes = readPlain(path.join(root, 'configuration-' + previous + '.json'));
        validate(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
        return begin(bytes, revision, 'restore');
    }
    function configuration() {
        assertOpen();
        let config = null, revision = null;
        try {
            const value = readCurrent();
            revision = value.revision;
            if (value.bytes) {
                const input = JSON.parse(value.bytes.toString('utf8').replace(/^\uFEFF/, ''));
                config = Object.fromEntries(Object.keys(voiceResourceKinds).filter(key => typeof input?.[key] === 'string').map(key => [key, input[key]]));
            }
        }
        catch { /* 未准备资源时仍允许本机填写配置；应用另行校验。 */ }
        return { ok: true, config, revision, canRestore: !task && !permissionTask && stage !== 'stop_failed' && Boolean(previousRevision()), busy: Boolean(task || permissionTask),
            operation: operation ? { ...operation } : null, voice: snapshot() };
    }
    function snapshot() {
        if (stage)
            return { phase: stage, receiveEnabled: options.receiveEnabled === true, sendEnabled: options.sendEnabled === true,
                asrReady: false, ttsReady: false, busy: Boolean(task || permissionTask), elapsedMs: Date.now() - startedAt };
        return actor?.snapshot() ?? { phase: enabled ? 'idle' : 'disabled', receiveEnabled: options.receiveEnabled === true, sendEnabled: options.sendEnabled === true };
    }
    function close() {
        if (stopPromise)
            return stopPromise;
        closed = true;
        stopPromise = (async () => { await actor?.close(); await task; await permissionTask; })();
        return stopPromise;
    }
    createActor();
    /** 热改收发许可，撤销旧工人后按当前资源预热；配置文件与选定声音保持。@param {object} value receiveEnabled/sendEnabled布尔。@returns {Promise<void>} 失败固定降级，文字不等待。 */
    function setPermissions(value) {
        assertOpen();
        if (!value || typeof value.receiveEnabled !== 'boolean' || typeof value.sendEnabled !== 'boolean')
            return Promise.reject(fail('LOCAL_VOICE_UNAVAILABLE'));
        if (value.receiveEnabled === options.receiveEnabled && value.sendEnabled === options.sendEnabled)
            return permissionTask ?? Promise.resolve();
        options.receiveEnabled = value.receiveEnabled;
        options.sendEnabled = value.sendEnabled;
        enabled = value.receiveEnabled || value.sendEnabled;
        const generation = ++permissionGeneration, previous = permissionTask;
        const work = (async () => {
            await previous?.catch(() => { });
            await task;
            if (closed || generation !== permissionGeneration)
                return;
            stage = 'switching';
            startedAt = Date.now();
            try {
                await actor?.close();
                actor = null;
                assertOpen();
                await loadActor();
                stage = null;
            }
            catch (error) {
                stage = error?.message === 'VOICE_WORKER_STOP_UNCONFIRMED' ? 'stop_failed' : 'failed';
                throw fail('LOCAL_VOICE_UNAVAILABLE');
            }
        })();
        permissionTask = work;
        work.finally(() => { if (permissionTask === work)
            permissionTask = null; }).catch(() => { });
        return work;
    }
    return { warmup: async () => enabled ? active().warmup() : undefined,
        transcribe: async (...args) => { if (!options.receiveEnabled)
            throw fail('LOCAL_VOICE_UNAVAILABLE'); return active().transcribe(...args); },
        synthesize: async (...args) => { if (!options.sendEnabled)
            throw fail('LOCAL_VOICE_UNAVAILABLE'); return active().synthesize(...args); },
        transcribePcm: async (...args) => { if (!options.receiveEnabled)
            throw fail('LOCAL_VOICE_UNAVAILABLE'); return active().transcribePcm(...args); },
        synthesizePcm: async (...args) => { if (!options.sendEnabled)
            throw fail('LOCAL_VOICE_UNAVAILABLE'); return active().synthesizePcm(...args); },
        setPermissions, close, snapshot, configuration,
        validate: (input) => ({ ok: true, ...validate(input) }), beginApply, beginRestore };
}
