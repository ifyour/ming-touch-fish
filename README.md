# 摸鱼资讯（TouchFish News）

基于 Cloudflare 全家桶（Pages / Workers / D1 / Queues）的个人资讯聚合应用。定时抓取 RSS 源 → 用 DeepL 将英文标题翻译为中文 → 在前端按源分组展示。

- 生产站点：<https://news.mingming.dev/>
- 生产 fetcher worker：<https://news-aggregator-fetcher.ifyour.workers.dev>
- 部署目标：Cloudflare Pages（前端 + API）+ Cloudflare Workers（定时抓取）

## 功能特性

- **多源聚合**：按源分组展示资讯，首页按优先级排序，支持「加载更多」懒加载更新较慢的过期源。
- **英文标题翻译**：DeepL API v2 将拉丁文标题批量翻译为中文（中文源标题不进 DeepL），翻译失败自动回退原标题。
- **文章 AI 总结**：任意文章可一键生成 50~80 字中文概述（Gemini `gemini-3.1-flash-lite`），结果缓存到 D1，命中即直接返回。
- **V2EX 热议**：除常规 RSS 外，内置 V2EX 热议适配器（Firecrawl 抓取首页 `#TopicsHot` + 逐条补全正文），覆盖无 RSS 且反爬强的源。
- **异步抓取**：生产环境抓取走 Cloudflare Queues 异步消费，规避 Pages 函数长耗时同步阻塞。
- **隐蔽管理后台**：页头 "TouchFish News" 文字连点 3 次进入 `/fish`，支持资讯源增删改、批量启停、单源/全量抓取触发。后台需 GitHub 登录，仅 `ifyour` 账号可访问（可用 `ADMIN_GITHUB_LOGIN` 环境变量覆盖）。
- **用户登录与已读**：右上角「登录」按钮支持 GitHub OAuth 登录（better-auth）。已读文章按用户维度存储到 D1（`read_articles` 表）；未登录用户沿用本地 `localStorage` 已读方案，匿名体验不变。

## 技术栈

- **前端**：TanStack Start + Mantine v7
- **后端 API**：Hono（通过 TanStack Start API 通配路由挂载到 `/api/*`）
- **数据库**：Cloudflare D1 + Drizzle ORM
- **定时抓取**：Cloudflare Workers + Cron Triggers + Queues
- **翻译**：DeepL API v2（英文标题 → 中文，批量上限 50 条/请求）
- **AI 总结**：Gemini `gemini-3.1-flash-lite`（Google Generative Language API）
- **登录与已读**：better-auth（GitHub OAuth，原生 Cloudflare D1 适配器），已读数据存 D1 `read_articles` 表
- **反爬代理**：Firecrawl Scrape API（用于 V2EX 热议等无 RSS 且反爬强的源）

## 架构概览

两个部署单元 + 一个共享库，抓取逻辑只维护一份：

- **web**（Cloudflare Pages）：TanStack Start SSR + Hono API，既是前端也是 API 服务器，同时是 Queue 的 **producer**。
- **fetcher**（Cloudflare Workers）：cron 触发的抓取 worker，是 Queue 的 **consumer**，负责抓 RSS → 去重 → DeepL 翻译 → 入库 D1。
- **@repo/ingest**（packages/ingest）：抓取核心库，无 worker 入口，供 fetcher 与 web 共用。

抓取流水线：

```
[cron 0 * * * *] → fetcher.scheduled() → 按频率过滤源 → 每源入队一条消息
     ↓
fetcher.queue(batch)  每批最多 10 条，最多重试 3 次
   → fetchAndStore(): 抓取 → normalizeUrl 去重 → 拉丁标题批量翻译 → 逐条入库 → 更新 last_fetched_at
```

本地开发例外：web 的 `.dev.vars` 设置 `DIRECT_FETCH=true` 时，API 跳过 Queue 直接同步抓取（详见下方「本地开发」）。

## 项目结构

