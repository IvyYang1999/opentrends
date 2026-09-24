import { describe, expect, test } from "bun:test";

import {
	applyCachedTranslations,
	storePageTranslations,
} from "./translation-snapshot-cache";
import type { TrendsPageData } from "./types";

class MemoryStorage implements Storage {
	readonly #values = new Map<string, string>();

	get length(): number {
		return this.#values.size;
	}

	clear(): void {
		this.#values.clear();
	}

	getItem(key: string): string | null {
		return this.#values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.#values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.#values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.#values.set(key, value);
	}
}

function page(title: string, translatedTitle?: string): TrendsPageData {
	return {
		id: "ai",
		sections: [
			{
				id: "news",
				sources: [
					{
						items: [
							{
								fetchedAt: 1,
								id: "story",
								...(translatedTitle
									? {
											original: { title },
											title: translatedTitle,
										}
									: { title }),
								sourceId: "source",
								url: "https://example.com/story",
							},
						],
						sourceId: "source",
						status: "ok",
						title: "Source",
					},
				],
				title: "News",
			},
		],
		title: "AI",
		updatedAt: 1,
	};
}

describe("translation snapshot cache", () => {
	test("reuses a translated title on the next page open", () => {
		const storage = new MemoryStorage();
		storePageTranslations(page("Original", "译文"), "zh", storage);

		const cached = applyCachedTranslations(page("Original"), "zh", storage);
		const item = cached.sections[0]?.sources[0]?.items[0];

		expect(item?.title).toBe("译文");
		expect(item?.original?.title).toBe("Original");
	});

	test("does not reuse a translation after the source title changes", () => {
		const storage = new MemoryStorage();
		storePageTranslations(page("Original", "译文"), "zh", storage);

		const cached = applyCachedTranslations(page("Updated"), "zh", storage);

		expect(cached.sections[0]?.sources[0]?.items[0]?.title).toBe("Updated");
	});
});
