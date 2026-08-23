import { buttonVariants } from "@opentrends/ui/components/button";
import { cn } from "@opentrends/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	ArrowLeft,
	Boxes,
	BrainCircuit,
	Database,
	FileSearch,
	Filter,
	GitMerge,
	Languages,
	Network,
	RefreshCw,
	ServerCog,
	Sparkles,
	Tag,
} from "lucide-react";

import { loadSourcesStatus } from "@/components/trends/load-sources";
import {
	loadTrendEventDetail,
	loadTrendEvents,
	TrendEventsEmbeddingNotConfiguredError,
} from "@/components/trends/load-trends";
import type {
	EventDetailData,
	EventFeedData,
	EventFeedItem,
} from "@/components/trends/types";
import { type Locale, localePathParam, useLocale } from "@/lib/i18n";

import type { SourcesStatusResponse } from "./sources-types";

type FlowTone = "blue" | "green" | "orange" | "red" | "violet" | "slate";
type NodeStatus = "blocked" | "idle" | "ok" | "running" | "warning";

interface FlowCopy {
	back: string;
	description: string;
	details: string;
	empty: string;
	eyebrow: string;
	model: string;
	runtime: string;
	status: string;
	title: string;
	workflow: string;
}

interface WorkflowNode {
	activity: string;
	description: string;
	evidence: string;
	icon: LucideIcon;
	id: string;
	input: string;
	nextStep: string;
	output: string;
	progress: number;
	status: NodeStatus;
	task: string;
	title: string;
	tone: FlowTone;
}

interface EventWorkflowSnapshot {
	details: EventDetailData[];
	embeddingBlocked: boolean;
	events: EventFeedItem[];
	feed?: EventFeedData;
	feedError?: string;
	sources: SourcesStatusResponse;
}

interface EventStats {
	averageScore: number;
	averageSources: number;
	highScoreEvents: number;
	multiSourceEvents: number;
	multiTopicEvents: number;
	primaryTierSummary: string;
	recentEventTitle: string;
	translatedEvents: number;
	uniqueSourceCount: number;
}

interface WorkflowStats {
	contentDone: number;
	contentStatus: NodeStatus;
	detailItems: EventDetailData["sourceItems"];
	eligibleCount: number;
	embeddedDone: number;
	embeddingStatus: NodeStatus;
	hasDetails: boolean;
	publishStatus: NodeStatus;
	queueStatus: NodeStatus;
	sourceErrors: number;
	sourceLinks: number;
	sourceStatus: NodeStatus;
	topicLinks: number;
}

const EVENT_FEED_LIMIT = 60;
const SAMPLE_EVENT_DETAIL_LIMIT = 24;
const WORKFLOW_SKELETON_KEYS = [
	"workflow-skeleton-source",
	"workflow-skeleton-eligibility",
	"workflow-skeleton-content",
	"workflow-skeleton-embedding",
	"workflow-skeleton-queue",
	"workflow-skeleton-merge",
	"workflow-skeleton-publish",
	"workflow-skeleton-translation",
] as const;

const COPY: Record<"en" | "zh", FlowCopy> = {
	en: {
		back: "Back to events",
		description:
			"The events pipeline transforms source candidates into a unified event feed through enrichment, embedding, and semantic merging. Each node shows real-time status, inputs, and outputs.",
		details: "Sample event details",
		empty: "No event feed data is available yet.",
		eyebrow: "Events workflow",
		model: "Data model",
		runtime: "Runtime",
		status: "Status",
		title: "Events data pipeline",
		workflow: "Workflow",
	},
	zh: {
		back: "返回事件流",
		description:
			"Events 链路负责把原始候选内容经过补全、向量化和语义合并，最终发布为事件流。工作流视图展示了每个环节的职责、状态和实时数据吞吐。",
		details: "抽样事件",
		empty: "当前还没有可展示的 event feed 数据。",
		eyebrow: "Events workflow",
		model: "数据模型",
		runtime: "运行控制",
		status: "状态",
		title: "Events 数据处理管线",
		workflow: "Workflow",
	},
};

const DATA_NODES = [
	{
		id: "source-item",
		icon: Database,
		title: "source_item",
		fields: ["url", "title", "contentHash", "contentText", "generation"],
	},
	{
		id: "embedding",
		icon: BrainCircuit,
		title: "source_item_embedding",
		fields: ["source_id", "item_id", "text_hash", "embedding", "model"],
	},
	{
		id: "event",
		icon: Boxes,
		title: "trend_event",
		fields: ["event_id", "title", "summary", "score", "primary_item_id"],
	},
	{
		id: "event-topic",
		icon: Tag,
		title: "trend_event_topic",
		fields: ["event_id", "topic_id", "created_at"],
	},
	{
		id: "event-source",
		icon: Network,
		title: "trend_event_source_item",
		fields: ["event_id", "source_id", "item_id", "merge_confidence"],
	},
] as const;

async function loadEventWorkflowSnapshot(
	locale: Locale
): Promise<EventWorkflowSnapshot> {
	const sources = await loadSourcesStatus();
	let feed: EventFeedData | undefined;
	let feedError: string | undefined;
	let embeddingBlocked = false;
	try {
		feed = await loadTrendEvents(undefined, 0, EVENT_FEED_LIMIT, locale);
	} catch (error) {
		embeddingBlocked = error instanceof TrendEventsEmbeddingNotConfiguredError;
		feedError = error instanceof Error ? error.message : String(error);
	}
	const events = feed?.events ?? [];
	const detailResults = await Promise.allSettled(
		events
			.slice(0, SAMPLE_EVENT_DETAIL_LIMIT)
			.map((event) =>
				loadTrendEventDetail(event.eventId, event.topicId, locale)
			)
	);
	const details = detailResults
		.map((result) => (result.status === "fulfilled" ? result.value : null))
		.filter((detail): detail is EventDetailData => Boolean(detail));
	return {
		details,
		embeddingBlocked,
		events,
		feed,
		feedError,
		sources,
	};
}

