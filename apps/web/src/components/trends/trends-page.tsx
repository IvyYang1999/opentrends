import { env } from "@opentrends/env/web";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@opentrends/ui/components/dropdown-menu";
import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import {
	Tooltip,
	TooltipPopup,
	TooltipPortal,
	TooltipPositioner,
	TooltipTrigger,
} from "@opentrends/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowUpRight,
	ChevronUp,
	CircleAlert,
	CircleDashed,
	ExternalLink,
	EyeOff,
	Flame,
	GripVertical,
	Languages,
	LoaderCircle,
	MoreHorizontal,
	Pin,
	PinOff,
	Rss,
	Star,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toolButtonClassName } from "@/components/chrome-styles";
import {
	type Locale,
	localePathParam,
	type Translator,
	useLocale,
	useT,
} from "@/lib/i18n";
import { CoverImage } from "./cover-image";
import {
	type DisplaySettings,
	type DisplaySettingsStoreOptions,
	setDisplaySetting,
	useDisplaySettings,
} from "./display-settings";
import { DisplaySettingsMenuContent } from "./display-settings-menu";
import {
	FOLLOWED_TOPIC_ID,
	FollowedSourcesContext,
	useFollowedSources,
	useFollowedSourcesContext,
} from "./followed-sources";
import { formatRelativeTime } from "./relative-time";

import { revealSourceCard, sourceCardElementId } from "./reveal-source-card";
import {
	coverKind,
	SOURCE_CARD_GRID_CLASSES,
	shouldShowCollapsedSourceCardFooter,
	sourceCardViewportClasses,
} from "./source-card-model";
import { SourceFavicon } from "./source-favicon";
import { SourceManagerDialog } from "./source-manager-dialog";
import { useSourcePreferences } from "./source-preferences";
import { moveSource, orderWithPinned } from "./source-preferences-model";
import {
	applyCachedTranslations,
	storePageTranslations,
} from "./translation-snapshot-cache";
import {
	pageNeedsTranslationWarmup,
	textNeedsTranslation,
} from "./translation-status";
import { SOURCE_RENDER_BATCH_SIZE } from "./trends-limits";
import { trendSourceQueryOptions } from "./trends-query";
import { TrendsSummary } from "./trends-summary";
import type {
	NewsItem,
	SourceCardData,
	SourceStatus,
	TrendsPageData,
} from "./types";
import { ViewSwitch } from "./view-switch";

interface TrendsPageProps {
	displaySettingsStore?: DisplaySettingsStoreOptions;
	page: TrendsPageData;
}

interface SourceDragPreview {
	height: number;
	homeUrl?: string;
	left: number;
	title: string;
	top: number;
	width: number;
}

// Titles the reader has already opened fade, with nothing stored anywhere:
// the browser's own :visited state does the work.
// The link carries the title colour and the title inherits it, because
// :visited can only recolour the link element itself, and only with literal
// colours (custom properties are ignored there).
const VISITED_TITLE_CLASS =
	"text-[var(--text-primary)] visited:text-[#9b9893] hover:text-[var(--accent-blue)] visited:hover:text-[var(--accent-blue)] dark:visited:text-[#6f685f]";

function proxiedImageUrl(imageUrl: string, variant: "card" | "row"): string {
	return `${env.VITE_SERVER_URL}/api/image?variant=${variant}&url=${encodeURIComponent(imageUrl)}`;
}

