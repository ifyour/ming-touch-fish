# Cloudflare 个人资讯聚合站点 — 实施计划

## 1. 摘要

基于现有 monorepo 骨架（TanStack Start + Hono + Cloudflare D1/Queues/Workers AI），完成剩余的绑定、构建、运行时上下文修复，使项目能够在本地开发并部署到 Cloudflare Pages + Workers。计划按“先恢复构建，再补绑定，再验证数据流，最后部署收尾”的顺序推进。

## 2. 当前状态分析

### 2.1 已完成

- 项目结构：`apps/web`（前端+API）、`apps/fetcher`（抓取 Worker）、`packages/db`（Drizzle schema）、`packages/shared`（共享类型）。
- 前端页面：首页 `index.tsx`、管理页 `admin.tsx`、API 通配路由 `api/$.ts`。
- Hono API：`sources.ts`（CRUD + 手动触发抓取）、`articles.ts`（列表与按源分组）。
- Fetcher Worker：`scheduled`（Cron 入队）、`queue`（消费抓取）、RSS 解析、去重、翻译、入库。
- 数据库 schema 与迁移文件已生成。

### 2.2 阻塞性问题

1. **构建/类型检查失败**：`routeTree.gen.ts` 未生成，`pnpm-workspace.yaml` 未锁定 `@tanstack/router-generator`，导致 `vinxi build` 报错 `SyntaxError: ... does not provide an export named 'CONSTANTS'`。
2. **Web 运行时拿不到 Cloudflare 绑定**：`apps/web/wrangler.toml` 缺少 D1/Queue/AI 绑定声明；`apps/web/app/routes/api/$.ts` 只把 `request` 传给 Hono，未传递 `env`/`executionCtx`。
3. **`queryClient` 未注入路由上下文**：`apps/web/app/router.tsx` 把 `queryClient` 写死为 `undefined!`，`client.tsx` 与 `ssr.tsx` 创建 router 时未覆盖。
4. **Fetcher Queue Producer 绑定缺失**：`apps/fetcher/wrangler.toml` 只有 consumer 绑定，但 `scheduled` handler 需要发送消息。

### 2.3 高优先级风险

5. 翻译模型语言代码可能应为 `'en'`/`'zh'` 而非 `'english'`/`'chinese'`。
6. API 路由未处理 OPTIONS 预检。
7. `apps/web/dist/` 是旧产物，需要清理。

## 3. 拟议变更

### 任务 1：锁定 `@tanstack/router-generator` 版本并重新安装

**文件**：`pnpm-workspace.yaml`

**操作**：在 `overrides` 中新增一行：

```yaml
'@tanstack/router-generator': '1.114.1'
```

**原因**：TanStack Start 1.114.1 依赖同版本 router-generator；pnpm overrides 已固定大部分子包，但漏掉了 generator，导致实际安装版本不兼容，构建时导出符号缺失。

**验证**：执行 `pnpm install` 后，`node_modules/@tanstack/router-generator/package.json` 的 `version` 字段应为 `1.114.1`。

---

### 任务 2：注入 `queryClient` 到路由上下文

**文件**：
- `apps/web/app/router.tsx`
- `apps/web/app/client.tsx`
- `apps/web/app/ssr.tsx`

**操作**：
1. 在 `router.tsx` 中让 `createRouter` 接受完整的 `options` 对象，不再写死 `queryClient: undefined!`。
2. 在 `client.tsx` 中创建 `QueryClient`，并通过 `createRouter({ context: { queryClient } })` 传入。
3. 在 `ssr.tsx` 中同样创建并传入 `queryClient`。

**原因**：`index.tsx` 与 `admin.tsx` 的 loader 使用 `context.queryClient.ensureQueryData(...)`，若上下文未注入会在 SSR/预取时崩溃。

**验证**：`pnpm typecheck` 不再报 `context.queryClient` 不存在。

---

### 任务 3：补全 Web 应用的 Cloudflare 绑定

**文件**：`apps/web/wrangler.toml`

**操作**：添加以下绑定（保持与 fetcher 的命名一致）：

```toml
[[d1_databases]]
binding = "DB"
database_name = "news-aggregator"
database_id = "<replace-with-production-database-id>"

[[queues.producers]]
binding = "NEWS_QUEUE"
queue = "news-queue"

[ai]
binding = "AI"
```

**原因**：Hono API 需要读写 D1、向 Queue 发送抓取任务、调用 Workers AI 翻译；没有绑定则 `c.env.DB/NEWS_QUEUE/AI` 为 `undefined`。

**验证**：`wrangler pages dev` 启动时日志显示已绑定 DB、NEWS_QUEUE、AI。

---

### 任务 4：让 API 通配路由正确传递 Cloudflare `env`

**文件**：`apps/web/app/routes/api/$.ts`

**操作**：将 handler 从只接收 `{ request }` 改为接收 `{ request, env }`（TanStack Start API route 的 event 对象），并以 `honoApp.fetch(request, env)` 调用。若 TanStack Start 的 API route 签名不同，则使用其提供的 `event`/`context` 对象中可取到的 Cloudflare 环境对象。

**原因**：Hono 的 `c.env` 必须拿到 Cloudflare 绑定才能访问 D1/Queue/AI。

**验证**：本地调用 `POST /api/sources` 后数据能写入 D1；调用 `POST /api/sources/:id/fetch` 能向 Queue 发送消息。

---

### 任务 5：修复 Fetcher 的 Queue Producer 绑定

**文件**：`apps/fetcher/wrangler.toml`

