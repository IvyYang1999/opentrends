# OpenTrends

[简体中文](README.zh-CN.md)

OpenTrends is an open-source AI trend-reading app for following first-party
information across technology, AI, product, finance, crypto, Chinese web
platforms, and developer communities.

It is designed to track hundreds of primary sources, translate them into the
reader's native language, and quickly summarize what changed so you can read
global first-hand information without switching context across sites and
languages.

## Features

- Curated topic pages designed for hundreds of first-party and official sources
- RSS, RSSHub, Hacker News, GitHub Trending, Reddit, Product Hunt, Zhihu, Juejin,
  NewsNow, Kickstarter, Crowd Supply, and Qwen Research adapters
- AI translation for reading source material in your native language
- Fast AI summaries that condense noisy source updates into a readable brief
- Cross-language topic pages for following global information flows without
  losing the original source context
- Source status endpoints and per-source refresh behavior
- Hot trend page caching through the runtime cache/KV layer plus in-memory
  request caching
- Native Cloudflare D1, KV, and Queues runtime
- Alchemy-managed local Cloudflare development and deployment

## Repository Layout

```text
opentrends/
├── apps/
│   ├── server/      # Hono API, trend adapters, source refresh, summaries
│   ├── web/         # TanStack Start frontend
│   └── fumadocs/    # Documentation app experiments
├── packages/
│   ├── api/         # oRPC router layer
│   ├── auth/        # Better Auth config
│   ├── config/      # Shared TypeScript config
│   ├── db/          # Drizzle schema, migrations, dev DB helpers
│   ├── env/         # Shared env validation
│   ├── infra/       # Cloudflare/Alchemy deployment entrypoint
│   └── ui/          # Shared shadcn/ui components and styles
└── docs/            # Design and implementation notes
```

## Requirements

- Bun 1.3.x
- A Cloudflare account (only required for cloud deployment)

## Local Development

Install dependencies:

```bash
bun install --frozen-lockfile
cp apps/server/.env.example apps/server/.env.local
cp apps/web/.env.example apps/web/.env.local
cp packages/infra/.env.example packages/infra/.env.local
```

Set `BETTER_AUTH_SECRET` to a random local value. Alchemy also needs
`ALCHEMY_PASSWORD` to encrypt local state; inject it through a password manager
or a temporary environment variable and never commit it. The Cloudflare values
in the infra example are local Miniflare placeholders with no cloud access.

Start the local Cloudflare stack:

```bash
bun run dev
```

The API runs on `http://localhost:3000`.
The web app runs on `http://localhost:3001`.
Alchemy creates local D1, KV, and Queues resources and applies the fresh D1
schema to an empty database. No PostgreSQL data is imported.

## Environment

Server env is validated in `packages/env/src/server.ts`.
At minimum, configure:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `CORS_ORIGIN`

Optional trend and summary settings include:

- `RSSHUB_BASE_URLS`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `TRENDS_REFRESH_SCHEDULER`

Alchemy injects `VITE_SERVER_URL` into the web app. Optionally configure:

- `VITE_SITE_URL`

## Caching

Trend pages use a short in-memory cache and the shared hot cache/KV abstraction
in `apps/server/src/trends/cache/hot-cache.ts`. Source snapshots are stored
through the source cache layer.

There is no checked-in bootstrap data cache. Runtime data should be generated
by refresh jobs or requests and stored through the configured cache/storage
backend.

## Useful Commands

```bash
bun run dev            # Start local D1, KV, Queues, API, and web
bun run db:generate    # Generate a Drizzle migration
bun run check-types    # Typecheck workspaces
bun test               # Run tests
bun run check          # Run Ultracite/Biome checks
bun run build          # Build workspaces
```

## Deployment

The Cloudflare/Alchemy entrypoint is `packages/infra/alchemy.run.ts`. Run
`bun run cloudflare:login`, inject production configuration securely, then run
`bun run --filter @opentrends/infra deploy`. The definition does not modify the
domain or DNS.

## License

MIT
