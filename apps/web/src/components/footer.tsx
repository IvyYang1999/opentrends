import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import { GITHUB_REPOSITORY_URL } from "@/functions/get-github-repository-stats";
import { localePathParam, useLocale, useT } from "@/lib/i18n";

import Logo from "./logo";

const footerLinkClassName =
	"shrink-0 rounded px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]";

const TOPIC_IDS = [
	"ai",
	"embodied",
	"hardware",
	"biotech",
	"programming",
	"cn",
] as const;

export default function Footer() {
	const t = useT();
	const locale = useLocale();
	const localeParam = localePathParam(locale);
	const links = [
		{ to: "/{-$locale}", label: t("nav.home") },
		{ to: "/{-$locale}/trends", label: t("nav.trends") },
		{ to: "/{-$locale}/events", label: t("nav.events") },
		{ to: "/{-$locale}/sources", label: t("nav.sources") },
		{ to: "/{-$locale}/skills/opentrends", label: t("nav.skills") },
	] as const;

	return (
		<footer className="border-[var(--border-default)] border-t bg-[var(--surface-sidebar)] px-3 py-4 text-[12px] sm:px-4">
			<div className="flex min-w-0 flex-col gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<Link
						aria-label={t("nav.homeAria")}
						className="inline-flex h-5 shrink-0 items-center leading-none"
						params={{ locale: localeParam }}
						to="/{-$locale}"
					>
						<Logo />
					</Link>
					<span className="min-w-0 truncate text-[var(--text-muted)]">
						{t("footer.tagline")}
					</span>
				</div>
				<nav
					aria-label={t("footer.navAria")}
					className="flex min-w-0 flex-wrap gap-x-1 gap-y-1"
				>
					<div className="flex min-w-0 flex-wrap items-center gap-1">
						{links.map(({ to, label }) => (
							<Link
								className={footerLinkClassName}
								key={to}
								params={{ locale: localeParam }}
								to={to}
							>
								{label}
							</Link>
						))}
					</div>
					<span
						aria-hidden
						className="mx-1 hidden h-5 w-px bg-[var(--border-default)] sm:block"
					/>
					<div className="flex min-w-0 flex-wrap items-center gap-1">
						{TOPIC_IDS.map((topicId) => (
							<Link
								className={footerLinkClassName}
								key={topicId}
								params={{ locale: localeParam, topic: topicId }}
								to="/{-$locale}/trends/$topic"
							>
								{t(`topic.${topicId}`)}
							</Link>
						))}
						<a
							className={`${footerLinkClassName} inline-flex items-center gap-1`}
							href={GITHUB_REPOSITORY_URL}
							rel="noopener"
							target="_blank"
						>
							<span>{t("footer.github")}</span>
							<ArrowUpRight className="size-3" />
						</a>
					</div>
				</nav>
			</div>
		</footer>
	);
}
