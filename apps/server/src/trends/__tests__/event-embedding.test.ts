import { describe, expect, it } from "bun:test";
import { runWithServerEnv } from "@opentrends/env/server";

import { embedTexts } from "../services/event-embedding";

describe("SiliconFlow event embeddings", () => {
	it("splits inputs into provider-sized batches", async () => {
		const originalFetch = globalThis.fetch;
		const batchSizes: number[] = [];
		globalThis.fetch = (_input, init) => {
			const payload = JSON.parse(String(init?.body)) as { input: string[] };
			batchSizes.push(payload.input.length);
			return Promise.resolve(
				Response.json({
					data: payload.input.map((_, index) => ({
						embedding: [index],
						index,
					})),
				})
			);
		};

		try {
			const vectors = await runWithServerEnv(
				{
					BETTER_AUTH_SECRET: "test".repeat(8),
					BETTER_AUTH_URL: "http://localhost:3000",
					CORS_ORIGIN: "http://localhost:3001",
					SILICONFLOW_API_KEY: "test-key",
				},
				() =>
					embedTexts(Array.from({ length: 10 }, (_, index) => `item-${index}`))
			);

			expect(batchSizes).toEqual([8, 2]);
			expect(vectors).toHaveLength(10);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
