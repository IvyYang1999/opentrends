import { env } from "@opentrends/env/web";
import { ChevronDown, ChevronUp, Share2 } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Streamdown } from "streamdown";

import { segmentClassName } from "@/components/chrome-styles";
import {
	type Locale,
	localePathParam,
	type TranslationKey,
	type Translator,
	useLocale,
	useT,
} from "@/lib/i18n";

import {
	CitationLinkPopover,
	type CitationMeta,
	type CitationMetaMap,
} from "./citation-link-popover";
import {
	countDigestLines,
	DIGEST_FOLD,
	digestLines,
	foldDigest,
	shouldExpandGeneratedSummary,
	shouldShowDigestTopicTags,
} from "./digest-fold";
import { FOLLOWED_TOPIC_ID } from "./followed-sources";
import { parseDigest } from "./share-image";
import { SourceLogoStack, type SourceLogoStackItem } from "./source-favicon";
import { SummaryShareDialog } from "./summary-share-dialog";
import type { TrendsPageData } from "./types";

interface TrendsSummaryProps {
	collapsed: boolean;
	/** A briefing narrows the followed sources to items mentioning these. */
	keywords?: readonly string[];
	onCollapsedChange: (collapsed: boolean) => void;
	page: TrendsPageData;
	/** Shown instead of the topic name, e.g. a briefing's own name. */
	title?: string;
	topicId: string;
}

type SummaryStatus =
	| "loading"
	| "pending"
	| "streaming"
	| "done"
	| "empty"
	| "unavailable"
	| "error";

const SUMMARY_WINDOWS = ["today", "week", "month"] as const;
type SummaryWindow = (typeof SUMMARY_WINDOWS)[number];

const WINDOW_HEADING_KEYS = {
	today: "share.headingToday",
	week: "share.headingWeek",
	month: "share.headingMonth",
} as const;

const SUMMARY_WINDOW_LABELS = {
	today: "summary.windowToday",
	week: "summary.windowWeek",
	month: "summary.windowMonth",
} as const;

import type { Citation, CitationMap } from "./digest-fold";

interface StreamHandlers {
	isCancelled: () => boolean;
	onChunk: (full: string) => void;
	onCitations: (citations: CitationMap) => void;
	onDone: () => void;
	onEmpty: () => void;
	onError: (message: string) => void;
	onPending: () => void;
	onStreamingStart: (origin: string | null) => void;
	onUnavailable: () => void;
	signal: AbortSignal;
}

const CITATIONS_HEADER = "X-Trends-Citations";
const SUMMARY_ORIGIN_HEADER = "X-Trends-Summary-Origin";
const CITATION_RE = /\[(\d+)\]/g;
const SUMMARY_PENDING_RETRY_MS = 10_000;

const CITATION_PREAMBLE_PREFIX = '{"citations":';

const LINK_SAFETY = {
	enabled: true,
	// Click goes straight to the source; the popover is hover-driven.
	onLinkCheck: () => true,
	// Stops Streamdown's default safety modal from rendering.
	renderModal: () => null,
};

// One colour per topic for the tag in front of a featured digest line.
const TOPIC_TAG_CLASS: Record<string, string> = {
	ai: "bg-[#e3ecff] text-[#2a5bd7] dark:bg-[#1f2a4d] dark:text-[#9fb6ff]",
	biotech: "bg-[#f3e8fb] text-[#7a3cb4] dark:bg-[#33234a] dark:text-[#d2b3f5]",
	cn: "bg-[#fde8e8] text-[#c02a2a] dark:bg-[#4a2222] dark:text-[#f5a6a6]",
	embodied: "bg-[#e6f4ea] text-[#1e7a3c] dark:bg-[#1f3a28] dark:text-[#9fe0b5]",
	hardware: "bg-[#fdecdc] text-[#b4530a] dark:bg-[#4a2f1c] dark:text-[#f5c093]",
	programming:
		"bg-[#e0f4f4] text-[#0f7a7a] dark:bg-[#1c3a3a] dark:text-[#93e0e0]",
};
const DEFAULT_TAG_CLASS =
	"bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]";

