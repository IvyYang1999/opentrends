import { env } from "@opentrends/env/web";
import { useQueries } from "@tanstack/react-query";
import { Flame, Rss } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { toolButtonClassName } from "@/components/chrome-styles";
import Loader from "@/components/loader";
import { localePathParam, useLocale, useT } from "@/lib/i18n";

import { setDisplaySetting, useDisplaySettings } from "./display-settings";
import {
	coverRatio,
	Emphasized,
	GeneratedCover,
	useSourceHue,
} from "./feed-cover";
import {
	type FeedBlock,
	type FeedEntry,
	rankFeed,
	withListCards,
} from "./feed-model";
import { recordFeedClick } from "./feed-signals";
import { FOLLOWED_TOPIC_ID, useFollowedSources } from "./followed-sources";
import { formatRelativeTime } from "./relative-time";
import { SourceFavicon } from "./source-favicon";
import {
	type ManagedSource,
	SourceManagerDialog,
} from "./source-manager-dialog";
import { useSourcePreferences } from "./source-preferences";
import { orderWithPinned } from "./source-preferences-model";
import { trendsPageQueryOptions } from "./trends-query";
import { TrendsSummary } from "./trends-summary";
import type { SourceCardData, TrendsPageData } from "./types";
import { ViewSwitch } from "./view-switch";

const PAGE_SIZE = 40;
// The proxy scales covers down, never up, so a natural width this small
// means the source only offered a thumbnail.
const SMALL_COVER_WIDTH = 240;
const FEATURED_TOPIC_ID = "featured";
// The featured feed draws on every topic, like its digest does.
const ALL_TOPIC_IDS = [
	"featured",
	"ai",
	"embodied",
	"hardware",
	"biotech",
	"programming",
	"cn",
] as const;

function managedSources(
	page: TrendsPageData,
	preference: { orderedSourceIds: string[]; pinnedSourceIds: string[] }
): ManagedSource[] {
	const byId = new Map(
		page.sections
			.flatMap((section) => section.sources)
			.map((source) => [source.sourceId, source])
	);
	return orderWithPinned(
		preference.orderedSourceIds,
		preference.pinnedSourceIds
	)
		.map((id) => byId.get(id))
		.filter((source): source is SourceCardData => Boolean(source))
		.map((source) => ({
			homeUrl: source.homeUrl,
			id: source.sourceId,
			title: source.title,
		}));
}

function formatHeat(value: number): string {
	return new Intl.NumberFormat("en", {
		maximumFractionDigits: 1,
		notation: "compact",
	}).format(value);
}

function proxiedImageUrl(imageUrl: string): string {
	return `${env.VITE_SERVER_URL}/api/image?variant=card&url=${encodeURIComponent(imageUrl)}`;
}

interface FeedPageProps {
	topicId: string;
}

