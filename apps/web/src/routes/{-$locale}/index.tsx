import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import Loader from "@/components/loader";
import { SOURCE_SECTIONS_DISPLAY_SETTINGS } from "@/components/trends/display-settings";
import { TrendsPage } from "@/components/trends/trends-page";
import { trendsPageQueryOptions } from "@/components/trends/trends-query";
import type { TrendsPageData } from "@/components/trends/types";
import { resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

const HOME_TOPIC_ID = "home";
const HOME_DISPLAY_SETTINGS_STORE = {
	defaults: SOURCE_SECTIONS_DISPLAY_SETTINGS,
	storageKey: "opentrends:trends:display-settings:home",
} as const;

export const Route = createFileRoute("/{-$locale}/")({
	component: HomeComponent,
	loader: async ({ context, params }) => {
		if (import.meta.env.SSR) {
			return;
		}

		const locale = resolveLocale(params.locale);
		await context.queryClient.ensureQueryData(
			trendsPageQueryOptions(HOME_TOPIC_ID, locale)
		);
	},
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		return buildSeo({
			path: "/",
			locale,
		});
	},
});

function HomeComponent() {
	const params = Route.useParams();
	const locale = resolveLocale(params.locale);
	const trends = useQuery<TrendsPageData, Error>({
		...trendsPageQueryOptions(HOME_TOPIC_ID, locale),
	});

	if (trends.isPending) {
		return <Loader />;
	}

	if (trends.error) {
		throw trends.error;
	}

	const page = trends.data;
	return (
		<TrendsPage
			displaySettingsStore={HOME_DISPLAY_SETTINGS_STORE}
			key={`${page.id}:${locale}:${page.updatedAt}`}
			page={page}
		/>
	);
}