function getCopy(locale: Locale): FlowCopy {
	return locale.startsWith("zh") ? COPY.zh : COPY.en;
}

function toneClassName(tone: FlowTone): string {
	const tones: Record<FlowTone, string> = {
		blue: "border-[var(--accent-blue)] bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]",
		green:
			"border-[var(--accent-green)] bg-[color-mix(in_srgb,var(--accent-green)_12%,transparent)] text-[var(--accent-green)]",
		orange:
			"border-[var(--accent-orange)] bg-[color-mix(in_srgb,var(--accent-orange)_12%,transparent)] text-[var(--accent-orange)]",
		red: "border-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_12%,transparent)] text-[var(--accent-red)]",
		slate:
			"border-[var(--border-default)] bg-[var(--surface-sidebar)] text-[var(--text-secondary)]",
		violet:
			"border-[#7c3aed] bg-[color-mix(in_srgb,#7c3aed_12%,transparent)] text-[#7c3aed]",
	};
	return tones[tone];
}

function statusTone(status: NodeStatus): FlowTone {
	if (status === "ok") {
		return "green";
	}
	if (status === "running") {
		return "blue";
	}
	if (status === "blocked") {
		return "red";
	}
	if (status === "warning") {
		return "orange";
	}
	return "slate";
}

function statusLabel(status: NodeStatus, locale: Locale): string {
	const isChinese = locale.startsWith("zh");
	const labels: Record<NodeStatus, { en: string; zh: string }> = {
		blocked: { en: "blocked", zh: "阻塞" },
		idle: { en: "idle", zh: "空闲" },
		ok: { en: "healthy", zh: "正常" },
		running: { en: "running", zh: "运行中" },
		warning: { en: "attention", zh: "需关注" },
	};
	return labels[status][isChinese ? "zh" : "en"];
}

function percent(done: number, total: number): number {
	return total > 0 ? Math.round((done / total) * 100) : 0;
}

function activityLabels(locale: Locale) {
	const isChinese = locale.startsWith("zh");
	return {
		activity: isChinese ? "正在发生" : "Now",
		evidence: isChinese ? "观察到" : "Observed",
		input: isChinese ? "输入" : "Input",
		nextStep: isChinese ? "下一步" : "Next",
		output: isChinese ? "产出" : "Output",
		task: isChinese ? "任务" : "Task",
	};
}

function detailCoverageStatus(
	hasDetails: boolean,
	done: number,
	total: number
): NodeStatus {
	if (!hasDetails) {
		return "idle";
	}
	return done === total ? "ok" : "warning";
}

function sourceRefreshStatus(
	errorCount: number,
	staleCount: number
): NodeStatus {
	if (errorCount > 0) {
		return "blocked";
	}
	if (staleCount > 0) {
		return "warning";
	}
	return "ok";
}

function publishNodeStatus(snapshot: EventWorkflowSnapshot): NodeStatus {
	if (snapshot.embeddingBlocked) {
		return "blocked";
	}
	return snapshot.feed ? "ok" : "warning";
}

function buildWorkflowStats(snapshot: EventWorkflowSnapshot): WorkflowStats {
	const sources = snapshot.sources.sources;
	const detailItems = snapshot.details.flatMap((detail) => detail.sourceItems);
	const contentDone = detailItems.filter(
		(item) =>
			item.contentStatus !== "pending" && item.contentStatus !== "missing"
	).length;
	const embeddedDone = detailItems.filter((item) => item.hasEmbedding).length;
	const sourceErrors = sources.filter((source) => source.status === "error");
	const staleSources = sources.filter(
		(source) => source.status === "stale" || source.status === "missing"
	);
	const hasDetails = detailItems.length > 0;
	const sourceLinks = snapshot.events.reduce(
		(total, event) => total + event.sourceCount,
		0
	);
	const topicLinks = snapshot.events.reduce(
		(total, event) => total + (event.topicIds?.length ?? 1),
		0
	);
	return {
		contentDone,
		contentStatus: detailCoverageStatus(
			hasDetails,
			contentDone,
			detailItems.length
		),
		detailItems,
		eligibleCount: sources.filter((source) => source.eventEligible).length,
		embeddedDone,
		embeddingStatus: snapshot.embeddingBlocked
			? "blocked"
			: detailCoverageStatus(hasDetails, embeddedDone, detailItems.length),
		hasDetails,
		publishStatus: publishNodeStatus(snapshot),
		queueStatus:
			snapshot.embeddingBlocked || snapshot.sources.totals.eventItems === 0
				? "idle"
				: "running",
		sourceErrors: sourceErrors.length,
		sourceLinks,
		sourceStatus: sourceRefreshStatus(sourceErrors.length, staleSources.length),
		topicLinks,
	};
}

