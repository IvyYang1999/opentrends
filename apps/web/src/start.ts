import { createMiddleware, createStart } from "@tanstack/react-start";

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n";

const LOCALE_COOKIE = "PARAGLIDE_LOCALE";
const LOCALE_MAX_AGE = 60 * 60 * 24 * 400;
const HTML_ACCEPT_RE = /\btext\/html\b/;

function parseCookieLocale(cookieHeader: string | null): Locale | undefined {
	if (!cookieHeader) {
		return;
	}
	for (const part of cookieHeader.split(";")) {
		const [name, rawValue] = part.trim().split("=");
		if (name !== LOCALE_COOKIE || !rawValue) {
			continue;
		}
		const value = decodeURIComponent(rawValue);
		if ((LOCALES as readonly string[]).includes(value)) {
			return value as Locale;
		}
	}
	return;
}

function parsePreferredLocale(acceptLanguage: string | null): Locale {
	if (!acceptLanguage) {
		return DEFAULT_LOCALE;
	}
	for (const part of acceptLanguage.split(",")) {
		const tag = part.trim().split(";")[0]?.toLowerCase();
		if (!tag) {
			continue;
		}
		if (tag === "zh-hant" || tag === "zh-tw" || tag === "zh-hk") {
			return "zh-Hant";
		}
		for (const locale of LOCALES) {
			const normalized = locale.toLowerCase();
			if (tag === normalized) {
				return locale;
			}
		}
		for (const locale of LOCALES) {
			const baseLanguage = locale.toLowerCase().split("-")[0];
			if (tag === baseLanguage || tag.startsWith(`${baseLanguage}-`)) {
				return locale;
			}
		}
	}
	return DEFAULT_LOCALE;
}

function pathLocale(pathname: string): Locale | undefined {
	const segment = pathname.split("/").filter(Boolean)[0];
	if ((LOCALES as readonly string[]).includes(segment ?? "")) {
		return segment as Locale;
	}
	return;
}

function localizedPath(pathname: string, locale: Locale): string {
	if (locale === DEFAULT_LOCALE) {
		return pathname;
	}
	if (pathname === "/") {
		return `/${locale}`;
	}
	return `/${locale}${pathname}`;
}

const localeRedirectMiddleware = createMiddleware().server(
	({ next, request }) => {
		if (
			request.method !== "GET" ||
			!HTML_ACCEPT_RE.test(request.headers.get("accept") ?? "")
		) {
			return next();
		}

		const url = new URL(request.url);
		if (pathLocale(url.pathname)) {
			return next();
		}

		const locale =
			parseCookieLocale(request.headers.get("cookie")) ??
			parsePreferredLocale(request.headers.get("accept-language"));
		if (locale === DEFAULT_LOCALE) {
			return next();
		}

		url.pathname = localizedPath(url.pathname, locale);
		return new Response(null, {
			headers: {
				location: `${url.pathname}${url.search}${url.hash}`,
				"set-cookie": `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_MAX_AGE}; SameSite=Lax`,
				vary: "Accept-Language, Cookie",
			},
			status: 307,
		});
	}
);

export const startInstance = createStart(() => ({
	requestMiddleware: [localeRedirectMiddleware],
}));
