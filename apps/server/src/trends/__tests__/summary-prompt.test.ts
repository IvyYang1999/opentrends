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

		expect(prompt).toContain("Prompt version: top10-v2");
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
		expect(buildSystemPrompt("zh")).toContain(
			"Never include the same real-world event twice"
		);
	});

	test("gives the featured digest explicit cross-topic evidence and balance rules", async () => {
		setServerEnv();
		const { buildPrompt, buildSystemPrompt } = await import(
			"../services/get-trends-summary"
		);
		const cited = [
			{
				n: 1,
				source: "OpenAI News",
				item: {
					fetchedAt: Date.UTC(2026, 8, 23, 8),
					id: "ai-1",
					sourceId: "openai-news",
					title: "AI story",
					url: "https://example.com/ai",
				},
			},
		];

		const prompt = buildPrompt(topic, cited, "zh", "today", "cross-topic");
		expect(prompt).toContain("Selection mode: cross-topic-balanced-v1");
		expect(prompt).toContain("[Topic: ai]");
		expect(buildSystemPrompt("zh", "today", "cross-topic")).toContain(
			"first five entries must cover at least 3 different topics"
		);
	});

	test("rejects a featured draft whose visible first five are all AI", async () => {
		setServerEnv();
		const { isCrossTopicDigestDiverse } = await import(
			"../services/get-trends-summary"
		);
		const citations = [
			...Array.from({ length: 5 }, (_, index) => ({
				n: index + 1,
				topic: "ai",
				url: `https://example.com/ai-${index}`,
			})),
			{ n: 6, topic: "hardware", url: "https://example.com/hardware" },
			{ n: 7, topic: "programming", url: "https://example.com/code" },
			{ n: 8, topic: "cn", url: "https://example.com/cn" },
		];
		const allAiFirst = Array.from(
			{ length: 5 },
			(_, index) => `${index + 1}. **AI ${index + 1}** — why [${index + 1}]`
		).join("\n");
		const balanced = [
			"1. **AI** — why [1]",
			"2. **Hardware** — why [6]",
			"3. **Code** — why [7]",
			"4. **AI 2** — why [2]",
			"5. **China** — why [8]",
		].join("\n");

		expect(isCrossTopicDigestDiverse(allAiFirst, citations)).toBe(false);
		expect(isCrossTopicDigestDiverse(balanced, citations)).toBe(true);
	});

	test("builds a bounded cross-topic fallback when the model ignores balance", async () => {
		setServerEnv();
		const { buildCrossTopicFallbackSummary, isCrossTopicDigestDiverse } =
			await import("../services/get-trends-summary");
		const sourceIds = [
			"openai-news",
			"ros-discourse",
			"toms-hardware",
			"nature-bmi",
			"github-trending",
			"weibo",
		] as const;
		const cited = sourceIds.map((sourceId, index) => ({
			n: index + 1,
			source: sourceId,
			item: {
				fetchedAt: Date.UTC(2026, 8, 23, 8 - index),
				id: `${sourceId}-1`,
				sourceId,
				title: `Story ${index + 1}`,
				url: `https://example.com/${sourceId}`,
			},
		}));
		const text = buildCrossTopicFallbackSummary(cited, "zh");
		const citations = cited.map(({ item, n }) => ({
			n,
			topic: ["ai", "embodied", "hardware", "biotech", "programming", "cn"][
				n - 1
			],
			url: item.url,
		}));

		expect(text.split("\n")).toHaveLength(6);
		expect(isCrossTopicDigestDiverse(text, citations)).toBe(true);
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

		expect(cited).toHaveLength(80);
		expect(sources.size).toBe(40);
		expect(cited.map((entry) => entry.n)).toEqual(
			Array.from({ length: 80 }, (_, index) => index + 1)
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
				...Array.from({ length: 14 }, (_, index) => ({
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
				{ ageHours: [24 * 2, 24 * 30], sourceId: "weekly" },
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

	test("names the period and cache scope of each summary window", async () => {
		setServerEnv();
		const { buildPrompt, buildSystemPrompt, normalizeSummaryWindow } =
			await import("../services/get-trends-summary");

		expect(normalizeSummaryWindow("week")).toBe("week");
		expect(normalizeSummaryWindow("hour")).toBe("today");
		expect(normalizeSummaryWindow(undefined)).toBe("today");
		expect(buildSystemPrompt("en", "today")).toContain("last 24 hours");
		expect(buildSystemPrompt("en", "month")).toContain("last 30 days");
		expect(buildSystemPrompt("en", "month")).toContain(
			"Judge importance over the whole period"
		);
		expect(buildPrompt(topic, [], "en", "week")).toContain("Window: week");
	});

	test("spreads a source's history across days before going deeper into one day", async () => {
		setServerEnv();
		const { interleaveByDay } = await import("../services/get-trends-summary");
		const now = Date.UTC(2026, 8, 21, 12);
		const page = makePage(
			[{ ageHours: [1, 2, 25, 26, 49], sourceId: "feed" }],
			now
		);
		const items = page.sections[0]?.sources[0]?.items ?? [];

		expect(interleaveByDay(items).map((item) => item.id)).toEqual([
			"feed-0",
			"feed-2",
			"feed-4",
			"feed-1",
			"feed-3",
		]);
	});

	test("sends every citation as a JSON line ahead of the Markdown", async () => {
		setServerEnv();
		const { withCitationPreamble } = await import(
			"../services/get-trends-summary"
		);
		const citations = Array.from({ length: 150 }, (_, index) => ({
			n: index + 1,
			url: `https://example.com/${index + 1}`,
		}));
		async function* markdown() {
			yield "1. **First** — why [1]\n";
			yield await Promise.resolve("2. **Second** — why [150]");
		}

		let body = "";
		for await (const chunk of withCitationPreamble(citations, markdown())) {
			body += chunk;
		}
		const newline = body.indexOf("\n");

		expect(JSON.parse(body.slice(0, newline))).toEqual({ citations });
		expect(body.slice(newline + 1)).toBe(
			"1. **First** — why [1]\n2. **Second** — why [150]"
		);
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
