import { env } from "@opentrends/env/server";

export const DEFAULT_RSSHUB_BASE_URLS = [
	"https://rss.datuan.dev",
	"https://rss.4040940.xyz",
	"https://rsshub.cups.moe",
	"https://rss.spriple.org",
	"https://rsshub-balancer.virworks.moe",
	"https://rsshub.umzzz.com",
	"https://rsshub.isrss.com",
] as const;

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const TRAILING_SLASHES_RE = /\/+$/;
const URL_LIST_SEPARATOR_RE = /[\s,]+/;

function normalizeRssHubBaseUrl(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return;
	}
	const candidate = ABSOLUTE_URL_RE.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	try {
		const url = new URL(candidate);
		if (!(url.protocol === "http:" || url.protocol === "https:")) {
			return;
		}
		return url.toString().replace(TRAILING_SLASHES_RE, "");
	} catch {
		return;
	}
}

export function parseRssHubBaseUrls(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	const urls: string[] = [];
	const seen = new Set<string>();
	for (const part of value.split(URL_LIST_SEPARATOR_RE)) {
		const url = normalizeRssHubBaseUrl(part);
		if (!url || seen.has(url)) {
			continue;
		}
		urls.push(url);
		seen.add(url);
	}
	return urls;
}

export function resolveRssHubBaseUrls(
	configuredValue: string | undefined,
	defaultBaseUrls: readonly string[] = DEFAULT_RSSHUB_BASE_URLS
): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	for (const url of [
		...parseRssHubBaseUrls(configuredValue),
		...defaultBaseUrls,
	]) {
		const normalized = normalizeRssHubBaseUrl(url);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		urls.push(normalized);
		seen.add(normalized);
	}
	return urls;
}

export function getRssHubBaseUrls(): string[] {
	return resolveRssHubBaseUrls(env.RSSHUB_BASE_URLS);
}
