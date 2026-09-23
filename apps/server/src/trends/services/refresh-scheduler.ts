import { readSourceRefreshStates } from "../cache/source-cache";
import { sourcePresets } from "../config/sources";
import { topicPresets } from "../config/topics";
import type { SourceId } from "../types";
import {
	clearTrendsPageCache,
	DEFAULT_TRENDS_ITEMS_PER_SOURCE,
	warmTrendsPage,
} from "./get-trends-page";
import { refreshSource } from "./refresh-source";
import { selectDueSourceIds } from "./source-refresh-priority";
import { reconcileMissingSummaryPrewarms } from "./summary-prewarm-jobs";
import type { TranslationLanguage } from "./translate-news-items";

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
	await warmTopicPages();
}

// The pages readers open first, kept built ahead of them: every topic in
// the two prewarmed languages, at the two item counts the web app asks for.
// Fresh pages are skipped, so a quiet tick costs a few KV reads.
const WARM_LANGUAGES: TranslationLanguage[] = ["zh", "en"];
const WARM_ITEM_COUNTS = [DEFAULT_TRENDS_ITEMS_PER_SOURCE, 12];
const WARM_CONCURRENCY = 2;

async function warmTopicPages(): Promise<void> {
	const jobs: (() => Promise<void>)[] = [];
	for (const topicId of Object.keys(topicPresets)) {
		for (const lang of WARM_LANGUAGES) {
			for (const itemsPerSource of WARM_ITEM_COUNTS) {
				jobs.push(async () => {
					try {
						const result = await warmTrendsPage(topicId, lang, itemsPerSource);
						if (result === "rebuilt") {
							console.info(
								`[trends-refresh-scheduler] warmed ${topicId}/${lang}/${itemsPerSource}`
							);
						}
					} catch (error) {
						console.warn("[trends-refresh-scheduler] page warm failed", {
							error,
							itemsPerSource,
							lang,
							topicId,
						});
					}
				});
			}
		}
	}
	const workers = Array.from({ length: WARM_CONCURRENCY }, async () => {
		while (jobs.length > 0) {
			const job = jobs.shift();
			if (job) {
				await job();
			}
		}
	});
	await Promise.all(workers);
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
