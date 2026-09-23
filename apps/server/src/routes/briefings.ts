import { getAuth } from "@opentrends/auth";
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

interface BriefingUser {
	email: string;
	emailVerified: boolean;
	id: string;
}

type SubscriptionRecipient =
	| { email: string; userId: string }
	| {
			error:
				| "authentication_required"
				| "email_mismatch"
				| "verified_email_required";
	  };

export function resolveSubscriptionRecipient(
	user: BriefingUser | undefined,
	requestedEmail: unknown
): SubscriptionRecipient {
	if (!user) {
		return { error: "authentication_required" };
	}
	if (!(user.emailVerified && isValidEmail(user.email))) {
		return { error: "verified_email_required" };
	}
	if (
		typeof requestedEmail === "string" &&
		requestedEmail.trim() &&
		requestedEmail.trim().toLowerCase() !== user.email.toLowerCase()
	) {
		return { error: "email_mismatch" };
	}
	return { email: user.email, userId: user.id };
}

async function authenticatedUser(
	headers: Headers
): Promise<BriefingUser | undefined> {
	const session = await getAuth().api.getSession({ headers });
	return session?.user;
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
		const recipient = resolveSubscriptionRecipient(
			await authenticatedUser(c.req.raw.headers),
			body.email
		);
		if ("error" in recipient) {
			if (recipient.error === "authentication_required") {
				return c.json({ error: recipient.error }, 401);
			}
			return c.json({ error: recipient.error }, 403);
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
			email: recipient.email,
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
			userId: recipient.userId,
		};
		if (!(await saveSubscription(subscription))) {
			return c.json({ error: "storage_unavailable" }, 503);
		}
		return c.json({ id: subscription.id }, 201);
	})
	.delete("/subscriptions/:id", async (c) => {
		const user = await authenticatedUser(c.req.raw.headers);
		if (!user) {
			return c.json({ error: "authentication_required" }, 401);
		}
		const id = c.req.param("id");
		const existing = await readSubscription(id);
		if (!existing) {
			return c.body(null, 204);
		}
		if (existing.userId !== user.id) {
			return c.json({ error: "subscription_not_found" }, 404);
		}
		await deleteSubscription(id);
		return c.body(null, 204);
	})
	// A signed capability link is included in every message. POST supports
	// RFC 8058 one-click unsubscribe; GET remains usable from ordinary clients.
	.on(["GET", "POST"], "/unsubscribe/:id", async (c) => {
		const id = c.req.param("id");
		const existing = await readSubscription(id);
		await deleteSubscription(id);
		return c.text(
			existing
				? `Unsubscribed from "${existing.name}".`
				: "This subscription no longer exists.",
			200
		);
	});
