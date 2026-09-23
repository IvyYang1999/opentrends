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
