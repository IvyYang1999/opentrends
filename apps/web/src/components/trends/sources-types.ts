export type SourceProvider = "native" | "rsshub" | "rss";
export type SourceLifecycleStatus = "ok" | "stale" | "error" | "missing";

export interface SourceStatusEntry {
	endpointUrl?: string;
	errorCount: number;
	eventEligible: boolean;
	eventItemCount: number;
	expiresAt?: number;
	fetchedAt?: number;
	homeUrl?: string;
	itemCount: number;
	lastError?: string;
	name: string;
	note: string;
	provider: SourceProvider;
	refresh: string;
	sourceId: string;
	staleUntil?: number;
	status: SourceLifecycleStatus;
	topics: string[];
}

export interface SourcesStatusResponse {
	generatedAt: number;
	sources: SourceStatusEntry[];
	topics: Array<{ id: string; title: string }>;
	totals: {
		sources: number;
		ok: number;
		stale: number;
		error: number;
		missing: number;
		eventItems: number;
	};
}
