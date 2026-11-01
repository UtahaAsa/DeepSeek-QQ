"""仅构建自有受限命名管道模块，不读取/加载QQ，不改已有适配模块。"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from pe_tables import PeTables

root = Path(__file__).resolve().parent
build = root / 'build'
lock = json.loads((root / 'toolchain.lock.json').read_text(encoding='utf-8'))
baseline = json.loads((build / 'build-manifest.json').read_text(encoding='utf-8'))
zig = root / 'toolchain' / lock['zig']['directory'] / 'zig.exe'
headers = root / 'toolchain' / lock['headers']['directory'] / 'include/node'
node = Path(lock['node']['path'])
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
if digest(node) != lock['node']['sha256'] or digest(zig) != baseline['compilerSha256']:
    raise ValueError('TOOLCHAIN_BASELINE_CHANGED')
env = dict(os.environ)
for name, leaf in [('TEMP', 'temp'), ('TMP', 'temp'), ('ZIG_GLOBAL_CACHE_DIR', 'cache/global'), ('ZIG_LOCAL_CACHE_DIR', 'cache/local')]:
    target = root / leaf
    target.mkdir(parents=True, exist_ok=True)
    env[name] = str(target)
exports = ['napi_throw_error', 'napi_get_boolean', 'napi_get_cb_info', 'napi_get_value_string_utf8',
    'napi_get_value_external', 'napi_create_external', 'napi_add_env_cleanup_hook', 'napi_remove_env_cleanup_hook',
    'napi_create_object', 'napi_set_named_property', 'napi_get_value_uint32', 'napi_create_string_utf8', 'napi_define_properties']
if not set(exports).issubset(PeTables(node).exports()):
    raise ValueError('NODE_API_EXPORTS_MISSING')
definition = build / 'secure-pipe-api.def'
definition.write_text('LIBRARY "node.exe"\nEXPORTS\n' + '\n'.join(exports) + '\n', encoding='ascii')
library = build / 'secure-pipe-api.lib'
subprocess.run([str(zig), 'dlltool', '-m', 'i386:x86-64', '-d', str(definition), '-l', str(library)], cwd=build, env=env, check=True, timeout=60)
output = build / 'secure-pipe.node'
subprocess.run([str(zig), 'c++', '-target', 'x86_64-windows-gnu', '-std=c++17', '-O2', '-fno-exceptions', '-fno-rtti',
    '-nostdlib++', '-shared', '-DNAPI_VERSION=10', '-I', str(headers), str(root / 'secure-pipe.cpp'), str(library),
    '-ladvapi32', '-o', str(output)], cwd=build, env=env, check=True, timeout=180)
imports = PeTables(output).imports()
if any(name.lower() == 'qqnt.dll' for name in imports):
    raise ValueError('UNEXPECTED_QQ_DEPENDENCY')
manifest = {'schemaVersion': 1, 'nodeSha256': digest(node), 'nodeVersion': '24.15.0', 'arch': 'x64',
    'sourceSha256': digest(root / 'secure-pipe.cpp'), 'binarySha256': digest(output),
    'qqLoaded': False, 'qqImports': False, 'productionReady': False}
(build / 'secure-pipe-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'built': 'secure-pipe.node', 'qqLoaded': False, 'productionReady': False}))
