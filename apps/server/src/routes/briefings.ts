import { Hono } from "hono";

import {
	MAX_FOLLOWED_SOURCES,
	parseFollowedSourceIds,
	parseKeywords,
} from "../trends/config/followed-topic";
import {
	type BriefingSubscription,
	deleteSubscription,
	isEmailConfigured,
	isValidEmail,
	newSubscriptionId,
	readSubscription,
	saveSubscription,
} from "../trends/services/briefing-subscriptions";
import { parseTzOffset } from "../trends/services/get-calendar";
import { normalizeTranslationLanguage } from "../trends/services/translate-news-items";

const MAX_NAME_CHARS = 60;

interface SubscribeBody {
	email?: unknown;
	hour?: unknown;
	keywords?: unknown;
	lang?: unknown;
	name?: unknown;
	sourceIds?: unknown;
	tzOffsetMinutes?: unknown;
}

function asStringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

export const briefingRoutes = new Hono()
	.post("/subscriptions", async (c) => {
		if (!isEmailConfigured()) {
			return c.json({ error: "email_not_configured" }, 503);
		}
		const body = (await c.req.json().catch(() => ({}))) as SubscribeBody;
		const email = typeof body.email === "string" ? body.email.trim() : "";
		if (!isValidEmail(email)) {
			return c.json({ error: "invalid_email" }, 400);
		}
		const sourceIds = parseFollowedSourceIds(
			asStringList(body.sourceIds).join(",")
		);
		if (sourceIds.length === 0) {
			return c.json({ error: "no_sources", max: MAX_FOLLOWED_SOURCES }, 400);
		}
		const hour = Number(body.hour);
		const subscription: BriefingSubscription = {
			createdAt: Date.now(),
			email,
			hour: Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 8,
			id: newSubscriptionId(),
			keywords: parseKeywords(asStringList(body.keywords).join(",")),
			lang: normalizeTranslationLanguage(
				typeof body.lang === "string" ? body.lang : undefined
			),
			name:
				typeof body.name === "string" && body.name.trim()
					? body.name.trim().slice(0, MAX_NAME_CHARS)
					: "OpenTrends",
			sourceIds,
			tzOffsetMinutes: parseTzOffset(
				typeof body.tzOffsetMinutes === "number"
					? String(body.tzOffsetMinutes)
					: undefined
			),
		};
		if (!(await saveSubscription(subscription))) {
			return c.json({ error: "storage_unavailable" }, 503);
		}
		return c.json({ id: subscription.id }, 201);
	})
	.delete("/subscriptions/:id", async (c) => {
		await deleteSubscription(c.req.param("id"));
		return c.body(null, 204);
	})
	// The link in every mail; a GET so it works from any mail client.
	.get("/unsubscribe/:id", async (c) => {
		const id = c.req.param("id");
		const existing = await readSubscription(id);
		await deleteSubscription(id);
		return c.text(
			existing
				? `Unsubscribed ${existing.email} from "${existing.name}".`
				: "This subscription no longer exists.",
			200
		);
	});
