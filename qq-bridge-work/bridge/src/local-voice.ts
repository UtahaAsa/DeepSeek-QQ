/// <reference types="node" />
import type {LocalVoiceOptions,VoiceProcess,VoiceJob,VoiceParams,VoiceOperation,VoiceRuntimePaths,VoicePacket,WorkerResult,VoiceInferenceResult,VoiceWarmup,PcmAudio,VoiceTransfer,VoiceGuard,VoiceSignalOptions} from './voice/runtime-contracts.js';
import type {NativeRecordSegment} from './native-record-upload.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { inspectSilk, loadSilkCodec } from './silk-codec.js';
import { createPhonePcmConverter } from './phone-pcm.js';

const failure = () => new Error('LOCAL_VOICE_UNAVAILABLE');
const chunkSize = 24576;

/**
 * 创建本机语音识别/合成器；只读既有模型，所有临时文件写自有dataRoot。
 * @param {object} options bot为所属鉴权OneBot；开关取自本次网关权限；配置不包含模型凭据。
 *   spawnProcess仅供合成进程测试替换；生产沿用内置spawn。
 * @returns {object} warmup、QQ语音条transcribe/synthesize、电话transcribePcm/synthesizePcm、close、snapshot。
 * @note 有界串行推理；预热不发送消息；预热中语音输出立即拒绝供上层文字降级。
 *   已取消推理的迟到产物会清理，不上传；超时只终止所属子进程。
 *   电话PCM复用同一推理队列和已选模型，只做有界管道转换，不调用QQ上传/发送。
 */
