import { Hono } from "hono";

import {
	DEFAULT_TRENDS_ITEMS_PER_SOURCE,
	getTrendSourceCard,
	getTrendsPageWithCacheInfo,
	PREVIEW_TRENDS_ITEMS_PER_SOURCE,
	TopicNotFoundError,
	type TrendsPageCacheStatus,
	TrendsSnapshotsUnavailableError,
} from "../trends/services/get-trends-page";
import {
	prepareTrendsSummary,
	TrendsSummaryNotConfiguredError,
} from "../trends/services/get-trends-summary";
import {
	normalizeTranslationLanguage,
	type TranslationMode,
	translateTrendsPage,
} from "../trends/services/translate-news-items";
import type { TrendsPageData } from "../trends/types";

interface WaitUntilContext {
	executionCtx?: {
		waitUntil?: (promise: Promise<unknown>) => void;
	};
}

function parseTranslationMode(value: string | undefined): TranslationMode {
	// The sync path is request-bound and internally time-boxed. It does not start
	// request-external translation work, which is unsafe on Workers.
	return value === "sync" ? "sync" : "background";
}

function parseItemsPerSource(value: string | undefined): number {
	if (value === "preview") {
		return PREVIEW_TRENDS_ITEMS_PER_SOURCE;
	}
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_TRENDS_ITEMS_PER_SOURCE;
	}
	return Math.min(Math.max(parsed, 1), DEFAULT_TRENDS_ITEMS_PER_SOURCE);
}

function getWaitUntil(c: WaitUntilContext) {
	if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
		return;
	}
	const waitUntil = c.executionCtx?.waitUntil;
	return typeof waitUntil === "function"
		? (promise: Promise<unknown>) => waitUntil.call(c.executionCtx, promise)
		: undefined;
}

const PUBLIC_TRENDS_CACHE_CONTROL =
	"public, max-age=600, s-maxage=1800, stale-while-revalidate=3600";

function textStreamFromGenerator(
	generator: AsyncGenerator<string, void, void>
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let closed = false;
	let primed = false;
	return new ReadableStream({
		async pull(controller) {
			if (!primed) {
				primed = true;
				controller.enqueue(encoder.encode(" "));
				return;
			}
			try {
				while (true) {
					const next = await generator.next();
					if (next.done) {
						closed = true;
						controller.close();
						return;
					}
					if (next.value) {
						controller.enqueue(encoder.encode(next.value));
						return;
					}
				}
			} catch (error) {
				closed = true;
				controller.error(error);
			}
		},
		async cancel() {
			if (!closed) {
				await generator.return?.();
			}
		},
	});
}

function withTrendsCacheHeaders(
	response: Response,
	translationMode: TranslationMode,
	cacheStatus: TrendsPageCacheStatus
): Response {
	response.headers.set(
		"Cache-Control",
		translationMode === "background" ? PUBLIC_TRENDS_CACHE_CONTROL : "no-store"
	);
	response.headers.set("X-Trends-Cache", cacheStatus);
	response.headers.set("Access-Control-Expose-Headers", "X-Trends-Cache");
	return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isTrendsPagePayload(value: unknown): value is TrendsPageData {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.title === "string" &&
		typeof value.updatedAt === "number" &&
		Array.isArray(value.sections)
	);
}

async function readTrendsPagePayload(request: {
	json: () => Promise<unknown>;
}): Promise<TrendsPageData | null> {
	try {
		const value = await request.json();
		return isTrendsPagePayload(value) ? value : null;
	} catch {
		return null;
	}
}

