import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 热配置必须使用固定宿主的Schemastery；3.18.1的额外元数据不会创建Volatile值。
let schema;
try {
  const anchor = process.env.QQ_WORKSPACE_DSH_ANCHOR
    ? pathToFileURL(process.env.QQ_WORKSPACE_DSH_ANCHOR).href
    : import.meta.resolve('@deepseek-ai/dsh/package.json');
  const require = createRequire(anchor), host = require(fileURLToPath(anchor));
  if (host.name !== '@deepseek-ai/dsh' || host.version !== '0.2.1-rc.2') throw 0;
  const manifest = require.resolve('@deepseek-ai/schemastery/package.json'), metadata = require(manifest);
  if (metadata.version !== '3.18.5' || metadata.module !== 'lib/index.mjs') throw 0;
  // 与宿主复用同一ESM实例，使Volatile的创建、识别和更新来自同一运行时。
  const library = await import(pathToFileURL(join(dirname(manifest), metadata.module)).href);
  schema = library.default ?? library;
  const value = schema.boolean().default(false).extra('volatile', true)(undefined);
  if (!value || typeof value.get !== 'function' || value.get() !== false) throw 0;
} catch { throw new Error('DSH_SCHEMA_RUNTIME_REQUIRED'); }
export default schema;
