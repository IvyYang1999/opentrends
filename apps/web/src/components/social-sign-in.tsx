import { env } from "@opentrends/env/web";
import { Button } from "@opentrends/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { GitFork, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { localePathParam, useLocale, useT } from "@/lib/i18n";

type SocialProvider = "google" | "github";

interface ProviderAvailability {
	github: boolean;
	google: boolean;
}

function GoogleMark() {
	return (
		<span
			aria-hidden
			className="inline-flex size-4 items-center justify-center font-semibold text-[#4285f4] text-[13px]"
		>
			G
		</span>
	);
}

export function SocialSignIn() {
	const t = useT();
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const [pendingProvider, setPendingProvider] = useState<
		SocialProvider | undefined
	>(undefined);
	const providers = useQuery({
		queryKey: ["auth-providers"],
		queryFn: async () => {
			const response = await fetch(`${env.VITE_SERVER_URL}/api/auth/providers`);
			if (!response.ok) {
				throw new Error("Unable to load sign-in providers");
			}
			return (await response.json()) as ProviderAvailability;
		},
		staleTime: 5 * 60_000,
	});

	if (providers.isPending) {
		return (
			<div className="space-y-2" role="status">
				<span className="sr-only">{t("sign.loadingProviders")}</span>
				<div className="h-9 animate-pulse rounded bg-[var(--state-hover-subtle)]" />
				<div className="h-9 animate-pulse rounded bg-[var(--state-hover-subtle)]" />
			</div>
		);
	}

	const available = providers.data;
	if (!(available?.google || available?.github)) {
		return null;
	}

	async function signIn(provider: SocialProvider) {
		setPendingProvider(provider);
		try {
			const callbackURL = localeParam
				? `/${localeParam}/trends/ai`
				: "/trends/ai";
			const result = await authClient.signIn.social({ provider, callbackURL });
			if (result.error) {
				toast.error(result.error.message ?? t("sign.socialError"));
				setPendingProvider(undefined);
			}
		} catch {
			toast.error(t("sign.socialError"));
			setPendingProvider(undefined);
		}
	}

	return (
		<div className="space-y-3">
			<div className="grid gap-2 sm:grid-cols-2">
				{available.google ? (
					<Button
						className="w-full gap-2"
						disabled={Boolean(pendingProvider)}
						onClick={() => signIn("google")}
						type="button"
						variant="outline"
					>
						{pendingProvider === "google" ? (
							<LoaderCircle aria-hidden className="size-4 animate-spin" />
						) : (
							<GoogleMark />
						)}
						{t("sign.continueGoogle")}
					</Button>
				) : null}
				{available.github ? (
					<Button
						className="w-full gap-2"
						disabled={Boolean(pendingProvider)}
						onClick={() => signIn("github")}
						type="button"
						variant="outline"
					>
						{pendingProvider === "github" ? (
							<LoaderCircle aria-hidden className="size-4 animate-spin" />
						) : (
							<GitFork aria-hidden className="size-4" />
						)}
						{t("sign.continueGithub")}
					</Button>
				) : null}
			</div>
			<div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
				<span className="h-px flex-1 bg-[var(--border-default)]" />
				<span>{t("sign.orEmail")}</span>
				<span className="h-px flex-1 bg-[var(--border-default)]" />
			</div>
		</div>
	);
}
