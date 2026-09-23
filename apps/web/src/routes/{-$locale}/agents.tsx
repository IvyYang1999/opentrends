import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { type Locale, resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

// One page for everything an agent can use: the skill, the MCP server, the
// JSON API and the machine-readable docs. Written so a person can tell what
// the site does for their agent, and an agent landing here finds the links.

const SKILL_URL = "https://opentrends.io/skills/opentrends/SKILL.md";
const INSTALL_PROMPT = `帮我安装 this skill: ${SKILL_URL}`;
const MCP_CONFIG = `{
  "mcpServers": {
    "opentrends": {
      "command": "bunx",
      "args": ["opentrends-mcp"],
      "env": { "OPENTRENDS_LANG": "zh" }
    }
  }
}`;
const MCP_CLAUDE_CODE = "claude mcp add opentrends -- bunx opentrends-mcp";
const API_DIGEST =
	"curl 'https://api.opentrends.io/api/trends/ai/summary?format=json&lang=zh&window=today'";
const API_TOPIC =
	"curl 'https://api.opentrends.io/api/trends/programming?lang=en&items=preview'";
const API_RESPONSE = `{
  "topic": "ai", "window": "today", "lang": "zh",
  "entries": [
    {
      "n": 1,
      "takeaway": "OpenAI 推出 GPT-6 Sol 和 Luna，价格减半性能持平",
      "reason": "大模型价格战持续升级",
      "citations": [
        { "n": 1, "topic": "ai", "url": "https://openai.com/index/..." },
        { "n": 25, "topic": "ai", "url": "https://techcrunch.com/..." }
      ]
    }
  ]
}`;
const COPY_RESET_MS = 1800;

const MCP_TOOLS = [
	["get_digest", "topic, window?, lang?"],
	["get_topic", "topic, itemsPerSource?, lang?"],
	["get_source", "topic, sourceId, lang?"],
	["search", "query, topic?, lang?, limit?"],
] as const;

const LINKS = [
	["llms.txt", "https://opentrends.io/llms.txt"],
	["SKILL.md", SKILL_URL],
	["Skill manifest", "https://api.opentrends.io/api/skills/opentrends"],
	["OpenAPI", "https://api.opentrends.io/api-reference"],
	[
		"MCP source",
		"https://github.com/IvyYang1999/opentrends/tree/main/packages/mcp",
	],
] as const;

interface Strings {
	apiBody: string;
	apiTitle: string;
	copied: string;
	copy: string;
	docsBody: string;
	docsTitle: string;
	examples: string[];
	examplesTitle: string;
	heroBody: string;
	heroTitle: string;
	mcpBody: string;
	mcpTitle: string;
	mcpTools: string;
	seoDescription: string;
	seoTitle: string;
	skillBody: string;
	skillTitle: string;
	whyBody: string[];
	whyTitle: string;
}

const STRINGS: Partial<Record<Locale, Strings>> & { en: Strings } = {
	en: {
		apiBody:
			"Plain HTTPS, no key. The digest comes back as entries with a takeaway, a reason and resolved citation links; 202 means it is still being generated, retry after the Retry-After header.",
		apiTitle: "API",
		copied: "Copied",
		copy: "Copy",
		docsBody:
			"Everything above, written for machines. Point an agent at llms.txt and it finds the rest.",
		docsTitle: "Machine-readable docs",
		examples: [
			"What happened in AI today? Give me the five that matter, with links.",
			"Compare this week's hardware and programming trends.",
			"Find biotech items about gene editing from the last month.",
			"Summarize China tech trends in English.",
		],
		examplesTitle: "Things to ask once it is connected",
		heroBody:
			"OpenTrends reads 240+ sources across AI, programming, hardware, biotech, embodied AI and China tech, translates them, and distills each topic into ten lines with citations. Your agent gets the same data through four doors: a skill, an MCP server, a JSON API and machine-readable docs.",
		heroTitle: "OpenTrends for agents",
		mcpBody:
			"For Claude Desktop, Claude Code, Cursor or any MCP client. Four tools, each one GET against the public API.",
		mcpTitle: "MCP server",
		mcpTools: "Tools",
		seoDescription:
			"Use OpenTrends from your agent: skill, MCP server, JSON digest API and llms.txt.",
		seoTitle: "OpenTrends for agents",
		skillBody:
			"Send this one sentence to your agent. It installs the skill file and from then on reads trends from the API instead of scraping pages.",
		skillTitle: "Skill",
		whyBody: [
			"No scraping: one request returns a whole topic, deduplicated across sources, with titles, links, dates and heat.",
			"Already translated: ask in Chinese, English or six other languages and the titles come back in that language, original kept alongside.",
			"Already distilled: the digest is ten lines, each with a reason and citations, so an agent can answer 'what matters today' without reading three hundred items.",
			"Stable contract: the skill manifest is the source of truth and says when something changes.",
		],
		whyTitle: "What this saves an agent",
	},
	zh: {
		apiBody:
			"纯 HTTPS，不用 key。摘要接口返回结构化条目：结论、原因、已解析的引用链接；返回 202 表示还在生成，按 Retry-After 稍后重试。",
		apiTitle: "API",
		copied: "已复制",
		copy: "复制",
		docsBody:
			"上面这些的机器可读版本。把 Agent 指到 llms.txt，其余它自己会找到。",
		docsTitle: "给机器看的文档",
		examples: [
			"今天 AI 圈发生了什么？挑最重要的 5 条，带链接。",
			"对比一下本周的硬件和编程趋势。",
			"找最近一个月关于基因编辑的生物科技条目。",
			"用英文总结中国科技趋势。",
		],
		examplesTitle: "接上之后可以这样问",
		heroBody:
			"OpenTrends 持续读取 240 多个来源（AI、编程、硬件、生物科技、具身智能、中文），翻译，再把每个主题浓缩成带引用的 10 条。你的 Agent 通过四个入口拿到同一份数据：Skill、MCP server、JSON API、机器可读文档。",
		heroTitle: "给 Agent 用的 OpenTrends",
		mcpBody:
			"适用于 Claude Desktop、Claude Code、Cursor 或任何 MCP 客户端。四个工具，每个都是对公开 API 的一次 GET。",
		mcpTitle: "MCP server",
		mcpTools: "工具",
		seoDescription:
			"在 Agent 里使用 OpenTrends：Skill、MCP server、JSON 摘要 API 和 llms.txt。",
		seoTitle: "给 Agent 用的 OpenTrends",
		skillBody:
			"把这句话发给你的 Agent。它会安装 skill 文件，之后从 API 读趋势，不再抓网页。",
		skillTitle: "Skill",
		whyBody: [
			"不用抓网页：一次请求拿到整个主题，跨来源去重，带标题、链接、时间和热度。",
			"已经翻好：用中文、英文或其他六种语言问，标题就是那种语言，原文也在。",
			"已经浓缩：摘要是 10 条，每条有原因和引用，Agent 回答“今天什么重要”不用读三百条。",
			"契约稳定：skill manifest 是唯一真相，接口变了它会先说。",
		],
		whyTitle: "这对 Agent 省了什么",
	},
	"zh-Hant": {
		apiBody:
			"純 HTTPS，不用 key。摘要介面回傳結構化條目：結論、原因、已解析的引用連結；回傳 202 表示還在產生，依 Retry-After 稍後重試。",
		apiTitle: "API",
		copied: "已複製",
		copy: "複製",
		docsBody:
			"上面這些的機器可讀版本。把 Agent 指到 llms.txt，其餘它自己會找到。",
		docsTitle: "給機器看的文件",
		examples: [
			"今天 AI 圈發生了什麼？挑最重要的 5 則，附連結。",
			"比較一下本週的硬體和程式開發趨勢。",
			"找最近一個月關於基因編輯的生物科技條目。",
			"用英文總結中國科技趨勢。",
		],
		examplesTitle: "接上之後可以這樣問",
		heroBody:
			"OpenTrends 持續讀取 240 多個來源（AI、程式、硬體、生物科技、具身智能、中文），翻譯，再把每個主題濃縮成附引用的 10 則。你的 Agent 透過四個入口拿到同一份資料：Skill、MCP server、JSON API、機器可讀文件。",
		heroTitle: "給 Agent 用的 OpenTrends",
		mcpBody:
			"適用於 Claude Desktop、Claude Code、Cursor 或任何 MCP 用戶端。四個工具，每個都是對公開 API 的一次 GET。",
		mcpTitle: "MCP server",
		mcpTools: "工具",
		seoDescription:
			"在 Agent 裡使用 OpenTrends：Skill、MCP server、JSON 摘要 API 和 llms.txt。",
		seoTitle: "給 Agent 用的 OpenTrends",
		skillBody:
			"把這句話發給你的 Agent。它會安裝 skill 檔案，之後從 API 讀趨勢，不再抓網頁。",
		skillTitle: "Skill",
		whyBody: [
			"不用抓網頁：一次請求拿到整個主題，跨來源去重，附標題、連結、時間和熱度。",
			"已經翻好：用中文、英文或其他六種語言問，標題就是那種語言，原文也在。",
			"已經濃縮：摘要是 10 則，每則有原因和引用，Agent 回答「今天什麼重要」不用讀三百則。",
			"契約穩定：skill manifest 是唯一真相，介面變了它會先說。",
		],
		whyTitle: "這對 Agent 省了什麼",
	},
};

function getStrings(locale: Locale): Strings {
	return STRINGS[locale] ?? STRINGS.en;
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
			keywords: ["agent skill", "MCP server", "OpenTrends API", "llms.txt"],
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
			<pre className="overflow-x-auto p-4 text-[13px] text-[var(--text-primary)] leading-6">
				<code>{value}</code>
			</pre>
		</div>
	);
}

