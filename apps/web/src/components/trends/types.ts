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
	eventEligible?: boolean;
	expiresAt?: number;
	homeUrl?: string;
	itemCount?: number;
	items: NewsItem[];
	itemsTruncated?: boolean;
	sourceId: string;
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
	id: string;
	sections: TrendsSectionData[];
	title: string;
	updatedAt: number;
}

export interface EventFeedItem {
	eventId: string;
	firstSeenAt: string;
	imageUrl?: string;
	lastSeenAt: string;
	original?: {
		summary?: string;
		title: string;
	};
	primarySource?: {
		imageUrl?: string;
		sourceId: string;
		title: string;
		url: string;
	};
	score: number;
	selectionReason?:
		| "high_score"
		| "multiple_sources"
		| "official_source"
		| "selected"
		| "strong_source";
	sourceCount: number;
	sources: Array<{
		homeUrl?: string;
		sourceId: string;
		title: string;
	}>;
	summary?: string;
	title: string;
	topicId: string;
	topicIds?: string[];
}

export interface EventFeedData {
	events: EventFeedItem[];
	nextOffset?: number;
}

export interface EventDetailData {
	eventId: string;
	firstSeenAt: string;
	lastSeenAt: string;
	original?: {
		summary?: string;
		title: string;
	};
	processing: {
		embeddedItemCount: number;
		embeddingModel: string;
		enrichedItemCount: number;
		inputItemCount: number;
		itemLimit: number;
		lookbackHours: number;
		mergeRules: {
			similarityThreshold: number;
			timeWindowHours: number;
		};
		scoreInputs: {
			itemScore: number;
			sourceScore: number;
			uniqueSourceCount: number;
		};
		steps: Array<{
			detail: string;
			label: string;
			status: "done" | "pending" | "skipped";
		}>;
	};
	score: number;
	sourceItems: Array<{
		contentFetchedAt?: string;
		contentStatus: string;
		description?: string;
		embeddingModel?: string;
		hasEmbedding: boolean;
		itemId: string;
		imageUrl?: string;
		isPrimary: boolean;
		mergeConfidence: number;
		original?: {
			description?: string;
			title: string;
		};
		publishedAt?: string;
		sourceId: string;
		textHash?: string;
		title: string;
		url: string;
	}>;
	summary?: string;
	title: string;
	topicId: string;
}
