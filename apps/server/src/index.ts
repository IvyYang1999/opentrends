import { createContext } from "@opentrends/api/context";
import { appRouter } from "@opentrends/api/routers/index";
import { env } from "@opentrends/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { imageRoutes } from "./routes/images";
import { skillsRoutes } from "./routes/skills";
import { sourcesRoutes } from "./routes/sources";
import { trendsRoutes } from "./routes/trends";

const app = new Hono();
const PRODUCTION_WEB_ORIGINS = new Set([
	"https://opentrends-web.void.app",
	"https://opentrends.io",
]);

app.use(logger());
app.use(
	"/*",
	cors({
		origin: (origin) => resolveAllowedOrigin(origin),
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	})
);

function resolveAllowedOrigin(origin: string | undefined): string | null {
	if (!origin) {
		return null;
	}
	if (origin === env.CORS_ORIGIN) {
		return origin;
	}
	if (PRODUCTION_WEB_ORIGINS.has(origin)) {
		return origin;
	}
	// In development, accept any localhost origin so the dev server picking a
	// different port (e.g. 3001 → 3002 when 3001 is taken) does not break fetches.
	if (env.NODE_ENV !== "development") {
		return null;
	}
	try {
		const { hostname } = new URL(origin);
		if (
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "[::1]"
		) {
			return origin;
		}
	} catch {
		return null;
	}
	return null;
}

app.on(["POST", "GET"], "/api/auth/*", async (c) => {
	const { getAuth } = await import("@opentrends/auth");
	return getAuth().handler(c.req.raw);
});

app.route("/api/image", imageRoutes);
app.route("/api/skills", skillsRoutes);
app.route("/api/trends", trendsRoutes);
app.route("/api/sources", sourcesRoutes);

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

app.use("/*", async (c, next) => {
	const context = await createContext({ context: c });

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context,
	});

	if (rpcResult.matched) {
		return c.newResponse(rpcResult.response.body, rpcResult.response);
	}

	const apiResult = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context,
	});

	if (apiResult.matched) {
		return c.newResponse(apiResult.response.body, apiResult.response);
	}

	await next();
});

app.get("/", (c) => c.text("OK"));

function shouldStartTrendsRefreshScheduler(): boolean {
	if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
		return false;
	}
	if (env.TRENDS_REFRESH_SCHEDULER === "enabled") {
		return true;
	}
	if (env.TRENDS_REFRESH_SCHEDULER === "disabled") {
		return false;
	}
	return env.NODE_ENV === "production";
}

if (shouldStartTrendsRefreshScheduler()) {
	import("./trends/services/refresh-scheduler")
		.then(({ startTrendsRefreshScheduler }) => startTrendsRefreshScheduler())
		.catch((error) => {
			console.error("[trends-refresh-scheduler]", error);
		});
}

// LLM-backed routes (e.g. /api/trends/:topic/summary) can take well over the
// 10s default before producing the first byte. Raise the idle timeout to 120s
// so cold-cache streaming responses aren't killed mid-flight by Bun.serve.
export default {
	fetch: app.fetch,
	idleTimeout: 120,
	port: env.SERVER_PORT,
};
