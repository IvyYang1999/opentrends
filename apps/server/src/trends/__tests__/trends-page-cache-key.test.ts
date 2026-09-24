import { describe, expect, test } from "bun:test";

function setServerEnv(): void {
	process.env.BETTER_AUTH_SECRET = "x".repeat(32);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.CORS_ORIGIN = "http://localhost:3001";
	process.env.TRENDS_REFRESH_SCHEDULER = "disabled";
}

describe("trends page cache invalidation", () => {
	test("targets both public page sizes for the translated source and language", async () => {
		setServerEnv();
		const { translationPageCacheKeysForSource } = await import(
			"../services/get-trends-page"
		);

		expect(translationPageCacheKeysForSource("openai-news", "zh")).toEqual([
			"trends:v5:page:ai:zh:background:16",
			"trends:v5:page:ai:zh:background:30",
		]);
	});
});
