import { env } from "@opentrends/env/web";
import { Share2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import { type Locale, type Translator, useLocale, useT } from "@/lib/i18n";

import {
	CitationLinkPopover,
	type CitationMeta,
	type CitationMetaMap,
} from "./citation-link-popover";
import { parseDigest } from "./share-image";
import { SourceLogoStack, type SourceLogoStackItem } from "./source-favicon";
import { SummaryShareDialog } from "./summary-share-dialog";
import type { TrendsPageData } from "./types";

interface TrendsSummaryProps {
	page: TrendsPageData;
	topicId: string;
}

type SummaryStatus = "loading" | "streaming" | "done" | "unavailable" | "error";

const SUMMARY_WINDOWS = ["today", "week", "month"] as const;
type SummaryWindow = (typeof SUMMARY_WINDOWS)[number];

const SUMMARY_WINDOW_LABELS = {
	today: "summary.windowToday",
	week: "summary.windowWeek",
	month: "summary.windowMonth",
} as const;

type CitationMap = ReadonlyMap<number, string>;

interface StreamHandlers {
	isCancelled: () => boolean;
	onChunk: (full: string) => void;
	onCitations: (citations: CitationMap) => void;
	onDone: () => void;
	onError: (message: string) => void;
	onStreamingStart: () => void;
	onUnavailable: () => void;
	signal: AbortSignal;
}

const CITATIONS_HEADER = "X-Trends-Citations";
const CITATION_RE = /\[(\d+)\]/g;

function parseCitationsHeader(value: string | null): CitationMap {
	if (!value) {
		return new Map();
	}
	try {
		const decoded = decodeURIComponent(value);
		const parsed: unknown = JSON.parse(decoded);
		if (!Array.isArray(parsed)) {
			return new Map();
		}
		const map = new Map<number, string>();
		for (const entry of parsed) {
			if (
				entry &&
				typeof entry === "object" &&
				typeof (entry as { n?: unknown }).n === "number" &&
				typeof (entry as { url?: unknown }).url === "string"
			) {
				map.set((entry as { n: number }).n, (entry as { url: string }).url);
			}
		}
		return map;
	} catch {
		return new Map();
	}
}

function linkifyCitations(text: string, citations: CitationMap): string {
	if (citations.size === 0) {
		return text;
	}
	return text.replace(CITATION_RE, (match, raw) => {
		const n = Number.parseInt(raw, 10);
		const url = citations.get(n);
		return url ? `[<sup>${n}</sup>](${url})` : match;
	});
}

function isAbort(err: unknown): boolean {
	return err instanceof DOMException && err.name === "AbortError";
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function readStream(
	body: ReadableStream<Uint8Array>,
	handlers: StreamHandlers
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (!handlers.isCancelled()) {
		const { done, value } = await reader.read();
		if (done) {
			return;
		}
		buffer += decoder.decode(value, { stream: true });
		if (!handlers.isCancelled()) {
			handlers.onChunk(buffer);
		}
	}
}

async function streamSummary(
	topicId: string,
	locale: Locale,
	summaryWindow: SummaryWindow,
	handlers: StreamHandlers
): Promise<void> {
	const search = new URLSearchParams({ lang: locale, _: String(Date.now()) });
	if (summaryWindow !== "today") {
		search.set("window", summaryWindow);
	}
	const url = `${env.VITE_SERVER_URL}/api/trends/${encodeURIComponent(topicId)}/summary?${search}`;
	try {
		const response = await fetch(url, {
			cache: "no-store",
			credentials: "omit",
			signal: handlers.signal,
		});

		if (response.status === 503) {
			if (!handlers.isCancelled()) {
				handlers.onUnavailable();
			}
			return;
		}

		if (!(response.ok && response.body)) {
			throw new Error(`Failed to load summary (${response.status})`);
		}

		if (handlers.isCancelled()) {
			return;
		}
		const citations = parseCitationsHeader(
			response.headers.get(CITATIONS_HEADER)
		);
		handlers.onCitations(citations);
		handlers.onStreamingStart();
		await readStream(response.body, handlers);
		if (!handlers.isCancelled()) {
			handlers.onDone();
		}
	} catch (err) {
		if (handlers.isCancelled() || isAbort(err)) {
			return;
		}
		handlers.onError(describe(err));
	}
}

function buildMetadataMap(page: TrendsPageData): CitationMetaMap {
	const map = new Map<string, CitationMeta>();
	for (const section of page.sections) {
		for (const source of section.sources) {
			for (const item of source.items) {
				if (!item.url || map.has(item.url)) {
					continue;
				}
				map.set(item.url, {
					title: item.title,
					description: item.description,
					sourceTitle: source.title,
					homeUrl: source.homeUrl,
				});
			}
		}
	}
	return map;
}

interface SummaryStats {
	items: number;
	logoSources: SourceLogoStackItem[];
	sources: number;
}

function computeSummaryStats(page: TrendsPageData): SummaryStats {
	const sourceIds = new Set<string>();
	const logoSources: SourceLogoStackItem[] = [];
	let items = 0;
	for (const section of page.sections) {
		for (const source of section.sources) {
			if (!sourceIds.has(source.sourceId)) {
				sourceIds.add(source.sourceId);
				logoSources.push({
					homeUrl: source.homeUrl,
					id: source.sourceId,
					label: source.title,
				});
			}
			items += source.items.length;
		}
	}
	return { sources: sourceIds.size, items, logoSources };
}

interface SummaryBodyProps {
	citations: CitationMap;
	error: string | null;
	metadata: CitationMetaMap;
	status: SummaryStatus;
	t: Translator;
	text: string;
}

function SummaryBody({
	citations,
	error,
	metadata,
	status,
	t,
	text,
}: SummaryBodyProps) {
	const linkified = useMemo(
		() => linkifyCitations(text, citations),
		[text, citations]
	);
	// Hover-driven citation popover. Streamdown's `linkSafety` only fires on
	// click, so we drive the preview ourselves: pointer enters a chip → open;
	// pointer leaves the chip and the popup → close (with a small grace period
	// so the user can move the cursor between the two).
	const [hoverState, setHoverState] = useState<{
		anchor: HTMLElement;
		url: string;
	} | null>(null);
	const closeTimerRef = useRef<number | null>(null);

	const cancelClose = useCallback(() => {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}, []);
	const scheduleClose = useCallback(() => {
		cancelClose();
		closeTimerRef.current = window.setTimeout(() => {
			setHoverState(null);
			closeTimerRef.current = null;
		}, 150);
	}, [cancelClose]);

	const handlePointerOver = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}
			const button = target.closest<HTMLElement>('[data-streamdown="link"]');
			if (!button) {
				return;
			}
			const n = Number.parseInt(button.textContent ?? "", 10);
			if (!Number.isFinite(n)) {
				return;
			}
			const url = citations.get(n);
			if (!url) {
				return;
			}
			cancelClose();
			setHoverState((prev) =>
				prev?.anchor === button && prev.url === url
					? prev
					: { anchor: button, url }
			);
		},
		[citations, cancelClose]
	);

	const handlePointerOut = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const related = event.relatedTarget;
			if (
				related instanceof Element &&
				related.closest("[data-citation-popover-popup]")
			) {
				return;
			}
			scheduleClose();
		},
		[scheduleClose]
	);

	if (status === "error") {
		return (
			<p className="text-[12px] text-[var(--accent-red)]">
				{t("summary.error")}
				{error ? `: ${error}` : "."}
			</p>
		);
	}
	if (text) {
		return (
			<>
				<div
					className="text-[13px] text-[var(--text-primary)] leading-[1.55] [&_[data-streamdown=link]:hover_sup]:bg-[var(--accent-blue)] [&_[data-streamdown=link]:hover_sup]:text-white [&_[data-streamdown=link]]:cursor-pointer [&_[data-streamdown=link]]:font-normal [&_[data-streamdown=link]]:no-underline [&_sup]:mx-[2px] [&_sup]:inline-flex [&_sup]:h-[1.125rem] [&_sup]:min-w-[1.125rem] [&_sup]:items-center [&_sup]:justify-center [&_sup]:rounded-[4px] [&_sup]:bg-[var(--accent-blue-bg)] [&_sup]:px-[5px] [&_sup]:font-medium [&_sup]:text-[10px] [&_sup]:text-[var(--accent-blue)] [&_sup]:leading-none [&_sup]:transition-colors"
					data-testid="trends-summary-body"
					onPointerOut={handlePointerOut}
					onPointerOver={handlePointerOver}
				>
					<Streamdown
						linkSafety={{
							enabled: true,
							// Click goes straight to the source; the popover is hover-driven.
							onLinkCheck: () => true,
							// Stops Streamdown's default safety modal from rendering.
							renderModal: () => null,
						}}
					>
						{linkified}
					</Streamdown>
				</div>
				{hoverState ? (
					<CitationLinkPopover
						anchor={hoverState.anchor}
						metadata={metadata}
						onPointerEnter={cancelClose}
						onPointerLeave={scheduleClose}
						url={hoverState.url}
					/>
				) : null}
			</>
		);
	}
	if (status === "loading" || status === "streaming") {
		return (
			<p className="text-[13px] text-[var(--text-secondary)]">
				{t("summary.reading")}
			</p>
		);
	}
	return null;
}

