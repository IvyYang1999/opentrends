import { createFileRoute } from "@tanstack/react-router";

import Logo from "@/components/logo";
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

// The header opens sign-in as a dialog; this page only serves direct links
// and OAuth round-trips, so it mirrors the dialog's layout.
function RouteComponent() {
	const t = useT();
	return (
		<main className="min-h-[calc(100svh-2.75rem)] bg-[var(--surface-app)] px-4 py-12 text-[var(--text-primary)]">
			<div className="mx-auto w-[min(360px,100%)] border border-[var(--border-default)] bg-[var(--surface-card)] shadow-sm">
				<div className="flex items-center gap-3 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2">
					<Logo showWordmark={false} />
					<h1 className="font-semibold text-[13px]">{t("sign.dialogTitle")}</h1>
				</div>
				<div className="flex flex-col gap-4 px-4 py-4">
					<p className="text-[12px] text-[var(--text-secondary)]">
						{t("sign.dialogDescription")}
					</p>
					<SocialSignIn />
				</div>
			</div>
		</main>
	);
}
