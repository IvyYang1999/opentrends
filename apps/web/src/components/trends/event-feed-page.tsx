import { env } from "@opentrends/env/web";
import { Button } from "@opentrends/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@opentrends/ui/components/dialog";
import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, notFound } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowUpRight,
	CheckCircle2,
	ExternalLink,
	GitBranch,
	Layers,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";

import { localePathParam, type Translator, useLocale, useT } from "@/lib/i18n";

import {
	loadTrendEvents,
	TrendEventsEmbeddingNotConfiguredError,
	TrendsTopicNotFoundError,
} from "./load-trends";
import { formatRelativeTime } from "./relative-time";
import { SourceLogoStack } from "./source-favicon";
import { trendEventDetailQueryOptions } from "./trends-query";
import type { EventDetailData, EventFeedItem } from "./types";

interface EventFeedPageProps {
	selectedTopic?: string;
}

const TOPIC_IDS = [
	"ai",
	"embodied",
	"hardware",
	"biotech",
	"programming",
	"cn",
] as const;

const EVENT_SKELETON_KEYS = [
	"event-skeleton-1",
	"event-skeleton-2",
	"event-skeleton-3",
	"event-skeleton-4",
	"event-skeleton-5",
	"event-skeleton-6",
	"event-skeleton-7",
	"event-skeleton-8",
	"event-skeleton-9",
] as const;

const EVENT_PAGE_SIZE = 30;
const EVENT_MASONRY_GAP = 12;

function proxiedImageUrl(imageUrl: string): string {
	return `${env.VITE_SERVER_URL}/api/image?url=${encodeURIComponent(imageUrl)}`;
}

function subscribeViewportResize(callback: () => void): () => void {
	globalThis.addEventListener?.("resize", callback);
	return () => globalThis.removeEventListener?.("resize", callback);
}

function getViewportWidth(): number {
	return typeof globalThis.innerWidth === "number"
		? globalThis.innerWidth
		: 1440;
}

function getServerViewportWidth(): number {
	return 1440;
}

function useEventLaneCount(): number {
	const width = useSyncExternalStore(
		subscribeViewportResize,
		getViewportWidth,
		getServerViewportWidth
	);
	if (width >= 1536) {
		return 5;
	}
	if (width >= 1280) {
		return 4;
	}
	if (width >= 1024) {
		return 3;
	}
	if (width >= 768) {
		return 2;
	}
	return 1;
}

function dateMs(value: string): number {
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : Date.now();
}

function estimateEventCardSize(event: EventFeedItem | undefined): number {
	if (!event) {
		return 80;
	}
	const titleLines = Math.ceil(event.title.length / 42);
	const summaryLines = Math.ceil((event.summary?.length ?? 0) / 56);
	return (
		116 +
		(event.imageUrl ? 220 : 0) +
		Math.min(titleLines, 4) * 20 +
		Math.min(summaryLines, 5) * 18 +
		(event.selectionReason ? 28 : 0)
	);
}

