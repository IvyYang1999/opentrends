import { createFileRoute } from "@tanstack/react-router";

import { FeedPage } from "@/components/trends/feed-page";
import { resolveLocale, translate } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

interface FeedSearch {
	topic?: string;
}

function validateFeedSearch(search: Record<string, unknown>): FeedSearch {
	return {
		topic: typeof search.topic === "string" ? search.topic : undefined,
	};
}

export const Route = createFileRoute("/{-$locale}/feed")({
	component: FeedComponent,
	validateSearch: validateFeedSearch,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		return buildSeo({
			title: translate(locale, "nav.feed"),
			description: translate(locale, "feed.seoDescription"),
			path: "/feed",
			locale,
		});
	},
});

function FeedComponent() {
	const search = Route.useSearch();
	return <FeedPage topicId={search.topic ?? "featured"} />;
}
