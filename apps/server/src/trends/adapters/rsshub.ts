import { getRssHubBaseUrls } from "../config/rsshub-instances";
import type {
	FetchContext,
	NewsItem,
	RssHubSourcePreset,
	SourceAdapter,
} from "../types";
import {
	clampItems,
	cleanDescription,
	extractImageFromHtml,
	fetchJson,
	isValidUrl,
	normalizeText,
	sortByPublishedAtDesc,
} from "./shared";

interface RssHubJsonFeed {
	items?: RssHubItem[];
	title?: string;
}

interface RssHubItem {
	content_html?: string;
	content_text?: string;
	date_published?: string;
	id?: string;
	image?: string;
	title?: string;
	url?: string;
}

const RSSHUB_INSTANCE_TIMEOUT_MS = 3500;
const RSSHUB_HEDGE_DELAY_MS = 300;

export function buildRssHubRequestUrl(
	baseUrl: string,
	preset: RssHubSourcePreset
): string {
	const route = preset.route.startsWith("/")
		? preset.route
		: `/${preset.route}`;
	const url = new URL(baseUrl + route);
	url.searchParams.set("format", "json");
	if (preset.params) {
		for (const [key, value] of Object.entries(preset.params)) {
			url.searchParams.set(key, String(value));
		}
	}
	return url.toString();
}

export function buildRssHubRequestUrls(
	preset: RssHubSourcePreset,
	baseUrls = getRssHubBaseUrls()
): string[] {
	return baseUrls.map((baseUrl) => buildRssHubRequestUrl(baseUrl, preset));
}

function toNewsItem(
	entry: RssHubItem,
	rank: number,
	sourceId: string,
	fetchedAt: number
): NewsItem | undefined {
	const title = normalizeText(entry.title);
	const link = entry.url;
	if (!(title && isValidUrl(link))) {
		return;
	}
	const publishedRaw = entry.date_published
		? Date.parse(entry.date_published)
		: Number.NaN;
	const imageUrl = isValidUrl(entry.image)
		? entry.image
		: extractImageFromHtml(entry.content_html);
	return {
		id: entry.id || link,
		sourceId,
		title,
		url: link,
		rank,
		publishedAt: Number.isFinite(publishedRaw) ? publishedRaw : undefined,
		fetchedAt,
		description: cleanDescription(entry.content_text ?? entry.content_html),
		imageUrl,
	};
}

interface RssHubAdapterOptions {
	baseUrls?: string[];
	hedgeDelayMs?: number;
	instanceTimeoutMs?: number;
}

export function createRssHubAdapter(
	preset: RssHubSourcePreset,
	options: RssHubAdapterOptions = {}
): SourceAdapter {
	return {
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: instance hedging and fallback flow is intentionally explicit.
		async fetch(ctx: FetchContext): Promise<NewsItem[]> {
			const requestUrls = buildRssHubRequestUrls(preset, options.baseUrls);
			const instanceTimeoutMs =
				options.instanceTimeoutMs ?? RSSHUB_INSTANCE_TIMEOUT_MS;
			const hedgeDelayMs = options.hedgeDelayMs ?? RSSHUB_HEDGE_DELAY_MS;
			const controllers: AbortController[] = [];
			const cleanupFns: Array<() => void> = [];
			const errors: Error[] = [];

			async function fetchFromInstance(
				requestUrl: string,
				index: number
			): Promise<RssHubJsonFeed> {
				await waitForHedgeDelay(ctx.signal, index * hedgeDelayMs);
				const { cleanup, controller, signal } = createInstanceSignal(
					ctx.signal,
					instanceTimeoutMs
				);
				controllers.push(controller);
				cleanupFns.push(cleanup);
				try {
					return await fetchJson<RssHubJsonFeed>(requestUrl, { signal });
				} catch (rawError) {
					const error =
						rawError instanceof Error ? rawError : new Error(String(rawError));
					errors[index] = error;
					throw error;
				}
			}

			try {
				const data = await Promise.any(
					requestUrls.map((requestUrl, index) =>
						fetchFromInstance(requestUrl, index)
					)
				);
				return normalizeRssHubItems(data, ctx.sourceId);
			} catch (rawError) {
				if (ctx.signal.aborted) {
					throw rawError;
				}
				let lastError: Error | undefined;
				for (const error of errors) {
					if (error) {
						lastError = error;
					}
				}
				const detail = lastError ? ` Last error: ${lastError.message}` : "";
				throw new Error(
					`RSSHub fetch failed for ${ctx.sourceId}: tried ${requestUrls.length} instance(s).${detail}`
				);
			} finally {
				for (const controller of controllers) {
					controller.abort();
				}
				for (const cleanup of cleanupFns) {
					cleanup();
				}
			}
		},
	};
}

function createInstanceSignal(
	parentSignal: AbortSignal,
	timeoutMs: number
): { cleanup: () => void; controller: AbortController; signal: AbortSignal } {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const abort = () => controller.abort();
	if (parentSignal.aborted) {
		abort();
	} else {
		parentSignal.addEventListener("abort", abort, { once: true });
	}
	return {
		cleanup: () => {
			clearTimeout(timeout);
			parentSignal.removeEventListener("abort", abort);
		},
		controller,
		signal: controller.signal,
	};
}

function waitForHedgeDelay(
	parentSignal: AbortSignal,
	delayMs: number
): Promise<void> {
	if (delayMs <= 0) {
		return Promise.resolve();
	}
	if (parentSignal.aborted) {
		return Promise.reject(
			parentSignal.reason instanceof Error
				? parentSignal.reason
				: new Error("The operation was aborted.")
		);
	}
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			parentSignal.removeEventListener("abort", abort);
			resolve();
		}, delayMs);
		const abort = () => {
			clearTimeout(timeout);
			reject(
				parentSignal.reason instanceof Error
					? parentSignal.reason
					: new Error("The operation was aborted.")
			);
		};
		parentSignal.addEventListener("abort", abort, { once: true });
	});
}

function normalizeRssHubItems(
	data: RssHubJsonFeed,
	sourceId: string
): NewsItem[] {
	const fetchedAt = Date.now();
	const items: NewsItem[] = [];
	const list = data.items ?? [];

	for (let i = 0; i < list.length; i++) {
		const entry = list[i];
		if (!entry) {
			continue;
		}
		const item = toNewsItem(entry, i + 1, sourceId, fetchedAt);
		if (item) {
			items.push(item);
		}
	}

	return clampItems(sortByPublishedAtDesc(items));
}