export function TrendsPage({ displaySettingsStore, page }: TrendsPageProps) {
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const t = useT();
	const displayPage = useMemo(
		() => applyCachedTranslations(page, locale),
		[locale, page]
	);
	const translationPending =
		(locale === "zh" || locale === "en") &&
		pageNeedsTranslationWarmup(displayPage, locale);
	const settings = useDisplaySettings(displaySettingsStore);
	useEffect(() => {
		storePageTranslations(displayPage, locale);
	}, [displayPage, locale]);
	// Search navigates here with #source-<id>; the card only exists once the
	// page has rendered, so the reveal happens after mount.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run per topic
	useEffect(() => {
		const hash = window.location.hash;
		if (!hash.startsWith("#source-")) {
			return;
		}
		if (revealSourceCard(hash.slice("#source-".length))) {
			history.replaceState(null, "", window.location.pathname);
		}
	}, [displayPage.id]);
	const sources = displayPage.sections.flatMap((section) =>
		section.sources.map((source) => ({
			sectionId: section.id,
			source,
		}))
	);
	const sourcePreferences = useSourcePreferences(
		displayPage.id,
		sources.map(({ source }) => source.sourceId)
	);
	const sourceById = new Map(
		sources.map((entry) => [entry.source.sourceId, entry])
	);
	const pinnedSourceIdSet = new Set(
		sourcePreferences.preference.pinnedSourceIds
	);
	const orderedSources = orderWithPinned(
		sourcePreferences.preference.orderedSourceIds,
		sourcePreferences.preference.pinnedSourceIds
	)
		.map((sourceId) => sourceById.get(sourceId))
		.filter((entry): entry is SourceWithSection => Boolean(entry));
	const hiddenSourceIdSet = new Set(
		sourcePreferences.preference.hiddenSourceIds
	);
	const userVisibleSources = orderedSources.filter(
		({ source }) => !hiddenSourceIdSet.has(source.sourceId)
	);
	const pageVisibleSources = userVisibleSources.filter(
		({ source }) => source.items.length > 0 || source.status !== "error"
	);
	const [sourceManagerOpen, setSourceManagerOpen] = useState(false);
	const followed = useFollowedSources();
	// On the followed page the list is the follow list itself: unfollowing
	// from a card menu removes the card at once, before the page refetches.
	const visibleSources =
		page.id === FOLLOWED_TOPIC_ID
			? pageVisibleSources.filter(({ source }) =>
					followed.isFollowed(source.sourceId)
				)
			: pageVisibleSources;
	const followedContext = useMemo(
		() => ({
			isFollowed: followed.isFollowed,
			toggleFollowed: followed.toggleFollowed,
		}),
		[followed.isFollowed, followed.toggleFollowed]
	);
	const [draggingSourceId, setDraggingSourceId] = useState<string | undefined>(
		undefined
	);
	const draggingSourceIdRef = useRef<string | undefined>(undefined);
	const dragListenersRef = useRef<AbortController | null>(null);
	const sourceOrderRef = useRef(sourcePreferences.preference.orderedSourceIds);
	sourceOrderRef.current = sourcePreferences.preference.orderedSourceIds;
	const committedSourceOrderRef = useRef(
		sourcePreferences.preference.orderedSourceIds
	);
	committedSourceOrderRef.current =
		sourcePreferences.preference.orderedSourceIds;
	const pointerDragBaseOrderRef = useRef<string[] | undefined>(undefined);
	const pointerDragOrderRef = useRef<string[] | undefined>(undefined);
	const dropTargetElementRef = useRef<HTMLElement | null>(null);
	const dragGrabOffsetRef = useRef({ x: 0, y: 0 });
	const dragPreviewOriginRef = useRef({ left: 0, top: 0 });
	const dragPreviewPositionRef = useRef({ left: 0, top: 0 });
	const dragPreviewElementRef = useRef<HTMLDivElement | null>(null);
	const dragPreviewFrameRef = useRef<number | undefined>(undefined);
	const [dragPreview, setDragPreview] = useState<SourceDragPreview | undefined>(
		undefined
	);
	const [dragAnnouncement, setDragAnnouncement] = useState("");

	useEffect(
		() => () => {
			if (dragPreviewFrameRef.current !== undefined) {
				cancelAnimationFrame(dragPreviewFrameRef.current);
			}
			dropTargetElementRef.current?.removeAttribute("data-drop-target");
		},
		[]
	);

	function announceMove(activeSourceId: string, order: readonly string[]) {
		const sourceTitle = sourceById.get(activeSourceId)?.source.title ?? "";
		setDragAnnouncement(
			t("display.sourceMoved", {
				title: sourceTitle,
				position: order.indexOf(activeSourceId) + 1,
				count: order.length,
			})
		);
	}

	function commitSourceOrder(activeSourceId: string, nextOrder: string[]) {
		sourceOrderRef.current = nextOrder;
		sourcePreferences.setOrder(nextOrder);
		announceMove(activeSourceId, nextOrder);
	}

	function moveAndAnnounce(activeSourceId: string, overSourceId: string) {
		const currentOrder = sourceOrderRef.current;
		const nextOrder = moveSource(currentOrder, activeSourceId, overSourceId);
		if (nextOrder.join("\u0000") === currentOrder.join("\u0000")) {
			return;
		}
		commitSourceOrder(activeSourceId, nextOrder);
	}

	function dragHandleProps(sourceId: string): SourceDragHandleProps {
		const finishPointerDrag = (commit: boolean) => {
			dragListenersRef.current?.abort();
			dragListenersRef.current = null;
			const finalOrder = pointerDragOrderRef.current;
			if (
				commit &&
				finalOrder &&
				finalOrder.join("\u0000") !==
					committedSourceOrderRef.current.join("\u0000")
			) {
				commitSourceOrder(sourceId, finalOrder);
			}
			if (dragPreviewFrameRef.current !== undefined) {
				cancelAnimationFrame(dragPreviewFrameRef.current);
				dragPreviewFrameRef.current = undefined;
			}
			dropTargetElementRef.current?.removeAttribute("data-drop-target");
			dropTargetElementRef.current = null;
			pointerDragBaseOrderRef.current = undefined;
			pointerDragOrderRef.current = undefined;
			draggingSourceIdRef.current = undefined;
			setDraggingSourceId(undefined);
			setDragPreview(undefined);
		};
		const movePointerDrag = (event: { clientX: number; clientY: number }) => {
			const activeSourceId = draggingSourceIdRef.current;
			if (!activeSourceId) {
				return;
			}
			dragPreviewPositionRef.current = {
				left: event.clientX - dragGrabOffsetRef.current.x,
				top: event.clientY - dragGrabOffsetRef.current.y,
			};
			if (dragPreviewFrameRef.current === undefined) {
				dragPreviewFrameRef.current = requestAnimationFrame(() => {
					dragPreviewFrameRef.current = undefined;
					const element = dragPreviewElementRef.current;
					if (!element) {
						return;
					}
					const position = dragPreviewPositionRef.current;
					const origin = dragPreviewOriginRef.current;
					element.style.transform = `translate3d(${position.left - origin.left}px, ${position.top - origin.top}px, 0)`;
				});
			}
			const target = document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>("[data-sortable-source-id]");
			const overSourceId = target?.dataset.sortableSourceId;
			// Reorder live: the card moves into place under the pointer and its
			// neighbours shift, like icons on a home screen; the ghost only
			// shows what is being carried.
			if (overSourceId && overSourceId !== activeSourceId) {
				const next = moveSource(
					pointerDragOrderRef.current ?? sourceOrderRef.current,
					activeSourceId,
					overSourceId
				);
				if (
					next.join("\u0000") !==
					(pointerDragOrderRef.current ?? []).join("\u0000")
				) {
					pointerDragOrderRef.current = next;
					sourceOrderRef.current = next;
					sourcePreferences.setOrder(next);
				}
			}
		};
		return {
			onKeyDown: (event) => {
				const order = sourceOrderRef.current;
				const currentIndex = order.indexOf(sourceId);
				let targetIndex = currentIndex;
				if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
					targetIndex = Math.max(0, currentIndex - 1);
				} else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
					targetIndex = Math.min(order.length - 1, currentIndex + 1);
				} else if (event.key === "Home") {
					targetIndex = 0;
				} else if (event.key === "End") {
					targetIndex = order.length - 1;
				} else {
					return;
				}
				event.preventDefault();
				const overSourceId = order[targetIndex];
				if (overSourceId) {
					moveAndAnnounce(sourceId, overSourceId);
				}
			},
			onPointerDown: (event) => {
				if (!(event.isPrimary && event.button === 0)) {
					return;
				}
				event.preventDefault();
				const card = event.currentTarget.closest<HTMLElement>(
					"[data-sortable-source-id]"
				);
				const rect = card?.getBoundingClientRect();
				if (!rect) {
					return;
				}
				// The move and release events are listened for on the document, not
				// captured on the handle: the live reorder moves the card's DOM node
				// while it is being dragged, and a moved node loses its pointer
				// capture, which left the drag stuck until a reload.
				dragListenersRef.current?.abort();
				const listeners = new AbortController();
				dragListenersRef.current = listeners;
				const { pointerId } = event;
				const samePointer = (native: PointerEvent) =>
					native.pointerId === pointerId;
				document.addEventListener(
					"pointermove",
					(native) => {
						if (samePointer(native)) {
							movePointerDrag(native);
						}
					},
					{ passive: true, signal: listeners.signal }
				);
				document.addEventListener(
					"pointerup",
					(native) => {
						if (samePointer(native)) {
							finishPointerDrag(true);
						}
					},
					{ signal: listeners.signal }
				);
				document.addEventListener(
					"pointercancel",
					() => finishPointerDrag(false),
					{ signal: listeners.signal }
				);
				window.addEventListener("blur", () => finishPointerDrag(false), {
					signal: listeners.signal,
				});
				const source = sourceById.get(sourceId)?.source;
				const initialOrder = [...sourceOrderRef.current];
				pointerDragBaseOrderRef.current = initialOrder;
				pointerDragOrderRef.current = initialOrder;
				dragGrabOffsetRef.current = {
					x: event.clientX - rect.left,
					y: event.clientY - rect.top,
				};
				dragPreviewOriginRef.current = { left: rect.left, top: rect.top };
				dragPreviewPositionRef.current = { left: rect.left, top: rect.top };
				draggingSourceIdRef.current = sourceId;
				setDraggingSourceId(sourceId);
				setDragPreview({
					height: rect.height,
					homeUrl: source?.homeUrl,
					left: rect.left,
					title: source?.title ?? "",
					top: rect.top,
					width: rect.width,
				});
			},
		};
	}

	let sourceContent: ReactNode;
	if (userVisibleSources.length === 0) {
		sourceContent = (
			<div className="flex min-h-48 flex-col items-center justify-center gap-3 border-[var(--border-default)] border-b bg-[var(--surface-card)] px-4 text-center">
				<p className="text-[13px] text-[var(--text-secondary)]">
					{t("display.allSourcesHidden")}
				</p>
				<button
					className="rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--state-hover-subtle)]"
					onClick={sourcePreferences.showAllSources}
					type="button"
				>
					{t("display.restoreAllSources")}
				</button>
			</div>
		);
	} else if (visibleSources.length === 0) {
		sourceContent = (
			<div className="flex min-h-32 items-center justify-center border-[var(--border-default)] border-b bg-[var(--surface-card)] px-4 text-center text-[13px] text-[var(--text-secondary)]">
				{t("card.unavailable")}
			</div>
		);
	} else if (settings.layout === "sourceSections") {
		sourceContent = (
			<SourceSectionsLayout
				draggingSourceId={draggingSourceId}
				dragHandleProps={dragHandleProps}
				locale={locale}
				onHideSource={(sourceId) =>
					sourcePreferences.setSourceVisible(sourceId, false)
				}
				onPinSource={sourcePreferences.togglePinned}
				pinnedSourceIds={pinnedSourceIdSet}
				settings={settings}
				sources={visibleSources}
				t={t}
				topicId={displayPage.id}
				translationPending={translationPending}
			/>
		);
	} else {
		sourceContent = (
			<SourceGridLayout
				draggingSourceId={draggingSourceId}
				dragHandleProps={dragHandleProps}
				locale={locale}
				onHideSource={(sourceId) =>
					sourcePreferences.setSourceVisible(sourceId, false)
				}
				onPinSource={sourcePreferences.togglePinned}
				pinnedSourceIds={pinnedSourceIdSet}
				settings={settings}
				sources={visibleSources}
				t={t}
				translationPending={translationPending}
			/>
		);
	}
	return (
		<FollowedSourcesContext.Provider value={followedContext}>
			<ScrollArea className="min-w-0 flex-1 overflow-hidden bg-[var(--surface-app)] text-[var(--text-primary)]">
				<div>
					<p aria-live="polite" className="sr-only">
						{dragAnnouncement}
					</p>
					<TrendsSummary
						collapsed={settings.summaryCollapsed}
						key={displayPage.id}
						onCollapsedChange={(collapsed) =>
							setDisplaySetting(
								"summaryCollapsed",
								collapsed,
								displaySettingsStore
							)
						}
						page={displayPage}
						topicId={displayPage.id}
					/>
					<ViewBar
						displaySettingsStore={displaySettingsStore}
						localeParam={localeParam}
						onOpenSources={() => setSourceManagerOpen(true)}
						settings={settings}
						t={t}
						topicId={displayPage.id}
					/>
					{sourceManagerOpen ? (
						<SourceManagerDialog
							hiddenSourceIds={sourcePreferences.preference.hiddenSourceIds}
							onOpenChange={setSourceManagerOpen}
							onOrderChange={sourcePreferences.setOrder}
							onShowAll={sourcePreferences.showAllSources}
							onTogglePinned={sourcePreferences.togglePinned}
							onVisibilityChange={sourcePreferences.setSourceVisible}
							open={sourceManagerOpen}
							pinnedSourceIds={sourcePreferences.preference.pinnedSourceIds}
							sources={orderedSources.map(({ source }) => ({
								homeUrl: source.homeUrl,
								id: source.sourceId,
								title: source.title,
							}))}
							t={t}
							topicTitle={displayPage.title}
						/>
					) : null}
					{sourceContent}
				</div>
				{dragPreview ? (
					<div
						aria-hidden
						className="pointer-events-none fixed z-[100] flex flex-col overflow-hidden border border-[var(--accent-blue)] bg-[var(--surface-card)] opacity-95 shadow-lg [contain:strict] [will-change:transform]"
						ref={dragPreviewElementRef}
						style={{
							height: dragPreview.height,
							left: dragPreview.left,
							top: dragPreview.top,
							width: dragPreview.width,
						}}
					>
						<div className="flex items-center gap-2 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2">
							<GripVertical className="size-3.5 text-[var(--accent-blue)]" />
							<SourceFavicon homeUrl={dragPreview.homeUrl} />
							<span className="truncate font-semibold text-[13px] text-[var(--text-heading)]">
								{dragPreview.title}
							</span>
						</div>
					</div>
				) : null}
			</ScrollArea>
		</FollowedSourcesContext.Provider>
	);
}

