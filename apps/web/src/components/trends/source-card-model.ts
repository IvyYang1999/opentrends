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

export function isDecorativeBadgeImage(imageUrl: string | undefined): boolean {
	return imageUrl
		? DECORATIVE_BADGE_IMAGE_PATTERNS.some((pattern) =>
				imageUrl.includes(pattern)
			)
		: false;
}
