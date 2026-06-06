import { createFileRoute } from "@tanstack/react-router";

import { EventFeedPage } from "@/components/trends/event-feed-page";
import { resolveLocale, translate } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

interface EventsSearch {
	topic?: string;
}

function validateEventsSearch(search: Record<string, unknown>): EventsSearch {
	return {
		topic: typeof search.topic === "string" ? search.topic : undefined,
	};
}

export const Route = createFileRoute("/{-$locale}/events")({
	component: EventsComponent,
	validateSearch: validateEventsSearch,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		return buildSeo({
			title: translate(locale, "events.seoTitle"),
			description: translate(locale, "events.seoDescription"),
			path: "/events",
			locale,
		});
	},
});

function EventsComponent() {
	const search = Route.useSearch();
	return <EventFeedPage selectedTopic={search.topic} />;
}