export function createLocalVoice({ bot, dataRoot, receiveEnabled = false, sendEnabled = false, timeoutMs = 180000, stopTimeoutMs = 10000, spawnProcess = spawn }:LocalVoiceOptions) {
  let child:VoiceProcess|null = null, pending:VoiceJob|null = null, closed = false, failed = false, stderrBytes = 0;
  let childExited = false, closePromise:Promise<unknown[]>|null = null;
  let warmupPromise:Promise<VoiceWarmup>|null = null, warmupStartedAt:number|null = null, phase = 'idle', asrReady = false, ttsReady = false;
  let warmupMs:number|null = null, asrLoadMs:number|null = null, ttsLoadMs:number|null = null, lastProcessingMs:number|null = null;
  const requests:VoiceJob[] = [], counts = { transcribed: 0, synthesized: 0, failures: 0, cancelled: 0 };
  let phonePcm:ReturnType<typeof createPhonePcmConverter>|null=null;
  function pcmConverter() {
    if(phonePcm)return phonePcm;
    const config=JSON.parse(fs.readFileSync(path.join(fs.realpathSync(dataRoot),'runtime.json'),'utf8').replace(/^\uFEFF/,'')) as VoiceRuntimePaths;
    if(!path.isAbsolute(config.ffmpeg)||!fs.lstatSync(config.ffmpeg).isFile())throw failure();
    phonePcm=createPhonePcmConverter({ffmpeg:config.ffmpeg,tempRoot:path.join(dataRoot,'cache/temp')});return phonePcm;
  }
  const active = () => { if (closed || failed || !bot?.isConnected) throw failure(); };
  const owned = new Set<string>();
  const cleanupResult = (job:VoiceJob, result:WorkerResult|null|undefined) => {
    if(job.op==='asr' && /^[a-f0-9]{32}\.pcm$/.test(job.params.file??'')) {
      const file=path.join(dataRoot,job.params.file!);
      if(owned.has(file)){try{fs.unlinkSync(file);}catch{}owned.delete(file);}
    }
    if (job.op === 'tts' && result?.file === job.id + '.wav') {
      const file = path.join(dataRoot, result.file as string);
      try { fs.unlinkSync(file); } catch {} owned.delete(file);
    }
  };
  function failWorker() {
    failed = true; phase = 'failed';
    pending?.finish(failure());
    for (const job of requests.splice(0)) job.finish(failure());
  }
  function launch() {
    if (child) return;
    const root = fs.realpathSync(dataRoot), config = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8').replace(/^\uFEFF/, '')) as VoiceRuntimePaths;
    if (!path.isAbsolute(config.python) || !fs.existsSync(config.python) || !path.isAbsolute(config.engine)) throw failure();
    const inherited = { ...process.env };
    for (const key of Object.keys(inherited)) if (/^(?:DSH|DEEPSEEK|OPENAI|ANTHROPIC|SNOWLUMA).*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL)/i.test(key)) delete inherited[key];
    delete inherited.QQ_NATIVE_GATEWAY_STATUS;
    child = spawnProcess(config.python, ['-B', '-u', fileURLToPath(new URL('../../integration/voice-worker.py', import.meta.url))], {
      cwd: config.engine, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...inherited, QQ_VOICE_DATA: root, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8',
        PATH: path.dirname(config.ffmpeg) + path.delimiter + process.env.PATH,
        TOKENIZERS_PARALLELISM: 'false', USE_LIBUV: '0', version: 'v2', language: 'zh_CN', hz: '25hz',
        is_half: 'True', OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4',
        bert_path: path.join(config.pretrained, 'chinese-roberta-wwm-ext-large'),
        TEMP: path.join(root, 'cache', 'temp'), TMP: path.join(root, 'cache', 'temp') } });
    const lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => {
      if (!pending) return;
      if (!line.startsWith('QQVOICE/1 ')) { stderrBytes += Buffer.byteLength(line); return; }
      try { if (line.length > 16000) throw failure(); const data = JSON.parse(line.slice(10)) as VoicePacket;
        if (data.id !== pending.id) throw failure();
        if (data.progress && pending.op === 'warmup') {
          if (!['loading_asr', 'warming_asr', 'loading_tts', 'warming_tts'].includes(data.progress.phase as string) ||
              !Number.isSafeInteger(data.progress.elapsedMs) || (data.progress.elapsedMs as number) < 0 || (data.progress.elapsedMs as number) > timeoutMs) throw failure();
          phase = data.progress.phase as string; return;
        }
        if (typeof data.ok !== 'boolean') throw failure();
        if (!data.ok) {
          if (process.env.QQ_VOICE_DIAGNOSTICS === '1') fs.writeFileSync(path.join(root, 'synthetic-protocol-error.json'), JSON.stringify({ error: data.error, errorType: data.errorType }));
          throw failure();
        } pending.finish(null, data.result);
      } catch { failWorker(); child?.kill(); }
    });
    child.stderr!.on('data', (bytes:Buffer) => { stderrBytes += bytes.length;
      if (process.env.QQ_VOICE_DIAGNOSTICS === '1') fs.appendFileSync(path.join(root, 'synthetic-diagnostic.log'), bytes); });
    const onExit = () => {
      childExited = true;
      if (!closed) failWorker();
      for (const file of owned) { try { fs.unlinkSync(file); } catch {} } owned.clear();
    };
    child.once('error', () => { if (!child!.pid) onExit(); failWorker(); }); child.stdin!.on('error', failWorker);
    child.once('exit', onExit);
  }
  function pump() {
    if (pending || !requests.length || closed || failed) return;
    const job = requests.shift()!;
    try {
      active(); launch(); pending = job;
      if (job.op === 'tts' || job.op === 'warmup' && job.params.send) owned.add(path.join(dataRoot, job.id + '.wav'));
      child!.stdin!.write(JSON.stringify({ id: job.id, op: job.op, ...job.params }) + '\n', error => { if (error) failWorker(); });
    } catch { job.finish(failure()); }
  }
  async function infer(op:VoiceOperation, params:VoiceParams, signal?:AbortSignal):Promise<VoiceInferenceResult> {
    active(); if (requests.length >= 8 || signal?.aborted) throw failure();
    return new Promise<VoiceInferenceResult>((resolve, reject) => {
      let settled = false, cancelled = false;
      const job:VoiceJob = { id: randomBytes(16).toString('hex'), op, params, finish(error, value) {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        const index = requests.indexOf(job); if (index >= 0) requests.splice(index, 1);
        if (pending === job) pending = null;
        if (cancelled || job.op==='asr') cleanupResult(job, value);
        if (job.op === 'asr_pcm') job.params.pcm = '';
        if (!error && job.op === 'warmup') owned.delete(path.join(dataRoot, job.id + '.wav'));
        if (!settled) {
          settled = true;
          if (error) { counts.failures++; reject(error); }
          else { lastProcessingMs = Number.isSafeInteger(value?.processingMs) ? value!.processingMs as number : null; resolve({ ...value, id: job.id }); }
        }
        queueMicrotask(pump);
      } };
      const abort = () => {
        cancelled = true;
        if (!settled) { settled = true; counts.cancelled++; reject(failure()); }
        if (pending !== job) job.finish(failure());
        // 正在运行的推理仍保留槽位，直到真实回执/超时；不能把下一请求误配给迟到回执。
      };
      const timer = setTimeout(() => {
        if (pending === job) { failWorker(); child?.kill(); }
        else job.finish(failure());
      }, timeoutMs);
      signal?.addEventListener('abort', abort, { once: true }); requests.push(job); pump();
    });
  }
  function warmup() {
    if (warmupPromise) return warmupPromise;
    active(); warmupStartedAt = Date.now(); phase = 'starting';
    warmupPromise = infer('warmup', { receive: receiveEnabled, send: sendEnabled }).then(result => {
      if (typeof result.asrReady !== 'boolean' || typeof result.ttsReady !== 'boolean' ||
          (receiveEnabled && !result.asrReady) || (sendEnabled && !result.ttsReady) ||
          !['warmupMs', 'asrLoadMs', 'ttsLoadMs'].every(key => Number.isSafeInteger(result[key]) && (result[key] as number) >= 0 && (result[key] as number) <= timeoutMs)) throw failure();
      active(); asrReady = result.asrReady; ttsReady = result.ttsReady;
      warmupMs = Date.now() - warmupStartedAt!; asrLoadMs = result.asrLoadMs as number; ttsLoadMs = result.ttsLoadMs as number; phase = 'ready';
      return { asrReady, ttsReady, warmupMs, asrLoadMs, ttsLoadMs };
    }).catch(error => { warmupMs = Date.now() - warmupStartedAt!; phase = 'failed'; throw error; });
    return warmupPromise;
  }
  async function transcribe(handle:unknown) {
    active(); if (!receiveEnabled || !/^qqvoice_[a-f0-9]{32}$/.test((handle ?? '') as string)) throw failure();
    const info = (await bot.raw('get_record', { file: handle }, { timeoutMs: 20000 }) as VoiceTransfer|null)?.native_record;
    if (info?.file !== handle || !Number.isSafeInteger(info!.size) || (info!.size as number) < 12 || (info!.size as number) > 2 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test((info!.sha256 ?? '') as string)) throw failure();
    const chunks:Buffer[] = []; let size = 0;
    while (size < (info!.size as number)) {
      active(); const part = await bot.raw('get_record', { file: handle, offset: size }, { timeoutMs: 5000 }) as VoiceTransfer|null;
      if (part?.file !== handle || part!.offset !== size || part!.size !== info!.size || typeof part!.data !== 'string' || part!.data.length > 32768) throw failure();
      const bytes = Buffer.from(part!.data, 'base64');
      if (bytes.toString('base64') !== part!.data || bytes.length !== Math.min(chunkSize, (info!.size as number) - size)) throw failure();
      chunks.push(bytes); size += bytes.length;
    }
    const silk = Buffer.concat(chunks); inspectSilk(silk);
    if (createHash('sha256').update(silk).digest('hex') !== info!.sha256) throw failure();
    const codec = await loadSilkCodec(), decoded = await codec.decode(silk, 16000);
    if (!decoded.data.length || decoded.data.length > 16000 * 2 * 60) throw failure();
    const name = randomBytes(16).toString('hex') + '.pcm', file = path.join(fs.realpathSync(dataRoot), name);
    fs.writeFileSync(file, decoded.data, { flag: 'wx' }); owned.add(file);
    try { const result = await infer('asr', { file: name }); active();
      if (typeof result.text !== 'string' || result.text.length > 2000) throw failure();
      counts.transcribed++; return result.text;
    } finally { try { fs.unlinkSync(file); } catch {} owned.delete(file); }
  }
  async function synthesize(key:string, text:unknown, guard:VoiceGuard, { signal }:VoiceSignalOptions = {}):Promise<NativeRecordSegment> {
    active(); if (!sendEnabled || !/^(private|group):[1-9]\d{0,19}$/.test(key ?? '') || typeof text !== 'string' ||
      !text.trim() || Array.from(text).length > 120 || /[\x00-\x1f]/.test(text)) throw failure();
    if (warmupPromise && !ttsReady) throw new Error(phase === 'failed' ? 'LOCAL_VOICE_UNAVAILABLE' : 'VOICE_WARMING');
    const current = () => { active(); guard(); if (signal?.aborted) throw failure(); };
    current(); const result = await infer('tts', { text }, signal);
    if (result.file !== result.id + '.wav') throw failure();
    const file = path.join(fs.realpathSync(dataRoot), result.file as string); owned.add(file);
    let bytes:Buffer;
    try {
      current();
      const st = fs.lstatSync(file); if (!st.isFile() || st.isSymbolicLink() || st.size > 5 * 1024 * 1024) throw failure();
      const codec = await loadSilkCodec();
      bytes = Buffer.from((await codec.encode(fs.readFileSync(file), 0)).data); inspectSilk(bytes);
    } finally { try { fs.unlinkSync(file); } catch {} owned.delete(file); }
    current(); const [kind, target] = key.split(':');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const started = await bot.raw('upload_record', { operation: 'begin', kind, target, size: bytes.length, sha256 }) as VoiceTransfer|null;
    if (!/^qqvu_[a-f0-9]{32}$/.test((started?.upload ?? '') as string)) throw failure();
    try {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        current(); const data = bytes.subarray(offset, offset + chunkSize);
        const result = await bot.raw('upload_record', { operation: 'append', upload: started!.upload, offset, data: data.toString('base64') }) as VoiceTransfer;
        if (result.offset !== offset + data.length) throw failure();
      }
      current(); const result = await bot.raw('upload_record', { operation: 'finish', upload: started!.upload }) as VoiceTransfer;
      if (!/^qqvoice_[a-f0-9]{32}$/.test((result.file ?? '') as string)) throw failure();
      counts.synthesized++; return { type: 'record', data: { file: result.file } };
    } catch (error) { await bot.raw('upload_record', { operation: 'abort', upload: started!.upload }).catch(() => {}); throw error; }
  }
  /** 识别当前电话的48k单声道PCM16；守卫在转换及推理前后执行，不查询QQ语音条。 */
  async function transcribePcm(bytes:Buffer,guard:VoiceGuard,{signal}:VoiceSignalOptions={}) {
    const current=()=>{active();if(!receiveEnabled||typeof guard!=='function'||signal?.aborted)throw failure();guard();};
    current();const decoded=await pcmConverter().convert(bytes,'asr',{signal});
    try{
      current();const result=await infer('asr_pcm',{pcm:decoded.toString('base64')},signal);current();
      if(typeof result.text!=='string'||result.text.length>2000)throw failure();counts.transcribed++;return result.text;
    }finally{
      decoded.fill(0);
    }
  }
  /** 用当前已选声音生成电话PCM；无QQ上传/发送。取消或代次失效时丢弃迟到产物。 */
  async function synthesizePcm(text:unknown,guard:VoiceGuard,{signal}:VoiceSignalOptions={}):Promise<PcmAudio> {
    const current=()=>{active();if(!sendEnabled||typeof guard!=='function'||signal?.aborted)throw failure();guard();};
    current();if(typeof text!=='string'||!text.trim()||Array.from(text).length>120||/[\x00-\x1f]/.test(text))throw failure();
    if(warmupPromise&&!ttsReady)throw new Error(phase==='failed'?'LOCAL_VOICE_UNAVAILABLE':'VOICE_WARMING');
    const result=await infer('tts',{text},signal);
    if(result.file!==result.id+'.wav')throw failure();
    const file=path.join(fs.realpathSync(dataRoot),result.file as string);owned.add(file);
    try{
      current();
      const info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info!.size>5*1024*1024)throw failure();
      const pcm=await pcmConverter().convert(fs.readFileSync(file),'tts',{signal});current();
      const pad=(1920-pcm.length%1920)%1920;const framed=pad?Buffer.concat([pcm,Buffer.alloc(pad)]):pcm;
      counts.synthesized++;return {pcm:framed,sampleRate:48000,channels:1,frameMs:20};
    }finally{try{fs.unlinkSync(file);}catch{}owned.delete(file);}
  }
  function close() {
    if (closePromise) return closePromise;
    closed = true; pending?.finish(failure()); for (const job of requests.splice(0)) job.finish(failure());
    for (const file of owned) { try { fs.unlinkSync(file); } catch {} }
    if (!child) owned.clear();
    const voiceStopped = !child || childExited ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { child!.removeListener('exit', done); reject(new Error('VOICE_WORKER_STOP_UNCONFIRMED')); }, stopTimeoutMs);
      child!.once('exit', done);
      try { child!.stdin!.end(); child!.kill(); } catch { /* 仍等待真实退出事件，不能只看killed。 */ }
    });
    closePromise=Promise.all([voiceStopped,phonePcm?.close()]);return closePromise;
  }
  return { warmup, transcribe, synthesize, transcribePcm, synthesizePcm, close, snapshot: () => ({ ...counts, running: Boolean(child && !child.killed), failed, stderrBytes,
    phase, receiveEnabled, sendEnabled, asrReady, ttsReady, queued: requests.length, busy: Boolean(pending),
    elapsedMs: warmupMs ?? (warmupStartedAt ? Date.now() - warmupStartedAt! : 0), warmupMs, asrLoadMs, ttsLoadMs, lastProcessingMs }) };
}
