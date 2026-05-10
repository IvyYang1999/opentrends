import { createFileRoute, redirect } from "@tanstack/react-router";

import { resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/dashboard")({
	component: RouteComponent,
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/{-$locale}",
			params,
		});
	},
	head: ({ params }) => {
		const locale = resolveLocale(params.locale);
		return buildSeo({
			title: "Dashboard",
			description: "Your private OpenTrends dashboard.",
			path: "/dashboard",
			noindex: true,
			locale,
		});
	},
});

function RouteComponent() {
	return null;
}
