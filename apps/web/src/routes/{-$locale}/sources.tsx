import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import Loader from "@/components/loader";
import { loadSourcesStatus } from "@/components/trends/load-sources";
import { SourcesPage } from "@/components/trends/sources-page";
import type { SourcesStatusResponse } from "@/components/trends/sources-types";
import { resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/sources")({
	component: SourcesRoute,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		return buildSeo({
			title: "Sources & feed health",
			description:
				"Live status for every source OpenTrends aggregates — feed freshness, last update time and any fetch errors across native adapters, RSSHub routes and RSS feeds.",
			path: "/sources",
			keywords: ["RSS sources", "feed status", "data sources"],
			locale,
		});
	},
});

function SourcesRoute() {
	const sources = useQuery<SourcesStatusResponse, Error>({
		queryKey: ["sources-status"],
		queryFn: () => loadSourcesStatus(),
		enabled: typeof window !== "undefined",
	});

	if (sources.isPending) {
		return <Loader />;
	}

	if (sources.error) {
		throw sources.error;
	}

	return <SourcesPage data={sources.data} />;
}
