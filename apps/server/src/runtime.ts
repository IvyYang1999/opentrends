import { AsyncLocalStorage } from "node:async_hooks";
import { runWithD1Database } from "@opentrends/db";
import { runWithServerEnv } from "@opentrends/env/server";

import type { EventMergeMessage } from "./trends/services/event-merge-jobs";
import type { SummaryPrewarmMessage } from "./trends/services/summary-prewarm-jobs";
import type { TranslationPrewarmMessage } from "./trends/services/translation-prewarm-jobs";

export type WorkerQueueMessage =
	| { kind: "event-merge"; payload: EventMergeMessage }
	| { kind: "summary-prewarm"; payload: SummaryPrewarmMessage }
	| { kind: "translation-prewarm"; payload: TranslationPrewarmMessage };

export interface WorkerBindings {
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	CORS_ORIGIN: string;
	DB: D1Database;
	EMAIL_API_KEY?: string;
	EMAIL_API_URL?: string;
	EMAIL_FROM?: string;
	EMAIL_PROVIDER?: "forward-email" | "resend";
	EVENT_MERGE_QUEUE: Queue<WorkerQueueMessage>;
	GITHUB_CLIENT_ID?: string;
	GITHUB_OAUTH_KEY?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_OAUTH_KEY?: string;
	HOT_CACHE: KVNamespace;
	IMAGES: ImagesBinding;
	LLM_API_KEY?: string;
	LLM_BASE_URL: string;
	LLM_ENABLE_THINKING?: "true" | "false";
	LLM_MODEL: string;
	LLM_TRANSLATION_MODEL?: string;
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
