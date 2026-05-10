import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import { ExternalLink } from "lucide-react";
import type * as React from "react";

import { type Translator, useT } from "@/lib/i18n";

import { formatRelativeTime } from "./relative-time";
import { SourceFavicon, SourceLogoStack } from "./source-favicon";
import type {
	SourceLifecycleStatus,
	SourceStatusEntry,
	SourcesStatusResponse,
} from "./sources-types";

interface SourcesPageProps {
	data: SourcesStatusResponse;
}

export function SourcesPage({ data }: SourcesPageProps) {
	const t = useT();
	return (
		<ScrollArea className="h-full min-w-0 overflow-hidden bg-[var(--surface-app)] text-[var(--text-primary)]">
			<div className="flex flex-col">
				<SummaryBar
					generatedAt={data.generatedAt}
					sources={data.sources}
					t={t}
					totals={data.totals}
				/>
				<div className="hidden sm:block">
					<SourceTable sources={data.sources} t={t} />
				</div>
				<SourceMobileList sources={data.sources} t={t} />
			</div>
		</ScrollArea>
	);
}

function SummaryBar({
	totals,
	generatedAt,
	sources,
	t,
}: {
	totals: SourcesStatusResponse["totals"];
	generatedAt: number;
	sources: SourceStatusEntry[];
	t: Translator;
}) {
	const chips: Array<{ label: string; value: number; color: string }> = [
		{
			label: t("sources.totalsTotal"),
			value: totals.sources,
			color: "var(--text-secondary)",
		},
		{
			label: t("sources.totalsOk"),
			value: totals.ok,
			color: "var(--accent-green)",
		},
		{
			label: t("sources.totalsStale"),
			value: totals.stale,
			color: "var(--accent-orange)",
		},
		{
			label: t("sources.totalsError"),
			value: totals.error,
			color: "var(--accent-red)",
		},
		{
			label: t("sources.totalsMissing"),
			value: totals.missing,
			color: "var(--text-muted)",
		},
	];
	const logoSources = sources.map((source) => ({
		homeUrl: source.homeUrl,
		id: source.sourceId,
		label: source.name,
	}));
	return (
		<div className="flex flex-wrap items-center gap-2 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2 sm:gap-3 sm:px-4">
			<div className="flex items-center gap-2">
				<SourceLogoStack limit={5} sources={logoSources} />
				<span className="font-medium text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.2em]">
					{t("sources.heading")}
				</span>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{chips.map((chip) => (
					<span
						className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
						key={chip.label}
					>
						<span
							className="inline-block size-1.5 rounded-full"
							style={{ backgroundColor: chip.color }}
						/>
						<span className="font-mono text-[var(--text-primary)] tabular-nums">
							{chip.value}
						</span>
						<span>{chip.label}</span>
					</span>
				))}
			</div>
			<span
				className="w-full text-[11px] text-[var(--text-muted)] sm:ml-auto sm:w-auto"
				suppressHydrationWarning
			>
				{t("sources.updated", { time: formatRelativeTime(generatedAt, t) })}
			</span>
		</div>
	);
}

const COL_HEAD =
	"px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-secondary)]";
const COL_CELL = "px-3 py-2 align-top";

function SourceTable({
	sources,
	t,
}: {
	sources: SourceStatusEntry[];
	t: Translator;
}) {
	return (
		<table className="min-w-full border-separate border-spacing-0 text-[13px]">
			<thead className="sticky top-0 z-10 bg-[var(--surface-app)]">
				<tr>
					<th className={`${COL_HEAD} w-[44%]`}>{t("sources.colSource")}</th>
					<th className={`${COL_HEAD} w-[7%]`}>{t("sources.colProvider")}</th>
					<th className={`${COL_HEAD} w-[10%]`}>{t("sources.colRefresh")}</th>
					<th className={`${COL_HEAD} w-[7%] text-right`}>
						{t("sources.colItems")}
					</th>
					<th className={`${COL_HEAD} w-[12%]`}>{t("sources.colStatus")}</th>
					<th className={`${COL_HEAD} w-[8%]`}>{t("sources.colLastFetch")}</th>
					<th className={`${COL_HEAD} w-[12%]`}>{t("sources.colTopics")}</th>
				</tr>
			</thead>
			<tbody>
				{sources.map((s) => (
					<SourceRow entry={s} key={s.sourceId} t={t} />
				))}
			</tbody>
		</table>
	);
}

