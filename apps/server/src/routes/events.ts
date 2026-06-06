import { Hono } from "hono";

import { EventEmbeddingNotConfiguredError } from "../trends/services/event-embedding";
import { getEventDetail, getEventFeed } from "../trends/services/event-feed";
import {
	TopicNotFoundError,
	TrendsSnapshotsUnavailableError,
} from "../trends/services/get-trends-page";
import {
	normalizeTranslationLanguage,
	type TranslationMode,
} from "../trends/services/translate-news-items";

interface WaitUntilContext {
	executionCtx?: {
		waitUntil?: (promise: Promise<unknown>) => void;
	};
}

const PUBLIC_EVENTS_CACHE_CONTROL =
	"public, max-age=600, s-maxage=1800, stale-while-revalidate=3600";

function parsePositiveInteger(value: string | undefined): number | undefined {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOffset(value: string | undefined): number | undefined {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseTranslationMode(value: string | undefined): TranslationMode {
	return value === "sync" ? "sync" : "background";
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

function withEventsCacheHeaders(response: Response): Response {
	response.headers.set("Cache-Control", PUBLIC_EVENTS_CACHE_CONTROL);
	return response;
}

export const eventsRoutes = new Hono()
	.get("/", async (c) => {
		const topic = c.req.query("topic");
		const limit = parsePositiveInteger(c.req.query("limit"));
		const offset = parseOffset(c.req.query("offset"));
		const lang = normalizeTranslationLanguage(c.req.query("lang"));
		const translationMode = parseTranslationMode(c.req.query("translations"));
		try {
			return withEventsCacheHeaders(
				c.json(
					await getEventFeed(topic, {
						lang,
						limit,
						offset,
						translationMode,
						waitUntil: getWaitUntil(c),
					})
				)
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
	.get("/:eventId", async (c) => {
		const eventId = c.req.param("eventId");
		const topic = c.req.query("topic");
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
			return withEventsCacheHeaders(c.json(event));
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
	});