export function EventFeedPage({ selectedTopic }: EventFeedPageProps) {
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const t = useT();
	const flowLabel = locale.startsWith("zh") ? "处理流" : "Flow";
	const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const lanes = useEventLaneCount();
	const eventsQuery = useInfiniteQuery({
		queryKey: ["trend-events", selectedTopic ?? "all", EVENT_PAGE_SIZE],
		queryFn: ({ pageParam }) =>
			loadTrendEvents(selectedTopic, pageParam, EVENT_PAGE_SIZE, locale),
		getNextPageParam: (lastPage) => lastPage.nextOffset,
		gcTime: 30 * 60_000,
		initialPageParam: 0,
		refetchOnWindowFocus: false,
		staleTime: 10 * 60_000,
	});
	const events = useMemo(() => {
		const uniqueEvents = new Map<string, EventFeedItem>();
		for (const event of eventsQuery.data?.pages.flatMap(
			(page) => page.events
		) ?? []) {
			uniqueEvents.set(event.eventId, event);
		}
		return [...uniqueEvents.values()];
	}, [eventsQuery.data]);
	const selectedEvent = events.find(
		(event) => event.eventId === selectedEventId
	);
	const virtualizer = useVirtualizer({
		count: events.length,
		estimateSize: (index) => estimateEventCardSize(events[index]),
		gap: EVENT_MASONRY_GAP,
		getItemKey: (index) => events[index]?.eventId ?? `events-loader-${index}`,
		getScrollElement: () => scrollRef.current,
		laneAssignmentMode: "measured",
		lanes,
		overscan: lanes * 4,
	});

	if (eventsQuery.error instanceof TrendsTopicNotFoundError) {
		throw notFound();
	}
	if (
		eventsQuery.error &&
		!(eventsQuery.error instanceof TrendEventsEmbeddingNotConfiguredError)
	) {
		throw eventsQuery.error;
	}
	let eventContent: ReactNode;
	if (eventsQuery.error instanceof TrendEventsEmbeddingNotConfiguredError) {
		eventContent = (
			<div className="flex min-h-[260px] items-center justify-center rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-6 text-center text-[13px] text-[var(--text-secondary)]">
				{t("events.embeddingRequired")}
			</div>
		);
	} else if (eventsQuery.isPending && events.length === 0) {
		eventContent = (
			<div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
				{EVENT_SKELETON_KEYS.map((key) => (
					<div
						className="h-44 animate-pulse rounded border border-[var(--border-default)] bg-[var(--surface-card)]"
						key={key}
					/>
				))}
			</div>
		);
	} else if (events.length === 0) {
		eventContent = (
			<div className="flex min-h-[260px] items-center justify-center rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-6 text-center text-[13px] text-[var(--text-secondary)]">
				{t("events.empty")}
			</div>
		);
	} else {
		eventContent = (
			<div className="flex flex-col gap-3">
				<VirtualEventMasonry
					events={events}
					lanes={lanes}
					onOpen={setSelectedEventId}
					t={t}
					virtualizer={virtualizer}
				/>
				<EventLoadMoreFooter
					hasNextPage={eventsQuery.hasNextPage}
					isFetchingNextPage={eventsQuery.isFetchingNextPage}
					onLoadMore={() => {
						eventsQuery.fetchNextPage().catch(() => undefined);
					}}
					t={t}
				/>
			</div>
		);
	}

	return (
		<div
			className="min-w-0 flex-1 overflow-auto bg-[var(--surface-app)] text-[var(--text-primary)]"
			ref={scrollRef}
		>
			<div className="border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2 sm:px-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex shrink-0 items-center gap-2">
						<Link
							className="inline-flex h-7 items-center gap-1.5 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
							params={{ locale: localeParam }}
							to="/{-$locale}/events/flow"
						>
							<GitBranch className="size-3.5" />
							{flowLabel}
						</Link>
						<span className="text-[11px] text-[var(--text-muted)]">
							{t("events.count", { count: events.length })}
						</span>
					</div>
				</div>
				<div className="mt-2 flex gap-1 overflow-x-auto pb-0.5 text-[12px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					<Link
						className={topicFilterClassName(!selectedTopic)}
						params={{ locale: localeParam }}
						search={{}}
						to="/{-$locale}/events"
					>
						{t("events.all")}
					</Link>
					{TOPIC_IDS.map((topicId) => (
						<Link
							className={topicFilterClassName(selectedTopic === topicId)}
							key={topicId}
							params={{ locale: localeParam }}
							search={{ topic: topicId }}
							to="/{-$locale}/events"
						>
							{getTopicLabel(topicId, t)}
						</Link>
					))}
				</div>
			</div>
			<div className="p-3 sm:p-4">{eventContent}</div>
			<EventDetailDialog
				event={selectedEvent}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedEventId(null);
					}
				}}
				open={Boolean(selectedEventId)}
				topicId={selectedEvent?.topicId}
			/>
		</div>
	);
}

function topicFilterClassName(active: boolean): string {
	const base =
		"shrink-0 rounded border px-2 py-1 transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]";
	return active
		? `${base} border-[var(--accent-blue)] bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]`
		: `${base} border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)]`;
}