function SourceMobileList({
	sources,
	t,
}: {
	sources: SourceStatusEntry[];
	t: Translator;
}) {
	return (
		<ul className="flex flex-col divide-y divide-[var(--border-subtle)] sm:hidden">
			{sources.map((source) => (
				<li key={source.sourceId}>
					<SourceMobileCard entry={source} t={t} />
				</li>
			))}
		</ul>
	);
}

function SourceMobileCard({
	entry,
	t,
}: {
	entry: SourceStatusEntry;
	t: Translator;
}) {
	return (
		<div className="bg-[var(--surface-card)] px-3 py-3">
			<div className="flex items-start gap-2">
				<StatusDot status={entry.status} />
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-1.5">
						<SourceFavicon homeUrl={entry.homeUrl} />
						<span className="min-w-0 truncate font-medium text-[var(--text-primary)]">
							{entry.name}
						</span>
						{entry.homeUrl ? (
							<a
								aria-label={t("sources.openLabel", { name: entry.name })}
								className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover)] hover:text-[var(--text-primary)]"
								href={entry.homeUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								<ExternalLink className="size-3" />
							</a>
						) : null}
					</div>
					<div className="mt-1 line-clamp-2 text-[12px] text-[var(--text-secondary)]">
						{entry.note}
					</div>
				</div>
				<StatusBadge errorCount={entry.errorCount} status={entry.status} />
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
				<SourceMobileMeta label={t("sources.colProvider")}>
					<span className="font-mono uppercase tracking-wider">
						{entry.provider}
					</span>
				</SourceMobileMeta>
				<SourceMobileMeta label={t("sources.colItems")}>
					<span className="font-mono tabular-nums">{entry.itemCount}</span>
				</SourceMobileMeta>
				<SourceMobileMeta label={t("sources.colRefresh")}>
					{entry.refresh}
				</SourceMobileMeta>
				<SourceMobileMeta label={t("sources.colLastFetch")}>
					<span suppressHydrationWarning>
						{entry.fetchedAt ? formatRelativeTime(entry.fetchedAt, t) : "—"}
					</span>
				</SourceMobileMeta>
			</div>
			{entry.endpointUrl ? (
				<a
					className="mt-2 block truncate font-mono text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-blue)]"
					href={entry.endpointUrl}
					rel="noopener noreferrer"
					target="_blank"
					title={entry.endpointUrl}
				>
					{entry.endpointUrl}
				</a>
			) : null}
			{entry.topics.length > 0 ? (
				<div className="mt-2 flex flex-wrap gap-1">
					{entry.topics.map((topic) => (
						<span
							className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sidebar)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
							key={topic}
						>
							{topic}
						</span>
					))}
				</div>
			) : null}
			{entry.lastError ? (
				<div className="mt-2 line-clamp-2 text-[11px] text-[var(--accent-red)]">
					{entry.lastError}
				</div>
			) : null}
		</div>
	);
}

function SourceMobileMeta({
	children,
	label,
}: {
	children: React.ReactNode;
	label: string;
}) {
	return (
		<div className="min-w-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-sidebar)] px-2 py-1.5">
			<div className="truncate text-[10px] text-[var(--text-muted)]">
				{label}
			</div>
			<div className="mt-0.5 truncate">{children}</div>
		</div>
	);
}