interface SourceWithSection {
	sectionId: string;
	source: SourceCardData;
}

function useProgressiveSources(sources: SourceWithSection[]) {
	const [limit, setLimit] = useState(SOURCE_RENDER_BATCH_SIZE);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const hasMore = limit < sources.length;

	useEffect(() => {
		if (!hasMore) {
			return;
		}
		const sentinel = sentinelRef.current;
		if (!sentinel || typeof IntersectionObserver === "undefined") {
			setLimit(sources.length);
			return;
		}
		const observer = new IntersectionObserver(
			(records) => {
				if (records.some((record) => record.isIntersecting)) {
					setLimit(Math.min(sources.length, limit + SOURCE_RENDER_BATCH_SIZE));
				}
			},
			{ rootMargin: "640px 0px" }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasMore, limit, sources.length]);

	return {
		hasMore,
		sentinelRef,
		visibleSources: sources.slice(0, limit),
	};
}

interface SourceDragHandleProps {
	onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

const SOURCE_SECTION_GRID =
	"grid grid-cols-1 items-stretch sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 min-[1800px]:grid-cols-8";

// Sits directly above the cards: how the open topic is viewed (source cards
// or clustered events) and how the cards are laid out.
function ViewBar({
	displaySettingsStore,
	localeParam,
	onOpenSources,
	settings,
	t,
	topicId,
}: {
	displaySettingsStore?: DisplaySettingsStoreOptions;
	localeParam: Locale | undefined;
	onOpenSources: () => void;
	settings: DisplaySettings;
	t: Translator;
	topicId: string;
}) {
	return (
		<div className="flex h-10 items-center justify-between gap-3 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 sm:px-4">
			<ViewSwitch localeParam={localeParam} topicId={topicId} view="trends" />
			{/* "Manage sources" sits at the right end on every view so it reads as
			    the one place a topic's sources are kept. */}
			<div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--text-muted)]">
				<DisplaySettingsMenuContent
					settings={settings}
					storeOptions={displaySettingsStore}
					t={t}
				/>
				<button
					className={toolButtonClassName}
					onClick={onOpenSources}
					type="button"
				>
					<Rss aria-hidden className="size-3.5" />
					<span>{t("sourceManager.button")}</span>
				</button>
			</div>
		</div>
	);
}

