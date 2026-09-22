import { env } from "@opentrends/env/web";
import { Button } from "@opentrends/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { GitHubMark, GoogleMark } from "@/components/brand-marks";
import { authClient } from "@/lib/auth-client";
import { localePathParam, useLocale, useT } from "@/lib/i18n";

import { buildSocialCallbackUrl } from "./social-sign-in-model";

type SocialProvider = "google" | "github";

interface ProviderAvailability {
	github: boolean;
	google: boolean;
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
			<div className="flex flex-col gap-2" role="status">
				<span className="sr-only">{t("sign.loadingProviders")}</span>
				<div className="h-9 animate-pulse bg-[var(--state-hover-subtle)]" />
				<div className="h-9 animate-pulse bg-[var(--state-hover-subtle)]" />
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
			const callbackURL = buildSocialCallbackUrl(
				window.location.origin,
				localeParam
			);
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

	const buttonClassName =
		"h-9 w-full justify-start gap-3 border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-[13px] text-[var(--text-primary)] hover:bg-[var(--state-hover-subtle)]";

	return (
		<div className="flex flex-col gap-2">
			{available.github ? (
				<Button
					className={buttonClassName}
					disabled={Boolean(pendingProvider)}
					onClick={() => signIn("github")}
					type="button"
					variant="outline"
				>
					{pendingProvider === "github" ? (
						<LoaderCircle aria-hidden className="size-4 animate-spin" />
					) : (
						<GitHubMark className="size-4" />
					)}
					{t("sign.continueGithub")}
				</Button>
			) : null}
			{available.google ? (
				<Button
					className={buttonClassName}
					disabled={Boolean(pendingProvider)}
					onClick={() => signIn("google")}
					type="button"
					variant="outline"
				>
					{pendingProvider === "google" ? (
						<LoaderCircle aria-hidden className="size-4 animate-spin" />
					) : (
						<GoogleMark className="size-4" />
					)}
					{t("sign.continueGoogle")}
				</Button>
			) : null}
		</div>
	);
}
