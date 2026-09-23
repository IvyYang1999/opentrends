import { env } from "@opentrends/env/server";

import { getWorkerBindings } from "../../runtime";
import { type CacheEnvelope, hotCache } from "../cache/hot-cache";
import type { SourceId } from "../types";
import { parseDigestEntries } from "./digest-json";
import { dayKey } from "./get-calendar";
import {
	prepareTrendsSummary,
	TrendsSummaryNoMatchesError,
	TrendsSummaryNotConfiguredError,
} from "./get-trends-summary";
import type { TranslationLanguage } from "./translate-news-items";

// A briefing a reader asked to receive by mail: the same sources and
// keywords as on the page, plus an address and an hour. Kept in KV under
// one prefix so the scheduler can walk them; each is sent once per local
// day at its hour. The id doubles as the unsubscribe token.

export interface BriefingSubscription {
	createdAt: number;
	email: string;
	hour: number;
	id: string;
	keywords: string[];
	lang: TranslationLanguage;
	lastSentDay?: string;
	name: string;
	sourceIds: SourceId[];
	tzOffsetMinutes: number;
	userId: string;
}

const KEY_PREFIX = "trends:v2:briefing-sub:";
const SUBSCRIPTION_TTL_SECONDS = 400 * 24 * 60 * 60;
const SCHEMA_VERSION = 2;
const MAX_SUBSCRIPTIONS_PER_TICK = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_DOMAIN_RE = /^[a-z0-9.-]+$/;
const DELIVERY_KEY_PREFIX = "trends:v1:briefing-delivery:";
const DELIVERY_TTL_SECONDS = 2 * 24 * 60 * 60;
const DELIVERY_RETRY_DELAY_MS = 30 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 3;

export interface DeliveryMarker {
	attempts: number;
	state: "failed" | "sending" | "sent";
	updatedAt: number;
}

type DeliveryDecision = "already-sent" | "send" | "stop" | "wait";
type DeliveryResult = Exclude<DeliveryDecision, "send"> | "sent";

export function deliveryAttemptDecision(
	marker: DeliveryMarker | undefined,
	now: number
): DeliveryDecision {
	if (!marker) {
		return "send";
	}
	if (marker.state === "sent") {
		return "already-sent";
	}
	if (marker.attempts >= MAX_DELIVERY_ATTEMPTS) {
		return "stop";
	}
	return now - marker.updatedAt < DELIVERY_RETRY_DELAY_MS ? "wait" : "send";
}

function deliveryKey(subscriptionId: string, day: string): string {
	return `${DELIVERY_KEY_PREFIX}${subscriptionId}:${day}`;
}

function writeDeliveryMarker(
	keyName: string,
	marker: DeliveryMarker
): Promise<boolean> {
	return hotCache.put(
		keyName,
		{
			createdAt: marker.updatedAt,
			freshUntil: marker.updatedAt + DELIVERY_TTL_SECONDS * 1000,
			schemaVersion: 1,
			staleUntil: marker.updatedAt + DELIVERY_TTL_SECONDS * 1000,
			value: marker,
		},
		DELIVERY_TTL_SECONDS
	);
}

export function isValidEmail(value: string): boolean {
	return EMAIL_RE.test(value) && value.length <= 254;
}

export function newSubscriptionId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function key(id: string): string {
	return `${KEY_PREFIX}${id}`;
}

export function saveSubscription(
	subscription: BriefingSubscription
): Promise<boolean> {
	const now = Date.now();
	const envelope: CacheEnvelope<BriefingSubscription> = {
		createdAt: subscription.createdAt,
		freshUntil: now + SUBSCRIPTION_TTL_SECONDS * 1000,
		schemaVersion: SCHEMA_VERSION,
		staleUntil: now + SUBSCRIPTION_TTL_SECONDS * 1000,
		value: subscription,
	};
	return hotCache.put(key(subscription.id), envelope, SUBSCRIPTION_TTL_SECONDS);
}

