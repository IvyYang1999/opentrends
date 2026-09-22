import { readSourceRefreshStates } from "../cache/source-cache";
import { sourcePresets } from "../config/sources";
import type { SourceId } from "../types";
import { clearTrendsPageCache } from "./get-trends-page";
import { refreshSource } from "./refresh-source";
import { selectDueSourceIds } from "./source-refresh-priority";
import { reconcileMissingSummaryPrewarms } from "./summary-prewarm-jobs";

const SCHEDULER_TICK_MS = 60_000;
const MAX_REFRESHES_PER_TICK = 4;

interface SchedulerState {
	running: boolean;
	timer?: ReturnType<typeof setInterval> & { unref?: () => void };
}

let state: SchedulerState | undefined;
let nextRequestDrivenTickAt = 0;

function getOrCreateSchedulerState(): SchedulerState {
	state ??= {
		running: false,
	};
	return state;
}

async function refreshDueSources(
	current: SchedulerState,
	now = Date.now()
): Promise<SourceId[]> {
	if (current.running) {
		return [];
	}

	current.running = true;
	try {
		const sourceIds = Object.keys(sourcePresets) as SourceId[];
		const refreshStates = await readSourceRefreshStates(sourceIds);
		const dueSourceIds = selectDueSourceIds(
			sourceIds,
			refreshStates,
			now,
			MAX_REFRESHES_PER_TICK
		);
		const outcomes = await Promise.all(
			dueSourceIds.map(async (sourceId) => ({
				outcome: await refreshSource(sourceId),
				sourceId,
			}))
		);

		let clearPageCache = false;
		const changedSourceIds: SourceId[] = [];
		for (const { outcome, sourceId } of outcomes) {
			if (outcome.kind === "ok" || outcome.kind === "error") {
				clearPageCache = true;
			}
			if (outcome.kind === "ok" && outcome.changed) {
				changedSourceIds.push(sourceId);
			}
		}
		if (clearPageCache) {
			clearTrendsPageCache();
		}
		return changedSourceIds;
	} finally {
		current.running = false;
	}
}

export function startTrendsRefreshScheduler(): () => void {
	if (state) {
		return stopTrendsRefreshScheduler;
	}

	state = {
		running: false,
		timer: setInterval(() => {
			if (!state) {
				return;
			}
			runTrendsRefreshTick().catch((error) => {
				console.error("[trends-refresh-scheduler]", error);
			});
		}, SCHEDULER_TICK_MS),
	};
	state.timer?.unref?.();

	console.log(
		`[trends-refresh-scheduler] enabled for ${Object.keys(sourcePresets).length} sources`
	);
	return stopTrendsRefreshScheduler;
}

export function scheduleTrendsRefreshTick(
	waitUntil?: (promise: Promise<unknown>) => void
): void {
	const now = Date.now();
	if (nextRequestDrivenTickAt > now) {
		return;
	}
	nextRequestDrivenTickAt = now + SCHEDULER_TICK_MS;

	const tick = runTrendsRefreshTick(now).catch((error) => {
		console.error("[trends-refresh-scheduler]", error);
	});
	if (waitUntil) {
		waitUntil(tick);
	}
}

export async function runTrendsRefreshTick(now = Date.now()): Promise<void> {
	const changedSourceIds = await refreshDueSources(
		getOrCreateSchedulerState(),
		now
	);
	await reconcileMissingSummaryPrewarms(changedSourceIds);
}

export function stopTrendsRefreshScheduler(): void {
	if (!state) {
		return;
	}
	if (state.timer) {
		clearInterval(state.timer);
	}
	state = undefined;
	nextRequestDrivenTickAt = 0;
}
