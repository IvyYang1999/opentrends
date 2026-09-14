import { env } from "@opentrends/env/web";
import { createServerOnlyFn } from "@tanstack/react-start";
import type { Locale } from "@/lib/i18n";
import { readTrendsSnapshot } from "./ssr-snapshot";

// Reuse the public, cacheable preview endpoint used by the browser.
export const loadTrendsForSsr = createServerOnlyFn(
	(topic: string, locale: Locale) =>
		readTrendsSnapshot(fetch, env.VITE_SERVER_URL, topic, locale)
);
