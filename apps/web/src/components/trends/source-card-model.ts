const POPULATED_SOURCE_CARD_CLASSES =
	"h-[480px] max-sm:h-auto max-sm:max-h-none [content-visibility:auto] [contain-intrinsic-size:auto_480px]";

export function sourceCardViewportClasses(hasItems: boolean): string {
	return hasItems ? POPULATED_SOURCE_CARD_CLASSES : "h-auto";
}
