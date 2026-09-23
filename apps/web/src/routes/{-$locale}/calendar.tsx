import { env } from "@opentrends/env/web";
import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { segmentClassName } from "@/components/chrome-styles";
import {
	CONTENT_KINDS,
	type ContentKind,
	classifyTitle,
} from "@/components/trends/content-kind";
import {
	setDisplaySetting,
	useDisplaySettings,
} from "@/components/trends/display-settings";
import {
	FOLLOWED_TOPIC_ID,
	useFollowedSources,
} from "@/components/trends/followed-sources";
import { trendsPageQueryOptions } from "@/components/trends/trends-query";
import { TrendsSummary } from "@/components/trends/trends-summary";
import { ViewSwitch } from "@/components/trends/view-switch";
import {
	type Locale,
	localePathParam,
	resolveLocale,
	translate,
	useLocale,
	useT,
} from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

// A month of a topic, day by day: the day's ten lines where one was kept,
// and what led each source. The same digest bar and kind filter as the
// feed sit above it, so switching views moves nothing else.

const CELL_ITEMS = 3;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface CalendarItem {
	publishedAt: number;
	rank: number;
	sourceId: string;
	sourceTitle: string;
	title: string;
	url: string;
}

interface DigestEntry {
	citations: { n: number; url: string }[];
	n: number;
	reason?: string;
	takeaway: string;
}

interface CalendarMonth {
	days: Record<string, CalendarItem[]>;
	digests?: Record<string, DigestEntry[]>;
	month: string;
	topic: string;
}

interface CalendarSearch {
	month?: string;
	topic?: string;
}

function validateSearch(search: Record<string, unknown>): CalendarSearch {
	return {
		month:
			typeof search.month === "string" && MONTH_RE.test(search.month)
				? search.month
				: undefined,
		topic: typeof search.topic === "string" ? search.topic : undefined,
	};
}

