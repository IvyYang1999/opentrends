#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOPIC_IDS = [
	"ai",
	"embodied",
	"hardware",
	"biotech",
	"programming",
	"cn",
] as const;

const STATIC_PATHS = ["/trends", "/sources", "/skills/opentrends"] as const;

const ALL_LOCALES = [
	"en",
	"zh",
	"zh-Hant",
	"ru",
	"fr-FR",
	"es-ES",
	"de-DE",
	"pt-BR",
] as const;
type Locale = (typeof ALL_LOCALES)[number];

const DEFAULT_LOCALE: Locale = "en";
const LOCALE_SET = new Set<string>(ALL_LOCALES);
const LOCALE_SPLIT_REGEX = /[\s,]+/;

function parseSupportedLocales(raw: string | undefined): readonly Locale[] {
	if (!raw?.trim()) {
		return ALL_LOCALES;
	}

	const configured = raw
		.split(LOCALE_SPLIT_REGEX)
		.filter((value): value is Locale => LOCALE_SET.has(value));
	const locales = new Set<Locale>([DEFAULT_LOCALE, ...configured]);

	return locales.size > 1 ? [...locales] : ALL_LOCALES;
}

const LOCALES = parseSupportedLocales(process.env.VITE_SUPPORTED_LOCALES);

function localizedPath(path: string, locale: Locale): string {
	if (locale === DEFAULT_LOCALE) {
		return path;
	}
	if (path === "/") {
		return `/${locale}`;
	}
	return `/${locale}${path}`;
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../public/sitemap.xml");

const rawSiteUrl = (process.env.VITE_SITE_URL ?? "").trim().replace(/\/+$/, "");
if (!rawSiteUrl) {
	console.warn(
		"[generate-sitemap] VITE_SITE_URL is not set; skipping sitemap.xml generation."
	);
	process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);

const basePaths = [
	...STATIC_PATHS.map((path) => ({
		path,
		changefreq: "hourly",
		priority: 0.9,
	})),
	...TOPIC_IDS.map((id) => ({
		path: `/trends/${id}`,
		changefreq: "hourly",
		priority: 0.8,
	})),
];

const urls = basePaths.flatMap(({ path, changefreq, priority }) =>
	LOCALES.map((locale) => ({
		path: localizedPath(path, locale),
		changefreq,
		priority,
		alternates: LOCALES.map((alt) => ({
			hreflang: alt,
			href: `${rawSiteUrl}${localizedPath(path, alt)}`,
		})),
	}))
);

const body = urls
	.map(({ path, changefreq, priority, alternates }) => {
		const altTags = alternates
			.map(
				({ hreflang, href }) =>
					`    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}"/>`
			)
			.join("\n");
		return `  <url>\n    <loc>${rawSiteUrl}${path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n${altTags}\n  </url>`;
	})
	.join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, xml, "utf8");
console.log(`[generate-sitemap] wrote ${outPath}`);
