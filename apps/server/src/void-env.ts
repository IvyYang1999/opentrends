import { env as cloudflareEnv } from "cloudflare:workers";

interface ServerEnv {
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	CORS_ORIGIN: string;
	DATABASE_URL: string;
	LLM_API_KEY: string | undefined;
	LLM_BASE_URL: string;
	LLM_MODEL: string;
	NODE_ENV: "development" | "production" | "test";
	RSSHUB_BASE_URLS: string | undefined;
	TRENDS_REFRESH_SCHEDULER: "auto" | "disabled" | "enabled";
}

export const env = new Proxy(
	{},
	{
		get(_target, key: string) {
			const value = cloudflareEnv[key as keyof typeof cloudflareEnv];
			if (value !== undefined && value !== "") {
				return value;
			}
			return process.env[key];
		},
	}
) as ServerEnv;