const EMPTY_CITATIONS: CitationMap = new Map();

export function TrendsSummary({ page, topicId }: TrendsSummaryProps) {
	const locale = useLocale();
	const t = useT();
	const [text, setText] = useState("");
	const [status, setStatus] = useState<SummaryStatus>("loading");
	const [error, setError] = useState<string | null>(null);
	const [citations, setCitations] = useState<CitationMap>(EMPTY_CITATIONS);
	const [summaryWindow, setSummaryWindow] = useState<SummaryWindow>("today");
	const metadata = useMemo(() => buildMetadataMap(page), [page]);
	const stats = useMemo(() => computeSummaryStats(page), [page]);
	const [shareOpen, setShareOpen] = useState(false);
	// Sharing is offered once the whole digest has arrived, so the image never
	// shows a half-written entry.
	const digestEntries = useMemo(
		() => (status === "done" ? parseDigest(text) : []),
		[status, text]
	);

	const containerRef = useCallback(
		(el: HTMLDivElement | null) => {
			if (!el) {
				return;
			}

			const controller = new AbortController();
			let cancelled = false;

			setText("");
			setError(null);
			setStatus("loading");
			setCitations(EMPTY_CITATIONS);

			streamSummary(topicId, locale, summaryWindow, {
				signal: controller.signal,
				isCancelled: () => cancelled,
				onStreamingStart: () => setStatus("streaming"),
				onChunk: (full) => {
					if (full.trim()) {
						setText(full);
					}
				},
				onCitations: (next) => setCitations(next),
				onUnavailable: () => setStatus("unavailable"),
				onDone: () => setStatus("done"),
				onError: (message) => {
					setStatus("error");
					setError(message);
				},
			}).catch(() => {
				// streamSummary already converts errors into onError calls;
				// this catch only keeps the floating promise from being unhandled.
			});

			return () => {
				cancelled = true;
				controller.abort();
			};
		},
		[topicId, locale, summaryWindow]
	);

	if (status === "unavailable") {
		return null;
	}

	return (
		<div
			className="border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-3 sm:px-4"
			ref={containerRef}
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
						<span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">
							<span>{t("summary.synthesizedFrom")}</span>
							<span className="inline-flex items-center gap-1.5">
								<span className="font-semibold text-[var(--text-primary)]">
									{stats.sources}
								</span>
								<span>{t("summary.sources")}</span>
								<SourceLogoStack
									limit={5}
									showRemaining={false}
									size="sm"
									sources={stats.logoSources}
								/>
							</span>
							<span>·</span>
							<span className="font-semibold text-[var(--text-primary)]">
								{stats.items}
							</span>
							<span>{t("summary.items")}</span>
						</span>
						{status === "loading" || status === "streaming" ? (
							<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
								<span
									aria-hidden
									className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--accent-blue)]"
								/>
								{status === "loading"
									? t("summary.thinking")
									: t("summary.writing")}
							</span>
						) : null}
						<fieldset
							aria-label={t("summary.windowLabel")}
							className="ml-auto inline-flex items-center gap-0.5"
						>
							{SUMMARY_WINDOWS.map((option) => (
								<button
									aria-pressed={option === summaryWindow}
									className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] aria-pressed:bg-[var(--accent-blue-bg)] aria-pressed:text-[var(--accent-blue)]"
									key={option}
									onClick={() => setSummaryWindow(option)}
									type="button"
								>
									{t(SUMMARY_WINDOW_LABELS[option])}
								</button>
							))}
							{digestEntries.length > 0 ? (
								<button
									className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
									onClick={() => setShareOpen(true)}
									type="button"
								>
									<Share2 aria-hidden className="size-3" />
									{t("summary.share")}
								</button>
							) : null}
						</fieldset>
					</div>
					{shareOpen ? (
						<SummaryShareDialog
							entries={digestEntries}
							onOpenChange={setShareOpen}
							open={shareOpen}
							summaryWindow={summaryWindow}
							topicId={topicId}
							topicTitle={page.title}
						/>
					) : null}
					<SummaryBody
						citations={citations}
						error={error}
						metadata={metadata}
						status={status}
						t={t}
						text={text}
					/>
				</div>
			</div>
		</div>
	);
}
