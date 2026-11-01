"""只读复用本机已选声音/ASR；stdin请求，stdout仅回固定协议，缓存和结果限自有D盘目录。"""
import hashlib
import base64
import json
import os
from pathlib import Path
import re
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(os.environ['QQ_VOICE_DATA']).resolve(strict=True)
CONFIG = json.loads((ROOT / 'runtime.json').read_text(encoding='utf-8-sig'))
for key, name in {'TEMP': 'temp', 'TMP': 'temp', 'HF_HOME': 'hf', 'TORCH_HOME': 'torch',
                  'NUMBA_CACHE_DIR': 'numba', 'MPLCONFIGDIR': 'matplotlib', 'TORCHINDUCTOR_CACHE_DIR': 'inductor',
                  'TRITON_CACHE_DIR': 'triton', 'CUDA_CACHE_PATH': 'cuda', 'XDG_CACHE_HOME': 'cache'}.items():
    folder = ROOT / 'cache' / name
    folder.mkdir(parents=True, exist_ok=True)
    os.environ[key] = str(folder)
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', DO_NOT_TRACK='1')


def writable(value):
    if value is None or isinstance(value, int) or os.fsdecode(value).lower() == os.devnull.lower():
        return
    if not Path(os.fsdecode(value)).resolve().is_relative_to(ROOT):
        raise PermissionError('VOICE_WRITE_BOUNDARY')


def guard(event, args):
    if event == 'open':
        name, mode, flags = args
        if (isinstance(mode, str) and any(c in mode for c in 'wax+')) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
            writable(name)
    elif event in ('os.mkdir', 'os.remove', 'os.rmdir', 'os.chmod', 'os.utime'):
        writable(args[0])
    elif event in ('os.rename', 'os.link', 'os.symlink'):
        writable(args[0]); writable(args[1])
    elif event == 'socket.connect':
        raise PermissionError('VOICE_NETWORK_DISABLED')


sys.addaudithook(guard)
protocol = sys.stdout
sys.stdout = sys.stderr
import numpy as np
import soundfile as sf
import torch
torch.set_num_threads(4)
tts = None
asr = None
load_times = {'ttsLoadMs': 0, 'asrLoadMs': 0}


