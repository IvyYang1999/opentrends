import type { Locale } from "@/lib/i18n";
import { TRENDS_PREVIEW_ITEMS_PER_SOURCE } from "./trends-limits";
import type { TrendsPageData } from "./types";

export const SSR_TRENDS_TIMEOUT_MS = 3000;

/** A single public preview read. Failure leaves the existing client loader in charge. */
export async function readTrendsSnapshot(
	fetcher: (request: Request) => Promise<Response>,
	origin: string,
	topic: string,
	locale: Locale,
	timeoutMs = SSR_TRENDS_TIMEOUT_MS
): Promise<TrendsPageData | null> {
	const url = new URL(`/api/trends/${encodeURIComponent(topic)}`, origin);
	url.search = new URLSearchParams({
		items: String(TRENDS_PREVIEW_ITEMS_PER_SOURCE),
		lang: locale,
		translations: "background",
	}).toString();
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve(null);
		}, timeoutMs);
	});
	try {
		const read = async (): Promise<TrendsPageData | null> => {
			const response = await fetcher(
				new Request(url, { credentials: "omit", signal: controller.signal })
			);
			if (!response.ok) {
				await response.body?.cancel();
				return null;
			}
			const page = (await response.json()) as TrendsPageData;
			return page?.id === topic &&
				typeof page.title === "string" &&
				Array.isArray(page.sections)
				? page
				: null;
		};
		return await Promise.race([read(), deadline]);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
