import { defineQueue } from "void";

import {
	type EventMergeMessage,
	runEventMergeJob,
} from "../src/trends/services/event-merge-jobs";

export const maxBatchSize = 1;
export const maxBatchTimeout = 5;
export const maxRetries = 3;
export const retryDelay = 120;

export default defineQueue<EventMergeMessage>(async (batch) => {
	for (const message of batch.messages) {
		try {
			await runEventMergeJob(message.body);
			message.ack();
		} catch (error) {
			console.warn("[event-merge] queue message failed", error);
			message.retry({ delaySeconds: retryDelay });
		}
	}
});
