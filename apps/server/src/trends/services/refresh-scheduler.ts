import { refreshPolicies } from "../config/refresh-policies";
import { sourcePresets } from "../config/sources";
import { topicPresets } from "../config/topics";
import type { SourceId, TopicId } from "../types";
import { clearTrendsPageCache } from "./get-trends-page";
import { isTrendsSummaryConfigured } from "./get-trends-summary";
import { refreshSource } from "./refresh-source";
import { dispatchSummaryPrewarmJob } from "./summary-prewarm-jobs";
import type { TranslationLanguage } from "./translate-news-items";

const SCHEDULER_TICK_MS = 60_000;
const INITIAL_STAGGER_WINDOW_MS = 10 * 60_000;
const MAX_REFRESHES_PER_TICK = 4;
const MAX_SUMMARY_PREWARMS_PER_TICK = 1;
const ERROR_BACKOFF_MS = 5 * 60_000;
const SUMMARY_PREWARM_LANGUAGES: readonly TranslationLanguage[] = [
	"zh",
	"en",
	"zh-Hant",
	"ru",
];

interface ScheduledSource {
	intervalMs: number;
	nextRunAt: number;
	sourceId: SourceId;
}

interface SummaryPrewarmJob {
	key: string;
	lang: TranslationLanguage;
	topicId: TopicId;
}

interface SchedulerState {
	running: boolean;
	schedule: ScheduledSource[];
	summaryQueue: SummaryPrewarmJob[];
	summaryQueuedKeys: Set<string>;
	timer: ReturnType<typeof setInterval> & { unref?: () => void };
}

let state: SchedulerState | undefined;

function buildSchedule(now: number): ScheduledSource[] {
	const entries = Object.entries(sourcePresets) as [
		SourceId,
		(typeof sourcePresets)[keyof typeof sourcePresets],
	][];
	const staggerWindow = Math.min(
		INITIAL_STAGGER_WINDOW_MS,
		Math.max(SCHEDULER_TICK_MS, entries.length * 5000)
	);

	return entries.map(([sourceId, preset], index) => {
		const policy = refreshPolicies[preset.refresh];
		const offset = Math.floor(
			(index / Math.max(entries.length, 1)) * staggerWindow
		);
		return {
			intervalMs: policy.softTtlMs,
			nextRunAt: now + offset,
			sourceId,
		};
	});
}

function nextDelay(source: ScheduledSource, ok: boolean): number {
	if (ok) {
		return source.intervalMs;
	}
	return Math.min(source.intervalMs, ERROR_BACKOFF_MS);
}

function getTopicsForSource(sourceId: SourceId): TopicId[] {
	const topics: TopicId[] = [];
	const entries = Object.entries(topicPresets) as [
		TopicId,
		(typeof topicPresets)[keyof typeof topicPresets],
	][];

	for (const [topicId, topic] of entries) {
		if (
			topic.sections.some((section) => hasSource(section.sourceIds, sourceId))
		) {
			topics.push(topicId);
		}
	}
	return topics;
}

function hasSource(
	sourceIds: readonly SourceId[],
	sourceId: SourceId
): boolean {
	return sourceIds.includes(sourceId);
}

function enqueueSummaryPrewarm(
	current: SchedulerState,
	topicId: TopicId,
	lang: TranslationLanguage
): void {
	const key = `${topicId}:${lang}`;
	if (current.summaryQueuedKeys.has(key)) {
		return;
	}
	current.summaryQueuedKeys.add(key);
	current.summaryQueue.push({ key, topicId, lang });
}

function enqueueSummaryPrewarmsForSource(
	current: SchedulerState,
	sourceId: SourceId
): void {
	if (!isTrendsSummaryConfigured()) {
		return;
	}
	for (const topicId of getTopicsForSource(sourceId)) {
		for (const lang of SUMMARY_PREWARM_LANGUAGES) {
			enqueueSummaryPrewarm(current, topicId, lang);
		}
	}
}

async function processSummaryPrewarms(current: SchedulerState): Promise<void> {
	for (let i = 0; i < MAX_SUMMARY_PREWARMS_PER_TICK; i += 1) {
		const job = current.summaryQueue.shift();
		if (!job) {
			return;
		}
		current.summaryQueuedKeys.delete(job.key);
		try {
			await dispatchSummaryPrewarmJob({
				lang: job.lang,
				topicId: job.topicId,
			});
		} catch (error) {
			console.warn("[trends-refresh-scheduler] summary prewarm failed", error);
		}
	}
}

async function refreshDueSources(current: SchedulerState): Promise<void> {
	if (current.running) {
		return;
	}

	current.running = true;
	try {
		const now = Date.now();
		const due = current.schedule
			.filter((source) => source.nextRunAt <= now)
			.sort((a, b) => a.nextRunAt - b.nextRunAt)
			.slice(0, MAX_REFRESHES_PER_TICK);

		for (const source of due) {
			const outcome = await refreshSource(source.sourceId);
			const ok = outcome.kind === "ok" || outcome.kind === "skipped";
			source.nextRunAt = Date.now() + nextDelay(source, ok);

			if (outcome.kind === "ok" || outcome.kind === "error") {
				clearTrendsPageCache();
			}
			if (outcome.kind === "ok") {
				enqueueSummaryPrewarmsForSource(current, source.sourceId);
			}
		}
		await processSummaryPrewarms(current);
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
		schedule: buildSchedule(Date.now()),
		summaryQueue: [],
		summaryQueuedKeys: new Set(),
		timer: setInterval(() => {
			if (!state) {
				return;
			}
			refreshDueSources(state).catch((error) => {
				console.error("[trends-refresh-scheduler]", error);
			});
		}, SCHEDULER_TICK_MS),
	};
	state.timer.unref?.();

	console.log(
		`[trends-refresh-scheduler] enabled for ${state.schedule.length} sources`
	);
	return stopTrendsRefreshScheduler;
}

export function stopTrendsRefreshScheduler(): void {
	if (!state) {
		return;
	}
	clearInterval(state.timer);
	state = undefined;
}
