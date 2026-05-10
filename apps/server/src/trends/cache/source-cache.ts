import { db, schema } from "@opentrends/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import type {
	NewsItem,
	SourceId,
	SourceSnapshot,
	SourceStatus,
} from "../types";

const { source, sourceItem } = schema;
const SOURCE_SNAPSHOT_ITEM_READ_LIMIT = 30;
const SNAPSHOT_READ_BATCH_SIZE = 24;

export interface SourceSnapshotSummary {
	errorCount: number;
	expiresAt: number;
	fetchedAt: number;
	itemCount: number;
	lastError?: string;
	sourceId: SourceId;
	staleUntil: number;
	status: SourceStatus;
}

interface SourceRow {
	errorCount: number;
	expiresAt: Date | null;
	fetchedAt: Date | null;
	generation: number;
	itemCount: number;
	lastError: string | null;
	sourceId: string;
	staleUntil: Date | null;
	status: string;
}

interface SourceItemRow {
	description: string | null;
	fetchedAt: Date;
	generation: number;
	hotValue: string | number | null;
	imageUrl: string | null;
	itemId: string;
	original: { description?: string; title: string } | null;
	publishedAt: Date | null;
	rank: number;
	sourceId: string;
	title: string;
	url: string;
}

function isReadableSourceRow(row: SourceRow): row is SourceRow & {
	expiresAt: Date;
	fetchedAt: Date;
	staleUntil: Date;
} {
	return (
		row.generation > 0 &&
		row.fetchedAt !== null &&
		row.expiresAt !== null &&
		row.staleUntil !== null
	);
}

function compareSourceItems(a: SourceItemRow, b: SourceItemRow): number {
	const aTime = a.publishedAt?.getTime() ?? a.fetchedAt.getTime();
	const bTime = b.publishedAt?.getTime() ?? b.fetchedAt.getTime();
	if (aTime !== bTime) {
		return bTime - aTime;
	}
	return a.rank - b.rank;
}

function itemRowToNewsItem(row: SourceItemRow): NewsItem {
	return {
		id: row.itemId,
		url: row.url,
		rank: row.rank,
		title: row.title,
		sourceId: row.sourceId,
		fetchedAt: row.fetchedAt.getTime(),
		description: row.description ?? undefined,
		hotValue: row.hotValue ?? undefined,
		imageUrl: row.imageUrl ?? undefined,
		original: row.original ?? undefined,
		publishedAt: row.publishedAt?.getTime(),
	};
}

function toSourceSnapshot(
	row: SourceRow & { expiresAt: Date; fetchedAt: Date; staleUntil: Date },
	items: SourceItemRow[]
): SourceSnapshot {
	const sortedItems = [...items]
		.sort(compareSourceItems)
		.slice(0, SOURCE_SNAPSHOT_ITEM_READ_LIMIT);
	return {
		sourceId: row.sourceId,
		items: sortedItems.map((item, index) => ({
			...itemRowToNewsItem(item),
			rank: index + 1,
		})),
		fetchedAt: row.fetchedAt.getTime(),
		expiresAt: row.expiresAt.getTime(),
		staleUntil: row.staleUntil.getTime(),
		status: row.status as SourceStatus,
		errorCount: row.errorCount,
		lastError: row.lastError ?? undefined,
	};
}

function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

function makeContentHash(item: NewsItem): string {
	const input = [
		item.title,
		item.description ?? "",
		item.url,
		item.publishedAt ?? "",
	].join("\u0000");
	let hash = 0x81_1c_9d_c5;
	for (let i = 0; i < input.length; i += 1) {
		// biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash step uses XOR by design.
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01_00_01_93);
	}
	// biome-ignore lint/suspicious/noBitwiseOperators: convert to unsigned 32-bit hash.
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function readSnapshot(
	sourceId: SourceId
): Promise<SourceSnapshot | null> {
	const snapshots = await readSnapshots([sourceId]);
	return snapshots.get(sourceId) ?? null;
}

export async function readSnapshots(
	sourceIds: readonly SourceId[]
): Promise<Map<SourceId, SourceSnapshot>> {
	if (sourceIds.length === 0) {
		return new Map();
	}

	const snapshots = new Map<SourceId, SourceSnapshot>();
	for (const batch of chunk(sourceIds, SNAPSHOT_READ_BATCH_SIZE)) {
		for (const snapshot of await readSnapshotBatch(batch)) {
			snapshots.set(snapshot.sourceId, snapshot);
		}
	}
	return snapshots;
}

