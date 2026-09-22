import type { Locale } from "@/lib/i18n";

export type DefaultTopic = "all";

// Every locale lands on the cross-topic tab; its Chinese section covers
// readers who used to be sent straight to the Chinese topic.
export function defaultTopicForLocale(_locale: Locale): DefaultTopic {
	return "all";
}
