import {
	readSnapshotSummaries,
	type SourceSnapshotSummary,
} from "../cache/source-cache";
import { getRssHubBaseUrls } from "../config/rsshub-instances";
import { sourceNotes, sourcePresets } from "../config/sources";
import { topicPresets } from "../config/topics";
import type {
	SourcePreset,
	SourceProvider,
	SourceStatus,
	TopicId,
} from "../types";

export interface SourceStatusEntry {
	endpointUrl?: string;
	errorCount: number;
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
	status: SourceStatus | "missing";
	topics: TopicId[];
}

function computeEndpointUrl(preset: SourcePreset): string | undefined {
	if (preset.provider === "rss") {
		return preset.feedUrl;
	}
	if (preset.provider === "rsshub") {
		const base = getRssHubBaseUrls()[0];
		if (!base) {
			return;
		}
		const route = preset.route.startsWith("/")
			? preset.route
			: `/${preset.route}`;
		const url = new URL(base + route);
		if (preset.params) {
			for (const [key, value] of Object.entries(preset.params)) {
				url.searchParams.set(key, String(value));
			}
		}
		return url.toString();
	}
	return;
}

export interface SourcesStatusResponse {
	generatedAt: number;
	sources: SourceStatusEntry[];
	topics: Array<{ id: TopicId; title: string }>;
	totals: {
		sources: number;
		ok: number;
		stale: number;
		error: number;
		missing: number;
	};
}

export type SourcesStatusCacheStatus =
	| "config"
	| "edge"
	| "memory-stale"
	| "snapshot";

let lastSourcesStatus: SourcesStatusResponse | undefined;

function buildTopicIndex(): Map<string, TopicId[]> {
	const index = new Map<string, TopicId[]>();
	for (const [topicId, topic] of Object.entries(topicPresets) as [
		TopicId,
		(typeof topicPresets)[TopicId],
	][]) {
		for (const section of topic.sections) {
			for (const sourceId of section.sourceIds) {
				const list = index.get(sourceId) ?? [];
				if (!list.includes(topicId)) {
					list.push(topicId);
				}
				index.set(sourceId, list);
			}
		}
	}
	return index;
}

function buildSourcesStatusFromSnapshots(
	snapshots: ReadonlyMap<string, SourceSnapshotSummary>
): SourcesStatusResponse {
	const topicIndex = buildTopicIndex();
	const entries: SourceStatusEntry[] = [];
	const totals = { sources: 0, ok: 0, stale: 0, error: 0, missing: 0 };

	const presetEntries = Object.entries(sourcePresets) as [
		keyof typeof sourcePresets,
		(typeof sourcePresets)[keyof typeof sourcePresets],
	][];

	for (const entry of presetEntries) {
		if (!entry) {
			continue;
		}
		const [sourceId, preset] = entry;
		const snapshot = snapshots.get(sourceId) ?? null;
		const status: SourceStatus | "missing" = snapshot
			? snapshot.status
			: "missing";

		totals.sources += 1;
		totals[status] += 1;

		entries.push({
			sourceId,
			name: preset.name,
			note: sourceNotes[sourceId],
			provider: preset.provider,
			homeUrl: "homeUrl" in preset ? preset.homeUrl : undefined,
			endpointUrl: computeEndpointUrl(preset),
			refresh: preset.refresh,
			topics: topicIndex.get(sourceId) ?? [],
			status,
			itemCount: snapshot?.itemCount ?? 0,
			fetchedAt: snapshot?.fetchedAt,
			expiresAt: snapshot?.expiresAt,
			staleUntil: snapshot?.staleUntil,
			errorCount: snapshot?.errorCount ?? 0,
			lastError: snapshot?.lastError,
		});
	}

	const topics = (
		Object.entries(topicPresets) as [TopicId, (typeof topicPresets)[TopicId]][]
	).map(([id, t]) => ({ id, title: t.title }));

	return {
		generatedAt: Date.now(),
		sources: entries,
		topics,
		totals,
	};
}

async function buildSourcesStatus(): Promise<SourcesStatusResponse> {
	const presetEntries = Object.entries(sourcePresets) as [
		keyof typeof sourcePresets,
		(typeof sourcePresets)[keyof typeof sourcePresets],
	][];
	const snapshots = await readSnapshotSummaries(
		presetEntries.map(([id]) => id)
	);
	return buildSourcesStatusFromSnapshots(snapshots);
}

export function getSourcesConfigStatus(): SourcesStatusResponse {
	return buildSourcesStatusFromSnapshots(new Map());
}

export async function getSourcesStatusWithCacheInfo(): Promise<{
	cacheStatus: SourcesStatusCacheStatus;
	status: SourcesStatusResponse;
}> {
	try {
		const status = await buildSourcesStatus();
		lastSourcesStatus = status;
		return { cacheStatus: "snapshot", status };
	} catch (error) {
		if (lastSourcesStatus) {
			console.warn("[sources] serving last known source status", error);
			return { cacheStatus: "memory-stale", status: lastSourcesStatus };
		}
		throw error;
	}
}

export async function getSourcesStatus(): Promise<SourcesStatusResponse> {
	const { status } = await getSourcesStatusWithCacheInfo();
	return status;
}
