import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// A thin MCP server over the public OpenTrends API, so an agent can ask
// "what happened in AI today?" and get the digest with its citations, or
// pull a topic's sources and items. No key, no scraping; every call is one
// GET against the same JSON the website reads.
export const DEFAULT_API_URL = "https://api.opentrends.io";

const TOPICS = [
	"featured",
	"ai",
	"programming",
	"hardware",
	"biotech",
	"embodied",
	"cn",
] as const;
const LANGS = [
	"en",
	"zh",
	"zh-Hant",
	"ru",
	"fr-FR",
	"es-ES",
	"de-DE",
	"pt-BR",
] as const;
const WINDOWS = ["today", "week", "month"] as const;
const PENDING_RETRIES = 6;
const TRAILING_SLASH_RE = /\/$/;

export type Lang = (typeof LANGS)[number];

export interface OpenTrendsMcpOptions {
	/** The OpenTrends API to read from; a self-hosted instance passes its own. */
	baseUrl?: string;
	/** Language used when a call does not name one. */
	defaultLang?: Lang;
}

interface Item {
	description?: string;
	hotValue?: number | string;
	id: string;
	original?: { title: string };
	publishedAt?: number;
	title: string;
	url: string;
}

interface Source {
	homeUrl?: string;
	items: Item[];
	kind?: string;
	sourceId: string;
	status: string;
	title: string;
}

interface TopicPage {
	id: string;
	sections: { id: string; sources: Source[]; title: string }[];
	title: string;
	updatedAt: number;
}

interface DigestEntry {
	citations: { n: number; topic?: string; url: string }[];
	n: number;
	reason?: string;
	takeaway: string;
}

interface Digest {
	entries: DigestEntry[];
	lang: string;
	markdown: string;
	topic: string;
	window: string;
}

