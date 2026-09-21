export function buildSocialCallbackUrl(
	origin: string,
	localeParam: string | undefined
): string {
	const path = localeParam ? `/${localeParam}/trends/ai` : "/trends/ai";
	return new URL(path, origin).toString();
}
