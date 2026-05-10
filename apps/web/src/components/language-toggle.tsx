import { Button } from "@opentrends/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@opentrends/ui/components/dropdown-menu";
import { useRouterState } from "@tanstack/react-router";
import { Check, Languages } from "lucide-react";

import {
	DEFAULT_LOCALE,
	LOCALE_LABELS,
	LOCALES,
	type Locale,
	setUserLocale,
	useLocale,
	useT,
} from "@/lib/i18n";

const PATH_SEGMENT_PATTERN = /^\/([^/]+)(.*)$/;

function localizeCurrentPath(
	pathname: string,
	search: string,
	hash: string,
	locale: Locale
) {
	const [, firstSegment, rest = ""] =
		pathname.match(PATH_SEGMENT_PATTERN) ?? [];
	const hasLocalePrefix =
		firstSegment !== undefined &&
		(LOCALES as readonly string[]).includes(firstSegment);
	const basePath = hasLocalePrefix ? rest || "/" : pathname || "/";
	let localizedPath = basePath;

	if (locale !== DEFAULT_LOCALE) {
		localizedPath = basePath === "/" ? `/${locale}` : `/${locale}${basePath}`;
	}

	return `${localizedPath}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

export default function LanguageToggle() {
	const t = useT();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const search = useRouterState({ select: (s) => s.location.searchStr });
	const hash = useRouterState({ select: (s) => s.location.hash });
	const current = useLocale();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={t("language.label")}
						className="text-[var(--text-secondary)] hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
						size="icon-sm"
						title={t("language.label")}
						variant="ghost"
					/>
				}
			>
				<Languages className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="bg-card">
				{LOCALES.map((locale) => {
					const active = current === locale;
					return (
						<DropdownMenuItem
							key={locale}
							onClick={() => {
								if (active) {
									return;
								}
								setUserLocale(locale, { reload: false });
								window.location.assign(
									localizeCurrentPath(pathname, search, hash, locale)
								);
							}}
						>
							<span className="flex-1">{LOCALE_LABELS[locale]}</span>
							{active ? <Check className="size-3.5" /> : null}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
