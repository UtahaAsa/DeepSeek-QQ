import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/** QQ工作台固定公开文件白名单；不含profile、角色、声音、账号或凭据。 */
export const WORKBENCH_RUNTIME_FILES = Object.freeze(['package.json', 'lib/index.js', 'lib/client.js',
  'lib/workspace-host.js', 'lib/workspace-policy.js', 'lib/workspace-schema.js', 'lib/schema-runtime.js', 'client/workbench.js', 'client/workbench.css',
  'client/management.js', 'client/hero-v2.webp', 'client/avatar-v2.webp', 'client/hero-v3.webp', 'client/phone-v3.webp', 'client/library-v3.webp',
  'client/connection-v3.webp','client/role-v3.webp','client/workshop-v3.webp','client/observatory-v3.webp',
  'client/companion.png', 'client/hero.png', 'client/navigation.png', 'client/background.png']
  .map(file => 'plugins/qq-mode-console/' + file));

/**
 * 启动前刷新QQ工作台的固定公开插件文件，既有DSH profile、设置、角色和声音不写入。
 * @param {object} options source/runtime为本项目桥接根；backup为本项目代码备份目录。
 * @returns {object} 更新数；重复执行不写同内容文件。异常拒绝启动，旧字节可从备份恢复。
 * @note 只复制白名单普通文件，所有目标祖先拒绝链接；不运行插件、不安装依赖。
 */
export function refreshRuntimeWorkbench({ source, runtime, backup }) {
  const plans = WORKBENCH_RUNTIME_FILES.map(relative => {
    const maxBytes = relative.endsWith('.png') ? 8 * 1024 * 1024 : 512 * 1024;
    const file = join(source, relative), target = join(runtime, relative);
    if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('WORKBENCH_REFRESH_REFUSED');
    const bytes = readFileSync(file);
    if (!bytes.length || bytes.length > maxBytes) throw new Error('WORKBENCH_REFRESH_REFUSED');
    const parts = relative.split('/'); let directory = runtime;
    if (lstatSync(runtime).isSymbolicLink()) throw new Error('WORKBENCH_REFRESH_REFUSED');
    for (const part of parts.slice(0, -1)) {
      directory = join(directory, part);
      if (existsSync(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) throw new Error('WORKBENCH_REFRESH_REFUSED');
    }
    if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink() || lstatSync(target).size > maxBytes)) throw new Error('WORKBENCH_REFRESH_REFUSED');
    const previous = existsSync(target) ? readFileSync(target) : null;
    return { relative, target, bytes, previous };
  });
  const changed = plans.filter(plan => !plan.previous?.equals(plan.bytes));
  if (!changed.length) return { updated: 0, backupManifest: null };
  const backupRoot = join(backup, 'workbench');
  if (existsSync(backupRoot) && lstatSync(backupRoot).isSymbolicLink()) throw new Error('WORKBENCH_BACKUP_REFUSED');
  mkdirSync(backupRoot, { recursive: true });
  const records = [];
  for (const plan of changed) {
    let previousSha256 = null;
    if (plan.previous) {
      previousSha256 = createHash('sha256').update(plan.previous).digest('hex');
      const saved = join(backupRoot, previousSha256);
      if (!existsSync(saved)) writeFileSync(saved, plan.previous, { flag: 'wx' });
      else if (lstatSync(saved).isSymbolicLink() || !readFileSync(saved).equals(plan.previous)) throw new Error('WORKBENCH_BACKUP_REFUSED');
    }
    records.push({ path: plan.relative, created: plan.previous === null, previousSha256,
      nextSha256: createHash('sha256').update(plan.bytes).digest('hex') });
  }
  const backupManifest = join(backupRoot, 'refresh-' + randomUUID() + '.json');
  writeFileSync(backupManifest, JSON.stringify({ schemaVersion: 1, kind: 'public_workbench_code_only', files: records }, null, 2), { flag: 'wx' });
  let updated = 0;
  for (const plan of changed) {
    mkdirSync(join(plan.target, '..'), { recursive: true });
    const temporary = plan.target + '.next';
    if (existsSync(temporary)) throw new Error('WORKBENCH_REFRESH_REFUSED');
    writeFileSync(temporary, plan.bytes, { flag: 'wx' }); renameSync(temporary, plan.target); updated++;
  }
  return { updated, backupManifest };
}

