import alchemy from "alchemy";
import {
	D1Database,
	KVNamespace,
	Queue,
	TanStackStart,
	Worker,
} from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: "./.env.local" });
config({ path: "../../apps/web/.env.local" });
config({ path: "../../apps/server/.env.local" });

const app = await alchemy("opentrends");

function required<T>(value: T | undefined, key: string): T {
	if (!value) {
		throw new Error(`Missing required configuration field: ${key}`);
	}
	return value;
}

const database = await D1Database("database", {
	migrationsDir: "../db/src/d1-migrations",
	migrationsTable: "d1_migrations",
	primaryLocationHint: "apac",
});
const hotCache = await KVNamespace("hot-cache");
const eventMergeQueue = await Queue("event-merge");
const summaryPrewarmQueue = await Queue("summary-prewarm");

export const api = await Worker("api", {
	cwd: "../../apps/server",
	entrypoint: "src/index.ts",
	dev: { port: 3000 },
	bundle: {
		alias: {
			"undici/lib/handler/unwrap-handler.js":
				"undici/lib/handler/unwrap-handler.js",
			"undici/lib/handler/wrap-handler.js":
				"undici/lib/handler/wrap-handler.js",
			undici: "undici/index.js",
		},
	},
	compatibility: "node",
	url: true,
	bindings: {
		DB: database,
		HOT_CACHE: hotCache,
		EVENT_MERGE_QUEUE: eventMergeQueue,
		SUMMARY_PREWARM_QUEUE: summaryPrewarmQueue,
		BETTER_AUTH_SECRET: required(
			alchemy.secret.env.BETTER_AUTH_SECRET,
			"BETTER_AUTH_SECRET"
		),
		BETTER_AUTH_URL: required(alchemy.env.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
		CORS_ORIGIN: required(alchemy.env.CORS_ORIGIN, "CORS_ORIGIN"),
		...(process.env.RSSHUB_BASE_URLS
			? { RSSHUB_BASE_URLS: alchemy.env.RSSHUB_BASE_URLS }
			: {}),
		NODE_ENV: process.env.NODE_ENV ?? "development",
		...(process.env.LLM_API_KEY
			? { LLM_API_KEY: alchemy.secret.env.LLM_API_KEY }
			: {}),
		LLM_BASE_URL:
			process.env.LLM_BASE_URL ?? "https://dashboard.thorbase.com/v1",
		LLM_MODEL: process.env.LLM_MODEL ?? "deepseek/deepseek-v4-pro",
		...(process.env.SILICONFLOW_API_KEY
			? { SILICONFLOW_API_KEY: alchemy.secret.env.SILICONFLOW_API_KEY }
			: {}),
		SILICONFLOW_EMBEDDING_MODEL:
			process.env.SILICONFLOW_EMBEDDING_MODEL ?? "Qwen/Qwen3-VL-Embedding-8B",
		TRENDS_REFRESH_SCHEDULER: process.env.TRENDS_REFRESH_SCHEDULER ?? "auto",
	},
	crons: ["*/5 * * * *"],
	eventSources: [
		{
			queue: eventMergeQueue,
			settings: {
				batchSize: 1,
				maxRetries: 3,
				maxWaitTimeMs: 5000,
				retryDelay: 120,
			},
		},
		{
			queue: summaryPrewarmQueue,
			settings: {
				batchSize: 2,
				maxRetries: 3,
				maxWaitTimeMs: 5000,
				retryDelay: 60,
			},
		},
	],
});

export const web = await TanStackStart("web", {
	cwd: "../../apps/web",
	bindings: {
		API: api,
		VITE_SERVER_URL: required(api.url, "api.url"),
		...(process.env.VITE_SITE_URL
			? { VITE_SITE_URL: alchemy.env.VITE_SITE_URL }
			: {}),
		...(process.env.VITE_SUPPORTED_LOCALES
			? { VITE_SUPPORTED_LOCALES: alchemy.env.VITE_SUPPORTED_LOCALES }
			: {}),
	},
});

console.log(`API -> ${api.url}`);
console.log(`Web -> ${web.url}`);

await app.finalize();