```
.
├── apps/
│   ├── web/          # TanStack Start 前端 + Hono API（Cloudflare Pages）
│   │   ├── app/routes/        # 文件路由（index.tsx 首页 / fish.tsx 后台 / api/$.ts 通配 API）
│   │   ├── app/server/        # Hono 应用与路由（articles / sources）
│   │   └── app/components/    # React 组件
│   └── fetcher/      # 定时抓取 Worker 入口（Cloudflare Workers，仅 src/index.ts，逻辑来自 @repo/ingest）
├── packages/
│   ├── db/           # Drizzle schema + D1 client（sources / articles 两张表）
│   ├── ingest/       # 抓取核心库（抓 RSS / 去重 / DeepL 翻译 / Firecrawl / V2EX，供 fetcher 与 web 共用）
│   ├── shared/       # 共享类型与工具（normalizeUrl / shouldFetchNow / isCloudflareQuotaError 等）
│   └── telemetry/    # 结构化日志（logger）
├── turbo.json        # build / dev / typecheck / lint / db:generate / deploy
├── pnpm-workspace.yaml
├── .pnpmfile.cjs     # 强制锁版本：@tanstack/* 全部固定到 1.114.1
└── package.json
```

## 数据模型

基于 Drizzle ORM，D1 中两张表（完整定义见 `packages/db/src/schema.ts`）：

- `sources`：id / name / url / priority / fetch_frequency（hourly|twice_daily|daily）/ is_active / last_fetched_at / created_at / updated_at
- `articles`：id / source_id（FK cascade）/ title / translated_title（可空）/ url（**unique**）/ published_at / fetched_at / summary（可空，AI 总结缓存）/ metadata（json）

关键索引：`articles_source_url_idx`（source_id + url 复合唯一，跨源去重依据）、`articles_source_published_idx`、`sources_priority_idx`。

## 本地开发

### 1. 安装依赖

```bash
pnpm install
```

### 2. 创建 D1 数据库并应用迁移

```bash
# 创建本地 D1 数据库
wrangler d1 create news-aggregator

# 将生成的 database_id 填入 apps/web/wrangler.toml 与 apps/fetcher/wrangler.toml
# 应用迁移
wrangler d1 migrations apply news-aggregator --local
```

### 3. 创建 Queue

```bash
wrangler queues create news-fetch-queue
```

### 4. 配置 API keys

```bash
# 复制模板到 apps/fetcher/.dev.vars，填入 DeepL API key 和 Firecrawl API key
# .dev.vars 已被 gitignore，仅用于本地开发
cp apps/fetcher/.dev.vars.example apps/fetcher/.dev.vars
# 在 apps/web/.dev.vars 填入 GEMINI_API_KEY（文章 AI 总结用）
```

### 5. 启动服务

```bash
# 终端 1：启动前端 + API
pnpm dev:web

# 终端 2：启动抓取 Worker
pnpm dev:fetcher
```

访问 http://localhost:3000 查看首页。管理后台入口为 http://localhost:3000/fish （也可在首页点击页头 "TouchFish News" 文字 3 次进入）。

## API 概览