function toCitationMap(parsed: unknown): CitationMap {
	const map = new Map<number, Citation>();
	if (!Array.isArray(parsed)) {
		return map;
	}
	for (const entry of parsed) {
		if (
			entry &&
			typeof entry === "object" &&
			typeof (entry as { n?: unknown }).n === "number" &&
			typeof (entry as { url?: unknown }).url === "string"
		) {
			const { n, topic, url } = entry as {
				n: number;
				topic?: unknown;
				url: string;
			};
			map.set(n, typeof topic === "string" ? { topic, url } : { url });
		}
	}
	return map;
}

function parseCitationsHeader(value: string | null): CitationMap {
	if (!value) {
		return new Map();
	}
	try {
		return toCitationMap(JSON.parse(decodeURIComponent(value)));
	} catch {
		return new Map();
	}
}

interface SummaryBody {
	citations: CitationMap | null;
	text: string;
}

// The server sends every citation as one JSON line ahead of the Markdown.
// Returns null while that line is still arriving; a body without the line
// (an older server) is all Markdown.
function splitCitationPreamble(buffer: string): SummaryBody | null {
	const body = buffer.trimStart();
	if (
		!CITATION_PREAMBLE_PREFIX.startsWith(
			body.slice(0, CITATION_PREAMBLE_PREFIX.length)
		)
	) {
		return { citations: null, text: buffer };
	}
	const newline = body.indexOf("\n");
	if (newline === -1) {
		return null;
	}
	try {
		const parsed = JSON.parse(body.slice(0, newline)) as {
			citations?: unknown;
		};
		return {
			citations: toCitationMap(parsed.citations),
			text: body.slice(newline + 1),
		};
	} catch {
		return { citations: null, text: buffer };
	}
}

