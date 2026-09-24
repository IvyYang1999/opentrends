import { env as workerEnv } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import type { Locale } from "@/lib/i18n";
import { readTrendsSnapshot } from "./ssr-snapshot";

interface WebWorkerBindings {
	API: {
		fetch(request: Request): Promise<Response>;
	};
	VITE_SERVER_URL: string;
}

// Keep SSR traffic on Cloudflare's internal service binding. The browser still
// uses VITE_SERVER_URL through the regular client query path.
export const loadTrendsForSsr = createServerOnlyFn(
	(topic: string, locale: Locale) => {
		const bindings = workerEnv as unknown as WebWorkerBindings;
		return readTrendsSnapshot(
			(request) => bindings.API.fetch(request),
			bindings.VITE_SERVER_URL,
			topic,
			locale
		);
	}
);
