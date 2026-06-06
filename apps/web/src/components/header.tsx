import { buttonVariants } from "@opentrends/ui/components/button";
import { cn } from "@opentrends/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";

import { trendsPageQueryOptions } from "@/components/trends/trends-query";
import {
	GITHUB_REPOSITORY_URL,
	type GitHubRepositoryStats,
	getGithubRepositoryStats,
} from "@/functions/get-github-repository-stats";
import { localePathParam, useLocale, useT } from "@/lib/i18n";

import LanguageToggle from "./language-toggle";
import Logo from "./logo";
import ThemeToggle from "./theme-toggle";

const TOPIC_IDS = [
	"ai",
	"embodied",
	"hardware",
	"biotech",
	"programming",
	"cn",
] as const;

const linkClassName =
	"shrink-0 rounded px-2 py-1 text-[var(--text-secondary)] whitespace-nowrap transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] data-[status=active]:bg-[var(--accent-blue-bg)] data-[status=active]:text-[var(--accent-blue)]";

const GITHUB_STATS_STALE_MS = 10 * 60_000;
const GITHUB_STATS_GC_MS = 60 * 60_000;

function formatStars(stars: number | null | undefined): string {
	if (typeof stars !== "number") {
		return "--";
	}

	return new Intl.NumberFormat("en", {
		compactDisplay: "short",
		maximumFractionDigits: stars >= 1000 ? 1 : 0,
		notation: "compact",
	}).format(stars);
}

interface HeaderProps {
	initialGithubStats: GitHubRepositoryStats;
}

export default function Header({ initialGithubStats }: HeaderProps) {
	const t = useT();
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const queryClient = useQueryClient();
	const githubStats = useQuery({
		queryKey: ["github-repository-stats"],
		queryFn: () => getGithubRepositoryStats(),
		gcTime: GITHUB_STATS_GC_MS,
		initialData: initialGithubStats,
		refetchOnWindowFocus: false,
		staleTime: GITHUB_STATS_STALE_MS,
	});
	const githubStars = formatStars(githubStats.data?.stars);
	const githubUrl = githubStats.data?.url ?? GITHUB_REPOSITORY_URL;

	function prefetchTopic(topic: string) {
		queryClient
			.prefetchQuery(trendsPageQueryOptions(topic, locale))
			.catch(() => {
				/* Navigation still loads the page normally if intent prefetch fails. */
			});
	}

	const links = [
		{ to: "/{-$locale}/trends", label: t("nav.trends") },
		{ to: "/{-$locale}/events", label: t("nav.events") },
		{ to: "/{-$locale}/skills/opentrends", label: t("nav.skills") },
	] as const;

	return (
		<header className="min-w-0 overflow-hidden border-[var(--border-default)] border-b bg-[var(--surface-sidebar)]">
			<div className="flex min-h-11 min-w-0 flex-col gap-2 px-3 py-2 sm:px-4 lg:h-11 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:py-0">
				<div className="order-1 flex items-center justify-between gap-3 lg:order-2 lg:ml-auto">
					<Link
						aria-label={t("nav.homeAria")}
						className="inline-flex h-5 shrink-0 items-center leading-none lg:hidden"
						params={{ locale: localeParam }}
						to="/{-$locale}"
					>
						<Logo />
					</Link>
					<div className="flex shrink-0 items-center gap-2">
						<a
							aria-label={`Open OpenTrends on GitHub, ${githubStars} stars`}
							className={cn(
								buttonVariants({ size: "sm", variant: "outline" }),
								"h-7 gap-1.5 border-[var(--border-default)] bg-transparent px-2 text-[var(--text-secondary)] hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
							)}
							href={githubUrl}
							rel="noopener"
							target="_blank"
							title="Open OpenTrends on GitHub"
						>
							<span>GitHub</span>
							<Star className="size-3.5" />
							<span className="tabular-nums">{githubStars}</span>
						</a>
						<LanguageToggle />
						<ThemeToggle />
					</div>
				</div>
				<nav className="order-2 flex w-full min-w-0 items-center gap-1 overflow-x-auto text-[13px] [-ms-overflow-style:none] [scrollbar-width:none] lg:order-1 lg:w-auto lg:overflow-visible [&::-webkit-scrollbar]:hidden">
					<Link
						aria-label={t("nav.homeAria")}
						className="mr-3 hidden h-5 shrink-0 items-center leading-none lg:inline-flex"
						params={{ locale: localeParam }}
						to="/{-$locale}"
					>
						<Logo />
					</Link>
					{links.map(({ to, label }) => (
						<Link
							className={linkClassName}
							key={to}
							params={{ locale: localeParam }}
							to={to}
						>
							{label}
						</Link>
					))}
					<span
						aria-hidden
						className="mx-1 h-4 w-px shrink-0 bg-[var(--border-default)] lg:mx-2"
					/>
					{TOPIC_IDS.map((id) => (
						<Link
							className={linkClassName}
							key={id}
							onFocus={() => prefetchTopic(id)}
							onMouseEnter={() => prefetchTopic(id)}
							params={{ locale: localeParam, topic: id }}
							to="/{-$locale}/trends/$topic"
						>
							{t(`topic.${id}`)}
						</Link>
					))}
				</nav>
			</div>
		</header>
	);
}
