# AGENTS.md

本文件为 AI 编码代理（Claude Code、Cursor、Codex 等）在本仓库工作时的指引。请先完整阅读本文件再动手。

## 项目概览

**摸鱼资讯（TouchFish News）** 是一个基于 Cloudflare 全家桶的个人资讯聚合站点。定时抓取 RSS 源 → 用 DeepL 将英文标题翻译为中文 → 在前端按源分组展示。

- 生产站点：<https://news.mingming.dev/>
- 生产 fetcher worker：<https://news-aggregator-fetcher.ifyour.workers.dev>
- 部署目标：Cloudflare Pages（前端 + API）+ Cloudflare Workers（定时抓取）

## 仓库结构

pnpm monorepo + Turborepo。

```
.
├── apps/
│   ├── web/                      # TanStack Start + Mantine v7 + Hono API → Cloudflare Pages
│   │   ├── app/
│   │   │   ├── routes/           # TanStack Router 文件路由（index.tsx 首页 / fish.tsx 管理后台 / api/$.ts API 通配）
│   │   │   ├── server/           # Hono 应用与路由（articles / sources）
│   │   │   ├── components/       # React 组件
│   │   │   ├── router.tsx        # TanStack Router 实例
│   │   │   ├── ssr.tsx / client.tsx
│   │   │   └── utils/apiUrl.ts   # 同构 API URL（server 用 getRequestURL，client 用相对路径）
│   │   ├── app.config.ts         # cloudflare-pages preset
│   │   └── wrangler.toml         # D1 binding + Queue producer binding
│   └── fetcher/                  # Cloudflare Worker（cron + queue consumer），仅含 worker 入口
│       ├── src/
│       │   └── index.ts          # 入口：scheduled() 入队、queue() 消费，逻辑来自 @repo/ingest
│       └── wrangler.toml         # cron + queue consumer + D1 + migrations_dir
├── packages/
│   ├── db/                       # Drizzle ORM schema + D1 client
│   │   ├── src/schema.ts         # sources / articles 两张表
│   │   ├── migrations/           # SQL 迁移（被 fetcher 的 wrangler.toml 引用）
│   │   └── drizzle.config.ts
│   ├── ingest/                   # 抓取核心库（无 worker 入口，供 fetcher 与 web 共用）
│   │   └── src/
│   │       ├── fetcher.ts        # 抓取与入库主逻辑（fetchAndStore / getSourcesToFetch）
│   │       ├── firecrawl.ts      # Firecrawl Scrape API 客户端
│   │       ├── v2ex-adapter.ts   # V2EX 热议适配器（Firecrawl 抓取首页 → 解析 #TopicsHot）
│   │       ├── translator.ts     # DeepL API v2 调用
│   │       ├── dedup.ts          # 按 URL 去重
│   │       ├── types.ts          # Env 类型（DB / NEWS_QUEUE / DEEPL_API_KEY / FIRECRAWL_API_KEY）
│   │       └── index.ts          # 统一出口
│   ├── shared/                   # 跨端共享类型与工具
│   │   └── src/{types,utils}.ts  # QueueMessage / SourceInput / normalizeUrl / shouldFetchNow / isCloudflareQuotaError / formatRelativeTime / BROWSER_UA
│   └── telemetry/                # 结构化日志（logger）
├── turbo.json                    # build / dev / typecheck / db:generate / db:migrate / deploy
├── pnpm-workspace.yaml
├── .pnpmfile.cjs                 # 强制锁版本：@tanstack/* 全部固定到 1.114.1
└── tsconfig.json                 # 基础配置（strict、ES2022、Bundler moduleResolution）
```

## 常用命令

所有命令在仓库根目录执行。包管理器是 **pnpm@9**，Node ≥ 20。

| 任务 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 启动前端 + API（开发） | `pnpm dev:web` |
| 启动 fetcher（开发，带 scheduled 模拟） | `pnpm dev:fetcher` |
| 全量开发 | `pnpm dev` |
| 类型检查（全 workspace） | `pnpm typecheck` |
| Lint 检查（Biome） | `pnpm lint` |
| Lint 自动修复 + 格式化 | `pnpm lint:fix` |
| 仅格式化（Biome） | `pnpm format` |
| 单元/集成测试（Vitest，node 池） | `pnpm test` |
| 单测 watch 模式 | `pnpm test:watch` |
| 端到端测试（Vitest + workerd 真 D1） | `pnpm test:e2e` |
| 构建 | `pnpm build` |
| 部署前端 | `pnpm deploy:web` |
| 部署 fetcher | `pnpm deploy:fetcher` |
| 生成 Drizzle 迁移 | `pnpm db:generate` |
| 应用迁移（本地） | `wrangler d1 migrations apply news-aggregator --local` |
| 应用迁移（远程） | `wrangler d1 migrations apply news-aggregator --remote` |
| 清理悬挂的 workerd/esbuild 进程 | `pnpm cleanup` |

