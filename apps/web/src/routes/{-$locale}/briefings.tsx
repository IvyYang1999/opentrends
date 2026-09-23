import { env } from "@opentrends/env/web";
import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	type Briefing,
	DEFAULT_HOUR,
	matchingItems,
	newBriefingId,
	parseKeywordInput,
	readBriefings,
	STORAGE_KEY,
	sourcesForTopics,
	type TopicSummary,
} from "@/components/trends/briefing-model";
import { formatRelativeTime } from "@/components/trends/relative-time";
import { SourceFavicon } from "@/components/trends/source-favicon";
import { trendsPageQueryOptions } from "@/components/trends/trends-query";
import { TrendsSummary } from "@/components/trends/trends-summary";
import { authClient } from "@/lib/auth-client";
import {
	type Locale,
	localePathParam,
	resolveLocale,
	type TranslationKey,
	useLocale,
	useT,
} from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

// A reader's own digests. A briefing names its sources (whole topics, or
// the follow list) and a few keywords; the digest is the same ten lines the
// topics get, drawn only from those. Stored in the browser like the follow
// list. Logged-in readers can also deliver the same briefing by email.

const HOURS = [6, 7, 8, 9, 12, 18, 20, 22] as const;
const ITEM_LIMIT = 40;

interface Strings {
	create: string;
	custom: string;
	customBody: string;
	delete: string;
	deliverBody: string;
	deliverButton: string;
	deliverDone: string;
	deliverFailed: string;
	deliverNotConfigured: string;
	deliverSignIn: string;
	deliverStop: string;
	deliverTitle: string;
	deliveryNote: string;
	everyDay: string;
	hour: string;
	keywords: string;
	keywordsHint: string;
	matching: string;
	mine: string;
	name: string;
	namePlaceholder: string;
	none: string;
	official: string;
	officialBody: string;
	save: string;
	seoDescription: string;
	sources: string;
	subscribe: string;
	subscribed: string;
	title: string;
	topics: string;
}

const EN: Strings = {
	deliverBody: "Get this briefing by mail at its hour, every day.",
	deliverButton: "Send it to me",
	deliverDone: "Arrives daily at",
	deliverFailed: "Could not subscribe; try again.",
	deliverNotConfigured: "Mail delivery is not set up on this deployment yet.",
	deliverSignIn: "Sign in to send this briefing to your account email.",
	deliverStop: "Stop",
	deliverTitle: "By mail",
	create: "New briefing",
	custom: "Make your own",
	customBody:
		"Pick topics, add keywords, choose an hour. The digest reads only the sources of those topics and only items mentioning your words.",
	delete: "Delete",
	deliveryNote:
		"Read it here or sign in to have it delivered by email every day.",
	everyDay: "Every day at",
	hour: "Hour",
	keywords: "Keywords",
	keywordsHint: "Comma-separated, up to ten. Leave empty for everything.",
	matching: "Matching items",
	mine: "My briefings",
	name: "Name",
	namePlaceholder: "e.g. Agents & MCP",
	none: "No briefings yet. Subscribe to a topic below or make your own.",
	official: "Topic briefings",
	officialBody: "One tap: all of a topic's sources, ten lines a day.",
	save: "Save",
	seoDescription:
		"Your own daily digest: pick topics and keywords, get ten lines with citations.",
	sources: "sources",
	subscribe: "Subscribe",
	subscribed: "Subscribed",
	title: "Briefings",
	topics: "Topics",
};