async function getJson<T>(
	baseUrl: string,
	path: string,
	query: Record<string, string>
) {
	const url = new URL(`${baseUrl}${path}`);
	for (const [key, value] of Object.entries(query)) {
		url.searchParams.set(key, value);
	}
	const response = await fetch(url, {
		headers: { accept: "application/json", "user-agent": "opentrends-mcp" },
	});
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText} for ${path}`);
	}
	return { data: (await response.json()) as T, status: response.status };
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoDate(timestamp?: number) {
	return timestamp ? new Date(timestamp).toISOString() : undefined;
}

function compactItem(item: Item) {
	return {
		hotValue: item.hotValue,
		originalTitle:
			item.original?.title === item.title ? undefined : item.original?.title,
		publishedAt: isoDate(item.publishedAt),
		title: item.title,
		url: item.url,
	};
}

function text(value: unknown) {
	return {
		content: [{ text: JSON.stringify(value, null, 2), type: "text" as const }],
	};
}

// Items across the given pages whose title (translated or original)
// contains the needle, each url once.
function searchPages(pages: TopicPage[], needle: string) {
	const seen = new Set<string>();
	const hits: Record<string, unknown>[] = [];
	for (const page of pages) {
		for (const section of page.sections) {
			for (const source of section.sources) {
				for (const item of source.items) {
					const haystack =
						`${item.title} ${item.original?.title ?? ""}`.toLowerCase();
					if (!haystack.includes(needle) || seen.has(item.url)) {
						continue;
					}
					seen.add(item.url);
					hits.push({
						...compactItem(item),
						source: source.title,
						sourceId: source.sourceId,
						topic: page.id,
					});
				}
			}
		}
	}
	return hits;
}

export function createOpenTrendsMcpServer(
	options: OpenTrendsMcpOptions = {}
): McpServer {
	const baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(
		TRAILING_SLASH_RE,
		""
	);
	const topic = z.enum(TOPICS).describe("Topic id");
	const lang = z
		.enum(LANGS)
		.default(options.defaultLang ?? "en")
		.describe("Language of titles and digest");
	const server = new McpServer({ name: "opentrends", version: "0.2.0" });

	server.registerTool(
		"get_digest",
		{
			description:
				"The OpenTrends digest for a topic: ten takeaways with reasons and citation links, for today, this week or this month. Start here for 'what is happening in X'.",
			inputSchema: {
				lang,
				topic,
				window: z.enum(WINDOWS).default("today"),
			},
		},
		async ({ lang: language, topic: id, window }) => {
			for (let attempt = 0; attempt < PENDING_RETRIES; attempt += 1) {
				const { data, status } = await getJson<Digest | { status: string }>(
					baseUrl,
					`/api/trends/${id}/summary`,
					{ format: "json", lang: language, window }
				);
				if (status === 200 && "entries" in data) {
					return text({
						entries: data.entries,
						lang: data.lang,
						topic: data.topic,
						window: data.window,
					});
				}
				await sleep(5000);
			}
			return text({
				error: "The digest is still being generated; try again in a minute.",
			});
		}
	);

	server.registerTool(
		"get_topic",
		{
			description:
				"Every source in a topic with its latest items (title, url, date, heat). Use for 'show me what the sources are saying' or to find a sourceId.",
			inputSchema: {
				itemsPerSource: z.number().int().min(1).max(30).default(8),
				lang,
				topic,
			},
		},
		async ({ itemsPerSource, lang: language, topic: id }) => {
			const { data } = await getJson<TopicPage>(baseUrl, `/api/trends/${id}`, {
				items: String(itemsPerSource),
				lang: language,
			});
			return text({
				sources: data.sections.flatMap((section) =>
					section.sources.map((source) => ({
						homeUrl: source.homeUrl,
						items: source.items.slice(0, itemsPerSource).map(compactItem),
						kind: source.kind,
						section: section.title,
						sourceId: source.sourceId,
						title: source.title,
					}))
				),
				topic: data.id,
				updatedAt: isoDate(data.updatedAt),
			});
		}
	);

	server.registerTool(
		"get_source",
		{
			description:
				"One source's full current list, e.g. Hacker News or a company blog. Get sourceIds from get_topic.",
			inputSchema: {
				lang,
				sourceId: z.string().min(1),
				topic,
			},
		},
		async ({ lang: language, sourceId, topic: id }) => {
			const { data } = await getJson<Source>(
				baseUrl,
				`/api/trends/${id}/sources/${encodeURIComponent(sourceId)}`,
				{ lang: language }
			);
			return text({
				homeUrl: data.homeUrl,
				items: data.items.map(compactItem),
				sourceId: data.sourceId,
				title: data.title,
			});
		}
	);

	server.registerTool(
		"search",
		{
			description:
				"Find items across one topic (or all topics) whose title contains the query. Cheap substring match, not semantic.",
			inputSchema: {
				lang,
				limit: z.number().int().min(1).max(100).default(30),
				query: z.string().min(1),
				topic: topic.optional(),
			},
		},
		async ({ lang: language, limit, query, topic: id }) => {
			const ids = id ? [id] : TOPICS.filter((value) => value !== "featured");
			const needle = query.toLowerCase();
			const pages = await Promise.all(
				ids.map((value) =>
					getJson<TopicPage>(baseUrl, `/api/trends/${value}`, {
						items: "preview",
						lang: language,
					}).then(({ data }) => data)
				)
			);
			const hits = searchPages(pages, needle);
			return text({ hits: hits.slice(0, limit), query, total: hits.length });
		}
	);

	return server;
}

// A stateless Streamable HTTP transport for one request, for hosts that
// serve the tools at a URL (the OpenTrends API does, at /mcp). Kept here so
// such a host depends on this package alone, not on the SDK.
export function createStatelessHttpTransport() {
	return new WebStandardStreamableHTTPServerTransport({
		enableJsonResponse: true,
		sessionIdGenerator: undefined,
	});
}