/**
 * 所属监督器持有排他启动锁后、启动 DSH 前刷新固定 MCP 代码副本；不读取或覆盖用户配置。
 * @param {object} options source/runtime 为自有代码目录；backup 为自有公开代码备份目录。
 * @returns {object} 无凭据的更新标志；旧公开代码按内容摘要保留，写入失败拒绝启动。
 * @throws {Error} 固定文件缺失、异常大小或目标为链接时拒绝；单线程同步原子替换。
 */
export function refreshRuntimeMcp({ source, runtime, backup }) {
  const name = 'mcp-qq-native.js', target = join(runtime, 'src', name);
  const bytes = readFileSync(join(source, 'src', name));
  const legacy = join(runtime, 'src', 'mcp-snowluma-safe.js');
  const previousFile = existsSync(target) ? target : legacy;
  if (!bytes.length || bytes.length > 512 * 1024 || !existsSync(previousFile) || lstatSync(previousFile).isSymbolicLink()) throw new Error('RUNTIME_MCP_REFRESH_REFUSED');
  const previous = readFileSync(previousFile);
  if (previous.equals(bytes) && existsSync(target)) return { updated: false };
  if (previous.length > 512 * 1024) throw new Error('RUNTIME_MCP_REFRESH_REFUSED');
  mkdirSync(backup, { recursive: true });
  const digest = createHash('sha256').update(previous).digest('hex');
  const saved = join(backup, digest + '.js');
  if (!existsSync(saved)) writeFileSync(saved, previous, { flag: 'wx' });
  else if (lstatSync(saved).isSymbolicLink() || !readFileSync(saved).equals(previous)) throw new Error('RUNTIME_MCP_REFRESH_REFUSED');
  const next = target + '.next';
  if (existsSync(next)) {
    if (lstatSync(next).isSymbolicLink() || !readFileSync(next).equals(bytes)) throw new Error('RUNTIME_MCP_REFRESH_REFUSED');
  } else writeFileSync(next, bytes, { flag: 'wx' });
  renameSync(next, target);
  return { updated: true };
}