export async function readSubscription(
	id: string
): Promise<BriefingSubscription | null> {
	const envelope = await hotCache.get<BriefingSubscription>(key(id));
	return envelope?.schemaVersion === SCHEMA_VERSION ? envelope.value : null;
}

export async function deleteSubscription(id: string): Promise<void> {
	await hotCache.delete(key(id));
}

async function listSubscriptionIds(): Promise<string[]> {
	const kv = getWorkerBindings()?.HOT_CACHE;
	if (!kv) {
		return [];
	}
	const ids: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await kv.list({ cursor, prefix: KEY_PREFIX });
		ids.push(...page.keys.map((entry) => entry.name.slice(KEY_PREFIX.length)));
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return ids;
}

export function isEmailConfigured(): boolean {
	return Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM);
}

interface OutboundEmail {
	html: string;
	messageId: string;
	subject: string;
	text: string;
	to: string;
	unsubscribeUrl: string;
}

export function briefingMessageId(params: {
	day: string;
	from: string;
	subscriptionId: string;
}): string {
	const domain = params.from
		.slice(params.from.lastIndexOf("@") + 1)
		.toLowerCase();
	if (!EMAIL_DOMAIN_RE.test(domain)) {
		throw new Error("Email sender must be a bare address.");
	}
	return `<briefing.${params.day}.${params.subscriptionId}@${domain}>`;
}

export function createEmailProviderRequest(params: {
	apiUrl: string;
	credential: string;
	from: string;
	message: OutboundEmail;
	provider: "forward-email" | "resend";
}): { init: RequestInit; url: string } {
	const { unsubscribeUrl, ...message } = params.message;
	const authorization =
		params.provider === "resend"
			? `Bearer ${params.credential}`
			: `Basic ${btoa(`${params.credential}:`)}`;
	return {
		init: {
			body: JSON.stringify({
				from: params.from,
				headers: {
					"List-Unsubscribe": `<${unsubscribeUrl}>`,
					"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
				},
				...message,
			}),
			headers: {
				Authorization: authorization,
				"Content-Type": "application/json",
			},
			method: "POST",
		},
		url: params.apiUrl,
	};
}

