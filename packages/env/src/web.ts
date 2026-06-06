import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const PRODUCTION_SERVER_URL = "https://api.opentrends.io";
const LOCAL_SERVER_URL_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const TRAILING_SLASHES_RE = /\/+$/;

function normalizeServerUrl(value: string): string {
	const trimmed = value.replace(TRAILING_SLASHES_RE, "");
	if (
		(import.meta as { env?: { PROD?: boolean } }).env?.PROD &&
		LOCAL_SERVER_URL_RE.test(trimmed)
	) {
		return PRODUCTION_SERVER_URL;
	}
	return trimmed;
}

export const env = createEnv({
	clientPrefix: "VITE_",
	client: {
		VITE_SERVER_URL: z.url().transform(normalizeServerUrl),
		VITE_SUPPORTED_LOCALES: z.string().optional(),
	},
	runtimeEnv:
		(import.meta as { env?: Record<string, string | undefined> }).env ?? {},
	emptyStringAsUndefined: true,
});