// Masonry of every item the topic's sources currently carry, ranked by
// freshness, heat and the reader's follows. Built from the same page data
// the source view uses, so it costs nothing extra to serve.
export function FeedPage({ topicId }: FeedPageProps) {
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const t = useT();
	const settings = useDisplaySettings();
	const { followedIds } = useFollowedSources();
	const topicIds =
		topicId === FEATURED_TOPIC_ID ? [...ALL_TOPIC_IDS] : [topicId];
	// useQueries' `combine` memoises on the query results, so `pages` only
	// changes when a page actually loads or refreshes.
	const { pages, pending } = useQueries({
		queries: topicIds.map((id) =>
			id === FOLLOWED_TOPIC_ID
				? {
						...trendsPageQueryOptions(id, locale, followedIds),
						enabled: followedIds.length > 0,
					}
				: trendsPageQueryOptions(id, locale)
		),
		combine: (results) => ({
			pages: results
				.map((result) => result.data)
				.filter((page): page is TrendsPageData => Boolean(page)),
			pending: results.some((result) => result.isPending && result.isEnabled),
		}),
	});
	const primary = pages.find((page) => page.id === topicId) ?? pages[0];
	// The topic's own source preferences: hidden sources stay out of the
	// feed, and the manage dialog edits the same list the source view uses.
	const primarySourceIds = useMemo(
		() =>
			primary
				? primary.sections.flatMap((section) =>
						section.sources.map((source) => source.sourceId)
					)
				: [],
		[primary]
	);
	const sourcePreferences = useSourcePreferences(topicId, primarySourceIds);
	const hiddenSourceIds = sourcePreferences.preference.hiddenSourceIds;
	const [sourceManagerOpen, setSourceManagerOpen] = useState(false);
	const blocks = useMemo(() => {
		const hidden = new Set(hiddenSourceIds);
		const visiblePages = pages.map((page) => ({
			...page,
			sections: page.sections.map((section) => ({
				...section,
				sources: section.sources.filter(
					(source) => !hidden.has(source.sourceId)
				),
			})),
		}));
		const rankings = visiblePages
			.flatMap((page) => page.sections)
			.flatMap((section) => section.sources)
			.filter(
				(source) => source.kind === "ranking" && source.items.length >= 5
			);
		return withListCards(rankFeed(visiblePages, followedIds), rankings);
	}, [pages, followedIds, hiddenSourceIds]);
	const [limit, setLimit] = useState(PAGE_SIZE);
	const sentinelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel) {
			return;
		}
		const observer = new IntersectionObserver((records) => {
			if (records.some((record) => record.isIntersecting)) {
				setLimit((value) => value + PAGE_SIZE);
			}
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, []);

	return (
		<div className="min-w-0 flex-1 overflow-auto bg-[var(--surface-app)] text-[var(--text-primary)]">
			{primary ? (
				<TrendsSummary
					collapsed={settings.summaryCollapsed}
					onCollapsedChange={(collapsed) =>
						setDisplaySetting("summaryCollapsed", collapsed)
					}
					page={primary}
					topicId={topicId}
				/>
			) : (
				<div className="h-10 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)]" />
			)}
			<div className="flex h-10 items-center justify-between gap-3 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 sm:px-4">
				<ViewSwitch localeParam={localeParam} topicId={topicId} view="feed" />
				<div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] tabular-nums">
					<span>{t("feed.count", { count: blocks.length })}</span>
					{primary ? (
						<button
							className={toolButtonClassName}
							onClick={() => setSourceManagerOpen(true)}
							type="button"
						>
							<Rss aria-hidden className="size-3.5" />
							<span>{t("sourceManager.button")}</span>
						</button>
					) : null}
				</div>
			</div>
			{sourceManagerOpen && primary ? (
				<SourceManagerDialog
					hiddenSourceIds={hiddenSourceIds}
					onOpenChange={setSourceManagerOpen}
					onOrderChange={sourcePreferences.setOrder}
					onShowAll={sourcePreferences.showAllSources}
					onTogglePinned={sourcePreferences.togglePinned}
					onVisibilityChange={sourcePreferences.setSourceVisible}
					open={sourceManagerOpen}
					pinnedSourceIds={sourcePreferences.preference.pinnedSourceIds}
					sources={managedSources(primary, sourcePreferences.preference)}
					t={t}
				/>
			) : null}
			{pending && blocks.length === 0 ? (
				<Loader />
			) : (
				<Masonry blocks={blocks.slice(0, limit)} t={t} />
			)}
			<div className="h-10" ref={sentinelRef} />
		</div>
	);
}

// CSS columns fill top to bottom, which puts the best items down the first
// column. Distributing entries round-robin keeps reading order left to right
// across the row, like a feed.
function useColumnCount(): number {
	const [count, setCount] = useState(4);
	useEffect(() => {
		const queries: [MediaQueryList, number][] = [
			[window.matchMedia("(min-width: 1536px)"), 6],
			[window.matchMedia("(min-width: 1280px)"), 5],
			[window.matchMedia("(min-width: 1024px)"), 4],
			[window.matchMedia("(min-width: 640px)"), 3],
		];
		const update = () =>
			setCount(queries.find(([query]) => query.matches)?.[1] ?? 2);
		update();
		for (const [query] of queries) {
			query.addEventListener("change", update);
		}
		return () => {
			for (const [query] of queries) {
				query.removeEventListener("change", update);
			}
		};
	}, []);
	return count;
}

function Masonry({
	blocks,
	t,
}: {
	blocks: FeedBlock[];
	t: ReturnType<typeof useT>;
}) {
	const columnCount = useColumnCount();
	const columns = Array.from({ length: columnCount }, (_, column) =>
		blocks.filter((_, index) => index % columnCount === column)
	);
	return (
		<div
			className="grid gap-3 p-3 sm:p-4"
			style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
		>
			{columns.map((column, index) => (
				<div className="flex min-w-0 flex-col gap-3" key={String(index)}>
					{column.map((block) =>
						block.kind === "list" ? (
							<ListCard
								key={`list:${block.source.sourceId}`}
								source={block.source}
								t={t}
							/>
						) : (
							<FeedCard entry={block} key={block.item.url} t={t} />
						)
					)}
				</div>
			))}
		</div>
	);
}

