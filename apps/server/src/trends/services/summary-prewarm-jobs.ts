import { getWorkerBindings } from "../../runtime";
import type { TopicId } from "../types";
import { refreshTrendsSummaryCache } from "./get-trends-summary";
import type { TranslationLanguage } from "./translate-news-items";

export interface SummaryPrewarmMessage {
	lang: TranslationLanguage;
	topicId: TopicId;
}

export async function runSummaryPrewarmJob(
	message: SummaryPrewarmMessage
): Promise<void> {
	await refreshTrendsSummaryCache(message.topicId, message.lang);
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