所有 API 在 `apps/web/app/server/routes/` 下，通过 `app/routes/api/$.ts` 挂载到 `/api/*`，入参用 `zValidator` + zod 校验：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/articles/grouped?scope=active\|stale` | 按源聚合文章（`active` 默认只返活跃源，`stale` 返过期源），带 `X-Has-Stale` 响应头与边缘缓存；另支持 `?sourceId=&offset=&limit=` 单源分页（带 `X-Has-More` 响应头） |
| GET | `/api/articles/:id/summary` | 文章 AI 总结（先查缓存，未命中按「读库预抽 → live 抓页（真爬虫 UA 优先 + AMP 回退）→ RSS 简介 → Browser 渲染」四级回退抽正文调 Gemini，不足返回 422 带 `stage`/`detail` 诊断字段） |
| POST | `/api/sources/:id/fetch` | 触发单源抓取（生产走 Queue 异步，本地 `DIRECT_FETCH` 同步） |
| POST | `/api/sources/fetch-all` | 触发全量抓取 |
| POST | `/api/sources/detect` | 输入网址自动探测 RSS（识别 `<link rel=alternate>` 与常见 feed 路径） |
| 其他 | `/api/sources/*` | 资讯源增删改、批量启停、批量删除等管理操作 |
| GET | `/api/read/articles` | 获取当前登录用户的已读文章 ID 列表（未登录返回 401，前端回退 localStorage） |
| POST | `/api/read/articles` | 单条标记已读 `{ articleId }`（写入 D1 `read_articles` 表，未登录 401） |
| POST | `/api/read/articles/batch` | 批量标记已读 `{ articleIds: number[] }`（「标记已读」整卡片用） |
| `*` | `/api/auth/*` | better-auth 端点：GitHub 登录回调、会话查询、登出等 |

## 代码质量与测试

提交前 husky pre-commit 钩子会自动执行质量门禁（不可用 `--no-verify` 跳过）：

```bash
pnpm lint        # Biome 检查（格式化 + import 整理 + lint）
pnpm typecheck   # 全 workspace tsc --noEmit
pnpm test        # Vitest 单测（node 池，纯逻辑）
```

其他常用命令：

```bash
pnpm lint:fix    # Biome 自动修复 + 格式化
pnpm format      # 仅格式化
pnpm test:watch  # 单测 watch
pnpm test:e2e    # 端到端测试：真 workerd + 真 D1，验证 Web API（不入 pre-commit 钩子，需手动运行）
pnpm build       # 构建
pnpm cleanup     # 清理悬挂的 workerd / esbuild 进程（本地 dev 卡死时使用）
pnpm db:generate # 生成 Drizzle 迁移（在 packages/db 内生成 SQL）
```

## 生产部署

### 1. 准备 Cloudflare 资源

- 在 Cloudflare 控制台创建 D1 数据库 `news-aggregator`，复制 database_id。
- 创建 Queue `news-fetch-queue`。
- 在两个 `wrangler.toml` 中填入 production 与 preview 的 database_id。

### 2. 应用数据库迁移

```bash
wrangler d1 migrations apply news-aggregator --remote
```

### 3. 配置 API keys

```bash
# 在 apps/fetcher 目录下执行
wrangler secret put DEEPL_API_KEY
wrangler secret put FIRECRAWL_API_KEY
# 在 apps/web 目录下执行（文章 AI 总结）
wrangler secret put GEMINI_API_KEY
# 在 apps/web 目录下执行（用户登录，GitHub OAuth）
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

GitHub OAuth App 配置：在 GitHub Developer Settings 创建 OAuth App，Authorization callback URL 填 `<你的 Pages 域名>/api/auth/callback/github`（本项目生产域名为 `https://news.mingming.dev`，即 `https://news.mingming.dev/api/auth/callback/github`）。

注意 GitHub 一个 OAuth App 只能配**一个精确 callback URL**。本地 `http://localhost:3000` 与生产 `https://news.mingming.dev` 是不同 origin，推荐两种做法之一：
- **建两个 OAuth App**：一个 callback 填 `https://news.mingming.dev/api/auth/callback/github`（生产），另一个填 `http://localhost:3000/api/auth/callback/github`（本地），本地 `.dev.vars` 用本地 App 的 ID/Secret，生产 `wrangler secret put` 用生产 App 的。
- **共用一个生产 App**：本地 dev 时把 `.dev.vars` 的 `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` 临时换成另一个配了 `localhost` callback 的 App 凭据。

better-auth 前端登录时通过 `signIn.social({ callbackURL: '/' })` 回调后跳回首页，无需在 GitHub 侧登记多个回调路径。

### 4. 初始化 better-auth 表

better-auth 使用原生 Cloudflare D1 适配器，表结构（`user` / `session` / `account` / `verification` 以及自定义 `read_articles`）在首次请求时**自动建表**。也可部署后手动触发一次迁移：

```bash
curl -X POST https://<你的 Pages 域名>/api/admin-migrate
```

### 5. 部署

```bash
# 部署抓取 Worker
pnpm deploy:fetcher

# 部署前端 + API
pnpm deploy:web
```

## 默认资讯源建议

在 `/fish` 后台页面添加以下 RSS 源：

| 名称 | RSS URL |
|------|---------|
| Hacker News | https://news.ycombinator.com/rss |
| TechCrunch | https://techcrunch.com/feed/ |
| The Verge | https://www.theverge.com/rss/index.xml |
| Reddit /r/programming | https://www.reddit.com/r/programming/.rss |
| 阮一峰的网络日志 | https://www.ruanyifeng.com/blog/atom.xml |
| InfoQ 中文 | https://www.infoq.cn/feed |

## 注意事项

- 首页按 priority 排序展示资讯源。最新文章发布时间距今超过 30 天（或无文章）的源为「过期源」，默认收起，主网格下方的「加载更多」按钮**点击后才会按需加载**这些更新较慢的订阅源，从源头降低数据库读压力。每张卡片初始展示 10 条，点击卡片内 "Show more" 或滚动到底部时向 `/api/articles/grouped?sourceId=&offset=` 拉取该源下一批（无限滚动），由 `X-Has-More` 响应头判断是否还有更多。
- 管理后台入口为 `/fish`（首页页头 "TouchFish News" 文字连点 3 次也可进入）。后台需 GitHub 登录，仅 `ifyour` 账号可访问，未登录访问会跳转登录页、非授权账号显示「无访问权限」。可用 `ADMIN_GITHUB_LOGIN` 环境变量覆盖允许的管理员 GitHub 用户名。
- 后台「更新」与「更新全部」**不直接同步抓取**，而是向 Queue 投递消息，由 fetcher worker 异步消费（抓取 + DeepL 翻译 + 入库）。触发后前端约 8–10 秒自动刷新文章列表。这样设计是为了规避 Pages 函数同步执行多 UA 回退导致的 30–40 秒 pending。
- 后台资讯源列表展示每行 ID，支持复选框多选后**批量启用 / 批量停用 / 批量删除**（删除带二次确认，相关文章随 FK cascade 一并清除）。
- DeepL 免费版每月 50 万字符额度；若翻译调用频繁，可关注用量或关闭部分英文源的自动翻译。翻译失败时返回 `null`，前端自动回退显示原标题。
- 文章 AI 总结的第四层正文兜底依赖 Cloudflare **Browser Run REST API**（非 Pages 绑定，因 Pages Functions 不支持 Browser 绑定）。需在 Pages 项目配置两个 secret：`CLOUDFLARE_API_TOKEN`（带 `Browser Rendering - Edit` 权限）和 `CLOUDFLARE_ACCOUNT_ID`。Free 计划每天 10 分钟浏览器时长免费，超出仅限流不扣费。未配置这两个变量时第四层自动跳过，不影响其他三级回退。
- 实时抓取（live）做了付费墙鲁棒性增强：先用**真爬虫 UA（`Googlebot`/`bingbot`）**抓页（媒体站普遍对搜索引擎放开全文），失败再用普通浏览器 UA 兜底；抓到挑战页或正文不足时还会再试 **AMP 变体**（`/amp`、`?amp=1`、`?outputType=amp`）。这两项与已有的 JSON-LD 抽正文、禁用 JS 抽取、拦截页识别共同构成对订阅源付费墙的穿透能力。
- Queue 消费失败会自动重试 3 次（配额类错误直接 ack 不重试），可在 Workers 日志中查看错误详情。

## 已知坑

- **本地 D1 分离**：web 与 fetcher 各自有独立的本地 sqlite 文件（同 `database_id` 但分属 `apps/web/.wrangler` 与 `apps/fetcher/.wrangler`）。新增迁移后**两个本地库都要应用**：分别在 `apps/fetcher` 与 `apps/web` 执行 `wrangler d1 migrations apply news-aggregator --local`。
- **本地 fetcher 不收 web 的消息**：本地开发时 web worker 与 fetcher 是两个独立进程、Queue 不互通。因此 web 必须设置 `DIRECT_FETCH=true` 才能同步抓取；想验证异步链路需另启 `pnpm dev:fetcher` 并用 `wrangler dev --test-scheduled` 模拟 cron。
- **TanStack 版本锁定**：`.pnpmfile.cjs` 把 `@tanstack/*` 强制对齐到 `1.114.1`，升级时需同步改此文件，否则会解析出不一致版本导致 SSR/路由崩。
- **测试框架版本**：`vitest` 必须保持 4.x（与 `@cloudflare/vitest-pool-workers` 的 peer `^4.1.0` 匹配），升级会破坏 e2e 测试。
- **静态资源目录唯一**：favicon.svg / logo.svg / `_headers` 只放在 `apps/web/public/`，根目录 `public/` 已删除（历史上二者重复，改根目录的不会生效）。构建与部署以 `apps/web/public/` 为准。
- **favicon 缓存**：`apps/web/public/_headers` 已对 favicon.svg / logo.svg 设置 7 天边缘缓存（`stale-while-revalidate` 30 天），改动 favicon 后注意缓存生效延迟。
- **构建产物**：`app.config.timestamp_*.js` 是 Vinxi 构建产物，已在 `.gitignore`，忽略即可。
- **正文抽取逻辑改动要实测**：文章总结（`/api/articles/:id/summary`）第 1 级 live 抓取依赖 `@mozilla/readability` 在真实 DOM 上抽取。曾有 bug 把整段 HTML 先去标签成纯文本再喂 Readability，导致 `documentElement` 为 null、Readability 静默抛错，所有 live 抓取失效并一路退到 Browser Rendering。改动 `packages/shared/src/extract.ts` 后，务必用带正文的文章页（如煎蛋 `https://jandan.net/p/xxxx`）实测第 1 级能抽出 ≥80 字正文。详见 AGENTS.md 正文抽取约束与已知坑。