`turbo run <task>` 支持的任务：`build`、`dev`、`typecheck`、`lint`、`db:generate`、`db:migrate`、`deploy`。（`lint` 在 turbo 中已移除：根 `pnpm lint` 直接用 Biome 扫全仓，不再走各子包脚本。）

### 质量门禁（提交前）

仓库通过 **husky pre-commit** 强制质量门禁，提交前自动跑（不可 `--no-verify` 跳过）：

```
pnpm lint        # Biome 检查（含格式化、import 整理、lint 规则）
pnpm typecheck   # 全 workspace tsc --noEmit
pnpm test        # 纯逻辑单测（Vitest node 池，快）
```

- **格式化/Lint 用 Biome**（`biome.json` 在仓库根）：2 空格、单引号、分号、`organizeImports` 开启。新增/改动文件必须过 Biome，否则提交被拒。
- **单测**：Vitest + node 池，覆盖纯函数（`@repo/shared`/`@repo/ingest` 抓取解析、`@repo/web` 的 `extract`/`summarize`）。配置见根 `vitest.config.ts`，覆盖 `packages/*` 与 `apps/web/app/server`。
- **端到端测试（`pnpm test:e2e`）不入 pre-commit 钩子**，需手动运行。它用 `@cloudflare/vitest-pool-workers` 起**真 workerd** + **真 D1 本地库**（迁移由 `apps/web/test/setup.ts` 经 Vite `define` 注入后在 `beforeAll` 套用），驱动 `apps/web/test/worker-entry.ts`（转发 Hono `app.fetch`）打真实 Web API。用例见 `apps/web/test/*.e2e.test.ts`。注意：`vitest` 必须保持 **4.x**（与 pool 的 peer `^4.1.0` 匹配），且 e2e 配置用 `cloudflareTest` 插件 + `pool: "cloudflare-pool"`，不能用旧版 `poolOptions` 写法。

## 架构与数据流

### 两个部署单元 + 一个共享库

1. **web**（Cloudflare Pages）：TanStack Start SSR + Hono API。Hono app 在 [apps/web/app/server/app.ts](apps/web/app/server/app.ts) 装配，通过 [apps/web/app/routes/api/$.ts](apps/web/app/routes/api/$.ts) 的通配 API 路由挂载到 `/api/*`。web 既是前端也是 API 服务器，同时是 Queue 的 **producer**。
2. **fetcher**（Cloudflare Workers）：cron 触发的抓取 worker，是 Queue 的 **consumer**，也是 producer（cron 入队自身消费）。负责抓 RSS → 去重 → DeepL 翻译 → 入库 D1。
3. **@repo/ingest**（packages/ingest）：抓取核心库，**无 worker 入口**，抽出原 `apps/fetcher/src` 下的 `fetcher.ts`/`dedup.ts`/`translator.ts`/`firecrawl.ts`/`v2ex-adapter.ts`/`types.ts`。`apps/fetcher` 现在只留 `src/index.ts` 这个 worker 入口，依赖 `@repo/ingest`；`apps/web` 的 `DIRECT_FETCH` 本地同步抓取路径也依赖 `@repo/ingest`，**不再直接依赖 worker 包 `@repo/fetcher`**。这样两个部署单元彻底解耦，抓取逻辑只维护一份。

### 抓取/翻译流水线

```
[cron 0 * * * *] → fetcher.scheduled()
   → getSourcesToFetch(): 按 fetchFrequency + lastFetchedAt 过滤
   → NEWS_QUEUE.send({ sourceId })  （每源一条消息）
        ↓
fetcher.queue(batch)  每批最多 10 条，最多重试 3 次
   → fetchAndStore(env, sourceId):
        1. fetchFeed(url): 支持 V2EX 两个分支——「最新」走 JSON API、「热议」走 Firecrawl Scrape 抓取首页 + 正则解析 #TopicsHot；其余用 feed-extractor，两个 UA 回退，再回退到裸 fetch + extractFromXml
       2. 按 publishedAt 排序，normalizeUrl 后通过 articles_source_url_idx 去重
       3. isLatinText(title) 筛出拉丁标题，批量调用 translateTitles() (DeepL, 批次上限 50)
       4. 逐条 INSERT；遇配额错误 ack（不重试），其他错误 retry()
       5. 更新 sources.last_fetched_at
```

