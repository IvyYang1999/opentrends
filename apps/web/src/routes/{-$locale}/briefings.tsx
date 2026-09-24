import { env } from "@opentrends/env/web";
import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	type Briefing,
	type BriefingScope,
	briefingScope,
	DEFAULT_HOUR,
	matchingItems,
	newBriefingId,
	parseKeywordInput,
	readBriefings,
	resolveBriefingSources,
	STORAGE_KEY,
	type TopicSummary,
} from "@/components/trends/briefing-model";
import { useFollowedSources } from "@/components/trends/followed-sources";
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

// A reader's own digests. A briefing says what it reads (everything, the
// follow list, or some topics), a few keywords to narrow that, and an hour.
// The digest is the same ten lines the topics get, drawn only from those.
// Briefings live in the browser like the follow list; signed-in readers can
// have one mailed to their account address every day.

const HOURS = [6, 7, 8, 9, 12, 18, 20, 22] as const;
const ITEM_LIMIT = 40;
const SCOPES: BriefingScope[] = ["all", "followed", "topics"];

interface Strings {
	cancel: string;
	create: string;
	delete: string;
	deliverBody: string;
	deliverButton: string;
	deliverDone: string;
	deliverFailed: string;
	deliverNotConfigured: string;
	deliverSignIn: string;
	deliverStop: string;
	edit: string;
	editTitle: string;
	everyDay: string;
	keywords: string;
	keywordsHint: string;
	loading: string;
	matching: string;
	mine: string;
	name: string;
	namePlaceholder: string;
	newTitle: string;
	none: string;
	official: string;
	officialBody: string;
	ruleDelivery: string;
	ruleHour: string;
	ruleKeywords: string;
	ruleScope: string;
	rules: string;
	save: string;
	scope: string;
	scopeAll: string;
	scopeFollowed: string;
	scopeFollowedEmpty: string;
	scopeTopics: string;
	sendNow: string;
	sendNowDone: string;
	sendNowEmpty: string;
	sendNowFailed: string;
	seoDescription: string;
	sources: string;
	subscribe: string;
	subscribed: string;
	title: string;
	webOnly: string;
}

const EN: Strings = {
	cancel: "Cancel",
	create: "New briefing",
	deliverBody: "Mail it to",
	deliverButton: "Send it to me",
	deliverDone: "Mailed daily at",
	deliverFailed: "Could not subscribe; try again.",
	deliverNotConfigured: "Mail delivery is not set up on this deployment yet.",
	deliverSignIn: "Sign in to have it mailed to your account address.",
	deliverStop: "Stop",
	sendNow: "Send one now",
	sendNowDone: "Sent. Check your inbox.",
	sendNowEmpty: "Nothing to send today yet.",
	sendNowFailed: "Could not send; try again.",
	rules: "Rules",
	ruleScope: "Scope",
	ruleKeywords: "Keywords",
	ruleHour: "Time",
	ruleDelivery: "Delivery",
	loading: "Building the briefing…",
	delete: "Delete",
	edit: "Edit",
	editTitle: "Edit briefing",
	everyDay: "Every day at",
	keywords: "Keywords",
	keywordsHint: "Comma-separated, up to ten. Empty means everything.",
	matching: "Matching items",
	mine: "My briefings",
	name: "Name",
	namePlaceholder: "e.g. Agents & MCP",
	newTitle: "New briefing",
	none: "No briefings yet. Make one, or subscribe to a topic below.",
	official: "Topic briefings",
	officialBody:
		"A whole topic, ten lines a day. Subscribing opens the form so you can set the hour.",
	save: "Save",
	scope: "Reads",
	scopeAll: "Everything",
	scopeFollowed: "Sources I follow",
	scopeFollowedEmpty: "You are not following any source yet.",
	scopeTopics: "Topics",
	seoDescription:
		"Your own daily digest: pick what it reads and a few keywords, get ten lines with citations.",
	sources: "sources",
	subscribe: "Subscribe",
	subscribed: "Subscribed",
	title: "Briefings",
	webOnly: "On this page",
};

