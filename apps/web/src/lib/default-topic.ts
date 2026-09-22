import type { Locale } from "@/lib/i18n";

export type DefaultTopic = "ai" | "cn";

export function defaultTopicForLocale(locale: Locale): DefaultTopic {
	return locale === "zh" || locale === "zh-Hant" ? "cn" : "ai";
}
