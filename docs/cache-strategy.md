# OpenTrends Cache Strategy

This document defines a KISS cache strategy for OpenTrends. The goal is to use Void where it clearly improves request performance, while keeping the durable trends model understandable and Docker-compatible.

## Goal

Keep the system simple:

- Use a normalized durable model for source state and source items.
- Add one shared hot-cache layer for derived public read results.
- Use Void runtime features when available.
- Keep Docker running without extra required services.

The main problem is not PostgreSQL itself. The problem is treating source data as an opaque snapshot blob and treating refresh locks as a separate cache-like concept. Source state and source items are real materialized data and should be modeled directly.

## Current State

The trends feature now uses:

- Process memory cache for assembled trends pages and source status.
- PostgreSQL `source` rows for source runtime state and refresh ownership.
- PostgreSQL `source_item` rows for durable source items.
- PostgreSQL rows for summaries and translations.
- Bundled bootstrap JSON as a last-resort fallback.
- `Cache-Control` headers, and some `caches.default` usage for sources.
- A refresh scheduler that works in Docker.

The older `source_snapshot` JSONB blob and `source_refresh_lock` table were migration scaffolding. They should not remain in the target schema after the normalized tables are live.

## Target Design

Use four layers:

1. Browser/CDN cache through `Cache-Control`.
2. Worker response cache through `caches.default` when running on Void/Cloudflare.
3. Shared hot cache for derived JSON results.
4. Normalized durable SQL tables plus bundled bootstrap JSON as fallback.

Do not add R2, D1, Queues, cron, Redis, or Dragonfly as required parts of this design. They can be reconsidered later, but they are not needed for the core model.

## Durable Data Model

Use a small normalized SQL model for trends source state.

### `source`

One row per configured source. Static source configuration can remain in code; this table stores runtime state.

Missing rows should be created lazily from the static source config during startup, status reads, or the first refresh. This keeps source definitions in one place while making runtime state queryable.

Suggested fields:

- `source_id` primary key
- `status`
- `generation`
- `fetched_at`
- `last_success_at`
- `expires_at`
- `stale_until`
- `item_count`
- `error_count`
- `last_error`
- `refresh_owner`
- `refresh_locked_until`
- `created_at`
- `updated_at`

The refresh lock lives on this row. Refresh ownership is acquired with an atomic conditional update where `refresh_locked_until` is null or expired. This keeps the lock next to the state it protects and removes the need for a separate `source_refresh_lock` table in the target model.

`generation` identifies the current successful item set. Every successful refresh increments it, writes item rows with the same generation, and updates the source row to that generation. Readers use this value to avoid mixing old and new item rows.

### `source_item`

One row per latest item seen for a source.

Suggested fields:

- `source_id`
- `item_id`
- `generation`
- `url`
- `title`
- `description`
- `image_url`
- `rank`
- `published_at`
- `fetched_at`
- `last_seen_at`
- `content_hash`

Primary key: `(source_id, item_id)`.

Indexes:

- `(source_id, generation, rank)`
- `(source_id, fetched_at)`
- `(source_id, published_at)`

Keep only what the trends page needs plus metadata useful for dedupe, translation, and debugging. Old items can be cleaned by `last_seen_at`, by old generations, or capped per source.

### Existing durable tables

Keep summary and translation persistence:

- `trends_summary`
- `source_item_translation`

These are expensive computed artifacts and should survive cache eviction.

## Store Responsibilities

| Data | Target store | Notes |
| --- | --- | --- |
| Complete public trends response | `Cache-Control` + optional `caches.default` | Only cache public GET responses. |
| Assembled trends page by topic/lang/mode | Shared hot cache | Main optimization; avoids repeated page assembly and SQL reads. |
| Sources status response | Shared hot cache or `caches.default` | Short TTL; derived from `source`. |
| Source runtime state | `source` | Durable, inspectable, includes refresh lock fields. |
| Source latest items | `source_item` | Durable materialized item rows, not JSONB blob cache. |
| LLM summary | Existing memory + durable SQL | Can be front-cached later, but not required for this design. |
| Item translation | `source_item_translation` | Durable cost-saving persistence keyed by source item. |
| Bootstrap fallback | Bundled JSON | Keep current fallback. |

The old `source_snapshot` and `source_refresh_lock` tables should be dropped after data has been migrated into `source` and `source_item`.

## Shared Hot Cache

Introduce one small interface:

```ts
interface HotCache {
  get<T>(key: string): Promise<CacheEnvelope<T> | null>;
  put<T>(key: string, value: CacheEnvelope<T>, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CacheEnvelope<T> {
  value: T;
  createdAt: number;
  freshUntil: number;
  staleUntil: number;
  schemaVersion: number;
}
```