const ZH: Strings = {
	deliverBody: "每天到点，把这份简报发到邮箱。",
	deliverButton: "发给我",
	deliverDone: "每天送达，",
	deliverFailed: "订阅没成功，再试一次。",
	deliverNotConfigured: "这个部署还没接邮件服务。",
	deliverSignIn: "登录后可把简报发送到账号邮箱。",
	deliverStop: "停止",
	deliverTitle: "邮件推送",
	create: "新建简报",
	custom: "定制我的简报",
	customBody:
		"选主题、写关键词、定时间。摘要只读这些主题的来源，只看提到你关键词的内容。",
	delete: "删除",
	deliveryNote: "可以在网页里看，也可以登录后每天发到账号邮箱。",
	everyDay: "每天",
	hour: "时间",
	keywords: "关键词",
	keywordsHint: "逗号分隔，最多 10 个；留空表示全部。",
	matching: "命中的内容",
	mine: "我的简报",
	name: "名称",
	namePlaceholder: "例如：Agent 与 MCP",
	none: "还没有简报。订阅下面的主题简报，或者定制一份。",
	official: "主题简报",
	officialBody: "一键订阅：一个主题的全部来源，每天 10 条。",
	save: "保存",
	seoDescription: "你自己的每日简报：选主题和关键词，得到带引用的 10 条。",
	sources: "个来源",
	subscribe: "订阅",
	subscribed: "已订阅",
	title: "简报",
	topics: "主题",
};

const ZH_HANT: Strings = {
	...ZH,
	deliverBody: "每天到點，把這份簡報寄到信箱。",
	deliverButton: "寄給我",
	deliverDone: "每天送達，",
	deliverFailed: "訂閱沒成功，再試一次。",
	deliverNotConfigured: "這個部署還沒接郵件服務。",
	deliverSignIn: "登入後可把簡報寄到帳號信箱。",
	deliverStop: "停止",
	deliverTitle: "郵件推送",
	create: "新建簡報",
	custom: "定製我的簡報",
	customBody:
		"選主題、寫關鍵字、定時間。摘要只讀這些主題的來源，只看提到你關鍵字的內容。",
	delete: "刪除",
	deliveryNote: "可以在網頁裡看，也可以登入後每天寄到帳號信箱。",
	hour: "時間",
	keywords: "關鍵字",
	keywordsHint: "逗號分隔，最多 10 個；留空表示全部。",
	matching: "命中的內容",
	mine: "我的簡報",
	name: "名稱",
	namePlaceholder: "例如：Agent 與 MCP",
	none: "還沒有簡報。訂閱下面的主題簡報，或者定製一份。",
	official: "主題簡報",
	officialBody: "一鍵訂閱：一個主題的全部來源，每天 10 則。",
	seoDescription: "你自己的每日簡報：選主題和關鍵字，得到附引用的 10 則。",
	sources: "個來源",
	subscribe: "訂閱",
	subscribed: "已訂閱",
	title: "簡報",
	topics: "主題",
};

const STRINGS: Partial<Record<Locale, Strings>> & { en: Strings } = {
	en: EN,
	zh: ZH,
	"zh-Hant": ZH_HANT,
};

function getStrings(locale: Locale): Strings {
	return STRINGS[locale] ?? STRINGS.en;
}

const topicsQueryOptions = queryOptions<{ topics: TopicSummary[] }, Error>({
	queryKey: ["topics"],
	queryFn: async () => {
		const response = await fetch(`${env.VITE_SERVER_URL}/api/topics`, {
			credentials: "same-origin",
		});
		if (!response.ok) {
			throw new Error(`Failed to load topics (${response.status})`);
		}
		return (await response.json()) as { topics: TopicSummary[] };
	},
	staleTime: 60 * 60_000,
});

function useBriefings() {
	const [briefings, setBriefings] = useState<Briefing[]>([]);
	useEffect(() => {
		try {
			setBriefings(readBriefings(window.localStorage));
		} catch {
			setBriefings([]);
		}
	}, []);
	const persist = useCallback((next: Briefing[]) => {
		setBriefings(next);
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			/* Storage may be unavailable; the list still works for the session. */
		}
	}, []);
	return {
		add: (briefing: Briefing) => persist([...briefings, briefing]),
		briefings,
		remove: (id: string) => persist(briefings.filter((b) => b.id !== id)),
		update: (id: string, patch: Partial<Briefing>) =>
			persist(briefings.map((b) => (b.id === id ? { ...b, ...patch } : b))),
	};
}

