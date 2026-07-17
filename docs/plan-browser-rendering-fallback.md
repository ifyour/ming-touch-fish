# 实施记录：Browser Rendering 第四层正文兜底 + 失败缓存

状态：已完成并部署验证

## 目标
在 `/api/articles/:id/summary` 现有三级回退（live → rss-content → rss-desc）后，
新增第四层：用 Cloudflare **Browser Run REST API** 真浏览器渲染抓正文，
治「实时抓取被反爬拦截、但内容其实是免费完整正文」的源（V2EX 等 JS 渲染/轻度反爬站）。

对经济学人这类源（bit.ly 短链 + 付费墙 + RSS 无正文），第一次仍会白跑一次浏览器
（超时不计费），之后 24h 内被失败缓存拦住，直接返回 422。

## 关键决策：不用 Pages Browser 绑定，改 REST API
- **Pages Functions 不支持 Browser 绑定**：在 `wrangler.toml` 加 `[browser] binding="BROWSER"` 会导致整个 worker 初始化崩溃、全站 500（已踩坑验证）。
- 故改为 **Browser Run REST API**：`POST https://api.cloudflare.com/client/v4/accounts/{accountId}/browser-rendering/markdown`，Header `Authorization: Bearer <token>`，body `{ url, gotoOptions: { waitUntil: "networkidle2", timeout: 30000 } }`，返回 `{ success, result }`，读响应头 `X-Browser-Ms-Used`。
- 所需环境变量（作为 Pages secret 配置，非绑定）：`CLOUDFLARE_API_TOKEN`（带 `Browser Rendering - Edit` 权限的 API Token）、`CLOUDFLARE_ACCOUNT_ID`（账户 ID）。任一缺失则静默跳过第四层。
- 计费：Free 计划每天 10 分钟浏览器时长免费，超出仅返回 429 限流、不扣费；失败请求不计费。

## 变更清单

### 1. apps/web/wrangler.toml
- **不**加 `[browser]` 绑定（会导致全站 500）。两个变量改走 Pages secret。

### 2. apps/web/app/server/types.ts
Bindings 加 `CLOUDFLARE_API_TOKEN?: string` 和 `CLOUDFLARE_ACCOUNT_ID?: string`（可选）。

### 3. apps/web/app/server/lib/extract.ts
新增 `extractArticleTextViaBrowser(apiToken, accountId, url)`：
- `fetch` 调 Browser Run REST API（见上），带 `Authorization: Bearer` 与 JSON body。
- 解析 `{ success, result }`，取 `result`（markdown），截断 `MAX_CHARS(8000)`。
- 读响应头 `X-Browser-Ms-Used` 返回（供日志）。
- `!success || !result` 时抛错。

### 4. apps/web/app/server/routes/articles.ts
在「三级都失败」判断之前插入第四层：
- `Stage` 类型加 `'browser'`；`STAGE_LABEL` 加 `browser: 'Browser Rendering 渲染抓取'`。
- `source` 联合类型加 `'browser'`。
- 第四层触发条件：前三级不足 && `c.env.CLOUDFLARE_API_TOKEN` && `c.env.CLOUDFLARE_ACCOUNT_ID` && `!recentlyFailed(metadata)`。
- try/catch：成功且 `isContentSufficient` → `text=t, source='browser'`，`logger.info` 记 `browserMsUsed`。
- 失败仅 `logger.warn`，继续走到 422。
- 进 422 分支前：读现有 metadata → merge `summaryFailedAt: Date.now()` → 写回 D1（保留 content/description）。

### 5. 失败缓存
- 常量 `SUMMARY_FAIL_TTL = 24*60*60*1000`。
- `recentlyFailed(metadata)`：读 `metadata.summaryFailedAt`，24h 内返回 true。
- 成本：每次彻底失败多 1 次 D1 write。

### 6. 文档同步（AGENTS.md / README.md）
- summary 流水线：三级 → 四级回退，新增 Browser Rendering 层及触发条件（REST API 方式）。
- Stage 诊断字段加 browser；回退日志 `source` 现含 `browser`。
- 失败缓存机制（metadata.summaryFailedAt，24h TTL）。
- 计费提示（Free 每天 10 分钟，超时不计费）。

## 不做
- 不做域名黑名单
- 不加 KV 层
- 不动 fetcher / Firecrawl
- 不改前端（第四层对前端透明，422/500 处理不变）

## 验证记录
1. `pnpm typecheck` / `pnpm lint` / `pnpm test` 全过。
2. 生产实测 Browser Run REST API 调用成功（flaviocopes 文章 `msUsed:1176ms`、`len:7684`、`sufficient:true`，拿到真实正文）。
3. 清掉某 NYT 文章的 `summaryFailedAt` 缓存后重新触发，stage 正确走到 `browser`（证明第四层触发逻辑生效）；NYT 最终 422 属付费墙正文不足的预期行为。
4. 普通文章（7281）总结仍正常返回 200，未受影响。

## 参考
- 计费：developers.cloudflare.com/browser-run/pricing/
- Browser Rendering Markdown API：developers.cloudflare.com/browser-rendering/rest-api/markdown/
