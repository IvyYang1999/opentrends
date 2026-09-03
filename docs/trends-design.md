# OpenTrends Trends Page and Source Preset Design

> **Historical document (2026-05).** This design predates the migration to
> Cloudflare Workers + D1. References to PostgreSQL, Hyperdrive, and a
> Postgres-backed `packages/db` no longer match the code: the runtime now uses
> Cloudflare D1 (SQLite via Drizzle, see `packages/db/src/schema/trends.ts`),
> KV for the hot cache, and Queues for async work, all declared in
> `packages/infra/alchemy.run.ts`. The route layout, adapter contract, and
> topic/source preset model described below are still accurate.

This document defines the v1 trends feature for the current OpenTrends repository.

The architecture boundary is explicit:

- `apps/server` owns all API routes, source fetching, cache reads/writes, refresh locks, and trends services.
- `apps/web` only performs server rendering and UI presentation. It should not own source logic, API handlers, cache logic, or refresh logic.
- `packages/db` owns Drizzle/Postgres schema and database exports.
- `packages/ui` can provide shared UI primitives.

## Goals

- Build a public trends experience with no user accounts, subscriptions, source editing, or admin UI.
- Ship one general hot page at `/trends`.
- Ship fixed topic pages such as `/trends/ai` and `/trends/tech`.
- Keep all topics and sources as code presets.
- Support native adapters, preset RSSHub routes, and optional RSS feeds.
- Cache per source so slow or broken upstreams do not block the whole page.
- Keep all trends API and source service code inside `apps/server`.

## Non-Goals

- No user-created sources.
- No custom RSS URL input.
- No source marketplace.
- No personalized ordering.
- No global mixed ranking algorithm in v1.
- No full source health dashboard in v1.
- No trends API definitions in `apps/web`.

## Browser Routes

```txt
/trends          General hot page
/trends/ai       AI topic page
/trends/tech     Technology topic page
```

Implementation files:

```txt
apps/web/src/routes/trends.tsx
apps/web/src/routes/trends.$topic.tsx
```

`/trends` is the canonical hot page. `/trends/hot` can redirect to `/trends` later if a topic-like URL is useful.

Unknown topic slugs should render the app's normal not-found state instead of falling back to the hot page. This makes missing preset configuration obvious.

## Server API Routes

All trends API routes live in `apps/server`.

```txt
GET /api/trends          Returns the general hot page data
GET /api/trends/:topic   Returns a preset topic page
```

Suggested Hono wiring:

```ts
// apps/server/src/routes/trends.ts
import { Hono } from "hono";

import { getTrendsPage } from "../trends/services/get-trends-page";

export const trendsRoutes = new Hono()
  .get("/", async (c) => {
    const page = await getTrendsPage("hot");
    return c.json(page);
  })
  .get("/:topic", async (c) => {
    const page = await getTrendsPage(c.req.param("topic"));
    return c.json(page);
  });
```

```ts
// apps/server/src/index.ts
import { trendsRoutes } from "./routes/trends";

app.route("/api/trends", trendsRoutes);
```

The existing oRPC setup can remain for existing features, but the trends interface itself should be implemented in `apps/server` to match the requested boundary.

## Web Data Loading

`apps/web` should render pages from server-provided data. It should not contain source adapters, cache decisions, or API route definitions.

Topic routes should prefetch their React Query data in the TanStack route loader so SSR emits real source cards instead of a loading shell. Keep the first response lightweight by requesting the preview item count; source dialogs can fetch the full source list on demand.

The route loader can fetch from `apps/server`:

```ts
// apps/web/src/routes/trends.$topic.tsx
export const Route = createFileRoute("/trends/$topic")({
  loader: async ({ params }) => {
    const response = await fetch(`${env.VITE_SERVER_URL}/api/trends/${params.topic}`);
    if (!response.ok) {
      throw new Error("Failed to load trends page");
    }
    return response.json() as Promise<TrendsPageData>;
  },
  component: TrendsTopicPage,
});
```