function buildEventStats(snapshot: EventWorkflowSnapshot): EventStats {
	const events = snapshot.events;
	const sourceIds = new Set(
		events.flatMap((event) => event.sources.map((source) => source.sourceId))
	);
	const averageScore =
		events.length > 0
			? Math.round(
					(events.reduce((total, event) => total + event.score, 0) /
						events.length) *
						10
				) / 10
			: 0;
	const averageSources =
		events.length > 0
			? Math.round(
					(events.reduce((total, event) => total + event.sourceCount, 0) /
						events.length) *
						10
				) / 10
			: 0;
	const tiers = events.reduce<Record<string, number>>((accumulator, event) => {
		const tier = event.signals?.primarySourceTier ?? "unknown";
		accumulator[tier] = (accumulator[tier] ?? 0) + 1;
		return accumulator;
	}, {});
	const primaryTierSummary =
		Object.entries(tiers)
			.map(([tier, count]) => `${tier}:${count}`)
			.join(" / ") || "none";
	return {
		averageScore,
		averageSources,
		highScoreEvents: events.filter((event) => event.score >= 70).length,
		multiSourceEvents: events.filter((event) => event.sourceCount > 1).length,
		multiTopicEvents: events.filter(
			(event) => (event.topicIds?.length ?? 1) > 1
		).length,
		primaryTierSummary,
		recentEventTitle: events[0]?.title ?? "none",
		translatedEvents: events.filter((event) => event.original).length,
		uniqueSourceCount: sourceIds.size,
	};
}

function sampledText(
	hasDetails: boolean,
	value: string,
	fallback: string
): string {
	return hasDetails ? value : fallback;
}

function embeddingTask(snapshot: EventWorkflowSnapshot, stats: WorkflowStats) {
	if (snapshot.embeddingBlocked) {
		return "SILICONFLOW_API_KEY required";
	}
	return sampledText(
		stats.hasDetails,
		`${percent(stats.embeddedDone, stats.detailItems.length)}% sampled coverage`,
		"idle until candidate items exist"
	);
}

function newestEventTitle(snapshot: EventWorkflowSnapshot): string {
	return snapshot.events[0]?.title ?? "no loaded event yet";
}

function sourceIssueSummary(snapshot: EventWorkflowSnapshot): string {
	const source = snapshot.sources.sources.find(
		(item) => item.status === "error" || item.status === "stale"
	);
	if (!source) {
		return "all sampled sources are current";
	}
	return `${source.name}: ${source.lastError ?? source.status}`;
}

function sourceActivity(stats: WorkflowStats, isChinese: boolean): string {
	if (stats.sourceStatus === "blocked") {
		if (isChinese) {
			return "部分来源刷新失败，下游合并会缺少最新候选数据。";
		}
		return "Some source refreshes are failing and need attention.";
	}
	if (isChinese) {
		return "正在刷新来源快照，并统计可进入 events 的候选条目。";
	}
	return "Refreshing source snapshots and counting event-ready items.";
}

function sourceNextStep(stats: WorkflowStats, isChinese: boolean): string {
	if (stats.sourceErrors > 0) {
		if (isChinese) {
			return "先修复失败的 source adapter，避免影响后续事件合并质量。";
		}
		return "Fix errored source adapters before downstream merge quality drops.";
	}
	if (isChinese) {
		return "把当前 generation 的合格条目送入 eventEligible 过滤。";
	}
	return "Send eligible current-generation items to the event filter.";
}

function eligibilityActivity(stats: WorkflowStats, isChinese: boolean): string {
	if (stats.eligibleCount > 0) {
		if (isChinese) {
			return "正在筛选允许进入事件生成链路的 sources。";
		}
		return "Selecting the sources that are allowed to enter event generation.";
	}
	if (isChinese) {
		return "当前没有 source 被开启 eventEligible，事件生成会停在这里。";
	}
	return "No source is currently enabled for event generation.";
}

function eligibilityNextStep(stats: WorkflowStats, isChinese: boolean): string {
	if (stats.eligibleCount > 0) {
		if (isChinese) {
			return "把已选 sources 的条目送入正文补全。";
		}
		return "Pass selected items into content enrichment.";
	}
	if (isChinese) {
		return "至少给一个 source 开启 eventEligible。";
	}
	return "Enable eventEligible on at least one source.";
}

function contentActivity(stats: WorkflowStats, isChinese: boolean): string {
	if (stats.hasDetails) {
		if (isChinese) {
			return "正在检查 detail 诊断里的 links 是否已有可用于语义合并的正文。";
		}
		return "Checking whether detail-sample links already have usable article text.";
	}
	if (isChinese) {
		return "等待 event detail 加载后，才能抽样检查正文覆盖率。";
	}
	return "Waiting for loaded events before content coverage can be sampled.";
}

function contentNextStep(stats: WorkflowStats, isChinese: boolean): string {
	if (stats.contentStatus === "warning") {
		if (isChinese) {
			return "补抓或标记 detail 诊断中缺失正文的 links。";
		}
		return "Fetch or mark missing article bodies for incomplete detail-sample links.";
	}
	if (isChinese) {
		return "把 canonical text 交给 embedding 生成。";
	}
	return "Send canonical text to embedding generation.";
}

function embeddingActivity(
	snapshot: EventWorkflowSnapshot,
	isChinese: boolean
): string {
	if (snapshot.embeddingBlocked) {
		if (isChinese) {
			return "Embedding 被配置阻塞，暂时不能生成语义向量。";
		}
		return "Embedding generation is blocked by missing configuration.";
	}
	if (isChinese) {
		return "正在比对 detail 诊断里的 source items 是否已有可复用 embeddings。";
	}
	return "Comparing detail-sample source items against stored embeddings.";
}

function embeddingEvidence(
	snapshot: EventWorkflowSnapshot,
	stats: WorkflowStats,
	isChinese: boolean
): string {
	if (snapshot.embeddingBlocked) {
		return "SILICONFLOW_API_KEY is not configured";
	}
	return sampledText(
		stats.hasDetails,
		isChinese
			? `detail 诊断的 ${stats.detailItems.length} 条 links 中 ${stats.embeddedDone} 条已有 embedding`
			: `${stats.embeddedDone} of ${stats.detailItems.length} detail-sample links have embeddings`,
		isChinese
			? "还没有 detail 诊断 embedding"
			: "no detail-sample embeddings yet"
	);
}