function SourceGridLayout({
	sources,
	settings,
	t,
	locale,
	translationPending,
	dragHandleProps,
	draggingSourceId,
	onHideSource,
	onPinSource,
	pinnedSourceIds,
}: {
	sources: SourceWithSection[];
	settings: DisplaySettings;
	t: Translator;
	locale: Locale;
	translationPending: boolean;
	dragHandleProps: (sourceId: string) => SourceDragHandleProps;
	draggingSourceId?: string;
	onHideSource: (sourceId: string) => void;
	onPinSource: (sourceId: string) => void;
	pinnedSourceIds: ReadonlySet<string>;
}) {
	const { hasMore, sentinelRef, visibleSources } =
		useProgressiveSources(sources);
	return (
		<div className={SOURCE_CARD_GRID_CLASSES}>
			{visibleSources.map(({ sectionId, source }) => (
				<SourceCard
					dragHandleProps={dragHandleProps(source.sourceId)}
					isDragging={draggingSourceId === source.sourceId}
					key={`${sectionId}:${source.sourceId}`}
					locale={locale}
					onHide={() => onHideSource(source.sourceId)}
					onPin={() => onPinSource(source.sourceId)}
					pinned={pinnedSourceIds.has(source.sourceId)}
					settings={settings}
					source={source}
					t={t}
					translationPending={translationPending}
				/>
			))}
			{hasMore ? (
				<div aria-hidden className="col-span-full h-px" ref={sentinelRef} />
			) : null}
		</div>
	);
}

function SourceSectionsLayout({
	sources,
	settings,
	t,
	topicId,
	locale,
	translationPending,
	dragHandleProps,
	draggingSourceId,
	onHideSource,
	onPinSource,
	pinnedSourceIds,
}: {
	sources: SourceWithSection[];
	settings: DisplaySettings;
	t: Translator;
	topicId: string;
	locale: Locale;
	translationPending: boolean;
	dragHandleProps: (sourceId: string) => SourceDragHandleProps;
	draggingSourceId?: string;
	onHideSource: (sourceId: string) => void;
	onPinSource: (sourceId: string) => void;
	pinnedSourceIds: ReadonlySet<string>;
}) {
	const { hasMore, sentinelRef, visibleSources } =
		useProgressiveSources(sources);
	return (
		<div className="bg-[var(--surface-app)]">
			{visibleSources.map(({ sectionId, source }) => (
				<SourceSection
					dragHandleProps={dragHandleProps(source.sourceId)}
					isDragging={draggingSourceId === source.sourceId}
					key={`${sectionId}:${source.sourceId}`}
					locale={locale}
					onHide={() => onHideSource(source.sourceId)}
					onPin={() => onPinSource(source.sourceId)}
					pinned={pinnedSourceIds.has(source.sourceId)}
					settings={settings}
					source={source}
					t={t}
					topicId={topicId}
					translationPending={translationPending}
				/>
			))}
			{hasMore ? <div aria-hidden className="h-px" ref={sentinelRef} /> : null}
		</div>
	);
}

