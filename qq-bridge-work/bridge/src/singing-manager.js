// Generated from singing-manager.ts. Edit the TypeScript source and run build:typed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const fail = (code) => Object.assign(new Error(code), { code });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const token = /^[a-f0-9]{32}$/;
const errors = new Set(['SINGING_BUSY', 'SINGING_NOT_READY', 'SINGING_JOB_EXPIRED', 'SINGING_SEND_UNCONFIRMED',
    'SINGING_INPUT_INVALID', 'SINGING_RESOURCE_CHANGED', 'SINGING_CANCELLED', 'SINGING_WORKER_UNAVAILABLE']);
/** 将内部异常投影为固定歌声错误码。@param {unknown} error 不可信异常。@returns {string} 不含路径或日志；同步且不抛异常。 */
export const singingError = (error) => errors.has(error?.code) ? error.code : 'SINGING_NOT_READY';
function owned(root, relative, max) {
    if (typeof relative !== 'string' || relative.length > 240 || !relative || /[:\\\x00-\x1f]/.test(relative))
        throw fail('SINGING_RESOURCE_CHANGED');
    let file = root;
    for (const name of relative.split('/')) {
        if (!name || name === '.' || name === '..')
            throw fail('SINGING_RESOURCE_CHANGED');
        file = path.join(file, name);
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || fs.realpathSync(file) !== file)
            throw fail('SINGING_RESOURCE_CHANGED');
    }
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > max)
        throw fail('SINGING_RESOURCE_CHANGED');
    return file;
}
function wav(bytes) {
    // 工人固定输出24kHz单声道PCM16；拒绝非规范容器，编码器不会接触任意路径。
    if (!Buffer.isBuffer(bytes) || bytes.length < 46 || bytes.length > 24000 * 2 * 60 + 44
        || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
        || bytes.toString('ascii', 12, 16) !== 'fmt ' || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1
        || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 24000 || bytes.readUInt16LE(34) !== 16
        || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44
        || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.length % 2)
        throw fail('SINGING_RESOURCE_CHANGED');
    return Math.round((bytes.length - 44) / 48);
}
/**
 * 持有一个隔离RVC工人；推理有界串行，空闲两分钟退出释放显存。
 * @param {object} options root为固定歌声目录；spawnProcess仅供隔离协议测试。
 * @returns {object} convert/close/snapshot。超时或协议失败后等待真实exit才允许新工人，不重试请求。
 */
export function createSingingWorker({ root, spawnProcess = spawn, timeoutMs = 480000, idleMs = 120000 }) {
    let child = null, pending = null, idle = null, stopping = null, closed = false, phase = 'idle';
    const stop = () => {
        clearTimeout(idle);
        if (!child)
            return Promise.resolve();
        if (stopping)
            return stopping;
        const current = child;
        stopping = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(fail('SINGING_WORKER_UNAVAILABLE')), 10000);
            current.once('exit', () => { clearTimeout(timer); resolve(); });
            current.stdin.end();
            current.kill();
        }).then(() => { stopping = null; });
        return stopping;
    };
    function launch() {
        const env = { ...process.env };
        for (const name of Object.keys(env))
            if (/TOKEN|API_KEY|PASSWORD|CREDENTIAL|SECRET/i.test(name))
                delete env[name];
        Object.assign(env, { QQ_SINGING_DATA: root, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1',
            TEMP: path.join(root, 'cache/temp'), TMP: path.join(root, 'cache/temp') });
        child = spawnProcess(owned(root, 'environment/Scripts/python.exe', 1024 * 1024), ['-B', '-u',
            fileURLToPath(new URL('../../integration/singing-worker.py', import.meta.url))], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let buffer = '';
        child.stdout.on('data', (bytes) => {
            buffer += bytes.toString('utf8');
            if (buffer.length > 16384) {
                pending?.finish(fail('SINGING_WORKER_UNAVAILABLE'));
                void stop().catch(() => { });
                return;
            }
            while (buffer.includes('\n')) {
                const index = buffer.indexOf('\n'), line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                try {
                    if (!pending || !line.startsWith('QQSING/1 '))
                        throw 0;
                    const packet = JSON.parse(line.slice(9));
                    if (packet.id !== pending.id || typeof packet.ok !== 'boolean')
                        throw 0;
                    if (packet.ok !== true) {
                        pending.finish(fail('SINGING_NOT_READY'));
                        continue;
                    }
                    pending.finish(null, packet.result);
                }
                catch {
                    pending?.finish(fail('SINGING_WORKER_UNAVAILABLE'));
                    void stop().catch(() => { });
                }
            }
        });
        child.stderr.on('data', () => { }); // 工人日志不含在页面或模型错误里。
        child.stdin.on('error', () => { pending?.finish(fail('SINGING_WORKER_UNAVAILABLE')); });
        child.once('error', () => { pending?.finish(fail('SINGING_WORKER_UNAVAILABLE')); });
        child.once('exit', () => { child = null; stopping = null; phase = closed ? 'closed' : 'idle'; pending?.finish(fail('SINGING_WORKER_UNAVAILABLE')); });
    }
    return {
        convert(request) {
            if (closed || pending || stopping)
                return Promise.reject(fail('SINGING_BUSY'));
            clearTimeout(idle);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => { pending?.finish(fail('SINGING_WORKER_UNAVAILABLE')); void stop().catch(() => { }); }, timeoutMs);
                pending = { id: request.id, finish(error, result) {
                        clearTimeout(timer);
                        pending = null;
                        phase = child ? 'warm' : 'idle';
                        if (error)
                            reject(error);
                        else
                            resolve(result);
                        idle = setTimeout(() => { void stop().catch(() => { }); }, idleMs);
                        idle.unref?.();
                    } };
                try {
                    if (!child) {
                        phase = 'loading';
                        launch();
                    }
                    else
                        phase = 'converting';
                    child.stdin.write(JSON.stringify(request) + '\n');
                }
                catch {
                    pending?.finish(fail('SINGING_WORKER_UNAVAILABLE'));
                }
            });
        },
        snapshot: () => ({ phase, busy: Boolean(pending), running: Boolean(child) }),
        async close() { closed = true; pending?.finish(fail('SINGING_CANCELLED')); await stop(); },
    };
}
/**
 * 把登记导唱、RVC转换、试听和实际QQ发送分开；构造本身不加载GPU或发送。
 * @param {object} options root为项目内固定目录；worker/upload/send提供所属工人与发送通道。
 * @returns {object} catalog/start/status/audio/send/cancel/close/snapshot。job只属于其owner；最多32条、有效15分钟。
 * @note 所有异步发送步骤复核调用方guard；发送只尝试一次，未知回执绝不重发。缓存必须匹配模型与导唱摘要。
 */