### 手动触发抓取

web API 的 `POST /api/sources/:id/fetch` 和 `POST /api/sources/fetch-all` 在**生产环境**向 `NEWS_QUEUE` 投递消息，由 fetcher 异步消费。这是为了规避 Pages 函数同步执行多 UA 回退导致的 30–40 秒 pending。

**本地开发例外**：由于本地开发时 web worker 和 fetcher 是两个独立进程，Queue 不互通（消息发了但没人收），因此当 web 的 `.dev.vars` 中设置了 `DIRECT_FETCH=true` 时，API 会跳过 Queue，直接调用 `fetchAndStore()` 同步抓取。前端 [fish.tsx](apps/web/app/routes/fish.tsx) 通过轮询检测 `lastFetchedAt` 变化来判断抓取完成。

### 管理后台入口

**注意：管理后台路径是 `/fish`，不是 `/admin`（历史上的 `/admin` 已废弃，文档中如再出现 `/admin` 视为 drift，需回填为 `/fish`）。** 前端通过点击页头 "TouchFish News" 文字 **3 次**（1.5 秒内）跳转到 `/fish`，规避直接暴露。后台无鉴权，仅靠隐蔽入口；如需保护请用 Cloudflare Access。后台支持资讯源列表展示 ID、批量启停与批量删除。

### 数据模型

两张表（[packages/db/src/schema.ts](packages/db/src/schema.ts)）：

- `sources`：id / name / url / priority / fetch_frequency（hourly|twice_daily|daily）/ is_active / last_fetched_at / created_at / updated_at
- `articles`：id / source_id (FK cascade) / title / translated_title（可空）/ url（**unique**）/ published_at / fetched_at / summary（可空，AI 总结缓存）/ metadata(json)

关键索引：`articles_source_url_idx`（unique on source_id + url，跨源去重依据）、`articles_source_published_idx`、`sources_priority_idx`。

## 关键约定与硬性约束

以下是必须遵守的规则，违反会导致生产事故或回退。

### 翻译模块

- **翻译服务用 DeepL API v2**，通过 `fetch()` 调用，**不要**改回 Cloudflare Workers AI（`env.AI.run()`）。历史上的 AI 方案有推理 token 问题、超时、格式不匹配，已废弃。
- DeepL API key **必须**作为环境变量 `DEEPL_API_KEY` 提供：
  - 本地（fetcher）：写在 `apps/fetcher/.dev.vars`（已被 gitignore；`.dev.vars.example` 是模板）
  - 本地（web，仅 `DIRECT_FETCH=true` 时需要）：写在 `apps/web/.dev.vars`
  - 生产：`wrangler secret put DEEPL_API_KEY`（在 `apps/fetcher` 目录下执行）
  - **绝不**把 key 写进代码或提交到版本控制。
- DeepL 端点根据 key 后缀自动选择：`:fx` 后缀走 `api-free.deepl.com`，否则走 `api.deepl.com`。
- **翻译失败必须返回 `null`**，不要回退到原标题。前端用 `translatedTitle ?? title` 兜底。
- 仅翻译拉丁文标题（`isLatinText` 启发式：拉丁字符占比 > 60%），中文源标题不进 DeepL。
- 批量上限 50 条/请求，超时 15 秒。
- **文章 AI 总结用 Gemini `gemini-3.1-flash-lite`**（Google Generative Language API，`generativelanguage.googleapis.com`），通过 `fetch()` 调用，与翻译模块相互独立。该约束（禁用 Workers AI）仅针对翻译，总结走 Gemini 不受限。Gemini API key 作为环境变量 `GEMINI_API_KEY` 提供：本地写在 `apps/web/.dev.vars`（web 端直接用，不走 fetcher），生产在 `apps/web` 目录执行 `wrangler secret put GEMINI_API_KEY`。**绝不**把 key 写进代码或提交到版本控制。
- 总结的正文抓取复用 `@repo/shared` 的 `fetchWithUA()`（多 UA 回退），不在 web 端重复实现 UA 逻辑。

