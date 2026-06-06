/* biome-ignore lint/style/useFilenamingConvention: TanStack file-route naming requires $topic segment. */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import Loader from "@/components/loader";
import { TrendsTopicNotFoundError } from "@/components/trends/load-trends";
import { TrendsPage } from "@/components/trends/trends-page";
import { trendsPageQueryOptions } from "@/components/trends/trends-query";
import type { TrendsPageData } from "@/components/trends/types";
import {
	type Locale,
	resolveLocale,
	type TranslationKey,
	translate,
} from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

const TOPIC_SLUG_SEPARATOR_RE = /[-_]+/;

const TOPIC_TITLE_KEYS = {
	ai: "topic.ai",
	embodied: "topic.embodied",
	hardware: "topic.hardware",
	biotech: "topic.biotech",
	programming: "topic.programming",
	cn: "topic.cn",
} as const satisfies Record<string, TranslationKey>;

function humanizeTopicSlug(topic: string): string {
	return topic
		.split(TOPIC_SLUG_SEPARATOR_RE)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function getTopicLabel(topic: string, locale: Locale): string {
	const key = TOPIC_TITLE_KEYS[topic as keyof typeof TOPIC_TITLE_KEYS];
	return key ? translate(locale, key) : humanizeTopicSlug(topic);
}

function buildTopicTitle(topicLabel: string, locale: Locale): string {
	if (locale === "zh") {
		return `${topicLabel}趋势`;
	}
	if (locale === "zh-Hant") {
		return `${topicLabel}趨勢`;
	}
	if (locale === "ru") {
		return `Тренды: ${topicLabel}`;
	}
	return `${topicLabel} Trends`;
}

function buildTopicDescription(topicLabel: string, locale: Locale): string {
	if (locale === "zh") {
		return `OpenTrends 持续聚合${topicLabel}领域的热门新闻、社区讨论和研究动态。`;
	}
	if (locale === "zh-Hant") {
		return `OpenTrends 持續聚合${topicLabel}領域的熱門新聞、社群討論和研究動態。`;
	}
	if (locale === "ru") {
		return `OpenTrends непрерывно собирает популярные новости, обсуждения и исследования по теме ${topicLabel}.`;
	}
	return `Trending ${topicLabel} news aggregated from curated sources, updated continuously by OpenTrends.`;
}

function buildTopicKeywords(
	topic: string,
	topicLabel: string,
	locale: Locale
): string[] {
	if (locale === "zh") {
		return [topic, topicLabel, `${topicLabel}资讯`, `${topicLabel}热点`];
	}
	if (locale === "zh-Hant") {
		return [topic, topicLabel, `${topicLabel}資訊`, `${topicLabel}熱點`];
	}
	if (locale === "ru") {
		return [topic, topicLabel, `${topicLabel} новости`, `${topicLabel} тренды`];
	}
	return [topic, topicLabel, `${topicLabel} news`, `${topicLabel} trending`];
}

export const Route = createFileRoute("/{-$locale}/trends/$topic")({
	component: TrendsTopicComponent,
	loader: async ({ context, params }) => {
		if (params.topic === "brain") {
			throw redirect({
				to: "/{-$locale}/trends/$topic",
				params: { ...params, topic: "biotech" },
			});
		}

		if (import.meta.env.SSR) {
			return;
		}

		const locale = resolveLocale(params.locale);
		await context.queryClient.ensureQueryData(
			trendsPageQueryOptions(params.topic, locale)
		);
	},
	head: ({ params }) => {
		const topic = params.topic;
		const locale = resolveLocale(params.locale);
		const topicLabel = getTopicLabel(topic, locale);
		const title = buildTopicTitle(topicLabel, locale);
		const description = buildTopicDescription(topicLabel, locale);
		return buildSeo({
			title,
			description,
			path: `/trends/${topic}`,
			keywords: buildTopicKeywords(topic, topicLabel, locale),
			locale,
		});
	},
});

function TrendsTopicComponent() {
	const params = Route.useParams();
	const locale = resolveLocale(params.locale);
	const trends = useQuery<TrendsPageData, Error>({
		...trendsPageQueryOptions(params.topic, locale),
	});

	if (trends.isPending) {
		return <Loader />;
	}

	if (trends.error) {
		if (trends.error instanceof TrendsTopicNotFoundError) {
			throw notFound();
		}
		throw trends.error;
	}

	const page = trends.data;
	return (
		<TrendsPage key={`${page.id}:${locale}:${page.updatedAt}`} page={page} />
	);
}