function getTopicLabel(topicId: string, t: Translator): string {
	const known = TOPIC_IDS.find((id) => id === topicId);
	return known ? t(`topic.${known}`) : topicId;
}

function getSelectionReasonLabel(
	reason: EventFeedItem["selectionReason"],
	t: Translator
): string {
	if (reason === "official_source") {
		return t("events.reasonOfficial");
	}
	if (reason === "multiple_sources") {
		return t("events.reasonMultipleSources");
	}
	if (reason === "high_score") {
		return t("events.reasonHighScore");
	}
	if (reason === "strong_source") {
		return t("events.reasonStrongSource");
	}
	return t("events.reasonSelected");
}

function VirtualEventMasonry({
	events,
	lanes,
	onOpen,
	t,
	virtualizer,
}: {
	events: EventFeedItem[];
	lanes: number;
	onOpen: (eventId: string) => void;
	t: Translator;
	virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
}) {
	return (
		<div
			className="relative w-full"
			style={{ height: `${virtualizer.getTotalSize()}px` }}
		>
			{virtualizer.getVirtualItems().map((virtualItem) => {
				const event = events[virtualItem.index];
				return (
					<div
						className="absolute top-0 box-border px-1.5"
						data-index={virtualItem.index}
						key={virtualItem.key}
						ref={virtualizer.measureElement}
						style={{
							left: `${(virtualItem.lane / lanes) * 100}%`,
							transform: `translateY(${virtualItem.start}px)`,
							width: `${100 / lanes}%`,
						}}
					>
						<EventCard
							event={event}
							onOpen={() => onOpen(event.eventId)}
							t={t}
							topicLabels={(event.topicIds ?? [event.topicId]).map((topicId) =>
								getTopicLabel(topicId, t)
							)}
						/>
					</div>
				);
			})}
		</div>
	);
}

function EventLoadMoreFooter({
	hasNextPage,
	isFetchingNextPage,
	onLoadMore,
	t,
}: {
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	onLoadMore: () => void;
	t: Translator;
}) {
	return (
		<div className="flex justify-center py-2">
			{hasNextPage ? (
				<Button
					className="min-w-36"
					disabled={isFetchingNextPage}
					onClick={onLoadMore}
					type="button"
					variant="outline"
				>
					{isFetchingNextPage ? t("events.loadingMore") : t("events.loadMore")}
				</Button>
			) : (
				<div className="rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-center text-[12px] text-[var(--text-muted)]">
					{t("events.end")}
				</div>
			)}
		</div>
	);
}

function EventCard({
	event,
	onOpen,
	t,
	topicLabels,
}: {
	event: EventFeedItem;
	onOpen: () => void;
	t: Translator;
	topicLabels: string[];
}) {
	return (
		<article className="w-full overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-card)]">
			{event.imageUrl ? (
				<img
					alt=""
					className="aspect-[16/9] w-full border-[var(--border-subtle)] border-b bg-[var(--surface-sidebar)] object-cover"
					height={360}
					loading="lazy"
					referrerPolicy="no-referrer"
					src={proxiedImageUrl(event.imageUrl)}
					width={640}
				/>
			) : null}
			<button
				className="group flex w-full flex-col items-start gap-3 p-3 text-left transition-colors hover:bg-[var(--state-hover-subtle)]"
				onClick={onOpen}
				type="button"
			>
				<span className="flex w-full min-w-0 items-start justify-between gap-3">
					<span className="line-clamp-4 min-w-0 flex-1 font-semibold text-[15px] text-[var(--text-heading)] leading-[1.35] group-hover:text-[var(--accent-blue)]">
						{event.title}
					</span>
					<ArrowUpRight className="mt-1 size-3.5 shrink-0 text-[var(--text-muted)]" />
				</span>
				{event.summary ? (
					<span className="line-clamp-5 text-[12px] text-[var(--text-secondary)] leading-[1.5]">
						{event.summary}
					</span>
				) : null}
				{event.selectionReason ? (
					<EventReasonBadge reason={event.selectionReason} t={t} />
				) : null}
				<span className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
					{topicLabels.map((topicLabel) => (
						<span
							className="rounded border border-[var(--border-default)] bg-[var(--surface-sidebar)] px-1.5 py-0.5 text-[var(--text-secondary)]"
							key={topicLabel}
						>
							{topicLabel}
						</span>
					))}
					<span className="inline-flex items-center gap-1">
						{event.sources.length > 0 ? (
							<SourceLogoStack
								limit={5}
								showRemaining={false}
								size="sm"
								sources={event.sources.map((source) => ({
									homeUrl: source.homeUrl,
									id: source.sourceId,
									label: source.title,
								}))}
							/>
						) : (
							<Layers className="size-3" />
						)}
						{t("events.sources", { count: event.sourceCount })}
					</span>
					<span suppressHydrationWarning>
						{formatRelativeTime(dateMs(event.firstSeenAt), t)}
					</span>
					<span className="tabular-nums">
						{t("events.score", { score: event.score })}
					</span>
				</span>
			</button>
			{event.primarySource ? (
				<a
					className="flex min-w-0 items-center gap-2 border-[var(--border-subtle)] border-t px-3 py-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--accent-blue)]"
					href={event.primarySource.url}
					rel="noopener noreferrer"
					target="_blank"
				>
					<ExternalLink className="size-3 shrink-0" />
					<span className="truncate">{event.primarySource.title}</span>
				</a>
			) : null}
		</article>
	);
}

