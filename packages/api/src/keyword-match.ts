const FLEXIBLE_SEPARATOR_RE = /[\s\p{Dash_Punctuation}_]+/gu;

// Readers commonly type compact product names ("GPT6") while publishers use
// punctuation variants ("GPT-6" or "GPT 6"). Fold only separators, keeping
// meaningful symbols such as the plus signs in "C++" intact.
export function normalizeKeywordForMatch(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(FLEXIBLE_SEPARATOR_RE, "");
}

export function fieldsMatchAnyKeyword(
	fields: readonly (string | undefined)[],
	keywords: readonly string[]
): boolean {
	if (keywords.length === 0) {
		return true;
	}
	const needles = keywords
		.map(normalizeKeywordForMatch)
		.filter((keyword) => keyword.length > 0);
	if (needles.length === 0) {
		return false;
	}
	return fields.some((field) => {
		const haystack = normalizeKeywordForMatch(field ?? "");
		return needles.some((needle) => haystack.includes(needle));
	});
}