### 抓取与队列

- **生产环境的 web API fetch 端点必须走队列异步**，不要在 web worker 里同步抓取。同步抓取会因为多 UA 回退造成 30–40s pending。本地开发例外：`DIRECT_FETCH=true` 时直接调用 `fetchAndStore()`。
- fetcher 的 `queue()` 处理失败时：**配额类错误 `message.ack()`（重试无意义）**，其他错误 `message.retry()`。`isCloudflareQuotaError()` 在 [packages/shared/src/utils.ts](packages/shared/src/utils.ts) 已实现，不要在 catch 里无脑 retry。
- URL 去重前必须先过 `normalizeUrl()` 剥离 utm_* / fbclid / gclid / ref / source 等追踪参数，再按 `(source_id, url)` 复合唯一索引去重，允许不同源共享同一条 URL。
- V2EX 源（URL 含 `v2ex.com/index.xml`）走专用 JSON API 分支，不走 RSS 解析。
- V2EX 热议源（URL 含 `v2ex.com/#hot-topics`）通过 Firecrawl Scrape API 抓取首页 HTML，正则提取 `#TopicsHot` 区块。URL 末尾带 `?` 查询参数强制 V2EX 返回 HTML 而非 RSS/XML（内容协商）。Firecrawl API key 通过环境变量 `FIRECRAWL_API_KEY` 提供，配额 402 错误由 `isCloudflareQuotaError()` 检测并 ack。**热议条目在首页 `#TopicsHot` 中只有标题与链接、无正文**，因此抓取后会用 V2EX `topics/show.json?id=<topicId>` API 逐条补全 `content_rendered`，写入 `metadata.content` / `metadata.description`。这样文章总结（`/api/articles/:id/summary`）的 RSS 正文回退（第 2 级）才能命中；否则热议源的文章无任何正文落库，总结只能依赖请求时实时抓取话题页，在 dev / 受限网络下会稳定返回 422「正文抽取不足」。该补全是尽力而为：单条 API 失败只跳过该条，不影响其余。
- Firecrawl 请求默认带上 `maxAge: 0` 强制绕过缓存，确保每次抓取拿到最新页面。Firecrawl 默认缓存 2 天，不设此参数会导致 V2EX 热榜始终返回旧数据。

### 代码风格

- TypeScript **strict** 模式，ESM（`"type": "module"`），模块解析 Bundler。
- 格式化与 Lint 统一用 **Biome**（`biome.json` 在仓库根）：2 空格缩进、单引号、分号、`organizeImports` 开启。提交前 husky 会跑 `pnpm lint`，未通过会被拒。不要手动跑 prettier/eslint 覆盖 Biome。
- 跨端共享代码放 `packages/`，不要在 `apps/web` 和 `apps/fetcher` 之间重复实现。
- 导入 workspace 包用 `@repo/db`、`@repo/shared`、`@repo/telemetry`；导入子路径用 `@repo/db/schema`。
- 日志用 `@repo/telemetry` 的 `logger`，结构化字段带 `service: 'web-api' | 'fetcher'`，便于在 Cloudflare 控制台筛选。
- UI 文案、注释用中文；代码标识符用英文。
- 默认不写注释。仅在 WHY 非显而易见时写一行。

### TanStack 版本锁定

`.pnpmfile.cjs` 把所有 `@tanstack/*` 强制对齐到 `1.114.1`。升级 TanStack 时要同步改这个文件，否则 pnpm 会解析出不一致版本导致 SSR/路由崩。**不要**删除此 hook。

## 环境配置

### 本地开发

1. `pnpm install`
2. 创建本地 D1：`wrangler d1 create news-aggregator`，把 `database_id` 填进 `apps/web/wrangler.toml` 和 `apps/fetcher/wrangler.toml`（两个文件的 production 与 preview 段）。
3. 创建 Queue：`wrangler queues create news-fetch-queue`
4. 应用迁移：`wrangler d1 migrations apply news-aggregator --local`
5. 复制 `apps/fetcher/.dev.vars.example` 为 `apps/fetcher/.dev.vars`，填入 DeepL API key 和 Firecrawl API key。
6. 创建 `apps/web/.dev.vars`，设置 `DIRECT_FETCH=true`、`DEEPL_API_KEY`、`FIRECRAWL_API_KEY`（与 fetcher 相同）和 `GEMINI_API_KEY`（文章 AI 总结用）。本地开发时 web 直接调用 `@repo/ingest` 的 `fetchAndStore()` 同步抓取，不走 Queue。
7. 两个终端分别跑 `pnpm dev:web` 和 `pnpm dev:fetcher`。
8. 访问 <http://localhost:3000>，首页右上 "TouchFish News" 文字连点 3 次进入 `/fish`。

