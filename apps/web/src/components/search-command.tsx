import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@opentrends/ui/components/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { loadSourcesStatus } from "@/components/trends/load-sources";
import { revealSourceCard } from "@/components/trends/reveal-source-card";
import { SourceFavicon } from "@/components/trends/source-favicon";
import type { SourceStatusEntry } from "@/components/trends/sources-types";
import type { TrendsPageData } from "@/components/trends/types";
import {
	localePathParam,
	type TranslationKey,
	useLocale,
	useT,
} from "@/lib/i18n";

const MAX_SOURCE_RESULTS = 8;
const MAX_HEADLINE_RESULTS = 30;
const MIN_QUERY_LENGTH = 1;
const FEATURED_TOPIC = "featured";

// A source's own field is the better destination; the featured tab is only
// used when it is the source's only home.
function navigableTopics(entry: SourceStatusEntry): string[] {
	const specific = entry.topics.filter((topic) => topic !== FEATURED_TOPIC);
	return specific.length > 0 ? specific : entry.topics;
}

interface SourceHit {
	entry: SourceStatusEntry;
	kind: "source";
}

interface HeadlineHit {
	kind: "headline";
	originalTitle?: string;
	sourceHomeUrl?: string;
	sourceTitle: string;
	title: string;
	topicId: string;
	url: string;
}

type Hit = SourceHit | HeadlineHit;

function normalize(value: string): string {
	return value.toLowerCase().trim();
}

function matches(haystack: string | undefined, needle: string): boolean {
	return Boolean(haystack && normalize(haystack).includes(needle));
}

// Headlines come from whatever topic pages React Query already holds, so the
// search costs nothing and answers instantly; it does not cover history.
function* pageItems(pages: TrendsPageData[]) {
	for (const page of pages) {
		for (const section of page.sections) {
			for (const source of section.sources) {
				for (const item of source.items) {
					yield { item, page, source };
				}
			}
		}
	}
}

function collectHeadlines(
	pages: TrendsPageData[],
	needle: string
): HeadlineHit[] {
	const hits: HeadlineHit[] = [];
	const seen = new Set<string>();
	for (const { item, page, source } of pageItems(pages)) {
		const hit =
			!seen.has(item.url) &&
			(matches(item.title, needle) || matches(item.original?.title, needle));
		if (!hit) {
			continue;
		}
		seen.add(item.url);
		hits.push({
			kind: "headline",
			originalTitle: item.original?.title,
			sourceHomeUrl: source.homeUrl,
			sourceTitle: source.title,
			title: item.title,
			topicId: page.id,
			url: item.url,
		});
		if (hits.length >= MAX_HEADLINE_RESULTS) {
			break;
		}
	}
	return hits;
}

// Looks like a search field so it reads as one; the real input lives in the
// dialog so results can take the space they need.
export function SearchTrigger({ onClick }: { onClick: () => void }) {
	const t = useT();
	return (
		<button
			aria-label={t("search.label")}
			className="inline-flex h-7 items-center gap-2 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-[12px] text-[var(--text-muted)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-secondary)] xl:w-52"
			onClick={onClick}
			title={`${t("search.label")} (${t("search.shortcut")})`}
			type="button"
		>
			<Search aria-hidden className="size-3.5 shrink-0" />
			<span className="hidden min-w-0 flex-1 truncate text-left xl:inline">
				{t("search.placeholder")}
			</span>
			<kbd className="hidden rounded border border-[var(--border-default)] px-1 font-mono text-[10px] leading-4 xl:inline">
				{t("search.shortcut")}
			</kbd>
		</button>
	);
}

interface SearchCommandProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

