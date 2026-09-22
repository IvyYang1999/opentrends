import { env } from "@opentrends/env/web";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@opentrends/ui/components/dialog";
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
import { Link } from "@tanstack/react-router";
import {
	ArrowUpRight,
	CircleAlert,
	CircleDashed,
	ExternalLink,
	EyeOff,
	GripVertical,
	Languages,
	LoaderCircle,
	MoreHorizontal,
	Pin,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

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
import {
	DisplaySettingsMenuContent,
	LayoutSettingsMenuContent,
} from "./display-settings-menu";
import { formatRelativeTime } from "./relative-time";
import {
	isDecorativeBadgeImage,
	sourceCardViewportClasses,
} from "./source-card-model";
import { SourceFavicon } from "./source-favicon";
import { useSourcePreferences } from "./source-preferences";
import { moveSource, pinSource } from "./source-preferences-model";
import {
	applyCachedTranslations,
	storePageTranslations,
} from "./translation-snapshot-cache";
import {
	pageNeedsTranslationWarmup,
	textNeedsTranslation,
} from "./translation-status";
import { trendSourceQueryOptions } from "./trends-query";
import { TrendsSummary } from "./trends-summary";
import type {
	NewsItem,
	SourceCardData,
	SourceStatus,
	TrendsPageData,
} from "./types";

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
	const orderedSources = sourcePreferences.preference.orderedSourceIds
		.map((sourceId) => sourceById.get(sourceId))
		.filter((entry): entry is SourceWithSection => Boolean(entry));
	const hiddenSourceIdSet = new Set(
		sourcePreferences.preference.hiddenSourceIds
	);
	const userVisibleSources = orderedSources.filter(
		({ source }) => !hiddenSourceIdSet.has(source.sourceId)
	);
	const visibleSources = userVisibleSources.filter(
		({ source }) => source.items.length > 0 || source.status !== "error"
	);
	const [draggingSourceId, setDraggingSourceId] = useState<string | undefined>(
		undefined
	);
	const draggingSourceIdRef = useRef<string | undefined>(undefined);
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

	function pinAndAnnounce(sourceId: string) {
		const currentOrder = sourceOrderRef.current;
		const nextOrder = pinSource(currentOrder, sourceId);
		if (nextOrder.join("\u0000") === currentOrder.join("\u0000")) {
			return;
		}
		commitSourceOrder(sourceId, nextOrder);
	}

	function dragHandleProps(sourceId: string): SourceDragHandleProps {
		const finishPointerDrag = (
			event: ReactPointerEvent<HTMLButtonElement>,
			commit: boolean
		) => {
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
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
				event.currentTarget.setPointerCapture(event.pointerId);
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
					height: Math.min(rect.height, 44),
					homeUrl: source?.homeUrl,
					left: rect.left,
					title: source?.title ?? "",
					top: rect.top,
					width: rect.width,
				});
			},
			onPointerMove: (event) => {
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
				if (overSourceId) {
					const baseOrder = pointerDragBaseOrderRef.current;
					if (!baseOrder) {
						return;
					}
					pointerDragOrderRef.current = moveSource(
						baseOrder,
						activeSourceId,
						overSourceId
					);
					if (dropTargetElementRef.current !== target) {
						dropTargetElementRef.current?.removeAttribute("data-drop-target");
						target?.setAttribute("data-drop-target", "true");
						dropTargetElementRef.current = target ?? null;
					}
				}
			},
			onPointerCancel: (event) => finishPointerDrag(event, false),
			onPointerUp: (event) => finishPointerDrag(event, true),
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
				onPinSource={pinAndAnnounce}
				pinnedSourceId={orderedSources[0]?.source.sourceId}
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
				onPinSource={pinAndAnnounce}
				pinnedSourceId={orderedSources[0]?.source.sourceId}
				settings={settings}
				sources={visibleSources}
				t={t}
				topicId={displayPage.id}
				translationPending={translationPending}
			/>
		);
	}
	return (
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
				<div className="flex flex-wrap items-center justify-between gap-2 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-1.5 text-[11px] text-[var(--text-muted)] sm:justify-end sm:gap-3">
					{displayPage.updatedAt ? (
						<span className="min-w-0 truncate" suppressHydrationWarning>
							{t("card.updated", {
								time: formatRelativeTime(displayPage.updatedAt, t),
							})}
						</span>
					) : null}
					<div className="flex items-center gap-2">
						<Link
							className="rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
							params={{ locale: localeParam }}
							search={{ topic: displayPage.id }}
							to="/{-$locale}/events"
						>
							Events
						</Link>
						<LayoutSettingsMenuContent
							hiddenSourceIds={sourcePreferences.preference.hiddenSourceIds}
							onSourceVisibilityChange={sourcePreferences.setSourceVisible}
							settings={settings}
							sources={orderedSources.map(({ source }) => ({
								id: source.sourceId,
								title: source.title,
							}))}
							storeOptions={displaySettingsStore}
							t={t}
						/>
						<DisplaySettingsMenuContent
							settings={settings}
							storeOptions={displaySettingsStore}
							t={t}
						/>
					</div>
				</div>
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
	);
}

