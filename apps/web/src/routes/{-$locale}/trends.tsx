import { createFileRoute, Outlet } from "@tanstack/react-router";

import { resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/trends")({
	component: TrendsLayout,
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		return buildSeo({
			title: "Trends",
			description:
				"Browse curated trending news streams across AI, embodied AI, biological science, smart hardware, tech, indie maker and Chinese-language communities.",
			path: "/trends",
			locale,
		});
	},
});

function TrendsLayout() {
	return <Outlet />;
}
