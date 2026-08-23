import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "dotenv";
import { z } from "zod";

const localRuntime: Record<string, string | undefined> = {};

config({
	path: "apps/server/.env.local",
	override: true,
	processEnv: localRuntime,
	quiet: true,
});

const serverEnvSchema = z.object({
	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.url(),
	CORS_ORIGIN: z.url(),
	RSSHUB_BASE_URLS: z.string().min(1).optional(),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	LLM_API_KEY: z.string().min(1).optional(),
	LLM_BASE_URL: z.url().default("https://dashboard.thorbase.com/v1"),
	LLM_MODEL: z.string().min(1).default("deepseek/deepseek-v4-pro"),
	SILICONFLOW_API_KEY: z.string().min(1).optional(),
	SILICONFLOW_EMBEDDING_MODEL: z
		.string()
		.min(1)
		.default("Qwen/Qwen3-VL-Embedding-8B"),
	TRENDS_REFRESH_SCHEDULER: z
		.enum(["auto", "disabled", "enabled"])
		.default("auto"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const serverEnvContext = new AsyncLocalStorage<ServerEnv>();
let fallbackEnv: ServerEnv | undefined;

function nonEmptyValues(
	input: Record<string, unknown>
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input).filter(
			([, value]) => value !== undefined && value !== ""
		)
	);
}

function getFallbackEnv(): ServerEnv {
	fallbackEnv ??= serverEnvSchema.parse({
		...nonEmptyValues(localRuntime),
		...nonEmptyValues(process.env),
	});
	return fallbackEnv;
}

export function runWithServerEnv<T>(
	input: Record<string, unknown>,
	callback: () => T
): T {
	const parsed = serverEnvSchema.parse(nonEmptyValues(input));
	return serverEnvContext.run(parsed, callback);
}

export const env = new Proxy({} as ServerEnv, {
	get(_target, property: keyof ServerEnv) {
		const current = serverEnvContext.getStore() ?? getFallbackEnv();
		return current[property];
	},
});
