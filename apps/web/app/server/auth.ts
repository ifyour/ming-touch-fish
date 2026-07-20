import type { D1Database } from '@cloudflare/workers-types';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { loadDevVars } from './loadDevVars';

// 已读文章表以 better-auth 插件方式定义，使其随 better-auth 迁移一并建表（复用同一套迁移机制）。
// 该表与 better-auth 自身的 user/session 表同库（D1），读取在 routes/read.ts 中直接用 D1 原生查询。
const readArticlesPlugin = {
  id: 'read-articles',
  schema: {
    readArticle: {
      fields: {
        userId: { type: 'string', required: true, references: { model: 'user', field: 'id' } },
        articleId: { type: 'number', required: true },
        readAt: { type: 'date', required: true },
      },
      modelName: 'read_articles',
    },
  },
} as const;

function resolveBaseURL(): string {
  const envBase = process.env.BETTER_AUTH_URL;
  if (envBase) return envBase;
  // 开发环境（vinxi dev）默认本地 3000 端口；生产在 wrangler 中通过 env 注入。
  return process.env.NODE_ENV === 'production'
    ? 'https://news.mingming.dev'
    : 'http://localhost:3000';
}

export function getAuth(db: D1Database) {
  loadDevVars();
  const options: BetterAuthOptions = {
    database: db,
    baseURL: resolveBaseURL(),
    socialProviders: {
      github: {
        // 同时兼容 GITHUB_CLIENT_ID 与本地专用的 GITHUB_CLIENT_LOCAL_ID（见 .dev.vars）。
        clientId: process.env.GITHUB_CLIENT_ID ?? process.env.GITHUB_CLIENT_LOCAL_ID ?? '',
        clientSecret:
          process.env.GITHUB_CLIENT_SECRET ?? process.env.GITHUB_CLIENT_LOCAL_SECRET ?? '',
        // 允许用户在 GitHub 已登录多个账号时选择
        scope: ['read:user', 'user:email'],
        // 把 GitHub 登录名（login）写入 user.name，便于后台按 GitHub 用户名鉴权。
        mapProfileToUser: (profile) => ({
          name: (profile as { login?: string; name?: string }).login ?? profile.name,
          email: profile.email,
          image: (profile as { avatar_url?: string }).avatar_url,
        }),
      },
    },
    // 同一来源（本地/生产）允许回调与 API 同源；OAuth 回调走相对路径，无需额外 origin。
    trustedOrigins: (ctx) => {
      const origin = ctx?.headers?.get('origin');
      return origin ? [origin] : [];
    },
    plugins: [readArticlesPlugin],
  };
  return betterAuth(options);
}

export type Auth = ReturnType<typeof getAuth>;

// 手动触发表结构迁移（仅首次部署或表结构变更后调用一次，见 /api/auth/migrate）。
export async function runAuthMigrations(auth: Auth) {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