const ZH: Strings = {
	cancel: "取消",
	create: "新建简报",
	deliverBody: "发到邮箱",
	deliverButton: "开启推送",
	deliverDone: "每天推送，",
	deliverFailed: "订阅没成功，再试一次。",
	deliverNotConfigured: "这个部署还没接邮件服务。",
	deliverSignIn: "登录后可以每天发到账号邮箱。",
	deliverStop: "停止",
	sendNow: "现在发一封",
	sendNowDone: "已发送，去邮箱看看。",
	sendNowEmpty: "今天还没有可发的内容。",
	sendNowFailed: "发送失败，再试一次。",
	rules: "规则",
	ruleScope: "范围",
	ruleKeywords: "关键词",
	ruleHour: "时间",
	ruleDelivery: "投递",
	loading: "正在生成简报…",
	delete: "删除",
	edit: "编辑",
	editTitle: "编辑简报",
	everyDay: "每天",
	keywords: "关键词",
	keywordsHint: "逗号分隔，最多 10 个；留空表示全部。",
	matching: "命中的内容",
	mine: "我的简报",
	name: "名称",
	namePlaceholder: "例如：Agent 与 MCP",
	newTitle: "新建简报",
	none: "还没有简报。新建一份，或者订阅下面的主题简报。",
	official: "主题简报",
	officialBody:
		"一个主题的全部来源，每天 10 条。点订阅会打开表单，可以先定时间。",
	save: "保存",
	scope: "读什么",
	scopeAll: "全部主题",
	scopeFollowed: "我关注的来源",
	scopeFollowedEmpty: "你还没有关注任何来源。",
	scopeTopics: "选主题",
	seoDescription: "你自己的每日简报：选读什么和关键词，得到带引用的 10 条。",
	sources: "个来源",
	subscribe: "订阅",
	subscribed: "已订阅",
	title: "简报",
	webOnly: "网页查看",
};

