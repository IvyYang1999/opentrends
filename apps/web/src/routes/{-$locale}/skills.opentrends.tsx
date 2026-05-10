import { ScrollArea } from "@opentrends/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";

import { type Locale, resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

const INSTALL_PROMPT =
	"帮我安装 this skill: https://opentrends.io/skills/opentrends/SKILL.md";

const COPY_RESET_MS = 1800;

const STRINGS: Record<
	Locale,
	{
		copied: string;
		copyPrompt: string;
		examples: string;
		examplesList: string[];
		heroBody: string;
		heroTitle: string;
		installBody: string;
		installTitle: string;
		seoDescription: string;
		seoTitle: string;
	}
> = {
	en: {
		copied: "Copied",
		copyPrompt: "Copy prompt",
		examples: "Try after installing",
		examplesList: [
			"Read OpenTrends AI and tell me the five most important updates.",
			"Compare OpenTrends hardware and programming trends today.",
			"Find notable biotech items from OpenTrends and include source links.",
			"Summarize OpenTrends China tech trends in Chinese.",
		],
		heroBody:
			"Install the OpenTrends skill by sending one sentence to your agent. Your agent handles the install location and then reads current trends from the API.",
		heroTitle: "Use OpenTrends from your agent",
		installBody:
			"Send this exact message in your agent. The URL points to the Markdown skill file, and the agent installs it into the right directory.",
		installTitle: "Install",
		seoDescription:
			"Install the OpenTrends agent skill and read structured trend data from api.opentrends.io.",
		seoTitle: "OpenTrends agent skill",
	},
	zh: {
		copied: "已复制",
		copyPrompt: "复制",
		examples: "安装后可以这样问",
		examplesList: [
			"帮我读一下 OpenTrends AI，列出最重要的 5 条更新。",
			"对比一下 OpenTrends 今天的硬件和编程趋势。",
			"从 OpenTrends 生物科技里挑几条值得关注的内容，带来源链接。",
			"用中文总结 OpenTrends 的中国科技趋势。",
		],
		heroBody:
			"把一句话发给你的 Agent，就能安装 OpenTrends skill。Agent 会自己处理安装路径，然后通过 API 读取最新趋势。",
		heroTitle: "在 Agent 里使用 OpenTrends",
		installBody:
			"在你的 Agent 里直接发这句话。URL 指向给 AI 看的 Markdown skill 文件，Agent 会自己安装到对应目录。",
		installTitle: "安装",
		seoDescription:
			"安装 OpenTrends Agent skill，通过 api.opentrends.io 读取结构化趋势数据。",
		seoTitle: "OpenTrends Agent skill",
	},
	"zh-Hant": {
		copied: "已複製",
		copyPrompt: "複製",
		examples: "安裝後可以這樣問",
		examplesList: [
			"幫我讀一下 OpenTrends AI，列出最重要的 5 則更新。",
			"比較一下 OpenTrends 今天的硬體和程式開發趨勢。",
			"從 OpenTrends 生物科技裡挑幾則值得關注的內容，附來源連結。",
			"用中文總結 OpenTrends 的中國科技趨勢。",
		],
		heroBody:
			"把一句話發給你的 Agent，就能安裝 OpenTrends skill。Agent 會自己處理安裝路徑，然後透過 API 讀取最新趨勢。",
		heroTitle: "在 Agent 裡使用 OpenTrends",
		installBody:
			"在你的 Agent 裡直接發這句話。URL 指向給 AI 看的 Markdown skill 檔案，Agent 會自己安裝到對應目錄。",
		installTitle: "安裝",
		seoDescription:
			"安裝 OpenTrends Agent skill，透過 api.opentrends.io 讀取結構化趨勢資料。",
		seoTitle: "OpenTrends Agent skill",
	},
	ru: {
		copied: "Скопировано",
		copyPrompt: "Скопировать",
		examples: "Попробуйте после установки",
		examplesList: [
			"Read OpenTrends AI and tell me the five most important updates.",
			"Compare OpenTrends hardware and programming trends today.",
			"Find notable biotech items from OpenTrends and include source links.",
			"Summarize OpenTrends China tech trends in Chinese.",
		],
		heroBody:
			"Отправьте одну фразу своему агенту, чтобы установить навык OpenTrends. Агент сам выберет путь установки и будет читать актуальные тренды через API.",
		heroTitle: "Используйте OpenTrends из агента",
		installBody:
			"Отправьте это сообщение в своем агенте. URL ведет на Markdown-файл навыка, а агент установит его в правильный каталог.",
		installTitle: "Установка",
		seoDescription:
			"Установите навык OpenTrends для агента и читайте структурированные данные трендов с api.opentrends.io.",
		seoTitle: "Навык OpenTrends для агента",
	},
};

export const Route = createFileRoute("/{-$locale}/skills/opentrends")({
	component: OpenTrendsSkillRoute,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		const strings = STRINGS[locale];
		return buildSeo({
			title: strings.seoTitle,
			description: strings.seoDescription,
			path: "/skills/opentrends",
			keywords: ["agent skill", "OpenTrends API", "trend API"],
			locale,
		});
	},
});