web 端本地通过 `wrangler getBindingsProxy()` 拿 D1/Queue 绑定（[apps/web/app/routes/api/$.ts](apps/web/app/routes/api/$.ts)）；如果失败回退到 `createMockEnv()`（空实现，仅用于类型检查不报错）。

> 本地 D1 注意：web 与 fetcher 各自有独立的本地 sqlite 文件（同 `database_id` 但分属 `apps/web/.wrangler` 与 `apps/fetcher/.wrangler`）。新增迁移后，**两个本地库都要应用**：在 `apps/fetcher` 与 `apps/web` 分别执行 `wrangler d1 migrations apply news-aggregator --local`。若 web 本地库缺列导致 `no such column`，可直接 `wrangler d1 execute news-aggregator --local --command "ALTER TABLE articles ADD COLUMN summary text;"`（从 `apps/web` 目录执行）。

### 生产部署

1. 在 Cloudflare 控制台创建 D1 `news-aggregator` 与 Queue `news-fetch-queue`，ID 填进两个 `wrangler.toml`。
2. `wrangler d1 migrations apply news-aggregator --remote`
3. 在 `apps/fetcher` 目录：`wrangler secret put DEEPL_API_KEY`、`wrangler secret put FIRECRAWL_API_KEY`
4. 在 `apps/web` 目录：`wrangler secret put GEMINI_API_KEY`（文章 AI 总结）
4. `pnpm deploy:fetcher` 然后 `pnpm deploy:web`

## 测试 fetcher（本地触发 cron）

fetcher 用 `wrangler dev --test-scheduled` 启动，支持模拟 cron 触发：

