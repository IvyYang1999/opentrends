import { describe, expect, test } from "bun:test";

import { pageNeedsTranslationWarmup } from "./translation-status";
import type { TrendsPageData } from "./types";

function page(title: string, originalTitle?: string): TrendsPageData {
	return {
		description: "AI",
		id: "ai",
		sections: [
			{
				id: "news",
				sources: [
					{
						items: [
							{
								fetchedAt: 0,
								id: "1",
								...(originalTitle
									? { original: { title: originalTitle } }
									: {}),
								sourceId: "source",
								title,
								url: "https://example.com",
							},
						],
						sourceId: "source",
						status: "ok",
						title: "Source",
					},
				],
			},
		],
		title: "AI",
		updatedAt: 0,
	};
}

describe("translation warmup status", () => {
	test("polls only while a supported locale still shows untranslated text", () => {
		expect(pageNeedsTranslationWarmup(page("OpenAI ships a model"), "zh")).toBe(
			true
		);
		expect(
			pageNeedsTranslationWarmup(
				page("OpenAI 发布了一个模型", "OpenAI ships a model"),
				"zh"
			)
		).toBe(false);
		expect(
			pageNeedsTranslationWarmup(page("OpenAI ships a model"), "fr-FR")
		).toBe(false);
	});
});
