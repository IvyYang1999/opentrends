import { createFileRoute } from "@tanstack/react-router";

import { FeedPage } from "@/components/trends/feed-page";
import { trendsPageUrl } from "@/components/trends/load-trends";
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
	head: ({ params, match }) => {
		const locale = resolveLocale(params.locale);
		const seo = buildSeo({
			title: translate(locale, "nav.feed"),
			description: translate(locale, "feed.seoDescription"),
			path: "/feed",
			locale,
		});
		// The feed is rendered on the client, so without this the data
		// request only starts once the scripts have loaded and run. Preloading
		// it from the head puts the two downloads side by side.
		const topic = match.search.topic ?? "featured";
		return {
			...seo,
			links: [
				...seo.links,
				{
					as: "fetch",
					crossOrigin: "anonymous",
					href: trendsPageUrl(topic, locale),
					rel: "preload",
				},
			],
		};
	},
});

function FeedComponent() {
	const search = Route.useSearch();
	return <FeedPage topicId={search.topic ?? "featured"} />;
}
