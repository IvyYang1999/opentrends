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
		const { TRANSLATION_PREWARM_LANGUAGES } = await import(
			"../services/translation-prewarm-jobs"
		);

		expect([...TRANSLATION_PREWARM_LANGUAGES]).toEqual(["zh", "en"]);
	});
});
