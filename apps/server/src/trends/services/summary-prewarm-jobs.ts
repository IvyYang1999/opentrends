import { getWorkerBindings } from "../../runtime";
import { hotCache } from "../cache/hot-cache";
import {
	type FOLLOWED_TOPIC_ID,
	followedSourcesKey,
} from "../config/followed-topic";
import { topicPresets } from "../config/topics";
import type { SourceId, TopicId } from "../types";
import {
	hasFreshHotSummaryCache,
	isTrendsSummaryConfigured,
	refreshTrendsSummaryCache,
	type SummaryWindow,
} from "./get-trends-summary";
import type { TranslationLanguage } from "./translate-news-items";

export const SUMMARY_PREWARM_LANGUAGES: readonly TranslationLanguage[] = [
	"zh",
	"en",
];
export const SUMMARY_PREWARM_WINDOWS: readonly SummaryWindow[] = [
	"today",
	"week",
	"month",
];

export interface SummaryPrewarmMessage {
	lang: TranslationLanguage;
	// Followed sources when topicId is the "mine" pseudo-topic.
	sourceIds?: SourceId[];
	topicId: TopicId | typeof FOLLOWED_TOPIC_ID;
	// Optional so queue messages written by the previous deployment still work.
	window?: SummaryWindow;
}

const SUMMARY_RECONCILE_DISPATCH_LIMIT = 6;
const SUMMARY_REQUEST_COOLDOWN_MS = 15 * 60_000;

interface SummaryPrewarmReconcileDependencies {
	hasFreshHotSummaryCache: typeof hasFreshHotSummaryCache;
	isConfigured: typeof isTrendsSummaryConfigured;
	requestJob: typeof requestSummaryPrewarmJob;
}

function messagesForTopic(topicId: TopicId): SummaryPrewarmMessage[] {
	const messages: SummaryPrewarmMessage[] = [];
	for (const lang of SUMMARY_PREWARM_LANGUAGES) {
		for (const window of SUMMARY_PREWARM_WINDOWS) {
			messages.push({ lang, topicId, window });
		}
	}
	return messages;
}

export function summaryPrewarmMessagesForAllTopics(): SummaryPrewarmMessage[] {
	const topicIds = Object.keys(topicPresets) as TopicId[];
	const prioritizedTopicIds = [
		"ai" as TopicId,
		...topicIds.filter((topicId) => topicId !== "ai"),
	];
	return prioritizedTopicIds.flatMap(messagesForTopic);
}

export function summaryPrewarmMessagesForSource(
	sourceId: SourceId
): SummaryPrewarmMessage[] {
	const messages: SummaryPrewarmMessage[] = [];
	for (const [topicId, topic] of Object.entries(topicPresets) as [
		TopicId,
		(typeof topicPresets)[keyof typeof topicPresets],
	][]) {
		if (
			!topic.sections.some((section) =>
				(section.sourceIds as readonly SourceId[]).includes(sourceId)
			)
		) {
			continue;
		}
		messages.push(...messagesForTopic(topicId));
	}
	return messages;
}

function summaryPrewarmMessageKey(message: SummaryPrewarmMessage): string {
	const topic = message.sourceIds
		? `${message.topicId}:${followedSourcesKey(message.sourceIds)}`
		: message.topicId;
	return `${topic}:${message.lang}:${message.window ?? "today"}`;
}

export function summaryPrewarmMessagesForSources(
	sourceIds: readonly SourceId[]
): SummaryPrewarmMessage[] {
	const messages = new Map<string, SummaryPrewarmMessage>();
	for (const sourceId of sourceIds) {
		for (const message of summaryPrewarmMessagesForSource(sourceId)) {
			messages.set(summaryPrewarmMessageKey(message), message);
		}
	}
	return [...messages.values()];
}

export async function runSummaryPrewarmJob(
	message: SummaryPrewarmMessage
): Promise<void> {
	await refreshTrendsSummaryCache(
		message.topicId,
		message.lang,
		message.window ?? "today",
		message.sourceIds
	);
	await hotCache.delete(summaryRequestMarkerKey(message));
}

async function sendToCloudflareQueue(
	message: SummaryPrewarmMessage
): Promise<boolean> {
	const queue = getWorkerBindings()?.SUMMARY_PREWARM_QUEUE;
	if (!queue) {
		return false;
	}
	try {
		await queue.send({ kind: "summary-prewarm", payload: message });
		return true;
	} catch (error) {
		console.warn("[trends-summary] Cloudflare queue dispatch failed", error);
		return false;
	}
}

export async function dispatchSummaryPrewarmJob(
	message: SummaryPrewarmMessage
): Promise<void> {
	if (await sendToCloudflareQueue(message)) {
		return;
	}
	await runSummaryPrewarmJob(message);
}

function summaryRequestMarkerKey(message: SummaryPrewarmMessage): string {
	return `trends:v1:summary-prewarm-request:${summaryPrewarmMessageKey(message)}`;
}

export async function requestSummaryPrewarmJob(
	message: SummaryPrewarmMessage
): Promise<boolean> {
	const now = Date.now();
	const key = summaryRequestMarkerKey(message);
	const existing = await hotCache.get<boolean>(key);
	if (existing && existing.freshUntil > now) {
		return false;
	}
	await hotCache.put(
		key,
		{
			createdAt: now,
			freshUntil: now + SUMMARY_REQUEST_COOLDOWN_MS,
			schemaVersion: 1,
			staleUntil: now + SUMMARY_REQUEST_COOLDOWN_MS,
			value: true,
		},
		Math.ceil(SUMMARY_REQUEST_COOLDOWN_MS / 1000)
	);
	try {
		await dispatchSummaryPrewarmJob(message);
		return true;
	} catch (error) {
		await hotCache.delete(key);
		console.warn("[trends-summary] request prewarm failed", error);
		return false;
	}
}

function summaryCacheTopicId(message: SummaryPrewarmMessage): string {
	return message.window && message.window !== "today"
		? `${message.topicId}#${message.window}`
		: message.topicId;
}

export async function reconcileMissingSummaryPrewarms(
	changedSourceIds: readonly SourceId[] = [],
	dependencies: SummaryPrewarmReconcileDependencies = {
		hasFreshHotSummaryCache,
		isConfigured: isTrendsSummaryConfigured,
		requestJob: requestSummaryPrewarmJob,
	}
): Promise<void> {
	if (!dependencies.isConfigured()) {
		return;
	}
	const changed = summaryPrewarmMessagesForSources(changedSourceIds);
	const candidates = new Map<string, SummaryPrewarmMessage>();
	for (const message of [...changed, ...summaryPrewarmMessagesForAllTopics()]) {
		candidates.set(summaryPrewarmMessageKey(message), message);
	}
	const missing = (
		await Promise.all(
			[...candidates.values()].map(async (message) => {
				const cached = await dependencies.hasFreshHotSummaryCache(
					summaryCacheTopicId(message),
					message.lang
				);
				return cached ? null : message;
			})
		)
	).filter((message) => message !== null);

	let dispatched = 0;
	for (const message of missing) {
		if (await dependencies.requestJob(message)) {
			dispatched += 1;
		}
		if (dispatched >= SUMMARY_RECONCILE_DISPATCH_LIMIT) {
			break;
		}
	}
}
