// Generated from role-trash.ts. Edit the TypeScript source and run build:typed.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const fail = (code) => new Error(code);
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/**
 * 创建当前运行目录的角色回收站；原始角色库不在操作范围内。
 * @param {object} options directory为固定角色目录，validateName沿用角色名称校验，readState/writeState读写选用状态。
 * @returns {object} list/remove/restore；删除返回恢复编号，恢复不会覆盖同名卡或自动切换角色。
 * @throws {Error} 路径、链接、摘要、当前角色确认或读写失败时给固定错误码；同步执行，不启动外部程序。
 */
export function createRoleTrash({ directory, validateName, readState, writeState }) {
    const root = path.resolve(directory), trash = path.join(root, '.deleted');
    function directoryGuard(target) {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(target).toLowerCase() !== target.toLowerCase())
            throw fail('ROLE_STORAGE_UNAVAILABLE');
    }
    function prepare(create = false) {
        directoryGuard(root);
        if (create && !fs.existsSync(trash))
            fs.mkdirSync(trash);
        if (fs.existsSync(trash))
            directoryGuard(trash);
    }
    function fileGuard(file, limit) {
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > limit)
            throw fail('ROLE_STORAGE_UNAVAILABLE');
    }
    function roleFile(name) {
        if (typeof name !== 'string' || validateName(name) !== name)
            throw fail('ROLE_INPUT_INVALID');
        const file = path.resolve(root, name + '.md');
        if (path.dirname(file) !== root)
            throw fail('ROLE_INPUT_INVALID');
        return file;
    }
    function record(id) {
        if (!uuid(id))
            throw fail('ROLE_INPUT_INVALID');
        const folder = path.join(trash, id);
        directoryGuard(folder);
        const metadata = path.join(folder, 'metadata.json'), card = path.join(folder, 'card.md');
        fileGuard(metadata, 4096);
        fileGuard(card, 65537);
        const value = JSON.parse(fs.readFileSync(metadata, 'utf8'));
        roleFile(value.name);
        if (value.id !== id || !/^\d{4}-\d\d-\d\dT/.test(value.deletedAt) || !/^[a-f0-9]{64}$/.test(value.sha256)
            || digest(fs.readFileSync(card)) !== value.sha256)
            throw fail('ROLE_STORAGE_UNAVAILABLE');
        return { folder, card, metadata, value };
    }
    function list() {
        try {
            prepare();
            if (!fs.existsSync(trash))
                return [];
            return fs.readdirSync(trash).filter(uuid).slice(0, 1000).flatMap(id => {
                try {
                    const { value } = record(id);
                    return [{ restoreId: id, name: value.name, deletedAt: value.deletedAt }];
                }
                catch {
                    return [];
                }
            }).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
        }
        catch {
            return [];
        }
    }
    function remove(name, clearCurrent) {
        prepare(true);
        const file = roleFile(name);
        fileGuard(file, 65537);
        const before = readState(), clearedCurrent = before.role === name;
        if (clearedCurrent && clearCurrent !== true)
            throw fail('ROLE_IN_USE');
        if (fs.readdirSync(trash).length >= 1000)
            throw fail('ROLE_TRASH_FULL');
        const id = randomUUID(), folder = path.join(trash, id), card = path.join(folder, 'card.md');
        const metadata = path.join(folder, 'metadata.json');
        const value = { id, name, deletedAt: new Date().toISOString(), sha256: digest(fs.readFileSync(file)) };
        fs.mkdirSync(folder);
        try {
            fs.writeFileSync(metadata, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
            fs.renameSync(file, card);
            if (clearedCurrent)
                writeState(null, before.mode);
        }
        catch {
            // 仅恢复此次固定文件；回收站元信息保留，避免二次清理扩大故障。
            if (fs.existsSync(card) && !fs.existsSync(file))
                fs.renameSync(card, file);
            throw fail('ROLE_DELETE_FAILED');
        }
        return { ok: true, deleted: name, clearedCurrent, restoreId: id };
    }
    function restore(id) {
        prepare();
        const entry = record(id), file = roleFile(entry.value.name);
        // 排他创建防止覆盖并发新建的同名角色；原回收内容先保留到恢复文件写完。
        let fd;
        try {
            fd = fs.openSync(file, 'wx', 0o600);
        }
        catch (error) {
            throw fail(error.code === 'EEXIST' ? 'ROLE_ALREADY_EXISTS' : 'ROLE_RESTORE_FAILED');
        }
        try {
            fs.writeFileSync(fd, fs.readFileSync(entry.card));
            fs.fsyncSync(fd);
        }
        catch {
            fs.closeSync(fd);
            fs.unlinkSync(file);
            throw fail('ROLE_RESTORE_FAILED');
        }
        fs.closeSync(fd);
        // 移走卡片即不再列入可恢复项，保留审计元信息；不递归删除目录。
        fs.renameSync(entry.card, path.join(entry.folder, 'restored.md'));
        return { ok: true, role: entry.value.name, restored: true };
    }
    return { list, remove, restore };
}
