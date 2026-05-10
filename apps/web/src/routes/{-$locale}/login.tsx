import { createFileRoute, redirect } from "@tanstack/react-router";

import { resolveLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/login")({
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
			title: "Sign in",
			description: "Sign in or create an OpenTrends account.",
			path: "/login",
			noindex: true,
			locale,
		});
	},
});

function RouteComponent() {
	return null;
}
