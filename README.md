# OpenTrends

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
- Docker Compose deployment for Postgres, RSSHub, API, migration, and web
- Void and Cloudflare/Alchemy deployment configs

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
- Docker, for the local Postgres/RSSHub stack
- PostgreSQL, if you do not use Docker Compose

## Local Development

Install dependencies:

```bash
bun install
```

Create local env files from the examples:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Start Postgres and run the app:

```bash
bun run db:start
bun run dev
```

The API runs on `http://localhost:3000`.
The web app runs on `http://localhost:3001`.

## Environment

Server env is validated in `apps/server/env.ts` and `packages/env/src/server.ts`.
At minimum, configure:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `CORS_ORIGIN`

Optional trend and summary settings include:

- `RSSHUB_BASE_URLS`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `TRENDS_REFRESH_SCHEDULER`

Web env is validated in `apps/web/env.ts`. Configure:

- `VITE_SERVER_URL`
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
bun run dev            # Start DB and all apps
bun run dev:web        # Start only the web app
bun run dev:server     # Start only the API
bun run db:start       # Start local database services
bun run db:migrate     # Apply Drizzle migrations
bun run db:generate    # Generate a Drizzle migration
bun run check-types    # Typecheck workspaces
bun test               # Run tests
bun run check          # Run Ultracite/Biome checks
bun run build          # Build workspaces
```

## Docker Compose

Copy the example Docker environment file and fill in `BETTER_AUTH_SECRET`:

```bash
cp .env.docker.example .env
perl -0pi -e "s|BETTER_AUTH_SECRET=|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" .env
```

For a public deployment, also replace the localhost values for
`BETTER_AUTH_URL`, `CORS_ORIGIN`, `VITE_SERVER_URL`, and `VITE_SITE_URL`.

Start the full stack:

```bash
docker compose up -d --build
```

This starts Postgres, RSSHub, a migration job, the API server, and the web app.

## Deployment

Void deployment configs live in `apps/server/void.json` and `apps/web/void.json`.
Deploy the API first, then deploy the web app with `VITE_SERVER_URL` pointing at
the API origin.

Cloudflare/Alchemy deployment lives in `packages/infra/alchemy.run.ts` and uses
secrets from the local environment or Alchemy secret env.

## License

MIT