function embeddingNextStep(
	snapshot: EventWorkflowSnapshot,
	isChinese: boolean
): string {
	if (snapshot.embeddingBlocked) {
		if (isChinese) {
			return "配置 embedding key 后，语义合并才能完整运行。";
		}
		return "Configure the embedding key before semantic merge can run fully.";
	}
	if (isChinese) {
		return "复用 textHash 命中的向量，或创建缺失的 source_item_embedding。";
	}
	return "Reuse textHash matches or create missing source_item_embedding rows.";
}

function queueActivity(stats: WorkflowStats, isChinese: boolean): string {
	if (stats.queueStatus === "running") {
		if (isChinese) {
			return "正在为候选 event items 派发 merge 任务。";
		}
		return "Dispatching merge work for candidate event items.";
	}
	if (isChinese) {
		return "队列空闲：没有候选条目，或 embedding 仍被阻塞。";
	}
	return "Queue is idle because there are no candidates or embeddings are blocked.";
}

function topicActivity(
	snapshot: EventWorkflowSnapshot,
	isChinese: boolean
): string {
	if (snapshot.events.length > 0) {
		if (isChinese) {
			return "正在把合格条目合并成 canonical events 和 topic links。";
		}
		return "Merging eligible items into canonical events and topic links.";
	}
	if (isChinese) {
		return "等待 merge 输出后，canonical events 才会出现在这里。";
	}
	return "Waiting for merge output before canonical events are visible.";
}

function topicNextStep(
	snapshot: EventWorkflowSnapshot,
	isChinese: boolean
): string {
	if (snapshot.events.length > 0) {
		if (isChinese) {
			return "带上 evidence 和 score signals 发布 canonical events。";
		}
		return "Publish canonical events with evidence and score signals.";
	}
	if (isChinese) {
		return "先完成队列处理，生成第一个 event cluster。";
	}
	return "Complete queue processing for the first event cluster.";
}

function publishActivity(
	snapshot: EventWorkflowSnapshot,
	isChinese: boolean
): string {
	if (snapshot.feed) {
		if (isChinese) {
			return "正在从 canonical event tables 对外服务当前事件流页面。";
		}
		return "Serving the current event feed page from canonical event tables.";
	}
	if (isChinese) {
		return "Feed 请求没有返回可用数据。";
	}
	return "Feed request did not return usable data.";
}

function publishEvidence(
	snapshot: EventWorkflowSnapshot,
	isChinese: boolean
): string {
	if (snapshot.feed) {
		if (isChinese) {
			return `当前页面已加载 ${snapshot.events.length} 个 events`;
		}
		return `${snapshot.events.length} events visible in the loaded page`;
	}
	return snapshot.feedError ?? "feed unavailable";
}

function publishNextStep(
	snapshot: EventWorkflowSnapshot,
	isChinese: boolean
): string {
	if (snapshot.feed?.nextOffset) {
		if (isChinese) {
			return "继续翻页检查更早的 events。";
		}
		return "Continue pagination to inspect older events.";
	}
	if (isChinese) {
		return "上游 workflow 变化后，保持第一页事件流同步更新。";
	}
	return "Keep first page current as upstream workflow changes.";
}

function translationActivity(
	snapshot: EventWorkflowSnapshot,
	isChinese: boolean
): string {
	if (snapshot.events.length > 0) {
		if (isChinese) {
			return "正在为当前 locale 补齐标题和摘要的本地化内容。";
		}
		return "Hydrating localized titles and summaries for the selected locale.";
	}
	if (isChinese) {
		return "Translation 等待 feed events 产生后再执行。";
	}
	return "Translation waits until feed events exist.";
}

