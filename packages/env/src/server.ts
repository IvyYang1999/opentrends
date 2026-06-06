import { fileURLToPath, URL } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import { config } from "dotenv";
import { z } from "zod";

const repoRoot = new URL("../../..", import.meta.url);
const runtimeEnv: Record<string, string | undefined> = {};

config({
	path: [fileURLToPath(new URL("apps/server/.env.local", repoRoot))],
	override: true,
	processEnv: runtimeEnv,
	quiet: true,
});

function removeEmptyEnvValues(
	env: Record<string, string | undefined>
): Record<string, string | undefined> {
	const nonEmptyEnv: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined && value !== "") {
			nonEmptyEnv[key] = value;
		}
	}
	return nonEmptyEnv;
}

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		RSSHUB_BASE_URLS: z.string().min(1).optional(),
		SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
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
	},
	runtimeEnv: { ...runtimeEnv, ...removeEmptyEnvValues(process.env) },
	emptyStringAsUndefined: true,
});
