import { isEventEligibleSource } from "../config/sources";
import { getTopicPreset, topicPresets } from "../config/topics";
import type { SourceId, TopicId } from "../types";
import type { EventSourceItemRef } from "./event-content-enrichment";
import { rebuildTopicEvents } from "./event-feed";

const VOID_QUEUES_MODULE = ["void", "queues"].join("/");
const EVENT_MERGE_QUEUE_NAME = "event-merge";
const importRuntimeModule = (specifier: string): Promise<unknown> =>
	import(specifier);

export interface EventMergeMessage {
	items: EventSourceItemRef[];
	sourceId?: SourceId;
}

interface VoidQueueProducer {
	send: (message: EventMergeMessage) => Promise<void>;
}

interface VoidQueuesModule {
	queues?: Record<string, VoidQueueProducer | undefined>;
}

function getTopicsForSource(sourceId: SourceId): TopicId[] {
	const topicIds: TopicId[] = [];
	for (const [topicId, topic] of Object.entries(topicPresets)) {
		if (
			getTopicPreset(topicId) &&
			topic.sections.some((section) =>
				(section.sourceIds as readonly string[]).includes(sourceId)
			)
		) {
			topicIds.push(topicId as TopicId);
		}
	}
	return topicIds;
}

export async function runEventMergeJob(
	message: EventMergeMessage
): Promise<void> {
	if (message.sourceId && !isEventEligibleSource(message.sourceId)) {
		return;
	}
	const { enrichEventSourceItems } = await import("./event-content-enrichment");
	await enrichEventSourceItems(message.items);
	const topicIds = message.sourceId
		? getTopicsForSource(message.sourceId)
		: (Object.keys(topicPresets) as TopicId[]);
	for (const topicId of topicIds) {
		await rebuildTopicEvents(topicId);
	}
}

async function sendToVoidQueue(message: EventMergeMessage): Promise<boolean> {
	let module: VoidQueuesModule;
	try {
		module = (await importRuntimeModule(
			VOID_QUEUES_MODULE
		)) as VoidQueuesModule;
	} catch {
		return false;
	}
	try {
		const queue = module.queues?.[EVENT_MERGE_QUEUE_NAME];
		if (!queue) {
			return false;
		}
		await queue.send(message);
		return true;
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Cloudflare env is unavailable")
		) {
			return false;
		}
		console.warn("[event-merge] void queue dispatch failed", error);
		return false;
	}
}

export async function dispatchEventMergeJob(
	message: EventMergeMessage
): Promise<void> {
	if (
		message.items.length === 0 ||
		(message.sourceId && !isEventEligibleSource(message.sourceId))
	) {
		return;
	}
	if (await sendToVoidQueue(message)) {
		return;
	}
	await runEventMergeJob(message);
}