// Asks the API to mail the briefing daily; the returned id is kept on the
// briefing so the reader can stop it from here too.
function Delivery({
	briefing,
	onChange,
	strings,
}: {
	briefing: Briefing;
	onChange: (patch: Partial<Briefing>) => void;
	strings: Strings;
}) {
	const locale = useLocale();
	const session = authClient.useSession();
	const [state, setState] = useState<
		"idle" | "sending" | "failed" | "unconfigured"
	>("idle");

	async function subscribe() {
		setState("sending");
		try {
			const response = await fetch(
				`${env.VITE_SERVER_URL}/api/briefings/subscriptions`,
				{
					body: JSON.stringify({
						hour: briefing.hour,
						keywords: briefing.keywords,
						lang: locale,
						name: briefing.name,
						sourceIds: briefing.sourceIds,
						tzOffsetMinutes: -new Date().getTimezoneOffset(),
					}),
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}
			);
			if (response.status === 503) {
				setState("unconfigured");
				return;
			}
			if (!response.ok) {
				setState("failed");
				return;
			}
			const { id } = (await response.json()) as { id: string };
			onChange({ subscriptionId: id });
			setState("idle");
		} catch {
			setState("failed");
		}
	}

	async function stop() {
		if (briefing.subscriptionId) {
			await fetch(
				`${env.VITE_SERVER_URL}/api/briefings/subscriptions/${briefing.subscriptionId}`,
				{ credentials: "include", method: "DELETE" }
			).catch(() => undefined);
		}
		onChange({ subscriptionId: undefined });
	}

	if (briefing.subscriptionId) {
		return (
			<p className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
				<span>
					{strings.deliverDone} {String(briefing.hour).padStart(2, "0")}:00
				</span>
				<button
					className="text-[var(--accent-blue)] hover:underline"
					onClick={stop}
					type="button"
				>
					{strings.deliverStop}
				</button>
			</p>
		);
	}
	if (session.isPending) {
		return (
			<span className="inline-block h-7 w-44 animate-pulse bg-[var(--state-hover-subtle)]" />
		);
	}
	if (!session.data?.user) {
		return (
			<p className="text-[12px] text-[var(--text-secondary)]">
				{strings.deliverSignIn}{" "}
				<Link
					className="text-[var(--accent-blue)] hover:underline"
					params={{ locale: localePathParam(locale) }}
					to="/{-$locale}/login"
				>
					{strings.deliverButton}
				</Link>
			</p>
		);
	}
	return (
		<form
			className="flex flex-wrap items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				subscribe();
			}}
		>
			<span className="text-[12px] text-[var(--text-muted)]">
				{strings.deliverBody}
			</span>
			<span className="text-[12px] text-[var(--text-primary)]">
				{session.data.user.email}
			</span>
			<button
				className={BUTTON_CLASS}
				disabled={state === "sending"}
				type="submit"
			>
				{strings.deliverButton}
			</button>
			{state === "failed" ? (
				<span className="text-[12px] text-[var(--accent-red)]">
					{strings.deliverFailed}
				</span>
			) : null}
			{state === "unconfigured" ? (
				<span className="text-[12px] text-[var(--text-muted)]">
					{strings.deliverNotConfigured}
				</span>
			) : null}
		</form>
	);
}

export const Route = createFileRoute("/{-$locale}/briefings")({
	component: BriefingsRoute,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		const strings = getStrings(locale);
		return buildSeo({
			title: strings.title,
			description: strings.seoDescription,
			path: "/briefings",
			locale,
		});
	},
});

const INPUT_CLASS =
	"w-full border border-[var(--border-default)] bg-[var(--surface-app)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]";
const BUTTON_CLASS =
	"inline-flex h-7 items-center gap-1.5 bg-[var(--accent-blue)] px-3 font-medium text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-40";
