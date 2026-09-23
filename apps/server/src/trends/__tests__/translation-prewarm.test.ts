import { describe, expect, test } from "bun:test";

import { runWithWorkerBindings, type WorkerBindings } from "../../runtime";
import type { NewsItem } from "../types";

function setServerEnv(): void {
	process.env.BETTER_AUTH_SECRET = "x".repeat(32);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.CORS_ORIGIN = "http://localhost:3001";
	process.env.LLM_API_KEY = "test-key";
	process.env.LLM_BASE_URL = "https://example.com/v1";
	process.env.LLM_MODEL = "test-model";
	process.env.TRENDS_REFRESH_SCHEDULER = "disabled";
}

function item(title: string, original?: NewsItem["original"]): NewsItem {
	return {
		fetchedAt: 0,
		id: title,
		original,
		sourceId: "source",
		title,
		url: "https://example.com",
	};
}

describe("translation prewarm", () => {
	test("only the language a feed is not written in needs a job", async () => {
		setServerEnv();
		const { needsTranslation } = await import(
			"../services/translate-news-items"
		);
		const english = item("OpenAI ships a model update");
		const chinese = item("阿里开源新的图像模型");

		expect(needsTranslation(english, "zh")).toBe(true);
		expect(needsTranslation(english, "en")).toBe(false);
		expect(needsTranslation(chinese, "zh")).toBe(false);
		expect(needsTranslation(chinese, "en")).toBe(true);
	});

	test("an item that already carries a translation is left alone", async () => {
		setServerEnv();
		const { needsTranslation } = await import(
			"../services/translate-news-items"
		);

		expect(
			needsTranslation(
				item("OpenAI 发布模型更新", { title: "OpenAI ships a model update" }),
				"zh"
			)
		).toBe(false);
	});

	test("prewarms Chinese and English", async () => {
		setServerEnv();
		const { TRANSLATION_PREWARM_LANGUAGES, translationPrewarmMessagesForPage } =
			await import("../services/translation-prewarm-jobs");

		expect([...TRANSLATION_PREWARM_LANGUAGES]).toEqual(["zh", "en"]);
		expect(
			translationPrewarmMessagesForPage(
				{
					description: "AI",
					id: "ai",
					sections: [
						{
							id: "news",
							sources: [
								{
									items: [item("OpenAI ships a model update")],
									sourceId: "openai-news",
									status: "ok",
									title: "OpenAI News",
								},
								{
									items: [item("阿里开源新的图像模型")],
									sourceId: "qwen-research",
									status: "ok",
									title: "Qwen Research",
								},
							],
						},
					],
					title: "AI",
					updatedAt: 0,
				},
				"zh"
			)
		).toEqual([{ lang: "zh", sourceId: "openai-news" }]);
	});

	test("prewarms every public summary window once per supported language", async () => {
		setServerEnv();
		const {
			SUMMARY_PREWARM_LANGUAGES,
			SUMMARY_PREWARM_WINDOWS,
			summaryPrewarmMessagesForAllTopics,
			summaryPrewarmMessagesForSource,
			summaryPrewarmMessagesForSources,
		} = await import("../services/summary-prewarm-jobs");
		const { topicPresets } = await import("../config/topics");

		expect([...SUMMARY_PREWARM_LANGUAGES]).toEqual(["zh", "en"]);
		expect([...SUMMARY_PREWARM_WINDOWS]).toEqual(["today", "week", "month"]);

		const messages = summaryPrewarmMessagesForSource("openai-news");
		expect(messages).toHaveLength(6);
		expect(new Set(messages.map((message) => message.topicId))).toEqual(
			new Set(["ai"])
		);
		expect(
			new Set(
				messages.map(
					(message) => `${message.topicId}:${message.lang}:${message.window}`
				)
			)
		).toHaveLength(messages.length);

		const allMessages = summaryPrewarmMessagesForAllTopics();
		expect(allMessages).toHaveLength(Object.keys(topicPresets).length * 6);
		expect(
			new Set(allMessages.slice(0, 6).map((message) => message.topicId))
		).toEqual(new Set(["ai"]));

		const deduplicated = summaryPrewarmMessagesForSources([
			"openai-news",
			"anthropic-news",
		]);
		expect(deduplicated).toHaveLength(6);
		expect(
			new Set(
				deduplicated.map(
					(message) => `${message.topicId}:${message.lang}:${message.window}`
				)
			)
		).toHaveLength(deduplicated.length);
	});

	test("does not regenerate fresh summaries when a source changes", async () => {
		setServerEnv();
		const { reconcileMissingSummaryPrewarms } = await import(
			"../services/summary-prewarm-jobs"
		);
		const requested: string[] = [];

		await reconcileMissingSummaryPrewarms(["openai-news"], {
			hasFreshHotSummaryCache: () => Promise.resolve(true),
			isConfigured: () => true,
			requestJob: (message) => {
				requested.push(`${message.topicId}:${message.lang}:${message.window}`);
				return Promise.resolve(true);
			},
		});

		expect(requested).toEqual([]);
	});

	test("routes missing summaries through the request gate without duplicate jobs", async () => {
		setServerEnv();
		const { reconcileMissingSummaryPrewarms } = await import(
			"../services/summary-prewarm-jobs"
		);
		const requested = new Set<string>();
		const requestAttempts: string[] = [];
		const dependencies = {
			hasFreshHotSummaryCache: (topicId: string) =>
				Promise.resolve(!topicId.startsWith("ai")),
			isConfigured: () => true,
			requestJob: (message: {
				lang: string;
				topicId: string;
				window?: string;
			}) => {
				const key = `${message.topicId}:${message.lang}:${message.window}`;
				requestAttempts.push(key);
				if (requested.has(key)) {
					return Promise.resolve(false);
				}
				requested.add(key);
				return Promise.resolve(true);
			},
		};

		await reconcileMissingSummaryPrewarms(["openai-news"], dependencies);
		await reconcileMissingSummaryPrewarms(["openai-news"], dependencies);

		expect(requested).toHaveLength(6);
		expect(new Set(requestAttempts)).toHaveLength(6);
	});

	test("treats an expired hot summary as due even while its stale copy remains", async () => {
		setServerEnv();
		const { buildPrompt, hasFreshHotSummaryCache } = await import(
			"../services/get-trends-summary"
		);
		const now = Date.now();
		const queue = { send: () => Promise.resolve() } as Queue;
		const bindings = {
			BETTER_AUTH_SECRET: "test".repeat(8),
			BETTER_AUTH_URL: "http://localhost:3000",
			CORS_ORIGIN: "http://localhost:3001",
			DB: {} as D1Database,
			EVENT_MERGE_QUEUE: queue,
			HOT_CACHE: {
				get: () =>
					Promise.resolve({
						createdAt: now - 60_000,
						freshUntil: now - 1,
						schemaVersion: 2,
						staleUntil: now + 60_000,
						value: {
							citations: [],
							expiresAt: now - 1,
							prompt: buildPrompt(
								{ description: "AI", sections: [], title: "AI" },
								[]
							),
							staleUntil: now + 60_000,
							text: "1. **摘要** — 说明 [1]",
						},
					}),
			} as unknown as KVNamespace,
			IMAGES: {} as ImagesBinding,
			LLM_API_KEY: "test-key",
			LLM_BASE_URL: "https://example.com/v1",
			LLM_MODEL: "test-model",
			NODE_ENV: "test",
			SILICONFLOW_EMBEDDING_MODEL: "test-embedding-model",
			SUMMARY_PREWARM_QUEUE: queue,
			TRENDS_REFRESH_SCHEDULER: "disabled",
		} satisfies WorkerBindings;

		const fresh = await runWithWorkerBindings(bindings, () =>
			hasFreshHotSummaryCache("ai", "zh")
		);

		expect(fresh).toBe(false);
	});
});