def sha(name):
    h = hashlib.sha256()
    with open(name, 'rb') as f:
        for part in iter(lambda: f.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def load_tts(selected):
    global tts
    if tts is None:
        started = time.perf_counter()
        for key in ('gpt', 'sovits'):
            if sha(selected['models'][key]) != selected['models'][key + '_sha256']:
                raise ValueError('VOICE_MODEL_CHANGED')
        if sha(selected['reference']['inference_audio']) != selected['reference']['inference_sha256']:
            raise ValueError('VOICE_REFERENCE_CHANGED')
        engine = Path(CONFIG['engine'])
        sys.path[:0] = [str(engine), str(engine / 'GPT_SoVITS')]
        from TTS_infer_pack.TTS import TTS, TTS_Config
        pre = Path(CONFIG['pretrained'])
        config = TTS_Config({'version': 'v2', 'custom': {'version': 'v2', 'device': 'cuda', 'is_half': True,
            't2s_weights_path': selected['models']['gpt'], 'vits_weights_path': selected['models']['sovits'],
            'cnhuhbert_base_path': str(pre / 'chinese-hubert-base'), 'bert_base_path': str(pre / 'chinese-roberta-wwm-ext-large')}})
        config.configs_path = str(ROOT / 'inference.yaml')
        tts = TTS(config)
        load_times['ttsLoadMs'] = round((time.perf_counter() - started) * 1000)


def load_asr():
    global asr
    if asr is None:
        started = time.perf_counter()
        from transformers import pipeline
        asr = pipeline('automatic-speech-recognition', model=CONFIG['asrModel'], device='cuda', torch_dtype=torch.float16,
                       model_kwargs={'local_files_only': True})
        load_times['asrLoadMs'] = round((time.perf_counter() - started) * 1000)


def selected_path(value, base):
    if not isinstance(value, str) or not value.strip() or re.search(r'[\x00-\x1f]', value) or re.match(r'^(?:[\\/]{2}|[a-z]+://)', value, re.I):
        raise ValueError('VOICE_SELECTION_PATH_INVALID')
    return str((base / value).resolve(strict=True))


def selected_voice():
    selected = json.loads(Path(CONFIG['selectedVoice']).read_text(encoding='utf-8-sig'))
    selected_base = Path(CONFIG['selectedVoice']).parent
    for key in ('gpt', 'sovits'):
        selected['models'][key] = selected_path(selected['models'][key], selected_base)
    selected['reference']['inference_audio'] = selected_path(selected['reference']['inference_audio'], selected_base)
    return selected


def synthesize(request):
    text = request.get('text')
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 120 or any(ord(c) < 32 for c in text):
        raise ValueError('VOICE_TEXT_LIMIT')
    selected = selected_voice()
    load_tts(selected)
    params = dict(selected['inference_parameters'], text=text, ref_audio_path=selected['reference']['inference_audio'])
    # 已复现cut0把含停顿的多句台词提前结束；桥接默认按标点分段再由引擎拼接。
    # 只修改本次请求，保留外部已选声音文件及其余推理参数；已选其它切句方式仍沿用。
    if params.get('text_split_method', 'cut0') == 'cut0':
        params['text_split_method'] = 'cut5'
    parts = list(tts.run(params))
    if not parts or len({rate for rate, _ in parts}) != 1:
        raise ValueError('VOICE_SYNTHESIS_FAILED')
    rate = parts[0][0]
    audio = np.concatenate([part for _, part in parts])
    if np.issubdtype(audio.dtype, np.integer):
        audio = audio.astype(np.float32) / 32768
    if not np.isfinite(audio).all() or not np.any(audio) or not .2 < len(audio) / rate <= 45:
        raise ValueError('VOICE_AUDIO_LIMIT')
    rms = float(np.sqrt(np.mean(audio ** 2)))
    gain = min(10 ** (-20 / 20) / max(rms, 1e-9), .98 / max(float(np.max(np.abs(audio))), 1e-9))
    output = ROOT / (request['id'] + '.wav')
    # 沿用已选日常试听的恒定增益；不使用问候样本专属的0.64秒裁剪。
    with output.open('xb') as f:
        sf.write(f, audio * gain, rate, format='WAV', subtype='PCM_16')
    return {'file': output.name, 'seconds': len(audio) / rate, 'sampleRate': rate,
            'textSplitMethod': params['text_split_method']}


def transcribe_bytes(raw):
    global asr
    if not 6400 <= len(raw) <= 16000 * 2 * 60 or len(raw) % 2:
        raise ValueError('VOICE_INPUT_INVALID')
    audio = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
    try:
        if float(np.sqrt(np.mean(audio ** 2))) < .0003:
            return {'text': '', 'silent': True}
        load_asr()
        result = asr({'raw': audio, 'sampling_rate': 16000}, return_timestamps=True,
                     generate_kwargs={'language': 'chinese', 'task': 'transcribe', 'do_sample': False, 'num_beams': 1})
        text = result.get('text', '').strip()
        if len(text) > 2000:
            raise ValueError('VOICE_TRANSCRIPT_LIMIT')
        return {'text': text, 'silent': False}
    finally:
        audio.fill(0)


def transcribe(request):
    name = request.get('file')
    if not isinstance(name, str) or not re.fullmatch(r'[a-f0-9]{32}\.pcm', name):
        raise ValueError('VOICE_INPUT_INVALID')
    source = ROOT / name
    if source.is_symlink() or not source.resolve(strict=True).is_relative_to(ROOT) or not 6400 <= source.stat().st_size <= 16000 * 2 * 60:
        raise ValueError('VOICE_INPUT_INVALID')
    return transcribe_bytes(source.read_bytes())


def transcribe_memory(request):
    encoded = request.pop('pcm', None)
    if not isinstance(encoded, str) or len(encoded) > 640000:
        raise ValueError('VOICE_INPUT_INVALID')
    try:
        raw = bytearray(base64.b64decode(encoded, validate=True))
    except (ValueError, TypeError):
        raise ValueError('VOICE_INPUT_INVALID')
    try:
        if base64.b64encode(raw).decode('ascii') != encoded or not 6400 <= len(raw) <= 16000 * 2 * 15 or len(raw) % 2:
            raise ValueError('VOICE_INPUT_INVALID')
        encoded = None
        return transcribe_bytes(raw)
    finally:
        raw[:] = b'\0' * len(raw)


def warmup(request):
    """仅用固定合成信号预热；不读取QQ音频、不上传、不发送，合成结果随即删除。"""
    if not isinstance(request.get('receive'), bool) or not isinstance(request.get('send'), bool) or not (request['receive'] or request['send']):
        raise ValueError('VOICE_WARMUP_INVALID')
    started = time.perf_counter()

    def progress(phase):
        protocol.write('QQVOICE/1 ' + json.dumps({'id': request['id'], 'progress': {
            'phase': phase, 'elapsedMs': round((time.perf_counter() - started) * 1000)}}) + '\n')
        protocol.flush()

    if request['receive']:
        progress('loading_asr'); load_asr(); progress('warming_asr')
        signal = np.sin(np.arange(8000, dtype=np.float32) * (2 * np.pi * 220 / 16000)) * .01
        # 结果仅用于触发推理内核，不把合成信号的识别文本交给任何聊天会话。
        asr({'raw': signal, 'sampling_rate': 16000}, return_timestamps=True,
            generate_kwargs={'language': 'chinese', 'task': 'transcribe', 'do_sample': False, 'num_beams': 1})
    if request['send']:
        progress('loading_tts')
        load_tts(selected_voice())
        progress('warming_tts')
        output = ROOT / (request['id'] + '.wav')
        try:
            synthesize({'id': request['id'], 'text': '语音准备好了。'})
        finally:
            if output.exists():
                output.unlink()
    return {'asrReady': bool(request['receive'] and asr is not None), 'ttsReady': bool(request['send'] and tts is not None),
            'warmupMs': round((time.perf_counter() - started) * 1000), **load_times}


for line in sys.stdin:
    request = None
    try:
        line_size = len(line)
        if line_size > 650000:
            raise ValueError('VOICE_REQUEST_LIMIT')
        request = json.loads(line)
        line = ''
        if request.get('op') != 'asr_pcm' and line_size > 12000:
            raise ValueError('VOICE_REQUEST_LIMIT')
        if not re.fullmatch(r'[a-f0-9]{32}', request.get('id', '')):
            raise ValueError('VOICE_REQUEST_INVALID')
        inference_started = time.perf_counter()
        result = {'tts': synthesize, 'asr': transcribe, 'asr_pcm': transcribe_memory, 'warmup': warmup}[request['op']](request)
        result['processingMs'] = round((time.perf_counter() - inference_started) * 1000)
        protocol.write('QQVOICE/1 ' + json.dumps({'id': request['id'], 'ok': True, 'result': result}, ensure_ascii=False) + '\n')
    except Exception as error:
        # 不把本地路径、模型内部日志或收到的语音正文带进错误响应。
        if os.environ.get('QQ_VOICE_DIAGNOSTICS') == '1':
            import traceback
            (ROOT / 'synthetic-traceback.txt').write_text(traceback.format_exc(), encoding='utf-8')
            traceback.print_exc(file=sys.stderr)
        protocol.write('QQVOICE/1 ' + json.dumps({'id': request.get('id') if isinstance(locals().get('request'), dict) else None,
                                   'ok': False, 'error': 'VOICE_INFERENCE_FAILED', 'errorType': type(error).__name__}) + '\n')
    protocol.flush()
