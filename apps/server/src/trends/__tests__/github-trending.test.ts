import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { githubTrendingAdapter } from "../adapters/native/github-trending";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "fixtures/github-trending.html");

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("githubTrendingAdapter", () => {
	test("parses repos with stars and description", async () => {
		const html = await readFile(fixturePath, "utf8");
		globalThis.fetch = (async () =>
			new Response(html, {
				status: 200,
				headers: { "content-type": "text/html" },
			})) as unknown as typeof fetch;

		const items = await githubTrendingAdapter.fetch({
			sourceId: "github-trending",
			signal: new AbortController().signal,
		});

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			id: "gh-foo / bar",
			url: "https://github.com/foo/bar",
			rank: 1,
			hotValue: 1234,
			title: "foo / bar",
			description: "A small and friendly thing",
			imageUrl: "https://github.com/foo.png?size=96",
		});

		expect(items[1]).toMatchObject({
			id: "gh-llm / agent",
			url: "https://github.com/llm/agent",
			rank: 2,
			hotValue: 9800,
			title: "llm / agent",
			description: "Tiny LLM agent runtime",
			imageUrl: "https://github.com/llm.png?size=96",
		});
	});
});