interface SourceWithSection {
	sectionId: string;
	source: SourceCardData;
}

interface SourceDragHandleProps {
	onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
	onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

const SOURCE_SECTION_GRID =
	"grid grid-cols-1 items-stretch sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 min-[1800px]:grid-cols-8";

function SourceGridLayout({
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
	pinnedSourceId,
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
	pinnedSourceId?: string;
}) {
	return (
		<div className="grid grid-cols-1 items-start sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
			{sources.map(({ sectionId, source }) => (
				<SourceCard
					dragHandleProps={dragHandleProps(source.sourceId)}
					isDragging={draggingSourceId === source.sourceId}
					key={`${sectionId}:${source.sourceId}`}
					locale={locale}
					onHide={() => onHideSource(source.sourceId)}
					onPin={() => onPinSource(source.sourceId)}
					pinned={pinnedSourceId === source.sourceId}
					settings={settings}
					source={source}
					t={t}
					topicId={topicId}
					translationPending={translationPending}
				/>
			))}
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
	pinnedSourceId,
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
	pinnedSourceId?: string;
}) {
	return (
		<div className="bg-[var(--surface-app)]">
			{sources.map(({ sectionId, source }) => (
				<SourceSection
					dragHandleProps={dragHandleProps(source.sourceId)}
					isDragging={draggingSourceId === source.sourceId}
					key={`${sectionId}:${source.sourceId}`}
					locale={locale}
					onHide={() => onHideSource(source.sourceId)}
					onPin={() => onPinSource(source.sourceId)}
					pinned={pinnedSourceId === source.sourceId}
					settings={settings}
					source={source}
					t={t}
					topicId={topicId}
					translationPending={translationPending}
				/>
			))}
		</div>
	);
}

function SourceCard({
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
	const [open, setOpen] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const hasItems = source.items.length > 0;

	const bodyRef = useCallback((el: HTMLDivElement | null) => {
		if (!el) {
			return;
		}
		const update = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	return (
		<article
			className={`relative flex min-w-0 flex-col overflow-hidden border-[var(--border-default)] border-b bg-[var(--surface-card)] transition-opacity after:pointer-events-none after:absolute after:inset-0 after:z-40 after:content-[''] data-[drop-target=true]:after:border-2 data-[drop-target=true]:after:border-[var(--accent-blue)] sm:border-r ${sourceCardViewportClasses(hasItems)} ${isDragging ? "z-30 opacity-50 shadow-[0_0_0_2px_var(--accent-blue)]" : ""}`}
			data-sortable-source-id={source.sourceId}
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
					className="relative min-h-0 flex-1 overflow-hidden max-sm:max-h-[70svh]"
					ref={bodyRef}
				>
					<SourceCardBody
						locale={locale}
						settings={settings}
						source={source}
						t={t}
						translationPending={translationPending}
					/>
					{overflowing || source.itemsTruncated ? (
						<>
							<div
								aria-hidden
								className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--surface-card)] via-[var(--surface-card)]/85 to-transparent"
							/>
							<button
								className="absolute inset-x-0 bottom-2 mx-auto flex w-fit items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
								onClick={() => setOpen(true)}
								type="button"
							>
								{t("card.viewAll", {
									count: source.itemCount ?? source.items.length,
								})}
							</button>
						</>
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
			<SourceDialog
				locale={locale}
				onOpenChange={setOpen}
				open={open}
				settings={settings}
				source={source}
				topicId={topicId}
				translationPending={translationPending}
			/>
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
	const [open, setOpen] = useState(false);
	return (
		<section
			className={`relative border-[var(--border-default)] border-b bg-[var(--surface-card)] transition-opacity after:pointer-events-none after:absolute after:inset-0 after:z-40 after:content-[''] data-[drop-target=true]:after:border-2 data-[drop-target=true]:after:border-[var(--accent-blue)] ${isDragging ? "z-30 opacity-80 shadow-[0_0_0_2px_var(--accent-blue)]" : ""}`}
			data-sortable-source-id={source.sourceId}
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
					{source.items.map((item) => (
						<li
							className="min-w-0 border-[var(--border-default)] border-b sm:border-r sm:last:border-b"
							key={item.id}
						>
							<NewsCard
								item={item}
								locale={locale}
								settings={settings}
								translationPending={translationPending}
							/>
						</li>
					))}
				</ul>
			)}
			{source.itemsTruncated ? (
				<div className="border-[var(--border-default)] border-t px-3 py-2">
					<button
						className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
						onClick={() => setOpen(true)}
						type="button"
					>
						{t("card.viewAll", {
							count: source.itemCount ?? source.items.length,
						})}
					</button>
				</div>
			) : null}
			<SourceDialog
				locale={locale}
				onOpenChange={setOpen}
				open={open}
				settings={settings}
				source={source}
				topicId={topicId}
				translationPending={translationPending}
			/>
		</section>
	);
}

function SourceDialog({
	source,
	open,
	onOpenChange,
	settings,
	topicId,
	locale,
	translationPending,
}: {
	source: SourceCardData;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	settings: DisplaySettings;
	topicId: string;
	locale: Locale;
	translationPending: boolean;
}) {
	const sourceQuery = useQuery({
		...trendSourceQueryOptions(topicId, source.sourceId, locale),
		enabled: open && Boolean(source.itemsTruncated),
	});
	const dialogSource = sourceQuery.data ?? source;
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<SourceFavicon homeUrl={dialogSource.homeUrl} />
					<DialogTitle>{dialogSource.title}</DialogTitle>
				</DialogHeader>
				<ScrollArea className="min-h-0 flex-1 overflow-hidden">
					<ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
						{dialogSource.items.map((item) => (
							<li key={item.id}>
								<NewsRow
									item={item}
									locale={locale}
									settings={settings}
									translationPending={
										translationPending || sourceQuery.isFetching
									}
								/>
							</li>
						))}
					</ul>
				</ScrollArea>
			</DialogContent>
		</Dialog>
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
				<h3 className="truncate font-semibold text-[13px] text-[var(--text-heading)] tracking-tight">
					{source.title}
				</h3>
				<StatusDot status={source.status} t={t} />
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
				<h2 className="min-w-0 truncate font-semibold text-[15px] text-[var(--text-heading)] tracking-tight">
					{source.title}
				</h2>
				<StatusDot status={source.status} t={t} />
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
					className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] data-[popup-open]:bg-[var(--state-hover-subtle)] data-[popup-open]:text-[var(--text-primary)]"
				>
					<MoreHorizontal className="size-3" />
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
					<DropdownMenuItem disabled={pinned} onClick={onPin}>
						<Pin aria-hidden className="size-3.5" />
						{t("card.pinSource")}
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
			onPointerCancel={dragHandleProps.onPointerCancel}
			onPointerDown={dragHandleProps.onPointerDown}
			onPointerMove={dragHandleProps.onPointerMove}
			onPointerUp={dragHandleProps.onPointerUp}
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

	return (
		<ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
			{source.items.map((item) => (
				<li key={item.id}>
					<NewsRow
						item={item}
						locale={locale}
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

function NewsRow({
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
	const showCover =
		settings.showCover &&
		Boolean(item.imageUrl) &&
		!isDecorativeBadgeImage(item.imageUrl);
	const showDescription = settings.showDescription && Boolean(item.description);

	return (
		<a
			className="group relative flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-[var(--state-hover-subtle)] sm:gap-3 sm:py-2"
			href={item.url}
			rel="noopener noreferrer"
			target="_blank"
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
					<span className="line-clamp-3 min-w-0 flex-1 font-medium text-[13px] text-[var(--text-primary)] leading-[1.45] group-hover:text-[var(--accent-blue)] sm:line-clamp-2">
						{item.title}
					</span>
					<TitleTranslationIndicator
						item={item}
						locale={locale}
						pending={translationPending}
						t={t}
					/>
				</span>
				{showDescription ? (
					<span className="line-clamp-2 text-[12px] text-[var(--text-secondary)] leading-[1.45]">
						{item.description}
					</span>
				) : null}
				<NewsItemMeta item={item} meta={meta} t={t} />
			</span>
			<ArrowUpRight className="mt-[3px] hidden size-3 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 sm:block" />
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
	const showCover =
		settings.showCover &&
		Boolean(item.imageUrl) &&
		!isDecorativeBadgeImage(item.imageUrl);
	const showDescription = settings.showDescription && Boolean(item.description);

	return (
		<a
			className="group flex h-full min-h-[148px] flex-col bg-[var(--surface-card)] transition-colors hover:bg-[var(--state-hover-subtle)] sm:min-h-[168px]"
			href={item.url}
			rel="noopener noreferrer"
			target="_blank"
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
					<span className="line-clamp-3 min-w-0 flex-1 font-medium text-[13px] text-[var(--text-primary)] leading-[1.45] group-hover:text-[var(--accent-blue)]">
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

function StatusDot({ status, t }: { status: SourceStatus; t: Translator }) {
	let colorVar = "var(--accent-red)";
	let label = t("card.statusFailed");
	if (status === "ok") {
		colorVar = "var(--accent-green)";
		label = t("card.statusLive");
	} else if (status === "stale") {
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
