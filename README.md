# Cloudflare 个人资讯聚合站点

基于 Cloudflare 全家桶（Pages / Workers / D1 / Queues）的个人资讯聚合应用。

## 技术栈

- **前端**：TanStack Start + Mantine v7
- **后端 API**：Hono（通过 TanStack Start API 通配路由挂载）
- **数据库**：Cloudflare D1 + Drizzle ORM
- **定时抓取**：Cloudflare Workers + Cron Triggers + Queues
- **翻译**：DeepL API v2（英文标题 → 中文，批量上限 50 条/请求）
- **反爬代理**：Firecrawl Scrape API（用于 V2EX 热议等无 RSS 且反爬强的源）

## 项目结构

```
.
├── apps/
│   ├── web/          # TanStack Start 前端 + Hono API（Cloudflare Pages）
│   └── fetcher/      # 定时抓取 Worker（Cloudflare Workers）
├── packages/
│   ├── db/           # Drizzle schema + D1 client
│   ├── shared/       # 共享类型与工具
│   └── telemetry/    # 结构化日志
└── package.json
```

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
```

### 5. 启动服务

```bash
# 终端 1：启动前端 + API
pnpm dev:web

# 终端 2：启动抓取 Worker
pnpm dev:fetcher
```

访问 http://localhost:3000 查看首页。管理后台入口为 http://localhost:3000/fish（也可在首页点击页头 "TouchFish News" 文字 3 次进入）。

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
```

### 4. 部署

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

- 首页按 priority 排序展示资讯源；最新文章发布时间距今超过 30 天（或无文章）的源会被自动收起到主网格下方的「加载更多」折叠区块，点击展开后与正常卡片同等展示。
- 管理后台入口为 `/fish`（首页页头 "TouchFish News" 文字连点 3 次也可进入），默认无认证，适合个人使用。如需保护，可在 Cloudflare 控制台为 Pages 域名启用 **Cloudflare Access**。
- 后台「更新」与「更新全部」**不直接同步抓取**，而是向 Queue 投递消息，由 fetcher worker 异步消费（抓取 + DeepL 翻译 + 入库）。触发后前端约 8–10 秒自动刷新文章列表。这样设计是为了规避 Pages 函数同步执行多 UA 回退导致的 30–40 秒 pending。
- 后台资讯源列表展示每行 ID，支持复选框多选后**批量启用 / 批量停用 / 批量删除**（删除带二次确认，相关文章随 FK cascade 一并清除）。
- DeepL 免费版每月 50 万字符额度；若翻译调用频繁，可关注用量或关闭部分英文源的自动翻译。翻译失败时返回 `null`，前端自动回退显示原标题。
- Queue 消费失败会自动重试 3 次（配额类错误直接 ack 不重试），可在 Workers 日志中查看错误详情。
