import { useParams } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";
import type { Locale } from "@/paraglide/runtime";
import {
	baseLocale,
	getLocale as getParaglideLocale,
	isLocale as isParaglideLocale,
	locales,
	setLocale,
	toLocale,
} from "@/paraglide/runtime";

export type { Locale } from "@/paraglide/runtime";

export const ALL_LOCALES = locales;
export const DEFAULT_LOCALE = baseLocale;

export const LOCALES = locales;

export const LOCALE_LABELS: Record<Locale, string> = {
	en: "English",
	zh: "中文",
	"zh-Hant": "繁體中文",
	ru: "Русский",
	"fr-FR": "Français (France)",
	"es-ES": "Español (España)",
	"de-DE": "Deutsch (Deutschland)",
	"pt-BR": "Português (Brasil)",
};

export const HTML_LANG: Record<Locale, string> = {
	en: "en",
	zh: "zh-CN",
	"zh-Hant": "zh-Hant",
	ru: "ru",
	"fr-FR": "fr-FR",
	"es-ES": "es-ES",
	"de-DE": "de-DE",
	"pt-BR": "pt-BR",
};

export const OG_LOCALE: Record<Locale, string> = {
	en: "en_US",
	zh: "zh_CN",
	"zh-Hant": "zh_TW",
	ru: "ru_RU",
	"fr-FR": "fr_FR",
	"es-ES": "es_ES",
	"de-DE": "de_DE",
	"pt-BR": "pt_BR",
};

const MESSAGE_IDS = {
	"nav.home": "nav_home",
	"nav.trends": "nav_trends",
	"nav.sources": "nav_sources",
	"nav.skills": "nav_skills",
	"nav.dashboard": "nav_dashboard",
	"nav.homeAria": "nav_home_aria",
	"topic.ai": "topic_ai",
	"topic.embodied": "topic_embodied",
	"topic.hardware": "topic_hardware",
	"topic.biotech": "topic_biotech",
	"topic.programming": "topic_programming",
	"topic.tech": "topic_tech",
	"topic.indie": "topic_indie",
	"topic.cn": "topic_cn",
	"theme.label": "theme_label",
	"theme.light": "theme_light",
	"theme.dark": "theme_dark",
	"theme.system": "theme_system",
	"language.label": "language_label",
	"userMenu.signIn": "user_menu_sign_in",
	"userMenu.signOut": "user_menu_sign_out",
	"userMenu.myAccount": "user_menu_my_account",
	"summary.synthesizedFrom": "summary_synthesized_from",
	"summary.sources": "summary_sources",
	"summary.items": "summary_items",
	"summary.thinking": "summary_thinking",
	"summary.writing": "summary_writing",
	"summary.reading": "summary_reading",
	"summary.error": "summary_error",
	"card.viewAll": "card_view_all",
	"card.noContent": "card_no_content",
	"card.unavailable": "card_unavailable",
	"card.openHome": "card_open_home",
	"card.actionsFor": "card_actions_for",
	"card.statusLive": "card_status_live",
	"card.statusStale": "card_status_stale",
	"card.statusFailed": "card_status_failed",
	"card.translated": "card_translated",
	"card.translatedTooltip": "card_translated_tooltip",
	"card.updated": "card_updated",
	"card.itemCount": "card_item_count",
	"display.label": "display_label",
	"display.settings": "display_settings",
	"display.layout": "display_layout",
	"display.layoutSourceGrid": "display_layout_source_grid",
	"display.layoutSourceSections": "display_layout_source_sections",
	"display.showOnEachItem": "display_show_on_each_item",
	"display.cover": "display_cover",
	"display.description": "display_description",
	"display.rank": "display_rank",
	"display.hotValue": "display_hot_value",
	"display.publishedTime": "display_published_time",
	"relTime.justNow": "rel_time_just_now",
	"relTime.mAgo": "rel_time_m_ago",
	"relTime.hAgo": "rel_time_h_ago",
	"relTime.dAgo": "rel_time_d_ago",
	"sources.heading": "sources_heading",
	"sources.totalsTotal": "sources_totals_total",
	"sources.totalsOk": "sources_totals_ok",
	"sources.totalsStale": "sources_totals_stale",
	"sources.totalsError": "sources_totals_error",
	"sources.totalsMissing": "sources_totals_missing",
	"sources.colSource": "sources_col_source",
	"sources.colProvider": "sources_col_provider",
	"sources.colRefresh": "sources_col_refresh",
	"sources.colItems": "sources_col_items",
	"sources.colStatus": "sources_col_status",
	"sources.colLastFetch": "sources_col_last_fetch",
	"sources.colTopics": "sources_col_topics",
	"sources.openLabel": "sources_open_label",
	"sources.updated": "sources_updated",
	"sign.welcomeBack": "sign_welcome_back",
	"sign.createAccount": "sign_create_account",
	"sign.email": "sign_email",
	"sign.password": "sign_password",
	"sign.name": "sign_name",
	"sign.submitting": "sign_submitting",
	"sign.signIn": "sign_sign_in",
	"sign.signUp": "sign_sign_up",
	"sign.needAccount": "sign_need_account",
	"sign.haveAccount": "sign_have_account",
	"sign.successSignIn": "sign_success_sign_in",
	"sign.successSignUp": "sign_success_sign_up",
	"sign.invalidEmail": "sign_invalid_email",
	"sign.passwordTooShort": "sign_password_too_short",
	"sign.nameTooShort": "sign_name_too_short",
	"dashboard.title": "dashboard_title",
	"dashboard.welcome": "dashboard_welcome",
	"dashboard.api": "dashboard_api",
	"home.apiStatus": "home_api_status",
	"home.connected": "home_connected",
	"home.disconnected": "home_disconnected",
	"home.checking": "home_checking",
	"common.notFound": "common_not_found",
} as const;

export type TranslationKey = keyof typeof MESSAGE_IDS;

type MessageValues = Record<string, string | number>;
type MessageFunction = (
	values?: MessageValues,
	options?: { locale?: Locale }
) => string;

const MESSAGES = m as unknown as Record<string, MessageFunction>;

export function isLocale(value: string | undefined): value is Locale {
	return isParaglideLocale(value);
}

export function resolveLocale(value: string | undefined): Locale {
	return toLocale(value) ?? getParaglideLocale();
}

export function translate(
	locale: Locale,
	key: TranslationKey,
	values?: MessageValues
): string {
	const messageId = MESSAGE_IDS[key];
	const message = MESSAGES[messageId];
	if (!message) {
		return key;
	}
	return String(message(values, { locale }));
}

export function useLocale(): Locale {
	const params = useParams({ strict: false }) as { locale?: string };
	return resolveLocale(params.locale);
}

export type Translator = (
	key: TranslationKey,
	values?: MessageValues
) => string;

export function useT(): Translator {
	const locale = useLocale();
	return (key, values) => translate(locale, key, values);
}

export function localePathParam(locale: Locale): Locale | undefined {
	return locale === DEFAULT_LOCALE ? undefined : locale;
}

export function setUserLocale(
	locale: Locale,
	options?: { reload?: boolean }
): void | Promise<void> {
	return setLocale(locale, options);
}