const ZH_HANT: Strings = {
	...ZH,
	cancel: "取消",
	create: "新建簡報",
	deliverBody: "寄到信箱",
	deliverButton: "開啟推送",
	deliverDone: "每天推送，",
	deliverFailed: "訂閱沒成功，再試一次。",
	deliverNotConfigured: "這個部署還沒接郵件服務。",
	deliverSignIn: "登入後可以每天寄到帳號信箱。",
	deliverStop: "停止",
	sendNow: "現在發一封",
	sendNowDone: "已寄出，去信箱看看。",
	sendNowEmpty: "今天還沒有可寄的內容。",
	sendNowFailed: "寄送失敗，再試一次。",
	rules: "規則",
	ruleScope: "範圍",
	ruleKeywords: "關鍵字",
	ruleHour: "時間",
	ruleDelivery: "投遞",
	loading: "正在產生簡報…",
	delete: "刪除",
	edit: "編輯",
	editTitle: "編輯簡報",
	keywords: "關鍵字",
	keywordsHint: "逗號分隔，最多 10 個；留空表示全部。",
	matching: "命中的內容",
	mine: "我的簡報",
	name: "名稱",
	namePlaceholder: "例如：Agent 與 MCP",
	newTitle: "新建簡報",
	none: "還沒有簡報。新建一份，或者訂閱下面的主題簡報。",
	official: "主題簡報",
	officialBody:
		"一個主題的全部來源，每天 10 則。點訂閱會打開表單，可以先定時間。",
	save: "儲存",
	scope: "讀什麼",
	scopeAll: "全部主題",
	scopeFollowed: "我關注的來源",
	scopeFollowedEmpty: "你還沒有關注任何來源。",
	scopeTopics: "選主題",
	seoDescription: "你自己的每日簡報：選讀什麼和關鍵字，得到附引用的 10 則。",
	sources: "個來源",
	subscribe: "訂閱",
	subscribed: "已訂閱",
	title: "簡報",
	webOnly: "網頁檢視",
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

async function createSubscription(
	briefing: Briefing,
	sourceIds: string[],
	locale: string
): Promise<{ id: string } | { error: "unconfigured" | "failed" }> {
	try {
		const response = await fetch(
			`${env.VITE_SERVER_URL}/api/briefings/subscriptions`,
			{
				body: JSON.stringify({
					hour: briefing.hour,
					keywords: briefing.keywords,
					lang: locale,
					name: briefing.name,
					sourceIds,
					tzOffsetMinutes: -new Date().getTimezoneOffset(),
				}),
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}
		);
		if (response.status === 503) {
			return { error: "unconfigured" };
		}
		if (!response.ok) {
			return { error: "failed" };
		}
		return (await response.json()) as { id: string };
	} catch {
		return { error: "failed" };
	}
}

async function sendSubscriptionNow(
	id: string
): Promise<"sent" | "empty" | "failed"> {
	try {
		const response = await fetch(
			`${env.VITE_SERVER_URL}/api/briefings/subscriptions/${id}/send`,
			{ credentials: "include", method: "POST" }
		);
		if (!response.ok) {
			return "failed";
		}
		const body = (await response.json()) as { outcome: "sent" | "empty" };
		return body.outcome;
	} catch {
		return "failed";
	}
}

async function deleteSubscription(id: string): Promise<void> {
	await fetch(`${env.VITE_SERVER_URL}/api/briefings/subscriptions/${id}`, {
		credentials: "include",
		method: "DELETE",
	}).catch(() => undefined);
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
const CHIP_CLASS =
	"inline-flex h-7 items-center border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] aria-pressed:border-[var(--text-heading)] aria-pressed:bg-[var(--text-heading)] aria-pressed:text-[var(--surface-app)]";
// The briefing list: a tab strip. The open one is the dark tab.
const TAB_CLASS =
	"group inline-flex h-8 items-stretch border border-[var(--border-default)] bg-[var(--surface-card)] text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] data-[active=true]:border-[var(--text-heading)] data-[active=true]:bg-[var(--text-heading)] data-[active=true]:text-[var(--surface-app)]";
const TAG_CLASS =
	"inline-flex h-6 items-center border border-[var(--accent-blue)]/40 bg-[var(--accent-blue-bg)] px-2 font-medium text-[12px] text-[var(--accent-blue)]";

function topicLabel(topic: TopicSummary, t: ReturnType<typeof useT>): string {
	const key = `topic.${topic.id}` as TranslationKey;
	const translated = t(key);
	return translated === key ? topic.title : translated;
}

function scopeLabel(
	briefing: Briefing,
	topics: readonly TopicSummary[],
	strings: Strings,
	t: ReturnType<typeof useT>
): string {
	switch (briefingScope(briefing)) {
		case "all":
			return strings.scopeAll;
		case "followed":
			return strings.scopeFollowed;
		default:
			return (
				briefing.topicIds
					.map((id) => {
						const topic = topics.find((entry) => entry.id === id);
						return topic ? topicLabel(topic, t) : id;
					})
					.join(" · ") || strings.scopeTopics
			);
	}
}

interface FormValues {
	hour: number;
	keywords: string;
	name: string;
	scope: BriefingScope;
	topicIds: string[];
}

function BriefingForm({
	followedCount,
	initial,
	onCancel,
	onSave,
	strings,
	title,
	topics,
}: {
	followedCount: number;
	initial: FormValues;
	onCancel: () => void;
	onSave: (values: FormValues) => void;
	strings: Strings;
	title: string;
	topics: TopicSummary[];
}) {
	const t = useT();
	const [values, setValues] = useState<FormValues>(initial);
	const keywords = parseKeywordInput(values.keywords);
	const scopeLabels: Record<BriefingScope, string> = {
		all: strings.scopeAll,
		followed: strings.scopeFollowed,
		topics: strings.scopeTopics,
	};
	const ready =
		values.scope === "all" ||
		(values.scope === "followed" && followedCount > 0) ||
		(values.scope === "topics" && values.topicIds.length > 0);

	function toggleTopic(id: string) {
		setValues((current) => ({
			...current,
			topicIds: current.topicIds.includes(id)
				? current.topicIds.filter((value) => value !== id)
				: [...current.topicIds, id],
		}));
	}

	return (
		<form
			className="space-y-4 border border-[var(--border-default)] bg-[var(--surface-card)] p-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSave(values);
			}}
		>
			<h2 className="font-semibold text-[14px] text-[var(--text-heading)]">
				{title}
			</h2>
			<label className="block space-y-1 text-[12px] text-[var(--text-muted)]">
				<span>{strings.name}</span>
				<input
					className={INPUT_CLASS}
					onChange={(event) =>
						setValues((current) => ({ ...current, name: event.target.value }))
					}
					placeholder={strings.namePlaceholder}
					value={values.name}
				/>
			</label>
			<fieldset className="space-y-2">
				<legend className="text-[12px] text-[var(--text-muted)]">
					{strings.scope}
				</legend>
				<div className="flex flex-wrap gap-1.5">
					{SCOPES.map((scope) => (
						<button
							aria-pressed={values.scope === scope}
							className={CHIP_CLASS}
							key={scope}
							onClick={() => setValues((current) => ({ ...current, scope }))}
							type="button"
						>
							{scopeLabels[scope]}
						</button>
					))}
				</div>
				{values.scope === "topics" ? (
					<div className="flex flex-wrap gap-1.5">
						{topics.map((topic) => (
							<button
								aria-pressed={values.topicIds.includes(topic.id)}
								className={CHIP_CLASS}
								key={topic.id}
								onClick={() => toggleTopic(topic.id)}
								type="button"
							>
								{topicLabel(topic, t)}
							</button>
						))}
					</div>
				) : null}
				{values.scope === "followed" && followedCount === 0 ? (
					<p className="text-[12px] text-[var(--accent-red)]">
						{strings.scopeFollowedEmpty}
					</p>
				) : null}
			</fieldset>
			<label className="block space-y-1 text-[12px] text-[var(--text-muted)]">
				<span>{strings.keywords}</span>
				<input
					className={INPUT_CLASS}
					onChange={(event) =>
						setValues((current) => ({
							...current,
							keywords: event.target.value,
						}))
					}
					placeholder="GPT-6, MCP, 具身"
					value={values.keywords}
				/>
				{keywords.length > 0 ? (
					<span className="flex flex-wrap gap-1 pt-1">
						{keywords.map((keyword) => (
							<span className={TAG_CLASS} key={keyword}>
								{keyword}
							</span>
						))}
					</span>
				) : (
					<span className="block text-[11px]">{strings.keywordsHint}</span>
				)}
			</label>
			<label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
				<span>{strings.everyDay}</span>
				<select
					className="h-7 border border-[var(--border-default)] bg-[var(--surface-app)] px-2 text-[13px] text-[var(--text-primary)]"
					onChange={(event) =>
						setValues((current) => ({
							...current,
							hour: Number(event.target.value),
						}))
					}
					value={values.hour}
				>
					{HOURS.map((value) => (
						<option key={value} value={value}>
							{String(value).padStart(2, "0")}:00
						</option>
					))}
				</select>
			</label>
			<div className="flex items-center gap-2">
				<button className={BUTTON_CLASS} disabled={!ready} type="submit">
					{strings.save}
				</button>
				<button className={GHOST_BUTTON_CLASS} onClick={onCancel} type="button">
					{strings.cancel}
				</button>
			</div>
		</form>
	);
}

