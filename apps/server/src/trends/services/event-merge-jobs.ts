import { getWorkerBindings } from "../../runtime";
import { isEventEligibleSource } from "../config/sources";
import { getTopicPreset, topicPresets } from "../config/topics";
import type { SourceId, TopicId } from "../types";
import type { EventSourceItemRef } from "./event-content-enrichment";
import { rebuildTopicEvents } from "./event-feed";

export interface EventMergeMessage {
	items: EventSourceItemRef[];
	sourceId?: SourceId;
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

async function sendToCloudflareQueue(
	message: EventMergeMessage
): Promise<boolean> {
	const queue = getWorkerBindings()?.EVENT_MERGE_QUEUE;
	if (!queue) {
		return false;
	}
	try {
		await queue.send({ kind: "event-merge", payload: message });
		return true;
	} catch (error) {
		console.warn("[event-merge] Cloudflare queue dispatch failed", error);
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
	if (await sendToCloudflareQueue(message)) {
		return;
	}
	await runEventMergeJob(message);
}
