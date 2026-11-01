import { createRequire } from 'node:module';
import { normalizeAvatarCrop } from './profile-avatar-crop.mjs';
import { inspectProfileAvatar } from './profile-avatar-stage.mjs';

// 固定图片解码进程：输入只来自stdin，输出只为PNG；不加载QQ、账号、网络或任意模型脚本。
let input;
try {
  const require = createRequire(process.env.QQ_AVATAR_SHARP_ANCHOR);
  const sharp = require('sharp'); if (sharp.versions.sharp !== '0.35.5') throw 0;
  sharp.cache(false); sharp.concurrency(1);
  const crop = normalizeAvatarCrop(JSON.parse(process.argv[2]));
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length; if (size > 8 * 1024 * 1024) throw 0; chunks.push(chunk);
  }
  input = Buffer.concat(chunks, size); for (const chunk of chunks) chunk.fill(0);
  inspectProfileAvatar(input);
  const image = sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning', animated: false });
  const meta = await image.metadata();
  if ((meta.pages ?? 1) !== 1) throw 0;
  const rotated = meta.orientation >= 5 && meta.orientation <= 8;
  const width = rotated ? meta.height : meta.width, height = rotated ? meta.width : meta.height;
  const side = Math.max(1, Math.floor(Math.min(width, height) / crop.zoom));
  const left = Math.max(0, Math.min(width - side, Math.round(crop.centerX * width - side / 2)));
  const top = Math.max(0, Math.min(height - side, Math.round(crop.centerY * height - side / 2)));
  const output = await image.autoOrient().extract({ left, top, width: side, height: side })
    .resize(512, 512, { fit: 'fill' }).png({ compressionLevel: 9 }).toBuffer();
  if (output.length > 2 * 1024 * 1024) throw 0;
  await new Promise((resolve, reject) => process.stdout.write(output, error => error ? reject(error) : resolve()));
  output.fill(0);
} catch { process.exitCode = 1; }
finally { input?.fill(0); }
