#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createOpenTrendsMcpServer, type Lang } from "./server";

// Local stdio entry: `bunx opentrends-mcp`. The same tools are served over
// HTTP by the API itself at /mcp, which needs no install at all.
const server = createOpenTrendsMcpServer({
	baseUrl: process.env.OPENTRENDS_API_URL,
	defaultLang: process.env.OPENTRENDS_LANG as Lang | undefined,
});
await server.connect(new StdioServerTransport());
