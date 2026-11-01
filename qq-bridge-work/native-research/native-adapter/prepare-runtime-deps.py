"""在自有目录准备固定 WebSocket 依赖，不运行 npm 生命周期脚本或安装可选原生模块。"""
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request

root = Path(__file__).resolve().parent
lock = json.loads((root / 'runtime-dependencies.lock.json').read_text(encoding='utf-8'))['ws']
destination = root / 'dependencies' / 'ws'
manifest_path = root / 'dependencies' / 'ws-manifest.json'
if root not in destination.resolve().parents or root not in manifest_path.resolve().parents:
    raise RuntimeError('DEPENDENCY_ROOT_OUTSIDE_WORKSPACE')

if destination.exists():
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest['version'] != lock['version']:
        raise RuntimeError('DEPENDENCY_VERSION_CHANGED')
    for name, digest in manifest['files'].items():
        path = (destination / name).resolve()
        if destination.resolve() not in path.parents or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise RuntimeError('DEPENDENCY_FILE_CHANGED')
    print(json.dumps({'verifiedExisting': True, 'version': lock['version'], 'files': len(manifest['files'])}))
else:
    with urllib.request.urlopen(lock['tarball'], timeout=30) as response:
        blob = response.read(lock['maxCompressedBytes'] + 1)
    actual = 'sha512-' + base64.b64encode(hashlib.sha512(blob).digest()).decode('ascii')
    if len(blob) > lock['maxCompressedBytes'] or actual != lock['integrity']:
        raise RuntimeError('DEPENDENCY_ARCHIVE_MISMATCH')
    content = {}
    unpacked = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as archive:
        for entry in archive.getmembers():
            path = PurePosixPath(entry.name)
            if entry.isdir():
                continue
            if not entry.isfile() or path.is_absolute() or '..' in path.parts or path.parts[0] != 'package':
                raise RuntimeError('DEPENDENCY_ENTRY_REFUSED')
            name = '/'.join(path.parts[1:])
            if not name or '\\' in name or ':' in name or name in content or len(content) >= 64:
                raise RuntimeError('DEPENDENCY_PATH_REFUSED')
            unpacked += entry.size
            if unpacked > lock['maxUnpackedBytes']:
                raise RuntimeError('DEPENDENCY_SIZE_REFUSED')
            content[name] = archive.extractfile(entry).read()
    package = json.loads(content['package.json'])
    if package['name'] != 'ws' or package['version'] != lock['version'] or package['license'] != 'MIT' or 'LICENSE' not in content:
        raise RuntimeError('DEPENDENCY_METADATA_MISMATCH')
    destination.mkdir(parents=True, exist_ok=False)
    for name, data in content.items():
        output = destination / name
        if destination.resolve() not in output.resolve().parents:
            raise RuntimeError('DEPENDENCY_OUTPUT_OUTSIDE_ROOT')
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('xb') as stream:
            stream.write(data)
    manifest = {'name': 'ws', 'version': lock['version'], 'license': 'MIT', 'source': lock['tarball'],
                'integrity': actual, 'archiveBytes': len(blob), 'unpackedBytes': unpacked,
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(content.items())}}
    with manifest_path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(manifest, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'installed': True, 'version': lock['version'], 'files': len(content), 'archiveBytes': len(blob), 'unpackedBytes': unpacked, 'lifecycleScriptsExecuted': False}))
