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

// Pinned sources form a block at the top of the order; within the block and
// below it, the reader's drag order is kept.
export function orderWithPinned(
	orderedSourceIds: readonly string[],
	pinnedSourceIds: readonly string[]
): string[] {
	const pinned = new Set(pinnedSourceIds);
	return [
		...orderedSourceIds.filter((sourceId) => pinned.has(sourceId)),
		...orderedSourceIds.filter((sourceId) => !pinned.has(sourceId)),
	];
}

export function togglePinnedSource(
	pinnedSourceIds: readonly string[],
	sourceId: string
): string[] {
	return pinnedSourceIds.includes(sourceId)
		? pinnedSourceIds.filter((candidate) => candidate !== sourceId)
		: [...pinnedSourceIds, sourceId];
}
