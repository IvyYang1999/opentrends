import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
	clearFeedSignals,
	type FeedSignal,
	readFeedSignals,
} from "@/components/trends/feed-signals";
import { affinitiesFromSignals } from "@/components/trends/reader-context";
import {
	type Locale,
	resolveLocale,
	type TranslationKey,
	useLocale,
	useT,
} from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

// What the reader has opened from the feed, on this device, and what the
// ranking has learned from it. Nothing here leaves the browser; the page
// exists so that is visible, and so the log can be wiped.

interface Strings {
	clear: string;
	cleared: string;
	empty: string;
	intro: string;
	learned: string;
	learnedCovers: string;
	learnedKinds: string;
	learnedSources: string;
	title: string;
	total: string;
}

const EN: Strings = {
	clear: "Clear history",
	cleared: "History cleared.",
	empty:
		"Nothing yet. Open a few stories from the feed and they will show up here.",
	intro:
		"Stored only in this browser. The feed uses it to rank: sources and subjects you open rank higher, and so do the kinds of card you tend to open.",
	learned: "What the feed has learned",
	learnedCovers: "Pictures vs. text",
	learnedKinds: "Kinds you open",
	learnedSources: "Sources you open most",
	title: "Reading history",
	total: "clicks in the last weeks",
};

const ZH: Strings = {
	clear: "清空记录",
	cleared: "已清空。",
	empty: "还没有记录。在推荐流里点开几条，就会出现在这里。",
	intro:
		"只存在这台设备的浏览器里。推荐流用它来排序：你常点开的来源、话题和卡片类型会排得更靠前。",
	learned: "推荐流学到了什么",
	learnedCovers: "图片 vs 文字",
	learnedKinds: "常看的形态",
	learnedSources: "最常点开的来源",
	title: "浏览记录",
	total: "次点击，最近几周",
};

const ZH_HANT: Strings = {
	...ZH,
	clear: "清空記錄",
	cleared: "已清空。",
	empty: "還沒有記錄。在推薦流裡點開幾則，就會出現在這裡。",
	intro:
		"只存在這台裝置的瀏覽器裡。推薦流用它來排序：你常點開的來源、話題和卡片類型會排得更靠前。",
	learned: "推薦流學到了什麼",
	learnedCovers: "圖片 vs 文字",
	learnedKinds: "常看的形態",
	learnedSources: "最常點開的來源",
	title: "瀏覽記錄",
	total: "次點擊，最近幾週",
};

const STRINGS: Partial<Record<Locale, Strings>> & { en: Strings } = {
	en: EN,
	zh: ZH,
	"zh-Hant": ZH_HANT,
};

function getStrings(locale: Locale): Strings {
	return STRINGS[locale] ?? STRINGS.en;
}

export const Route = createFileRoute("/{-$locale}/history")({
	component: HistoryRoute,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		const strings = getStrings(locale);
		return buildSeo({
			title: strings.title,
			description: strings.intro,
			path: "/history",
			locale,
			noindex: true,
		});
	},
});

function dayOf(timestamp: number, locale: string): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
		new Date(timestamp)
	);
}

function timeOf(timestamp: number, locale: string): string {
	return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
		new Date(timestamp)
	);
}

function topEntries(
	map: ReadonlyMap<string, number>,
	prefix: string,
	limit: number
): [string, number][] {
	return [...map.entries()]
		.filter(([key]) => key.startsWith(prefix))
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([key, value]) => [key.slice(prefix.length), value]);
}