function linkifyCitations(text: string, citations: CitationMap): string {
	if (citations.size === 0) {
		return text;
	}
	return text.replace(CITATION_RE, (match, raw) => {
		const n = Number.parseInt(raw, 10);
		const url = citations.get(n)?.url;
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
	let citationsSent = false;
	while (!handlers.isCancelled()) {
		const { done, value } = await reader.read();
		if (done) {
			return;
		}
		buffer += decoder.decode(value, { stream: true });
		const summary = splitCitationPreamble(buffer);
		if (!summary || handlers.isCancelled()) {
			continue;
		}
		if (summary.citations && !citationsSent) {
			citationsSent = true;
			handlers.onCitations(summary.citations);
		}
		handlers.onChunk(summary.text);
	}
}

// 503, 202 and 204 carry no digest; each maps to one handler.
function settleWithoutBody(status: number, handlers: StreamHandlers): boolean {
	const settle = {
		202: handlers.onPending,
		204: handlers.onEmpty,
		503: handlers.onUnavailable,
	}[status];
	if (!settle) {
		return false;
	}
	if (!handlers.isCancelled()) {
		settle();
	}
	return true;
}

async function streamSummary(
	topicId: string,
	locale: Locale,
	summaryWindow: SummaryWindow,
	requestVersion: number,
	sourceIds: readonly string[] | undefined,
	keywords: readonly string[] | undefined,
	handlers: StreamHandlers
): Promise<void> {
	const search = new URLSearchParams({
		citations: "body",
		lang: locale,
		_: String(requestVersion),
	});
	if (summaryWindow !== "today") {
		search.set("window", summaryWindow);
	}
	if (sourceIds) {
		search.set("sources", sourceIds.join(","));
	}
	if (keywords && keywords.length > 0) {
		search.set("keywords", keywords.join(","));
	}
	const url = `${env.VITE_SERVER_URL}/api/trends/${encodeURIComponent(topicId)}/summary?${search}`;
	try {
		const response = await fetch(url, {
			cache: "no-store",
			credentials: "omit",
			signal: handlers.signal,
		});

		if (settleWithoutBody(response.status, handlers)) {
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
		handlers.onStreamingStart(response.headers.get(SUMMARY_ORIGIN_HEADER));
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
	/** Changes with the topic, window and list: every Markdown renderer
	 * below is keyed by it, so a renderer never carries one digest's
	 * parsed blocks into another's text. */
	contentKey: string;
	error: string | null;
	expanded: boolean;
	metadata: CitationMetaMap;
	onExpandedChange: (expanded: boolean) => void;
	showTopicTags: boolean;
	status: SummaryStatus;
	t: Translator;
	text: string;
	topicHref: (topicId: string) => string;
}

// The states that show one line instead of a digest.
function summaryNotice(
	status: SummaryStatus,
	error: string | null,
	t: Translator
): ReactNode {
	if (status === "empty") {
		return (
			<p className="text-[13px] text-[var(--text-secondary)]">
				{t("summary.noMatches")}
			</p>
		);
	}
	if (status === "error") {
		return (
			<p className="text-[12px] text-[var(--accent-red)]">
				{t("summary.error")}
				{error ? `: ${error}` : "."}
			</p>
		);
	}
	return null;
}

function SummaryBody({
	citations,
	contentKey,
	error,
	expanded,
	metadata,
	onExpandedChange,
	status,
	showTopicTags,
	t,
	text,
	topicHref,
}: SummaryBodyProps) {
	const total = countDigestLines(text);
	const foldable = status === "done" && total > DIGEST_FOLD;
	const shown = foldable && !expanded ? foldDigest(text, DIGEST_FOLD) : text;
	const linkified = useMemo(
		() => linkifyCitations(shown, citations),
		[shown, citations]
	);
	// Once the digest is complete it is laid out line by line, so each entry
	// can carry a topic tag in front of its text; while streaming, the whole
	// Markdown goes through one renderer.
	const lines = useMemo(
		() => (status === "done" ? digestLines(shown, citations) : null),
		[status, shown, citations]
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
	const measureRef = useCallback(
		(el: HTMLDivElement | null) => {
			if (el && status === "done") {
				lastDigestHeight = el.offsetHeight;
			}
		},
		[status]
	);

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
			const url = citations.get(n)?.url;
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

	const notice = summaryNotice(status, error, t);
	if (notice) {
		return notice;
	}
	if (text) {
		return (
			<div ref={measureRef}>
				<div
					className="text-[13px] text-[var(--text-primary)] leading-[1.55] [&_[data-streamdown=link]:hover_sup]:bg-[var(--accent-blue)] [&_[data-streamdown=link]:hover_sup]:text-white [&_[data-streamdown=link]]:cursor-pointer [&_[data-streamdown=link]]:font-normal [&_[data-streamdown=link]]:no-underline [&_sup]:mx-[2px] [&_sup]:inline-flex [&_sup]:h-[1.125rem] [&_sup]:min-w-[1.125rem] [&_sup]:items-center [&_sup]:justify-center [&_sup]:rounded-[4px] [&_sup]:bg-[var(--accent-blue-bg)] [&_sup]:px-[5px] [&_sup]:align-[-4px] [&_sup]:font-medium [&_sup]:text-[10px] [&_sup]:text-[var(--accent-blue)] [&_sup]:leading-none [&_sup]:transition-colors"
					data-testid="trends-summary-body"
					onPointerOut={handlePointerOut}
					onPointerOver={handlePointerOver}
				>
					{lines ? (
						<ol className="space-y-1">
							{lines.map((line, index) =>
								line.kind === "entry" ? (
									<li className="flex gap-2" key={`${contentKey}:${line.n}`}>
										<span className="w-4 shrink-0 text-right text-[var(--text-muted)] tabular-nums">
											{line.n}.
										</span>
										<span className="min-w-0 flex-1 [&>div]:inline [&_p]:inline">
											{showTopicTags && line.topic ? (
												<a
													className={`mr-1.5 inline-block rounded-[4px] px-1.5 align-[1px] font-medium text-[10px] leading-[1.6] no-underline ${TOPIC_TAG_CLASS[line.topic] ?? DEFAULT_TAG_CLASS}`}
													href={topicHref(line.topic)}
												>
													{t(`topic.${line.topic}` as TranslationKey)}
												</a>
											) : null}
											<Streamdown linkSafety={LINK_SAFETY}>
												{linkifyCitations(line.body, citations)}
											</Streamdown>
										</span>
									</li>
								) : (
									// biome-ignore lint/suspicious/noArrayIndexKey: prose lines have no id
									<li className="list-none" key={`${contentKey}:text:${index}`}>
										<Streamdown linkSafety={LINK_SAFETY}>
											{line.text}
										</Streamdown>
									</li>
								)
							)}
						</ol>
					) : (
						<Streamdown key={contentKey} linkSafety={LINK_SAFETY}>
							{linkified}
						</Streamdown>
					)}
				</div>
				{foldable ? (
					<button
						className="mt-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
						onClick={() => onExpandedChange(!expanded)}
						type="button"
					>
						{expanded
							? t("summary.showLess")
							: t("summary.showRest", { count: total - DIGEST_FOLD })}
					</button>
				) : null}
				{status === "streaming" ? (
					<DigestSkeleton rows={DIGEST_FOLD - total} />
				) : null}
				{hoverState ? (
					<CitationLinkPopover
						anchor={hoverState.anchor}
						metadata={metadata}
						onPointerEnter={cancelClose}
						onPointerLeave={scheduleClose}
						url={hoverState.url}
					/>
				) : null}
			</div>
		);
	}
	if (status === "loading" || status === "pending" || status === "streaming") {
		// The bar keeps the height the last finished digest had, so the swap
		// from placeholder to text moves nothing around it.
		return (
			<div style={{ minHeight: lastDigestHeight || undefined }}>
				<DigestSkeleton rows={DIGEST_FOLD} />
				<div className="mt-1 h-[17px]" />
			</div>
		);
	}
	return null;
}

// Height of the last digest that finished rendering, on this page load.
let lastDigestHeight = 0;

const SKELETON_WIDTHS = ["w-[72%]", "w-[64%]", "w-[80%]", "w-[58%]", "w-[68%]"];

// Placeholder lines the size of digest lines. Shown for the lines that have
// not arrived yet, so switching topic shows a bar of five lines that fill
// in, never one that collapses and grows back.
function DigestSkeleton({ rows }: { rows: number }) {
	if (rows <= 0) {
		return null;
	}
	return (
		<ol aria-busy className="space-y-1">
			{Array.from({ length: rows }, (_, index) => (
				<li
					className="flex h-[23px] items-center gap-2"
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
					key={index}
				>
					<span className="w-4 text-right text-[13px] text-[var(--text-muted)] tabular-nums">
						{index + 1}.
					</span>
					<span
						className={`h-3 animate-pulse bg-[var(--state-hover-subtle)] ${SKELETON_WIDTHS[index % SKELETON_WIDTHS.length]}`}
					/>
				</li>
			))}
		</ol>
	);
}

const EMPTY_CITATIONS: CitationMap = new Map();

// The last finished digest per topic/locale/window, kept for the session so
// switching between the feed, trends and events views repaints it at once
// instead of collapsing to a loading line and growing back.
interface DigestMemo {
	at: number;
	citations: CitationMap;
	text: string;
}
const DIGEST_MEMO = new Map<string, DigestMemo>();
const DIGEST_MEMO_FRESH_MS = 5 * 60_000;

function digestMemoKey(
	topicId: string,
	locale: string,
	summaryWindow: SummaryWindow,
	followedIds: readonly string[] | undefined,
	keywords: readonly string[] | undefined
): string {
	return `${topicId}:${locale}:${summaryWindow}:${followedIds?.join(",") ?? ""}:${keywords?.join(",") ?? ""}`;
}

export function TrendsSummary({
	collapsed,
	keywords,
	onCollapsedChange,
	title,
	page,
	topicId,
}: TrendsSummaryProps) {
	const locale = useLocale();
	const t = useT();
	const [text, setText] = useState("");
	const [status, setStatus] = useState<SummaryStatus>("loading");
	const [error, setError] = useState<string | null>(null);
	const [citations, setCitations] = useState<CitationMap>(EMPTY_CITATIONS);
	const [summaryWindow, setSummaryWindow] = useState<SummaryWindow>("today");
	const [retryNonce, setRetryNonce] = useState(0);
	const metadata = useMemo(() => buildMetadataMap(page), [page]);
	const stats = useMemo(() => computeSummaryStats(page), [page]);
	// The followed page carries the reader's list; the digest needs it too.
	const followedIds = useMemo(
		() =>
			topicId === FOLLOWED_TOPIC_ID
				? page.sections.flatMap((section) =>
						section.sources.map((source) => source.sourceId)
					)
				: undefined,
		[page, topicId]
	);
	const memoKey = digestMemoKey(
		topicId,
		locale,
		summaryWindow,
		followedIds,
		keywords
	);
	// "AI · 今日 10 条": the digest names its topic and period, since it is the
	// first thing on the page and the share image carries the same heading.
	const topicKey = `topic.${topicId}` as TranslationKey;
	const translatedTopic = t(topicKey);
	const digestTitle = `${title ?? (translatedTopic === topicKey ? page.title : translatedTopic)} · ${t(WINDOW_HEADING_KEYS[summaryWindow])}`;
	const showTopicTags = shouldShowDigestTopicTags(topicId);
	const [shareOpen, setShareOpen] = useState(false);
	// Five lines are a glance; the rest are a click away, and the choice
	// resets with the topic so a new digest starts folded.
	const [expanded, setExpanded] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: memoKey is the digest identity that triggers this reset
	useEffect(() => {
		setExpanded(false);
	}, [memoKey]);
	const localeParam = localePathParam(locale);
	const topicHref = useCallback(
		(id: string) => `${localeParam ? `/${localeParam}` : ""}/feed?topic=${id}`,
		[localeParam]
	);
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
			let retryTimer: number | undefined;

			const memo = DIGEST_MEMO.get(memoKey);
			// A memoised digest stays on screen while a newer one streams in
			// behind it and replaces it whole when done; watching the list
			// shrink to one line and grow back is the jump readers noticed.
			const holdMemo = Boolean(memo);
			let hold = holdMemo;
			if (memo) {
				setText(memo.text);
				setCitations(memo.citations);
				setError(null);
				setStatus("done");
				if (Date.now() - memo.at < DIGEST_MEMO_FRESH_MS) {
					return;
				}
			} else {
				setText("");
				setError(null);
				setStatus("loading");
				setCitations(EMPTY_CITATIONS);
			}

			let latestText = "";
			let latestCitations: CitationMap = EMPTY_CITATIONS;
			streamSummary(
				topicId,
				locale,
				summaryWindow,
				retryNonce,
				followedIds,
				keywords,
				{
					signal: controller.signal,
					isCancelled: () => cancelled,
					onStreamingStart: (origin) => {
						if (holdMemo) {
							return;
						}
						// A cached digest arrives in a moment; it is shown whole when
						// it has, behind the placeholder, rather than typed out. Only
						// a digest being generated right now streams visibly.
						if (!shouldExpandGeneratedSummary(origin)) {
							hold = true;
							return;
						}
						setStatus("streaming");
						setExpanded(true);
					},
					onChunk: (full) => {
						if (full.trim()) {
							latestText = full;
							if (!hold) {
								setText(full);
							}
						}
					},
					onCitations: (next) => {
						latestCitations = next;
						if (!hold) {
							setCitations(next);
						}
					},
					onUnavailable: () => setStatus("unavailable"),
					onEmpty: () => setStatus("empty"),
					onPending: () => {
						setStatus("pending");
						retryTimer = window.setTimeout(
							() => setRetryNonce((value) => value + 1),
							SUMMARY_PENDING_RETRY_MS
						);
					},
					onDone: () => {
						setStatus("done");
						if (hold && latestText.trim()) {
							setText(latestText);
							setCitations(latestCitations);
						}
						if (latestText.trim()) {
							DIGEST_MEMO.set(memoKey, {
								at: Date.now(),
								citations: latestCitations,
								text: latestText,
							});
						}
					},
					onError: (message) => {
						setStatus("error");
						setError(message);
					},
				}
			).catch(() => {
				// streamSummary already converts errors into onError calls;
				// this catch only keeps the floating promise from being unhandled.
			});

			return () => {
				cancelled = true;
				if (retryTimer !== undefined) {
					window.clearTimeout(retryTimer);
				}
				controller.abort();
			};
		},
		[topicId, locale, summaryWindow, retryNonce, followedIds, keywords, memoKey]
	);

	if (status === "unavailable") {
		return null;
	}
	let activityLabel = t("summary.writing");
	if (status === "pending") {
		activityLabel = t("summary.preparing");
	} else if (status === "loading") {
		activityLabel = t("summary.thinking");
	}

	return (
		<div
			// The first line is the same 40px row whether the digest is open or
			// closed, so collapsing only removes the body and nothing jumps.
			className={`border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 sm:px-4 ${collapsed ? "" : "pb-3"}`}
			ref={containerRef}
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex h-10 flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
						<span className="text-[12px] text-[var(--text-primary)]">
							{digestTitle}
						</span>
						<span>·</span>
						<span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 tabular-nums">
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
						{status === "loading" ||
						status === "pending" ||
						status === "streaming" ? (
							<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
								<span
									aria-hidden
									className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--accent-blue)]"
								/>
								{activityLabel}
							</span>
						) : null}
						<fieldset
							aria-label={t("summary.windowLabel")}
							className="ml-auto inline-flex items-center gap-0.5"
						>
							{SUMMARY_WINDOWS.map((option) => (
								<button
									aria-pressed={option === summaryWindow}
									className={segmentClassName}
									key={option}
									onClick={() => setSummaryWindow(option)}
									type="button"
								>
									{t(SUMMARY_WINDOW_LABELS[option])}
								</button>
							))}
							{digestEntries.length > 0 ? (
								<button
									className={`${segmentClassName} ml-1 gap-1`}
									onClick={() => setShareOpen(true)}
									type="button"
								>
									<Share2 aria-hidden className="size-3" />
									{t("summary.share")}
								</button>
							) : null}
							<button
								aria-expanded={!collapsed}
								aria-label={
									collapsed ? t("summary.expand") : t("summary.collapse")
								}
								className="ml-1 inline-flex size-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
								onClick={() => onCollapsedChange(!collapsed)}
								title={collapsed ? t("summary.expand") : t("summary.collapse")}
								type="button"
							>
								{collapsed ? (
									<ChevronDown aria-hidden className="size-3.5" />
								) : (
									<ChevronUp aria-hidden className="size-3.5" />
								)}
							</button>
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
					{collapsed ? null : (
						<SummaryBody
							citations={citations}
							contentKey={memoKey}
							error={error}
							expanded={expanded}
							metadata={metadata}
							onExpandedChange={setExpanded}
							showTopicTags={showTopicTags}
							status={status}
							t={t}
							text={text}
							topicHref={topicHref}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