function Section({
	body,
	children,
	id,
	title,
}: {
	body: string;
	children: React.ReactNode;
	id: string;
	title: string;
}) {
	return (
		<section className="space-y-4" id={id}>
			<h2 className="font-semibold text-[17px] text-[var(--text-heading)] tracking-tight">
				{title}
			</h2>
			<p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
				{body}
			</p>
			{children}
		</section>
	);
}

function AgentsRoute() {
	const params = Route.useParams();
	const locale = resolveLocale(params.locale);
	const strings = getStrings(locale);
	const sections = [
		["skill", strings.skillTitle],
		["mcp", strings.mcpTitle],
		["api", strings.apiTitle],
		["docs", strings.docsTitle],
	] as const;

	return (
		<ScrollArea className="min-w-0 flex-1 bg-[var(--surface-sidebar)] text-[var(--text-primary)]">
			<div className="flex flex-1 justify-center p-6 sm:p-12">
				<div className="w-full max-w-2xl space-y-12">
					<header className="space-y-4">
						<h1 className="font-bold text-3xl text-[var(--text-heading)] tracking-tight sm:text-4xl">
							{strings.heroTitle}
						</h1>
						<p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
							{strings.heroBody}
						</p>
						<nav className="flex flex-wrap gap-2 text-[12px]">
							{sections.map(([id, title]) => (
								<a
									className="rounded-full border border-[var(--border-default)] bg-[var(--surface-app)] px-3 py-1 text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
									href={`#${id}`}
									key={id}
								>
									{title}
								</a>
							))}
						</nav>
					</header>

					<Section
						body={strings.skillBody}
						id="skill"
						title={strings.skillTitle}
					>
						<Snippet label="Prompt" strings={strings} value={INSTALL_PROMPT} />
					</Section>

					<Section body={strings.mcpBody} id="mcp" title={strings.mcpTitle}>
						<Snippet label="mcp.json" strings={strings} value={MCP_CONFIG} />
						<Snippet
							label="Claude Code"
							strings={strings}
							value={MCP_CLAUDE_CODE}
						/>
						<table className="w-full text-[13px]">
							<caption className="sr-only">{strings.mcpTools}</caption>
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
					</Section>

					<Section body={strings.apiBody} id="api" title={strings.apiTitle}>
						<Snippet label="Digest" strings={strings} value={API_DIGEST} />
						<Snippet label="Topic" strings={strings} value={API_TOPIC} />
						<Snippet label="Response" strings={strings} value={API_RESPONSE} />
					</Section>

					<Section body={strings.docsBody} id="docs" title={strings.docsTitle}>
						<ul className="grid gap-2 sm:grid-cols-2">
							{LINKS.map(([label, href]) => (
								<li key={href}>
									<a
										className="flex flex-col rounded-md border border-[var(--border-subtle)] bg-[var(--surface-app)] px-3.5 py-3 transition-colors hover:bg-[var(--state-hover-subtle)]"
										href={href}
										rel="noopener noreferrer"
										target="_blank"
									>
										<span className="font-medium text-[13px] text-[var(--text-primary)]">
											{label}
										</span>
										<span className="truncate text-[11px] text-[var(--text-muted)]">
											{href}
										</span>
									</a>
								</li>
							))}
						</ul>
					</Section>

					<section className="space-y-4">
						<h2 className="font-semibold text-[17px] text-[var(--text-heading)] tracking-tight">
							{strings.whyTitle}
						</h2>
						<ul className="space-y-2 text-[13px] text-[var(--text-primary)] leading-relaxed">
							{strings.whyBody.map((line) => (
								<li
									className="border-[var(--accent-blue)] border-l-2 pl-3"
									key={line}
								>
									{line}
								</li>
							))}
						</ul>
					</section>

					<section className="space-y-4">
						<h2 className="font-semibold text-[15px] text-[var(--text-heading)] tracking-tight">
							{strings.examplesTitle}
						</h2>
						<ul className="grid gap-3 sm:grid-cols-2">
							{strings.examples.map((example) => (
								<li
									className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-app)] p-3.5 text-[13px] text-[var(--text-primary)] leading-relaxed"
									key={example}
								>
									{example}
								</li>
							))}
						</ul>
					</section>
				</div>
			</div>
		</ScrollArea>
	);
}
