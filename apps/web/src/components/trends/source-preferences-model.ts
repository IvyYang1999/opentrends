export function moveSource(
	orderedSourceIds: readonly string[],
	activeSourceId: string,
	overSourceId: string
): string[] {
	const from = orderedSourceIds.indexOf(activeSourceId);
	const to = orderedSourceIds.indexOf(overSourceId);
	if (from < 0 || to < 0 || from === to) {
		return [...orderedSourceIds];
	}
	const next = [...orderedSourceIds];
	const [moved] = next.splice(from, 1);
	if (moved) {
		next.splice(to, 0, moved);
	}
	return next;
}
