import { Hono } from "hono";
import { captureWorkerContext } from "../runtime";
import { EventEmbeddingNotConfiguredError } from "../trends/services/event-embedding";
import { getEventDetail, getEventFeed } from "../trends/services/event-feed";
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
	HEADER_CITATION_LIMIT,
	normalizeSummaryWindow,
	prepareTrendsSummary,
	TrendsSummaryNotConfiguredError,
	TrendsSummaryPendingError,
	withCitationPreamble,
} from "../trends/services/get-trends-summary";
import { requestSummaryPrewarmJob } from "../trends/services/summary-prewarm-jobs";
import {
	normalizeTranslationLanguage,
	type TranslationMode,
} from "../trends/services/translate-news-items";
import { requestTranslationPrewarmsForPage } from "../trends/services/translation-prewarm-jobs";
import type { TopicId } from "../trends/types";

interface WaitUntilContext {
	executionCtx?: {
		waitUntil?: (promise: Promise<unknown>) => void;
	};
}

function parseTranslationMode(_value: string | undefined): TranslationMode {
	return "background";
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

export function getWaitUntil(c: WaitUntilContext) {
	const waitUntil = c.executionCtx?.waitUntil;
	return typeof waitUntil === "function"
		? (promise: Promise<unknown>) => waitUntil.call(c.executionCtx, promise)
		: undefined;
}

const PUBLIC_TRENDS_CACHE_CONTROL =
	"public, max-age=60, s-maxage=300, stale-while-revalidate=600";

function parsePositiveInteger(value: string | undefined): number | undefined {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOffset(value: string | undefined): number | undefined {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function textStreamFromGenerator(
	generator: AsyncGenerator<string, void, void>
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const runInWorkerContext = captureWorkerContext();
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
					const next = await runInWorkerContext(() => generator.next());
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
				await runInWorkerContext(() => generator.return?.());
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

function scheduleTranslationPrewarms(
	page: Awaited<ReturnType<typeof getTrendsPageWithCacheInfo>>["page"],
	lang: ReturnType<typeof normalizeTranslationLanguage>,
	waitUntil: ReturnType<typeof getWaitUntil>
): void {
	const prewarm = requestTranslationPrewarmsForPage(page, lang).catch(
		(error) => {
			console.warn("[trends-translation] page reconciliation failed", error);
		}
	);
	waitUntil?.(prewarm);
}

export const trendsRoutes = new Hono()
	.get("/", async (c) => {
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const translationMode = parseTranslationMode(c.req.query("translations"));
		const itemsPerSource = parseItemsPerSource(c.req.query("items"));
		try {
			const waitUntil = getWaitUntil(c);
			const { cacheStatus, page } = await getTrendsPageWithCacheInfo(
				"ai",
				lang,
				translationMode,
				itemsPerSource,
				{ waitUntil }
			);
			scheduleTranslationPrewarms(page, lang, waitUntil);
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
		const window = normalizeSummaryWindow(c.req.query("window"));

		let prepared: Awaited<ReturnType<typeof prepareTrendsSummary>>;
		try {
			prepared = await prepareTrendsSummary(topic, lang, {
				window,
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
			if (error instanceof TrendsSummaryPendingError) {
				const prewarm = requestSummaryPrewarmJob({
					lang,
					topicId: topic as TopicId,
					window,
				});
				getWaitUntil(c)?.(prewarm);
				return c.json({ status: "pending" }, 202, {
					"Cache-Control": "no-store",
					"Retry-After": "30",
				});
			}
			throw error;
		}

		const stream = prepared.stream(c.req.raw.signal);
		if (c.req.query("citations") === "body") {
			return new Response(
				textStreamFromGenerator(
					withCitationPreamble(prepared.citations, stream)
				),
				{
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": "no-store",
					},
				}
			);
		}

		return new Response(textStreamFromGenerator(stream), {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "no-store",
				"X-Trends-Citations": encodeURIComponent(
					JSON.stringify(prepared.citations.slice(0, HEADER_CITATION_LIMIT))
				),
				// Allow the cross-origin web client (different localhost port) to
				// read the citations header off the response.
				"Access-Control-Expose-Headers": "X-Trends-Citations",
			},
		});
	})
	.get("/:topic/events", async (c) => {
		const topic = c.req.param("topic");
		const limit = parsePositiveInteger(c.req.query("limit"));
		const offset = parseOffset(c.req.query("offset"));
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const translationMode = parseTranslationMode(c.req.query("translations"));
		try {
			return withTrendsCacheHeaders(
				c.json(
					await getEventFeed(topic, {
						lang,
						limit,
						offset,
						translationMode,
						waitUntil: getWaitUntil(c),
					})
				),
				"background",
				"miss"
			);
		} catch (error) {
			if (error instanceof TopicNotFoundError) {
				return c.json({ error: "topic_not_found", topic }, 404);
			}
			if (error instanceof TrendsSnapshotsUnavailableError) {
				return c.json({ error: "snapshots_unavailable" }, 503, {
					"Retry-After": "1",
				});
			}
			if (error instanceof EventEmbeddingNotConfiguredError) {
				return c.json({ error: "embedding_not_configured" }, 503);
			}
			throw error;
		}
	})
	.get("/:topic/events/:eventId", async (c) => {
		const topic = c.req.param("topic");
		const eventId = c.req.param("eventId");
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const translationMode = parseTranslationMode(c.req.query("translations"));
		try {
			const event = await getEventDetail(eventId, topic, {
				lang,
				translationMode,
			});
			if (!event) {
				return c.json({ error: "event_not_found", eventId, topic }, 404);
			}
			return withTrendsCacheHeaders(c.json(event), "background", "hit");
		} catch (error) {
			if (error instanceof TopicNotFoundError) {
				return c.json({ error: "topic_not_found", topic }, 404);
			}
			if (error instanceof TrendsSnapshotsUnavailableError) {
				return c.json({ error: "snapshots_unavailable" }, 503, {
					"Retry-After": "1",
				});
			}
			if (error instanceof EventEmbeddingNotConfiguredError) {
				return c.json({ error: "embedding_not_configured" }, 503);
			}
			throw error;
		}
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
				itemsPerSource,
				{ waitUntil: getWaitUntil(c) }
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
			const waitUntil = getWaitUntil(c);
			const { cacheStatus, page } = await getTrendsPageWithCacheInfo(
				topic,
				lang,
				translationMode,
				itemsPerSource,
				{ waitUntil }
			);
			scheduleTranslationPrewarms(page, lang, waitUntil);
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
