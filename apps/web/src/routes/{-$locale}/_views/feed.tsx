import { createFileRoute } from "@tanstack/react-router";

import { FeedPage } from "@/components/trends/feed-page";
import { trendsPageUrl } from "@/components/trends/load-trends";
import { trendsPageQueryOptions } from "@/components/trends/trends-query";
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

export const Route = createFileRoute("/{-$locale}/_views/feed")({
	component: FeedComponent,
	validateSearch: validateFeedSearch,
	loaderDeps: ({ search }) => ({ topic: search.topic ?? "featured" }),
	// On the client the topic's page is fetched before the navigation
	// completes, so the digest bar and the feed change together. Server
	// rendering skips this: the feed is drawn on the client and the head
	// preloads the same request.
	loader: async ({ context, deps, params }) => {
		if (import.meta.env.SSR || deps.topic === "mine") {
			return;
		}
		await context.queryClient.ensureQueryData(
			trendsPageQueryOptions(deps.topic, resolveLocale(params.locale))
		);
	},
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
