import type { SourceId } from "../types";

interface RefreshableSource {
	expiresAt?: number;
	items: readonly unknown[];
	sourceId: SourceId;
}

export function prioritizeExpiredSourceIds(
	sources: readonly RefreshableSource[],
	now = Date.now()
): SourceId[] {
	const candidates = new Map<
		SourceId,
		{ empty: boolean; expiresAt: number; index: number }
	>();
	for (const [index, source] of sources.entries()) {
		if (source.expiresAt === undefined || source.expiresAt > now) {
			continue;
		}
		if (!candidates.has(source.sourceId)) {
			candidates.set(source.sourceId, {
				empty: source.items.length === 0,
				expiresAt: source.expiresAt,
				index,
			});
		}
	}
	return [...candidates]
		.sort(([, a], [, b]) => {
			if (a.empty !== b.empty) {
				return a.empty ? -1 : 1;
			}
			return a.expiresAt - b.expiresAt || a.index - b.index;
		})
		.map(([sourceId]) => sourceId);
}