// Mail delivery for one briefing. Only a signed-in reader can ask, and only
// to the account address; the server refuses anything else.
function Delivery({
	briefing,
	onChange,
	sourceIds,
	strings,
}: {
	briefing: Briefing;
	onChange: (patch: Partial<Briefing>) => void;
	sourceIds: string[];
	strings: Strings;
}) {
	const locale = useLocale();
	const session = authClient.useSession();
	const [state, setState] = useState<
		"idle" | "sending" | "failed" | "unconfigured"
	>("idle");

	async function subscribe() {
		setState("sending");
		const result = await createSubscription(briefing, sourceIds, locale);
		if ("error" in result) {
			setState(result.error);
			return;
		}
		onChange({ subscriptionId: result.id });
		setState("idle");
	}

	async function stop() {
		if (briefing.subscriptionId) {
			await deleteSubscription(briefing.subscriptionId);
		}
		onChange({ subscriptionId: undefined });
	}

	if (briefing.subscriptionId) {
		return (
			<SubscribedDelivery
				briefing={briefing}
				onStop={stop}
				strings={strings}
				subscriptionId={briefing.subscriptionId}
			/>
		);
	}
	if (session.isPending) {
		return (
			<span className="inline-block h-7 w-44 animate-pulse bg-[var(--state-hover-subtle)]" />
		);
	}
	if (!session.data?.user) {
		return (
			<span className="text-[12px] text-[var(--text-secondary)]">
				{strings.webOnly} · {strings.deliverSignIn}{" "}
				<Link
					className="text-[var(--accent-blue)] hover:underline"
					params={{ locale: localePathParam(locale) }}
					to="/{-$locale}/login"
				>
					{strings.deliverButton}
				</Link>
			</span>
		);
	}
	return (
		<span className="inline-flex flex-wrap items-center gap-2 text-[12px]">
			<span className="text-[var(--text-muted)]">{strings.deliverBody}</span>
			<span className="text-[var(--text-primary)]">
				{session.data.user.email}
			</span>
			<button
				className={BUTTON_CLASS}
				disabled={state === "sending"}
				onClick={subscribe}
				type="button"
			>
				{strings.deliverButton}
			</button>
			{state === "failed" ? (
				<span className="text-[var(--accent-red)]">
					{strings.deliverFailed}
				</span>
			) : null}
			{state === "unconfigured" ? (
				<span className="text-[var(--text-muted)]">
					{strings.deliverNotConfigured}
				</span>
			) : null}
		</span>
	);
}

