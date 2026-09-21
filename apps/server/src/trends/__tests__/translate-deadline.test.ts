import { describe, expect, test } from "bun:test";

import type { TranslationCandidate } from "../services/translate-news-items";

function setServerEnv(): void {
	process.env.BETTER_AUTH_SECRET = "x".repeat(32);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.CORS_ORIGIN = "http://localhost:3001";
	process.env.TRENDS_REFRESH_SCHEDULER = "disabled";
}

function makeCandidates(count: number): TranslationCandidate[] {
	return Array.from({ length: count }, (_, index) => ({
		cacheKey: `zh:source:${index}:hash`,
		item: {
			fetchedAt: 0,
			id: String(index),
			sourceId: "source",
			title: `Title ${index}`,
			url: `https://example.com/${index}`,
		},
		sourceId: "source",
		textHash: "hash",
	}));
}

describe("sync translation deadline", () => {
	test("returns on time and lets in-flight batches finish for the cache", async () => {
		setServerEnv();
		const { translateMissingWithinTimeout } = await import(
			"../services/translate-news-items"
		);
		const finishedBatches: number[] = [];
		const background: Promise<unknown>[] = [];
		let aborted = false;

		// 18 candidates = 3 batches of 6; two run concurrently and each takes
		// longer than the 20ms deadline.
		const started = Date.now();
		const result = await translateMissingWithinTimeout(
			"zh",
			makeCandidates(18),
			20,
			{ waitUntil: (promise) => background.push(promise) },
			async (_lang, batch, signal) => {
				signal?.addEventListener("abort", () => {
					aborted = true;
				});
				await new Promise((resolve) => setTimeout(resolve, 80));
				finishedBatches.push(batch.length);
				return [];
			}
		);

		expect(Date.now() - started).toBeLessThan(70);
		expect(result).toEqual([]);
		expect(finishedBatches).toEqual([]);
		expect(background).toHaveLength(1);

		await Promise.all(background);

		// The two batches that were in flight completed; the third never started.
		expect(finishedBatches).toEqual([6, 6]);
		expect(aborted).toBe(false);
	});
});
