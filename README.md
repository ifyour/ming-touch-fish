# Cloudflare 个人资讯聚合站点

基于 Cloudflare 全家桶（Pages / Workers / D1 / Queues / Workers AI）的个人资讯聚合应用。

## 技术栈

- **前端**：TanStack Start + Mantine v7
- **后端 API**：Hono（通过 TanStack Start API 通配路由挂载）
- **数据库**：Cloudflare D1 + Drizzle ORM
- **定时抓取**：Cloudflare Workers + Cron Triggers + Queues
- **翻译**：Cloudflare Workers AI（`@cf/meta/m2m100-1.2b`）

## 项目结构

```
.
├── apps/
│   ├── web/          # TanStack Start 前端 + Hono API（Cloudflare Pages）
│   └── fetcher/      # 定时抓取 Worker（Cloudflare Workers）
├── packages/
│   ├── db/           # Drizzle schema + D1 client
│   └── shared/       # 共享类型与工具
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

### 4. 启动服务

```bash
# 终端 1：启动前端 + API
pnpm dev:web

# 终端 2：启动抓取 Worker
pnpm dev:fetcher
```

访问 http://localhost:3000 查看首页，http://localhost:3000/admin 管理资讯源。

## 生产部署

### 1. 准备 Cloudflare 资源

- 在 Cloudflare 控制台创建 D1 数据库 `news-aggregator`，复制 database_id。
- 创建 Queue `news-fetch-queue`。
- 在两个 `wrangler.toml` 中填入 production 与 preview 的 database_id。

### 2. 应用数据库迁移

```bash
wrangler d1 migrations apply news-aggregator --remote
```

### 3. 部署

```bash
# 部署抓取 Worker
pnpm deploy:fetcher

# 部署前端 + API
pnpm deploy:web
```

## 默认资讯源建议

在 `/admin` 页面添加以下 RSS 源：

| 名称 | RSS URL |
|------|---------|
| Hacker News | https://news.ycombinator.com/rss |
| TechCrunch | https://techcrunch.com/feed/ |
| The Verge | https://www.theverge.com/rss/index.xml |
| Reddit /r/programming | https://www.reddit.com/r/programming/.rss |
| 阮一峰的网络日志 | https://www.ruanyifeng.com/blog/atom.xml |
| InfoQ 中文 | https://www.infoq.cn/feed |

## 注意事项

- 管理界面默认无认证，适合个人使用。如需保护，可在 Cloudflare 控制台为 Pages 域名启用 **Cloudflare Access**。
- Workers AI 免费额度为每日 10,000 neurons；若翻译调用频繁，可关注用量或关闭部分英文源的自动翻译。
- Queue 消费失败会自动重试 3 次，可在 Workers 日志中查看错误详情。