The component should only render `TrendsPageData`. Client-side refetching can be added later, but it should still call `apps/server` APIs.

## Page Response Model

The API should return fully materialized source cards. Preset config can contain source IDs, but the response should not require the browser to fetch each source separately.

```ts
type TopicId = "hot" | "ai" | "tech";
type SourceId = string;

interface TrendsPageData {
  id: TopicId;
  title: string;
  description?: string;
  updatedAt: number;
  sections: TrendsSectionData[];
}

interface TrendsSectionData {
  id: string;
  title: string;
  sources: SourceCardData[];
}

interface SourceCardData {
  sourceId: SourceId;
  title: string;
  homeUrl?: string;
  status: "ok" | "stale" | "error";
  updatedAt?: number;
  errorMessage?: string;
  items: NewsItem[];
}
```

V1 should render cards grouped by source. Do not build one global mixed feed until ranking and deduplication are product requirements.

## Preset Configuration

Topics and sources are static TypeScript config in `apps/server`. They are not database records in v1.

```ts
// apps/server/src/trends/config/sources.ts
export const sourcePresets = {
  "zhihu-hot": {
    name: "Zhihu Hot",
    provider: "native",
    adapter: "zhihuHot",
    refresh: "hot",
  },
  "hackernews": {
    name: "Hacker News",
    provider: "native",
    adapter: "hackerNews",
    refresh: "community",
  },
  "github-trending": {
    name: "GitHub Trending",
    provider: "native",
    adapter: "githubTrending",
    refresh: "daily",
  },
  "producthunt": {
    name: "Product Hunt",
    provider: "native",
    adapter: "productHunt",
    refresh: "daily",
  },
  "juejin-hot": {
    name: "Juejin Hot",
    provider: "native",
    adapter: "juejinHot",
    refresh: "community",
  },
  "rsshub-ai-papers": {
    name: "AI Papers",
    provider: "rsshub",
    route: "TODO_SELECT_RSSHUB_ROUTE",
    refresh: "slow",
  },
} as const;
```

```ts
// apps/server/src/trends/config/topics.ts
export const topicPresets = {
  hot: {
    path: "/trends",
    title: "Hot",
    sections: [
      {
        id: "default",
        title: "Hot Now",
        sourceIds: [
          "zhihu-hot",
          "hackernews",
          "github-trending",
          "producthunt",
          "juejin-hot",
        ],
      },
    ],
  },
  ai: {
    path: "/trends/ai",
    title: "AI",
    sections: [
      {
        id: "default",
        title: "AI Trends",
        sourceIds: [
          "rsshub-ai-papers",
        ],
      },
    ],
  },
  tech: {
    path: "/trends/tech",
    title: "Tech",
    sections: [
      {
        id: "default",
        title: "Tech Trends",
        sourceIds: [
          "hackernews",
          "github-trending",
          "juejin-hot",
          "producthunt",
        ],
      },
    ],
  },
} as const;
```

The `TODO_SELECT_RSSHUB_ROUTE` values must be replaced before implementation. They are explicit TODOs, not fake working routes.

## Source Provider Types

### Native

Native sources use hand-written adapters for APIs or HTML pages that are worth supporting directly.

Initial native candidates:

- Zhihu hot list.
- Hacker News front page.
- GitHub Trending.
- Product Hunt.
- Juejin hot articles.

Topic-specific cuts of a source should rely on the upstream's own categorization (tag feeds, subreddits, RSSHub topic routes, ArXiv categories, etc.) rather than client-side keyword filtering.

### RSSHub

RSSHub sources use one shared adapter. Each preset specifies a route and optional params.

```ts
interface RssHubSourcePreset {
  provider: "rsshub";
  name: string;
  route: string;
  params?: Record<string, string | number | boolean>;
  refresh: RefreshPolicyId;
}
```

The adapter should try configured RSSHub base URLs in order with `format=json`, then normalize the JSON feed response into `NewsItem[]`.