function HistoryRoute() {
	const params = Route.useParams();
	const locale = useLocale();
	const strings = getStrings(resolveLocale(params.locale));
	const t = useT();
	const [signals, setSignals] = useState<FeedSignal[]>([]);
	const [cleared, setCleared] = useState(false);
	useEffect(() => {
		setSignals([...readFeedSignals()].reverse());
	}, []);

	const learned = useMemo(
		() => affinitiesFromSignals(signals, Date.now()),
		[signals]
	);
	const days = useMemo(() => {
		const groups = new Map<string, FeedSignal[]>();
		for (const signal of signals) {
			const day = dayOf(signal.at, locale);
			groups.set(day, [...(groups.get(day) ?? []), signal]);
		}
		return [...groups.entries()];
	}, [signals, locale]);
	const topSources = useMemo(
		() =>
			[...learned.sourceAffinity.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5),
		[learned]
	);
	const kinds = topEntries(learned.attributeShare, "kind:", 4);
	const covers = learned.attributeShare.get("cover");
	const sourceTitle = (sourceId: string) =>
		signals.find((signal) => signal.sourceId === sourceId)?.sourceTitle ??
		sourceId;

	function clear() {
		clearFeedSignals();
		setSignals([]);
		setCleared(true);
	}

	return (
		<div className="min-w-0 flex-1 bg-[var(--surface-sidebar)] text-[var(--text-primary)]">
			<div className="mx-auto w-full max-w-3xl space-y-6 p-6 sm:p-10">
				<header className="flex items-start justify-between gap-4">
					<div className="space-y-1">
						<h1 className="font-bold text-2xl text-[var(--text-heading)] tracking-tight">
							{strings.title}
						</h1>
						<p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
							{strings.intro}
						</p>
					</div>
					{signals.length > 0 ? (
						<button
							className="inline-flex h-7 shrink-0 items-center border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--accent-red)]"
							onClick={clear}
							type="button"
						>
							{strings.clear}
						</button>
					) : null}
				</header>

				{signals.length > 0 ? (
					<section className="grid gap-px border border-[var(--border-default)] bg-[var(--border-subtle)] sm:grid-cols-3">
						<div className="space-y-1 bg-[var(--surface-card)] p-4">
							<h2 className="text-[11px] text-[var(--text-muted)]">
								{strings.learnedSources}
							</h2>
							<ol className="space-y-0.5 text-[13px]">
								{topSources.map(([sourceId, weight]) => (
									<li className="flex items-center gap-2" key={sourceId}>
										<span className="min-w-0 flex-1 truncate">
											{sourceTitle(sourceId)}
										</span>
										<span className="h-1.5 w-16 bg-[var(--state-hover-subtle)]">
											<span
												className="block h-full bg-[var(--accent-blue)]"
												style={{ width: `${Math.round(weight * 100)}%` }}
											/>
										</span>
									</li>
								))}
							</ol>
						</div>
						<div className="space-y-1 bg-[var(--surface-card)] p-4">
							<h2 className="text-[11px] text-[var(--text-muted)]">
								{strings.learnedKinds}
							</h2>
							{kinds.length > 0 ? (
								<ol className="space-y-0.5 text-[13px]">
									{kinds.map(([kind, share]) => (
										<li className="flex items-center gap-2" key={kind}>
											<span className="min-w-0 flex-1 truncate">
												{t(`kind.${kind}` as TranslationKey)}
											</span>
											<span className="text-[var(--text-muted)] tabular-nums">
												{Math.round(share * 100)}%
											</span>
										</li>
									))}
								</ol>
							) : (
								<p className="text-[12px] text-[var(--text-muted)]">—</p>
							)}
						</div>
						<div className="space-y-1 bg-[var(--surface-card)] p-4">
							<h2 className="text-[11px] text-[var(--text-muted)]">
								{strings.learnedCovers}
							</h2>
							<p className="text-[13px] tabular-nums">
								{covers === undefined
									? "—"
									: `${Math.round(covers * 100)}% / ${Math.round((1 - covers) * 100)}%`}
							</p>
							<p className="text-[11px] text-[var(--text-muted)]">
								{signals.length} {strings.total}
							</p>
						</div>
					</section>
				) : null}

				{signals.length === 0 ? (
					<p className="text-[13px] text-[var(--text-secondary)]">
						{cleared ? strings.cleared : strings.empty}
					</p>
				) : (
					days.map(([day, entries]) => (
						<section className="space-y-1" key={day}>
							<h2 className="font-semibold text-[12px] text-[var(--text-muted)]">
								{day}
							</h2>
							<ul className="divide-y divide-[var(--border-subtle)] border border-[var(--border-default)] bg-[var(--surface-card)]">
								{entries.map((signal) => (
									<li key={`${signal.at}:${signal.url}`}>
										<a
											className="flex items-center gap-3 px-4 py-2 text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--state-hover-subtle)]"
											href={signal.url}
											rel="noopener noreferrer"
											target="_blank"
										>
											<span className="w-12 shrink-0 text-[11px] text-[var(--text-muted)] tabular-nums">
												{timeOf(signal.at, locale)}
											</span>
											<span className="min-w-0 flex-1 truncate">
												{signal.title}
											</span>
											<span className="shrink-0 text-[11px] text-[var(--text-muted)]">
												{signal.sourceTitle ?? signal.sourceId}
											</span>
										</a>
									</li>
								))}
							</ul>
						</section>
					))
				)}
			</div>
		</div>
	);
}