function SourceRow({ entry, t }: { entry: SourceStatusEntry; t: Translator }) {
	return (
		<tr className="border-[var(--border-subtle)] border-t hover:bg-[var(--state-hover-subtle)]">
			<td className={`${COL_CELL} border-[var(--border-subtle)] border-t`}>
				<div className="flex items-start gap-2">
					<StatusDot status={entry.status} />
					<div className="min-w-0">
						<div className="flex items-center gap-1.5">
							<SourceFavicon homeUrl={entry.homeUrl} />
							<span className="font-medium text-[var(--text-primary)]">
								{entry.name}
							</span>
							{entry.homeUrl ? (
								<a
									aria-label={t("sources.openLabel", { name: entry.name })}
									className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover)] hover:text-[var(--text-primary)]"
									href={entry.homeUrl}
									rel="noopener noreferrer"
									target="_blank"
								>
									<ExternalLink className="size-3" />
								</a>
							) : null}
						</div>
						<div className="mt-0.5 line-clamp-2 text-[12px] text-[var(--text-secondary)]">
							{entry.note}
						</div>
						<div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
							{entry.sourceId}
						</div>
						{entry.endpointUrl ? (
							<a
								className="mt-0.5 block truncate font-mono text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-blue)]"
								href={entry.endpointUrl}
								rel="noopener noreferrer"
								target="_blank"
								title={entry.endpointUrl}
							>
								{entry.endpointUrl}
							</a>
						) : null}
						{entry.lastError ? (
							<div className="mt-1 line-clamp-2 text-[11px] text-[var(--accent-red)]">
								{entry.lastError}
							</div>
						) : null}
					</div>
				</div>
			</td>
			<td className={`${COL_CELL} border-[var(--border-subtle)] border-t`}>
				<span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
					{entry.provider}
				</span>
			</td>
			<td
				className={`${COL_CELL} border-[var(--border-subtle)] border-t text-[12px] text-[var(--text-secondary)]`}
			>
				{entry.refresh}
			</td>
			<td
				className={`${COL_CELL} border-[var(--border-subtle)] border-t text-right font-mono text-[var(--text-secondary)] tabular-nums`}
			>
				{entry.itemCount}
			</td>
			<td className={`${COL_CELL} border-[var(--border-subtle)] border-t`}>
				<StatusBadge errorCount={entry.errorCount} status={entry.status} />
			</td>
			<td
				className={`${COL_CELL} border-[var(--border-subtle)] border-t text-[12px] text-[var(--text-secondary)]`}
				suppressHydrationWarning
			>
				{entry.fetchedAt ? formatRelativeTime(entry.fetchedAt, t) : "—"}
			</td>
			<td className={`${COL_CELL} border-[var(--border-subtle)] border-t`}>
				<div className="flex flex-wrap gap-1">
					{entry.topics.length > 0 ? (
						entry.topics.map((topic) => (
							<span
								className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sidebar)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
								key={topic}
							>
								{topic}
							</span>
						))
					) : (
						<span className="text-[11px] text-[var(--text-muted)]">—</span>
					)}
				</div>
			</td>
		</tr>
	);
}

function statusColor(status: SourceLifecycleStatus): string {
	switch (status) {
		case "ok":
			return "var(--accent-green)";
		case "stale":
			return "var(--accent-orange)";
		case "error":
			return "var(--accent-red)";
		default:
			return "var(--text-muted)";
	}
}

function StatusDot({ status }: { status: SourceLifecycleStatus }) {
	return (
		<span
			aria-hidden
			className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full"
			style={{ backgroundColor: statusColor(status) }}
			title={status}
		/>
	);
}

function StatusBadge({
	status,
	errorCount,
}: {
	status: SourceLifecycleStatus;
	errorCount: number;
}) {
	const color = statusColor(status);
	return (
		<span
			className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] capitalize"
			style={{ color }}
		>
			<span
				className="inline-block size-1.5 rounded-full"
				style={{ backgroundColor: color }}
			/>
			<span>{status}</span>
			{errorCount > 0 && status !== "ok" ? (
				<span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
					×{errorCount}
				</span>
			) : null}
		</span>
	);
}
