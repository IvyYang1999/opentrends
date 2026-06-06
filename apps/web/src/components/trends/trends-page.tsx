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
	Languages,
	MoreHorizontal,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
	type Locale,
	localePathParam,
	type Translator,
	useLocale,
	useT,
} from "@/lib/i18n";

import {
	type DisplaySettings,
	type DisplaySettingsStoreOptions,
	useDisplaySettings,
} from "./display-settings";
import {
	DisplaySettingsMenuContent,
	LayoutSettingsMenuContent,
} from "./display-settings-menu";
import { translateTrendsPageSnapshot } from "./load-trends";
import { formatRelativeTime } from "./relative-time";
import { SourceFavicon } from "./source-favicon";
import { trendSourceQueryOptions } from "./trends-query";
import { TrendsSummary } from "./trends-summary";
import type {
	NewsItem,
	SourceCardData,
	SourceStatus,
	TrendsPageData,
} from "./types";

const CJK_RE = /[\u3400-\u9fff]/;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;

interface TrendsPageProps {
	displaySettingsStore?: DisplaySettingsStoreOptions;
	page: TrendsPageData;
}

function proxiedImageUrl(imageUrl: string): string {
	return `${env.VITE_SERVER_URL}/api/image?url=${encodeURIComponent(imageUrl)}`;
}

export function TrendsPage({ displaySettingsStore, page }: TrendsPageProps) {
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const t = useT();
	const [displayPage, setDisplayPage] = useState(page);
	const translationRequestKeyRef = useRef<string | null>(null);
	const settings = useDisplaySettings(displaySettingsStore);
	const translationRef = useCallback(
		(el: HTMLDivElement | null) => {
			if (!el) {
				return;
			}
			const requestKey = `${page.id}:${page.updatedAt}:${locale}`;
			if (
				translationRequestKeyRef.current === requestKey ||
				!needsTranslationWarmup(displayPage, locale)
			) {
				return;
			}

			translationRequestKeyRef.current = requestKey;
			let cancelled = false;
			translateTrendsPageSnapshot(displayPage, locale)
				.then((translatedPage) => {
					if (!cancelled) {
						if (needsTranslationWarmup(translatedPage, locale)) {
							translationRequestKeyRef.current = null;
						}
						setDisplayPage({
							...translatedPage,
							updatedAt: page.updatedAt,
						});
					}
				})
				.catch(() => {
					if (!cancelled) {
						translationRequestKeyRef.current = null;
					}
					/* The original page is already rendered. */
				});

			return () => {
				cancelled = true;
			};
		},
		[displayPage, locale, page.id, page.updatedAt]
	);
	const sources = displayPage.sections.flatMap((section) =>
		section.sources.map((source) => ({
			sectionId: section.id,
			source,
		}))
	);
	return (
		<ScrollArea className="min-w-0 flex-1 overflow-hidden bg-[var(--surface-app)] text-[var(--text-primary)]">
			<div ref={translationRef}>
				<TrendsSummary
					key={displayPage.id}
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
							settings={settings}
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
				{settings.layout === "sourceSections" ? (
					<SourceSectionsLayout
						locale={locale}
						settings={settings}
						sources={sources}
						t={t}
						topicId={displayPage.id}
					/>
				) : (
					<SourceGridLayout
						locale={locale}
						settings={settings}
						sources={sources}
						t={t}
						topicId={displayPage.id}
					/>
				)}
			</div>
		</ScrollArea>
	);
}

function needsTranslationWarmup(page: TrendsPageData, locale: Locale): boolean {
	for (const section of page.sections) {
		for (const source of section.sources) {
			for (const item of source.items) {
				if (item.original) {
					continue;
				}
				if (shouldTranslateItem(item, locale)) {
					return true;
				}
			}
		}
	}
	return false;
}

function hasCjk(value: string | undefined): boolean {
	return value ? CJK_RE.test(value) : false;
}

function hasCyrillic(value: string | undefined): boolean {
	return value ? CYRILLIC_RE.test(value) : false;
}

function shouldTranslateItem(item: NewsItem, locale: Locale): boolean {
	return (
		shouldTranslateText(item.title, locale) ||
		shouldTranslateText(item.description, locale)
	);
}

function shouldTranslateText(
	value: string | undefined,
	locale: Locale
): boolean {
	if (!value?.trim()) {
		return false;
	}
	if (locale === "zh") {
		return !hasCjk(value);
	}
	if (locale === "zh-Hant") {
		return true;
	}
	if (locale === "ru") {
		return !hasCyrillic(value);
	}
	if (
		locale === "fr-FR" ||
		locale === "es-ES" ||
		locale === "de-DE" ||
		locale === "pt-BR"
	) {
		return true;
	}
	return hasCjk(value) || hasCyrillic(value);
}

interface SourceWithSection {
	sectionId: string;
	source: SourceCardData;
}

const SOURCE_CARD_HEIGHT = "h-[480px]";
const SOURCE_SECTION_GRID =
	"grid grid-cols-1 items-stretch sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 min-[1800px]:grid-cols-8";

