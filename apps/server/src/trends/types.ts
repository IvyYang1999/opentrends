export type TopicId =
	| "home"
	| "ai"
	| "programming"
	| "cn"
	| "embodied"
	| "hardware"
	| "biotech";
export type SourceId = string;

export type SourceStatus = "ok" | "stale" | "error";

export interface NewsItem {
	/**
	 * Short summary / lead / abstract of the item, used by the LLM-backed
	 * trends summary so the model has more context than titles alone.
	 * Keep it short (a couple of sentences); adapters strip HTML and clamp
	 * length before storing.
	 */
	description?: string;
	fetchedAt: number;
	hotValue?: string | number;
	id: string;
	/**
	 * Cover / thumbnail image URL extracted from the upstream feed where
	 * available (RSS enclosure, media:thumbnail, media:content, or the
	 * first <img> in the description / content body). Optional — most
	 * native sources don't carry per-item images.
	 */
	imageUrl?: string;
	original?: {
		description?: string;
		title: string;
	};
	publishedAt?: number;
	rank?: number;
	sourceId: SourceId;
	title: string;
	url: string;
}

export interface SourceCardData {
	errorMessage?: string;
	eventEligible?: boolean;
	expiresAt?: number;
	homeUrl?: string;
	itemCount?: number;
	items: NewsItem[];
	itemsTruncated?: boolean;
	sourceId: SourceId;
	staleUntil?: number;
	status: SourceStatus;
	title: string;
	updatedAt?: number;
}

export interface TrendsSectionData {
	id: string;
	sources: SourceCardData[];
	title: string;
}

export interface TrendsPageData {
	description?: string;
	id: TopicId;
	sections: TrendsSectionData[];
	title: string;
	updatedAt: number;
}

export interface FetchContext {
	params?: Record<string, string | number | boolean>;
	signal: AbortSignal;
	sourceId: SourceId;
}

export interface SourceAdapter {
	fetch(ctx: FetchContext): Promise<NewsItem[]>;
}

export interface RefreshPolicy {
	softTtlMs: number;
	staleTtlMs: number;
	timeoutMs: number;
}

export type RefreshPolicyId = "hot" | "community" | "rss" | "daily" | "slow";

export type SourceProvider = "native" | "rsshub" | "rss";

export type NativeAdapterId =
	| "zhihuHot"
	| "hackerNews"
	| "githubTrending"
	| "productHunt"
	| "juejinHot"
	| "reddit"
	| "qwenResearch"
	| "crowdSupply"
	| "kickstarter"
	| "newsnowCn";

export interface NativeSourcePreset {
	adapter: NativeAdapterId;
	eventEligible?: boolean;
	homeUrl?: string;
	name: string;
	params?: Record<string, string | number | boolean>;
	provider: "native";
	refresh: RefreshPolicyId;
}

export interface RssHubSourcePreset {
	eventEligible?: boolean;
	homeUrl?: string;
	name: string;
	params?: Record<string, string | number | boolean>;
	provider: "rsshub";
	refresh: RefreshPolicyId;
	route: string;
}

export interface RssSourcePreset {
	eventEligible?: boolean;
	feedUrl: string;
	homeUrl?: string;
	name: string;
	provider: "rss";
	refresh: RefreshPolicyId;
}

export type SourcePreset =
	| NativeSourcePreset
	| RssHubSourcePreset
	| RssSourcePreset;

export interface TopicSection {
	id: string;
	sourceIds: SourceId[];
	title: string;
}

export interface TopicPreset {
	description?: string;
	path: string;
	sections: TopicSection[];
	title: string;
}

export interface SourceSnapshot {
	errorCount: number;
	expiresAt: number;
	fetchedAt: number;
	items: NewsItem[];
	lastError?: string;
	sourceId: SourceId;
	staleUntil: number;
	status: SourceStatus;
}