function buildWorkflowNodes(
	snapshot: EventWorkflowSnapshot,
	locale: Locale
): WorkflowNode[] {
	const isChinese = locale.startsWith("zh");
	const sources = snapshot.sources.sources;
	const stats = buildWorkflowStats(snapshot);
	const newestEvent = newestEventTitle(snapshot);
	const sourceIssue = sourceIssueSummary(snapshot);
	return [
		{
			activity: sourceActivity(stats, isChinese),
			id: "source-refresh",
			icon: RefreshCw,
			title: "1. Source refresh",
			description:
				"Native/RSSHub/RSS adapters refresh snapshots and current-generation source_item rows.",
			evidence: sourceIssue,
			input: `${sources.length} configured sources`,
			nextStep: sourceNextStep(stats, isChinese),
			output: `${snapshot.sources.totals.eventItems} event candidate items`,
			progress: percent(snapshot.sources.totals.ok, sources.length),
			status: stats.sourceStatus,
			task: `${snapshot.sources.totals.ok}/${sources.length} healthy, ${stats.sourceErrors} error`,
			tone: "blue",
		},
		{
			activity: eligibilityActivity(stats, isChinese),
			id: "eligibility",
			icon: Filter,
			title: "2. Event eligibility",
			description:
				"Only sources explicitly marked eventEligible enter the event data pipeline.",
			evidence: `${stats.eligibleCount} sources are eventEligible`,
			input: `${sources.length} sources`,
			nextStep: eligibilityNextStep(stats, isChinese),
			output: `${stats.eligibleCount} eligible sources`,
			progress: percent(stats.eligibleCount, sources.length),
			status: stats.eligibleCount > 0 ? "ok" : "warning",
			task: `${stats.eligibleCount}/${sources.length} selected for events`,
			tone: "green",
		},
		{
			activity: contentActivity(stats, isChinese),
			id: "content-enrichment",
			icon: FileSearch,
			title: "3. Content enrichment",
			description:
				"Event source items get contentText/contentStatus before semantic merge.",
			evidence: sampledText(
				stats.hasDetails,
				isChinese
					? `detail 诊断的 ${stats.detailItems.length} 条 links 中 ${stats.contentDone} 条正文已就绪`
					: `${stats.contentDone} of ${stats.detailItems.length} detail-sample links are content-ready`,
				isChinese ? "还没有 detail 诊断数据" : "no detail diagnostics yet"
			),
			input: sampledText(
				stats.hasDetails,
				isChinese
					? `${stats.detailItems.length} 条 detail 诊断 links`
					: `${stats.detailItems.length} detail-sample links`,
				isChinese ? "等待 event details" : "waiting for event details"
			),
			nextStep: contentNextStep(stats, isChinese),
			output: sampledText(
				stats.hasDetails,
				`${stats.contentDone}/${stats.detailItems.length} content-ready`,
				isChinese ? "没有 detail 诊断 items" : "no detail-sample items"
			),
			progress: percent(stats.contentDone, stats.detailItems.length),
			status: stats.contentStatus,
			task: sampledText(
				stats.hasDetails,
				`${percent(stats.contentDone, stats.detailItems.length)}% sampled coverage`,
				"idle until events exist"
			),
			tone: "orange",
		},
		{
			activity: embeddingActivity(snapshot, isChinese),
			id: "embedding",
			icon: BrainCircuit,
			title: "4. Embedding",
			description:
				"SiliconFlow embeddings are generated from canonical text and reused by textHash.",
			evidence: embeddingEvidence(snapshot, stats, isChinese),
			input: sampledText(
				stats.hasDetails,
				isChinese
					? `${stats.detailItems.length} 条 detail 诊断 links`
					: `${stats.detailItems.length} detail-sample links`,
				"canonical article text"
			),
			nextStep: embeddingNextStep(snapshot, isChinese),
			output: sampledText(
				stats.hasDetails,
				`${stats.embeddedDone}/${stats.detailItems.length} embedded`,
				"source_item_embedding"
			),
			progress: percent(stats.embeddedDone, stats.detailItems.length),
			status: stats.embeddingStatus,
			task: embeddingTask(snapshot, stats),
			tone: "violet",
		},
		{
			activity: queueActivity(stats, isChinese),
			id: "event-merge-queue",
			icon: ServerCog,
			title: "5. event-merge queue",
			description:
				"Refresh dispatches EventMergeMessage; Cloudflare Queue retries failures and falls back to inline execution locally.",
			evidence: `${snapshot.sources.totals.eventItems} candidate items available for queueing`,
			input: `${snapshot.sources.totals.eventItems} candidate items`,
			nextStep: isChinese
				? "执行 enrichEventSourceItems，然后重建 topic event clusters。"
				: "Run enrichEventSourceItems, then rebuild topic event clusters.",
			output: "enrichEventSourceItems + rebuildTopicEvents",
			progress: stats.queueStatus === "running" ? 65 : 0,
			status: stats.queueStatus,
			task: "maxBatchSize 1, maxRetries 3, retryDelay 120s",
			tone: "blue",
		},
		{
			activity: topicActivity(snapshot, isChinese),
			id: "topic-rebuild",
			icon: GitMerge,
			title: "6. Topic rebuild + merge",
			description:
				"Each topic rebuild clusters eligible current items and upserts canonical events before cleaning orphan links.",
			evidence: isChinese
				? `已加载 ${snapshot.events.length} 个 events，最新：${newestEvent}`
				: `${snapshot.events.length} loaded events, latest: ${newestEvent}`,
			input: `${stats.eligibleCount} eligible sources across topics`,
			nextStep: topicNextStep(snapshot, isChinese),
			output: `${snapshot.events.length} events, ${stats.sourceLinks} source links`,
			progress: snapshot.events.length > 0 ? 100 : 0,
			status:
				snapshot.embeddingBlocked || snapshot.events.length === 0
					? "idle"
					: "ok",
			task: `${stats.topicLinks} topic links observed in loaded page`,
			tone: "green",
		},
		{
			activity: publishActivity(snapshot, isChinese),
			id: "publish",
			icon: Sparkles,
			title: "7. Feed publish",
			description:
				"/api/events returns canonical events, topicIds, source evidence, scoring, and pagination.",
			evidence: publishEvidence(snapshot, isChinese),
			input: "trend_event + link tables",
			nextStep: publishNextStep(snapshot, isChinese),
			output: snapshot.feed
				? `${snapshot.events.length} events loaded`
				: (snapshot.feedError ?? "feed unavailable"),
			progress: snapshot.feed ? 100 : 0,
			status: stats.publishStatus,
			task: snapshot.feed?.nextOffset
				? `nextOffset ${snapshot.feed.nextOffset}`
				: "first page loaded",
			tone: "slate",
		},
		{
			activity: translationActivity(snapshot, isChinese),
			id: "translation",
			icon: Languages,
			title: "8. Content translation",
			description:
				"Feed and detail endpoints use lang + translations=sync to hydrate translated title/summary/source text.",
			evidence: `${snapshot.events.filter((event) => event.original).length} loaded events include original text`,
			input: `${snapshot.events.length} feed events`,
			nextStep: "Use cached translations on subsequent feed/detail reads.",
			output: `${snapshot.events.filter((event) => event.original).length} translated/original pairs`,
			progress: snapshot.events.length > 0 ? 100 : 0,
			status: snapshot.events.length > 0 ? "ok" : "idle",
			task: "sync cache path in loadTrendEvents/loadTrendEventDetail",
			tone: "red",
		},
	];
}