function thisMonth(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, by: number): string {
	const [year, mon] = month.split("-").map(Number) as [number, number];
	const date = new Date(Date.UTC(year, mon - 1 + by, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calendarQueryOptions(
	topic: string,
	month: string,
	locale: Locale,
	tzOffset: number,
	sourceIds: readonly string[] | undefined
) {
	return queryOptions<CalendarMonth, Error>({
		queryKey: [
			"calendar",
			topic,
			month,
			locale,
			tzOffset,
			sourceIds?.join(","),
		],
		queryFn: async () => {
			const search = new URLSearchParams({
				lang: locale,
				month,
				tz: String(tzOffset),
			});
			if (sourceIds) {
				search.set("sources", sourceIds.join(","));
			}
			const response = await fetch(
				`${env.VITE_SERVER_URL}/api/trends/${encodeURIComponent(topic)}/calendar?${search}`,
				{ credentials: "same-origin" }
			);
			if (!response.ok) {
				throw new Error(`Failed to load calendar (${response.status})`);
			}
			return (await response.json()) as CalendarMonth;
		},
		staleTime: 10 * 60_000,
	});
}

export const Route = createFileRoute("/{-$locale}/calendar")({
	component: CalendarRoute,
	validateSearch,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		return buildSeo({
			title: translate(locale, "nav.calendar"),
			description: translate(locale, "calendar.seoDescription"),
			path: "/calendar",
			locale,
		});
	},
});

// The grid's cells, Monday first, with blanks before the first day.
function monthCells(month: string): (string | null)[] {
	const [year, mon] = month.split("-").map(Number) as [number, number];
	const first = new Date(Date.UTC(year, mon - 1, 1));
	const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
	const lead = (first.getUTCDay() + 6) % 7;
	const cells: (string | null)[] = Array.from({ length: lead }, () => null);
	for (let day = 1; day <= daysInMonth; day += 1) {
		cells.push(`${month}-${String(day).padStart(2, "0")}`);
	}
	return cells;
}

function DigestPanel({
	day,
	entries,
	t,
}: {
	day: string;
	entries: DigestEntry[];
	t: ReturnType<typeof useT>;
}) {
	return (
		<section className="mt-4 border border-[var(--accent-blue)] bg-[var(--surface-card)]">
			<h2 className="border-[var(--border-default)] border-b px-4 py-2 font-semibold text-[13px] text-[var(--text-heading)]">
				{day} · {t("summary.windowToday")} {entries.length}
			</h2>
			<ol className="space-y-1.5 px-4 py-3 text-[13px]">
				{entries.map((entry) => (
					<li className="flex gap-2" key={entry.n}>
						<span className="w-4 shrink-0 text-right text-[var(--text-muted)] tabular-nums">
							{entry.n}.
						</span>
						<span>
							<strong className="font-semibold">{entry.takeaway}</strong>
							{entry.reason ? (
								<span className="text-[var(--text-secondary)]">
									{" — "}
									{entry.reason}
								</span>
							) : null}{" "}
							{entry.citations.map((citation, index) => (
								<a
									className="mx-0.5 inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-[4px] bg-[var(--accent-blue-bg)] px-[5px] align-[-4px] text-[10px] text-[var(--accent-blue)]"
									href={citation.url}
									key={citation.url}
									rel="noopener noreferrer"
									target="_blank"
								>
									{index + 1}
								</a>
							))}
						</span>
					</li>
				))}
			</ol>
		</section>
	);
}

function CalendarRoute() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const params = Route.useParams();
	const locale = useLocale();
	const localeParam = localePathParam(resolveLocale(params.locale));
	const t = useT();
	const settings = useDisplaySettings();
	const { followedIds } = useFollowedSources();
	const topic = search.topic ?? "ai";
	const month = search.month ?? thisMonth();
	const tzOffset = -new Date().getTimezoneOffset();
	const isFollowed = topic === FOLLOWED_TOPIC_ID;
	const sourceIds = isFollowed ? followedIds : undefined;
	const enabled = !isFollowed || followedIds.length > 0;
	const query = useQuery({
		...calendarQueryOptions(topic, month, locale, tzOffset, sourceIds),
		enabled,
	});
	const page = useQuery({
		...trendsPageQueryOptions(topic, locale, sourceIds),
		enabled,
	});
	const [kind, setKind] = useState<ContentKind | null>(null);
	const [openDay, setOpenDay] = useState<string | null>(null);

	const days = useMemo(() => {
		const all = query.data?.days ?? {};
		if (!kind) {
			return all;
		}
		const filtered: Record<string, CalendarItem[]> = {};
		for (const [day, items] of Object.entries(all)) {
			const kept = items.filter((item) => classifyTitle(item.title) === kind);
			if (kept.length > 0) {
				filtered[day] = kept;
			}
		}
		return filtered;
	}, [query.data, kind]);
	const cells = useMemo(() => monthCells(month), [month]);
	const weekdays = useMemo(() => {
		const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
		return Array.from({ length: 7 }, (_, index) =>
			formatter.format(new Date(Date.UTC(2024, 0, 1 + index)))
		);
	}, [locale]);
	const monthLabel = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "long",
				year: "numeric",
			}).format(new Date(`${month}-01T00:00:00Z`)),
		[locale, month]
	);
	const open = openDay ? days[openDay] : undefined;
	const openDigest = openDay ? query.data?.digests?.[openDay] : undefined;

	function go(next: Partial<CalendarSearch>) {
		navigate({ search: (current) => ({ ...current, ...next }) });
		setOpenDay(null);
	}

	return (
		<ScrollArea className="min-w-0 flex-1 bg-[var(--surface-app)] text-[var(--text-primary)]">
			{page.data ? (
				<TrendsSummary
					collapsed={settings.summaryCollapsed}
					onCollapsedChange={(collapsed) =>
						setDisplaySetting("summaryCollapsed", collapsed)
					}
					page={page.data}
					topicId={topic}
				/>
			) : (
				<div className="h-10 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)]" />
			)}
			<div className="flex h-10 items-center justify-between gap-3 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 sm:px-4">
				<ViewSwitch localeParam={localeParam} topicId={topic} view="calendar" />
				<div className="flex items-center gap-1">
					<button
						aria-label={t("calendar.previousMonth")}
						className="inline-flex size-7 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
						onClick={() => go({ month: shiftMonth(month, -1) })}
						type="button"
					>
						<ChevronLeft className="size-4" />
					</button>
					<span className="min-w-[7rem] text-center font-semibold text-[12px] text-[var(--text-heading)] tabular-nums">
						{monthLabel}
					</span>
					<button
						aria-label={t("calendar.nextMonth")}
						className="inline-flex size-7 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] disabled:opacity-30"
						disabled={month >= thisMonth()}
						onClick={() => go({ month: shiftMonth(month, 1) })}
						type="button"
					>
						<ChevronRight className="size-4" />
					</button>
				</div>
			</div>
			<div className="flex flex-wrap gap-1 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-1.5 sm:px-4">
				<button
					aria-pressed={kind === null}
					className={segmentClassName}
					onClick={() => setKind(null)}
					type="button"
				>
					{t("kind.all")}
				</button>
				{CONTENT_KINDS.map((value) => (
					<button
						aria-pressed={kind === value}
						className={segmentClassName}
						key={value}
						onClick={() => setKind(kind === value ? null : value)}
						type="button"
					>
						{t(`kind.${value}`)}
					</button>
				))}
			</div>

			<div className="p-3 sm:p-4">
				<div className="grid grid-cols-7 gap-px border border-[var(--border-default)] bg-[var(--border-subtle)]">
					{weekdays.map((label) => (
						<div
							className="bg-[var(--surface-sidebar)] px-2 py-1 text-[11px] text-[var(--text-muted)]"
							key={label}
						>
							{label}
						</div>
					))}
					{cells.map((day, index) => {
						if (!day) {
							return (
								<div
									className="min-h-24 bg-[var(--surface-card)]"
									// biome-ignore lint/suspicious/noArrayIndexKey: blank leading cells
									key={`blank-${index}`}
								/>
							);
						}
						const items = days[day] ?? [];
						const digestCount = query.data?.digests?.[day]?.length;
						return (
							<button
								aria-pressed={openDay === day}
								className="flex min-h-24 flex-col items-stretch gap-0.5 bg-[var(--surface-card)] p-1.5 text-left transition-colors hover:bg-[var(--state-hover-subtle)] aria-pressed:bg-[var(--accent-blue-bg)]"
								key={day}
								onClick={() => setOpenDay(openDay === day ? null : day)}
								type="button"
							>
								<span className="flex items-center justify-between text-[11px] text-[var(--text-muted)] tabular-nums">
									{Number(day.slice(-2))}
									{digestCount ? (
										<span className="bg-[var(--accent-blue-bg)] px-1 text-[10px] text-[var(--accent-blue)]">
											{digestCount}
										</span>
									) : null}
								</span>
								{items.slice(0, CELL_ITEMS).map((item) => (
									<span
										className="truncate border-[var(--accent-blue)] border-l-2 pl-1 text-[11px] text-[var(--text-primary)] leading-4"
										key={item.url}
										title={item.title}
									>
										{item.title}
									</span>
								))}
								{items.length > CELL_ITEMS ? (
									<span className="text-[10px] text-[var(--text-muted)]">
										+{items.length - CELL_ITEMS}
									</span>
								) : null}
							</button>
						);
					})}
				</div>
				{query.isPending && enabled ? (
					<p className="mt-3 text-[12px] text-[var(--text-muted)]">
						{t("summary.reading")}
					</p>
				) : null}
				{openDay && openDigest && openDigest.length > 0 ? (
					<DigestPanel day={openDay} entries={openDigest} t={t} />
				) : null}
				{open && openDay ? (
					<section className="mt-4 border border-[var(--border-default)] bg-[var(--surface-card)]">
						<h2 className="border-[var(--border-default)] border-b px-4 py-2 font-semibold text-[13px] text-[var(--text-heading)]">
							{openDay} · {open.length}
						</h2>
						<ul className="divide-y divide-[var(--border-subtle)]">
							{open.map((item) => (
								<li key={item.url}>
									<a
										className="flex items-center gap-3 px-4 py-2 text-[13px] text-[var(--text-primary)] transition-colors visited:text-[#9b9893] hover:bg-[var(--state-hover-subtle)] dark:visited:text-[#6f685f]"
										href={item.url}
										rel="noopener noreferrer"
										target="_blank"
									>
										<span className="min-w-0 flex-1 truncate">
											{item.title}
										</span>
										<span className="shrink-0 text-[11px] text-[var(--text-muted)]">
											{item.sourceTitle}
										</span>
									</a>
								</li>
							))}
						</ul>
					</section>
				) : null}
			</div>
		</ScrollArea>
	);
}