function SubscribedDelivery({
	briefing,
	onStop,
	strings,
	subscriptionId,
}: {
	briefing: Briefing;
	onStop: () => void;
	strings: Strings;
	subscriptionId: string;
}) {
	const [state, setState] = useState<
		"idle" | "sending" | "sent" | "empty" | "failed"
	>("idle");
	async function sendNow() {
		setState("sending");
		setState(await sendSubscriptionNow(subscriptionId));
	}
	const note = {
		empty: strings.sendNowEmpty,
		failed: strings.sendNowFailed,
		idle: "",
		sending: "…",
		sent: strings.sendNowDone,
	}[state];
	return (
		<span className="inline-flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
			<span>
				{strings.deliverDone} {String(briefing.hour).padStart(2, "0")}:00
			</span>
			<button
				className={GHOST_BUTTON_CLASS}
				disabled={state === "sending"}
				onClick={sendNow}
				type="button"
			>
				<Send className="size-3" />
				{strings.sendNow}
			</button>
			<button
				className="text-[var(--text-muted)] hover:text-[var(--accent-red)]"
				onClick={onStop}
				type="button"
			>
				{strings.deliverStop}
			</button>
			{note ? (
				<span
					className={
						state === "failed"
							? "text-[var(--accent-red)]"
							: "text-[var(--text-muted)]"
					}
				>
					{note}
				</span>
			) : null}
		</span>
	);
}

