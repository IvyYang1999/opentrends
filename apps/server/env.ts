import { defineEnv, oneOf, string, url } from "void/env";

export default defineEnv({
	DATABASE_URL: string().secret(),
	BETTER_AUTH_SECRET: string().secret(),
	BETTER_AUTH_URL: url(),
	CORS_ORIGIN: url(),
	RSSHUB_BASE_URLS: string().optional(),
	NODE_ENV: oneOf(["development", "production", "test"]).default("production"),
	LLM_API_KEY: string().optional().secret(),
	LLM_BASE_URL: url(),
	LLM_MODEL: string(),
	SILICONFLOW_API_KEY: string().optional().secret(),
	SILICONFLOW_EMBEDDING_MODEL: string().default("Qwen/Qwen3-VL-Embedding-8B"),
	TRENDS_REFRESH_SCHEDULER: oneOf(["auto", "disabled", "enabled"]).default(
		"auto"
	),
});
