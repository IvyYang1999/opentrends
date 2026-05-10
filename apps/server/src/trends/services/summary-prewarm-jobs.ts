import type { TopicId } from "../types";
import { refreshTrendsSummaryCache } from "./get-trends-summary";
import type { TranslationLanguage } from "./translate-news-items";

const VOID_QUEUES_MODULE = ["void", "queues"].join("/");
const SUMMARY_PREWARM_QUEUE_NAME = "summary-prewarm";
const importRuntimeModule = new Function(
	"specifier",
	"return import(specifier)"
) as (specifier: string) => Promise<unknown>;

export interface SummaryPrewarmMessage {
	lang: TranslationLanguage;
	topicId: TopicId;
}

interface VoidQueueProducer {
	send: (message: SummaryPrewarmMessage) => Promise<void>;
}

interface VoidQueuesModule {
	queues?: Record<string, VoidQueueProducer | undefined>;
}

export async function runSummaryPrewarmJob(
	message: SummaryPrewarmMessage
): Promise<void> {
	await refreshTrendsSummaryCache(message.topicId, message.lang);
}

async function sendToVoidQueue(
	message: SummaryPrewarmMessage
): Promise<boolean> {
	let module: VoidQueuesModule;
	try {
		module = (await importRuntimeModule(
			VOID_QUEUES_MODULE
		)) as VoidQueuesModule;
	} catch {
		return false;
	}
	const queue = module.queues?.[SUMMARY_PREWARM_QUEUE_NAME];
	if (!queue) {
		return false;
	}
	try {
		await queue.send(message);
		return true;
	} catch (error) {
		console.warn("[trends-summary] void queue dispatch failed", error);
		return false;
	}
}

export async function dispatchSummaryPrewarmJob(
	message: SummaryPrewarmMessage
): Promise<void> {
	if (await sendToVoidQueue(message)) {
		return;
	}
	await runSummaryPrewarmJob(message);
}
