"""固定RVC发行版的隔离推理候选；默认检查不载入模型，不联网、不训练。"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time
from types import SimpleNamespace
import wave

sys.dont_write_bytecode = True
PROJECT = Path(__file__).resolve().parents[1]
REVISION = '8f2fdbf483955f924b4c87ab34919170d0b704ed'
SOURCE_HASHES = {
    'infer/hubert.py': 'bbfba54d1d83eae3fb634b2909f8f6bf41e6ffe436200ec246867c5c93ebba26',
    'infer/vc/utils.py': '13dd0c749d22f73fb1962c6328036e5fd8600023640d25d1b1445e1fe07d58d3',
    'infer/vc/pipeline.py': 'df8ccd98ca7f81e38934a0af93cc63b4f79764dc47d932f05914c566e876522a',
    'infer/vc/modules.py': 'd5b419293d00cd7329354da13e2384f3d03f1d56b32b544c06b31a936f716501',
}
BASE_ASSETS = (
    'engine/assets/hubert_base/config.json',
    'engine/assets/hubert_base/preprocessor_config.json',
    'engine/assets/hubert_base/pytorch_model.bin',
    'engine/assets/rmvpe/rmvpe.pt',
)
MAX_SECONDS = 60
MAX_WAV_BYTES = 12 * 1024 * 1024


class SingingError(Exception):
    """只向调用方提供固定错误码，不转发路径、模型日志或用户输入。"""


def sha256(file):
    result = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def local_file(root, relative, maximum=2 * 1024 * 1024 * 1024):
    """解析自有根内普通文件；拒绝绝对路径、上跳、链接和Windows重解析点。"""
    if not isinstance(relative, str) or not relative or len(relative) > 240 or ':' in relative or '\\' in relative or any(ord(c) < 32 for c in relative):
        raise SingingError('RVC_PATH_REFUSED')
    parts = relative.split('/')
    if any(part in ('', '.', '..') for part in parts):
        raise SingingError('RVC_PATH_REFUSED')
    root = Path(root).resolve(strict=True)
    file = root
    try:
        for part in parts:
            file /= part
            info = file.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                raise SingingError('RVC_PATH_REFUSED')
        if not file.resolve(strict=True).is_relative_to(root) or not file.is_file() or info.st_size > maximum:
            raise SingingError('RVC_PATH_REFUSED')
    except OSError as error:
        raise SingingError('RVC_RESOURCE_MISSING') from error
    return file


def checked_asset(root, entry, maximum=2 * 1024 * 1024 * 1024):
    """校验本机操作者记录的资源摘要；不接受模型或聊天提供的任意外部文件。"""
    if not isinstance(entry, dict) or set(entry) != {'path', 'sha256'} or not isinstance(entry.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', entry['sha256']):
        raise SingingError('RVC_ASSET_HASH_REQUIRED')
    file = local_file(root, entry['path'], maximum)
    if sha256(file) != entry['sha256']:
        raise SingingError('RVC_ASSET_CHANGED')
    return file


def inspect_wave(file):
    """检查完整PCM16 WAV及时长，仅读取；不截断、补帧或把文件存在当成合格音频。"""
    if Path(file).stat().st_size > MAX_WAV_BYTES:
        raise SingingError('SINGING_AUDIO_TOO_LARGE')
    try:
        with wave.open(str(file), 'rb') as audio:
            rate, frames, channels = audio.getframerate(), audio.getnframes(), audio.getnchannels()
            if audio.getcomptype() != 'NONE' or audio.getsampwidth() != 2 or channels not in (1, 2):
                raise SingingError('SINGING_PCM16_REQUIRED')
            if rate not in (16000, 22050, 24000, 32000, 40000, 44100, 48000) or frames <= 0:
                raise SingingError('SINGING_AUDIO_FORMAT_INVALID')
            if frames > rate * MAX_SECONDS:
                raise SingingError('SINGING_AUDIO_TOO_LONG')
            if len(audio.readframes(frames)) != frames * channels * 2:
                raise SingingError('SINGING_AUDIO_TRUNCATED')
            return {'rate': rate, 'frames': frames, 'channels': channels, 'durationMs': round(frames * 1000 / rate)}
    except (wave.Error, EOFError) as error:
        raise SingingError('SINGING_AUDIO_FORMAT_INVALID') from error


def read_resources(root):
    """只读验证固定RVC代码、个人音色、索引和基础模型；不导入Torch或占用GPU。"""
    root = Path(root).resolve()
    if not root.is_relative_to(PROJECT):
        raise SingingError('RVC_ROOT_REFUSED')
    if not (root / 'runtime.json').is_file():
        raise SingingError('RVC_CONFIGURATION_MISSING')
    file = local_file(root, 'runtime.json', 32768)
    try:
        config = json.loads(file.read_text(encoding='utf-8-sig'))
    except (ValueError, UnicodeError) as error:
        raise SingingError('RVC_CONFIGURATION_INVALID') from error
    fields = {'schemaVersion', 'engineRevision', 'enabled', 'device', 'half', 'voiceModel', 'index', 'baseAssets', 'ffmpegSha256'}
    if not isinstance(config, dict) or set(config) != fields or config['schemaVersion'] != 1 or config['engineRevision'] != REVISION:
        raise SingingError('RVC_CONFIGURATION_INVALID')
    if type(config['enabled']) is not bool or type(config['half']) is not bool or config['device'] not in ('cpu', 'cuda:0'):
        raise SingingError('RVC_CONFIGURATION_INVALID')
    if config['device'] == 'cpu' and config['half']:
        raise SingingError('RVC_CONFIGURATION_INVALID')
    for relative, expected in SOURCE_HASHES.items():
        source = local_file(root, 'engine/' + relative, 1024 * 1024)
        if sha256(source) != expected:
            raise SingingError('RVC_ENGINE_CHANGED')
    model = checked_asset(root, config['voiceModel'])
    if model.suffix != '.pth':
        raise SingingError('RVC_MODEL_FORMAT_INVALID')
    index = checked_asset(root, config['index']) if config['index'] is not None else None
    if index is not None and index.suffix != '.index':
        raise SingingError('RVC_MODEL_FORMAT_INVALID')
    assets = config['baseAssets']
    if not isinstance(assets, dict) or set(assets) != set(BASE_ASSETS):
        raise SingingError('RVC_BASE_ASSETS_INVALID')
    for relative in BASE_ASSETS:
        checked_asset(root, {'path': relative, 'sha256': assets[relative]})
    ffmpeg = PROJECT / 'integration' / 'data' / 'bridge' / 'ffmpeg.exe'
    if not isinstance(config['ffmpegSha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', config['ffmpegSha256']) or not ffmpeg.is_file() or sha256(ffmpeg) != config['ffmpegSha256']:
        raise SingingError('RVC_FFMPEG_UNVERIFIED')
    return {'root': root, 'config': config, 'model': model, 'index': index, 'ffmpeg': ffmpeg}


def readiness(root):
    """返回固定就绪状态；资源检查通过仍不等于实际推理或人工听感通过。"""
    try:
        resources = read_resources(root)
        return {'configured': True, 'enabled': resources['config']['enabled'], 'engine': 'RVC 2.3.260718',
                'sourceAndAssetHashesVerified': True, 'realInferenceVerified': False}
    except SingingError as error:
        return {'configured': False, 'enabled': False, 'error': str(error), 'realInferenceVerified': False}
    except (OSError, ValueError, TypeError, RecursionError):
        return {'configured': False, 'enabled': False, 'error': 'RVC_CONFIGURATION_INVALID', 'realInferenceVerified': False}


def owned_directory(root, relative):
    """逐层建立自有缓存目录，在创建子目录前拒绝已有链接或重解析点。"""
    current = Path(root).resolve(strict=True)
    for part in relative.split('/'):
        if part in ('', '.', '..') or ':' in part or '\\' in part:
            raise SingingError('RVC_PATH_REFUSED')
        current /= part
        try:
            info = current.lstat()
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                raise SingingError('RVC_PATH_REFUSED')
        except FileNotFoundError:
            current.mkdir()
    return current


def inference_environment(resources):
    """将本次推理的写入和缓存限制在自有目录；审计钩子不等同操作系统沙箱。"""
    root = resources['root']
    for name in ('cache', 'outputs', 'indexes'):
        owned_directory(root, name)
    for key, name in {'TEMP': 'temp', 'TMP': 'temp', 'HF_HOME': 'hf', 'TORCH_HOME': 'torch',
                      'NUMBA_CACHE_DIR': 'numba', 'MPLCONFIGDIR': 'matplotlib', 'XDG_CACHE_HOME': 'xdg',
                      'TORCH_EXTENSIONS_DIR': 'extensions', 'TORCHINDUCTOR_CACHE_DIR': 'inductor',
                      'TRITON_CACHE_DIR': 'triton', 'CUDA_CACHE_PATH': 'cuda'}.items():
        folder = owned_directory(root, 'cache/' + name)
        os.environ[key] = str(folder)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                      DO_NOT_TRACK='1', TOKENIZERS_PARALLELISM='false', OMP_NUM_THREADS='2', MKL_NUM_THREADS='2',
                      RVC_CUDA_GRAPH='0', HF_TOKEN_PATH=str(root / 'cache' / 'hf' / 'no-credentials'),
                      weight_root=str(resources['model'].parent), index_root=str(root / 'indexes'),
                      outside_index_root=str(root / 'indexes'), rmvpe_root=str(root / 'engine/assets/rmvpe'))
    for key in list(os.environ):
        if re.match(r'^(?:DSH|DEEPSEEK|OPENAI|ANTHROPIC|SNOWLUMA|HF|HUGGING_FACE).*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL)', key, re.I) and key != 'HF_TOKEN_PATH':
            os.environ.pop(key, None)
    os.environ['PATH'] = str(resources['ffmpeg'].parent) + os.pathsep + os.environ.get('PATH', '')
    writable_roots = [root / 'cache', root / 'outputs']

    def writable(value):
        if isinstance(value, int) or value is None or os.fsdecode(value).lower() == os.devnull.lower():
            return
        file = Path(os.fsdecode(value)).resolve()
        if not any(file.is_relative_to(allowed) for allowed in writable_roots):
            raise PermissionError('RVC_WRITE_BOUNDARY')

    def audit(event, args):
        if event == 'open':
            name, mode, flags = args
            if (isinstance(mode, str) and any(letter in mode for letter in 'wax+')) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
                writable(name)
        elif event in ('os.mkdir', 'os.remove', 'os.rmdir', 'os.chmod', 'os.utime'):
            writable(args[0])
        elif event in ('os.rename', 'os.link', 'os.symlink'):
            writable(args[0]); writable(args[1])
        elif event in ('socket.connect', 'socket.bind'):
            raise PermissionError('RVC_NETWORK_DISABLED')
    sys.addaudithook(audit)
    os.chdir(root / 'engine')
    sys.path.insert(0, str(root / 'engine'))


class RvcSinger:
    """串行转换已登记的演唱音轨；不把普通文字TTS伪装为唱歌，不自行发送QQ。"""
    def __init__(self, resources):
        self.resources = resources
        self.vc = None

    def load(self):
        if self.vc is not None:
            return
        if not self.resources['config']['enabled']:
            raise SingingError('RVC_INFERENCE_DISABLED')
        inference_environment(self.resources)
        import torch
        from infer.vc.modules import VC
        torch.set_num_threads(2)
        config = self.resources['config']
        if config['device'] == 'cuda:0' and not torch.cuda.is_available():
            raise SingingError('RVC_SELECTED_DEVICE_UNAVAILABLE')
        # 使用已选设备与确定参数；不导入会上探设备并改变源配置的Config入口。
        selected = SimpleNamespace(device=config['device'], is_half=config['half'],
                                   dtype=torch.float16 if config['half'] else torch.float32,
                                   x_pad=3 if config['half'] else 1, x_query=10 if config['half'] else 6,
                                   x_center=60 if config['half'] else 38, x_max=65 if config['half'] else 41,
                                   cuda_graph=False)
        self.vc = VC(selected)
        self.vc.get_vc(self.resources['model'].name)
        if self.vc.net_g is None or self.vc.if_f0 != 1:
            raise SingingError('RVC_PITCH_MODEL_REQUIRED')

    def convert(self, request):
        allowed = {'id', 'op', 'pitch', 'backingGain'}
        if set(request) - allowed or not isinstance(request.get('id'), str) or not re.fullmatch(r'[a-f0-9]{32}', request['id']):
            raise SingingError('SINGING_REQUEST_INVALID')
        pitch, backing_gain = request.get('pitch', 0), request.get('backingGain', 0.65)
        if type(pitch) is not int or not -12 <= pitch <= 12 or type(backing_gain) not in (int, float) or not math.isfinite(backing_gain) or not 0 <= backing_gain <= 1:
            raise SingingError('SINGING_REQUEST_INVALID')
        root, job = self.resources['root'], request['id']
        vocal = local_file(root, 'jobs/' + job + '/vocal.wav', MAX_WAV_BYTES)
        info = inspect_wave(vocal)
        backing_name = 'jobs/' + job + '/backing.wav'
        backing = local_file(root, backing_name, MAX_WAV_BYTES) if (root / backing_name).exists() else None
        if backing is not None:
            backing_info = inspect_wave(backing)
            if abs(backing_info['durationMs'] - info['durationMs']) > 100:
                raise SingingError('SINGING_STEMS_DURATION_MISMATCH')
        started = time.perf_counter()
        self.load()
        import numpy as np
        from scipy.signal import resample_poly
        _, output = self.vc.vc_single(0, str(vocal), pitch, 'rmvpe',
                                      str(self.resources['index']) if self.resources['index'] else '',
                                      0.66 if self.resources['index'] else 0, 0, 1, 0.33)
        if not isinstance(output, tuple) or len(output) != 2 or output[0] not in (32000, 40000, 48000) or output[1] is None:
            raise SingingError('RVC_CONVERSION_FAILED')
        rate, samples = output
        samples = np.asarray(samples)
        if samples.ndim != 1 or not samples.size or not np.isfinite(samples).all() or samples.size > rate * MAX_SECONDS:
            raise SingingError('RVC_OUTPUT_INVALID')
        if abs(samples.size * 1000 / rate - info['durationMs']) > 250:
            raise SingingError('SINGING_OUTPUT_DURATION_MISMATCH')
        converted = samples.astype(np.float64) / 32768 if np.issubdtype(samples.dtype, np.integer) else samples.astype(np.float64)
        divisor = math.gcd(int(rate), 24000)
        converted = resample_poly(converted, 24000 // divisor, rate // divisor)
        if backing is not None:
            with wave.open(str(backing), 'rb') as source:
                music = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2').reshape(-1, source.getnchannels()).mean(axis=1) / 32768
                divisor = math.gcd(source.getframerate(), 24000)
                music = resample_poly(music, 24000 // divisor, source.getframerate() // divisor)
            count = min(converted.size, music.size)
            converted[:count] += music[:count] * backing_gain
        peak = float(np.max(np.abs(converted)))
        if not math.isfinite(peak) or peak < 0.0001:
            raise SingingError('SINGING_OUTPUT_SILENT')
        if peak > 0.95:
            converted *= 0.95 / peak
        pcm = np.rint(converted * 32767).astype('<i2')
        target = root / 'outputs' / (job + '.wav')
        if target.exists():
            raise SingingError('SINGING_OUTPUT_EXISTS')
        # 独占创建，迟到结果由调用方按所属job回收；不覆盖既有文件。
        with open(target, 'xb') as stream:
            with wave.open(stream, 'wb') as output_wave:
                output_wave.setnchannels(1); output_wave.setsampwidth(2); output_wave.setframerate(24000)
                output_wave.writeframes(pcm.tobytes())
        result = inspect_wave(target)
        return {'file': job + '.wav', 'sampleRate': 24000, 'durationMs': result['durationMs'],
                'sha256': sha256(target), 'processingMs': round((time.perf_counter() - started) * 1000),
                'actualRvcInference': True, 'sent': False, 'humanListeningAccepted': False}


def main():
    root = Path(os.environ.get('QQ_SINGING_DATA', str(PROJECT / 'singing-rvc'))).resolve()
    if sys.argv[1:] == ['--inspect']:
        print(json.dumps(readiness(root), ensure_ascii=False))
        return
    protocol = sys.stdout
    sys.stdout = sys.stderr
    singer = None
    while True:
        raw = sys.stdin.buffer.readline(16385)
        if not raw:
            return
        request = None
        try:
            if len(raw) > 16384 or not raw.endswith(b'\n'):
                raise SingingError('SINGING_REQUEST_INVALID')
            request = json.loads(raw)
            if not isinstance(request, dict) or not isinstance(request.get('id'), str) or not re.fullmatch(r'[a-f0-9]{32}', request['id']):
                raise SingingError('SINGING_REQUEST_INVALID')
            if request.get('op') == 'inspect' and set(request) == {'id', 'op'}:
                result = readiness(root)
            elif request.get('op') == 'convert':
                if singer is None:
                    singer = RvcSinger(read_resources(root))
                result = singer.convert(request)
            else:
                raise SingingError('SINGING_REQUEST_INVALID')
            response = {'id': request['id'], 'ok': True, 'result': result}
        except Exception as error:
            code = str(error) if isinstance(error, SingingError) else 'RVC_PROCESSING_UNAVAILABLE'
            response = {'id': request.get('id') if isinstance(request, dict) else None, 'ok': False, 'error': code}
        protocol.write('QQSING/1 ' + json.dumps(response, ensure_ascii=False) + '\n'); protocol.flush()


if __name__ == '__main__':
    main()
