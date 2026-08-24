import { AsyncLocalStorage } from "node:async_hooks";
import { runWithD1Database } from "@opentrends/db";
import { runWithServerEnv } from "@opentrends/env/server";

import type { EventMergeMessage } from "./trends/services/event-merge-jobs";
import type { SummaryPrewarmMessage } from "./trends/services/summary-prewarm-jobs";

export type WorkerQueueMessage =
	| { kind: "event-merge"; payload: EventMergeMessage }
	| { kind: "summary-prewarm"; payload: SummaryPrewarmMessage };

export interface WorkerBindings {
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	CORS_ORIGIN: string;
	DB: D1Database;
	EVENT_MERGE_QUEUE: Queue<WorkerQueueMessage>;
	HOT_CACHE: KVNamespace;
	LLM_API_KEY?: string;
	LLM_BASE_URL: string;
	LLM_MODEL: string;
	NODE_ENV: "development" | "production" | "test";
	RSSHUB_BASE_URLS?: string;
	SILICONFLOW_API_KEY?: string;
	SILICONFLOW_EMBEDDING_MODEL: string;
	SUMMARY_PREWARM_QUEUE: Queue<WorkerQueueMessage>;
	TRENDS_REFRESH_SCHEDULER: "auto" | "disabled" | "enabled";
	[key: string]: unknown;
}

const workerContext = new AsyncLocalStorage<WorkerBindings>();

export function getWorkerBindings(): WorkerBindings | undefined {
	return workerContext.getStore();
}

export function runWithWorkerBindings<T>(
	bindings: WorkerBindings,
	callback: () => T
): T {
	return runWithServerEnv(bindings, () =>
		runWithD1Database(bindings.DB, () => workerContext.run(bindings, callback))
	);
}

export type WorkerContextRunner = <T>(callback: () => T) => T;

export function captureWorkerContext(): WorkerContextRunner {
	const bindings = getWorkerBindings();
	if (!bindings) {
		return (callback) => callback();
	}
	return (callback) => runWithWorkerBindings(bindings, callback);
}
