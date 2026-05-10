import { useSyncExternalStore } from "react";

export type DisplayLayout = "sourceGrid" | "sourceSections";

export interface DisplaySettings {
	layout: DisplayLayout;
	showCover: boolean;
	showDescription: boolean;
	showHotValue: boolean;
	showRank: boolean;
	showRelativeTime: boolean;
}

export interface DisplaySettingsStoreOptions {
	defaults?: DisplaySettings;
	storageKey?: string;
}

export const DISPLAY_SETTINGS_DEFAULTS: DisplaySettings = {
	layout: "sourceGrid",
	showCover: true,
	showDescription: false,
	showHotValue: true,
	showRank: true,
	showRelativeTime: true,
};

export const SOURCE_SECTIONS_DISPLAY_SETTINGS: DisplaySettings = {
	layout: "sourceSections",
	showCover: true,
	showDescription: true,
	showHotValue: true,
	showRank: true,
	showRelativeTime: true,
};

const DISPLAY_SETTINGS_BY_LAYOUT: Record<DisplayLayout, DisplaySettings> = {
	sourceGrid: DISPLAY_SETTINGS_DEFAULTS,
	sourceSections: SOURCE_SECTIONS_DISPLAY_SETTINGS,
};

const STORAGE_KEY = "opentrends:trends:display-settings";
const CHANGE_EVENT = "opentrends:trends:display-settings-change";
const snapshotCache = new Map<
	string,
	{ raw: string | null; snapshot: DisplaySettings }
>();

function isDisplayLayout(value: unknown): value is DisplayLayout {
	return value === "sourceGrid" || value === "sourceSections";
}

function getStoreDefaults(
	options?: DisplaySettingsStoreOptions
): DisplaySettings {
	return options?.defaults ?? DISPLAY_SETTINGS_DEFAULTS;
}

function getStoreKey(options?: DisplaySettingsStoreOptions): string {
	return options?.storageKey ?? STORAGE_KEY;
}

function normalizeSettings(
	value: Partial<DisplaySettings>,
	defaults = DISPLAY_SETTINGS_DEFAULTS
): DisplaySettings {
	return {
		...defaults,
		...value,
		layout: isDisplayLayout(value.layout) ? value.layout : defaults.layout,
	};
}

function readFromStorage(
	options?: DisplaySettingsStoreOptions
): DisplaySettings {
	if (typeof window === "undefined") {
		return getStoreDefaults(options);
	}
	const defaults = getStoreDefaults(options);
	const storageKey = getStoreKey(options);
	try {
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) {
			return defaults;
		}
		const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
		return normalizeSettings(parsed, defaults);
	} catch {
		return defaults;
	}
}

// Cache the resolved snapshot so useSyncExternalStore sees a stable
// reference between renders when nothing changed.
function getSnapshot(options?: DisplaySettingsStoreOptions): DisplaySettings {
	const defaults = getStoreDefaults(options);
	if (typeof window === "undefined") {
		return defaults;
	}
	const storageKey = getStoreKey(options);
	const raw = window.localStorage.getItem(storageKey);
	const cached = snapshotCache.get(storageKey);
	if (cached && raw === cached.raw) {
		return cached.snapshot;
	}
	const snapshot = readFromStorage(options);
	snapshotCache.set(storageKey, { raw, snapshot });
	return snapshot;
}

function getServerSnapshot(
	options?: DisplaySettingsStoreOptions
): DisplaySettings {
	return getStoreDefaults(options);
}

function subscribe(callback: () => void): () => void {
	const handler = () => callback();
	window.addEventListener(CHANGE_EVENT, handler);
	window.addEventListener("storage", handler);
	return () => {
		window.removeEventListener(CHANGE_EVENT, handler);
		window.removeEventListener("storage", handler);
	};
}

export function useDisplaySettings(
	options?: DisplaySettingsStoreOptions
): DisplaySettings {
	return useSyncExternalStore(
		subscribe,
		() => getSnapshot(options),
		() => getServerSnapshot(options)
	);
}

function hasStoredSettingsSnapshot(
	options?: DisplaySettingsStoreOptions
): boolean {
	return (
		typeof window !== "undefined" &&
		window.localStorage.getItem(getStoreKey(options)) !== null
	);
}

function hasStoredSettingsServerSnapshot(): boolean {
	return false;
}

export function useHasStoredDisplaySettings(
	options?: DisplaySettingsStoreOptions
): boolean {
	return useSyncExternalStore(
		subscribe,
		() => hasStoredSettingsSnapshot(options),
		hasStoredSettingsServerSnapshot
	);
}

export function setDisplaySetting<K extends keyof DisplaySettings>(
	key: K,
	value: DisplaySettings[K],
	options?: DisplaySettingsStoreOptions
): void {
	if (typeof window === "undefined") {
		return;
	}
	const storageKey = getStoreKey(options);
	const next: DisplaySettings = { ...readFromStorage(options), [key]: value };
	window.localStorage.setItem(storageKey, JSON.stringify(next));
	// Notify other components in this tab — `storage` events only fire
	// across tabs, so we dispatch our own event for same-tab updates.
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setDisplayLayout(
	layout: DisplayLayout,
	options?: DisplaySettingsStoreOptions
): void {
	if (typeof window === "undefined") {
		return;
	}
	const storageKey = getStoreKey(options);
	window.localStorage.setItem(
		storageKey,
		JSON.stringify(DISPLAY_SETTINGS_BY_LAYOUT[layout])
	);
	window.dispatchEvent(new Event(CHANGE_EVENT));
}
