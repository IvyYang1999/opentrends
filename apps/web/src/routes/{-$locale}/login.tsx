import { createFileRoute } from "@tanstack/react-router";

import { SocialSignIn } from "@/components/social-sign-in";
import { resolveLocale, useT } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/login")({
	component: RouteComponent,
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
	const t = useT();
	return (
		<main className="min-h-[calc(100svh-2.75rem)] bg-[var(--surface-app)] px-4 py-8 text-[var(--text-primary)]">
			<div className="mx-auto max-w-md border border-[var(--border-default)] bg-[var(--surface-card)] shadow-sm">
				<div className="p-6">
					<h1 className="mb-6 text-center font-bold text-3xl">
						{t("sign.welcomeBack")}
					</h1>
					<SocialSignIn />
				</div>
			</div>
		</main>
	);
}
