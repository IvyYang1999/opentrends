# opentrends-mcp

An MCP server that lets Claude, Cursor, Codex or any MCP client read
[OpenTrends](https://opentrends.io): the ten-line daily digest with citations,
topic feeds, single sources and a title search. It only calls the public JSON
API; no key, no scraping.

## Tools

| Tool | What it answers |
|---|---|
| `get_digest(topic, window?, lang?)` | "What happened in AI today / this week / this month?" — takeaways, reasons, citation links |
| `get_topic(topic, itemsPerSource?, lang?)` | "What are the sources saying?" — every source with its latest items |
| `get_source(topic, sourceId, lang?)` | One source's full list |
| `search(query, topic?, lang?, limit?)` | Items whose title contains a phrase |

Topics: `featured`, `ai`, `programming`, `hardware`, `biotech`, `embodied`, `cn`.
Languages: `en`, `zh`, `zh-Hant`, `ru`, `fr-FR`, `es-ES`, `de-DE`, `pt-BR`.

## Setup

The easiest way needs no install: the API serves the same tools over
Streamable HTTP at `https://api.opentrends.io/mcp`.

```bash
claude mcp add --transport http opentrends https://api.opentrends.io/mcp
codex mcp add opentrends --url https://api.opentrends.io/mcp
```

For a client that only runs local commands, the stdio server below.

Claude Desktop / Claude Code (`claude mcp add`):

```json
{
  "mcpServers": {
    "opentrends": {
      "command": "bunx",
      "args": ["opentrends-mcp"],
      "env": { "OPENTRENDS_LANG": "zh" }
    }
  }
}
```

From this repository, without publishing:

```json
{ "command": "bun", "args": ["run", "packages/mcp/src/index.ts"] }
```

Environment: `OPENTRENDS_LANG` (default language), `OPENTRENDS_API_URL`
(point a self-hosted instance at its own API).

## Embedding

`createOpenTrendsMcpServer({ baseUrl, defaultLang })` returns the `McpServer`;
`createStatelessHttpTransport()` gives a per-request Streamable HTTP
transport. `apps/server/src/routes/mcp.ts` is the eleven-line host.
