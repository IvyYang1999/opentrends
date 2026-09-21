import { afterEach, describe, expect, test } from "bun:test";

import { redditAdapter } from "../adapters/native/reddit";

const originalFetch = globalThis.fetch;
const SUBREDDIT_ERROR_RE = /subreddit/;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("redditAdapter", () => {
	test("normalizes hot listing into NewsItem[] and skips stickied", async () => {
		const body = {
			data: {
				children: [
					{
						data: {
							id: "abc",
							title: "Stickied announcement",
							permalink: "/r/programming/comments/abc",
							url: "https://example.com/sticky",
							score: 5,
							created_utc: 1_700_000_000,
							stickied: true,
							is_self: false,
						},
					},
					{
						data: {
							id: "def",
							title: "Real post",
							permalink: "/r/programming/comments/def",
							url: "https://example.com/real",
							score: 123,
							num_comments: 4,
							created_utc: 1_700_000_100,
							stickied: false,
							is_self: false,
						},
					},
					{
						data: {
							id: "ghi",
							title: "Self post",
							permalink: "/r/programming/comments/ghi",
							url: "https://www.reddit.com/r/programming/comments/ghi",
							score: 50,
							created_utc: 1_700_000_200,
							stickied: false,
							is_self: true,
							thumbnail: "self",
							preview: {
								images: [
									{
										source: { url: "https://i.redd.it/preview-ghi.jpg" },
									},
								],
							},
						},
					},
					{
						data: {
							id: "jkl",
							title: "Thumb only",
							permalink: "/r/programming/comments/jkl",
							url: "https://example.com/thumb",
							score: 10,
							created_utc: 1_700_000_300,
							stickied: false,
							is_self: false,
							thumbnail: "https://b.thumbs.redditmedia.com/thumb.jpg",
						},
					},
				],
			},
		};
		globalThis.fetch = (async () =>
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch;

		const items = await redditAdapter.fetch({
			sourceId: "reddit-programming",
			signal: new AbortController().signal,
			params: { subreddit: "programming" },
		});

		expect(items).toHaveLength(3);
		expect(items[0]).toMatchObject({
			id: "reddit-programming-def",
			url: "https://example.com/real",
			title: "Real post",
			hotValue: 123,
		});
		expect(items[0]?.publishedAt).toBe(1_700_000_100_000);
		expect(items[1]).toMatchObject({
			url: "https://www.reddit.com/r/programming/comments/ghi",
			imageUrl: "https://i.redd.it/preview-ghi.jpg",
		});
		expect(items[2]).toMatchObject({
			url: "https://example.com/thumb",
			imageUrl: "https://b.thumbs.redditmedia.com/thumb.jpg",
		});
	});

	test("throws when subreddit param missing", async () => {
		await expect(
			redditAdapter.fetch({
				sourceId: "x",
				signal: new AbortController().signal,
			})
		).rejects.toThrow(SUBREDDIT_ERROR_RE);
	});

	test("falls back to Reddit's Atom feed when the JSON endpoint is blocked", async () => {
		const requestedUrls: string[] = [];
		globalThis.fetch = ((input) => {
			const url = String(input);
			requestedUrls.push(url);
			if (url.endsWith("raw_json=1")) {
				return Promise.resolve(new Response("blocked", { status: 403 }));
			}
			return Promise.resolve(
				new Response(
					`<?xml version="1.0" encoding="UTF-8"?>
				<feed xmlns="http://www.w3.org/2005/Atom">
					<title>MachineLearning</title>
					<entry>
						<id>t3_fallback</id>
						<title>Fallback post</title>
						<link href="https://www.reddit.com/r/MachineLearning/comments/fallback" />
						<updated>2026-09-21T08:00:00Z</updated>
						<content type="html">Fallback content</content>
					</entry>
				</feed>`,
					{
						status: 200,
						headers: { "content-type": "application/atom+xml" },
					}
				)
			);
		}) as unknown as typeof fetch;

		const items = await redditAdapter.fetch({
			sourceId: "reddit-machinelearning",
			signal: new AbortController().signal,
			params: { subreddit: "MachineLearning" },
		});

		expect(requestedUrls).toHaveLength(2);
		expect(requestedUrls[1]).toBe(
			"https://www.reddit.com/r/MachineLearning/.rss"
		);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			sourceId: "reddit-machinelearning",
			title: "Fallback post",
		});
	});
});