export function EventFlowPage() {
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const copy = getCopy(locale);
	const isChinese = locale.startsWith("zh");
	const workflow = useQuery({
		queryKey: ["event-workflow", locale],
		queryFn: () => loadEventWorkflowSnapshot(locale),
		refetchInterval: 60_000,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});
	const snapshot = workflow.data;
	const nodes = snapshot ? buildWorkflowNodes(snapshot, locale) : [];
	const stats = snapshot ? buildWorkflowStats(snapshot) : null;
	const eventStats = snapshot ? buildEventStats(snapshot) : null;
	const blockedNodes = nodes.filter((node) => node.status === "blocked").length;
	const warningNodes = nodes.filter((node) => node.status === "warning").length;
	const runningNodes = nodes.filter((node) => node.status === "running").length;
	const eventCount = snapshot?.events.length ?? 0;
	const eligibleCount =
		snapshot?.sources.sources.filter((source) => source.eventEligible).length ??
		0;
	const itemCount = snapshot?.sources.totals.eventItems ?? 0;
	const sourceLinks = stats?.sourceLinks ?? 0;
	return (
		<div className="flex min-w-0 flex-1 flex-col bg-[var(--surface-app)] text-[var(--text-primary)]">
			<EventFlowHeader
				copy={copy}
				eligibleCount={eligibleCount}
				eventCount={eventCount}
				eventStats={eventStats}
				isChinese={isChinese}
				itemCount={itemCount}
				localeParam={localeParam}
				sourceLinks={sourceLinks}
			/>
			<div className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-5">
				<section className="flex h-fit flex-col rounded border border-[var(--border-default)] bg-[var(--surface-card)]">
					<div className="flex shrink-0 items-center justify-between gap-3 border-[var(--border-subtle)] border-b px-3 py-2">
						<div className="min-w-0">
							<h2 className="font-semibold text-[14px] text-[var(--text-heading)]">
								{copy.workflow}
							</h2>
							<p className="text-[11px] text-[var(--text-muted)]">
								{isChinese
									? "从左到右：候选 source_item 被筛选、补全、生成向量、合并并发布。"
									: "Left to right: candidate source_items are filtered, enriched, embedded, merged, and published."}
							</p>
						</div>
						{workflow.isFetching ? (
							<span className="shrink-0 text-[11px] text-[var(--text-muted)]">
								refreshing
							</span>
						) : null}
					</div>
					<div className="p-3">
						<WorkflowContentView
							error={workflow.error}
							isPending={workflow.isPending}
							locale={locale}
							nodes={nodes}
						/>
					</div>
				</section>
				<EventFlowSidebar
					blockedNodes={blockedNodes}
					copy={copy}
					eventCount={eventCount}
					eventStats={eventStats}
					isChinese={isChinese}
					locale={locale}
					runningNodes={runningNodes}
					snapshot={snapshot}
					warningNodes={warningNodes}
				/>
			</div>
		</div>
	);
}

function EventFlowHeader({
	copy,
	eligibleCount,
	eventCount,
	eventStats,
	isChinese,
	itemCount,
	localeParam,
	sourceLinks,
}: {
	copy: FlowCopy;
	eligibleCount: number;
	eventCount: number;
	eventStats: EventStats | null;
	isChinese: boolean;
	itemCount: number;
	localeParam: string | undefined;
	sourceLinks: number;
}) {
	return (
		<header className="sticky top-0 z-20 shrink-0 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)]">
			<div className="flex min-w-0 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-5">
				<div className="flex min-w-0 items-start gap-3">
					<Link
						className={cn(
							buttonVariants({ size: "icon-sm", variant: "outline" }),
							"mt-0.5 border-[var(--border-default)] bg-transparent text-[var(--text-secondary)] hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
						)}
						params={{ locale: localeParam }}
						title={copy.back}
						to="/{-$locale}/events"
					>
						<ArrowLeft className="size-3.5" />
					</Link>
					<div className="min-w-0">
						<div className="font-medium text-[10px] text-[var(--accent-blue)] uppercase tracking-[0.18em]">
							{copy.eyebrow}
						</div>
						<h1 className="truncate font-semibold text-[var(--text-heading)] text-xl leading-tight lg:text-2xl">
							{copy.title}
						</h1>
						<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--text-secondary)] leading-5">
							<p className="max-w-4xl">{copy.description}</p>
							{eventStats?.recentEventTitle && (
								<div className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 py-0.5 text-[11px] text-[var(--accent-blue)]">
									<Sparkles className="size-3" />
									<span className="max-w-[240px] truncate">
										{isChinese ? "最新：" : "Latest: "}
										{eventStats.recentEventTitle}
									</span>
								</div>
							)}
						</div>
					</div>
				</div>
				<div className="grid shrink-0 grid-cols-4 overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-card)] text-center lg:w-[640px]">
					<HeroStat label="Eligible sources" value={String(eligibleCount)} />
					<HeroStat label="Event items" value={String(itemCount)} />
					<HeroStat label="Source links" value={String(sourceLinks)} />
					<HeroStat label="Loaded events" value={String(eventCount)} />
				</div>
			</div>
		</header>
	);
}

