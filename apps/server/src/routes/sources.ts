import { Hono } from "hono";

import {
	getSourcesConfigStatus,
	getSourcesStatusWithCacheInfo,
	type SourcesStatusCacheStatus,
} from "../trends/services/get-sources-status";
import { shouldReturnConfigStatus } from "./sources-mode";

const SOURCES_STATUS_CACHE_KEY = "https://opentrends.internal/api/sources";

function getDefaultEdgeCache(): Cache | null {
	const maybeCaches = (
		globalThis as {
			caches?: CacheStorage & { default?: Cache };
		}
	).caches;
	return maybeCaches?.default ?? null;
}

export const sourcesRoutes = new Hono().get("/", async (c) => {
	if (shouldReturnConfigStatus(c.req.query("mode"))) {
		return withSourcesCacheHeaders(c.json(getSourcesConfigStatus()), "config");
	}

	const cached = await readSourcesStatusFromEdgeCache();
	if (cached) {
		return withSourcesCacheHeaders(cached, "edge");
	}

	const { cacheStatus, status } = await getSourcesStatusWithCacheInfo();
	const response = withSourcesCacheHeaders(c.json(status), cacheStatus);
	if (getDefaultEdgeCache()) {
		c.executionCtx.waitUntil(writeSourcesStatusToEdgeCache(response.clone()));
	}
	return response;
});

async function readSourcesStatusFromEdgeCache(): Promise<Response | null> {
	const edgeCache = getDefaultEdgeCache();
	if (!edgeCache) {
		return null;
	}
	try {
		return (await edgeCache.match(SOURCES_STATUS_CACHE_KEY)) ?? null;
	} catch (error) {
		console.warn("[sources] failed to read edge cache", error);
		return null;
	}
}

async function writeSourcesStatusToEdgeCache(
	response: Response
): Promise<void> {
	const edgeCache = getDefaultEdgeCache();
	if (!edgeCache) {
		return;
	}
	try {
		await edgeCache.put(SOURCES_STATUS_CACHE_KEY, response);
	} catch (error) {
		console.warn("[sources] failed to write edge cache", error);
	}
}

export function withSourcesCacheHeaders(
	response: Response,
	cacheStatus: SourcesStatusCacheStatus
): Response {
	const responseWithMutableHeaders = new Response(response.body, response);
	responseWithMutableHeaders.headers.set(
		"Cache-Control",
		"public, max-age=60, s-maxage=300, stale-while-revalidate=600"
	);
	responseWithMutableHeaders.headers.set("X-Sources-Cache", cacheStatus);
	const exposedHeaders =
		responseWithMutableHeaders.headers
			.get("Access-Control-Expose-Headers")
			?.split(",")
			.map((header) => header.trim())
			.filter(
				(header) =>
					header.length > 0 && header.toLowerCase() !== "x-sources-cache"
			) ?? [];
	responseWithMutableHeaders.headers.set(
		"Access-Control-Expose-Headers",
		[...exposedHeaders, "X-Sources-Cache"].join(", ")
	);
	return responseWithMutableHeaders;
}
