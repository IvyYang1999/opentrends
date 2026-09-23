import { Hono } from "hono";

import {
	FOLLOWED_TOPIC_ID,
	parseFollowedSourceIds,
} from "../trends/config/followed-topic";

import {
	getCalendarMonth,
	parseMonth,
	parseTzOffset,
} from "../trends/services/get-calendar";
import { TopicNotFoundError } from "../trends/services/get-trends-page";
import { normalizeTranslationLanguage } from "../trends/services/translate-news-items";

const CALENDAR_CACHE_CONTROL =
	"public, max-age=600, s-maxage=3600, stale-while-revalidate=3600";

function currentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

export const calendarRoutes = new Hono().get("/:topic/calendar", async (c) => {
	const topic = c.req.param("topic");
	const lang = normalizeTranslationLanguage(c.req.query("lang"));
	const month = parseMonth(c.req.query("month") ?? currentMonth());
	if (!month) {
		return c.json({ error: "invalid_month" }, 400);
	}
	const tzOffset = parseTzOffset(c.req.query("tz"));
	try {
		const sourceIds =
			topic === FOLLOWED_TOPIC_ID
				? parseFollowedSourceIds(c.req.query("sources"))
				: undefined;
		const calendar = await getCalendarMonth(
			topic,
			month.month,
			lang,
			tzOffset,
			sourceIds
		);
		return c.json(calendar, 200, { "Cache-Control": CALENDAR_CACHE_CONTROL });
	} catch (error) {
		if (error instanceof TopicNotFoundError) {
			return c.json({ error: "topic_not_found", topic }, 404);
		}
		throw error;
	}
});
