import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { hackerNewsAdapter } from "../adapters/native/hacker-news";

const originalFetch = globalThis.fetch;

interface MockResponse {
	body: unknown;
	status?: number;
}

function installFetch(routes: Map<string, MockResponse>) {
	globalThis.fetch = ((input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		const route = routes.get(url);
		if (!route) {
			throw new Error(`Unexpected fetch: ${url}`);
		}
		return Promise.resolve(
			new Response(JSON.stringify(route.body), {
				status: route.status ?? 200,
				headers: { "content-type": "application/json" },
			})
		);
	}) as unknown as typeof fetch;
}

beforeEach(() => {
	// ensure clean state per test
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("hackerNewsAdapter", () => {
	test("normalizes top stories into NewsItem[]", async () => {
		const routes = new Map<string, MockResponse>();
		routes.set("https://hacker-news.firebaseio.com/v0/topstories.json", {
			body: [101, 102, 103],
		});
		routes.set("https://hacker-news.firebaseio.com/v0/item/101.json", {
			body: {
				id: 101,
				type: "story",
				title: "AI breakthrough",
				url: "https://example.com/a",
				score: 200,
				time: 1_700_000_000,
			},
		});
		routes.set("https://hacker-news.firebaseio.com/v0/item/102.json", {
			body: {
				id: 102,
				type: "story",
				title: "Database tips",
				url: "https://example.com/b",
				score: 50,
				time: 1_700_000_100,
			},
		});
		routes.set("https://hacker-news.firebaseio.com/v0/item/103.json", {
			body: { id: 103, type: "comment", title: "should be skipped" },
		});
		installFetch(routes);

		const controller = new AbortController();
		const items = await hackerNewsAdapter.fetch({
			sourceId: "hackernews",
			signal: controller.signal,
		});

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			id: "hn-101",
			sourceId: "hackernews",
			title: "AI breakthrough",
			url: "https://example.com/a",
			hotValue: 200,
		});
		expect(items[0]?.publishedAt).toBe(1_700_000_000_000);
	});

	test("falls back to comment URL when item has no url", async () => {
		const routes = new Map<string, MockResponse>();
		routes.set("https://hacker-news.firebaseio.com/v0/topstories.json", {
			body: [42],
		});
		routes.set("https://hacker-news.firebaseio.com/v0/item/42.json", {
			body: { id: 42, type: "story", title: "Ask HN: anything?" },
		});
		installFetch(routes);

		const items = await hackerNewsAdapter.fetch({
			sourceId: "hackernews",
			signal: new AbortController().signal,
		});
		expect(items).toHaveLength(1);
		expect(items[0]?.url).toBe("https://news.ycombinator.com/item?id=42");
	});
});
