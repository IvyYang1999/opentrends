import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";

import { type Locale, resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

// Everything an agent can use, one way per tab: the skill, the MCP server,
// RSS and the JSON API. Each tab reads the same way — how to connect, one
// question to verify, what success looks like — so a person knows when it
// worked and an agent landing here finds the links.

const API_URL = "https://api.opentrends.io";
const SITE_URL = "https://opentrends.io";
const SKILL_URL = `${SITE_URL}/skills/opentrends/SKILL.md`;
const MCP_URL = `${API_URL}/mcp`;
const INSTALL_PROMPT = `帮我安装 this skill: ${SKILL_URL}\n装完告诉我是否需要开启新会话。`;
const MCP_JSON = `{
  "mcpServers": {
    "opentrends": { "url": "${MCP_URL}" }
  }
}`;
const MCP_CLAUDE = `claude mcp add --transport http opentrends ${MCP_URL}`;
const MCP_CODEX = `codex mcp add opentrends --url ${MCP_URL}`;
const MCP_LOCAL = "bun run packages/mcp/src/index.ts";
const MCP_PROMPT = `请把 OpenTrends 的 MCP server 加到我当前的工具里：地址 ${MCP_URL}，传输方式 Streamable HTTP，不需要 API key。配好后列出它提供的工具。`;
const MCP_PROMPT_EN = `Add the OpenTrends MCP server to my tools: URL ${MCP_URL}, Streamable HTTP transport, no API key. When it is connected, list the tools it provides.`;
const API_FIRST = `curl '${API_URL}/api/trends/ai/summary?format=json&lang=zh&window=today'`;
const API_RESPONSE = `{
  "topic": "ai", "window": "today", "lang": "zh",
  "entries": [
    {
      "n": 1,
      "takeaway": "OpenAI 推出 GPT-6 Sol 和 Luna，价格减半性能持平",
      "reason": "大模型价格战持续升级",
      "citations": [
        { "n": 1, "topic": "ai", "url": "https://openai.com/index/..." }
      ]
    }
  ]
}`;
const COPY_RESET_MS = 1800;
const TABS = ["skill", "mcp", "rss", "api"] as const;
type Tab = (typeof TABS)[number];
const TOPICS = [
	"featured",
	"ai",
	"programming",
	"hardware",
	"biotech",
	"embodied",
	"cn",
] as const;

const MCP_TOOLS = [
	["get_digest", "topic, window?, lang?"],
	["get_topic", "topic, itemsPerSource?, lang?"],
	["get_source", "topic, sourceId, lang?"],
	["search", "query, topic?, lang?, limit?"],
] as const;

const ENDPOINTS = [
	["/api/trends/{topic}/summary?format=json", "digest"],
	["/api/trends/{topic}", "topic"],
	["/api/trends/{topic}/sources/{sourceId}", "source"],
	["/api/trends/{topic}/events", "events"],
	["/api/trends/{topic}/feed.xml", "itemsFeed"],
	["/api/trends/{topic}/summary.xml", "digestFeed"],
	["/api/sources", "sources"],
] as const;

const LINKS = [
	["llms.txt", `${SITE_URL}/llms.txt`],
	["MCP", MCP_URL],
	["OpenAPI", `${API_URL}/api-reference`],
	["SKILL.md", SKILL_URL],
	["GitHub", "https://github.com/IvyYang1999/opentrends"],
] as const;

interface Strings {
	apiEndpoints: Record<(typeof ENDPOINTS)[number][1], string>;
	apiFirst: string;
	apiIntro: string;
	apiNotes: [string, string][];
	apiNotesTitle: string;
	apiStepEndpoints: [string, string];
	apiStepFirst: [string, string];
	apiStepResponse: [string, string];
	apiSuccess: string;
	apiTitle: string;
	copied: string;
	copy: string;
	examples: string[];
	examplesTitle: string;
	guide: { intent: string; note?: string; tabs: Tab[] }[];
	guideTitle: string;
	heroBody: string;
	heroTitle: string;
	manualTitle: string;
	mcpIntro: string;
	mcpLocal: string;
	mcpLocalTitle: string;
	mcpPrompt: string;
	mcpStepConnect: [string, string];
	mcpStepTools: [string, string];
	mcpStepVerify: [string, string];
	mcpSuccess: string;
	mcpTitle: string;
	mcpTools: string;
	mcpUrl: string;
	mcpVerify: string;
	rssDigest: string;
	rssDigestSuccess: string;
	rssIntro: string;
	rssItems: string;
	rssItemsSuccess: string;
	rssNotes: string[];
	rssStepAdd: [string, string];
	rssStepPick: [string, string];
	rssSuccess: string;
	rssTitle: string;
	rssTopic: string;
	seoDescription: string;
	seoTitle: string;
	skillIntro: string;
	skillSteps: [string, string][];
	skillSuccess: string;
	skillTitle: string;
	skillVerify: string;
	successLabel: string;
	verifyLabel: string;
}

const EN: Strings = {
	guide: [
		{
			intent: "Let my agent read trends for me",
			note: "one is enough",
			tabs: ["mcp", "skill"],
		},
		{ intent: "Put the data in my own product", tabs: ["api"] },
		{ intent: "Subscribe in a reader or automation", tabs: ["rss"] },
	],
	guideTitle: "Which one do I need?",
	manualTitle: "Set it up by hand",
	mcpPrompt: MCP_PROMPT_EN,
	mcpStepConnect: [
		"Send this to your agent",
		"It adds the server to its own settings. No install, no key.",
	],
	mcpStepTools: [
		"Check the tools",
		"Once connected the agent should list these four.",
	],
	mcpStepVerify: [
		"Ask one question to verify",
		"A real call, with a visible result.",
	],
	rssDigestSuccess:
		"Your reader shows one entry, today's ten lines with citation links; a new entry appears when the digest changes.",
	rssItemsSuccess:
		"Your reader shows the topic's latest items, newest first, each linking to the original article.",
	rssStepPick: ["Pick a topic", "Both addresses below follow it."],
	rssStepAdd: [
		"Add an address to your reader",
		"Two feeds, two different things.",
	],
	apiStepFirst: ["Make the first request", "Any HTTP client, no key."],
	apiStepEndpoints: [
		"Pick an endpoint",
		"Everything the site shows is here as JSON.",
	],
	apiStepResponse: ["Read the response", "The digest comes back as data."],
	difference:
		"A Skill is a page of instructions that teaches the agent how to call the API. An MCP server hands the agent tools directly. Same data, same result; install one, not both.",
	apiEndpoints: {
		digest: "The digest as entries with reasons and citation links",
		digestFeed: "The digest as RSS, one entry per edition",
		events: "Stories clustered across sources",
		itemsFeed: "Latest items as RSS",
		source: "One source's full list",
		sources: "Every source id and its metadata",
		topic: "Every source in a topic with its latest items",
	},
	apiFirst: "First request",
	apiIntro:
		"Plain HTTPS GET, no key. Browsers, curl and any HTTP client are supported paths.",
	apiNotes: [
		[
			"202 while generating",
			"A digest that is not ready yet answers 202 with Retry-After; wait that long and ask again. The MCP tool does this for you.",
		],
		[
			"lang and window",
			"lang: en, zh, zh-Hant, ru, fr-FR, es-ES, de-DE, pt-BR. window: today, week, month.",
		],
		[
			"Cache headers are the pace",
			"Responses carry Cache-Control; polling faster only returns the same copy. Every 30 minutes is plenty.",
		],
		[
			"No scraping needed",
			"The API carries the same data as the pages, deduplicated and translated. Do not fetch opentrends.io HTML.",
		],
	],
	apiNotesTitle: "Good to know",
	apiSuccess:
		"A JSON body with entries[]; each entry has takeaway, reason and citations[] with url and topic.",
	apiTitle: "API",
	copied: "Copied",
	copy: "Copy",
	examples: [
		"What happened in AI today? Give me the five that matter, with links.",
		"Compare this week's hardware and programming trends.",
		"Find biotech items about gene editing from the last month.",
		"Summarize China tech trends in English.",
	],
	examplesTitle: "Once connected, ask things like",
	heroBody:
		"OpenTrends reads 240+ sources across AI, programming, hardware, biotech, embodied AI and China tech, translates them, and distills each topic into ten lines with citations. Four ways in, all anonymous and read-only.",
	heroTitle: "Use OpenTrends from your agent",
	mcpIntro:
		"One URL, no install, no key. For Claude Desktop, Claude Code, Codex, Cursor or any client that speaks Streamable HTTP.",
	mcpLocal:
		"A client that only runs local commands can start the same server from the repository.",
	mcpLocalTitle: "Local alternative",
	mcpSuccess:
		"The client shows a call to get_digest, and the answer has ten lines in your language, each with citation links.",
	mcpTitle: "MCP",
	mcpTools: "Once connected you should see these four tools",
	mcpUrl: "Server URL",
	mcpVerify:
		"Call get_digest and give me today's ten for AI, with citation links.",
	rssDigest: "Digest feed",
	rssIntro:
		"For readers and automations (n8n, Zapier, a Slack bot). Pick a topic; the addresses stay stable.",
	rssItems: "Latest items feed",
	rssNotes: [
		"Item links go to the original article; the source name is in the description.",
		"The digest feed gets a new entry whenever the digest changes, at most a few times a day.",
		"Polling every 30 minutes is enough.",
	],
	rssSuccess:
		"Your reader lists the latest items of the topic, or one entry with today's ten.",
	rssTitle: "RSS",
	rssTopic: "Topic",
	seoDescription:
		"Use OpenTrends from your agent: skill, MCP server, RSS and a JSON digest API.",
	seoTitle: "OpenTrends for agents",
	skillIntro:
		"Install once, then ask in plain language. For Claude Code, Codex, Gemini CLI and other tools that support agent skills.",
	skillSteps: [
		[
			"Send the prompt to your agent",
			"It installs the skill file into the right place and reads trends from the API from then on.",
		],
		[
			"Start a new session",
			"Most agents only scan skills when a session begins; the current conversation may not see it yet.",
		],
		[
			"Ask one question to verify",
			"See a time window, titles in your language and source links, and it is connected.",
		],
	],
	skillSuccess:
		"The answer names the period, lists five items in your language and links each to its source.",
	skillTitle: "Skill",
	skillVerify: "What are the five most important things in AI today?",
	successLabel: "What success looks like",
	verifyLabel: "Verify with one question",
};

const ZH: Strings = {
	guide: [
		{
			intent: "让 Agent 替我看趋势",
			note: "装一个就够",
			tabs: ["mcp", "skill"],
		},
		{ intent: "把数据接进自己的产品", tabs: ["api"] },
		{ intent: "在阅读器或自动化里订阅", tabs: ["rss"] },
	],
	guideTitle: "我该用哪个？",
	manualTitle: "手动配置",
	mcpPrompt: MCP_PROMPT,
	mcpStepConnect: [
		"把这句话发给你的 Agent",
		"它会把 server 写进自己的配置。不用安装，不用 key。",
	],
	mcpStepTools: ["看一眼工具", "接上后 Agent 应该列出这四个。"],
	mcpStepVerify: ["问一句验证", "真实调用一次，看得见结果。"],
	rssDigestSuccess:
		"阅读器里出现一条：今天的 10 条，每条带引用链接；摘要变了才会出新的一条。",
	rssItemsSuccess: "阅读器里出现该主题的最新条目，新的在前，每条链接到原文。",
	rssStepPick: ["选一个主题", "下面两个地址跟着变。"],
	rssStepAdd: ["把地址加进阅读器", "两条 feed，是两种东西。"],
	apiStepFirst: ["发第一个请求", "任何 HTTP 客户端，不用 key。"],
	apiStepEndpoints: ["挑一个端点", "网站上看到的一切，这里都有 JSON。"],
	apiStepResponse: ["读返回", "摘要以数据形式返回。"],
	difference:
		"Skill 是一页说明书，教 Agent 怎么调 API；MCP 是直接把工具塞给 Agent。数据一样、结果一样，装一个就行，不用都装。",
	apiEndpoints: {
		digest: "摘要：结论、原因、引用链接",
		digestFeed: "摘要的 RSS，每期一条",
		events: "跨来源聚合的事件",
		itemsFeed: "最新条目的 RSS",
		source: "单个来源的完整列表",
		sources: "全部来源 id 与元数据",
		topic: "一个主题下所有来源及其最新条目",
	},
	apiFirst: "第一个请求",
	apiIntro:
		"纯 HTTPS GET，不用 key。浏览器跨域、curl 和任何 HTTP 客户端都是正式支持的路径。",
	apiNotes: [
		[
			"生成中返回 202",
			"摘要还没生成好时返回 202 和 Retry-After；等那么久再请求一次。MCP 工具会替你等。",
		],
		[
			"lang 和 window",
			"lang：en、zh、zh-Hant、ru、fr-FR、es-ES、de-DE、pt-BR。window：today、week、month。",
		],
		[
			"缓存头就是节奏",
			"响应带 Cache-Control；轮得更密只会拿到同一份副本。30 分钟一次足够。",
		],
		[
			"不用抓网页",
			"API 和页面是同一份数据，已去重、已翻译。不要抓 opentrends.io 的 HTML。",
		],
	],
	apiNotesTitle: "先知道这几件事",
	apiSuccess:
		"返回 JSON，entries[] 里每条有 takeaway、reason 和带 url、topic 的 citations[]。",
	apiTitle: "API",
	copied: "已复制",
	copy: "复制",
	examples: [
		"今天 AI 圈发生了什么？挑最重要的 5 条，带链接。",
		"对比一下本周的硬件和编程趋势。",
		"找最近一个月关于基因编辑的生物科技条目。",
		"用英文总结中国科技趋势。",
	],
	examplesTitle: "接上之后可以这样问",
	heroBody:
		"OpenTrends 持续读取 240 多个来源（AI、编程、硬件、生物科技、具身智能、中文），翻译，再把每个主题浓缩成带引用的 10 条。四条接入路径，全部匿名只读。",
	heroTitle: "在 Agent 里使用 OpenTrends",
	mcpIntro:
		"一个地址，不用安装、不用 key。适用于 Claude Desktop、Claude Code、Codex、Cursor 或任何支持 Streamable HTTP 的客户端。",
	mcpLocal: "只能跑本地命令的客户端，可以从仓库直接启动同一个 server。",
	mcpLocalTitle: "本地替代",
	mcpSuccess:
		"客户端显示调用了 get_digest，回答是 10 条你的语言的要点，每条带引用链接。",
	mcpTitle: "MCP",
	mcpTools: "连上后应看到这四个工具",
	mcpUrl: "Server 地址",
	mcpVerify: "请调用 get_digest，给我今天 AI 的 10 条，带引用链接。",
	rssDigest: "摘要 feed",
	rssIntro:
		"给阅读器和自动化工具（n8n、Zapier、Slack 机器人）。选一个主题；地址长期不变。",
	rssItems: "最新条目 feed",
	rssNotes: [
		"条目链接指向原文；来源名在 description 里。",
		"摘要 feed 在摘要变化时出一条新条目，一天最多几次。",
		"30 分钟轮询一次就够。",
	],
	rssSuccess: "阅读器里出现该主题的最新条目，或一条“今天的 10 条”。",
	rssTitle: "RSS",
	rssTopic: "主题",
	seoDescription:
		"在 Agent 里使用 OpenTrends：Skill、MCP server、RSS 和 JSON 摘要 API。",
	seoTitle: "在 Agent 里使用 OpenTrends",
	skillIntro:
		"装一次，之后直接用中文问。适合 Claude Code、Codex、Gemini CLI 这类支持 Agent Skills 的工具。",
	skillSteps: [
		[
			"把提示词发给 Agent",
			"它会把 skill 文件装到对应目录，之后从 API 读趋势。",
		],
		[
			"开个新会话",
			"多数 Agent 只在会话开始时扫描 Skill，当前对话不一定看得到。",
		],
		["问一句验证", "看到时间范围、你的语言的标题和来源链接，就算接上了。"],
	],
	skillSuccess: "回答注明时间范围，列出 5 条你的语言的内容，每条链接到来源。",
	skillTitle: "Skill",
	skillVerify: "今天 AI 圈最重要的 5 件事是什么？",
	successLabel: "成功的样子",
	verifyLabel: "问一句验证",
};

const ZH_HANT: Strings = {
	...ZH,
	guide: [
		{
			intent: "讓 Agent 替我看趨勢",
			note: "裝一個就夠",
			tabs: ["mcp", "skill"],
		},
		{ intent: "把資料接進自己的產品", tabs: ["api"] },
		{ intent: "在閱讀器或自動化裡訂閱", tabs: ["rss"] },
	],
	guideTitle: "我該用哪個？",
	manualTitle: "手動設定",
	mcpStepConnect: [
		"把這句話發給你的 Agent",
		"它會把 server 寫進自己的設定。不用安裝，不用 key。",
	],
	mcpStepTools: ["看一眼工具", "接上後 Agent 應該列出這四個。"],
	mcpStepVerify: ["問一句驗證", "真實呼叫一次，看得見結果。"],
	rssDigestSuccess:
		"閱讀器裡出現一則：今天的 10 則，每則附引用連結；摘要變了才會出新的一則。",
	rssItemsSuccess: "閱讀器裡出現該主題的最新條目，新的在前，每則連結到原文。",
	rssStepPick: ["選一個主題", "下面兩個位址跟著變。"],
	rssStepAdd: ["把位址加進閱讀器", "兩條 feed，是兩種東西。"],
	apiStepFirst: ["發第一個請求", "任何 HTTP 用戶端，不用 key。"],
	apiStepEndpoints: ["挑一個端點", "網站上看到的一切，這裡都有 JSON。"],
	apiStepResponse: ["讀回傳", "摘要以資料形式回傳。"],
	difference:
		"Skill 是一頁說明書，教 Agent 怎麼呼叫 API；MCP 是直接把工具塞給 Agent。資料一樣、結果一樣，裝一個就行，不用都裝。",
	apiEndpoints: {
		digest: "摘要：結論、原因、引用連結",
		digestFeed: "摘要的 RSS，每期一則",
		events: "跨來源聚合的事件",
		itemsFeed: "最新條目的 RSS",
		source: "單一來源的完整列表",
		sources: "全部來源 id 與中繼資料",
		topic: "一個主題下所有來源及其最新條目",
	},
	apiFirst: "第一個請求",
	apiIntro:
		"純 HTTPS GET，不用 key。瀏覽器跨域、curl 和任何 HTTP 用戶端都是正式支援的路徑。",
	apiNotes: [
		[
			"產生中回傳 202",
			"摘要還沒產生好時回傳 202 和 Retry-After；等那麼久再請求一次。MCP 工具會替你等。",
		],
		[
			"lang 和 window",
			"lang：en、zh、zh-Hant、ru、fr-FR、es-ES、de-DE、pt-BR。window：today、week、month。",
		],
		[
			"快取標頭就是節奏",
			"回應帶 Cache-Control；輪詢更密只會拿到同一份副本。30 分鐘一次足夠。",
		],
		[
			"不用抓網頁",
			"API 和頁面是同一份資料，已去重、已翻譯。不要抓 opentrends.io 的 HTML。",
		],
	],
	apiNotesTitle: "先知道這幾件事",
	apiSuccess:
		"回傳 JSON，entries[] 裡每則有 takeaway、reason 和帶 url、topic 的 citations[]。",
	copied: "已複製",
	copy: "複製",
	examples: [
		"今天 AI 圈發生了什麼？挑最重要的 5 則，附連結。",
		"比較一下本週的硬體和程式開發趨勢。",
		"找最近一個月關於基因編輯的生物科技條目。",
		"用英文總結中國科技趨勢。",
	],
	examplesTitle: "接上之後可以這樣問",
	heroBody:
		"OpenTrends 持續讀取 240 多個來源（AI、程式、硬體、生物科技、具身智能、中文），翻譯，再把每個主題濃縮成附引用的 10 則。四條接入路徑，全部匿名唯讀。",
	heroTitle: "在 Agent 裡使用 OpenTrends",
	mcpIntro:
		"一個位址，不用安裝、不用 key。適用於 Claude Desktop、Claude Code、Codex、Cursor 或任何支援 Streamable HTTP 的用戶端。",
	mcpLocal: "只能跑本機命令的用戶端，可以從倉庫直接啟動同一個 server。",
	mcpLocalTitle: "本機替代",
	mcpSuccess:
		"用戶端顯示呼叫了 get_digest，回答是 10 則你的語言的要點，每則附引用連結。",
	mcpTools: "連上後應看到這四個工具",
	mcpUrl: "Server 位址",
	mcpVerify: "請呼叫 get_digest，給我今天 AI 的 10 則，附引用連結。",
	rssIntro:
		"給閱讀器和自動化工具（n8n、Zapier、Slack 機器人）。選一個主題；位址長期不變。",
	rssItems: "最新條目 feed",
	rssNotes: [
		"條目連結指向原文；來源名在 description 裡。",
		"摘要 feed 在摘要變化時出一則新條目，一天最多幾次。",
		"30 分鐘輪詢一次就夠。",
	],
	rssSuccess: "閱讀器裡出現該主題的最新條目，或一則「今天的 10 則」。",
	rssTopic: "主題",
	seoDescription:
		"在 Agent 裡使用 OpenTrends：Skill、MCP server、RSS 和 JSON 摘要 API。",
	seoTitle: "在 Agent 裡使用 OpenTrends",
	skillIntro:
		"裝一次，之後直接用中文問。適合 Claude Code、Codex、Gemini CLI 這類支援 Agent Skills 的工具。",
	skillSteps: [
		[
			"把提示詞發給 Agent",
			"它會把 skill 檔案裝到對應目錄，之後從 API 讀趨勢。",
		],
		[
			"開個新會話",
			"多數 Agent 只在會話開始時掃描 Skill，目前對話不一定看得到。",
		],
		["問一句驗證", "看到時間範圍、你的語言的標題和來源連結，就算接上了。"],
	],
	skillSuccess: "回答註明時間範圍，列出 5 則你的語言的內容，每則連結到來源。",
	skillVerify: "今天 AI 圈最重要的 5 件事是什麼？",
	successLabel: "成功的樣子",
	verifyLabel: "問一句驗證",
};

const STRINGS: Partial<Record<Locale, Strings>> & { en: Strings } = {
	en: EN,
	zh: ZH,
	"zh-Hant": ZH_HANT,
};

function getStrings(locale: Locale): Strings {
	return STRINGS[locale] ?? STRINGS.en;
}

function isTab(value: string): value is Tab {
	return (TABS as readonly string[]).includes(value);
}

export const Route = createFileRoute("/{-$locale}/agents")({
	component: AgentsRoute,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		const strings = getStrings(locale);
		return buildSeo({
			title: strings.seoTitle,
			description: strings.seoDescription,
			path: "/agents",
			keywords: ["agent skill", "MCP server", "RSS", "OpenTrends API"],
			locale,
		});
	},
});

