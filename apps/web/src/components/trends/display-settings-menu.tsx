import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@opentrends/ui/components/dropdown-menu";
import { LayoutGrid, Settings2 } from "lucide-react";

import { type TranslationKey, useT } from "@/lib/i18n";

import {
	type DisplayLayout,
	type DisplaySettings,
	type DisplaySettingsStoreOptions,
	setDisplayLayout,
	setDisplaySetting,
	useDisplaySettings,
} from "./display-settings";

interface LayoutEntry {
	labelKey: TranslationKey;
	value: DisplayLayout;
}

type DisplayToggleKey = Exclude<keyof DisplaySettings, "layout">;

interface ToggleEntry {
	key: DisplayToggleKey;
	labelKey: TranslationKey;
}

const LAYOUTS: readonly LayoutEntry[] = [
	{ value: "sourceGrid", labelKey: "display.layoutSourceGrid" },
	{ value: "sourceSections", labelKey: "display.layoutSourceSections" },
];

const TOGGLES: readonly ToggleEntry[] = [
	{ key: "showCover", labelKey: "display.cover" },
	{ key: "showDescription", labelKey: "display.description" },
	{ key: "showRank", labelKey: "display.rank" },
	{ key: "showHotValue", labelKey: "display.hotValue" },
	{ key: "showRelativeTime", labelKey: "display.publishedTime" },
];

const MENU_TRIGGER_CLASS =
	"inline-flex h-7 items-center gap-1.5 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] data-[popup-open]:bg-[var(--state-hover-subtle)] data-[popup-open]:text-[var(--text-primary)] [&>span]:hidden sm:[&>span]:inline";

export function LayoutSettingsMenu() {
	const t = useT();
	const settings = useDisplaySettings();
	return <LayoutSettingsMenuContent settings={settings} t={t} />;
}

export function LayoutSettingsMenuContent({
	settings,
	storeOptions,
	t,
	sources = [],
	hiddenSourceIds = [],
	onSourceVisibilityChange,
}: {
	settings: DisplaySettings;
	storeOptions?: DisplaySettingsStoreOptions;
	t: ReturnType<typeof useT>;
	sources?: readonly { id: string; title: string }[];
	hiddenSourceIds?: readonly string[];
	onSourceVisibilityChange?: (sourceId: string, visible: boolean) => void;
}) {
	const hiddenSourceIdSet = new Set(hiddenSourceIds);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={t("display.layout")}
				className={MENU_TRIGGER_CLASS}
			>
				<LayoutGrid aria-hidden className="size-3.5" />
				<span>{t("display.layout")}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel>{t("display.layout")}</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						onValueChange={(value) => {
							const nextLayout = LAYOUTS.find(
								(layout) => layout.value === value
							)?.value;
							if (nextLayout) {
								setDisplayLayout(nextLayout, storeOptions);
							}
						}}
						value={settings.layout}
					>
						{LAYOUTS.map((layout) => (
							<DropdownMenuRadioItem key={layout.value} value={layout.value}>
								{t(layout.labelKey)}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
				{sources.length > 0 && onSourceVisibilityChange ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>{t("display.sources")}</DropdownMenuLabel>
							{sources.map((source) => (
								<DropdownMenuCheckboxItem
									checked={!hiddenSourceIdSet.has(source.id)}
									closeOnClick={false}
									key={source.id}
									onCheckedChange={(checked) =>
										onSourceVisibilityChange(source.id, Boolean(checked))
									}
								>
									<span className="max-w-64 truncate">{source.title}</span>
								</DropdownMenuCheckboxItem>
							))}
						</DropdownMenuGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function DisplaySettingsMenu() {
	const t = useT();
	const settings = useDisplaySettings();
	return <DisplaySettingsMenuContent settings={settings} t={t} />;
}

export function DisplaySettingsMenuContent({
	settings,
	storeOptions,
	t,
}: {
	settings: DisplaySettings;
	storeOptions?: DisplaySettingsStoreOptions;
	t: ReturnType<typeof useT>;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={t("display.settings")}
				className={MENU_TRIGGER_CLASS}
			>
				<Settings2 aria-hidden className="size-3.5" />
				<span>{t("display.label")}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel>{t("display.showOnEachItem")}</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{TOGGLES.map((toggle) => (
						<DropdownMenuCheckboxItem
							checked={settings[toggle.key]}
							closeOnClick={false}
							key={toggle.key}
							onCheckedChange={(checked) =>
								setDisplaySetting(toggle.key, Boolean(checked), storeOptions)
							}
						>
							{t(toggle.labelKey)}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
