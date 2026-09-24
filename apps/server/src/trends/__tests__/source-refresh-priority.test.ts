import { describe, expect, test } from "bun:test";

import {
	prioritizeExpiredSourceIds,
	selectDueSourceIds,
} from "../services/source-refresh-priority";

describe("source refresh priority", () => {
	test("refreshes empty expired sources before populated ones", () => {
		const now = 10_000;
		expect(
			prioritizeExpiredSourceIds(
				[
					{
						sourceId: "hackernews",
						expiresAt: 1000,
						items: [{}],
					},
					{
						sourceId: "runway-news",
						expiresAt: 9000,
						items: [],
					},
					{
						sourceId: "openrouter-announcements",
						expiresAt: 8000,
						items: [],
					},
				],
				now
			)
		).toEqual(["openrouter-announcements", "runway-news", "hackernews"]);
	});

	test("ignores fresh sources and deduplicates repeated cards", () => {
		const source = {
			sourceId: "runway-news" as const,
			expiresAt: 9000,
			items: [],
		};
		expect(
			prioritizeExpiredSourceIds(
				[
					source,
					source,
					{
						sourceId: "hackernews",
						expiresAt: 11_000,
						items: [{}],
					},
				],
				10_000
			)
		).toEqual(["runway-news"]);
	});
});

describe("durable source refresh selection", () => {
	test("skips failed sources in backoff so unseen sources are not starved", () => {
		const now = 10_000;
		const states = new Map([
			[
				"hackernews" as const,
				{
					expiresAt: 15_000,
					sourceId: "hackernews" as const,
					status: "error" as const,
				},
			],
		]);

		expect(
			selectDueSourceIds(
				["hackernews", "runway-news", "openrouter-announcements"],
				states,
				now,
				2
			)
		).toEqual(["runway-news", "openrouter-announcements"]);
	});

	test("orders expired rows by the oldest retry deadline", () => {
		const states = new Map([
			[
				"hackernews" as const,
				{
					expiresAt: 9000,
					sourceId: "hackernews" as const,
					status: "stale" as const,
				},
			],
			[
				"runway-news" as const,
				{
					expiresAt: 8000,
					sourceId: "runway-news" as const,
					status: "ok" as const,
				},
			],
		]);

		expect(
			selectDueSourceIds(["hackernews", "runway-news"], states, 10_000, 2)
		).toEqual(["runway-news", "hackernews"]);
	});
});
