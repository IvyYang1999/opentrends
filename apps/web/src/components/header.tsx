import { buttonVariants } from "@opentrends/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@opentrends/ui/components/dropdown-menu";
import { cn } from "@opentrends/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useLocation,
	useParams,
	useSearch,
} from "@tanstack/react-router";
import { LogOut, Star, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SearchCommand, SearchTrigger } from "@/components/search-command";
import { SignInDialog } from "@/components/sign-in-dialog";
import {
	GITHUB_REPOSITORY_URL,
	type GitHubRepositoryStats,
	getGithubRepositoryStats,
} from "@/functions/get-github-repository-stats";
import { authClient } from "@/lib/auth-client";
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

const topicClassName =
	"shrink-0 rounded px-2 py-1 text-[var(--text-secondary)] whitespace-nowrap transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]";
const topicActiveClassName =
	"bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)] hover:text-[var(--accent-blue)]";

const GITHUB_STATS_STALE_MS = 10 * 60_000;
const GITHUB_STATS_GC_MS = 60 * 60_000;

function formatStars(stars: number | null | undefined): string | null {
	if (typeof stars !== "number") {
		return null;
	}

	return new Intl.NumberFormat("en", {
		compactDisplay: "short",
		maximumFractionDigits: stars >= 1000 ? 1 : 0,
		notation: "compact",
	}).format(stars);
}

function AccountMenu() {
	const t = useT();
	const session = authClient.useSession();
	const [signInOpen, setSignInOpen] = useState(false);

	if (session.isPending) {
		return (
			<span
				aria-hidden
				className="size-7 animate-pulse rounded-full bg-[var(--state-hover-subtle)]"
			/>
		);
	}

	const user = session.data?.user;
	if (!user) {
		return (
			<>
				<button
					className={cn(
						buttonVariants({ size: "sm", variant: "outline" }),
						"h-7 border-[var(--border-default)] bg-transparent px-2.5 text-[var(--text-primary)] hover:bg-[var(--state-hover-subtle)]"
					)}
					onClick={() => setSignInOpen(true)}
					type="button"
				>
					{t("userMenu.signIn")}
				</button>
				<SignInDialog onOpenChange={setSignInOpen} open={signInOpen} />
			</>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={t("userMenu.myAccount")}
				className="inline-flex size-7 items-center justify-center overflow-hidden rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] data-[popup-open]:bg-[var(--state-hover-subtle)]"
			>
				{user.image ? (
					<img
						alt=""
						className="size-6 rounded-full object-cover"
						height={24}
						src={user.image}
						width={24}
					/>
				) : (
					<UserRound aria-hidden className="size-4" />
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-52 bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel className="min-w-0">
						<span className="block truncate text-[var(--text-primary)]">
							{user.name}
						</span>
						<span className="block truncate font-normal">{user.email}</span>
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={async () => {
						const result = await authClient.signOut();
						if (result.error) {
							toast.error(result.error.message);
						}
					}}
				>
					<LogOut aria-hidden className="size-3.5" />
					{t("userMenu.signOut")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// A topic tab is active on its trends page and on the events feed filtered
// to it, so switching between the two views keeps the tab lit.
function TopicLink({
	id,
	localeParam,
}: {
	id: (typeof TOPIC_IDS)[number];
	localeParam: ReturnType<typeof localePathParam>;
}) {
	const t = useT();
	const { topic } = useParams({ strict: false }) as { topic?: string };
	const search = useSearch({ strict: false }) as { topic?: string };
	const location = useLocation();
	const onEvents = location.pathname.includes("/events");
	const active = onEvents ? search.topic === id : topic === id;
	return (
		<Link
			className={cn(topicClassName, active && topicActiveClassName)}
			params={{ locale: localeParam, topic: id }}
			search={onEvents ? { topic: id } : undefined}
			to={onEvents ? "/{-$locale}/events" : "/{-$locale}/trends/$topic"}
		>
			{t(`topic.${id}`)}
		</Link>
	);
}

interface HeaderProps {
	initialGithubStats: GitHubRepositoryStats;
}

export default function Header({ initialGithubStats }: HeaderProps) {
	const t = useT();
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const [searchOpen, setSearchOpen] = useState(false);
	const githubStats = useQuery({
		queryKey: ["github-repository-stats"],
		queryFn: () => getGithubRepositoryStats(),
		gcTime: GITHUB_STATS_GC_MS,
		initialData: initialGithubStats,
		refetchOnWindowFocus: false,
		staleTime: GITHUB_STATS_STALE_MS,
	});
	const githubStars = formatStars(githubStats.data?.stars);
	const githubLabel = githubStars
		? `Open OpenTrends on GitHub, ${githubStars} stars`
		: "Open OpenTrends on GitHub";
	const githubUrl = githubStats.data?.url ?? GITHUB_REPOSITORY_URL;

	return (
		<header className="sticky top-0 z-[80] min-w-0 overflow-hidden border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] shadow-[0_1px_0_rgba(0,0,0,0.02)]">
			<div className="flex min-h-10 min-w-0 flex-col gap-2 px-3 py-2 sm:px-4 lg:h-10 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:py-0">
				<div className="order-1 flex items-center justify-between gap-3 lg:order-2 lg:ml-auto lg:shrink-0">
					<Link
						aria-label={t("nav.homeAria")}
						className="inline-flex h-5 shrink-0 items-center leading-none lg:hidden"
						params={{ locale: localeParam }}
						to="/{-$locale}"
					>
						<Logo />
					</Link>
					<div className="flex shrink-0 items-center gap-2">
						<SearchTrigger onClick={() => setSearchOpen(true)} />
						<Link
							className="hidden h-7 items-center rounded px-2 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] lg:inline-flex"
							params={{ locale: localeParam }}
							title={t("nav.skillsTitle")}
							to="/{-$locale}/skills/opentrends"
						>
							{t("nav.skills")}
						</Link>
						<a
							aria-label={githubLabel}
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
							{githubStars ? (
								<span className="tabular-nums">{githubStars}</span>
							) : null}
						</a>
						<LanguageToggle />
						<ThemeToggle />
						<AccountMenu />
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
					{TOPIC_IDS.map((id) => (
						<TopicLink id={id} key={id} localeParam={localeParam} />
					))}
				</nav>
			</div>
			<SearchCommand onOpenChange={setSearchOpen} open={searchOpen} />
		</header>
	);
}