function EventReasonBadge({
	reason,
	t,
}: {
	reason: EventFeedItem["selectionReason"];
	t: Translator;
}) {
	if (!reason) {
		return null;
	}
	return (
		<span className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--accent-blue)] bg-[var(--accent-blue-bg)] px-2 py-1 text-[11px] text-[var(--accent-blue)]">
			<CheckCircle2 className="size-3 shrink-0" />
			<span className="truncate">{getSelectionReasonLabel(reason, t)}</span>
		</span>
	);
}

function EventDetailDialog({
	event,
	open,
	onOpenChange,
	topicId,
}: {
	event: EventFeedItem | undefined;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	topicId: string | undefined;
}) {
	const t = useT();
	const locale = useLocale();
	const detailQuery = useQuery({
		...trendEventDetailQueryOptions(event?.eventId ?? "", topicId, locale),
		enabled: open && Boolean(event && topicId),
	});
	const detail = detailQuery.data;
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{event?.title ?? t("events.heading")}</DialogTitle>
				</DialogHeader>
				<ScrollArea className="min-h-0 flex-1 overflow-hidden">
					<div className="flex flex-col gap-3 p-1">
						{event?.summary ? (
							<p className="text-[13px] text-[var(--text-secondary)] leading-[1.5]">
								{event.summary}
							</p>
						) : null}
						{detail ? <EventProcessingPanel detail={detail} /> : null}
						<ul className="flex flex-col divide-y divide-[var(--border-subtle)] rounded border border-[var(--border-default)]">
							{(detail?.sourceItems ?? []).map((item) => (
								<li key={`${item.sourceId}:${item.itemId}`}>
									<a
										className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--state-hover-subtle)]"
										href={item.url}
										rel="noopener noreferrer"
										target="_blank"
									>
										{item.imageUrl ? (
											<img
												alt=""
												className="mt-0.5 size-12 shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-sidebar)] object-cover"
												height={48}
												loading="lazy"
												referrerPolicy="no-referrer"
												src={proxiedImageUrl(item.imageUrl)}
												width={48}
											/>
										) : null}
										<span className="min-w-0 flex-1">
											<span className="line-clamp-2 font-medium text-[13px] text-[var(--text-primary)] leading-[1.45] group-hover:text-[var(--accent-blue)]">
												{item.title}
											</span>
											<span className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
												<span>{item.sourceId}</span>
												<span>
													{t("events.match", {
														confidence: item.mergeConfidence,
													})}
												</span>
												<span>
													{t("events.contentStatus", {
														status: item.contentStatus,
													})}
												</span>
												<span>
													{item.hasEmbedding
														? t("events.embedded")
														: t("events.notEmbedded")}
												</span>
												{item.isPrimary ? (
													<span>{t("events.primary")}</span>
												) : null}
											</span>
										</span>
										<ArrowUpRight className="mt-1 size-3 shrink-0 text-[var(--text-muted)]" />
									</a>
								</li>
							))}
						</ul>
						{detailQuery.isPending ? (
							<div className="h-24 animate-pulse rounded border border-[var(--border-default)] bg-[var(--surface-sidebar)]" />
						) : null}
						{detailQuery.error ? (
							<p className="text-[12px] text-[var(--accent-red)]">
								{t("events.detailLoadError")}
							</p>
						) : null}
						<Button onClick={() => onOpenChange(false)} size="sm" type="button">
							{t("events.close")}
						</Button>
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}