async function readSnapshotBatch(
	sourceIds: readonly SourceId[]
): Promise<SourceSnapshot[]> {
	try {
		return await selectSnapshotBatch(sourceIds);
	} catch (error) {
		console.warn("[source-cache] retrying source batch read", error);
		return selectSnapshotBatch(sourceIds);
	}
}

async function selectSnapshotBatch(
	sourceIds: readonly SourceId[]
): Promise<SourceSnapshot[]> {
	const rows = await db
		.select({
			sourceId: source.sourceId,
			generation: source.generation,
			fetchedAt: source.fetchedAt,
			expiresAt: source.expiresAt,
			staleUntil: source.staleUntil,
			status: source.status,
			errorCount: source.errorCount,
			lastError: source.lastError,
			itemCount: source.itemCount,
		})
		.from(source)
		.where(inArray(source.sourceId, [...sourceIds]));

	const readableRows = rows.filter(isReadableSourceRow);
	if (readableRows.length === 0) {
		return [];
	}

	const sourceGenerationPredicates = readableRows.map((row) =>
		and(
			eq(sourceItem.sourceId, row.sourceId),
			eq(sourceItem.generation, row.generation)
		)
	);
	const itemRows = await db
		.select({
			sourceId: sourceItem.sourceId,
			itemId: sourceItem.itemId,
			generation: sourceItem.generation,
			url: sourceItem.url,
			title: sourceItem.title,
			description: sourceItem.description,
			imageUrl: sourceItem.imageUrl,
			rank: sourceItem.rank,
			publishedAt: sourceItem.publishedAt,
			fetchedAt: sourceItem.fetchedAt,
			hotValue: sourceItem.hotValue,
			original: sourceItem.original,
		})
		.from(sourceItem)
		.where(or(...sourceGenerationPredicates))
		.orderBy(asc(sourceItem.sourceId), asc(sourceItem.rank));

	const itemsBySourceAndGeneration = new Map<string, SourceItemRow[]>();
	for (const item of itemRows) {
		const key = `${item.sourceId}:${item.generation}`;
		const items = itemsBySourceAndGeneration.get(key) ?? [];
		items.push(item);
		itemsBySourceAndGeneration.set(key, items);
	}

	return readableRows.map((row) =>
		toSourceSnapshot(
			row,
			itemsBySourceAndGeneration.get(`${row.sourceId}:${row.generation}`) ?? []
		)
	);
}

export async function readSnapshotSummaries(
	sourceIds: readonly SourceId[]
): Promise<Map<SourceId, SourceSnapshotSummary>> {
	if (sourceIds.length === 0) {
		return new Map();
	}

	const rows: SourceRow[] = [];
	for (const batch of chunk(sourceIds, SNAPSHOT_READ_BATCH_SIZE)) {
		rows.push(...(await readSnapshotSummaryBatch(batch)));
	}

	const snapshots = new Map<SourceId, SourceSnapshotSummary>();
	for (const row of rows) {
		if (!isReadableSourceRow(row)) {
			continue;
		}
		snapshots.set(row.sourceId as SourceId, {
			sourceId: row.sourceId as SourceId,
			fetchedAt: row.fetchedAt.getTime(),
			expiresAt: row.expiresAt.getTime(),
			staleUntil: row.staleUntil.getTime(),
			status: row.status as SourceStatus,
			errorCount: row.errorCount,
			lastError: row.lastError ?? undefined,
			itemCount: row.itemCount,
		});
	}
	return snapshots;
}

async function readSnapshotSummaryBatch(
	sourceIds: readonly SourceId[]
): Promise<SourceRow[]> {
	try {
		return await selectSnapshotSummaryBatch(sourceIds);
	} catch (error) {
		console.warn("[source-cache] retrying source summary batch read", error);
		return selectSnapshotSummaryBatch(sourceIds);
	}
}

function selectSnapshotSummaryBatch(
	sourceIds: readonly SourceId[]
): Promise<SourceRow[]> {
	return db
		.select({
			sourceId: source.sourceId,
			generation: source.generation,
			fetchedAt: source.fetchedAt,
			expiresAt: source.expiresAt,
			staleUntil: source.staleUntil,
			status: source.status,
			errorCount: source.errorCount,
			lastError: source.lastError,
			itemCount: source.itemCount,
		})
		.from(source)
		.where(inArray(source.sourceId, [...sourceIds]));
}

