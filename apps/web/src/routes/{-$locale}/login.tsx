import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { resolveLocale } from "@/lib/i18n";
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
	const [showSignUp, setShowSignUp] = useState(false);
	return (
		<main className="min-h-[calc(100svh-2.75rem)] bg-[var(--surface-app)] px-4 py-8 text-[var(--text-primary)]">
			<div className="mx-auto max-w-md border border-[var(--border-default)] bg-[var(--surface-card)] shadow-sm">
				{showSignUp ? (
					<SignUpForm onSwitchToSignIn={() => setShowSignUp(false)} />
				) : (
					<SignInForm onSwitchToSignUp={() => setShowSignUp(true)} />
				)}
			</div>
		</main>
	);
}
