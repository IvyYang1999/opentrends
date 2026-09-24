import { Hono } from "hono";
import {
	createOpenTrendsMcpServer,
	createStatelessHttpTransport,
} from "opentrends-mcp";

// The MCP server over Streamable HTTP, served by the API itself: a client
// adds one URL and gets the same tools the stdio package offers, with no
// install and no key. Every request is its own stateless session, so any
// Worker instance can answer it; the tools read the public API of this
// same deployment.
export const mcpRoutes = new Hono().all("/", async (c) => {
	const server = createOpenTrendsMcpServer({
		baseUrl: new URL(c.req.url).origin,
		defaultLang: "en",
	});
	const transport = createStatelessHttpTransport();
	await server.connect(transport);
	try {
		return await transport.handleRequest(c.req.raw);
	} finally {
		c.executionCtx?.waitUntil?.(server.close().catch(() => undefined));
	}
});
