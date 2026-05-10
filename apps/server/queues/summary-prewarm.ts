import { defineQueue } from "void";

import {
	runSummaryPrewarmJob,
	type SummaryPrewarmMessage,
} from "../src/trends/services/summary-prewarm-jobs";

export const maxBatchSize = 2;
export const maxBatchTimeout = 5;
export const maxRetries = 3;
export const retryDelay = 60;

export default defineQueue<SummaryPrewarmMessage>(async (batch) => {
	for (const message of batch.messages) {
		try {
			await runSummaryPrewarmJob(message.body);
			message.ack();
		} catch (error) {
			console.warn("[trends-summary] prewarm queue message failed", error);
			message.retry({ delaySeconds: retryDelay });
		}
	}
});
