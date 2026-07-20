import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 本地开发（vinxi 在 Node 中跑 API）不会把 .dev.vars 的 [vars] 注入到 process.env，
// 而生产环境由 wrangler secret put 直接填充 process.env。此函数在「缺少值时」兜底读取
// .dev.vars，避免本地 better-auth 拿不到 GitHub OAuth 凭据。生产环境 process.env 已就绪，
// 该加载器不改动任何已有值（仅补缺），不影响生产行为。
let loaded = false;

export function loadDevVars() {
  if (loaded) return;
  loaded = true;
  if (process.env.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_SECRET) return;
  try {
    const file = resolve(process.cwd(), '.dev.vars');
    const text = readFileSync(file, 'utf-8');
    const lines = text.split('\n');
    let inVars = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        inVars = line === '[vars]';
        continue;
      }
      if (!inVars) continue;
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // .dev.vars 不存在时静默跳过，依赖生产环境 process.env
  }
}
