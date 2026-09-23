const POPULATED_SOURCE_CARD_CLASSES =
	"h-[480px] max-sm:h-auto max-sm:max-h-none [content-visibility:auto] [contain-intrinsic-size:auto_480px]";

export function sourceCardViewportClasses(hasItems: boolean): string {
	return hasItems ? POPULATED_SOURCE_CARD_CLASSES : "h-auto";
}

const DECORATIVE_BADGE_IMAGE_PATTERNS = [
	"simg.s.weibo.com/moter/flags/",
	"/top-static-files-outer/breaknews/",
	"/udata/pkg/nebula-app/rank_tag_",
];

// Site logos and rank badges are not covers.
const LOGO_IMAGE_RE =
	/\/(?:logo|brand|icon|favicon)[^/]*\.(?:png|jpe?g|svg|gif|webp)(?:\?|$)/i;
// GitHub org avatars are the only picture a trending repo has; they work as
// a small mark inside a poster, not as a full-width cover.
const GITHUB_AVATAR_RE = /^https:\/\/github\.com\/[^/]+\.png/;

export type CoverKind = "cover" | "thumb" | "none";

export function coverKind(imageUrl: string | undefined): CoverKind {
	if (!imageUrl || isDecorativeBadgeImage(imageUrl)) {
		return "none";
	}
	if (LOGO_IMAGE_RE.test(imageUrl)) {
		return "none";
	}
	if (GITHUB_AVATAR_RE.test(imageUrl)) {
		return "thumb";
	}
	return "cover";
}

export function isDecorativeBadgeImage(imageUrl: string | undefined): boolean {
	return imageUrl
		? DECORATIVE_BADGE_IMAGE_PATTERNS.some((pattern) =>
				imageUrl.includes(pattern)
			)
		: false;
}
