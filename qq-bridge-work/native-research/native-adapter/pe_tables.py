"""固定 x64 PE 输入的有界导入/导出读取；不加载任何 DLL。"""
from pathlib import Path
import struct


class PeTables:
    def __init__(self, path):
        self.data = Path(path).read_bytes()
        if len(self.data) > 300000000 or self.data[:2] != b"MZ":
            raise ValueError("PE 大小或 DOS 标记异常")
        header = self.u32(0x3c)
        if self.read(header, 4) != b"PE\0\0" or self.u16(header + 4) != 0x8664:
            raise ValueError("要求 x64 PE")
        optional = header + 24
        if self.u16(optional) != 0x20b or self.u16(header + 20) < 128:
            raise ValueError("要求 PE32+ 数据目录")
        section_count = self.u16(header + 6)
        if not 1 <= section_count <= 96:
            raise ValueError("PE 节数量异常")
        self.header_size = self.u32(optional + 60)
        self.read(0, self.header_size)
        section_base = optional + self.u16(header + 20)
        self.sections = []
        for i in range(section_count):
            _, _, rva, size, offset = struct.unpack("<8sIIII", self.read(section_base + i * 40, 24))
            if size:
                self.read(offset, size)
            self.sections.append((rva, size, offset))
        self.export_rva, self.export_size = struct.unpack("<II", self.read(optional + 112, 8))
        self.import_rva, self.import_size = struct.unpack("<II", self.read(optional + 120, 8))

    def read(self, offset, size):
        if offset < 0 or size < 0 or offset + size > len(self.data):
            raise ValueError("PE 文件范围越界")
        return self.data[offset:offset + size]

    def u16(self, offset):
        return struct.unpack("<H", self.read(offset, 2))[0]

    def u32(self, offset):
        return struct.unpack("<I", self.read(offset, 4))[0]

    def at(self, rva, size=1):
        if 0 <= rva < self.header_size and rva + size <= self.header_size:
            return rva
        for base, length, offset in self.sections:
            if 0 <= rva - base < length and rva - base + size <= length:
                return offset + rva - base
        raise ValueError("PE RVA 没有对应的文件范围")

    def string(self, rva):
        result = bytearray()
        for i in range(4096):
            value = self.read(self.at(rva + i), 1)[0]
            if value == 0:
                return result.decode("ascii")
            result.append(value)
        raise ValueError("PE 字符串过长")

    def exports(self):
        if self.export_rva == 0:
            return {}
        directory = self.at(self.export_rva, 40)
        count = self.u32(directory + 24)
        function_count = self.u32(directory + 20)
        if count > 20000 or function_count > 20000:
            raise ValueError("PE 导出数量超限")
        functions = self.at(self.u32(directory + 28), function_count * 4)
        names = self.at(self.u32(directory + 32), count * 4)
        ordinals = self.at(self.u32(directory + 36), count * 2)
        result = {}
        for i in range(count):
            ordinal = self.u16(ordinals + i * 2)
            if ordinal >= function_count:
                raise ValueError("PE 导出序号越界")
            name = self.string(self.u32(names + i * 4))
            rva = self.u32(functions + ordinal * 4)
            forwarder = self.string(rva) if self.export_rva <= rva < self.export_rva + self.export_size else None
            result[name] = {"rva": rva, "forwarder": forwarder}
        return result

    def imports(self):
        if self.import_rva == 0:
            return {}
        if self.import_size > 1048576:
            raise ValueError("PE 导入目录超限")
        base = self.at(self.import_rva, self.import_size)
        result = {}
        terminated = False
        for i in range(self.import_size // 20):
            original, timestamp, chain, name, first = struct.unpack("<IIIII", self.read(base + i * 20, 20))
            if not any((original, timestamp, chain, name, first)):
                terminated = True
                break
            symbols = []
            thunk = original or first
            for j in range(20000):
                value = struct.unpack("<Q", self.read(self.at(thunk + j * 8, 8), 8))[0]
                if value == 0:
                    break
                symbols.append("#ordinal:" + str(value & 0xffff) if value >> 63 else self.string(value + 2))
            else:
                raise ValueError("PE 导入符号数量超限")
            result[self.string(name)] = symbols
        if not terminated:
            raise ValueError("PE 导入目录未终止")
        return result
