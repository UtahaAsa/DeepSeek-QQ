"""仅在本原型目录下载并校验固定工具链；不安装全局软件或执行归档内容。"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import urllib.request
import zipfile

root = Path(__file__).resolve().parent
lock = json.loads((root / "toolchain.lock.json").read_text(encoding="utf-8"))
downloads = root / "downloads"
toolchain = root / "toolchain"
downloads.mkdir(exist_ok=True)
toolchain.mkdir(exist_ok=True)


def digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def target_path(name, expected):
    parts = PurePosixPath(name).parts
    if not parts or parts[0] != expected or any(p in ("..", ".") or ":" in p or "\\" in p for p in parts):
        raise ValueError("归档路径不在固定工具目录内")
    target = toolchain.joinpath(*parts)
    if not target.resolve().is_relative_to(toolchain.resolve()):
        raise ValueError("归档目标越界")
    return target


for key in ("zig", "headers"):
    item = lock[key]
    archive = downloads / item["archive"]
    if not archive.exists():
        partial = archive.with_suffix(archive.suffix + ".partial")
        if partial.exists():
            if digest(partial) != item["sha256"]:
                raise RuntimeError(f"发现未完成下载，需检查后再继续：{partial.name}")
        else:
            print(f"download {item['url']}", flush=True)
            with urllib.request.urlopen(item["url"], timeout=60) as response, partial.open("xb") as out:
                count = 0
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > item["maxBytes"]:
                        raise ValueError("下载大小超限")
                    out.write(chunk)
        if digest(partial) != item["sha256"]:
            raise ValueError("下载 SHA256 不匹配；未解压或执行")
        partial.rename(archive)
    if digest(archive) != item["sha256"]:
        raise ValueError("已有归档 SHA256 不匹配")
    marker = toolchain / (item["directory"] + ".verified.json")
    if marker.exists():
        if json.loads(marker.read_text())["sha256"] != item["sha256"]:
            raise ValueError("工具链标记与固定版本不一致")
        print(f"verified existing {key}", flush=True)
        continue
    print(f"extract verified {key}", flush=True)
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as bundle:
            entries = bundle.infolist()
            if sum(e.file_size for e in entries) > 1500000000:
                raise ValueError("解压体积超限")
            for entry in entries:
                path = target_path(entry.filename, item["directory"])
                if ((entry.external_attr >> 16) & 0o170000) == 0o120000:
                    raise ValueError("不允许归档符号链接")
                if entry.is_dir():
                    path.mkdir(parents=True, exist_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(entry) as source, path.open("xb") as out:
                        shutil.copyfileobj(source, out)
    else:
        with tarfile.open(archive, "r:gz") as bundle:
            entries = bundle.getmembers()
            if sum(e.size for e in entries) > 200000000:
                raise ValueError("头文件解压体积超限")
            for entry in entries:
                path = target_path(entry.name, item["directory"])
                if entry.isdir():
                    path.mkdir(parents=True, exist_ok=True)
                elif entry.isfile():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.extractfile(entry) as source, path.open("xb") as out:
                        shutil.copyfileobj(source, out)
                else:
                    raise ValueError("不允许非普通文件归档项")
    marker.write_text(json.dumps({"sha256": item["sha256"], "url": item["url"]}, indent=2) + "\n", encoding="utf-8")
    print(f"ready {key}", flush=True)