`RSSHUB_BASE_URLS` should live in `packages/env/src/server.ts` so `apps/server` can validate it with the rest of the server environment.

### RSS

Plain RSS can be supported with the same output contract. It is optional for v1, but the abstraction is useful for official blogs and release feeds.

## Adapter Contract

All adapters return normalized items. Page rendering should never depend on upstream-specific fields.

```ts
interface SourceAdapter {
  fetch(ctx: FetchContext): Promise<NewsItem[]>;
}

interface FetchContext {
  sourceId: SourceId;
  signal: AbortSignal;
}

interface NewsItem {
  id: string;
  sourceId: SourceId;
  title: string;
  url: string;
  rank?: number;
  hotValue?: string | number;
  publishedAt?: number;
  fetchedAt: number;
}
```

Adapter rules:

- Always provide a stable `id`.
- Prefer canonical item URL as the item identity.
- Return at most 30 items.
- Drop empty titles and invalid URLs.
- Do not throw for individual malformed items; skip them.
- Throw only when the whole source fetch is unusable.
- Respect `AbortSignal` so request-triggered refreshes do not hang forever.

## Database Schema

The current repo uses Drizzle with PostgreSQL, so trends cache tables should be Drizzle `pgTable` definitions in `packages/db/src/schema/trends.ts`.

```ts
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const source = pgTable("source", {
  sourceId: text("source_id").primaryKey(),
  status: text("status").notNull(),
  generation: integer("generation").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  staleUntil: timestamp("stale_until", { withTimezone: true }),
  itemCount: integer("item_count").notNull(),
  errorCount: integer("error_count").notNull(),
  lastError: text("last_error"),
  refreshOwner: text("refresh_owner"),
  refreshLockedUntil: timestamp("refresh_locked_until", { withTimezone: true }),
});

export const sourceItem = pgTable("source_item", {
  sourceId: text("source_id").notNull(),
  itemId: text("item_id").notNull(),
  generation: integer("generation").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  rank: integer("rank").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  contentHash: text("content_hash").notNull(),
  hotValue: jsonb("hot_value"),
  original: jsonb("original"),
});
```

Export the tables from `packages/db/src/schema/index.ts`, then generate or push through the existing Drizzle scripts.

## Cache Semantics

Cache per source, not per route. Topic pages can share snapshots because the same source can appear in multiple topics.

```ts
interface SourceState {
  sourceId: SourceId;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
  status: "ok" | "stale" | "error";
  errorCount: number;
  lastError?: string;
}
```

Use named refresh policies to keep source presets compact.

```ts
export const refreshPolicies = {
  hot: {
    softTtlMs: 5 * 60_000,
    staleTtlMs: 6 * 60 * 60_000,
    timeoutMs: 8_000,
  },
  community: {
    softTtlMs: 10 * 60_000,
    staleTtlMs: 6 * 60 * 60_000,
    timeoutMs: 8_000,
  },
  rss: {
    softTtlMs: 30 * 60_000,
    staleTtlMs: 24 * 60 * 60_000,
    timeoutMs: 8_000,
  },
  daily: {
    softTtlMs: 12 * 60 * 60_000,
    staleTtlMs: 48 * 60 * 60_000,
    timeoutMs: 8_000,
  },
  slow: {
    softTtlMs: 2 * 60 * 60_000,
    staleTtlMs: 48 * 60 * 60_000,
    timeoutMs: 8_000,
  },
} as const;
```

## Request Flow

For `GET /api/trends/:topic` in `apps/server`:

1. Resolve the topic from `topicPresets`.
2. Load `source` rows and the current-generation `source_item` rows for all source IDs in the topic sections.
3. For fresh sources, return cached data.
4. For stale sources within `staleUntil`, return stale data and trigger a locked background refresh.
5. For missing or expired sources, try one short synchronous refresh with a per-source lock.
6. If a source still fails, return an empty source card with `status: "error"` and keep the rest of the page usable.
7. Return a fully materialized `TrendsPageData`.

