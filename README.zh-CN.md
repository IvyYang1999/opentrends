# OpenTrends

[English](README.md)

OpenTrends 是一个开源的 AI 趋势阅读应用，用于跟踪技术、AI、产品、金融、加密货币、中文互联网平台和开发者社区中的一手信息。

它可以追踪数百个主要信息源，将内容翻译成读者的母语，并快速总结变化，让你不需要在不同网站和语言之间频繁切换，也能阅读全球一手信息。

## 功能特性

- 面向数百个一手与官方信息源设计的精选主题页
- 支持 RSS、RSSHub、Hacker News、GitHub Trending、Reddit、Product Hunt、知乎、掘金、NewsNow、Kickstarter、Crowd Supply 和 Qwen Research 等适配器
- AI 翻译，方便用自己的语言阅读源内容
- AI 摘要，将噪声较多的源更新压缩成可读简报
- 跨语言主题页，便于跟踪全球信息流并保留原始来源上下文
- 信息源状态接口和按源配置的刷新行为
- 通过运行时 cache/KV 层和内存请求缓存加速热门趋势页
- Cloudflare D1、KV 和 Queues 原生运行时
- 使用 Alchemy 编排 Cloudflare 本地开发与部署

## 仓库结构

```text
opentrends/
├── apps/
│   ├── server/      # Hono API、趋势适配器、信息源刷新、摘要
│   ├── web/         # TanStack Start 前端
│   └── fumadocs/    # 文档应用实验
├── packages/
│   ├── api/         # oRPC 路由层
│   ├── auth/        # Better Auth 配置
│   ├── config/      # 共享 TypeScript 配置
│   ├── db/          # Drizzle schema、迁移、开发数据库工具
│   ├── env/         # 共享环境变量校验
│   ├── infra/       # Cloudflare/Alchemy 部署入口
│   └── ui/          # 共享 shadcn/ui 组件与样式
└── docs/            # 设计与实现说明
```

## 环境要求

- Bun 1.3.x
- 一个 Cloudflare 账号（仅云端部署时需要）

## 本地开发

安装依赖并创建本地环境变量文件：

```bash
bun install --frozen-lockfile
cp apps/server/.env.example apps/server/.env.local
cp apps/web/.env.example apps/web/.env.local
cp packages/infra/.env.example packages/infra/.env.local
```

为 `BETTER_AUTH_SECRET` 填入本地随机值。Alchemy 还需要
`ALCHEMY_PASSWORD` 来加密本地状态；请通过密码管理工具或临时环境变量注入，
不要提交到仓库。Infra 示例中的 Cloudflare 值只用于本地 Miniflare，不具备线上权限。

启动本地 Cloudflare 栈：

```bash
bun run dev
```

API 运行在 `http://localhost:3000`。
Web 应用运行在 `http://localhost:3001`。
Alchemy 会在本地创建 D1、KV 和 Queues，并自动把全新的 D1 schema 应用到空数据库；
不会导入旧 PostgreSQL 数据。

## 环境变量

服务端环境变量在 `packages/env/src/server.ts` 中校验。至少需要配置：

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `CORS_ORIGIN`

可选的趋势与摘要配置包括：

- `RSSHUB_BASE_URLS`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `TRENDS_REFRESH_SCHEDULER`

Alchemy 会为 Web 注入 `VITE_SERVER_URL`。按需配置：

- `VITE_SITE_URL`

## 缓存

趋势页使用短时内存缓存，以及 `apps/server/src/trends/cache/hot-cache.ts` 中的共享 hot cache/KV 抽象。信息源快照通过 source cache 层存储。

仓库中没有提交启动用的基础数据缓存。运行时数据应由刷新任务或请求生成，并写入配置好的缓存/存储后端。

## 常用命令

```bash
bun run dev            # 启动本地 D1、KV、Queues、API 和 Web
bun run db:generate    # 生成 Drizzle 迁移
bun run check-types    # 检查各 workspace 类型
bun test               # 运行测试
bun run check          # 运行 Ultracite/Biome 检查
bun run build          # 构建各 workspace
```

## 部署

Cloudflare/Alchemy 部署入口位于 `packages/infra/alchemy.run.ts`。先使用
`bun run cloudflare:login` 完成 Cloudflare 授权，再通过安全的凭据注入方式配置生产环境变量，
最后运行 `bun run --filter @opentrends/infra deploy`。该定义不会修改域名或 DNS。

## 许可证

MIT