// Stands in for the briefing while its page is built: the digest's rows,
// then a few item rows, at the heights the real ones take.
function BriefingSkeleton({ label }: { label: string }) {
	return (
		<div
			aria-busy="true"
			className="border border-[var(--border-default)]"
			role="status"
		>
			<div className="space-y-2 bg-[var(--surface-card)] px-4 py-3">
				<div className="flex items-center justify-between">
					<span className="h-4 w-32 animate-pulse bg-[var(--state-hover-subtle)]" />
					<span className="text-[11px] text-[var(--text-muted)]">{label}</span>
				</div>
				{[0, 1, 2, 3, 4].map((row) => (
					<span
						className="block h-[23px] animate-pulse bg-[var(--state-hover-subtle)]"
						key={row}
						style={{ width: `${88 - row * 7}%` }}
					/>
				))}
			</div>
			<ul className="divide-y divide-[var(--border-subtle)] border-[var(--border-default)] border-t bg-[var(--surface-card)]">
				{[0, 1, 2, 3, 4, 5].map((row) => (
					<li className="flex items-center gap-2 px-4 py-2" key={row}>
						<span className="size-4 animate-pulse bg-[var(--state-hover-subtle)]" />
						<span
							className="h-4 animate-pulse bg-[var(--state-hover-subtle)]"
							style={{ width: `${70 - (row % 3) * 12}%` }}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}

// The briefing itself: its digest, then the items that matched.
function BriefingView({
	briefing,
	sourceIds,
	strings,
}: {
	briefing: Briefing;
	sourceIds: string[];
	strings: Strings;
}) {
	const locale = useLocale();
	const t = useT();
	const page = useQuery({
		...trendsPageQueryOptions("mine", locale, sourceIds),
		enabled: sourceIds.length > 0,
	});
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
		return <BriefingSkeleton label={strings.loading} />;
	}
	return (
		<div className="border border-[var(--border-default)]">
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

// The open briefing: its rules, then the briefing itself.
function OpenBriefing({
	onChange,
	onEdit,
	onRemove,
	open,
	openSources,
	strings,
	topicList,
	topicsLoaded,
}: {
	onChange: (patch: Partial<Briefing>) => void;
	onEdit: (briefing: Briefing) => void;
	onRemove: (briefing: Briefing) => void;
	open: Briefing;
	openSources: string[];
	strings: Strings;
	topicList: readonly TopicSummary[];
	topicsLoaded: boolean;
}) {
	const t = useT();
	return (
		<>
			<dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-3 text-[13px] sm:grid-cols-[auto_1fr_auto_1fr]">
				<dt className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">
					{strings.ruleScope}
				</dt>
				<dd className="flex flex-wrap items-center gap-2 text-[var(--text-primary)]">
					<span className="font-medium">
						{scopeLabel(open, topicList, strings, t)}
					</span>
					{topicsLoaded ? (
						<span className="text-[var(--text-muted)]">
							{openSources.length} {strings.sources}
						</span>
					) : null}
				</dd>
				<dt className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">
					{strings.ruleKeywords}
				</dt>
				<dd className="flex flex-wrap gap-1">
					{open.keywords.length > 0 ? (
						open.keywords.map((keyword) => (
							<span className={TAG_CLASS} key={keyword}>
								{keyword}
							</span>
						))
					) : (
						<span className="text-[var(--text-muted)]">
							{strings.keywordsHint}
						</span>
					)}
				</dd>
				<dt className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">
					{strings.ruleHour}
				</dt>
				<dd className="flex flex-wrap items-center gap-3 text-[var(--text-primary)]">
					<span className="font-medium tabular-nums">
						{strings.everyDay} {String(open.hour).padStart(2, "0")}:00
					</span>
					<button
						className="inline-flex items-center gap-1 text-[12px] text-[var(--accent-blue)] hover:underline"
						onClick={() => onEdit(open)}
						type="button"
					>
						<Pencil className="size-3" />
						{strings.edit}
					</button>
					<button
						className="inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--accent-red)]"
						onClick={() => onRemove(open)}
						type="button"
					>
						<Trash2 className="size-3" />
						{strings.delete}
					</button>
				</dd>
				<dt className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">
					{strings.ruleDelivery}
				</dt>
				<dd>
					<Delivery
						briefing={open}
						onChange={onChange}
						sourceIds={openSources}
						strings={strings}
					/>
				</dd>
			</dl>
			{openSources.length > 0 ? (
				<BriefingView
					briefing={open}
					sourceIds={openSources}
					strings={strings}
				/>
			) : null}
			{openSources.length === 0 && !topicsLoaded ? (
				<BriefingSkeleton label={strings.loading} />
			) : null}
			{openSources.length === 0 && topicsLoaded ? (
				<p className="text-[12px] text-[var(--accent-red)]">
					{strings.scopeFollowedEmpty}
				</p>
			) : null}
		</>
	);
}

type FormState =
	| { kind: "closed" }
	| { kind: "new"; initial: FormValues }
	| { kind: "edit"; id: string; initial: FormValues };

function BriefingsRoute() {
	const params = Route.useParams();
	const locale = resolveLocale(params.locale);
	const strings = getStrings(locale);
	const t = useT();
	const topics = useQuery(topicsQueryOptions);
	const topicList = topics.data?.topics ?? [];
	const { followedIds } = useFollowedSources();
	const { add, briefings, remove, update } = useBriefings();
	const [openId, setOpenId] = useState<string | null>(null);
	const [form, setForm] = useState<FormState>({ kind: "closed" });
	const open = briefings.find((b) => b.id === openId) ?? briefings[0];
	const openSources = open
		? resolveBriefingSources(open, topicList, followedIds)
		: [];
	const subscribedTopics = new Set(
		briefings
			.filter(
				(b) =>
					briefingScope(b) === "topics" &&
					b.keywords.length === 0 &&
					b.topicIds.length === 1
			)
			.map((b) => b.topicIds[0])
	);

	function blankForm(overrides: Partial<FormValues> = {}): FormValues {
		return {
			hour: DEFAULT_HOUR,
			keywords: "",
			name: "",
			scope: "topics",
			topicIds: [],
			...overrides,
		};
	}

	function save(values: FormValues) {
		const keywords = parseKeywordInput(values.keywords);
		const topicIds = values.scope === "topics" ? values.topicIds : [];
		const scopeNames: Record<BriefingScope, string> = {
			all: strings.scopeAll,
			followed: strings.scopeFollowed,
			topics: topicIds
				.map((id) => t(`topic.${id}` as TranslationKey))
				.join(" · "),
		};
		const scopeName = scopeNames[values.scope];
		const fields = {
			hour: values.hour,
			keywords,
			name: values.name.trim() || scopeName,
			scope: values.scope,
			sourceIds: resolveBriefingSources(
				{
					createdAt: 0,
					hour: values.hour,
					id: "",
					keywords,
					name: "",
					scope: values.scope,
					sourceIds: [],
					topicIds,
				},
				topicList,
				followedIds
			),
			topicIds,
		};
		if (form.kind === "edit") {
			const existing = briefings.find((b) => b.id === form.id);
			// A mailed briefing is re-registered with its new shape.
			if (existing?.subscriptionId) {
				const previous = existing.subscriptionId;
				createSubscription(
					{ ...existing, ...fields },
					fields.sourceIds,
					locale
				).then((result) => {
					deleteSubscription(previous);
					update(form.id, {
						subscriptionId: "error" in result ? undefined : result.id,
					});
				});
			}
			update(form.id, fields);
			setOpenId(form.id);
		} else {
			const briefing: Briefing = {
				...fields,
				createdAt: Date.now(),
				id: newBriefingId(),
			};
			add(briefing);
			setOpenId(briefing.id);
		}
		setForm({ kind: "closed" });
	}

	function startEdit(briefing: Briefing) {
		setForm({
			id: briefing.id,
			initial: {
				hour: briefing.hour,
				keywords: briefing.keywords.join(", "),
				name: briefing.name,
				scope: briefingScope(briefing),
				topicIds: briefing.topicIds,
			},
			kind: "edit",
		});
	}

	async function removeBriefing(briefing: Briefing) {
		if (briefing.subscriptionId) {
			await deleteSubscription(briefing.subscriptionId);
		}
		remove(briefing.id);
		if (form.kind === "edit" && form.id === briefing.id) {
			setForm({ kind: "closed" });
		}
	}

	return (
		<ScrollArea className="min-w-0 flex-1 bg-[var(--surface-sidebar)] text-[var(--text-primary)]">
			<div className="mx-auto w-full max-w-4xl space-y-6 p-6 sm:p-10">
				<header className="flex items-center justify-between gap-4">
					<h1 className="font-bold text-2xl text-[var(--text-heading)] tracking-tight">
						{strings.mine}
					</h1>
					<button
						className={GHOST_BUTTON_CLASS}
						onClick={() =>
							setForm(
								form.kind === "new"
									? { kind: "closed" }
									: { initial: blankForm(), kind: "new" }
							)
						}
						type="button"
					>
						<Plus className="size-3.5" />
						{strings.create}
					</button>
				</header>

				{form.kind !== "closed" && topics.data ? (
					<BriefingForm
						followedCount={followedIds.length}
						initial={form.initial}
						key={form.kind === "edit" ? form.id : "new"}
						onCancel={() => setForm({ kind: "closed" })}
						onSave={save}
						strings={strings}
						title={form.kind === "edit" ? strings.editTitle : strings.newTitle}
						topics={topics.data.topics}
					/>
				) : null}

				{briefings.length === 0 ? (
					<p className="text-[13px] text-[var(--text-secondary)]">
						{strings.none}
					</p>
				) : (
					<section className="space-y-3">
						<div className="flex flex-wrap gap-1.5">
							{briefings.map((briefing) => (
								<span
									className={TAB_CLASS}
									data-active={open?.id === briefing.id}
									key={briefing.id}
								>
									<button
										className="inline-flex items-center pr-2 pl-3 font-medium"
										onClick={() => setOpenId(briefing.id)}
										type="button"
									>
										{briefing.name}
									</button>
									<button
										aria-label={strings.delete}
										className="inline-flex w-7 items-center justify-center border-current/20 border-l opacity-60 transition-opacity hover:opacity-100"
										onClick={() => removeBriefing(briefing)}
										title={strings.delete}
										type="button"
									>
										<X className="size-3" />
									</button>
								</span>
							))}
						</div>
						{open ? (
							<OpenBriefing
								onChange={(patch) => update(open.id, patch)}
								onEdit={startEdit}
								onRemove={removeBriefing}
								open={open}
								openSources={openSources}
								strings={strings}
								topicList={topicList}
								topicsLoaded={Boolean(topics.data)}
							/>
						) : null}
					</section>
				)}

				<section className="space-y-3">
					<h2 className="font-semibold text-[15px] text-[var(--text-heading)]">
						{strings.official}
					</h2>
					<p className="text-[13px] text-[var(--text-secondary)]">
						{strings.officialBody}
					</p>
					<ul className="grid grid-cols-1 gap-px border border-[var(--border-default)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-3">
						{topicList.map((topic) => {
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
										<span className="block text-[11px] text-[var(--text-muted)]">
											{topic.sourceIds.length} {strings.sources}
										</span>
									</span>
									<button
										className={done ? GHOST_BUTTON_CLASS : BUTTON_CLASS}
										disabled={done}
										onClick={() =>
											setForm({
												initial: blankForm({
													name: topicLabel(topic, t),
													topicIds: [topic.id],
												}),
												kind: "new",
											})
										}
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