const GHOST_BUTTON_CLASS =
	"inline-flex h-7 items-center gap-1.5 border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]";

function topicLabel(topic: TopicSummary, t: ReturnType<typeof useT>): string {
	const key = `topic.${topic.id}` as TranslationKey;
	const translated = t(key);
	return translated === key ? topic.title : translated;
}

function BriefingForm({
	onSave,
	strings,
	topics,
}: {
	onSave: (briefing: Briefing) => void;
	strings: Strings;
	topics: TopicSummary[];
}) {
	const t = useT();
	const [name, setName] = useState("");
	const [topicIds, setTopicIds] = useState<string[]>([]);
	const [keywords, setKeywords] = useState("");
	const [hour, setHour] = useState<number>(DEFAULT_HOUR);
	const sourceIds = useMemo(
		() => sourcesForTopics(topicIds, topics),
		[topicIds, topics]
	);

	function toggleTopic(id: string) {
		setTopicIds((current) =>
			current.includes(id)
				? current.filter((value) => value !== id)
				: [...current, id]
		);
	}

	function save() {
		const parsedKeywords = parseKeywordInput(keywords);
		const fallbackName =
			topicIds.map((id) => t(`topic.${id}` as TranslationKey)).join(" · ") ||
			strings.custom;
		onSave({
			createdAt: Date.now(),
			hour,
			id: newBriefingId(),
			keywords: parsedKeywords,
			name: name.trim() || fallbackName,
			sourceIds,
			topicIds,
		});
		setName("");
		setTopicIds([]);
		setKeywords("");
	}

	return (
		<form
			className="space-y-4 border border-[var(--border-default)] bg-[var(--surface-card)] p-4"
			onSubmit={(event) => {
				event.preventDefault();
				save();
			}}
		>
			<label className="block space-y-1 text-[12px] text-[var(--text-muted)]">
				<span>{strings.name}</span>
				<input
					className={INPUT_CLASS}
					onChange={(event) => setName(event.target.value)}
					placeholder={strings.namePlaceholder}
					value={name}
				/>
			</label>
			<fieldset className="space-y-1.5">
				<legend className="text-[12px] text-[var(--text-muted)]">
					{strings.topics}
				</legend>
				<div className="flex flex-wrap gap-1.5">
					{topics.map((topic) => (
						<button
							aria-pressed={topicIds.includes(topic.id)}
							className="border border-[var(--border-default)] px-2.5 py-0.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-blue)] aria-pressed:border-[var(--accent-blue)] aria-pressed:bg-[var(--accent-blue-bg)] aria-pressed:text-[var(--accent-blue)]"
							key={topic.id}
							onClick={() => toggleTopic(topic.id)}
							type="button"
						>
							{topicLabel(topic, t)}
						</button>
					))}
				</div>
				<p className="text-[11px] text-[var(--text-muted)]">
					{sourceIds.length} {strings.sources}
				</p>
			</fieldset>
			<label className="block space-y-1 text-[12px] text-[var(--text-muted)]">
				<span>{strings.keywords}</span>
				<input
					className={INPUT_CLASS}
					onChange={(event) => setKeywords(event.target.value)}
					placeholder="GPT-6, MCP, 具身"
					value={keywords}
				/>
				<span className="block text-[11px]">{strings.keywordsHint}</span>
			</label>
			<label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
				<span>{strings.everyDay}</span>
				<select
					className="border border-[var(--border-default)] bg-[var(--surface-app)] px-2 py-1 text-[13px] text-[var(--text-primary)]"
					onChange={(event) => setHour(Number(event.target.value))}
					value={hour}
				>
					{HOURS.map((value) => (
						<option key={value} value={value}>
							{String(value).padStart(2, "0")}:00
						</option>
					))}
				</select>
				<span className="text-[11px]">{strings.deliveryNote}</span>
			</label>
			<button
				className={BUTTON_CLASS}
				disabled={sourceIds.length === 0}
				type="submit"
			>
				<Plus className="size-3.5" />
				{strings.save}
			</button>
		</form>
	);
}

