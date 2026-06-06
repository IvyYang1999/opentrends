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
- Docker Compose 部署 Postgres、RSSHub、API、迁移任务和 Web
- Void 与 Cloudflare/Alchemy 部署配置

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
- Docker，用于本地 Postgres/RSSHub 栈
- PostgreSQL，如果不使用 Docker Compose

## 本地开发

安装依赖：

```bash
bun install
```

从示例文件创建本地环境变量文件：

```bash
cp apps/server/.env.example apps/server/.env.local
cp apps/web/.env.example apps/web/.env.local
```

启动 Postgres 并运行应用：

```bash
bun run db:start
bun run dev
```

API 运行在 `http://localhost:3000`。
Web 应用运行在 `http://localhost:3001`。

## 环境变量

服务端环境变量在 `apps/server/env.ts` 和 `packages/env/src/server.ts` 中校验。至少需要配置：

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `CORS_ORIGIN`

可选的趋势与摘要配置包括：

- `RSSHUB_BASE_URLS`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `TRENDS_REFRESH_SCHEDULER`

Web 环境变量在 `apps/web/env.ts` 中校验。需要配置：

- `VITE_SERVER_URL`
- `VITE_SITE_URL`

## 缓存

趋势页使用短时内存缓存，以及 `apps/server/src/trends/cache/hot-cache.ts` 中的共享 hot cache/KV 抽象。信息源快照通过 source cache 层存储。

仓库中没有提交启动用的基础数据缓存。运行时数据应由刷新任务或请求生成，并写入配置好的缓存/存储后端。

## 常用命令

```bash
bun run dev            # 启动数据库和所有应用
bun run dev:web        # 只启动 Web 应用
bun run dev:server     # 只启动 API
bun run db:start       # 启动本地数据库服务
bun run db:migrate     # 应用 Drizzle 迁移
bun run db:generate    # 生成 Drizzle 迁移
bun run check-types    # 检查各 workspace 类型
bun test               # 运行测试
bun run check          # 运行 Ultracite/Biome 检查
bun run build          # 构建各 workspace
```

## Docker Compose

复制 Docker 环境变量示例文件，并填写 `BETTER_AUTH_SECRET`：

```bash
cp .env.docker.example .env
perl -0pi -e "s|BETTER_AUTH_SECRET=|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" .env
```

如果是公开部署，还需要把 `BETTER_AUTH_URL`、`CORS_ORIGIN`、`VITE_SERVER_URL` 和 `VITE_SITE_URL` 中的 localhost 替换成真实的 API/Web 访问地址。

启动完整服务栈：

```bash
docker compose up -d --build
```

这会启动 Postgres、RSSHub、迁移任务、API 服务和 Web 应用。

## GitHub Container Registry 镜像

仓库包含一个 GitHub Actions workflow，用于构建两个 Docker 镜像并发布到 GitHub Container Registry：

- `ghcr.io/nexmoe/opentrends-server`
- `ghcr.io/nexmoe/opentrends-web`

该 workflow 会在 pull request、推送到 `main`、推送 `v1.0.0` 这类版本标签，以及手动触发时运行。Pull request 只构建镜像，不推送。推送到 `main` 会发布 `main`、`latest` 和 `sha-<commit>` 标签。版本标签会发布对应的镜像标签。

发布的 Web 镜像默认使用以下构建参数：

- `VITE_SERVER_URL=http://localhost:3000`
- `VITE_SITE_URL=http://localhost:3001`

如果要为公开部署地址构建镜像，请在运行 workflow 前设置名为 `VITE_SERVER_URL` 和 `VITE_SITE_URL` 的仓库变量。

拉取已发布的镜像：

```bash
docker pull ghcr.io/nexmoe/opentrends-server:latest
docker pull ghcr.io/nexmoe/opentrends-web:latest
```

如需在 Compose 中使用已发布镜像，可以创建单独的覆盖文件来替换 `server`、`migrate` 和 `web` 的镜像名：

```yaml
# docker-compose.ghcr.yml
services:
  migrate:
    image: ghcr.io/nexmoe/opentrends-server:latest
    build: !reset null

  server:
    image: ghcr.io/nexmoe/opentrends-server:latest
    build: !reset null

  web:
    image: ghcr.io/nexmoe/opentrends-web:latest
    build: !reset null
```

然后用现有 Compose 文件加覆盖文件启动服务栈：

```bash
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d
```

这样会保留仓库中已有的 Postgres、RSSHub、迁移任务、API 和 Web 服务编排配置，同时把本地构建的应用镜像替换为 GHCR 镜像。环境变量仍按 `.env.docker.example` 中的说明配置。

## 部署

Void 部署配置位于 `apps/server/void.json` 和 `apps/web/void.json`。先部署 API，再部署 Web 应用，并让 `VITE_SERVER_URL` 指向 API 访问地址。

Cloudflare/Alchemy 部署位于 `packages/infra/alchemy.run.ts`，使用本地环境变量或 Alchemy secret env 中的密钥。

## 许可证

MIT