function SourceGridLayout({
	sources,
	settings,
	t,
	topicId,
	locale,
}: {
	sources: SourceWithSection[];
	settings: DisplaySettings;
	t: Translator;
	topicId: string;
	locale: Locale;
}) {
	return (
		<div className="grid grid-cols-1 items-start sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
			{sources.map(({ sectionId, source }) => (
				<SourceCard
					key={`${sectionId}:${source.sourceId}`}
					locale={locale}
					settings={settings}
					source={source}
					t={t}
					topicId={topicId}
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
}: {
	sources: SourceWithSection[];
	settings: DisplaySettings;
	t: Translator;
	topicId: string;
	locale: Locale;
}) {
	return (
		<div className="bg-[var(--surface-app)]">
			{sources.map(({ sectionId, source }) => (
				<SourceSection
					key={`${sectionId}:${source.sourceId}`}
					locale={locale}
					settings={settings}
					source={source}
					t={t}
					topicId={topicId}
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
}: {
	source: SourceCardData;
	settings: DisplaySettings;
	t: Translator;
	topicId: string;
	locale: Locale;
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
			className={`flex min-w-0 flex-col overflow-hidden border-[var(--border-default)] border-b bg-[var(--surface-card)] sm:border-r ${hasItems ? `${SOURCE_CARD_HEIGHT} max-sm:h-auto max-sm:max-h-none` : "h-auto"}`}
		>
			<SourceCardHeader source={source} t={t} />
			{hasItems ? (
				<div
					className="relative min-h-0 flex-1 overflow-hidden max-sm:max-h-[70svh]"
					ref={bodyRef}
				>
					<SourceCardBody settings={settings} source={source} t={t} />
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
				<SourceCardBody settings={settings} source={source} t={t} />
			)}
			<SourceDialog
				locale={locale}
				onOpenChange={setOpen}
				open={open}
				settings={settings}
				source={source}
				topicId={topicId}
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
}: {
	source: SourceCardData;
	settings: DisplaySettings;
	t: Translator;
	topicId: string;
	locale: Locale;
}) {
	const [open, setOpen] = useState(false);
	return (
		<section className="border-[var(--border-default)] border-b bg-[var(--surface-card)]">
			<SourceSectionHeader source={source} t={t} />
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
							<NewsCard item={item} settings={settings} />
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
}: {
	source: SourceCardData;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	settings: DisplaySettings;
	topicId: string;
	locale: Locale;
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
								<NewsRow item={item} settings={settings} />
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
}: {
	source: SourceCardData;
	t: Translator;
}) {
	return (
		<div className="flex items-start justify-between gap-3 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2 sm:items-baseline">
			<div className="flex min-w-0 items-center gap-2">
				<SourceFavicon homeUrl={source.homeUrl} />
				<h3 className="truncate font-semibold text-[13px] text-[var(--text-heading)] tracking-tight">
					{source.title}
				</h3>
				<StatusDot status={source.status} t={t} />
			</div>
			<SourceHeaderMeta source={source} t={t} />
		</div>
	);
}

function SourceSectionHeader({
	source,
	t,
}: {
	source: SourceCardData;
	t: Translator;
}) {
	return (
		<div className="sticky top-0 z-20 flex flex-col gap-2 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
			<div className="flex min-w-0 items-center gap-2">
				<SourceFavicon homeUrl={source.homeUrl} />
				<h2 className="min-w-0 truncate font-semibold text-[15px] text-[var(--text-heading)] tracking-tight">
					{source.title}
				</h2>
				<StatusDot status={source.status} t={t} />
			</div>
			<SourceHeaderMeta itemCount={source.items.length} source={source} t={t} />
		</div>
	);
}

function SourceHeaderMeta({
	source,
	t,
	itemCount,
}: {
	source: SourceCardData;
	t: Translator;
	itemCount?: number;
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
			{source.homeUrl ? (
				<DropdownMenu>
					<DropdownMenuTrigger
						aria-label={t("card.actionsFor", { title: source.title })}
						className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] data-[popup-open]:bg-[var(--state-hover-subtle)] data-[popup-open]:text-[var(--text-primary)]"
					>
						<MoreHorizontal className="size-3" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="bg-card">
						<DropdownMenuItem
							render={
								<a
									href={source.homeUrl}
									rel="noopener noreferrer"
									target="_blank"
								>
									{t("card.openHome")}
								</a>
							}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}

function SourceCardBody({
	source,
	settings,
	t,
}: {
	source: SourceCardData;
	settings: DisplaySettings;
	t: Translator;
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
					<NewsRow item={item} settings={settings} />
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
				<span>{source.errorMessage ?? t("card.unavailable")}</span>
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
}: {
	item: NewsItem;
	settings: DisplaySettings;
}) {
	const t = useT();
	const meta = buildMeta(item, settings, t);
	const showCover = settings.showCover && Boolean(item.imageUrl);
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
				<img
					alt=""
					className="mt-[2px] size-10 shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-sidebar)] object-cover sm:size-12"
					height={48}
					loading="lazy"
					src={proxiedImageUrl(item.imageUrl as string)}
					width={48}
				/>
			) : null}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-start gap-1.5">
					<span className="line-clamp-3 min-w-0 flex-1 font-medium text-[13px] text-[var(--text-primary)] leading-[1.45] group-hover:text-[var(--accent-blue)] sm:line-clamp-2">
						{item.title}
					</span>
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
}: {
	item: NewsItem;
	settings: DisplaySettings;
}) {
	const t = useT();
	const meta = buildMeta(item, settings, t);
	const showCover = settings.showCover && Boolean(item.imageUrl);
	const showDescription = settings.showDescription && Boolean(item.description);

	return (
		<a
			className="group flex h-full min-h-[148px] flex-col bg-[var(--surface-card)] transition-colors hover:bg-[var(--state-hover-subtle)] sm:min-h-[168px]"
			href={item.url}
			rel="noopener noreferrer"
			target="_blank"
		>
			{showCover ? (
				<img
					alt=""
					className="aspect-[16/9] w-full border-[var(--border-subtle)] border-b bg-[var(--surface-sidebar)] object-cover"
					height={180}
					loading="lazy"
					src={proxiedImageUrl(item.imageUrl as string)}
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
