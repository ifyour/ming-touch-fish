# 代码审查报告：登录功能 + 已读修复（2026-07-20）

> 范围：今天 7 个提交（`d1cfa3e` → `8712ef6`）。
> 涉及：better-auth GitHub OAuth 登录、后台 `/fish` 鉴权、已读接口（`/api/read`）。
> 本文只给结论与建议，未改动任何代码，待 owner 决策后再实施。

## 整体评价

登录链路结构清晰，服务端鉴权 `requireAdmin` 落地到位，已读接口做了防重复请求、
`credentials: include`、参数化 SQL。整体合理，但有几处安全与设计硬伤，建议优先处理。

---

## 高严重度（安全）

### 1. `trustedOrigins` 动态返回请求来源，等于关闭 better-auth 的 CSRF 防护

`apps/web/app/server/auth.ts:65-68`

```ts
trustedOrigins: (ctx) => {
  const origin = ctx?.headers?.get('origin');
  return origin ? [origin] : [];
},
```

better-auth 在 POST 等变更请求上用 `trustedOrigins` 校验 `Origin` 头以防御 CSRF。
这里把**请求自带的 origin 原样加进信任列表**，等于任何来源都被信任 → CSRF 保护形同虚设。

**建议**：改成固定域名白名单，例如
`trustedOrigins: ['https://news.mingming.dev', 'http://localhost:3000']`（或读 env）。

### 2. CORS 对 `*.pages.dev` 过于宽松 + 凭据同源，存在跨站凭据暴露

`apps/web/app/server/app.ts:18-27`

```ts
if (origin.startsWith('http://localhost') || origin.includes('pages.dev')) return origin;
```

`pages.dev` 是 Cloudflare Pages 的公开后缀，**任何人都能注册 `attacker.pages.dev`**。
配合前端 `credentials: 'include'` 与服务端动态 `trustedOrigins`，攻击者可构造页面以受害者
（管理员）身份发起凭据化 POST，直接触发 `/api/sources` 的删除/抓取等变更（CSRF 链路成立）。

**建议**：CORS 用显式白名单替代子串匹配，仅放行自己的生产域名与本地。

### 3. `/api/admin-migrate` 无任何鉴权，可匿名触发建表/改表

`apps/web/app/server/app.ts:43-51`

该端点直接调用 `runAuthMigrations`，对数据库做结构变更，**任何人都能 POST 调用**。
迁移虽通常幂等，但这是无门槛的 DB schema 操作端点。

**建议**：至少加管理员鉴权（复用 `requireAdmin`），或仅允许特定部署密钥/本地调用。

---

## 中严重度（设计/正确性）

### 4. `read_articles` 会写入重复行，`INSERT OR IGNORE` 实际没生效

`apps/web/app/server/auth.ts:8-20` 插件 schema 只定义字段，better-auth 自动加 `id`(UUID) 主键，
**没有 `(userId, articleId)` 复合唯一约束**。而 `read.ts:32/51` 用 `INSERT OR IGNORE` + 随机 `id`：

```ts
.bind(crypto.randomUUID(), user.id, parsed.data.articleId, Date.now())
```

主键永远是新的 → `OR IGNORE` 永远不会命中冲突 → **同一篇文章会被重复插入**。
显示不受影响（GET 只 map 出 id），但表会无限膨胀、写放大。

**建议**：在插件 schema 给 `(userId, articleId)` 加 unique 约束（或 better-auth 支持的 `unique`
字段标记），让 `OR IGNORE` 真正去重；或改成 `ON CONFLICT(userId,articleId) DO NOTHING`。

> 旁证：插件里写了 `references: { model: 'user', field: 'id' }` 但没 unique，作者显然期望去重，
> 但实现上没达成。

### 5. 管理员模型是「单用户名字符串比对」，且默认值散落 3 处

`apps/web/app/server/session.ts:27-34`、`apps/web/app/routes/fish.tsx:672`、`apps/web/test/setup.ts`
都写死了 `?? 'ifyour'`。

- 默认管理员登录名在多处重复，改一处忘改另一处就会客户端/服务端不一致；`fish.tsx` 甚至没复用 `getAdminLogin()`。
- 只能是**单一** GitHub 账号，无法支持多管理员、无法撤销/轮换。

**建议**：默认值集中到一处（如 `getAdminLogin()` 并让前端调用）；若需要多管理员，改成正则/逗号分隔
列表或独立的 admins 表。当前个人项目可不动，但建议消除重复默认值。

### 6. 生产 baseURL 硬编码

`apps/web/app/server/auth.ts:26-28` `https://news.mingming.dev`。换域名/预览环境就坏。

**建议**：优先从请求推导（`new URL(request.url).origin`）或统一用 `BETTER_AUTH_URL` env。

---

## 低严重度（健壮/可维护）

- **7. `loadDevVars()` 在每次请求的 `getAuth` 热路径里做 `process.env` 全局写入**（`auth.ts:32`）。
  虽有 `loaded` 守卫只跑一次，但把「加载配置」副作用塞进 per-request 不合适。建议提到进程启动/
  worker 初始化时调用一次。
- **8. `read.ts` 列名依赖 better-auth 生成规则**：插件字段 `userId` 到底落库成 `userId` 还是
  `user_id`，以及 `read_articles` 表名，需实际跑一次迁移核对（`read.ts` 用原生 SQL 直查）。
  **当前没有 `read.ts` 的测试**（只有 `session.test.ts` 和 `sources.e2e.test.ts`），建议补一个已读接口
  的 e2e 覆盖，顺带验证列名。
- **9. 无速率限制**：`/api/auth/*` 与 `/api/read` 都没有 throttle，登录/OAuth 可被暴力或刷接口。
  个人项目可暂缓。
- **10. 登录态切换时 localStorage 与远程已读不合并**（`useReadArticles.tsx`）：登出回退 localStorage、
  登录用远程，二者不会合并。属 UX 取舍，非缺陷。

---

## 做得好的地方

- 服务端 `requireAdmin` 是真正的鉴权依据，前端 `fish.tsx` 的权限判断只是 UI 门面，即使被绕过服务端仍
  401（纵深防御正确）。
- 已读接口做了 `credentials: include`、Zod 校验、`articleIds` 上限 1000、防重复请求 Provider，考虑周到。
- 首页非 JSON 响应容错、`loadDevVars` 仅补缺不覆盖生产 env，都是稳妥处理。

---

## 优先级建议（如要动）

1. **先做 #1 + #2**（CORS + trustedOrigins 白名单）——一行改动、消除 CSRF 暴露面，收益最大。
2. **#3** 给 migrate 端点加鉴权。
3. **#4** 修重复行（数据会持续变脏，越早修越好）。
4. 其余可排期或保持现状。
