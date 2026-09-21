import { describe, expect, test } from "bun:test";

import type { NewsItem, TopicPreset, TrendsPageData } from "../types";

function setServerEnv(): void {
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

		expect(prompt).toContain("Prompt version: top10-v1");
		expect(prompt).toContain(
			"[1] [OpenAI News] (published 2026-05-07) OpenAI ships a model update"
		);
		expect(prompt).toContain(
			"[2] [Example Feed] (fetched 2026-05-08) Feed item without a publish date"
		);
	});

	test("ends the prompt with a reminder in the target language", async () => {
		setServerEnv();
		const { buildPrompt, buildSystemPrompt } = await import(
			"../services/get-trends-summary"
		);

		const prompt = buildPrompt(topic, [], "zh");

		expect(prompt.trimEnd().endsWith("模型名保留原文。")).toBe(true);
		expect(buildSystemPrompt("zh")).toContain("Simplified Chinese");
		expect(buildSystemPrompt("zh")).toContain("at most 10 entries");
	});

	test("takes items from every source before giving any source a second slot", async () => {
		setServerEnv();
		const { collectCitedItems } = await import(
			"../services/get-trends-summary"
		);
		const now = Date.UTC(2026, 8, 21, 12);
		const page = makePage(
			Array.from({ length: 40 }, (_, index) => ({
				ageHours: [1, 2, 3, 4, 5, 6],
				sourceId: `source-${index}`,
			})),
			now
		);

		const cited = collectCitedItems(page, now);
		const sources = new Set(cited.map((entry) => entry.source));

		expect(cited).toHaveLength(60);
		expect(sources.size).toBe(40);
		expect(cited.map((entry) => entry.n)).toEqual(
			Array.from({ length: 60 }, (_, index) => index + 1)
		);
	});

	test("drops stale items and widens the window only for quiet topics", async () => {
		setServerEnv();
		const { collectCitedItems } = await import(
			"../services/get-trends-summary"
		);
		const now = Date.UTC(2026, 8, 21, 12);
		const busy = makePage(
			[
				...Array.from({ length: 12 }, (_, index) => ({
					ageHours: [1, 2, 3],
					sourceId: `fresh-${index}`,
				})),
				{ ageHours: [24 * 17, 24 * 30], sourceId: "stale" },
			],
			now
		);
		const quiet = makePage(
			[
				{ ageHours: [1], sourceId: "fresh" },
				{ ageHours: [24 * 3, 24 * 30], sourceId: "weekly" },
			],
			now
		);

		const busySources = collectCitedItems(busy, now).map(
			(entry) => entry.source
		);
		const quietIds = collectCitedItems(quiet, now).map(
			(entry) => entry.item.id
		);

		expect(busySources).not.toContain("stale");
		expect(quietIds).toEqual(["fresh-0", "weekly-0"]);
	});

	test("detects summaries that ignored the target language", async () => {
		setServerEnv();
		const { isWrittenInTargetLanguage } = await import(
			"../services/get-trends-summary"
		);

		expect(
			isWrittenInTargetLanguage(
				"AI's rapid advancement is triggering a global reckoning [1]",
				"zh"
			)
		).toBe(false);
		expect(
			isWrittenInTargetLanguage(
				"1. **Anthropic 推迟 IPO** — OpenAI 之后第二家头部实验室放缓上市 [7]",
				"zh"
			)
		).toBe(true);
		expect(isWrittenInTargetLanguage("Plain English text", "en")).toBe(true);
	});
});

function makePage(
	sources: { ageHours: number[]; sourceId: string }[],
	now: number
): TrendsPageData {
	return {
		description: "",
		id: "ai",
		sections: [
			{
				id: "news",
				sources: sources.map(({ ageHours, sourceId }) => ({
					homeUrl: "https://example.com",
					items: ageHours.map(
						(hours, index): NewsItem => ({
							fetchedAt: now,
							id: `${sourceId}-${index}`,
							publishedAt: now - hours * 60 * 60 * 1000,
							sourceId,
							title: `${sourceId} item ${index}`,
							url: `https://example.com/${sourceId}/${index}`,
						})
					),
					sourceId,
					status: "ok",
					title: sourceId,
				})),
				title: "News",
			},
		],
		title: "AI",
		updatedAt: now,
	} as unknown as TrendsPageData;
}
