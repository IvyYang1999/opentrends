import { afterEach, describe, expect, test } from "bun:test";

import { createRssAdapter } from "../adapters/rss";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("createRssAdapter", () => {
	test("parses RSS 2.0 items", async () => {
		const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Hello world</title>
      <link>https://example.com/a</link>
      <guid>tag:a</guid>
      <pubDate>Thu, 01 Jan 1970 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[Second post]]></title>
      <link>https://example.com/b</link>
      <pubDate>Thu, 02 Jan 1970 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>missing url</title>
    </item>
  </channel>
</rss>`;
		globalThis.fetch = (async () =>
			new Response(xml, {
				status: 200,
				headers: { "content-type": "application/xml" },
			})) as unknown as typeof fetch;

		const adapter = createRssAdapter({
			provider: "rss",
			name: "Example",
			feedUrl: "https://example.com/feed.xml",
			refresh: "rss",
		});

		const items = await adapter.fetch({
			sourceId: "ex",
			signal: new AbortController().signal,
		});

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			url: "https://example.com/b",
			title: "Second post",
			rank: 1,
		});
		expect(items[1]).toMatchObject({
			id: "tag:a",
			url: "https://example.com/a",
			title: "Hello world",
			rank: 2,
		});
	});

	test("sorts items by published date descending", async () => {
		const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Older post</title>
      <link>https://example.com/older</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Newest post</title>
      <link>https://example.com/newest</link>
      <pubDate>Wed, 03 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Middle post</title>
      <link>https://example.com/middle</link>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;
		globalThis.fetch = (async () =>
			new Response(xml, {
				status: 200,
				headers: { "content-type": "application/xml" },
			})) as unknown as typeof fetch;

		const adapter = createRssAdapter({
			provider: "rss",
			name: "Example",
			feedUrl: "https://example.com/feed.xml",
			refresh: "rss",
		});

		const items = await adapter.fetch({
			sourceId: "ex",
			signal: new AbortController().signal,
		});

		expect(items.map((item) => item.title)).toEqual([
			"Newest post",
			"Middle post",
			"Older post",
		]);
		expect(items.map((item) => item.rank)).toEqual([1, 2, 3]);
	});

	test("extracts cover image from enclosure or first <img>", async () => {
		const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <item>
      <title>With enclosure</title>
      <link>https://example.com/a</link>
      <enclosure url="https://cdn.example.com/cover.jpg" type="image/jpeg" length="1234" />
    </item>
    <item>
      <title>With media:thumbnail</title>
      <link>https://example.com/b</link>
      <media:thumbnail url="https://cdn.example.com/thumb.png" />
    </item>
    <item>
      <title>With img in description</title>
      <link>https://example.com/c</link>
      <description><![CDATA[<p>Story</p><img src="https://cdn.example.com/inline.png">]]></description>
    </item>
    <item>
      <title>No image</title>
      <link>https://example.com/d</link>
      <description>Plain text</description>
    </item>
  </channel>
</rss>`;
		globalThis.fetch = (async () =>
			new Response(xml, {
				status: 200,
				headers: { "content-type": "application/xml" },
			})) as unknown as typeof fetch;

		const adapter = createRssAdapter({
			provider: "rss",
			name: "Example",
			feedUrl: "https://example.com/feed.xml",
			refresh: "rss",
		});

		const items = await adapter.fetch({
			sourceId: "ex",
			signal: new AbortController().signal,
		});

		expect(items[0]?.imageUrl).toBe("https://cdn.example.com/cover.jpg");
		expect(items[1]?.imageUrl).toBe("https://cdn.example.com/thumb.png");
		expect(items[2]?.imageUrl).toBe("https://cdn.example.com/inline.png");
		expect(items[3]?.imageUrl).toBeUndefined();
	});

	test("parses Atom feeds", async () => {
		const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom item</title>
    <link href="https://example.com/atom" />
    <id>id:atom</id>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;
		globalThis.fetch = (async () =>
			new Response(xml, {
				status: 200,
				headers: { "content-type": "application/xml" },
			})) as unknown as typeof fetch;

		const adapter = createRssAdapter({
			provider: "rss",
			name: "Atom",
			feedUrl: "https://example.com/atom.xml",
			refresh: "rss",
		});

		const items = await adapter.fetch({
			sourceId: "atom",
			signal: new AbortController().signal,
		});

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: "id:atom",
			url: "https://example.com/atom",
			title: "Atom item",
		});
	});
});
