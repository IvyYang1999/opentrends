import { describe, expect, it } from "bun:test";

import { getWaitUntil } from "../../routes/trends";

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
});
