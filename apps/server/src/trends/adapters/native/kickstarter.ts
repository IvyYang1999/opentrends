import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import { clampItems, fetchJson, isValidUrl, normalizeText } from "../shared";

const TECH_CATEGORY_ID = 16;
const DISCOVER_URL = `https://www.kickstarter.com/discover/advanced?format=json&category_id=${TECH_CATEGORY_ID}&sort=popularity&state=live`;

// Kickstarter sits behind Cloudflare; its discover JSON endpoint is reachable
// without solving the JS challenge as long as the request looks like a real
// browser. Without these headers every request gets a 403.
const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
	Accept: "application/json, text/plain, */*",
	"Accept-Language": "en-US,en;q=0.9",
	Referer: "https://www.kickstarter.com/discover/categories/technology",
};

interface KickstarterDiscoverResponse {
	projects?: KickstarterProject[];
}

interface KickstarterProject {
	backers_count?: number;
	blurb?: string;
	goal?: number;
	id?: number;
	launched_at?: number;
	name?: string;
	photo?: { full?: string; med?: string; small?: string };
	pledged?: number;
	state?: string;
	urls?: { web?: { project?: string } };
}

function resolvePhoto(project: KickstarterProject): string | undefined {
	const candidates = [
		project.photo?.med,
		project.photo?.full,
		project.photo?.small,
	];
	for (const candidate of candidates) {
		if (isValidUrl(candidate)) {
			return candidate;
		}
	}
	return;
}

function percentFunded(project: KickstarterProject): number | undefined {
	const pledged = project.pledged;
	const goal = project.goal;
	if (typeof pledged !== "number" || typeof goal !== "number" || goal <= 0) {
		return;
	}
	return Math.round((pledged / goal) * 100);
}

export const kickstarterAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const data = await fetchJson<KickstarterDiscoverResponse>(DISCOVER_URL, {
			signal: ctx.signal,
			headers: BROWSER_HEADERS,
		});
		const fetchedAt = Date.now();
		const list = data.projects ?? [];
		const items: NewsItem[] = [];

		let rank = 0;
		for (const project of list) {
			const title = normalizeText(project.name);
			const url = project.urls?.web?.project;
			if (!(title && isValidUrl(url))) {
				continue;
			}
			rank += 1;
			items.push({
				id: project.id ? `kickstarter-${project.id}` : url,
				sourceId: ctx.sourceId,
				title,
				url,
				rank,
				hotValue: percentFunded(project),
				publishedAt: project.launched_at
					? Math.round(project.launched_at * 1000)
					: undefined,
				fetchedAt,
				description: project.blurb ? normalizeText(project.blurb) : undefined,
				imageUrl: resolvePhoto(project),
			});
		}

		return clampItems(items);
	},
};