export function SearchCommand({ onOpenChange, open }: SearchCommandProps) {
	const t = useT();
	const locale = useLocale();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				onOpenChange(!open);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpenChange, open]);

	const sources = useQuery({
		queryKey: ["sources-status"],
		queryFn: loadSourcesStatus,
		enabled: open,
		staleTime: 10 * 60_000,
	});

	const needle = normalize(query);
	const hits = useMemo<Hit[]>(() => {
		if (needle.length < MIN_QUERY_LENGTH) {
			return [];
		}
		const sourceHits: SourceHit[] = (sources.data?.sources ?? [])
			.filter(
				(entry) =>
					matches(entry.name, needle) ||
					matches(entry.sourceId, needle) ||
					matches(entry.homeUrl, needle)
			)
			.slice(0, MAX_SOURCE_RESULTS)
			.map((entry) => ({ entry, kind: "source" }));
		const pages = queryClient
			.getQueriesData<TrendsPageData>({ queryKey: ["trends-page"] })
			.map(([, data]) => data)
			.filter((data): data is TrendsPageData => Boolean(data));
		return [...sourceHits, ...collectHeadlines(pages, needle)];
	}, [needle, queryClient, sources.data]);

	// Reset the cursor whenever the result list changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: hits is the trigger
	useEffect(() => {
		setActiveIndex(0);
	}, [hits]);

	function activate(hit: Hit) {
		onOpenChange(false);
		if (hit.kind === "headline") {
			window.open(hit.url, "_blank", "noopener,noreferrer");
			return;
		}
		// Already on a page that holds the card: no navigation, no re-render.
		if (revealSourceCard(hit.entry.sourceId)) {
			return;
		}
		const topic = navigableTopics(hit.entry)[0];
		if (!topic) {
			return;
		}
		navigate({
			hash: `source-${hit.entry.sourceId}`,
			params: { locale: localePathParam(locale), topic },
			to: "/{-$locale}/trends/$topic",
		});
	}

	function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((index) => Math.min(index + 1, hits.length - 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((index) => Math.max(index - 1, 0));
		} else if (event.key === "Enter") {
			const hit = hits[activeIndex];
			if (hit) {
				event.preventDefault();
				activate(hit);
			}
		}
	}

	const sourceHits = hits.filter(
		(hit): hit is SourceHit => hit.kind === "source"
	);
	const headlineHits = hits.filter(
		(hit): hit is HeadlineHit => hit.kind === "headline"
	);

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					setQuery("");
				}
			}}
			open={open}
		>
			<DialogContent
				className="top-[12vh] w-[min(560px,92vw)] translate-y-0 max-sm:top-auto"
				showCloseButton={false}
			>
				<DialogTitle className="sr-only">{t("search.label")}</DialogTitle>
				<div className="flex items-center gap-2 border-[var(--border-default)] border-b px-3">
					<Search
						aria-hidden
						className="size-4 shrink-0 text-[var(--text-muted)]"
					/>
					<input
						aria-label={t("search.label")}
						autoComplete="off"
						autoFocus
						className="h-11 w-full bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onInputKeyDown}
						placeholder={t("search.placeholder")}
						type="text"
						value={query}
					/>
					<kbd className="hidden shrink-0 rounded border border-[var(--border-default)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] sm:inline">
						esc
					</kbd>
				</div>
				<div className="max-h-[60vh] overflow-y-auto">
					{needle.length < MIN_QUERY_LENGTH ? (
						<EmptyMessage>{t("search.hint")}</EmptyMessage>
					) : null}
					{needle.length >= MIN_QUERY_LENGTH && hits.length === 0 ? (
						<EmptyMessage>{t("search.noResults", { query })}</EmptyMessage>
					) : null}
					{hits.length > 0 ? (
						<>
							{sourceHits.length > 0 ? (
								<ResultGroup label={t("search.sources")}>
									{sourceHits.map((hit, index) => (
										<ResultRow
											active={index === activeIndex}
											key={hit.entry.sourceId}
											onActivate={() => activate(hit)}
											onHover={() => setActiveIndex(index)}
										>
											<SourceFavicon homeUrl={hit.entry.homeUrl} />
											<span className="min-w-0 flex-1 truncate font-medium text-[13px] text-[var(--text-primary)]">
												{hit.entry.name}
											</span>
											<span className="flex shrink-0 items-center gap-1">
												{navigableTopics(hit.entry).map((topic) => (
													<span
														className="rounded bg-[var(--accent-blue-bg)] px-1.5 py-0.5 text-[10px] text-[var(--accent-blue)]"
														key={topic}
													>
														{t(`topic.${topic}` as TranslationKey)}
													</span>
												))}
											</span>
										</ResultRow>
									))}
								</ResultGroup>
							) : null}
							{headlineHits.length > 0 ? (
								<ResultGroup label={t("search.headlines")}>
									{headlineHits.map((hit, index) => {
										const flatIndex = sourceHits.length + index;
										return (
											<ResultRow
												active={flatIndex === activeIndex}
												key={hit.url}
												onActivate={() => activate(hit)}
												onHover={() => setActiveIndex(flatIndex)}
											>
												<SourceFavicon homeUrl={hit.sourceHomeUrl} />
												<span className="flex min-w-0 flex-1 flex-col">
													<span className="truncate text-[13px] text-[var(--text-primary)]">
														{hit.title}
													</span>
													<span className="truncate text-[11px] text-[var(--text-muted)]">
														{hit.sourceTitle}
														{hit.originalTitle &&
														hit.originalTitle !== hit.title
															? ` · ${hit.originalTitle}`
															: ""}
													</span>
												</span>
												<ArrowUpRight
													aria-hidden
													className="size-3.5 shrink-0 text-[var(--text-muted)]"
												/>
											</ResultRow>
										);
									})}
								</ResultGroup>
							) : null}
						</>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
	return (
		<p className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
			{children}
		</p>
	);
}

function ResultGroup({
	children,
	label,
}: {
	children: React.ReactNode;
	label: string;
}) {
	return (
		<section className="py-1">
			<h3 className="px-3 py-1 font-medium text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
				{label}
			</h3>
			<ul>{children}</ul>
		</section>
	);
}

function ResultRow({
	active,
	children,
	onActivate,
	onHover,
}: {
	active: boolean;
	children: React.ReactNode;
	onActivate: () => void;
	onHover: () => void;
}) {
	return (
		<li>
			<button
				className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${active ? "bg-[var(--state-hover-subtle)]" : ""}`}
				onClick={onActivate}
				onMouseEnter={onHover}
				type="button"
			>
				{children}
			</button>
		</li>
	);
}
