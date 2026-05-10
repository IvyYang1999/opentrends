import { afterEach, describe, expect, test } from "bun:test";

import type { RssHubSourcePreset } from "../types";

const originalFetch = globalThis.fetch;

const preset: RssHubSourcePreset = {
	provider: "rsshub",
	name: "Example",
	route: "/example/feed",
	params: { limit: 10 },
	refresh: "rss",
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function setServerEnv(): void {
	process.env.DATABASE_URL =
		"postgresql://postgres:password@localhost:5432/test";
	process.env.BETTER_AUTH_SECRET = "x".repeat(32);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.CORS_ORIGIN = "http://localhost:3001";
	process.env.RSSHUB_BASE_URLS = "https://rsshub.umzzz.com";
	process.env.LLM_BASE_URL = "https://example.com/v1";
	process.env.LLM_MODEL = "test-model";
	process.env.TRENDS_REFRESH_SCHEDULER = "disabled";
}

describe("RSSHub instances", () => {
	test("parses comma or whitespace separated base URLs", async () => {
		setServerEnv();
		const { parseRssHubBaseUrls } = await import("../config/rsshub-instances");
		expect(
			parseRssHubBaseUrls(
				"rss.datuan.dev, https://rsshub.cups.moe/\nrsshub.isrss.com"
			)
		).toEqual([
			"https://rss.datuan.dev",
			"https://rsshub.cups.moe",
			"https://rsshub.isrss.com",
		]);
	});

	test("keeps default RSSHub fallbacks after configured URLs", async () => {
		setServerEnv();
		const { resolveRssHubBaseUrls } = await import(
			"../config/rsshub-instances"
		);
		expect(
			resolveRssHubBaseUrls("https://primary.example, rss.datuan.dev", [
				"https://rss.datuan.dev",
				"https://rsshub.isrss.com",
			])
		).toEqual([
			"https://primary.example",
			"https://rss.datuan.dev",
			"https://rsshub.isrss.com",
		]);
	});

	test("builds one request URL for each base URL", async () => {
		setServerEnv();
		const { buildRssHubRequestUrls } = await import("../adapters/rsshub");
		expect(
			buildRssHubRequestUrls(preset, [
				"https://rss.datuan.dev",
				"https://rsshub.isrss.com",
			])
		).toEqual([
			"https://rss.datuan.dev/example/feed?format=json&limit=10",
			"https://rsshub.isrss.com/example/feed?format=json&limit=10",
		]);
	});

	test("tries the next RSSHub instance when the first one fails", async () => {
		setServerEnv();
		const { createRssHubAdapter } = await import("../adapters/rsshub");
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input) => {
			requestedUrls.push(String(input));
			if (requestedUrls.length === 1) {
				return Promise.resolve(new Response("bad gateway", { status: 502 }));
			}
			return Promise.resolve(
				Response.json({
					items: [
						{
							id: "item-1",
							title: "Recovered feed",
							url: "https://example.com/recovered",
							date_published: "2024-01-01T00:00:00Z",
						},
					],
				})
			);
		}) as unknown as typeof fetch;

		const adapter = createRssHubAdapter(preset, {
			baseUrls: ["https://rss.datuan.dev", "https://rsshub.isrss.com"],
			hedgeDelayMs: 0,
		});

		const items = await adapter.fetch({
			sourceId: "rsshub-example",
			signal: new AbortController().signal,
		});

		expect(requestedUrls).toEqual([
			"https://rss.datuan.dev/example/feed?format=json&limit=10",
			"https://rsshub.isrss.com/example/feed?format=json&limit=10",
		]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: "item-1",
			sourceId: "rsshub-example",
			title: "Recovered feed",
			url: "https://example.com/recovered",
		});
	});

	test("sorts RSSHub items by published date descending", async () => {
		setServerEnv();
		const { createRssHubAdapter } = await import("../adapters/rsshub");
		globalThis.fetch = (() =>
			Promise.resolve(
				Response.json({
					items: [
						{
							id: "older",
							title: "Older feed item",
							url: "https://example.com/older",
							date_published: "2024-01-01T00:00:00Z",
						},
						{
							id: "newest",
							title: "Newest feed item",
							url: "https://example.com/newest",
							date_published: "2024-01-03T00:00:00Z",
						},
						{
							id: "middle",
							title: "Middle feed item",
							url: "https://example.com/middle",
							date_published: "2024-01-02T00:00:00Z",
						},
					],
				})
			)) as unknown as typeof fetch;

		const adapter = createRssHubAdapter(preset, {
			baseUrls: ["https://rsshub.isrss.com"],
			hedgeDelayMs: 0,
		});

		const items = await adapter.fetch({
			sourceId: "rsshub-example",
			signal: new AbortController().signal,
		});

		expect(items.map((item) => item.title)).toEqual([
			"Newest feed item",
			"Middle feed item",
			"Older feed item",
		]);
		expect(items.map((item) => item.rank)).toEqual([1, 2, 3]);
	});

	test("times out a slow RSSHub instance and keeps trying fallbacks", async () => {
		setServerEnv();
		const { createRssHubAdapter } = await import("../adapters/rsshub");
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input, init) => {
			requestedUrls.push(String(input));
			if (requestedUrls.length === 1) {
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new Error("aborted"));
					});
				});
			}
			return Promise.resolve(
				Response.json({
					items: [
						{
							id: "item-2",
							title: "Fallback feed",
							url: "https://example.com/fallback",
						},
					],
				})
			);
		}) as unknown as typeof fetch;

		const adapter = createRssHubAdapter(preset, {
			baseUrls: ["https://slow.example", "https://rsshub.isrss.com"],
			hedgeDelayMs: 0,
			instanceTimeoutMs: 10,
		});

		const items = await adapter.fetch({
			sourceId: "rsshub-timeout",
			signal: new AbortController().signal,
		});

		expect(requestedUrls).toEqual([
			"https://slow.example/example/feed?format=json&limit=10",
			"https://rsshub.isrss.com/example/feed?format=json&limit=10",
		]);
		expect(items[0]).toMatchObject({
			id: "item-2",
			sourceId: "rsshub-timeout",
			title: "Fallback feed",
		});
	});
});