export const trendsRoutes = new Hono()
	.get("/", async (c) => {
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const translationMode = parseTranslationMode(c.req.query("translations"));
		const itemsPerSource = parseItemsPerSource(c.req.query("items"));
		try {
			const { cacheStatus, page } = await getTrendsPageWithCacheInfo(
				"ai",
				lang,
				translationMode,
				itemsPerSource,
				{ waitUntil: getWaitUntil(c) }
			);
			const response = withTrendsCacheHeaders(
				c.json(page),
				translationMode,
				cacheStatus
			);
			return response;
		} catch (error) {
			if (error instanceof TrendsSnapshotsUnavailableError) {
				return c.json({ error: "snapshots_unavailable" }, 503, {
					"Retry-After": "1",
				});
			}
			throw error;
		}
	})
	.get("/:topic/summary", async (c) => {
		const topic = c.req.param("topic");
		const lang = normalizeTranslationLanguage(c.req.query("lang"));

		let prepared: Awaited<ReturnType<typeof prepareTrendsSummary>>;
		try {
			prepared = await prepareTrendsSummary(topic, lang, {
				waitUntil: getWaitUntil(c),
			});
		} catch (error) {
			if (error instanceof TopicNotFoundError) {
				return c.json({ error: "topic_not_found", topic }, 404);
			}
			if (error instanceof TrendsSnapshotsUnavailableError) {
				return c.json({ error: "snapshots_unavailable" }, 503, {
					"Retry-After": "1",
				});
			}
			if (error instanceof TrendsSummaryNotConfiguredError) {
				return c.json({ error: "summary_not_configured" }, 503);
			}
			throw error;
		}

		const body = textStreamFromGenerator(prepared.stream(c.req.raw.signal));
		return new Response(body, {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "no-store",
				"X-Trends-Citations": encodeURIComponent(
					JSON.stringify(prepared.citations)
				),
				// Allow the cross-origin web client (different localhost port) to
				// read the citations header off the response.
				"Access-Control-Expose-Headers": "X-Trends-Citations",
			},
		});
	})
	.post("/:topic/translations", async (c) => {
		const topic = c.req.param("topic");
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const page = await readTrendsPagePayload(c.req);
		if (!page || page.id !== topic) {
			return c.json({ error: "invalid_trends_page", topic }, 400);
		}
		let translatedPage: TrendsPageData;
		try {
			translatedPage = await translateTrendsPage(page, lang, "sync");
		} catch (error) {
			console.warn("[trends-translation] failed to translate page", error);
			translatedPage = page;
		}
		return withTrendsCacheHeaders(c.json(translatedPage), "sync", "bypass");
	})
	.get("/:topic/sources/:sourceId", async (c) => {
		const topic = c.req.param("topic");
		const sourceId = c.req.param("sourceId");
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const translationMode = parseTranslationMode(c.req.query("translations"));
		const itemsPerSource = parseItemsPerSource(c.req.query("items"));
		try {
			const source = await getTrendSourceCard(
				topic,
				sourceId,
				lang,
				translationMode,
				itemsPerSource
			);
			return withTrendsCacheHeaders(
				c.json(source),
				translationMode,
				translationMode === "background" ? "miss" : "bypass"
			);
		} catch (error) {
			if (error instanceof TopicNotFoundError) {
				return c.json({ error: "source_not_found", sourceId, topic }, 404);
			}
			if (error instanceof TrendsSnapshotsUnavailableError) {
				return c.json({ error: "snapshots_unavailable" }, 503, {
					"Retry-After": "1",
				});
			}
			throw error;
		}
	})
	.get("/:topic", async (c) => {
		const topic = c.req.param("topic");
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const translationMode = parseTranslationMode(c.req.query("translations"));
		const itemsPerSource = parseItemsPerSource(c.req.query("items"));
		try {
			const { cacheStatus, page } = await getTrendsPageWithCacheInfo(
				topic,
				lang,
				translationMode,
				itemsPerSource,
				{ waitUntil: getWaitUntil(c) }
			);
			const response = withTrendsCacheHeaders(
				c.json(page),
				translationMode,
				cacheStatus
			);
			return response;
		} catch (error) {
			if (error instanceof TopicNotFoundError) {
				return c.json({ error: "topic_not_found", topic }, 404);
			}
			if (error instanceof TrendsSnapshotsUnavailableError) {
				return c.json({ error: "snapshots_unavailable" }, 503, {
					"Retry-After": "1",
				});
			}
			throw error;
		}
	});