function FeedCard({
	entry,
	t,
}: {
	entry: FeedEntry;
	t: ReturnType<typeof useT>;
}) {
	const { item, source, heat } = entry;
	const heatLabel = heat === undefined ? undefined : formatHeat(heat);
	// A cover that fails to load falls back to the poster; one that turns out
	// to be a tiny thumbnail (it would only blur at card width) is set inside
	// the poster instead.
	const [cover, setCover] = useState<"pending" | "ok" | "failed" | "small">(
		"pending"
	);
	const hasCover =
		Boolean(item.imageUrl) && cover !== "failed" && cover !== "small";
	const original =
		item.original && item.original.title !== item.title
			? item.original.title
			: undefined;
	return (
		<a
			className="group block overflow-hidden border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] transition-[box-shadow,border-color,transform] duration-200 visited:text-[#9b9893] hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:visited:text-[#6f685f]"
			href={item.url}
			onClick={() => recordFeedClick(item, source)}
			rel="noopener noreferrer"
			target="_blank"
			title={original}
		>
			{hasCover ? (
				// The title sits on the picture over a scrim, where the eye already
				// is; a caption under the picture goes unread.
				<span className="relative block overflow-hidden">
					{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the load and error listeners only classify the cover */}
					<img
						alt=""
						className={`w-full bg-[var(--surface-sidebar)] object-cover transition-transform duration-300 group-hover:scale-[1.03] ${coverRatio(item)}`}
						height={240}
						loading="lazy"
						onError={() => setCover("failed")}
						onLoad={(event) =>
							setCover(
								event.currentTarget.naturalWidth < SMALL_COVER_WIDTH
									? "small"
									: "ok"
							)
						}
						src={proxiedImageUrl(item.imageUrl as string)}
						width={320}
					/>
					<span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-sm bg-black/35 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-sm">
						<SourceFavicon homeUrl={source.homeUrl} />
						<span className="max-w-[9rem] truncate">{source.title}</span>
					</span>
					<span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-3 pt-10 pb-3">
						<span className="line-clamp-3 font-semibold text-[14px] text-white leading-snug tracking-tight [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
							<Emphasized text={item.title} />
						</span>
					</span>
				</span>
			) : (
				<GeneratedCover
					heat={heatLabel}
					item={item}
					source={source}
					thumbnail={
						cover === "small" && item.imageUrl
							? proxiedImageUrl(item.imageUrl)
							: undefined
					}
				/>
			)}
			<span className="flex flex-col gap-1.5 px-3 py-2">
				<span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					<SourceFavicon homeUrl={source.homeUrl} />
					<span className="min-w-0 flex-1 truncate">{source.title}</span>
					{heatLabel && hasCover ? (
						<span className="inline-flex items-center gap-0.5 text-[var(--accent-orange)] tabular-nums">
							<Flame aria-hidden className="size-3" />
							{heatLabel}
						</span>
					) : null}
					{item.publishedAt ? (
						<span className="shrink-0" suppressHydrationWarning>
							{formatRelativeTime(item.publishedAt, t)}
						</span>
					) : null}
				</span>
			</span>
		</a>
	);
}

const LIST_PREVIEW = 5;

// A whole ranking as one card: the top five, expandable to the full list,
// each row a link. Gives the stream a second rhythm besides single stories.
function ListCard({
	source,
	t,
}: {
	source: SourceCardData;
	t: ReturnType<typeof useT>;
}) {
	const hue = useSourceHue(source);
	const [expanded, setExpanded] = useState(false);
	const items = expanded ? source.items : source.items.slice(0, LIST_PREVIEW);
	return (
		<div className="overflow-hidden border border-[var(--border-default)] bg-[var(--surface-card)]">
			<div
				className="flex items-center gap-2 px-3 py-2"
				style={{
					backgroundColor: `hsl(${hue} 70% 94%)`,
					color: `hsl(${hue} 45% 22%)`,
				}}
			>
				<SourceFavicon homeUrl={source.homeUrl} />
				<span className="min-w-0 flex-1 truncate font-semibold text-[13px]">
					{source.title}
				</span>
				<span className="rounded bg-white/60 px-1.5 py-px font-medium text-[10px] leading-4">
					{t("card.hotList")}
				</span>
			</div>
			<ol className="divide-y divide-[var(--border-subtle)]">
				{items.map((item, index) => (
					<li key={item.id}>
						<a
							className="flex items-start gap-2 px-3 py-2 text-[12px] text-[var(--text-primary)] transition-colors visited:text-[#9b9893] hover:bg-[var(--state-hover-subtle)] dark:visited:text-[#6f685f]"
							href={item.url}
							onClick={() => recordFeedClick(item, source)}
							rel="noopener noreferrer"
							target="_blank"
							title={item.original?.title}
						>
							<span className="w-4 shrink-0 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
								{index + 1}
							</span>
							<span className="line-clamp-2 min-w-0 flex-1 leading-[1.45]">
								{item.title}
							</span>
						</a>
					</li>
				))}
			</ol>
			{source.items.length > LIST_PREVIEW ? (
				<button
					className="flex w-full items-center justify-center border-[var(--border-default)] border-t py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
					onClick={() => setExpanded((value) => !value)}
					type="button"
				>
					{expanded
						? t("card.collapse")
						: t("card.viewAll", { count: source.items.length })}
				</button>
			) : null}
		</div>
	);
}
