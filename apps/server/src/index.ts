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

import { eventsRoutes } from "./routes/events";
import { imageRoutes } from "./routes/images";
import { skillsRoutes } from "./routes/skills";
import { sourcesRoutes } from "./routes/sources";
import { trendsRoutes } from "./routes/trends";
import {
	runTrendsRefreshTick,
	scheduleTrendsRefreshTick,
} from "./trends/services/refresh-scheduler";

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

interface ExecutionContextLike {
	waitUntil?: (promise: Promise<unknown>) => void;
}

interface RequestContextWithExecution {
	executionCtx?: ExecutionContextLike;
}

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

function isBunRuntime(): boolean {
	return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

function isTrendsRefreshSchedulerEnabled(): boolean {
	if (env.TRENDS_REFRESH_SCHEDULER === "enabled") {
		return true;
	}
	if (env.TRENDS_REFRESH_SCHEDULER === "disabled") {
		return false;
	}
	return env.NODE_ENV !== "test";
}

function getExecutionWaitUntil(c: RequestContextWithExecution) {
	const waitUntil = c.executionCtx?.waitUntil;
	return typeof waitUntil === "function"
		? (promise: Promise<unknown>) => waitUntil.call(c.executionCtx, promise)
		: undefined;
}

app.post("/__void/scheduled", async (c) => {
	const runtimeEnv = c.env as
		| Record<string, string | undefined>
		| null
		| undefined;
	const expectedToken =
		runtimeEnv?.__VOID_PROXY_TOKEN ?? runtimeEnv?.CRON_SECRET;
	const token = c.req.header("x-void-internal");
	if (expectedToken && token !== expectedToken) {
		return c.json({ error: "unauthorized" }, 401);
	}

	const body = (await c.req.json().catch(() => ({}))) as {
		cron?: string;
		scheduledTime?: number;
	};
	if (body.cron && body.cron !== "*/5 * * * *") {
		return c.json({ error: "unknown cron" }, 404);
	}

	await runTrendsRefreshTick(body.scheduledTime);
	return c.json({ ok: true });
});

app.use("/*", async (c, next) => {
	if (!isBunRuntime() && isTrendsRefreshSchedulerEnabled()) {
		scheduleTrendsRefreshTick(getExecutionWaitUntil(c));
	}
	await next();
});

app.route("/api/image", imageRoutes);
app.route("/api/events", eventsRoutes);
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
	if (!isBunRuntime()) {
		return false;
	}
	return isTrendsRefreshSchedulerEnabled();
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