Runtime adapters:

- Void: KV-backed hot cache when the `KV` binding is configured.
- Docker/dev: memory hot cache by default.

The service code should depend on `HotCache`, not on Void APIs directly. If KV is unavailable or fails, the request should fall back to memory/SQL/bootstrap behavior.

`HotCache` is the application cache. `caches.default` is only an outer HTTP response cache for safe public GET responses. If both are present, `caches.default` is checked first and populated from the same response generated by the service.

Use a small per-process in-flight map for page rebuilds so concurrent misses or stale refreshes for the same key share one rebuild promise instead of all querying SQL at once.

## Cache Keys

Use explicit versioned keys:

```txt
trends:v4:page:{topic}:{lang}:{translationMode}
trends:v4:sources-status
```

Keep key scope small. Do not add source item cache keys in this design; source items are durable SQL rows.

## Read Path

### `GET /api/trends/:topic`

1. Browser/CDN may serve the response through `Cache-Control`.
2. Void may serve a complete response from `caches.default`.
3. Server checks `trends:v4:page:{topic}:{lang}:{translationMode}` in `HotCache`.
4. Fresh cache returns immediately with `X-Trends-Cache: hit`.
5. Stale cache returns immediately with `X-Trends-Cache: stale`; Void can use `waitUntil` to refresh the assembled page in the background.
6. Miss builds the page from `source` and top `source_item` rows for the configured source IDs, filtering items by each source's current `generation`.
7. Built page is written to `HotCache` and, on Void, optionally to `caches.default`.
8. If SQL reads fail, return stale HotCache data or bundled bootstrap data.

### `GET /api/sources`

1. Keep existing config/status behavior.
2. Check `trends:v4:sources-status` in `HotCache` or `caches.default`.
3. On miss, compute from `source`.
4. Store with a short TTL.

### `GET /api/trends/:topic/summary`

Keep current memory + durable SQL behavior. Summary generation is a separate latency problem and should not be folded into the first cache design.

## Refresh Behavior

Keep the current refresh execution model, but write to normalized tables:

1. Scheduler selects a source to refresh.
2. Refresh service atomically acquires ownership by updating `source.refresh_owner` and `refresh_locked_until` when the existing lock is expired.
3. Fetch upstream source items.
4. In a short transaction, increment the source generation, upsert latest items into `source_item` with that generation, update `source` status/timestamps/stale windows/item count, and clear the refresh lock.
5. On failure, update the `source` error fields and clear or expire the refresh lock without changing the current successful generation.
6. Clear affected assembled page cache keys if practical.
7. If precise invalidation is too expensive, rely on short page TTL and stale serving.

Do not keep the SQL transaction open while fetching upstream data. The transaction should cover only the local durable writes.

Void-specific improvement is limited to `waitUntil` for background refresh of assembled page cache. It should not fetch upstream sources directly on the request path.

## Response Cache Rules

Only cache safe public responses:

- Cache `GET /api/trends/:topic` for background translation mode.
- Cache `GET /api/sources` status/config responses.
- Do not cache auth routes.
- Do not cache summary streaming responses.
- Do not cache sync translation responses unless explicitly reviewed.

Response cache keys must include the full URL, including topic, lang, and translation mode.

## Why This Is Still KISS

This design adds only two durable concepts that match the domain:

- A source runtime row.
- Source item rows.

It removes the more confusing parts:

- No opaque source snapshot JSONB as the primary durable shape.
- No separate refresh lock table.
- No required R2, Queue, D1, Redis, or Dragonfly.
- No request-path upstream refresh.

The hot cache remains simple and optional. If it fails, SQL rows and bootstrap fallback still make the app work.

## Success Criteria

- Warm trends page requests usually avoid SQL reads by hitting `HotCache` or response cache.
- Cache misses read normalized source/item rows, not large snapshot JSONB blobs.
- Page assembly reads items through `(source_id, generation, rank)` so old item rows do not leak into the current page.
- Source status is inspectable from one source runtime row per source.
- Refresh lock state is visible on the source row.
- `X-Trends-Cache` / `X-Sources-Cache` show `hit`, `stale`, `miss`, or `bootstrap`.
- Docker runs without adding Redis, R2, Queue, D1, or any Void-only service.

## Recommendation

Use the simplest design that reflects the domain: persist source state and source items as normalized SQL rows, keep refresh ownership on the source row, and cache only assembled public results in a shared hot cache. On Void, that hot cache can use KV plus `caches.default` and `waitUntil`; outside Void, it falls back to memory.

This keeps the durable model understandable while still reducing hot-read pressure.