function OpenTrendsSkillRoute() {
	const params = Route.useParams();
	const locale = resolveLocale(params.locale);
	const strings = STRINGS[locale];
	const [copied, setCopied] = useState(false);

	function copyPrompt() {
		setCopied(true);
		window.setTimeout(() => setCopied(false), COPY_RESET_MS);
		copyText(INSTALL_PROMPT).catch(() => undefined);
	}

	return (
		<ScrollArea className="h-full min-w-0 bg-[var(--surface-sidebar)] text-[var(--text-primary)]">
			<div className="flex min-h-full items-center justify-center p-6 sm:p-12">
				<div className="w-full max-w-2xl space-y-12">
					{/* Hero Section */}
					<header className="space-y-4">
						<h1 className="font-bold text-3xl text-[var(--text-heading)] tracking-tight sm:text-4xl">
							{strings.heroTitle}
						</h1>
						<p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
							{strings.heroBody}
						</p>
					</header>

					<div className="space-y-12">
						{/* Installation Card */}
						<section className="space-y-4">
							<h2 className="font-semibold text-[15px] text-[var(--text-heading)] tracking-tight">
								{strings.installTitle}
							</h2>
							<div className="overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-app)]">
								<div className="flex items-center justify-between border-[var(--border-default)] border-b bg-[var(--surface-card)] px-3 py-2">
									<div className="flex items-center gap-2 font-medium text-[11px] text-[var(--text-muted)]">
										<Terminal className="size-3.5" />
										<span>Install Prompt</span>
									</div>{" "}
									<button
										className="inline-flex items-center gap-1.5 rounded bg-[var(--accent-blue)] px-2.5 py-1 font-medium text-[11px] text-white transition-opacity hover:opacity-90"
										onClick={copyPrompt}
										type="button"
									>
										{copied ? (
											<Check className="size-3" />
										) : (
											<Copy className="size-3" />
										)}
										{copied ? strings.copied : strings.copyPrompt}
									</button>
								</div>
								<div className="p-4">
									<code className="block break-all text-[14px] text-[var(--text-primary)] leading-6 sm:break-normal">
										{INSTALL_PROMPT}
									</code>
								</div>
							</div>
							<p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
								{strings.installBody}
							</p>
						</section>

						{/* Examples Section */}
						<section className="space-y-4">
							<h2 className="font-semibold text-[15px] text-[var(--text-heading)] tracking-tight">
								{strings.examples}
							</h2>
							<ul className="grid gap-3 sm:grid-cols-2">
								{strings.examplesList.map((example) => (
									<li
										className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-app)] p-3.5 text-[13px] text-[var(--text-primary)] leading-relaxed transition-colors hover:bg-[var(--state-hover-subtle)]"
										key={example}
									>
										{example}
									</li>
								))}
							</ul>
						</section>
					</div>
				</div>
			</div>
		</ScrollArea>
	);
}

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
