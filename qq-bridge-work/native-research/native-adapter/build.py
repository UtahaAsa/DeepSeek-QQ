"""在本目录构建自有 DLL/Node 夹具；读取固定 QQ 导入表但不加载 QQ。"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
from pe_tables import PeTables

root = Path(__file__).resolve().parent
lock = json.loads((root / "toolchain.lock.json").read_text(encoding="utf-8"))
build = root / "build"
build.mkdir(exist_ok=True)
env = dict(os.environ)
for name, leaf in (("TEMP", "temp"), ("TMP", "temp"), ("ZIG_GLOBAL_CACHE_DIR", "cache/global"), ("ZIG_LOCAL_CACHE_DIR", "cache/local")):
    directory = root / leaf
    directory.mkdir(parents=True, exist_ok=True)
    env[name] = str(directory)
zig = root / "toolchain" / lock["zig"]["directory"] / "zig.exe"
headers = root / "toolchain" / lock["headers"]["directory"] / "include/node"
node_path = Path(lock["node"]["path"])
wrapper_path = Path("C:/Program Files/Tencent/QQNT/versions/9.9.35-52892/resources/app/wrapper.node")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args):
    command = [str(zig), *map(str, args)]
    print("build " + " ".join(map(str, args)), flush=True)
    subprocess.run(command, cwd=build, env=env, check=True, timeout=300)


if sha256(node_path) != lock["node"]["sha256"]:
    raise ValueError("Node 指纹改变，停止构建")
if sha256(wrapper_path) != "e698a0abb086a912f1eede06b8d8c6f86f9c1de90ad0c68b1e1c2ee0108f0cbc":
    raise ValueError("QQ wrapper 指纹改变，停止构建")
version = subprocess.check_output([str(zig), "version"], env=env, text=True).strip()
if version != lock["zig"]["version"]:
    raise ValueError("Zig 版本不匹配")
node_exports = PeTables(node_path).exports()
imports = PeTables(wrapper_path).imports()["QQNT.dll"]
stopping = "?IsEnvironmentStopping@node@@YA_NPEAVIsolate@v8@@@Z"
registration = "qq_magic_napi_register"
if len(imports) != 99 or set(imports) - set(node_exports) != {stopping, registration}:
    raise ValueError("导入基线改变，拒绝生成猜测适配")
lines = ['LIBRARY "QQNT.dll"', 'EXPORTS']
expected = {}
for name in sorted(imports):
    target = "BridgeIsEnvironmentStopping" if name == stopping else "node.exe." + ("napi_module_register" if name == registration else name)
    lines.append(f'    "{name}" = "{target}"')
    expected[name] = None if name == stopping else target
definition = build / "QQNT.def"
definition.write_text("\n".join(lines) + "\n", encoding="ascii")
common = ["c++", "-target", "x86_64-windows-gnu", "-std=c++17", "-O2", "-fno-exceptions", "-fno-rtti", "-nostdlib++", "-shared"]
run(*common, root / "adapter.cpp", definition, "-Wl,--out-implib,QQNT.lib", "-o", build / "QQNT.dll")
control_imports = ["napi_throw_error", "napi_get_cb_info", "napi_get_boolean", "napi_create_object", "napi_create_uint32", "napi_set_named_property", "napi_add_env_cleanup_hook", "napi_define_properties", "napi_get_uv_event_loop", "uv_walk", "uv_has_ref", "uv_is_active", "uv_is_closing", "uv_handle_get_type", "uv_handle_type_name", "uv_loop_alive"]
if not set(control_imports).issubset(node_exports):
    raise ValueError("固定 Node 缺少诊断接口")
node_def = build / "node-api.def"
node_def.write_text('LIBRARY "node.exe"\nEXPORTS\n' + "\n".join(control_imports) + "\n", encoding="ascii")
run("dlltool", "-m", "i386:x86-64", "-d", node_def, "-l", build / "node-api.lib")
run(*common, "-DNAPI_VERSION=10", "-I", headers, root / "control.cpp", build / "QQNT.lib", build / "node-api.lib", "-o", build / "control.node")
actual = PeTables(build / "QQNT.dll").exports()
for name, target in expected.items():
    if name not in actual or actual[name]["forwarder"] != target:
        raise ValueError("生成 DLL 的转发规则不匹配：" + name)
if actual[stopping]["rva"] != actual["BridgeIsEnvironmentStopping"]["rva"]:
    raise ValueError("停止入口没有指向本地实现")
manifest = {
    "prototypeOnly": True,
    "qqLoaded": False,
    "zigVersion": version,
    "compilerSha256": sha256(zig),
    "nodeSha256": lock["node"]["sha256"],
    "coveredWrapperImports": len(expected),
    "forwardedExports": sum(v is not None for v in expected.values()),
    "totalNamedExports": len(actual),
    "stoppingAliasVerified": True,
    "files": {name: sha256(build / name) for name in ["QQNT.dll", "control.node"]},
    "sourceFiles": {name: sha256(root / name) for name in ["adapter.h", "adapter.cpp", "control.cpp", "build.py", "pe_tables.py", "prototype-host.mjs", "prepare-toolchain.py", "toolchain.lock.json"]},
}
(build / "build-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"built": list(manifest["files"]), "coveredWrapperImports": 99, "nativeQQExecuted": False}), flush=True)