const nativePublicFiles = ["src/dsh/auth-primitives.js","src/dsh/protocol.js","src/dsh/turn-collector.js","src/messaging/onebot-send.js","src/native/feature-delivery.js","src/lifecycle/legacy-gateway-recovery.js","src/native/observation-coordinator.js","src/native/feature-context.js","src/roles/prompt-context.js","src/messaging/output-warnings.js","src/security/token-registry.js","src/logging/tool-audit.js","src/messaging/segments.js","src/messaging/group-members.js","src/messaging/reply-context.js","src/config/mode-inputs.js","src/lifecycle/mode-coordinator.js","src/lifecycle/gateway-health.js","src/storage/json-files.js","src/sessions/mapping-store.js","src/lifecycle/instance-lock.js","src/logging/capped-logger.js","src/media/image-tools.js","src/media/pipeline.js","src/media/context.js","src/messaging/onebot-http.js","src/libraries/sticker-store.js","src/libraries/sticker-actions.js","src/voice/library.js","src/voice/budget.js","src/voice/delivery.js","src/social/legacy-context.js","src/social/legacy-engine.js","src/libraries/slang-learning.js","src/mcp-tools/status.js","src/mcp-tools/profile.js","src/mcp-tools/messaging.js","src/mcp-tools/images.js","src/mcp-tools/groups.js","src/mcp-tools/conversation.js","src/mcp-tools/memory.js","src/mcp-tools/stickers.js","src/mcp-tools/voice.js","src/mcp-tools/transport.js", "src/wake/configuration.js","src/social/v2-store.js","src/social/v2-messages.js","src/context/read-receipts.js","src/context/wake-context.js","src/wake/triggers.js","src/wake/dispatch.js","src/wake/scheduler.js","src/wake/owned-timers.js", "src/messaging/incoming.js","src/sessions/pending-requests.js","src/sessions/turn-events.js","src/sessions/frame-handler.js","src/sessions/event-stream.js","src/messaging/offline-queue.js", "src/sessions/retirement.js", "src/sessions/creation.js", "src/messaging/prompt-dispatch.js", "src/messaging/prompt-queue.js", "src/console/routes/native-settings.js", "src/console/routes/status-mode.js", "src/console/routes/security-lifecycle.js", "src/console/routes/message-tools.js", "src/console/routes/social-state.js", "src/console/routes/inbox-wake.js", "src/console/routes/text-send.js", "src/console/routes/poke.js", "src/console/routes/sticker-tools.js", "src/console/routes/voice-send.js", "src/console/routes/wait.js", "src/console/routes/history.js", "src/console/routes/index.js", 'src/libraries/slang-agent-policy.js', 'src/libraries/slang-agent-routes.js', 'src/social/conversation-memory.js', 'src/social/memory-routes.js', 'src/console/operator-notice.js', 'src/console/feedback-routes.js', 'src/console/feedback-store.js', 'src/social/legacy-policy.js', 'src/social/legacy-routes.js', 'src/social/settings-routes.js', 'src/sessions/admin-routes.js', 'src/libraries/slang-routes.js', 'src/libraries/sticker-routes.js', 'src/usage/token-routes.js',
  'src/mcp-qq-native-host.js', 'src/bridge.js',
  'src/messaging/outbound-policy.js', 'src/messaging/outbound-audit.js',
  'src/messaging/message-segmentation.js', 'src/messaging/gap-planner.js',
  'src/messaging/burst-timing.js', 'src/messaging/burst-sender.js',
  'src/messaging/send-queue.js', 'src/messaging/reply-sender.js',
  'src/console/request-context.js', 'src/console/access-policy.js',
  'src/prompts/initial-prompt-policy.js', 'src/prompts/initial-prompt-store.js', 'src/prompts/initial-prompt-routes.js',
  'src/sessions/usage-observer.js', 'src/sessions/turn-replay.js',
  'src/models/session-models.js', 'src/models/model-catalog.js', 'src/presets/preset-store.js', 'src/presets/preset-routes.js',
  'src/roles/role-routes.js', 'src/config/settings-routes.js',
  'src/config/inputs.js', 'src/config/load-config.js', 'src/roles/role-policy.js', 'src/roles/role-store.js',
  'src/native-reply-queue.js', 'src/native-background-observation.js',
  'src/legacy-onebot-compat.js', 'src/native-gateway.js', 'src/native-chat.js', 'src/native-feature-access.js',
  'src/native-feature-routes.js', 'src/self-profile-api.js', 'src/group-management-api.js', 'src/qq-avatar.js', 'src/qq-avatar-limits.js', 'src/self-avatar-send.js', 'src/role-trash.js',
  'src/image-provider.js', 'src/image-provider-presets.js', 'src/image-generation.js', 'src/image-generation-api.js', 'src/image-generation-errors.js',
  'src/public-address.js', 'src/public-dns.js', 'src/safe-fetch.js',
  'src/native-sticker-api.js', 'src/native-sticker-tools.js', 'src/sticker-lib.js', 'src/media-normalize.js',
  'src/native-singing-tools.js', 'src/singing-manager.js', 'src/native-record-upload.js',
  'src/phone-manager.js', 'src/phone-model.js', 'src/phone-session-archive.js', 'src/phone-dialog.js', 'src/phone-pcm.js', 'src/native-phone-tools.js',
  'src/local-voice.js', 'src/voice-manager.js', 'src/idle-draft.js',
  'src/image-preferences.js', 'src/native/singing-followup.js',
  // 严格类型生产清单的完整依赖；恢复旧运行副本时也要补回拆出的嵌套模块。
  'src/role-card.js', 'src/md-to-plain.js', 'src/qq-model-view.js', 'src/sensitive.js',
  'src/mcp-qq-native.js', 'src/preset-prompt.js', 'src/slang-learner.js', 'src/native-turn-fence.js',
  'src/snowluma-conn.js', 'src/onebot-client.js', 'src/forward.js', 'src/dsh-client.js', 'src/qzone-api.js',
  'src/voice-core.js', 'src/qq-status-view.js', 'src/native-idle-loop.js', 'src/token-ledger.js', 'src/model-prices.js',
  'src/usage/ledger-protocol.js', 'src/usage/ledger-index.js', 'src/usage/ledger-queries.js', 'src/usage/ledger-timeline.js',
  'src/web-search.js', 'src/mcp-web-search-safe.js', 'src/search/parsers.js', 'src/search/transport.js',
  'src/silk-codec.js', 'src/voice-resources.js', 'src/send-voice-lib.js', 'src/v2-wait.js', 'src/state-acl.mjs', 'public/console.html',
  'plugins/qq-agent-presets/qq-tool-restrict.mjs', 'plugins/qq-agent-presets/package.json',
  'plugins/qq-agent-presets/presets/qq-phone.patch.yml'];
