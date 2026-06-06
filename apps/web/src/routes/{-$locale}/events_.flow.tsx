import { createFileRoute } from "@tanstack/react-router";

import { EventFlowPage } from "@/components/trends/event-flow-page";
import { resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/events_/flow")({
	component: EventFlowPage,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		const isChinese = locale.startsWith("zh");
		return buildSeo({
			title: isChinese ? "Events 处理流" : "Events Processing Flow",
			description: isChinese
				? "可视化展示 OpenTrends 如何从来源刷新、正文抽取、embedding、合并和评分生成事件流。"
				: "A visual map of how OpenTrends turns source refreshes, article extraction, embeddings, merging, and scoring into the event feed.",
			path: "/events/flow",
			locale,
		});
	},
});
