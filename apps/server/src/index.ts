import { createContext } from "@opentrends/api/context";
import { appRouter } from "@opentrends/api/routers/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { eventsRoutes } from "./routes/events";
import { feedRoutes } from "./routes/feeds";
import { imageRoutes } from "./routes/images";
import { mcpRoutes } from "./routes/mcp";
import { skillsRoutes } from "./routes/skills";
import { sourcesRoutes } from "./routes/sources";
import { topicsRoutes } from "./routes/topics";
import { trendsRoutes } from "./routes/trends";
import {
	runWithWorkerBindings,
	type WorkerBindings,
	type WorkerQueueMessage,
} from "./runtime";
import { runEventMergeJob } from "./trends/services/event-merge-jobs";
import { runTrendsRefreshTick } from "./trends/services/refresh-scheduler";
import { runSummaryPrewarmJob } from "./trends/services/summary-prewarm-jobs";
import { runTranslationPrewarmJob } from "./trends/services/translation-prewarm-jobs";

const app = new Hono<{ Bindings: WorkerBindings }>();
const PRODUCTION_WEB_ORIGINS = new Set(["https://opentrends.io"]);

app.use(logger());
app.use("/*", async (context, next) =>
	cors({
		origin: (origin) => resolveAllowedOrigin(origin, context.env),
		allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"Accept",
			"Mcp-Session-Id",
			"Mcp-Protocol-Version",
		],
		exposeHeaders: ["Mcp-Session-Id"],
		credentials: true,
	})(context, next)
);

function resolveAllowedOrigin(
	origin: string | undefined,
	bindings: WorkerBindings
): string | null {
	if (!origin) {
		return null;
	}
	if (origin === bindings.CORS_ORIGIN) {
		return origin;
	}
	if (PRODUCTION_WEB_ORIGINS.has(origin)) {
		return origin;
	}
	if (bindings.NODE_ENV !== "development") {
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

app.get("/api/auth/providers", (context) =>
	context.json({
		google: Boolean(
			context.env.GOOGLE_CLIENT_ID && context.env.GOOGLE_OAUTH_KEY
		),
		github: Boolean(
			context.env.GITHUB_CLIENT_ID && context.env.GITHUB_OAUTH_KEY
		),
	})
);

app.on(["POST", "GET"], "/api/auth/*", async (context) => {
	const { getAuth } = await import("@opentrends/auth");
	return getAuth().handler(context.req.raw);
});

// Public trend pages are the same bytes for everyone for a minute or five
// (their Cache-Control says how long), so the edge keeps a copy per URL and
// answers repeat requests without touching KV or building the JSON again.
// The Cache API is a no-op on workers.dev and works on custom domains.
app.use("/api/trends/*", async (c, next) => {
	const cache = (globalThis as { caches?: { default?: Cache } }).caches
		?.default;
	if (c.req.method !== "GET" || !cache) {
		await next();
		return;
	}
	const key = new Request(c.req.url, { method: "GET" });
	const cached = await cache.match(key);
	if (cached) {
		const response = new Response(cached.body, cached);
		response.headers.set("X-Edge-Cache", "hit");
		return response;
	}
	await next();
	const control = c.res.headers.get("Cache-Control") ?? "";
	if (
		c.res.status === 200 &&
		control.includes("public") &&
		!control.includes("no-store")
	) {
		const copy = c.res.clone();
		try {
			c.executionCtx.waitUntil(cache.put(key, copy));
		} catch {
			await cache.put(key, copy);
		}
	}
});

app.route("/api/image", imageRoutes);
app.route("/api/events", eventsRoutes);
app.route("/api/skills", skillsRoutes);
app.route("/api/trends", trendsRoutes);
app.route("/api/sources", sourcesRoutes);
app.route("/api/topics", topicsRoutes);
app.route("/api/trends", feedRoutes);
app.route("/mcp", mcpRoutes);

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

app.use("/*", async (context, next) => {
	const apiContext = await createContext({ context });
	const rpcResult = await rpcHandler.handle(context.req.raw, {
		prefix: "/rpc",
		context: apiContext,
	});

	if (rpcResult.matched) {
		return context.newResponse(rpcResult.response.body, rpcResult.response);
	}

	const apiResult = await apiHandler.handle(context.req.raw, {
		prefix: "/api-reference",
		context: apiContext,
	});

	if (apiResult.matched) {
		return context.newResponse(apiResult.response.body, apiResult.response);
	}

	await next();
});

app.get("/", (context) => context.text("OK"));

async function processQueueMessage(message: WorkerQueueMessage): Promise<void> {
	if (message.kind === "event-merge") {
		await runEventMergeJob(message.payload);
		return;
	}
	if (message.kind === "translation-prewarm") {
		await runTranslationPrewarmJob(message.payload);
		return;
	}
	await runSummaryPrewarmJob(message.payload);
}

export default {
	fetch(request, bindings, executionContext) {
		return runWithWorkerBindings(bindings, () =>
			app.fetch(request, bindings, executionContext)
		);
	},
	queue(batch, bindings) {
		return runWithWorkerBindings(bindings, async () => {
			await Promise.all(
				batch.messages.map(async (message) => {
					try {
						await processQueueMessage(message.body);
						message.ack();
					} catch (error) {
						console.warn("[cloudflare-queue] message failed", error);
						message.retry({
							delaySeconds: message.body.kind === "event-merge" ? 120 : 60,
						});
					}
				})
			);
		});
	},
	scheduled(controller, bindings, executionContext) {
		executionContext.waitUntil(
			runWithWorkerBindings(bindings, () =>
				runTrendsRefreshTick(controller.scheduledTime)
			)
		);
	},
} satisfies ExportedHandler<WorkerBindings, WorkerQueueMessage>;
