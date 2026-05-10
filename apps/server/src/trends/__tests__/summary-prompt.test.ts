import { describe, expect, test } from "bun:test";

import type { TopicPreset } from "../types";

function setServerEnv(): void {
	process.env.DATABASE_URL =
		"postgresql://postgres:password@localhost:5432/test";
	process.env.BETTER_AUTH_SECRET = "x".repeat(32);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.CORS_ORIGIN = "http://localhost:3001";
	process.env.LLM_BASE_URL = "https://example.com/v1";
	process.env.LLM_MODEL = "test-model";
	process.env.TRENDS_REFRESH_SCHEDULER = "disabled";
}

const topic: TopicPreset = {
	description: "Artificial intelligence updates",
	sections: [],
	title: "AI",
};

describe("trends summary prompt", () => {
	test("includes source item dates so summaries can prioritize recent updates", async () => {
		setServerEnv();
		const { buildPrompt } = await import("../services/get-trends-summary");

		const prompt = buildPrompt(topic, [
			{
				n: 1,
				source: "OpenAI News",
				item: {
					description: "A new model release",
					fetchedAt: Date.UTC(2026, 4, 8, 8),
					id: "openai-1",
					publishedAt: Date.UTC(2026, 4, 7, 12),
					sourceId: "openai-news",
					title: "OpenAI ships a model update",
					url: "https://example.com/openai",
				},
			},
			{
				n: 2,
				source: "Example Feed",
				item: {
					fetchedAt: Date.UTC(2026, 4, 8, 8),
					id: "feed-1",
					sourceId: "example-feed",
					title: "Feed item without a publish date",
					url: "https://example.com/feed",
				},
			},
		]);

		expect(prompt).toContain("Prompt version: summary-date-v1");
		expect(prompt).toContain("Prioritize newer dated items");
		expect(prompt).toContain(
			"[1] [OpenAI News] (published 2026-05-07) OpenAI ships a model update"
		);
		expect(prompt).toContain(
			"[2] [Example Feed] (fetched 2026-05-08) Feed item without a publish date"
		);
	});
});