export function createSingingManager({ root, worker = createSingingWorker({ root }), upload, send, now = Date.now, onSettled }) {
    root = fs.realpathSync(root);
    const jobs = new Map();
    let active = null, closed = false;
    const safe = (job) => ({ job: job.id, songId: job.song.id, title: job.song.title, status: job.status,
        error: job.error ?? null, elapsedMs: now() - job.createdAt, durationMs: job.result?.durationMs ?? null,
        actualRvcInference: job.result?.actualRvcInference === true, sent: job.status === 'sent',
        humanListeningAccepted: false, cached: job.cached === true });
    function songs() {
        const file = owned(root, 'catalog.json', 32768), value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (value.schemaVersion !== 1 || !Array.isArray(value.songs) || value.songs.length > 32)
            throw fail('SINGING_NOT_READY');
        const seen = new Set();
        for (const song of value.songs) {
            if (!/^[a-z0-9-]{1,48}$/.test((song.id ?? '')) || seen.has(song.id) || typeof song.title !== 'string' || !song.title || song.title.length > 80
                || !Number.isSafeInteger(song.pitch) || Math.abs(song.pitch) > 12 || !/^[a-f0-9]{64}$/.test((song.guide?.sha256 ?? '')))
                throw fail('SINGING_NOT_READY');
            seen.add(song.id);
        }
        return value.songs;
    }
    function current(owner, id) {
        const job = jobs.get(id);
        if (closed || !token.test((id ?? '')) || !job || job.owner !== owner || now() - job.createdAt > 900000)
            throw fail('SINGING_JOB_EXPIRED');
        return job;
    }
    function output(job) {
        const file = owned(root, job.result.path, 3 * 1024 * 1024), bytes = fs.readFileSync(file);
        if (hash(bytes) !== job.result.sha256 || wav(bytes) !== job.result.durationMs)
            throw fail('SINGING_RESOURCE_CHANGED');
        return bytes;
    }
    function start(owner, input, guard) {
        guard();
        if (closed || typeof owner !== 'string' || !owner || !input || Object.keys(input).some(name => !['songId', 'pitch'].includes(name)))
            throw fail('SINGING_INPUT_INVALID');
        if (active)
            throw fail('SINGING_BUSY');
        for (const [id, job] of jobs)
            if (now() - job.createdAt > 900000)
                jobs.delete(id);
        if (jobs.size >= 32)
            throw fail('SINGING_BUSY');
        const song = songs().find(value => value.id === input.songId), pitch = input.pitch ?? song?.pitch;
        if (!song || !Number.isSafeInteger(pitch) || Math.abs(pitch) > 12)
            throw fail('SINGING_INPUT_INVALID');
        const source = fs.readFileSync(owned(root, song.guide.path, 12 * 1024 * 1024));
        if (hash(source) !== song.guide.sha256)
            throw fail('SINGING_RESOURCE_CHANGED');
        const job = { id: randomBytes(16).toString('hex'), owner, song, createdAt: now(), status: 'preparing' };
        // 已验证小样可直接试听和发送；更改音高时仍执行真实RVC。
        const configBytes = fs.readFileSync(owned(root, 'runtime.json', 32768));
        const config = JSON.parse(configBytes.toString('utf8'));
        if (config.enabled !== true)
            throw fail('SINGING_NOT_READY');
        const cache = song.prepared;
        if (cache?.pitch === pitch && cache.guideSha256 === song.guide.sha256 && cache.modelSha256 === config.voiceModel?.sha256
            && cache.runtimeSha256 === hash(configBytes)) {
            if (hash(fs.readFileSync(owned(root, config.voiceModel.path, 256 * 1024 * 1024))) !== cache.modelSha256)
                throw fail('SINGING_RESOURCE_CHANGED');
            job.result = { path: cache.path, sha256: cache.sha256, durationMs: cache.durationMs, actualRvcInference: true };
            output(job);
            guard();
            job.status = 'prepared';
            job.cached = true;
            jobs.set(job.id, job);
            return safe(job);
        }
        const directory = path.join(root, 'jobs', job.id);
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'vocal.wav'), source, { flag: 'wx' });
        if (song.backing) {
            const bytes = fs.readFileSync(owned(root, song.backing.path, 12 * 1024 * 1024));
            if (hash(bytes) !== song.backing.sha256)
                throw fail('SINGING_RESOURCE_CHANGED');
            fs.writeFileSync(path.join(directory, 'backing.wav'), bytes, { flag: 'wx' });
        }
        jobs.set(job.id, job);
        active = job;
        worker.convert({ id: job.id, op: 'convert', pitch, backingGain: 0.65 }).then(result => {
            if (closed || job.status !== 'preparing')
                return;
            if (result?.file !== job.id + '.wav' || result.actualRvcInference !== true || result.sent !== false || !/^[a-f0-9]{64}$/.test((result.sha256 ?? '')))
                throw fail('SINGING_RESOURCE_CHANGED');
            job.result = { ...result, path: 'outputs/' + result.file };
            output(job);
            job.status = 'prepared';
        }).catch(error => { if (job.status === 'preparing') {
            job.status = 'failed';
            job.error = singingError(error);
        } })
            .finally(() => {
            if (active === job)
                active = null;
            if (['prepared', 'failed', 'cancelled'].includes(job.status)) {
                try {
                    onSettled?.({ job: job.id, owner: job.owner, status: job.status });
                }
                catch { /* 通知失败不改写已经生成的任务结果。 */ }
            }
        });
        return safe(job);
    }
    return { start,
        catalog: () => songs().map(song => ({ id: song.id, title: song.title, defaultPitch: song.pitch })),
        status(owner, id) { return safe(current(owner, id)); },
        audio(owner, id, offset = 0) {
            const job = current(owner, id);
            if (!['prepared', 'sent'].includes(job.status) || !Number.isSafeInteger(offset) || offset < 0)
                throw fail('SINGING_NOT_READY');
            const bytes = output(job);
            if (offset >= bytes.length)
                throw fail('SINGING_INPUT_INVALID');
            return { job: id, offset, size: bytes.length, sha256: job.result.sha256,
                data: bytes.subarray(offset, offset + 131072).toString('base64') };
        },
        async send(owner, id, key, guard) {
            const job = current(owner, id);
            guard();
            if (job.status !== 'prepared' || typeof upload !== 'function' || typeof send !== 'function')
                throw fail('SINGING_NOT_READY');
            const bytes = output(job);
            job.status = 'sending';
            try {
                const segment = await upload(bytes, key, guard);
                guard();
                await send(key, segment, guard);
                job.status = 'sent';
                return safe(job);
            }
            catch {
                job.status = 'send_unconfirmed';
                job.error = 'SINGING_SEND_UNCONFIRMED';
                throw fail('SINGING_SEND_UNCONFIRMED');
            }
        },
        cancel() { for (const job of jobs.values())
            if (['preparing', 'prepared'].includes(job.status))
                job.status = 'cancelled'; },
        async close() { closed = true; await worker.close(); },
        snapshot: () => ({ ...worker.snapshot(), active: Boolean(active), jobs: jobs.size }), };
}
