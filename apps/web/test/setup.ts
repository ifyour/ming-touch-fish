import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';
import { getAuth, runAuthMigrations } from '../app/server/auth';

declare const __MIGRATION_SQL__: string;

// 后台鉴权测试用的固定会话 token：e2e 中以 Cookie 形式携带，模拟已登录管理员。
export const ADMIN_SESSION_TOKEN = 'e2e-admin-session-token';

// better-auth 的会话 cookie 是 HMAC-SHA256(base64url) 签名值：`<token>.<signature>`。
// 签名用的密钥与 e2e worker 的 BETTER_AUTH_SECRET 保持一致，才能通过 getSession 校验。
async function signSessionToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${token}.${b64}`;
}

async function applyMigrations() {
  const existing = (await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sources'",
  ).first()) as { name?: string } | null;
  if (existing?.name === 'sources') return;

  for (const statement of __MIGRATION_SQL__.split(';')) {
    const sql = statement.trim();
    if (sql) await env.DB.prepare(sql).run();
  }
}

// 建 better-auth 表（user/session/account/verification + 自定义 read_articles），
// 并种入一个管理员会话，供 sources 写接口鉴权测试复用。
async function seedAuth() {
  const auth = getAuth(env.DB);
  await runAuthMigrations(auth);

  const adminLogin = process.env.ADMIN_GITHUB_LOGIN ?? 'ifyour';
  const userId = `e2e-admin-${adminLogin}`;

  // 清理历史残留，保证 seed 幂等（D1 库在多次 e2e 运行间复用）。
  await env.DB.prepare(`DELETE FROM "session" WHERE userId = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM "user" WHERE id = ?`).bind(userId).run();

  const now = Date.now();
  const farFuture = now + 1000 * 60 * 60 * 24 * 365;

  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, NULL, ?, ?)`,
  )
    .bind(userId, adminLogin, `${adminLogin}@example.com`, now, now)
    .run();

  await env.DB.prepare(
    `INSERT INTO "session" (id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
  )
    .bind('e2e-admin-session', userId, ADMIN_SESSION_TOKEN, farFuture, now, now)
    .run();

  const secret = process.env.BETTER_AUTH_SECRET ?? 'e2e-fixed-test-secret-do-not-use-in-prod';
  ADMIN_COOKIE = `better-auth.session_token=${await signSessionToken(ADMIN_SESSION_TOKEN, secret)}`;
}

// 签名后的会话 cookie，供 sources 写接口鉴权测试以管理员身份发请求。
export let ADMIN_COOKIE = '';

beforeAll(async () => {
  await applyMigrations();
  await seedAuth();
});
