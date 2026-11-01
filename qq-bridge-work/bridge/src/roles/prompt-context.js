// Generated from roles/prompt-context.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
/**
 * 读取并缓存当前角色提示，构造不读文件。
 * @param deps 所属角色目录、选择记录、名称检查和已存在的分代渲染器。
 * @returns 原文与两代注入文本；缺失、非法名称、越出词法目录或读取失败返回空串。
 * @note 缓存键沿用角色名及两份文件的mtime/size，注入上限每次调用实时读取。
 */
export function createRolePromptContext(deps) {
    let roleHintCache = { key: '', raw: '' };
    // 原始人格卡（按 mtime 缓存，不截断）。
    function roleRawContent() {
        try {
            const rs = (0, deps.readRoleState)();
            if (!rs.role)
                return '';
            // 读取点也必须校验人格名：写入点（控制台 /role 命令）都过 sanitizeRoleName，
            // 但 state/current-role.json 是**用户可直接编辑**的文件。没有这道校验时，
            // {"role":"../../../../Users/Public/x"} 会让 roles/ 之外的文件被读进来并注入每一条提示词。
            const safeName = (0, deps.sanitizeRoleName)(rs.role);
            if (!safeName || safeName.includes('..'))
                return '';
            const roleFile = deps.path.join(deps.ROLES_DIR, safeName + '.md');
            const resolved = deps.path.resolve(roleFile);
            if (!resolved.startsWith(deps.path.resolve(deps.ROLES_DIR) + deps.path.sep))
                return '';
            if (!deps.fs.existsSync(resolved))
                return '';
            const stateStat = deps.fs.statSync(deps.ROLE_STATE_FILE);
            const roleStat = deps.fs.statSync(roleFile);
            // 缓存 key 必须带上**文件名与文件大小**，不能只看 mtime：
            // ① 有些文件系统 mtime 只有秒级粒度（或时钟回拨），同一 tick 内把角色卡重写成新人格，
            //    两个 mtime 完全相同 → 缓存命中 → 注入的还是旧人格，而且是每条提示词都错；
            //    带上名字后，切换角色（例如 a.md → b.md）永远不会误命中。
            // ② 同名的原地重写若长度变了（大多数编辑都会变），size 变化也能击穿缓存。
            // 代价只是多几次 stat，比"热注入路径上一直发旧人格"划算得多。
            const cacheKey = `${safeName}:${stateStat.mtimeMs}:${stateStat.size}:${roleStat.mtimeMs}:${roleStat.size}`;
            if (roleHintCache.key === cacheKey)
                return roleHintCache.raw;
            const raw = deps.fs.readFileSync(roleFile, 'utf8');
            roleHintCache = { key: cacheKey, raw };
            return raw;
        }
        catch {
            return '';
        }
    }
    function currentRoleHint() {
        return (0, deps.renderRoleInjection)(roleRawContent(), 'v1', deps.roleStore.getInjectLimit());
    }
    function currentRoleHintV2() {
        return (0, deps.renderRoleInjection)(roleRawContent(), 'v2', deps.roleStore.getInjectLimit());
    }
    return { roleRawContent, currentRoleHint, currentRoleHintV2 };
}
