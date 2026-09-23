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

const serverEnvSchema = z
	.object({
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		// Outbound mail for briefing delivery: any provider with a JSON
		// "send" endpoint and a bearer/basic token (Forward Email, Resend).
		EMAIL_API_URL: z.url().default("https://api.forwardemail.net/v1/emails"),
		EMAIL_API_KEY: z.string().min(1).optional(),
		EMAIL_FROM: z.string().min(3).optional(),
		EMAIL_PROVIDER: z
			.enum(["forward-email", "resend"])
			.default("forward-email"),
		GOOGLE_CLIENT_ID: z.string().min(1).optional(),
		GOOGLE_OAUTH_KEY: z.string().min(1).optional(),
		GITHUB_CLIENT_ID: z.string().min(1).optional(),
		GITHUB_OAUTH_KEY: z.string().min(1).optional(),
		RSSHUB_BASE_URLS: z.string().min(1).optional(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		LLM_API_KEY: z.string().min(1).optional(),
		LLM_BASE_URL: z.url().default("https://dashboard.thorbase.com/v1"),
		LLM_MODEL: z.string().min(1).default("deepseek/deepseek-v4-pro"),
		LLM_TRANSLATION_MODEL: z.string().min(1).optional(),
		LLM_ENABLE_THINKING: z.enum(["true", "false"]).optional(),
		SILICONFLOW_API_KEY: z.string().min(1).optional(),
		SILICONFLOW_EMBEDDING_MODEL: z
			.string()
			.min(1)
			.default("Qwen/Qwen3-VL-Embedding-8B"),
		TRENDS_REFRESH_SCHEDULER: z
			.enum(["auto", "disabled", "enabled"])
			.default("auto"),
	})
	.superRefine((value, context) => {
		for (const [provider, clientId, oauthKey] of [
			["Google", value.GOOGLE_CLIENT_ID, value.GOOGLE_OAUTH_KEY],
			["GitHub", value.GITHUB_CLIENT_ID, value.GITHUB_OAUTH_KEY],
		] as const) {
			if (Boolean(clientId) !== Boolean(oauthKey)) {
				context.addIssue({
					code: "custom",
					message: `${provider} OAuth requires both configuration values`,
					path: [provider],
				});
			}
		}
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