```bash
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

也可通过 web API 触发单源抓取来端到端验证：

```bash
curl -X POST http://localhost:3000/api/sources/<id>/fetch
# 本地开发（DIRECT_FETCH=true）返回 {"success":true,"fetched":true}，同步完成
# 生产环境返回 {"success":true,"queued":true}，异步由 fetcher 消费
```

## 常见任务指引

### 添加新的 RSS 源

通过 `/fish` 后台 "添加资讯源" 表单，输入网址会自动探测 RSS（`POST /api/sources/detect` 尝试 `<link rel=alternate>` 与常见 feed 路径）。也可直接 SQL 插入。新源加入后下一次 cron 即开始抓取。

### 修改 schema

1. 编辑 [packages/db/src/schema.ts](packages/db/src/schema.ts)
2. `pnpm db:generate`（在 `packages/db` 内生成迁移 SQL）
3. 检查 `packages/db/migrations/` 下新生成的 SQL
4. 本地 `wrangler d1 migrations apply news-aggregator --local` 验证
5. 远程 `wrangler d1 migrations apply news-aggregator --remote`
6. **两个 wrangler.toml 都引用同一个 migrations_dir**，迁移只需应用一次。

### 修改前端 UI

- 首页：[apps/web/app/routes/index.tsx](apps/web/app/routes/index.tsx) + `components/SourceSection.tsx`、`CompactArticleItem.tsx`
- **首页「加载更多」折叠（懒加载）**：首页按 priority 排序展示资讯源。**过期源（最新文章 `publishedAt` 距今超过 30 天，或无文章）的判定已下移到服务端**，由 `/api/articles/grouped` 的 `scope` 参数控制：默认 `?scope=active` 只返回活跃源、`?scope=stale` 只返回过期源（较慢更新的订阅源）。首页初始只请求活跃源；底部「加载更多」按钮**仅在点击时才请求 `?scope=stale`**，把过期源查询延迟到用户真正需要时，从源头压低 D1 读配额。服务端用活跃响应头 `X-Has-Stale: true/false` 告知前端是否存在可懒加载的过期源。判定口径见 `isStaleGroup()` / `isStaleByNewestPublishedAt()`（`packages/shared/src/utils.ts`）。
- 首页卡片每源默认展示 10 条，点击卡片内 "Show more" 最多再展开 10 条（共 20 条）；`/api/articles/grouped` 服务端逐源 `ORDER BY published_at DESC LIMIT 20` 取最新 20 条（每源一次索引查询、1 个绑定参数），避免一次性捞出全部历史文章。
- 后台：[apps/web/app/routes/fish.tsx](apps/web/app/routes/fish.tsx) + `SourceForm.tsx`
- 后台通过 `usePollingAfterFetch` hook 轮询检测 `lastFetchedAt` 变化，实现每个源独立的抓取状态追踪（转动/完成）
- 主题在 [apps/web/app/routes/__root.tsx](apps/web/app/routes/__root.tsx) 的 `createTheme({ primaryColor: 'blue', defaultRadius: 'md' })`
- Mantine CSS 通过 `?inline` 在 SSR 内联，避免样式闪烁。
- 修改路由后 `routeTree.gen.ts` 会自动重新生成，不要手动编辑。

### 修改 API

所有 API 在 [apps/web/app/server/routes/](apps/web/app/server/routes/) 下。新增子路由记得在 [app.ts](apps/web/app/server/app.ts) 里 `app.route('/api/xxx', xxxRoute)`。入参用 `zValidator` + zod 校验。

- `GET /api/articles/:id/summary`：文章 **AI 总结**。先查 D1 `summary` 字段，命中缓存直接返回 `{ summary, cached: true }`；未命中则按**三级回退**抽取正文，任一级抽到「充足正文」（清洗后 ≥ 80 字且有效字符占比 ≥ 30%，见 `isContentSufficient`）即用其调 Gemini，全部不足才 422：
  1. **实时抓取文章 URL**：`extractArticleText()` → `fetchWithUA()`（`@repo/shared` 多 UA 回退）+ `linkedom` 构造 DOM + `@mozilla/readability` 提取正文。该路径**关闭去标签兜底**（`extractFromHtml({ allowStripFallback: false })`）——Readability 取不到正文就抛错，避免把 JS 渲染页 shell 当正文、绕过下方 RSS 回退并缓存垃圾。
  2. **回退 RSS 正文**：`metadata.content`（fetcher 落库时采集的 `content:encoded` / `content` / `content_rendered`，截断前 8000 字符），走 `extractFromHtml()` 去标签兜底。
  3. **回退 RSS 简介**：`metadata.description`（采集的 `summary ?? description`），同样走 `extractFromHtml()`。
  - 调 **Gemini `gemini-3.1-flash-lite`**（`generativelanguage.googleapis.com`，需环境变量 `GEMINI_API_KEY`）用固定提示词生成 50~80 字中文概述。请求带 `generationConfig.thinkingConfig.thinkingBudget: 0` 关闭思考（若该模型支持思考），避免思考 token 吃光 `maxOutputTokens` 预算导致输出被截断（`finishReason: MAX_TOKENS`，摘要只剩几个字） → 写回 `summary` 字段并返回。
  - **回退可观测性**：实时抓取失败会打 `logger.warn('文章总结实时抓取失败，回退 RSS 正文')`；最终用 RSS 回退生成时会打 `logger.info('文章总结使用 RSS 回退生成', { source: 'rss-content' | 'rss-desc' })`。所有日志带 `service: 'web-api'` 与 `articleId`，便于在 Cloudflare 控制台筛选回退占比。
  - **正文抽取不足（三级回退后仍 < 80 字或有效字符占比 < 30%，多见于 V2EX 等 JS 渲染页 / 站点首页且 RSS 也无正文）直接返回 422 `{ error: '正文抽取不足' }`，不调 Gemini、不写库，可后续重试**；其他抽取 / 总结错误返回 500，不回退标题。注意：V2EX 等源因 fetcher 已落库 `content_rendered`，通常能在第 2 级命中，不再 422。
  - 前端 `CompactArticleItem` 每行的 AI 图标**默认隐藏，仅 hover 标题行时淡入**（`IconSparkles`，tooltip「总结全文」）；点击抓取/读取缓存 summary 后行内展开，图标变为 `IconX`（tooltip「关闭总结」），点击即收起；**失败态同理**：返回 422/500 后行内展示错误提示，图标同样变为 `IconX`，点击收起错误提示；**不论是否已有缓存，首页刷新默认不展开任何总结**，保持干扰最小。
- `GET /api/articles/grouped`：按源聚合文章。**支持 `scope` 查询参数**——`active`（默认）只返回「最新文章 30 天内」的活跃源，`stale` 只返回过期源。服务端先用 `GROUP BY` + `MAX(publishedAt)`（走 `articles_source_published_idx` 索引）算出每源最新发布时间做过期判定，再仅对目标源集合逐源 `ORDER BY published_at DESC LIMIT 20` 取文章（每源一次索引查询、1 个绑定参数，不走窗口函数全量扫描、也不拼超长 IN 列表触发 D1 参数上限），从源头压低 D1 读配额。活跃查询额外返回响应头 `X-Has-Stale: true/false` 指示是否存在可懒加载的过期源，并带 `Cache-Control: public, max-age=60` 边缘缓存（前端走默认缓存策略）。

## 已知坑

- **静态资源目录唯一**：站点静态资源（favicon.svg / logo.svg / `_headers`）只放在 `apps/web/public/`，根目录 `public/` 已删除（历史上二者重复，改根目录的不会生效）。构建与部署以 `apps/web/public/` 为准。
- **`app.config.timestamp_*.js`** 是 Vinxi 构建产物，已在 `.gitignore`，忽略即可。
- **`pnpm cleanup`** 会 `pkill` workerd/esbuild 进程，本地 dev 卡死时有用。
- **`.playwright-mcp/`** 是 Playwright MCP 缓存，已 gitignore，不影响功能。

## 文档同步规则

**硬性约束**：重大功能变更或大规模系统调整时，Agent 必须同步更新本文件（`AGENTS.md`）与 `README.md`，并与代码放在同一次提交。

### 真相源与工具入口

- `AGENTS.md` 是**唯一真相源**（agent 视角：架构、约束、流水线、坑）。
- `README.md` 是**人类入口**（项目介绍、本地开发、部署）。
- 其他工具入口文件（`CLAUDE.md` / `.cursorrules` / `.github/copilot-instructions.md` 等）若存在，**只放一行指针** `本仓库由 AGENTS.md 统一指引，请先阅读 AGENTS.md`，不重复内容。
- 新增任何工具入口文件时，必须同步建指针。

### 触发范围（任一命中即需同步文档）

- 新增、移除或重命名顶层模块 / 部署单元（apps/*、packages/*）
- 数据模型（schema）变更，或新增 / 删除 API 端点
- 抓取、翻译、队列等核心流水线的行为或外部依赖发生变化
- 用户交互流程调整（路由、后台入口、表单、通知文案等影响使用方式的改动）
- 环境变量、绑定（D1 / Queue / Secret）、部署目标或部署命令发生变化
- 任何会使现有章节描述失真的改动

### 更新内容要求

- 功能变更的具体描述（改了什么、为什么改）
- 新增或修改的核心能力
- 相关使用方法调整（命令、路由、参数、配置项）
- 可能影响用户交互或运维的关键信息（breaking change、新鉴权入口等）
- 按 AGENTS.md / README.md 各自职责写入对应文件，不重复双写

### 提交前自检

创建提交前，除 `pnpm typecheck` 外，逐项自问：

1. 本次改动是否命中上方触发范围？
2. 若命中：AGENTS.md / README.md 是否已按职责更新？
3. 若未命中：提交说明中是否写明"无需文档更新"的理由？

### 无需更新的出口

纯内部重构、不改可观测行为、不新增/移除能力时，可判定无需更新文档，但**必须在提交说明中简要写明理由**（如 `refactor: xxx（无文档变更：纯内部实现调整）`）。

### 历史回填

首次应用本规则时，需对现有 AGENTS.md / README.md 做一次全量校准，消除历史 drift；后续发现文档与代码脱节时，应在下一个提交中立即修正，不积压。

目标：始终维持项目文档对系统整体能力的准确、全面且最新的描述，确保任意工具（Codex / OpenCode / Claude Code / Cursor 等）的 agent 都能读到一致且最新的项目状况。

## 提交规范

近期 commit 风格（参考 `git log`）：

- `feat:` / `fix:` / `refactor:` / `perf:` / `chore:` / `debug:` 前缀
- 标题用中文，简短描述变更
- 示例：`refactor: 翻译模块从 Cloudflare AI 改用 DeepL API`

创建提交前先跑 `pnpm typecheck`。**不要** `--no-verify` 跳过 hook（husky pre-commit 会强制 `pnpm lint && pnpm typecheck && pnpm test`）。**不要** amend 已推送的提交，新建提交即可。