function EventProcessingPanel({ detail }: { detail: EventDetailData }) {
	const t = useT();
	const processing = detail.processing;
	const steps = [
		{
			detail: t("events.stepSnapshotsDetail", {
				items: processing.inputItemCount,
				sources: processing.scoreInputs.uniqueSourceCount,
			}),
			label: t("events.stepSnapshots"),
			status: "done",
		},
		{
			detail: t("events.stepContentDetail", {
				done: processing.enrichedItemCount,
				total: processing.inputItemCount,
			}),
			label: t("events.stepContent"),
			status: processing.enrichedItemCount > 0 ? "done" : "pending",
		},
		{
			detail: t("events.stepEmbeddingsDetail", {
				done: processing.embeddedItemCount,
				model: processing.embeddingModel,
				total: processing.inputItemCount,
			}),
			label: t("events.stepEmbeddings"),
			status: processing.embeddedItemCount > 0 ? "done" : "pending",
		},
		{
			detail: t("events.stepMergeDetail", {
				hours: processing.mergeRules.timeWindowHours,
				threshold: processing.mergeRules.similarityThreshold,
			}),
			label: t("events.stepMerge"),
			status: "done",
		},
		{
			detail: t("events.stepScoreDetail", {
				itemScore: processing.scoreInputs.itemScore,
				score: detail.score,
				sourceScore: processing.scoreInputs.sourceScore,
			}),
			label: t("events.stepScore"),
			status: "done",
		},
	] as const;
	return (
		<section className="rounded border border-[var(--border-default)] bg-[var(--surface-sidebar)]">
			<div className="border-[var(--border-subtle)] border-b px-3 py-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="font-semibold text-[13px] text-[var(--text-heading)]">
						{t("events.processing")}
					</h3>
					<span className="text-[11px] text-[var(--text-muted)]">
						{processing.inputItemCount} items · {processing.embeddingModel}
					</span>
				</div>
				<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
					<span>
						{t("events.lookback", { hours: processing.lookbackHours })}
					</span>
					<span>
						{t("events.mergeWindow", {
							hours: processing.mergeRules.timeWindowHours,
						})}
					</span>
					<span>
						{t("events.similarityThreshold", {
							percent: Math.round(
								processing.mergeRules.similarityThreshold * 100
							),
						})}
					</span>
					<span>
						{t("events.scoreInputs", {
							itemScore: processing.scoreInputs.itemScore,
							sources: processing.scoreInputs.uniqueSourceCount,
						})}
					</span>
				</div>
			</div>
			<ol className="divide-y divide-[var(--border-subtle)]">
				{steps.map((step) => (
					<li className="flex gap-2 px-3 py-2" key={step.label}>
						<CheckCircle2
							className={
								step.status === "done"
									? "mt-0.5 size-3.5 shrink-0 text-[var(--accent-green)]"
									: "mt-0.5 size-3.5 shrink-0 text-[var(--text-muted)]"
							}
						/>
						<span className="min-w-0">
							<span className="block font-medium text-[12px] text-[var(--text-primary)]">
								{step.label}
							</span>
							<span className="block text-[11px] text-[var(--text-secondary)] leading-[1.45]">
								{step.detail}
							</span>
						</span>
					</li>
				))}
			</ol>
		</section>
	);
}
