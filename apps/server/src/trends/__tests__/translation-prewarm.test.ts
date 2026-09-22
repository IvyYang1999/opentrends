import { describe, expect, test } from "bun:test";

import type { NewsItem } from "../types";

function setServerEnv(): void {
	process.env.BETTER_AUTH_SECRET = "x".repeat(32);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.CORS_ORIGIN = "http://localhost:3001";
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
});