export async function sendEmail(message: OutboundEmail): Promise<void> {
	if (!(env.EMAIL_API_KEY && env.EMAIL_FROM)) {
		throw new Error("Email delivery is not configured.");
	}
	const request = createEmailProviderRequest({
		apiUrl: env.EMAIL_API_URL,
		credential: env.EMAIL_API_KEY,
		from: env.EMAIL_FROM,
		message,
		provider: env.EMAIL_PROVIDER,
	});
	const response = await fetch(request.url, request.init);
	if (!response.ok) {
		throw new Error(`Email provider answered ${response.status}.`);
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function renderBriefingEmail(params: {
	day: string;
	entries: ReturnType<typeof parseDigestEntries>;
	name: string;
	unsubscribeUrl: string;
}): { html: string; subject: string; text: string } {
	const subject = `${params.name} · ${params.day}`;
	const lines = params.entries.map((entry) => {
		const links = entry.citations
			.map(
				(citation, index) =>
					`<a href="${escapeHtml(citation.url)}" style="color:#2a5bd7;text-decoration:none">[${index + 1}]</a>`
			)
			.join(" ");
		const reason = entry.reason
			? ` <span style="color:#555">— ${escapeHtml(entry.reason)}</span>`
			: "";
		return `<li style="margin:0 0 10px"><strong>${escapeHtml(entry.takeaway)}</strong>${reason} ${links}</li>`;
	});
	const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.55">
<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(subject)}</h1>
<ol style="padding-left:20px;margin:0">${lines.join("")}</ol>
<p style="margin:24px 0 0;font-size:12px;color:#888">OpenTrends · <a href="https://opentrends.io/briefings" style="color:#888">opentrends.io/briefings</a> · <a href="${escapeHtml(params.unsubscribeUrl)}" style="color:#888">unsubscribe</a></p>
</div>`;
	const text = [
		subject,
		"",
		...params.entries.map(
			(entry, index) =>
				`${index + 1}. ${entry.takeaway}${entry.reason ? ` — ${entry.reason}` : ""}\n   ${entry.citations.map((citation) => citation.url).join(" ")}`
		),
		"",
		`Unsubscribe: ${params.unsubscribeUrl}`,
	].join("\n");
	return { html, subject, text };
}

async function deliver(
	subscription: BriefingSubscription,
	day: string
): Promise<DeliveryResult> {
	const now = Date.now();
	const markerKey = deliveryKey(subscription.id, day);
	const previous = await hotCache.get<DeliveryMarker>(markerKey);
	const decision = deliveryAttemptDecision(previous?.value, now);
	if (decision !== "send") {
		return decision;
	}
	const attempts = (previous?.value.attempts ?? 0) + 1;
	if (
		!(await writeDeliveryMarker(markerKey, {
			attempts,
			state: "sending",
			updatedAt: now,
		}))
	) {
		throw new Error("Could not reserve briefing delivery.");
	}
	try {
		const prepared = await prepareTrendsSummary("mine", subscription.lang, {
			keywords: subscription.keywords,
			sourceIds: subscription.sourceIds,
			window: "today",
		});
		let markdown = "";
		for await (const chunk of prepared.stream(new AbortController().signal)) {
			markdown += chunk;
		}
		const entries = parseDigestEntries(markdown, prepared.citations);
		if (entries.length === 0) {
			await writeDeliveryMarker(markerKey, {
				attempts,
				state: "sent",
				updatedAt: Date.now(),
			});
			return "already-sent";
		}
		const unsubscribeUrl = `${env.BETTER_AUTH_URL}/api/briefings/unsubscribe/${subscription.id}`;
		const message = renderBriefingEmail({
			day,
			entries,
			name: subscription.name,
			unsubscribeUrl,
		});
		await sendEmail({
			...message,
			messageId: briefingMessageId({
				day,
				from: env.EMAIL_FROM ?? "",
				subscriptionId: subscription.id,
			}),
			to: subscription.email,
			unsubscribeUrl,
		});
		// The provider has already accepted the message. A marker write failure
		// must not turn that success into a retry and send the same digest twice.
		await writeDeliveryMarker(markerKey, {
			attempts,
			state: "sent",
			updatedAt: Date.now(),
		});
		return "sent";
	} catch (error) {
		await writeDeliveryMarker(markerKey, {
			attempts,
			state: "failed",
			updatedAt: Date.now(),
		});
		throw error;
	}
}

// Called from the scheduler: every subscription whose local hour is now
// and which has not gone out today gets its digest. One failure does not
// stop the others; a failed one is tried again on the next tick.
export async function runBriefingDeliveryTick(now: number): Promise<number> {
	if (!isEmailConfigured()) {
		return 0;
	}
	const ids = (await listSubscriptionIds()).slice(
		0,
		MAX_SUBSCRIPTIONS_PER_TICK
	);
	let sent = 0;
	for (const id of ids) {
		const subscription = await readSubscription(id);
		if (!subscription) {
			continue;
		}
		const localDay = dayKey(now, subscription.tzOffsetMinutes);
		const localHour = new Date(
			now + subscription.tzOffsetMinutes * 60_000
		).getUTCHours();
		if (
			localHour !== subscription.hour ||
			subscription.lastSentDay === localDay
		) {
			continue;
		}
		try {
			const result = await deliver(subscription, localDay);
			if (result === "wait") {
				continue;
			}
			await saveSubscription({ ...subscription, lastSentDay: localDay });
			if (result === "sent") {
				sent += 1;
			}
		} catch (error) {
			if (
				error instanceof TrendsSummaryNoMatchesError ||
				error instanceof TrendsSummaryNotConfiguredError
			) {
				await saveSubscription({ ...subscription, lastSentDay: localDay });
				continue;
			}
			console.warn("[briefings] delivery failed", { error, id });
		}
	}
	return sent;
}
