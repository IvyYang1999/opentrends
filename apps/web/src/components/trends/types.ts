export type SourceStatus = "ok" | "stale" | "error";

export interface NewsItem {
	description?: string;
	fetchedAt: number;
	hotValue?: string | number;
	id: string;
	imageUrl?: string;
	original?: {
		description?: string;
		title: string;
	};
	publishedAt?: number;
	rank?: number;
	sourceId: string;
	title: string;
	url: string;
}

export interface SourceCardData {
	errorMessage?: string;
	homeUrl?: string;
	itemCount?: number;
	items: NewsItem[];
	itemsTruncated?: boolean;
	sourceId: string;
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
	id: string;
	sections: TrendsSectionData[];
	title: string;
	updatedAt: number;
}
