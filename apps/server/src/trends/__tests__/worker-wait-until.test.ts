import { describe, expect, it } from "bun:test";
import { getDb } from "@opentrends/db";

import { getWaitUntil, textStreamFromGenerator } from "../../routes/trends";
import {
	captureWorkerContext,
	getWorkerBindings,
	runWithWorkerBindings,
	type WorkerBindings,
} from "../../runtime";

function createBindings(): WorkerBindings {
	const queue = { send: () => Promise.resolve() } as Queue;
	return {
		BETTER_AUTH_SECRET: "test".repeat(8),
		BETTER_AUTH_URL: "http://localhost:3000",
		CORS_ORIGIN: "http://localhost:3001",
		DB: {} as D1Database,
		EVENT_MERGE_QUEUE: queue,
		HOT_CACHE: {} as KVNamespace,
		LLM_BASE_URL: "https://example.com/v1",
		LLM_MODEL: "test-model",
		NODE_ENV: "test",
		SILICONFLOW_EMBEDDING_MODEL: "test-embedding-model",
		SUMMARY_PREWARM_QUEUE: queue,
		TRENDS_REFRESH_SCHEDULER: "disabled",
	};
}

describe("Worker background task wiring", () => {
	it("forwards work to the Cloudflare execution context", async () => {
		let observed: Promise<unknown> | undefined;
		const waitUntil = getWaitUntil({
			executionCtx: {
				waitUntil(promise) {
					observed = promise;
				},
			},
		});
		const task = Promise.resolve("done");

		waitUntil?.(task);

		expect(observed).toBe(task);
		expect(await observed).toBe("done");
	});

	it("keeps Worker bindings available while streaming after the handler returns", async () => {
		const bindings = createBindings();
		let observedBindings: WorkerBindings | undefined;
		let observedDatabase = false;

		async function* generate() {
			await Promise.resolve();
			observedBindings = getWorkerBindings();
			observedDatabase = Boolean(getDb());
			yield "summary";
		}

		const stream = runWithWorkerBindings(bindings, () =>
			textStreamFromGenerator(generate())
		);
		const body = await new Response(stream).text();

		expect(body).toBe(" summary");
		expect(observedBindings).toBe(bindings);
		expect(observedDatabase).toBe(true);
	});

	it("can re-enter a captured Worker context after the request callback returns", () => {
		const bindings = createBindings();
		const runInCapturedContext = runWithWorkerBindings(bindings, () =>
			captureWorkerContext()
		);

		expect(getWorkerBindings()).toBeUndefined();
		runInCapturedContext(() => {
			expect(getWorkerBindings()).toBe(bindings);
			expect(getDb()).toBeTruthy();
		});
		expect(getWorkerBindings()).toBeUndefined();
	});
});
