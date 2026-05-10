import { DEFAULT_LOCALE, LOCALES, type Locale, OG_LOCALE } from "./i18n";

type MetaDescriptor =
	| { charSet: string }
	| { name: string; content: string }
	| { property: string; content: string }
	| { httpEquiv: string; content: string }
	| { title: string };

interface LinkDescriptor {
	href: string;
	hrefLang?: string;
	rel: string;
	sizes?: string;
	type?: string;
}

const TRAILING_SLASHES_RE = /\/+$/;
const ABSOLUTE_HTTP_RE = /^https?:\/\//i;

export const SITE_NAME = "OpenTrends";

export const DEFAULT_TITLE = `${SITE_NAME} — Read hundreds of global sources with built-in translation`;

export const DEFAULT_DESCRIPTION =
	"OpenTrends lets you browse hundreds of AI, tech, hardware, maker and Chinese-language media sources in one place, with built-in translation for global trends.";

export const DEFAULT_IMAGE = "/og-image.png";
export const DEFAULT_IMAGE_ALT =
	"OpenTrends preview highlighting built-in translation and hundreds of media sources";
export const DEFAULT_IMAGE_HEIGHT = "630";
export const DEFAULT_IMAGE_TYPE = "image/png";
export const DEFAULT_IMAGE_WIDTH = "1200";

export const DEFAULT_KEYWORDS = [
	"trending news",
	"AI news",
	"tech news",
	"hacker news",
	"indie hackers",
	"robotics",
	"biotechnology news",
	"RSS aggregator",
	"OpenTrends",
];

const RAW_SITE_URL = (
	(import.meta as unknown as { env?: Record<string, string | undefined> }).env
		?.VITE_SITE_URL ?? ""
).trim();

export const SITE_URL = RAW_SITE_URL.replace(TRAILING_SLASHES_RE, "");

export interface SeoInput {
	description?: string;
	/** Absolute or site-relative og:image URL. */
	image?: string;
	imageAlt?: string;
	/** Extra keywords appended to the defaults. */
	keywords?: string[];
	/** Active locale. Drives og:locale and hreflang alternates. */
	locale?: Locale;
	/** Block crawlers for private routes (dashboard, login). */
	noindex?: boolean;
	/** Route path beginning with `/`, **without** the locale prefix. Used for canonical, og:url and hreflang alternates. */
	path?: string;
	title?: string;
	/** Override og:type. Defaults to "website". */
	type?: "website" | "article" | "profile";
}

export interface SeoHead {
	links: LinkDescriptor[];
	meta: MetaDescriptor[];
}

function absoluteUrl(path?: string): string | undefined {
	if (!SITE_URL) {
		return;
	}
	if (!path) {
		return SITE_URL;
	}
	if (ABSOLUTE_HTTP_RE.test(path)) {
		return path;
	}
	return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function localizedPath(
	path: string | undefined,
	locale: Locale
): string | undefined {
	if (path === undefined) {
		return;
	}
	if (ABSOLUTE_HTTP_RE.test(path)) {
		return path;
	}
	const normalized = path.startsWith("/") ? path : `/${path}`;
	if (locale === DEFAULT_LOCALE) {
		return normalized;
	}
	if (normalized === "/") {
		return `/${locale}`;
	}
	return `/${locale}${normalized}`;
}

function addImageMeta({
	image,
	imageAlt,
	isDefaultImage,
	meta,
}: {
	image?: string;
	imageAlt: string;
	isDefaultImage: boolean;
	meta: MetaDescriptor[];
}): void {
	if (!image) {
		return;
	}
	meta.push({ property: "og:image", content: image });
	meta.push({ property: "og:image:alt", content: imageAlt });
	meta.push({ name: "twitter:image", content: image });
	meta.push({ name: "twitter:image:alt", content: imageAlt });
	if (!isDefaultImage) {
		return;
	}
	meta.push({ property: "og:image:type", content: DEFAULT_IMAGE_TYPE });
	meta.push({ property: "og:image:width", content: DEFAULT_IMAGE_WIDTH });
	meta.push({ property: "og:image:height", content: DEFAULT_IMAGE_HEIGHT });
}

function addUrlMeta(meta: MetaDescriptor[], url?: string): void {
	if (!url) {
		return;
	}
	meta.push({ property: "og:url", content: url });
	meta.push({ name: "twitter:url", content: url });
}

function buildSeoLinks(input: SeoInput, url?: string): LinkDescriptor[] {
	const links: LinkDescriptor[] = [];
	if (url) {
		links.push({ rel: "canonical", href: url });
	}
	if (input.path === undefined || input.noindex || !SITE_URL) {
		return links;
	}
	for (const alt of LOCALES) {
		const altUrl = absoluteUrl(localizedPath(input.path, alt));
		if (altUrl) {
			links.push({ rel: "alternate", hrefLang: alt, href: altUrl });
		}
	}
	const xDefault = absoluteUrl(localizedPath(input.path, DEFAULT_LOCALE));
	if (xDefault) {
		links.push({ rel: "alternate", hrefLang: "x-default", href: xDefault });
	}
	return links;
}

export function buildSeo(input: SeoInput = {}): SeoHead {
	const title = input.title ? `${input.title} · ${SITE_NAME}` : DEFAULT_TITLE;
	const description = input.description ?? DEFAULT_DESCRIPTION;
	const locale = input.locale ?? DEFAULT_LOCALE;
	const url = absoluteUrl(localizedPath(input.path, locale));
	const imagePath = input.image ?? DEFAULT_IMAGE;
	const image = absoluteUrl(imagePath);
	const imageAlt = input.imageAlt ?? DEFAULT_IMAGE_ALT;
	const type = input.type ?? "website";
	const keywords = [...DEFAULT_KEYWORDS, ...(input.keywords ?? [])];

	const meta: MetaDescriptor[] = [
		{ title },
		{ name: "description", content: description },
		{ name: "keywords", content: keywords.join(", ") },
		{
			name: "robots",
			content: input.noindex ? "noindex, nofollow" : "index, follow",
		},
		{ property: "og:site_name", content: SITE_NAME },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:type", content: type },
		{ property: "og:locale", content: OG_LOCALE[locale] },
		{
			name: "twitter:card",
			content: image ? "summary_large_image" : "summary",
		},
		{ name: "twitter:title", content: title },
		{ name: "twitter:description", content: description },
	];

	addUrlMeta(meta, url);
	addImageMeta({
		image,
		imageAlt,
		isDefaultImage: imagePath === DEFAULT_IMAGE,
		meta,
	});

	return { meta, links: buildSeoLinks(input, url) };
}
