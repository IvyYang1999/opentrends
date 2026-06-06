---
name: opentrends
description: Read structured trend data from the public OpenTrends API. Use when users ask about OpenTrends, current trends, AI trends, programming trends, hardware trends, biotech trends, embodied AI trends, or China tech trends.
---

# OpenTrends API Reader

Use OpenTrends as a structured API data source. Do not scrape the human-facing
website.

## Update Check

Before each OpenTrends task, fetch the current skill/API manifest:

```txt
GET https://api.opentrends.io/api/skills/opentrends
```

Use the returned `baseUrl`, `topics`, `endpoints`, and query parameter contract
as the source of truth. If the manifest conflicts with this local Markdown file,
follow the manifest.

If the manifest request fails, continue with the defaults in this file and tell
the user that the latest OpenTrends skill manifest could not be checked.

## Defaults

```txt
Base URL: https://api.opentrends.io
Topic endpoint: GET /api/trends/:topic
Source endpoint: GET /api/trends/:topic/sources/:sourceId
Summary endpoint: GET /api/trends/:topic/summary
Sources endpoint: GET /api/sources
```

Supported topics:

```txt
ai
programming
hardware
biotech
embodied
cn
```

Useful query parameters:

```txt
lang=zh | en | zh-Hant | ru
items=preview | number
translations=background | sync
```

## Workflow

1. Map the user's request to a topic. If unclear, ask which topic they want or
   default to `ai` for general AI trend requests.
2. Fetch the manifest.
3. Request structured JSON from the API host, for example:

   ```txt
   GET https://api.opentrends.io/api/trends/ai?lang=zh&items=preview
   ```

4. For one source, use `/api/trends/:topic/sources/:sourceId`.
5. For an overall generated summary, use `/api/trends/:topic/summary`, then use
   the topic JSON as citation/link context.
6. If the API returns `topic_not_found`, `404`, or parameter errors, fetch the
   manifest again and retry once with the latest contract.

## Response Rules

- Summarize only from API JSON or API summary output.
- Preserve source links from item `url` fields.
- Include source names, item titles, and dates when available.
- If a source or topic is empty, unavailable, or stale, say so directly.
- Do not invent trends, source names, dates, or links.
- Do not call `https://opentrends.io/api/...`.
- Do not scrape `https://opentrends.io/...` trend pages.