Use `Promise.allSettled` when assembling source cards so one failed source cannot reject the whole page.

## Refresh Locking

Per-source locks are part of v1 because request-triggered refresh is part of v1.

Lock rules:

- Before refresh, acquire ownership by conditionally updating the `source` row when `refresh_locked_until` is missing or expired.
- Set `refresh_owner` and `refresh_locked_until` to `now + timeoutMs + smallGraceMs`.
- If lock acquisition fails, return existing snapshot and let the in-flight refresh finish.
- Always release or overwrite the lock after the refresh attempt.
- If a process dies, `refresh_locked_until` lets another request recover later.

## Background Refresh

V1 can use request-triggered refresh only:

- If a snapshot is fresh, do nothing.
- If a snapshot is stale and lock acquisition succeeds, start a refresh after preparing the response.
- If a snapshot is missing or beyond `staleUntil`, refresh synchronously with a short timeout.

The current server is a Hono app running in Bun/Node, so request-triggered background work is acceptable for v1. If the deployment target changes to an edge runtime, the refresh service should be revisited for `waitUntil` support.

Cron can be added later if traffic is high enough:

- Every 5 minutes, refresh due `hot` and `community` sources.
- Every 30 minutes, refresh due `rss` sources.
- Every 2 hours, refresh due `slow` sources.
- Every 12 hours, refresh due `daily` sources.

## Proposed File Layout

```txt
apps/server/src/routes/
  trends.ts

apps/server/src/trends/
  adapters/
    native/
      github-trending.ts
      hacker-news.ts
      juejin-hot.ts
      producthunt.ts
      zhihu-hot.ts
    rss.ts
    rsshub.ts
  cache/
    source-cache.ts
    source-lock.ts
  config/
    refresh-policies.ts
    sources.ts
    topics.ts
  services/
    get-trends-page.ts
    refresh-source.ts
  types.ts

packages/db/src/schema/
  trends.ts
  index.ts

apps/web/src/routes/
  trends.tsx
  trends.$topic.tsx
```

## Initial Topic Presets

### Hot

General hot page:

- Zhihu Hot.
- Hacker News.
- GitHub Trending.
- Product Hunt.
- Juejin Hot.

### AI

AI topic page:

- RSSHub AI news route.
- RSSHub AI papers route.
- Hacker News AI filtered preset.
- GitHub AI filtered preset.
- Product Hunt AI filtered preset.

### Tech

Technology topic page:

- Hacker News.
- GitHub Trending.
- Juejin Hot.
- Product Hunt.

## Implementation Milestones

1. Add Drizzle Postgres tables in `packages/db/src/schema/trends.ts`.
2. Add trends types, source presets, topic presets, and refresh policies in `apps/server/src/trends`.
3. Add source snapshot cache and source refresh lock helpers in `apps/server`.
4. Add native adapters for 3 to 5 stable sources in `apps/server`.
5. Add RSSHub adapter and replace RSSHub route TODOs with selected preset routes.
6. Add `getTrendsPage(topicId)` and `refreshSource(sourceId)` services.
7. Add `apps/server/src/routes/trends.ts` and mount it in `apps/server/src/index.ts`.
8. Add TanStack Start routes for `/trends` and `/trends/$topic`.
9. Add lightweight adapter tests with fixture responses.

## Design Decisions

- Use preset config only in v1. Dynamic sources add product and security complexity that is not needed yet.
- Put all trends interfaces and server-side source logic in `apps/server`.
- Keep `apps/web` focused on server rendering and UI display.
- Use Drizzle/Postgres because the current `packages/db` package is Postgres-backed.
- Cache source snapshots instead of full pages so multiple topics can reuse the same data.
- Return source cards in the page response to avoid frontend N+1 source calls.
- Render by source card instead of global mixed ranking to avoid premature ranking and deduplication logic.
- Treat RSSHub as a provider behind presets, not as a user-facing subscription editor.
- Prefer stale data over a slow page. A trends page with one stale card is better than a page blocked by one broken upstream.
