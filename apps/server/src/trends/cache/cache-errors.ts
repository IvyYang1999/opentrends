export function isMissingCacheSchemaError(error: unknown): boolean {
	const code = findErrorCode(error);
	return code === "42P01" || code === "42703";
}

function findErrorCode(error: unknown, depth = 0): unknown {
	if (depth > 4 || !(error && typeof error === "object")) {
		return;
	}
	const code = "code" in error ? (error as { code?: unknown }).code : undefined;
	if (typeof code === "string") {
		return code;
	}
	const cause =
		"cause" in error ? (error as { cause?: unknown }).cause : undefined;
	return findErrorCode(cause, depth + 1);
}