function EventFlowSidebar({
	blockedNodes,
	copy,
	eventCount,
	eventStats,
	isChinese,
	locale,
	runningNodes,
	snapshot,
	warningNodes,
}: {
	blockedNodes: number;
	copy: FlowCopy;
	eventCount: number;
	eventStats: EventStats | null;
	isChinese: boolean;
	locale: Locale;
	runningNodes: number;
	snapshot: EventWorkflowSnapshot | undefined;
	warningNodes: number;
}) {
	return (
		<aside className="flex flex-col gap-4">
			<section className="rounded border border-[var(--border-default)] bg-[var(--surface-card)]">
				<div className="border-[var(--border-subtle)] border-b px-3 py-2">
					<h2 className="font-semibold text-[13px] text-[var(--text-heading)]">
						{copy.status}
					</h2>
				</div>
				<div className="grid grid-cols-4 gap-2 p-3 lg:grid-cols-2">
					<MetricTile
						label="blocked"
						tone={blockedNodes > 0 ? "red" : "slate"}
						value={String(blockedNodes)}
					/>
					<MetricTile
						label="warning"
						tone={warningNodes > 0 ? "orange" : "slate"}
						value={String(warningNodes)}
					/>
					<MetricTile
						label="running"
						tone={runningNodes > 0 ? "blue" : "slate"}
						value={String(runningNodes)}
					/>
					<MetricTile
						label={isChinese ? "多来源" : "multi-source"}
						tone="violet"
						value={
							eventStats ? `${eventStats.multiSourceEvents}/${eventCount}` : "-"
						}
					/>
				</div>
			</section>
			{eventStats ? (
				<EventStatsPanel
					eventCount={eventCount}
					locale={locale}
					stats={eventStats}
				/>
			) : null}
			<section className="rounded border border-[var(--border-default)] bg-[var(--surface-card)]">
				<div className="border-[var(--border-subtle)] border-b px-3 py-2">
					<h2 className="font-semibold text-[13px] text-[var(--text-heading)]">
						{copy.model}
					</h2>
				</div>
				<div className="grid gap-2 p-3">
					{DATA_NODES.map((node) => (
						<DataNode key={node.id} node={node} />
					))}
				</div>
				<div className="border-[var(--border-subtle)] border-t px-3 py-2">
					<h2 className="font-semibold text-[13px] text-[var(--text-heading)]">
						{copy.details}
					</h2>
				</div>
				<div className="divide-y divide-[var(--border-subtle)] text-[12px]">
					{snapshot?.details.slice(0, 5).map((detail) => (
						<DetailRow detail={detail} key={detail.eventId} />
					))}
					{snapshot && snapshot.details.length === 0 ? (
						<div className="px-3 py-3 text-[var(--text-muted)]">
							{snapshot.feedError ?? copy.empty}
						</div>
					) : null}
				</div>
			</section>
			<section className="rounded border border-[var(--border-default)] bg-[var(--surface-card)]">
				<div className="border-[var(--border-subtle)] border-b px-3 py-2">
					<h2 className="font-semibold text-[13px] text-[var(--text-heading)]">
						{copy.runtime}
					</h2>
				</div>
				<div className="grid gap-2 p-3 text-[12px] text-[var(--text-secondary)]">
					<ControlLine label="Scheduler" value="request-driven tick" />
					<ControlLine label="Queue" value="event-merge / Cloudflare" />
					<ControlLine label="Embedding" value="SILICONFLOW_API_KEY" />
					<ControlLine label="Merge rules" value="event-feed.ts" />
				</div>
			</section>
		</aside>
	);
}

function HeroStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 border-[var(--border-subtle)] border-r px-3 py-2 last:border-r-0">
			<div className="truncate text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">
				{label}
			</div>
			<div className="mt-1 truncate font-semibold text-[17px] text-[var(--text-heading)] tabular-nums">
				{value}
			</div>
		</div>
	);
}

function WorkflowContentView({
	error,
	isPending,
	locale,
	nodes,
}: {
	error: Error | null;
	isPending: boolean;
	locale: Locale;
	nodes: WorkflowNode[];
}) {
	if (error) {
		return (
			<div className="flex min-h-40 items-center rounded border border-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] p-4 text-[13px] text-[var(--accent-red)]">
				{error.message}
			</div>
		);
	}
	if (isPending) {
		return <WorkflowSkeleton />;
	}
	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{nodes.map((node) => (
					<WorkflowNodeCard key={node.id} locale={locale} node={node} />
				))}
			</div>
		</div>
	);
}

function WorkflowNodeCard({
	locale,
	node,
}: {
	locale: Locale;
	node: WorkflowNode;
}) {
	const Icon = node.icon;
	const tone = statusTone(node.status);
	const labels = activityLabels(locale);
	return (
		<article className="flex min-h-[312px] min-w-0 flex-col rounded border border-[var(--border-default)] bg-[var(--surface-sidebar)]">
			<div className="flex min-w-0 items-start gap-3 border-[var(--border-subtle)] border-b p-3">
				<span
					className={`inline-flex size-9 shrink-0 items-center justify-center rounded border ${toneClassName(node.tone)}`}
				>
					<Icon className="size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center justify-between gap-2">
						<h3 className="truncate font-semibold text-[13px] text-[var(--text-heading)]">
							{node.title}
						</h3>
						<StatusBadge locale={locale} status={node.status} tone={tone} />
					</div>
					<p className="mt-1 line-clamp-3 text-[12px] text-[var(--text-secondary)] leading-5">
						{node.description}
					</p>
				</div>
			</div>
			<div className="grid flex-1 content-start gap-2 p-3 text-[12px]">
				<div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-app)] p-2.5">
					<div className="flex items-center justify-between gap-2">
						<div className="font-medium text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">
							{labels.activity}
						</div>
						<div className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
							{node.progress}%
						</div>
					</div>
					<p className="mt-1 text-[12px] text-[var(--text-heading)] leading-5">
						{node.activity}
					</p>
					<div className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--border-subtle)]">
						<div
							className={`h-full rounded ${progressClassName(tone)}`}
							style={{ width: `${Math.min(100, Math.max(0, node.progress))}%` }}
						/>
					</div>
				</div>
				<NodeMeta label={labels.evidence} value={node.evidence} />
				<div className="grid grid-cols-2 gap-2">
					<NodeMeta label={labels.input} value={node.input} />
					<NodeMeta label={labels.output} value={node.output} />
				</div>
				<NodeMeta label={labels.task} value={node.task} />
				<NodeMeta label={labels.nextStep} value={node.nextStep} />
			</div>
		</article>
	);
}

function WorkflowSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
			{WORKFLOW_SKELETON_KEYS.map((key) => (
				<div
					className="min-h-[312px] animate-pulse rounded border border-[var(--border-default)] bg-[var(--surface-sidebar)]"
					key={key}
				/>
			))}
		</div>
	);
}

function progressClassName(tone: FlowTone): string {
	const tones: Record<FlowTone, string> = {
		blue: "bg-[var(--accent-blue)]",
		green: "bg-[var(--accent-green)]",
		orange: "bg-[var(--accent-orange)]",
		red: "bg-[var(--accent-red)]",
		slate: "bg-[var(--text-muted)]",
		violet: "bg-[#7c3aed]",
	};
	return tones[tone];
}

function StatusBadge({
	locale,
	status,
	tone,
}: {
	locale: Locale;
	status: NodeStatus;
	tone: FlowTone;
}) {
	return (
		<span
			className={`inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${toneClassName(tone)}`}
		>
			{statusLabel(status, locale)}
		</span>
	);
}

function NodeMeta({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-app)] px-2 py-1.5">
			<div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">
				{label}
			</div>
			<div className="mt-1 line-clamp-2 text-[11px] text-[var(--text-secondary)] leading-4">
				{value}
			</div>
		</div>
	);
}

function EventStatsPanel({
	eventCount,
	locale,
	stats,
}: {
	eventCount: number;
	locale: Locale;
	stats: EventStats;
}) {
	const isChinese = locale.startsWith("zh");
	return (
		<section className="rounded border border-[var(--border-default)] bg-[var(--surface-card)]">
			<div className="border-[var(--border-subtle)] border-b px-3 py-2">
				<h2 className="font-semibold text-[13px] text-[var(--text-heading)]">
					{isChinese ? "Events 统计" : "Event stats"}
				</h2>
			</div>
			<div className="grid grid-cols-2 gap-2 p-3">
				<MetricTile
					label={isChinese ? "平均分" : "avg score"}
					tone="green"
					value={String(stats.averageScore)}
				/>
				<MetricTile
					label={isChinese ? "平均来源" : "avg sources"}
					tone="blue"
					value={String(stats.averageSources)}
				/>
				<MetricTile
					label={isChinese ? "多来源" : "multi-source"}
					tone="violet"
					value={`${stats.multiSourceEvents}/${eventCount}`}
				/>
				<MetricTile
					label={isChinese ? "高分" : "high score"}
					tone="orange"
					value={String(stats.highScoreEvents)}
				/>
			</div>
			<div className="grid gap-2 border-[var(--border-subtle)] border-t p-3 text-[12px] text-[var(--text-secondary)]">
				<ControlLine
					label={isChinese ? "unique sources" : "unique sources"}
					value={String(stats.uniqueSourceCount)}
				/>
				<ControlLine
					label={isChinese ? "multi-topic" : "multi-topic"}
					value={String(stats.multiTopicEvents)}
				/>
				<ControlLine
					label={isChinese ? "translated" : "translated"}
					value={String(stats.translatedEvents)}
				/>
				<ControlLine
					label={isChinese ? "primary tier" : "primary tier"}
					value={stats.primaryTierSummary}
				/>
			</div>
		</section>
	);
}

function MetricTile({
	label,
	tone,
	value,
}: {
	label: string;
	tone: FlowTone;
	value: string;
}) {
	return (
		<div className={`rounded border px-2 py-2 ${toneClassName(tone)}`}>
			<div className="text-[10px] uppercase tracking-[0.12em]">{label}</div>
			<div className="mt-1 font-semibold text-[18px] tabular-nums leading-5">
				{value}
			</div>
		</div>
	);
}

function DataNode({ node }: { node: (typeof DATA_NODES)[number] }) {
	const Icon = node.icon;
	return (
		<article className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sidebar)] p-2.5">
			<div className="flex min-w-0 items-center gap-2">
				<Icon className="size-4 shrink-0 text-[var(--accent-blue)]" />
				<h3 className="truncate font-mono font-semibold text-[12px] text-[var(--text-heading)]">
					{node.title}
				</h3>
			</div>
			<div className="mt-2 flex flex-wrap gap-1">
				{node.fields.map((field) => (
					<span
						className="rounded border border-[var(--border-subtle)] bg-[var(--surface-app)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
						key={field}
					>
						{field}
					</span>
				))}
			</div>
		</article>
	);
}

function DetailRow({ detail }: { detail: EventDetailData }) {
	const processing = detail.processing;
	return (
		<div className="px-3 py-2.5">
			<div className="line-clamp-2 font-medium text-[var(--text-heading)] leading-5">
				{detail.title}
			</div>
			<div className="mt-1 grid grid-cols-3 gap-2 font-mono text-[11px] text-[var(--text-muted)]">
				<span>{processing.inputItemCount} input</span>
				<span>{processing.enrichedItemCount} text</span>
				<span>{processing.embeddedItemCount} vector</span>
			</div>
		</div>
	);
}

function ControlLine({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-3">
			<span className="min-w-0 truncate">{label}</span>
			<span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
				{value}
			</span>
		</div>
	);
}