const nativePresetFiles = ['plugins/qq-agent-presets/presets/qq-chat.patch.yml', 'plugins/qq-agent-presets/presets/qq-chat-v2.patch.yml',
  'dsh/agent-presets/qq-chat/agent.cordis.yml', 'dsh/agent-presets/qq-chat-v2/agent.cordis.yml'];
const toolNames = text => text.replaceAll('mcp__snowluma-host__', 'mcp__qq_native_host__')
  .replaceAll('mcp__snowluma__', 'mcp__qq_native__');

function replaceOwned(file, bytes, backup) {
  if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
  const previous = existsSync(file) ? readFileSync(file) : null;
  if (previous?.equals(bytes)) return false;
  if (previous) {
    mkdirSync(backup, { recursive: true });
    const saved = join(backup, createHash('sha256').update(previous).digest('hex') + '.backup');
    if (!existsSync(saved)) writeFileSync(saved, previous, { flag: 'wx' });
    else if (lstatSync(saved).isSymbolicLink() || !readFileSync(saved).equals(previous)) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
  }
  mkdirSync(join(file, '..'), { recursive: true });
  const next = file + '.native-next';
  if (existsSync(next)) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
  writeFileSync(next, bytes, { flag: 'wx' }); renameSync(next, file); return true;
}

/**
 * 刷新固定原生公开代码与工具守卫；预设只迁移工具命名，保留自定义提示正文。
 * @param {object} options source/runtime为受控桥接目录，backup为本项目代码备份目录。
 * @returns {object} 更新数；不安装依赖、不接触角色/声音/账号与凭据。
 * @throws {Error} 路径祖先为链接、文件过大或原子替换冲突时拒绝。
 */
