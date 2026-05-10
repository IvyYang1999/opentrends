import type { NewsItem } from "../types";

const MAX_ITEMS = 30;

export function clampItems(items: NewsItem[]): NewsItem[] {
	return items.slice(0, MAX_ITEMS);
}

export function sortByPublishedAtDesc(items: NewsItem[]): NewsItem[] {
	return items
		.map((item, index) => ({ index, item }))
		.sort((a, b) => {
			const dateDiff = (b.item.publishedAt ?? 0) - (a.item.publishedAt ?? 0);
			if (dateDiff !== 0) {
				return dateDiff;
			}
			return (a.item.rank ?? a.index + 1) - (b.item.rank ?? b.index + 1);
		})
		.map(({ item }, index) => ({
			...item,
			rank: index + 1,
		}));
}

export function isValidUrl(value: string | undefined | null): value is string {
	if (!value) {
		return false;
	}
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

const IMG_TAG_RE = /<img[^>]+src=["']([^"']+)["']/i;

/**
 * Try to find a cover/thumbnail URL inside an HTML fragment (e.g. an
 * RSS description or RssHub `content_html`). Returns the first http(s)
 * `<img src>` URL or undefined when none is present or valid.
 */
export function extractImageFromHtml(
	html: string | undefined | null
): string | undefined {
	if (!html) {
		return;
	}
	const match = IMG_TAG_RE.exec(html);
	const candidate = match?.[1];
	return isValidUrl(candidate) ? candidate : undefined;
}

export function normalizeText(value: string | undefined | null): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

const DESCRIPTION_MAX_CHARS = 320;
const HTML_TAG_RE = /<[^>]+>/g;
const HTML_ENTITY_RE = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi;
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
};

function decodeEntities(input: string): string {
	return input.replace(HTML_ENTITY_RE, (_match, dec, hex, name) => {
		if (dec) {
			const code = Number.parseInt(dec, 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : "";
		}
		if (hex) {
			const code = Number.parseInt(hex, 16);
			return Number.isFinite(code) ? String.fromCodePoint(code) : "";
		}
		return NAMED_ENTITIES[String(name).toLowerCase()] ?? "";
	});
}

/**
 * Strip HTML, decode entities, collapse whitespace and clamp to a reasonable
 * length for use as a NewsItem description. Returns undefined when the input
 * has no usable content so callers can leave the field unset.
 */
export function cleanDescription(
	value: string | undefined | null
): string | undefined {
	if (!value) {
		return;
	}
	const text = normalizeText(decodeEntities(value.replace(HTML_TAG_RE, " ")));
	if (!text) {
		return;
	}
	if (text.length <= DESCRIPTION_MAX_CHARS) {
		return text;
	}
	// Try to break on a sentence / clause boundary instead of mid-word.
	const window = text.slice(0, DESCRIPTION_MAX_CHARS);
	const lastBreak = Math.max(
		window.lastIndexOf(". "),
		window.lastIndexOf("。"),
		window.lastIndexOf("! "),
		window.lastIndexOf("? "),
		window.lastIndexOf(" — ")
	);
	const cutoff =
		lastBreak >= DESCRIPTION_MAX_CHARS / 2
			? lastBreak + 1
			: window.lastIndexOf(" ");
	const safeCutoff = cutoff > 0 ? cutoff : DESCRIPTION_MAX_CHARS;
	return `${text.slice(0, safeCutoff).trimEnd()}…`;
}

export async function fetchJson<T>(
	url: string,
	init: RequestInit & { signal: AbortSignal }
): Promise<T> {
	const response = await fetch(url, {
		...init,
		headers: {
			Accept: "application/json",
			"User-Agent": "opentrends/0.1 (+https://github.com/opentrends)",
			...init.headers,
		},
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${url}`);
	}
	return (await response.json()) as T;
}

export async function fetchText(
	url: string,
	init: RequestInit & { signal: AbortSignal }
): Promise<string> {
	const response = await fetch(url, {
		...init,
		headers: {
			"User-Agent": "opentrends/0.1 (+https://github.com/opentrends)",
			...init.headers,
		},
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${url}`);
	}
	return await response.text();
}
