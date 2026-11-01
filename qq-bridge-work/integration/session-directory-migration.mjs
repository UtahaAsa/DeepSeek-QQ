import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const legacyWork = 'D:\\DeepSeek-QQ-Lab\\qq-bridge-work';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const refused = () => { throw new Error('SESSION_DIRECTORY_MIGRATION_REFUSED'); };

/**
 * 仅映射迁移前应用自有的会话工作目录；不重定向用户自选路径。
 * @param {string} cwd 当前会话工作目录。
 * @param {string} work 当前应用代码根目录。
 * @returns {string|null} 可验证的 C 盘对应目录，非受管旧目录返回 null。
 */
export function migratedSessionDirectory(cwd, work) {
  if (typeof cwd !== 'string') return null;
  const relative = path.win32.relative(legacyWork, cwd).toLowerCase();
  if (!['integration\\data\\sessions', 'integration\\data\\bridge\\state\\agents'].includes(relative)) return null;
  return path.resolve(work, ...relative.split('\\'));
}

/**
 * 使用已安装 DSH 的持久化服务，不启动模型、不加载登录信息。
 * @param {string} deployment 固定 DSH 部署目录。
 * @param {string} storage 会话日志根目录。
 * @returns {Promise<object>} 服务和必须调用的 close；调用方负责独占写入窗口。
 */
export async function openSessionPersistence(deployment, storage) {
  const require = createRequire(path.join(deployment, 'engine', 'package.json'));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const plugin = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href);
  const ctx = new Context();
  try {
    await ctx.plugin(plugin, { root: storage, compression: 'zstd' }).await();
    return { service: ctx.sessionPersistence, close: () => ctx.fiber.dispose() };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}

/**
 * 在 DSH 启动前追加官方工作目录事件，保留原日志字节、会话身份和模型选择。
 * @param {object} options 应用根目录、日志根目录和注册表等本机路径。
 * @param {Function} options.assertOffline 每次写入前确认所属 DSH 尚未运行；失败必须抛错。
 * @returns {Promise<object>} 不含会话正文、账号或旧绝对路径的迁移摘要。
 * 只允许单个监督器启动阶段调用；官方持久化写租约进一步拒绝并发写者。
 */
export async function migrateSessionDirectories({ work, deployment, storage, registryFile, backupRoot, assertOffline }) {
  if (typeof assertOffline !== 'function') refused();
  await assertOffline();
  if (!fs.existsSync(registryFile) || !fs.existsSync(storage)) return { checked: 0, migrated: 0 };
  const registryBytes = fs.readFileSync(registryFile);
  const ids = [...new Set(Object.values(JSON.parse(registryBytes).sessions ?? {}))];
  if (ids.length > 1000 || ids.some(id => !/^session-[a-f0-9-]{36}$/.test(id))) refused();
  const canonicalWork = fs.realpathSync(work), canonicalStorage = fs.realpathSync(storage);
  const workspace = path.join(canonicalWork, 'integration/data/sessions');
  const workspaceRestored = !fs.existsSync(workspace);
  const parent = fs.realpathSync(path.dirname(workspace));
  if (!parent.toLowerCase().startsWith((canonicalWork + path.sep).toLowerCase())) refused();
  if (workspaceRestored) { await assertOffline(); fs.mkdirSync(workspace); }
  const backend = await openSessionPersistence(deployment, canonicalStorage);
  const report = { checked: 0, migrated: 0, workspaceRestored, historyPrefixesPreserved: true, registryUnchanged: true, rows: [] };
  try {
    for (const id of ids) {
      let handle = await backend.service.open(id, 'read');
      let header, events;
      try { header = handle.header; events = (await handle.read()).events; }
      finally { await handle.close(); }
      if (events.length > 100000) refused();
      report.checked++;
      const cwd = events.findLast(event => event.type === 'working-directory/change')?.data?.cwd ?? header.cwd;
      const target = migratedSessionDirectory(cwd, canonicalWork);
      if (!target || fs.existsSync(cwd)) continue;
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) refused();
      const canonicalTarget = fs.realpathSync(target);
      if (!canonicalTarget.toLowerCase().startsWith((canonicalWork + path.sep).toLowerCase())) refused();
      await assertOffline();
      // open(write) 获取官方跨进程独占租约；不修改不可变 header 或压缩历史。
      handle = await backend.service.open(id, 'write');
      try {
        const current = (await handle.read()).events;
        if (JSON.stringify(current) !== JSON.stringify(events)) refused();
        const file = fs.realpathSync(backend.service.locate(header).path);
        if (!file.toLowerCase().startsWith((canonicalStorage + path.sep).toLowerCase())) refused();
        const before = fs.readFileSync(file);
        const backupDirectory = path.join(backupRoot, sha(Buffer.from(id)).slice(0, 24));
        fs.mkdirSync(backupDirectory, { recursive: true });
        const backup = path.join(backupDirectory, 'session.before.zstd');
        fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
        if (sha(fs.readFileSync(backup)) !== sha(before)) refused();
        await assertOffline();
        await handle.append([{ seq: current.length, time: Date.now(), type: 'working-directory/change', data: { cwd: canonicalTarget } }]);
        const after = fs.readFileSync(file), verified = (await handle.read()).events;
        if (!after.subarray(0, before.length).equals(before) || verified.length !== current.length + 1 ||
            JSON.stringify(verified.slice(0, current.length)) !== JSON.stringify(current) ||
            verified.at(-1).data.cwd !== canonicalTarget) refused();
        report.migrated++;
        const row = { sessionHash: sha(Buffer.from(id)), historySha256: sha(before), historyBytes: before.length,
          historyEvents: current.length, appendedEvents: 1, targetRelative: path.relative(canonicalWork, canonicalTarget),
          originalHeaderPreserved: true, historicalBytesPreserved: true };
        fs.writeFileSync(path.join(backupDirectory, 'verification.json'), JSON.stringify(row, null, 2) + '\n', { flag: 'wx' });
        report.rows.push(row);
      } finally { await handle.close(); }
    }
    if (!fs.readFileSync(registryFile).equals(registryBytes)) refused();
    return report;
  } finally { await backend.close(); }
}