export async function writeSnapshotSuccess(params: {
	sourceId: SourceId;
	items: NewsItem[];
	fetchedAt: number;
	softTtlMs: number;
	staleTtlMs: number;
}): Promise<void> {
	const { sourceId, items, fetchedAt, softTtlMs, staleTtlMs } = params;
	const fetchedAtDate = new Date(fetchedAt);
	const expiresAt = new Date(fetchedAt + softTtlMs);
	const staleUntil = new Date(fetchedAt + staleTtlMs);

	await db.transaction(async (tx) => {
		const existing = await tx
			.select({ generation: source.generation })
			.from(source)
			.where(eq(source.sourceId, sourceId))
			.limit(1);
		const generation = (existing[0]?.generation ?? 0) + 1;

		await tx
			.insert(source)
			.values({
				sourceId,
				generation,
				fetchedAt: fetchedAtDate,
				lastSuccessAt: fetchedAtDate,
				expiresAt,
				staleUntil,
				status: "ok",
				itemCount: items.length,
				errorCount: 0,
				lastError: null,
				refreshOwner: null,
				refreshLockedUntil: null,
				updatedAt: fetchedAtDate,
			})
			.onConflictDoUpdate({
				target: source.sourceId,
				set: {
					generation,
					fetchedAt: fetchedAtDate,
					lastSuccessAt: fetchedAtDate,
					expiresAt,
					staleUntil,
					status: "ok",
					itemCount: items.length,
					errorCount: 0,
					lastError: null,
					refreshOwner: null,
					refreshLockedUntil: null,
					updatedAt: fetchedAtDate,
				},
			});

		if (items.length === 0) {
			return;
		}

		await tx
			.insert(sourceItem)
			.values(
				items.map((item, index) => ({
					sourceId,
					itemId: item.id,
					generation,
					url: item.url,
					title: item.title,
					description: item.description ?? null,
					imageUrl: item.imageUrl ?? null,
					rank: item.rank ?? index + 1,
					publishedAt:
						item.publishedAt === undefined ? null : new Date(item.publishedAt),
					fetchedAt: new Date(item.fetchedAt),
					lastSeenAt: fetchedAtDate,
					contentHash: makeContentHash(item),
					hotValue: item.hotValue ?? null,
					original: item.original ?? null,
				}))
			)
			.onConflictDoUpdate({
				target: [sourceItem.sourceId, sourceItem.itemId],
				set: {
					generation: sql`excluded.generation`,
					url: sql`excluded.url`,
					title: sql`excluded.title`,
					description: sql`excluded.description`,
					imageUrl: sql`excluded.image_url`,
					rank: sql`excluded.rank`,
					publishedAt: sql`excluded.published_at`,
					fetchedAt: sql`excluded.fetched_at`,
					lastSeenAt: sql`excluded.last_seen_at`,
					contentHash: sql`excluded.content_hash`,
					hotValue: sql`excluded.hot_value`,
					original: sql`excluded.original`,
				},
			});
	});
}

export async function writeSnapshotError(params: {
	sourceId: SourceId;
	errorMessage: string;
	fetchedAt: number;
	staleTtlMs: number;
	previous: SourceSnapshot | null;
}): Promise<void> {
	const { sourceId, errorMessage, fetchedAt, staleTtlMs, previous } = params;
	const fetchedAtDate = new Date(fetchedAt);
	const errorCount = (previous?.errorCount ?? 0) + 1;
	const status: SourceStatus =
		previous && previous.items.length > 0 ? "stale" : "error";
	// Don't pin a hard error for the full soft TTL — back off briefly and let the next request retry.
	const errorBackoffMs = Math.min(30_000 * errorCount, 5 * 60_000);
	const expiresAt = new Date(fetchedAt + errorBackoffMs);
	const staleUntil = new Date(fetchedAt + staleTtlMs);

	await db
		.insert(source)
		.values({
			sourceId,
			fetchedAt: previous ? new Date(previous.fetchedAt) : null,
			expiresAt,
			staleUntil,
			status,
			itemCount: previous?.items.length ?? 0,
			errorCount,
			lastError: errorMessage,
			refreshOwner: null,
			refreshLockedUntil: null,
			updatedAt: fetchedAtDate,
		})
		.onConflictDoUpdate({
			target: source.sourceId,
			set: {
				expiresAt,
				staleUntil,
				status,
				errorCount,
				lastError: errorMessage,
				refreshOwner: null,
				refreshLockedUntil: null,
				updatedAt: fetchedAtDate,
			},
		});
}
