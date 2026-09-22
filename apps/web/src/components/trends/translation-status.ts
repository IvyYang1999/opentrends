import type { Locale } from "@/lib/i18n";

import type { NewsItem, TrendsPageData } from "./types";

const CJK_RE = /[\u3400-\u9fff]/;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;

export function textNeedsTranslation(
	value: string | undefined,
	locale: Locale
): boolean {
	if (!value?.trim()) {
		return false;
	}
	if (locale === "zh") {
		return !CJK_RE.test(value);
	}
	return CJK_RE.test(value) || CYRILLIC_RE.test(value);
}

function itemNeedsTranslation(item: NewsItem, locale: Locale): boolean {
	if (item.original) {
		return false;
	}
	return (
		textNeedsTranslation(item.title, locale) ||
		textNeedsTranslation(item.description, locale)
	);
}

export function pageNeedsTranslationWarmup(
	page: TrendsPageData,
	locale: Locale
): boolean {
	if (locale !== "zh" && locale !== "en") {
		return false;
	}
	return page.sections.some((section) =>
		section.sources.some((source) =>
			source.items.some((item) => itemNeedsTranslation(item, locale))
		)
	);
}
