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
import { imageRoutes } from "./routes/images";
import { skillsRoutes } from "./routes/skills";
import { sourcesRoutes } from "./routes/sources";
import { trendsRoutes } from "./routes/trends";
import {
	runWithWorkerBindings,
	type WorkerBindings,
	type WorkerQueueMessage,
} from "./runtime";
import { runEventMergeJob } from "./trends/services/event-merge-jobs";
import { runTrendsRefreshTick } from "./trends/services/refresh-scheduler";
import { runSummaryPrewarmJob } from "./trends/services/summary-prewarm-jobs";

const app = new Hono<{ Bindings: WorkerBindings }>();
const PRODUCTION_WEB_ORIGINS = new Set(["https://opentrends.io"]);

app.use(logger());
app.use("/*", async (context, next) =>
	cors({
		origin: (origin) => resolveAllowedOrigin(origin, context.env),
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
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

app.on(["POST", "GET"], "/api/auth/*", async (context) => {
	const { getAuth } = await import("@opentrends/auth");
	return getAuth().handler(context.req.raw);
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
			for (const message of batch.messages) {
				try {
					await processQueueMessage(message.body);
					message.ack();
				} catch (error) {
					console.warn("[cloudflare-queue] message failed", error);
					message.retry({
						delaySeconds: message.body.kind === "event-merge" ? 120 : 60,
					});
				}
			}
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
