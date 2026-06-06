import { getAdapterForPreset } from "../adapters";
import {
	readSnapshot,
	writeSnapshotError,
	writeSnapshotSuccess,
} from "../cache/source-cache";
import { acquireRefreshLock, releaseRefreshLock } from "../cache/source-lock";
import {
	REFRESH_LOCK_GRACE_MS,
	refreshPolicies,
} from "../config/refresh-policies";
import { getSourcePreset } from "../config/sources";
import type { SourceId, SourceSnapshot } from "../types";
import { dispatchEventMergeJob } from "./event-merge-jobs";

export type RefreshOutcome =
	| { kind: "ok"; snapshot: SourceSnapshot }
	| { kind: "skipped"; reason: "locked" | "unknown-source" }
	| { kind: "error"; error: Error };

export async function refreshSource(
	sourceId: SourceId
): Promise<RefreshOutcome> {
	const preset = getSourcePreset(sourceId);
	if (!preset) {
		return { kind: "skipped", reason: "unknown-source" };
	}

	const policy = refreshPolicies[preset.refresh];
	const acquired = await acquireRefreshLock(
		sourceId,
		policy.timeoutMs + REFRESH_LOCK_GRACE_MS
	);
	if (!acquired) {
		return { kind: "skipped", reason: "locked" };
	}

	const previous = await readSnapshot(sourceId);
	const adapter = getAdapterForPreset(preset);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);

	try {
		const items = await adapter.fetch({
			sourceId,
			signal: controller.signal,
			params: "params" in preset ? preset.params : undefined,
		});
		const fetchedAt = Date.now();
		const delta = await writeSnapshotSuccess({
			sourceId,
			items,
			fetchedAt,
			softTtlMs: policy.softTtlMs,
			staleTtlMs: policy.staleTtlMs,
		});
		const itemsToProcess = [...delta.newItems, ...delta.changedItems];
		await dispatchEventMergeJob({ sourceId, items: itemsToProcess }).catch(
			(error) => {
				console.warn(
					"[event-merge] dispatch failed after source refresh",
					error
				);
			}
		);
		return {
			kind: "ok",
			snapshot: {
				sourceId,
				items,
				fetchedAt,
				expiresAt: fetchedAt + policy.softTtlMs,
				staleUntil: fetchedAt + policy.staleTtlMs,
				status: "ok",
				errorCount: 0,
			},
		};
	} catch (rawError) {
		const error =
			rawError instanceof Error ? rawError : new Error(String(rawError));
		const fetchedAt = Date.now();
		await writeSnapshotError({
			sourceId,
			errorMessage: error.message,
			fetchedAt,
			staleTtlMs: policy.staleTtlMs,
			previous,
		});
		return { kind: "error", error };
	} finally {
		clearTimeout(timeout);
		await releaseRefreshLock(sourceId).catch(() => {
			/* ignore */
		});
	}
}