function SourceCard({
	source,
	settings,
	t,
	locale,
	translationPending,
	dragHandleProps,
	isDragging,
	onHide,
	onPin,
	pinned,
}: {
	source: SourceCardData;
	settings: DisplaySettings;
	t: Translator;
	locale: Locale;
	translationPending: boolean;
	dragHandleProps: SourceDragHandleProps;
	isDragging: boolean;
	onHide: () => void;
	onPin: () => void;
	pinned: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const hasItems = source.items.length > 0;

	return (
		<article
			className={`relative flex min-w-0 flex-col overflow-hidden border-[var(--border-default)] border-b bg-[var(--surface-card)] transition-opacity after:pointer-events-none after:absolute after:inset-0 after:z-40 after:content-[''] data-[drop-target=true]:after:border-2 data-[drop-target=true]:after:border-[var(--accent-blue)] sm:border-r ${sourceCardViewportClasses(hasItems, expanded)} ${isDragging ? "z-30 opacity-50 shadow-[0_0_0_2px_var(--accent-blue)]" : ""}`}
			data-sortable-source-id={source.sourceId}
			id={sourceCardElementId(source.sourceId)}
		>
			<SourceCardHeader
				dragHandleProps={dragHandleProps}
				onHide={onHide}
				onPin={onPin}
				pinned={pinned}
				source={source}
				t={t}
			/>
			{hasItems ? (
				<div
					className={`relative min-h-0 flex-1 max-sm:max-h-[70svh] ${expanded ? "overflow-y-auto" : "overflow-hidden"}`}
				>
					<SourceCardBody
						locale={locale}
						settings={settings}
						source={source}
						t={t}
						translationPending={translationPending}
					/>
					{shouldShowCollapsedSourceCardFooter(
						source.items.length,
						expanded
					) ? (
						<>
							<div
								aria-hidden
								className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-16 bg-gradient-to-t from-[var(--surface-card)] via-[var(--surface-card)]/85 to-transparent sm:block"
							/>
							<button
								className="absolute inset-x-0 bottom-2 mx-auto hidden w-fit items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] sm:flex"
								onClick={() => setExpanded(true)}
								type="button"
							>
								{t("card.viewAll", {
									count: source.itemCount ?? source.items.length,
								})}
							</button>
						</>
					) : null}
					{expanded ? (
						<button
							className="sticky bottom-0 flex w-full items-center justify-center gap-1 border-[var(--border-default)] border-t bg-[var(--surface-card)] py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
							onClick={(event) => {
								setExpanded(false);
								event.currentTarget.parentElement?.scrollTo({ top: 0 });
							}}
							type="button"
						>
							<ChevronUp aria-hidden className="size-3" />
							{t("card.collapse")}
						</button>
					) : null}
				</div>
			) : (
				<SourceCardBody
					locale={locale}
					settings={settings}
					source={source}
					t={t}
					translationPending={translationPending}
				/>
			)}
		</article>
	);
}

function SourceSection({
	source,
	settings,
	t,
	topicId,
	locale,
	translationPending,
	dragHandleProps,
	isDragging,
	onHide,
	onPin,
	pinned,
}: {
	source: SourceCardData;
	settings: DisplaySettings;
	t: Translator;
	topicId: string;
	locale: Locale;
	translationPending: boolean;
	dragHandleProps: SourceDragHandleProps;
	isDragging: boolean;
	onHide: () => void;
	onPin: () => void;
	pinned: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const fullSource = useQuery({
		...trendSourceQueryOptions(topicId, source.sourceId, locale),
		enabled: expanded && Boolean(source.itemsTruncated),
	});
	const shownSource = expanded ? (fullSource.data ?? source) : source;
	return (
		<section
			className={`relative border-[var(--border-default)] border-b bg-[var(--surface-card)] transition-opacity after:pointer-events-none after:absolute after:inset-0 after:z-40 after:content-[''] data-[drop-target=true]:after:border-2 data-[drop-target=true]:after:border-[var(--accent-blue)] ${isDragging ? "z-30 opacity-80 shadow-[0_0_0_2px_var(--accent-blue)]" : ""}`}
			data-sortable-source-id={source.sourceId}
			id={sourceCardElementId(source.sourceId)}
		>
			<SourceSectionHeader
				dragHandleProps={dragHandleProps}
				onHide={onHide}
				onPin={onPin}
				pinned={pinned}
				source={source}
				t={t}
			/>
			{source.items.length === 0 ? (
				<div className="flex">
					<SourceEmptyContent source={source} t={t} />
				</div>
			) : (
				<ul className={SOURCE_SECTION_GRID}>
					{shownSource.items.map((item) => (
						<li
							className="min-w-0 border-[var(--border-default)] border-b sm:border-r sm:last:border-b"
							key={item.id}
						>
							<NewsCard
								item={item}
								locale={locale}
								settings={settings}
								translationPending={translationPending || fullSource.isFetching}
							/>
						</li>
					))}
				</ul>
			)}
			{source.itemsTruncated ? (
				<div className="border-[var(--border-default)] border-t px-3 py-2">
					<button
						className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
						onClick={() => setExpanded((value) => !value)}
						type="button"
					>
						{expanded
							? t("card.collapse")
							: t("card.viewAll", {
									count: source.itemCount ?? source.items.length,
								})}
					</button>
				</div>
			) : null}
		</section>
	);
}

function SourceCardHeader({
	source,
	t,
	dragHandleProps,
	onHide,
	onPin,
	pinned,
}: {
	source: SourceCardData;
	t: Translator;
	dragHandleProps: SourceDragHandleProps;
	onHide: () => void;
	onPin: () => void;
	pinned: boolean;
}) {
	return (
		<div className="flex items-start justify-between gap-3 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2 sm:items-baseline">
			<div className="flex min-w-0 items-center gap-2">
				<SourceDragHandle
					dragHandleProps={dragHandleProps}
					source={source}
					t={t}
				/>
				<SourceFavicon homeUrl={source.homeUrl} />
				<SourceTitle as="h3" className="text-[13px]" source={source} t={t} />
				<StatusDot status={source.status} t={t} />
				{pinned ? <PinnedBadge t={t} /> : null}
			</div>
			<SourceHeaderMeta
				onHide={onHide}
				onPin={onPin}
				pinned={pinned}
				source={source}
				t={t}
			/>
		</div>
	);
}

function SourceSectionHeader({
	source,
	t,
	dragHandleProps,
	onHide,
	onPin,
	pinned,
}: {
	source: SourceCardData;
	t: Translator;
	dragHandleProps: SourceDragHandleProps;
	onHide: () => void;
	onPin: () => void;
	pinned: boolean;
}) {
	return (
		<div className="flex flex-col gap-2 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
			<div className="flex min-w-0 items-center gap-2">
				<SourceDragHandle
					dragHandleProps={dragHandleProps}
					source={source}
					t={t}
				/>
				<SourceFavicon homeUrl={source.homeUrl} />
				<SourceTitle as="h2" className="text-[15px]" source={source} t={t} />
				<StatusDot status={source.status} t={t} />
				{pinned ? <PinnedBadge t={t} /> : null}
			</div>
			<SourceHeaderMeta
				itemCount={source.items.length}
				onHide={onHide}
				onPin={onPin}
				pinned={pinned}
				source={source}
				t={t}
			/>
		</div>
	);
}

function SourceHeaderMeta({
	source,
	t,
	itemCount,
	onHide,
	onPin,
	pinned,
}: {
	source: SourceCardData;
	t: Translator;
	itemCount?: number;
	onHide: () => void;
	onPin: () => void;
	pinned: boolean;
}) {
	return (
		<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[11px] text-[var(--text-muted)] max-sm:justify-start">
			{typeof itemCount === "number" ? (
				<span>{t("card.itemCount", { count: itemCount })}</span>
			) : null}
			{source.updatedAt ? (
				<span suppressHydrationWarning>
					{formatRelativeTime(source.updatedAt, t)}
				</span>
			) : (
				<span>—</span>
			)}
			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label={t("card.actionsFor", { title: source.title })}
					className="-my-1 -mr-1.5 inline-flex size-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] data-[popup-open]:bg-[var(--state-hover-subtle)] data-[popup-open]:text-[var(--text-primary)]"
				>
					<MoreHorizontal className="size-3.5" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="bg-card">
					{source.homeUrl ? (
						<DropdownMenuItem
							render={
								<a
									href={source.homeUrl}
									rel="noopener noreferrer"
									target="_blank"
								>
									<ExternalLink aria-hidden className="size-3.5" />
									{t("card.openHome")}
								</a>
							}
						/>
					) : null}
					<FollowMenuItem source={source} t={t} />
					<DropdownMenuItem onClick={onPin}>
						{pinned ? (
							<PinOff aria-hidden className="size-3.5" />
						) : (
							<Pin aria-hidden className="size-3.5" />
						)}
						{pinned ? t("card.unpinSource") : t("card.pinSource")}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onHide}>
						<EyeOff aria-hidden className="size-3.5" />
						{t("card.hideSource")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

// Pinned cards sit in a block at the top, which is invisible once they are
// there; the badge is what tells the reader why a card stays put.
// Following lives in the menu with pin and hide: it changes nothing on this
// page, only what the Following tab shows.
function FollowMenuItem({
	source,
	t,
}: {
	source: SourceCardData;
	t: Translator;
}) {
	const { isFollowed, toggleFollowed } = useFollowedSourcesContext();
	const followed = isFollowed(source.sourceId);
	return (
		<DropdownMenuItem onClick={() => toggleFollowed(source.sourceId)}>
			<Star
				aria-hidden
				className="size-3.5"
				fill={followed ? "currentColor" : "none"}
			/>
			{followed ? t("card.unfollowSource") : t("card.followSource")}
		</DropdownMenuItem>
	);
}

// A ranking says which list it is ("实时热搜", "Weekly", or just 热榜) in an
// orange badge, the colour used for heat. A feed's name is left whole:
// "The Verge · AI" is a section, not a kind of list.
function SourceTitle({
	as: Tag,
	className,
	source,
	t,
}: {
	as: "h2" | "h3";
	className: string;
	source: SourceCardData;
	t: Translator;
}) {
	const ranking = isRankingSource(source);
	const [name, flavour] = ranking
		? splitSourceTitle(source.title)
		: [source.title, undefined];
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			<Tag
				className={`min-w-0 truncate font-semibold text-[var(--text-heading)] tracking-tight ${className}`}
			>
				{name}
			</Tag>
			{ranking ? (
				<span className="shrink-0 rounded bg-[var(--accent-orange-light)] px-1.5 py-px font-medium text-[10px] text-[var(--accent-orange)] leading-4">
					{flavour ?? t("card.hotList")}
				</span>
			) : null}
		</span>
	);
}

function splitSourceTitle(title: string): [string, string | undefined] {
	const index = title.indexOf(" · ");
	if (index === -1) {
		return [title, undefined];
	}
	return [title.slice(0, index), title.slice(index + 3)];
}

function PinnedBadge({ t }: { t: Translator }) {
	return (
		<span
			className="inline-flex shrink-0 text-[var(--accent-blue)]"
			title={t("card.pinned")}
		>
			<Pin aria-hidden className="size-3" />
			<span className="sr-only">{t("card.pinned")}</span>
		</span>
	);
}

function SourceDragHandle({
	dragHandleProps,
	source,
	t,
}: {
	dragHandleProps: SourceDragHandleProps;
	source: SourceCardData;
	t: Translator;
}) {
	return (
		<button
			aria-label={t("display.dragSource", { title: source.title })}
			className="-ml-1 inline-flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] active:cursor-grabbing"
			onKeyDown={dragHandleProps.onKeyDown}
			onPointerDown={dragHandleProps.onPointerDown}
			title={t("display.dragSource", { title: source.title })}
			type="button"
		>
			<GripVertical aria-hidden className="size-3.5" />
		</button>
	);
}

function SourceCardBody({
	source,
	settings,
	t,
	locale,
	translationPending,
}: {
	source: SourceCardData;
	settings: DisplaySettings;
	t: Translator;
	locale: Locale;
	translationPending: boolean;
}) {
	const empty = <SourceEmptyContent source={source} t={t} />;

	if (source.status === "error" && source.items.length === 0) {
		return empty;
	}

	if (source.items.length === 0) {
		return empty;
	}

	const ranking = isRankingSource(source);
	return (
		<ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
			{source.items.map((item) => (
				<li key={item.id}>
					<NewsRow
						item={item}
						locale={locale}
						ranking={ranking}
						settings={settings}
						translationPending={translationPending}
					/>
				</li>
			))}
		</ul>
	);
}

function SourceEmptyContent({
	source,
	t,
}: {
	source: SourceCardData;
	t: Translator;
}) {
	if (source.status === "error") {
		return (
			<EmptyState>
				<CircleAlert className="size-3.5 text-[var(--accent-red)]" />
				<span>{t("card.unavailable")}</span>
			</EmptyState>
		);
	}

	return (
		<EmptyState>
			<CircleDashed className="size-3.5" />
			<span>{t("card.noContent")}</span>
		</EmptyState>
	);
}

function EmptyState({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-4 py-3 text-center text-[12px] text-[var(--text-secondary)] sm:px-8">
			{children}
		</div>
	);
}

function buildMeta(
	item: NewsItem,
	settings: DisplaySettings,
	t: Translator
): string | null {
	const showHot =
		settings.showHotValue &&
		item.hotValue !== undefined &&
		item.hotValue !== "";
	const showTime = settings.showRelativeTime && Boolean(item.publishedAt);
	if (showHot && showTime) {
		return `${String(item.hotValue)} · ${formatRelativeTime(item.publishedAt as number, t)}`;
	}
	if (showHot) {
		return String(item.hotValue);
	}
	if (showTime) {
		return formatRelativeTime(item.publishedAt as number, t);
	}
	return null;
}

// A hot list (Weibo, Zhihu, Hacker News, GitHub Trending…) is a ranking, not
// a feed: rows are one line, no cover or blurb, and the platform's own heat
// number sits at the right where it can be read.
function isRankingSource(source: SourceCardData): boolean {
	if (source.kind) {
		return source.kind === "ranking";
	}
	const withHeat = source.items.filter(
		(item) => item.hotValue !== undefined && item.hotValue !== ""
	).length;
	return source.items.length > 0 && withHeat * 2 >= source.items.length;
}

function formatHeat(value: string | number): string {
	if (typeof value === "number") {
		return new Intl.NumberFormat("en", {
			maximumFractionDigits: 1,
			notation: "compact",
		}).format(value);
	}
	return value;
}

function NewsRow({
	item,
	settings,
	locale,
	ranking = false,
	translationPending,
}: {
	item: NewsItem;
	settings: DisplaySettings;
	locale: Locale;
	ranking?: boolean;
	translationPending: boolean;
}) {
	const t = useT();
	const meta = ranking ? null : buildMeta(item, settings, t);
	const showCover =
		!ranking && settings.showCover && coverKind(item.imageUrl) === "cover";
	const showDescription =
		!ranking && settings.showDescription && Boolean(item.description);
	const heat =
		ranking && item.hotValue !== undefined && item.hotValue !== ""
			? formatHeat(item.hotValue)
			: null;

	const original =
		item.original && item.original.title !== item.title
			? item.original.title
			: undefined;

	return (
		<a
			className={`group relative flex items-start gap-2.5 px-3 transition-colors hover:bg-[var(--state-hover-subtle)] sm:gap-3 ${ranking ? "py-1.5" : "py-2.5 sm:py-2"} ${VISITED_TITLE_CLASS}`}
			href={item.url}
			rel="noopener noreferrer"
			target="_blank"
			title={original}
		>
			{settings.showRank ? (
				<span className="mt-[1px] inline-flex w-5 shrink-0 select-none font-mono text-[11px] text-[var(--text-muted)] tabular-nums sm:w-6">
					{item.rank ? String(item.rank).padStart(2, "0") : ""}
				</span>
			) : null}
			{showCover ? (
				<CoverImage
					alt=""
					className="mt-[2px] size-10 shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-sidebar)] object-cover sm:size-12"
					height={48}
					loading="lazy"
					src={proxiedImageUrl(item.imageUrl as string, "row")}
					width={48}
				/>
			) : null}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-start gap-1.5">
					<span
						className={`line-clamp-3 min-w-0 flex-1 text-[13px] text-current leading-[1.45] sm:line-clamp-2 ${ranking ? "" : "font-medium"}`}
						data-title
					>
						{item.title}
					</span>
					<TitleTranslationIndicator
						item={item}
						locale={locale}
						pending={translationPending}
						t={t}
					/>
				</span>
				{original && settings.showOriginalTitle ? (
					<span className="line-clamp-2 text-[11px] text-[var(--text-muted)] leading-[1.4]">
						{original}
					</span>
				) : null}
				{showDescription ? (
					<span className="line-clamp-2 text-[12px] text-[var(--text-secondary)] leading-[1.45]">
						{item.description}
					</span>
				) : null}
				<NewsItemMeta item={item} meta={meta} t={t} />
			</span>
			{heat ? (
				<span className="mt-[2px] inline-flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--accent-orange)] tabular-nums">
					<Flame aria-hidden className="size-3" />
					{heat}
				</span>
			) : null}
			{ranking ? null : (
				<ArrowUpRight className="mt-[3px] hidden size-3 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 sm:block" />
			)}
		</a>
	);
}

function NewsCard({
	item,
	settings,
	locale,
	translationPending,
}: {
	item: NewsItem;
	settings: DisplaySettings;
	locale: Locale;
	translationPending: boolean;
}) {
	const t = useT();
	const meta = buildMeta(item, settings, t);
	const showCover = settings.showCover && coverKind(item.imageUrl) === "cover";
	const showDescription = settings.showDescription && Boolean(item.description);

	return (
		<a
			className={`group flex h-full min-h-[148px] flex-col bg-[var(--surface-card)] transition-colors hover:bg-[var(--state-hover-subtle)] sm:min-h-[168px] ${VISITED_TITLE_CLASS}`}
			href={item.url}
			rel="noopener noreferrer"
			target="_blank"
			title={
				item.original && item.original.title !== item.title
					? item.original.title
					: undefined
			}
		>
			{showCover ? (
				<CoverImage
					alt=""
					className="aspect-[16/9] w-full border-[var(--border-subtle)] border-b bg-[var(--surface-sidebar)] object-cover"
					height={180}
					loading="lazy"
					src={proxiedImageUrl(item.imageUrl as string, "card")}
					width={320}
				/>
			) : null}
			<span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
				<span className="flex min-w-0 items-start gap-2">
					{settings.showRank ? (
						<span className="mt-[2px] inline-flex w-7 shrink-0 select-none font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
							{item.rank ? String(item.rank).padStart(2, "0") : ""}
						</span>
					) : null}
					<span
						className="line-clamp-3 min-w-0 flex-1 font-medium text-[13px] text-current leading-[1.45]"
						data-title
					>
						{item.title}
					</span>
					<TitleTranslationIndicator
						item={item}
						locale={locale}
						pending={translationPending}
						t={t}
					/>
					<ArrowUpRight className="mt-[3px] size-3 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
				</span>
				{showDescription ? (
					<span className="line-clamp-3 text-[12px] text-[var(--text-secondary)] leading-[1.45]">
						{item.description}
					</span>
				) : null}
				<NewsItemMeta className="mt-auto" item={item} meta={meta} t={t} />
			</span>
		</a>
	);
}

function TitleTranslationIndicator({
	item,
	locale,
	pending,
	t,
}: {
	item: NewsItem;
	locale: Locale;
	pending: boolean;
	t: Translator;
}) {
	if (!pending || item.original || !textNeedsTranslation(item.title, locale)) {
		return null;
	}

	const label = t("card.translatingTitle");
	return (
		<span
			className="mt-[3px] inline-flex size-3.5 shrink-0 items-center justify-center text-[var(--text-muted)]"
			title={label}
		>
			<LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" />
			<span className="sr-only">{label}</span>
		</span>
	);
}

function NewsItemMeta({
	item,
	meta,
	t,
	className,
}: {
	item: NewsItem;
	meta: string | null;
	t: Translator;
	className?: string;
}) {
	if (!meta) {
		return null;
	}

	return (
		<span
			className={`inline-flex min-w-0 items-center gap-1 text-[11px] text-[var(--text-muted)] ${className ?? ""}`}
		>
			<TranslatedItemMarker item={item} t={t} />
			<span className="min-w-0 truncate" suppressHydrationWarning>
				{meta}
			</span>
		</span>
	);
}

function TranslatedItemMarker({ item, t }: { item: NewsItem; t: Translator }) {
	if (!item.original) {
		return null;
	}

	return (
		<Tooltip>
			<TooltipTrigger
				aria-label={t("card.translated")}
				className="inline-flex size-3.5 shrink-0 items-center justify-center text-[var(--text-muted)] opacity-55 transition-opacity group-hover:opacity-90"
				delay={250}
				render={<span />}
			>
				<Languages aria-hidden className="size-3" />
			</TooltipTrigger>
			<TooltipPortal>
				<TooltipPositioner align="center" side="top">
					<TooltipPopup className="w-[min(300px,92vw)]">
						<p className="font-medium text-[var(--text-primary)]">
							{t("card.translatedTooltip")}
						</p>
						<p className="mt-1 line-clamp-3 text-[var(--text-secondary)] leading-[1.45]">
							{item.original.title}
						</p>
						{item.original.description ? (
							<p className="mt-1 line-clamp-3 text-[var(--text-muted)] leading-[1.45]">
								{item.original.description}
							</p>
						) : null}
					</TooltipPopup>
				</TooltipPositioner>
			</TooltipPortal>
		</Tooltip>
	);
}

// A healthy source shows nothing; the dot only appears when the feed is
// stale or failing, which is when the reader needs to know.
function StatusDot({ status, t }: { status: SourceStatus; t: Translator }) {
	if (status === "ok") {
		return null;
	}
	let colorVar = "var(--accent-red)";
	let label = t("card.statusFailed");
	if (status === "stale") {
		colorVar = "var(--accent-orange)";
		label = t("card.statusStale");
	}
	return (
		<span
			aria-hidden
			className="inline-block size-1.5 shrink-0 rounded-full"
			style={{ backgroundColor: colorVar }}
			title={label}
		/>
	);
}