**操作**：在 consumer 绑定旁添加：

```toml
[[queues.producers]]
binding = "NEWS_QUEUE"
queue = "news-queue"
```

**原因**：`scheduled` handler 调用 `env.NEWS_QUEUE.send()`，Worker 作为 Queue 生产者时必须声明 producer 绑定。

**验证**：`wrangler dev` 启动 fetcher 后，手动触发 Cron 不再报 `NEWS_QUEUE` 未定义。

---

### 任务 6：生成路由树并清理旧构建产物

**文件**：`apps/web/app/routeTree.gen.ts`、目录 `apps/web/dist/`

**操作**：
1. 删除 `apps/web/dist/`。
2. 运行 `pnpm dev:web`（或 `pnpm --filter @repo/web exec vinxi generate`）生成 `routeTree.gen.ts`。

**原因**：TanStack Start 的文件路由依赖生成的路由树；旧 `dist/` 是上一版 Vite SPA 产物，会干扰部署。

**验证**：`apps/web/app/routeTree.gen.ts` 存在且 `pnpm typecheck` 通过。

---

### 任务 7：应用数据库迁移

**命令**：

```bash
wrangler d1 migrations apply news-aggregator --local
wrangler d1 migrations apply news-aggregator --remote   # 部署前执行
```

**原因**：schema 与迁移文件已就绪，但尚未应用到本地/远程 D1 实例。

**验证**：本地 SQLite 文件包含 `sources` 与 `articles` 表及索引。

---

### 任务 8：验证翻译模型参数

**文件**：`apps/fetcher/src/translator.ts`

**操作**：先保留当前 `'english'`/`'chinese'`；若实测报错，改为 `'en'`/`'zh'`。

**原因**：Cloudflare Workers AI 的 `@cf/meta/m2m100-1.2b` 文档通常使用 ISO 语言代码，但当前字符串形式也可能被接受，需以实际响应为准。

**验证**：抓取英文源时，返回结果包含 `translated_title` 而非报错。

---

### 任务 9：为 API 通配路由增加 OPTIONS 处理

**文件**：`apps/web/app/routes/api/$.ts`

**操作**：在 `createAPIFileRoute` 中增加 `OPTIONS` handler，直接返回 `new Response(null, { status: 204 })` 或调用 Hono 的 CORS 处理。

**原因**：跨域 POST/PATCH 预检请求需要 OPTIONS 响应，否则浏览器会拦截。

---

### 任务 10：根 package.json 脚本过滤参数修正

**文件**：`/Users/wangmingming/Documents/Projects/ming-touch-fish/package.json`

**操作**：确认所有 `turbo run ... --filter=web` 已改为 `--filter=@repo/web`（根据工作区包名）。

**原因**：工作区包名为 `@repo/web`，Turbo 的 `--filter` 需要与 `package.json` 的 `name` 字段匹配。

**验证**：`pnpm dev:web` 能正确启动 `@repo/web`。

## 4. 假设与决策

- **部署目标**：`apps/web` 部署到 Cloudflare Pages（Functions），`apps/fetcher` 部署到 Cloudflare Workers。
- **身份认证**：管理页 `/admin` 使用 Cloudflare Access 保护（用户已选择），不在应用层实现登录。
- **默认资讯源**：首次部署为空数据库，由用户手动添加（用户已选择）。
- **翻译服务**：使用 Cloudflare Workers AI 的 `@cf/meta/m2m100-1.2b` 模型，免费且无需外部 API Key。
- **抓取触发**：生产环境通过 Cron Trigger 每日触发；管理页提供“手动抓取”按钮，通过 Queue 发送单源任务。
- **去重策略**：基于 URL 唯一索引 + 抓取前 `articleExists` 查询。
- **缓存策略**：首页数据使用 TanStack Query 客户端缓存；服务端文章列表可附加短时长 `Cache-Control`（后续按需优化）。

## 5. 验证步骤

1. **构建/类型检查**：
   ```bash
   pnpm install
   pnpm typecheck
   pnpm --filter @repo/web build
   ```
   预期：无错误，成功生成 `routeTree.gen.ts` 与构建产物。

2. **本地开发联调**：
   ```bash
   pnpm dev:web      # 终端 1
   pnpm dev:fetcher  # 终端 2
   ```
   预期：
   - 访问 `http://localhost:3000` 可看到首页。
   - 访问 `http://localhost:3000/admin` 可打开管理页（未配置 Access 时不验证）。
   - 在管理页添加 RSS 源后，点击“抓取”成功向 Queue 发送消息。
   - Fetcher 消费消息后抓取文章并写入 D1。
   - 首页按源分组显示文章，英文标题显示翻译。

3. **数据库验证**：
   ```bash
   wrangler d1 execute news-aggregator --local --command "SELECT * FROM sources; SELECT * FROM articles;"
   ```
   预期：新增源和文章出现在对应表中。

4. **部署验证**：
   ```bash
   pnpm deploy:web
   pnpm deploy:fetcher
   ```
   预期：Pages 和 Workers 部署成功，线上 `/api/health` 返回健康状态，管理页与首页正常工作。

## 6. 回滚与风险

- **破坏性操作**：D1 迁移仅新增表，不影响现有数据；若需重跑，可本地删除 `.wrangler/state/d1/` 重新 apply。
- **版本锁定风险**：锁定 TanStack 1.114.1 后若未来升级需同步更新 overrides；当前以保持稳定为优先。
- **翻译模型风险**：如 Workers AI 模型不可用或语言代码错误，英文标题会回退到原文，不影响整体流程。