// The briefing itself: its digest, then the items that matched.
function BriefingView({
	briefing,
	strings,
}: {
	briefing: Briefing;
	strings: Strings;
}) {
	const locale = useLocale();
	const t = useT();
	const page = useQuery(
		trendsPageQueryOptions("mine", locale, briefing.sourceIds)
	);
	const items = useMemo(() => {
		if (!page.data) {
			return [];
		}
		const all = page.data.sections.flatMap((section) =>
			section.sources.flatMap((source) =>
				source.items.map((item) => ({ item, source }))
			)
		);
		const matched = new Set(
			matchingItems(
				all.map(({ item }) => item),
				briefing.keywords
			).map((item) => item.url)
		);
		return all
			.filter(({ item }) => matched.has(item.url))
			.sort(
				(a, b) =>
					(b.item.publishedAt ?? b.item.fetchedAt) -
					(a.item.publishedAt ?? a.item.fetchedAt)
			)
			.slice(0, ITEM_LIMIT);
	}, [page.data, briefing.keywords]);

	if (!page.data) {
		return (
			<div className="h-10 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)]" />
		);
	}
	return (
		<div className="overflow-hidden border border-[var(--border-default)]">
			<TrendsSummary
				collapsed={false}
				keywords={briefing.keywords}
				onCollapsedChange={() => undefined}
				page={page.data}
				title={briefing.name}
				topicId="mine"
			/>
			<div className="border-[var(--border-default)] border-t bg-[var(--surface-card)]">
				<h3 className="px-4 pt-3 pb-1 font-semibold text-[12px] text-[var(--text-muted)]">
					{strings.matching} · {items.length}
				</h3>
				<ul className="divide-y divide-[var(--border-subtle)]">
					{items.map(({ item, source }) => (
						<li key={item.url}>
							<a
								className="flex items-center gap-2 px-4 py-2 text-[13px] text-[var(--text-primary)] transition-colors visited:text-[#9b9893] hover:bg-[var(--state-hover-subtle)] dark:visited:text-[#6f685f]"
								href={item.url}
								rel="noopener noreferrer"
								target="_blank"
							>
								<SourceFavicon homeUrl={source.homeUrl} />
								<span className="min-w-0 flex-1 truncate">{item.title}</span>
								<span className="shrink-0 text-[11px] text-[var(--text-muted)]">
									{source.title}
									{item.publishedAt
										? ` · ${formatRelativeTime(item.publishedAt, t)}`
										: ""}
								</span>
							</a>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

function BriefingsRoute() {
	const params = Route.useParams();
	const locale = resolveLocale(params.locale);
	const strings = getStrings(locale);
	const t = useT();
	const topics = useQuery(topicsQueryOptions);
	const { add, briefings, remove, update } = useBriefings();
	const [openId, setOpenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const open = briefings.find((b) => b.id === openId) ?? briefings[0];
	const subscribedTopics = new Set(
		briefings
			.filter((b) => b.keywords.length === 0 && b.topicIds.length === 1)
			.map((b) => b.topicIds[0])
	);

	function subscribeTopic(topic: TopicSummary) {
		add({
			createdAt: Date.now(),
			hour: DEFAULT_HOUR,
			id: newBriefingId(),
			keywords: [],
			name: topicLabel(topic, t),
			sourceIds: topic.sourceIds,
			topicIds: [topic.id],
		});
	}

	return (
		<ScrollArea className="min-w-0 flex-1 bg-[var(--surface-sidebar)] text-[var(--text-primary)]">
			<div className="mx-auto w-full max-w-4xl space-y-8 p-6 sm:p-10">
				<header className="flex items-end justify-between gap-4">
					<div>
						<h1 className="font-bold text-2xl text-[var(--text-heading)] tracking-tight">
							{strings.mine}
						</h1>
					</div>
					<button
						className={GHOST_BUTTON_CLASS}
						onClick={() => setCreating((value) => !value)}
						type="button"
					>
						<Plus className="size-3.5" />
						{strings.create}
					</button>
				</header>

				{creating && topics.data ? (
					<section className="space-y-2">
						<h2 className="font-semibold text-[15px] text-[var(--text-heading)]">
							{strings.custom}
						</h2>
						<p className="text-[13px] text-[var(--text-secondary)]">
							{strings.customBody}
						</p>
						<BriefingForm
							onSave={(briefing) => {
								add(briefing);
								setOpenId(briefing.id);
								setCreating(false);
							}}
							strings={strings}
							topics={topics.data.topics}
						/>
					</section>
				) : null}

				{briefings.length === 0 ? (
					<p className="text-[13px] text-[var(--text-secondary)]">
						{strings.none}
					</p>
				) : (
					<div className="space-y-4">
						<div className="flex flex-wrap gap-1.5">
							{briefings.map((briefing) => (
								<span className="inline-flex items-center" key={briefing.id}>
									<button
										aria-pressed={open?.id === briefing.id}
										className="border border-[var(--border-default)] px-3 py-1 text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] aria-pressed:border-[var(--accent-blue)] aria-pressed:bg-[var(--accent-blue-bg)] aria-pressed:text-[var(--accent-blue)]"
										onClick={() => setOpenId(briefing.id)}
										type="button"
									>
										{briefing.name}
									</button>
									<button
										aria-label={strings.delete}
										className="border border-[var(--border-default)] border-l-0 px-2 py-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-red)]"
										onClick={() => remove(briefing.id)}
										title={strings.delete}
										type="button"
									>
										<Trash2 className="size-3.5" />
									</button>
								</span>
							))}
						</div>
						{open ? (
							<>
								<p className="text-[12px] text-[var(--text-muted)]">
									{strings.everyDay} {String(open.hour).padStart(2, "0")}:00 ·{" "}
									{open.sourceIds.length} {strings.sources}
									{open.keywords.length > 0
										? ` · ${open.keywords.join(", ")}`
										: ""}
								</p>
								<Delivery
									briefing={open}
									onChange={(patch) => update(open.id, patch)}
									strings={strings}
								/>
								<BriefingView briefing={open} strings={strings} />
							</>
						) : null}
					</div>
				)}

				<section className="space-y-3">
					<h2 className="font-semibold text-[15px] text-[var(--text-heading)]">
						{strings.official}
					</h2>
					<p className="text-[13px] text-[var(--text-secondary)]">
						{strings.officialBody}
					</p>
					<ul className="grid grid-cols-1 gap-px border border-[var(--border-default)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-3">
						{(topics.data?.topics ?? []).map((topic) => {
							const done = subscribedTopics.has(topic.id);
							return (
								<li
									className="flex items-center gap-3 bg-[var(--surface-card)] px-4 py-3"
									key={topic.id}
								>
									<span className="min-w-0 flex-1 space-y-0.5">
										<span className="block font-semibold text-[13px] text-[var(--text-heading)]">
											{topicLabel(topic, t)}
										</span>
										{locale === "en" && topic.description ? (
											<span className="block text-[12px] text-[var(--text-secondary)]">
												{topic.description}
											</span>
										) : null}
										<span className="block text-[11px] text-[var(--text-muted)]">
											{topic.sourceIds.length} {strings.sources} ·{" "}
											{strings.everyDay} 08:00
										</span>
									</span>
									<button
										className={done ? GHOST_BUTTON_CLASS : BUTTON_CLASS}
										disabled={done}
										onClick={() => subscribeTopic(topic)}
										type="button"
									>
										{done ? strings.subscribed : strings.subscribe}
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			</div>
		</ScrollArea>
	);
}
