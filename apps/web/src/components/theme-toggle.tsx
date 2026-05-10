import { Button } from "@opentrends/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@opentrends/ui/components/dropdown-menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { type TranslationKey, useT } from "@/lib/i18n";

const OPTIONS = [
	{ value: "light", labelKey: "theme.light" as TranslationKey, Icon: Sun },
	{ value: "dark", labelKey: "theme.dark" as TranslationKey, Icon: Moon },
	{
		value: "system",
		labelKey: "theme.system" as TranslationKey,
		Icon: Monitor,
	},
] as const;

export default function ThemeToggle() {
	const t = useT();
	const { theme, setTheme } = useTheme();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={t("theme.label")}
						className="text-[var(--text-secondary)] hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
						size="icon-sm"
						title={t("theme.label")}
						variant="ghost"
					/>
				}
			>
				<Sun className="size-4 dark:hidden" />
				<Moon className="hidden size-4 dark:block" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="bg-card">
				{OPTIONS.map(({ value, labelKey, Icon }) => {
					const active = theme === value;
					return (
						<DropdownMenuItem key={value} onClick={() => setTheme(value)}>
							<Icon className="size-4" />
							<span className="flex-1">{t(labelKey)}</span>
							{active ? <Check className="size-3.5" /> : null}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