async function copyText(value: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(value);
	} catch {
		const textarea = document.createElement("textarea");
		textarea.value = value;
		textarea.setAttribute("readonly", "true");
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand("copy");
		textarea.remove();
	}
}

function Snippet({
	label,
	strings,
	value,
}: {
	label: string;
	strings: Strings;
	value: string;
}) {
	const [copied, setCopied] = useState(false);
	function copy() {
		setCopied(true);
		window.setTimeout(() => setCopied(false), COPY_RESET_MS);
		copyText(value).catch(() => undefined);
	}
	return (
		<div className="overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-app)]">
			<div className="flex items-center justify-between border-[var(--border-default)] border-b bg-[var(--surface-card)] px-3 py-1.5">
				<span className="font-medium text-[11px] text-[var(--text-muted)]">
					{label}
				</span>
				<button
					className="inline-flex items-center gap-1.5 rounded bg-[var(--accent-blue)] px-2.5 py-1 font-medium text-[11px] text-white transition-opacity hover:opacity-90"
					onClick={copy}
					type="button"
				>
					{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
					{copied ? strings.copied : strings.copy}
				</button>
			</div>
			<pre className="whitespace-pre-wrap break-words p-3 text-[13px] text-[var(--text-primary)] leading-6">
				<code>{value}</code>
			</pre>
		</div>
	);
}

// One numbered step with everything it needs right under its heading: the
// prompt to copy, the table to check, the sentence that says it worked.
function Step({
	body,
	children,
	index,
	title,
}: {
	body: string;
	children?: ReactNode;
	index: number;
	title: string;
}) {
	return (
		<li className="flex gap-3">
			<span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue-bg)] font-semibold text-[11px] text-[var(--accent-blue)]">
				{index}
			</span>
			<div className="min-w-0 flex-1 space-y-2">
				<div>
					<span className="block font-semibold text-[14px] text-[var(--text-heading)]">
						{title}
					</span>
					<span className="block text-[13px] text-[var(--text-secondary)] leading-relaxed">
						{body}
					</span>
				</div>
				{children}
			</div>
		</li>
	);
}