export function refreshRuntimeNativeTools({ source, runtime, backup }) {
  let updated = 0;
  for (const relative of [...nativePublicFiles, ...nativePresetFiles]) {
    const from = join(source, relative), target = join(runtime, relative);
    if (!existsSync(from)) { if (existsSync(target)) throw new Error('NATIVE_PUBLIC_SOURCE_MISSING'); continue; }
    if (lstatSync(from).isSymbolicLink() || !lstatSync(from).isFile() || lstatSync(from).size > 1024 * 1024) throw new Error('NATIVE_PUBLIC_SOURCE_REFUSED');
    let directory = runtime;
    for (const part of relative.split('/').slice(0, -1)) {
      if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
      directory = join(directory, part);
    }
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
    const bytes = nativePresetFiles.includes(relative) && existsSync(target)
      ? Buffer.from(toolNames(readFileSync(target, 'utf8'))) : readFileSync(from);
    if (replaceOwned(target, bytes, join(backup, 'native-tools'))) updated++;
  }
  const retired = [];
  for (const name of ['mcp-snowluma-safe.js', 'mcp-host-server.js']) {
    const old = join(runtime, 'src', name); if (!existsSync(old)) continue;
    if (lstatSync(old).isSymbolicLink() || !lstatSync(old).isFile() || lstatSync(old).size > 512 * 1024) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
    const root = join(backup, 'retired-mcp'); mkdirSync(root, { recursive: true });
    const saved = join(root, createHash('sha256').update(readFileSync(old)).digest('hex') + '-' + name);
    if (!existsSync(saved)) renameSync(old, saved);
    else {
      if (lstatSync(saved).isSymbolicLink() || !readFileSync(saved).equals(readFileSync(old))) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
      renameSync(old, join(root, randomUUID() + '-' + name));
    }
    retired.push(name);
  }
  return { updated, retired };
}

/**
 * 在所属监督器停稳后迁移本项目管理的MCP区块及OneBot配置键，区块外字节保持不变。
 * @param {object} options profileFile为自有profile补丁，runtime为自有运行目录，backup保存旧字节。
 * @returns {object} 迁移标志；不返回配置正文或凭据，不启动服务。
 * @throws {Error} 未标记的旧MCP配置、链接、超大文件或替换冲突时拒绝。
 */
export function migrateNativeToolNamespace({ profileFile, runtime, backup }) {
  let profileChanged = false, configChanged = false;
  if (existsSync(profileFile)) {
    if (lstatSync(profileFile).isSymbolicLink() || lstatSync(profileFile).size > 1024 * 1024) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
    const text = readFileSync(profileFile, 'utf8'), begin = '# === qq-bridge MCP BEGIN ===', end = '# === qq-bridge MCP END ===';
    const start = text.indexOf(begin), stop = text.indexOf(end);
    if (start >= 0 && stop > start && text.indexOf(begin, start + begin.length) < 0 && text.indexOf(end, stop + end.length) < 0) {
      const block = text.slice(start, stop + end.length);
      const next = block.replaceAll('mcp-snowluma-safe.js', 'mcp-qq-native.js').replaceAll('mcp-host-server.js', 'mcp-qq-native-host.js')
        .replace(/(id:\s*)mcp-snowluma-host\b/g, '$1mcp-qq-native-host').replace(/(id:\s*)mcp-snowluma\b/g, '$1mcp-qq-native')
        .replace(/(serverName:\s*)(['"]?)snowluma-host\2/g, '$1$2qq_native_host$2').replace(/(serverName:\s*)(['"]?)snowluma\2/g, '$1$2qq_native$2');
      profileChanged = replaceOwned(profileFile, Buffer.from(text.slice(0, start) + next + text.slice(stop + end.length)), join(backup, 'native-profile'));
    } else if (/serverName:\s*['"]?snowluma/.test(text)) throw new Error('NATIVE_NAMESPACE_MANAGED_BLOCK_REQUIRED');
  }
  const configFile = join(runtime, 'config.json');
  if (existsSync(configFile)) {
    if (lstatSync(configFile).isSymbolicLink() || lstatSync(configFile).size > 1024 * 1024) throw new Error('NATIVE_NAMESPACE_MIGRATION_REFUSED');
    const value = JSON.parse(readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
    if (value.snowluma && typeof value.snowluma === 'object' && !Array.isArray(value.snowluma)) {
      value.onebot = { ...value.snowluma, ...(value.onebot ?? {}) }; delete value.snowluma;
      configChanged = true;
    }
    if (value.nativeFeatureProtocol !== 1) { value.nativeFeatureProtocol = 1; configChanged = true; }
    if (configChanged) configChanged = replaceOwned(configFile, Buffer.from(JSON.stringify(value, null, 2)), join(backup, 'native-config'));
  }
  return { profileChanged, configChanged };
}