function Success({
	children,
	strings,
}: {
	children: string;
	strings: Strings;
}) {
	return (
		<p className="text-[13px] leading-relaxed">
			<span className="mr-1.5 rounded-[4px] bg-[#e6f4ea] px-1.5 py-0.5 font-medium text-[#1e7a3c] text-[11px] dark:bg-[#1f3a28] dark:text-[#9fe0b5]">
				{strings.successLabel}
			</span>
			<span className="text-[var(--text-secondary)]">{children}</span>
		</p>
	);
}

function Intro({ children }: { children: string }) {
	return (
		<p className="text-[14px] text-[var(--text-secondary)] leading-relaxed">
			{children}
		</p>
	);
}

function SkillTab({ strings }: { strings: Strings }) {
	const [install, session, verify] = strings.skillSteps;
	return (
		<div className="space-y-6">
			<Intro>{strings.skillIntro}</Intro>
			<ol className="space-y-5">
				<Step body={install[1]} index={1} title={install[0]}>
					<Snippet label="Prompt" strings={strings} value={INSTALL_PROMPT} />
				</Step>
				<Step body={session[1]} index={2} title={session[0]} />
				<Step body={verify[1]} index={3} title={verify[0]}>
					<Snippet
						label="Prompt"
						strings={strings}
						value={strings.skillVerify}
					/>
					<Success strings={strings}>{strings.skillSuccess}</Success>
				</Step>
			</ol>
			<section className="space-y-3">
				<h3 className="font-semibold text-[13px] text-[var(--text-heading)]">
					{strings.examplesTitle}
				</h3>
				<ul className="grid gap-2 sm:grid-cols-2">
					{strings.examples.map((example) => (
						<li
							className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-app)] px-3 py-2.5 text-[13px] leading-relaxed"
							key={example}
						>
							{example}
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}

function McpTab({ strings }: { strings: Strings }) {
	return (
		<div className="space-y-6">
			<Intro>{strings.mcpIntro}</Intro>
			<ol className="space-y-5">
				<Step
					body={strings.mcpStepConnect[1]}
					index={1}
					title={strings.mcpStepConnect[0]}
				>
					<Snippet label="Prompt" strings={strings} value={strings.mcpPrompt} />
				</Step>
				<Step
					body={strings.mcpStepTools[1]}
					index={2}
					title={strings.mcpStepTools[0]}
				>
					<table className="w-full text-[13px]">
						<tbody>
							{MCP_TOOLS.map(([name, args]) => (
								<tr
									className="border-[var(--border-subtle)] border-t"
									key={name}
								>
									<td className="py-1.5 pr-4 font-mono text-[var(--text-primary)]">
										{name}
									</td>
									<td className="py-1.5 font-mono text-[var(--text-muted)]">
										{args}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Step>
				<Step
					body={strings.mcpStepVerify[1]}
					index={3}
					title={strings.mcpStepVerify[0]}
				>
					<Snippet label="Prompt" strings={strings} value={strings.mcpVerify} />
					<Success strings={strings}>{strings.mcpSuccess}</Success>
				</Step>
			</ol>
			<details className="space-y-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-app)] p-3 text-[13px]">
				<summary className="cursor-pointer font-medium text-[var(--text-heading)]">
					{strings.manualTitle}
				</summary>
				<div className="mt-3 space-y-3">
					<Snippet label={strings.mcpUrl} strings={strings} value={MCP_URL} />
					<Snippet label="Claude Code" strings={strings} value={MCP_CLAUDE} />
					<Snippet label="Codex" strings={strings} value={MCP_CODEX} />
					<Snippet
						label="Cursor / mcp.json"
						strings={strings}
						value={MCP_JSON}
					/>
					<p className="text-[var(--text-secondary)]">{strings.mcpLocal}</p>
					<Snippet label="stdio" strings={strings} value={MCP_LOCAL} />
				</div>
			</details>
		</div>
	);
}

function RssTab({ strings }: { strings: Strings }) {
	const [topic, setTopic] = useState<(typeof TOPICS)[number]>("ai");
	const base = `${API_URL}/api/trends/${topic}`;
	return (
		<div className="space-y-6">
			<Intro>{strings.rssIntro}</Intro>
			<ol className="space-y-5">
				<Step
					body={strings.rssStepPick[1]}
					index={1}
					title={strings.rssStepPick[0]}
				>
					<div className="flex flex-wrap items-center gap-2 text-[12px]">
						{TOPICS.map((id) => (
							<button
								aria-pressed={topic === id}
								className="rounded-full border border-[var(--border-default)] bg-[var(--surface-app)] px-2.5 py-0.5 font-mono text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-blue)] aria-pressed:border-[var(--accent-blue)] aria-pressed:bg-[var(--accent-blue-bg)] aria-pressed:text-[var(--accent-blue)]"
								key={id}
								onClick={() => setTopic(id)}
								type="button"
							>
								{id}
							</button>
						))}
					</div>
				</Step>
				<Step
					body={strings.rssStepAdd[1]}
					index={2}
					title={strings.rssStepAdd[0]}
				>
					<div className="space-y-2">
						<Snippet
							label={strings.rssItems}
							strings={strings}
							value={`${base}/feed.xml?lang=zh`}
						/>
						<Success strings={strings}>{strings.rssItemsSuccess}</Success>
					</div>
					<div className="space-y-2">
						<Snippet
							label={strings.rssDigest}
							strings={strings}
							value={`${base}/summary.xml?lang=zh&window=today`}
						/>
						<Success strings={strings}>{strings.rssDigestSuccess}</Success>
					</div>
				</Step>
			</ol>
			<ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--text-secondary)] leading-relaxed">
				{strings.rssNotes.map((note) => (
					<li key={note}>{note}</li>
				))}
			</ul>
		</div>
	);
}

function ApiTab({ strings }: { strings: Strings }) {
	return (
		<div className="space-y-6">
			<Intro>{strings.apiIntro}</Intro>
			<ol className="space-y-5">
				<Step
					body={strings.apiStepFirst[1]}
					index={1}
					title={strings.apiStepFirst[0]}
				>
					<Snippet label="curl" strings={strings} value={API_FIRST} />
				</Step>
				<Step
					body={strings.apiStepEndpoints[1]}
					index={2}
					title={strings.apiStepEndpoints[0]}
				>
					<table className="w-full text-[13px]">
						<tbody>
							{ENDPOINTS.map(([path, key]) => (
								<tr
									className="border-[var(--border-subtle)] border-t"
									key={path}
								>
									<td className="py-1.5 pr-4 font-mono text-[12px] text-[var(--text-primary)]">
										<span className="mr-2 text-[var(--text-muted)]">GET</span>
										{path}
									</td>
									<td className="py-1.5 text-[var(--text-secondary)]">
										{strings.apiEndpoints[key]}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Step>
				<Step
					body={strings.apiStepResponse[1]}
					index={3}
					title={strings.apiStepResponse[0]}
				>
					<Snippet label="JSON" strings={strings} value={API_RESPONSE} />
					<Success strings={strings}>{strings.apiSuccess}</Success>
				</Step>
			</ol>
			<section className="space-y-2">
				<h3 className="font-semibold text-[13px] text-[var(--text-heading)]">
					{strings.apiNotesTitle}
				</h3>
				<dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
					{strings.apiNotes.map(([term, body]) => (
						<div key={term}>
							<dt className="font-medium text-[var(--text-heading)]">{term}</dt>
							<dd className="text-[var(--text-secondary)] leading-relaxed">
								{body}
							</dd>
						</div>
					))}
				</dl>
			</section>
		</div>
	);
}

const TAB_PANELS: Record<Tab, (props: { strings: Strings }) => ReactElement> = {
	api: ApiTab,
	mcp: McpTab,
	rss: RssTab,
	skill: SkillTab,
};

function AgentsRoute() {
	const params = Route.useParams();
	const locale = resolveLocale(params.locale);
	const strings = getStrings(locale);
	const [tab, setTab] = useState<Tab>("skill");
	// The hash names the tab, so a link can open the page on MCP or RSS.
	useEffect(() => {
		const fromHash = window.location.hash.slice(1);
		if (isTab(fromHash)) {
			setTab(fromHash);
		}
	}, []);
	function selectTab(next: Tab) {
		setTab(next);
		window.history.replaceState(null, "", `#${next}`);
	}
	const titles: Record<Tab, string> = {
		api: strings.apiTitle,
		mcp: strings.mcpTitle,
		rss: strings.rssTitle,
		skill: strings.skillTitle,
	};
	const Panel = TAB_PANELS[tab];

	return (
		<ScrollArea className="min-w-0 flex-1 bg-[var(--surface-sidebar)] text-[var(--text-primary)]">
			<div className="flex flex-1 justify-center p-6 sm:p-12">
				<div className="w-full max-w-2xl space-y-8">
					<header className="space-y-4">
						<h1 className="font-bold text-3xl text-[var(--text-heading)] tracking-tight sm:text-4xl">
							{strings.heroTitle}
						</h1>
						<p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
							{strings.heroBody}
						</p>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
							{LINKS.map(([label, href]) => (
								<a
									className="text-[var(--accent-blue)] hover:underline"
									href={href}
									key={href}
									rel="noopener noreferrer"
									target="_blank"
								>
									{label}
								</a>
							))}
						</div>
					</header>

					<section className="border border-[var(--border-default)] bg-[var(--surface-card)]">
						<h2 className="border-[var(--border-default)] border-b px-4 py-2 font-semibold text-[12px] text-[var(--text-muted)]">
							{strings.guideTitle}
						</h2>
						<ul className="divide-y divide-[var(--border-subtle)]">
							{strings.guide.map((row) => (
								<li
									className="flex items-center gap-3 px-4 py-2.5 text-[13px]"
									key={row.intent}
								>
									<span className="min-w-0 flex-1 text-[var(--text-primary)]">
										{row.intent}
									</span>
									<span className="text-[var(--text-muted)]">→</span>
									<span className="flex items-center gap-1">
										{row.tabs.map((id) => (
											<button
												className="inline-flex h-7 items-center bg-[var(--accent-blue-bg)] px-2.5 font-medium text-[12px] text-[var(--accent-blue)] transition-opacity hover:opacity-80"
												key={id}
												onClick={() => selectTab(id)}
												type="button"
											>
												{titles[id]}
											</button>
										))}
										{row.note ? (
											<span className="ml-1 text-[11px] text-[var(--text-muted)]">
												{row.note}
											</span>
										) : null}
									</span>
								</li>
							))}
						</ul>
					</section>

					<div
						aria-label="Integration"
						className="flex gap-1 border-[var(--border-default)] border-b"
						role="tablist"
					>
						{TABS.map((id) => (
							<button
								aria-controls={`agents-panel-${id}`}
								aria-selected={tab === id}
								className="-mb-px border-transparent border-b-2 px-3 py-2 font-medium text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] aria-selected:border-[var(--accent-blue)] aria-selected:text-[var(--text-heading)]"
								id={`agents-tab-${id}`}
								key={id}
								onClick={() => selectTab(id)}
								role="tab"
								type="button"
							>
								{titles[id]}
							</button>
						))}
					</div>

					<section
						aria-labelledby={`agents-tab-${tab}`}
						id={`agents-panel-${tab}`}
						role="tabpanel"
					>
						<Panel strings={strings} />
					</section>
				</div>
			</div>
		</ScrollArea>
	);
}
