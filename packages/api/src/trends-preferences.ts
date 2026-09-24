import { z } from "zod";

const topicIdSchema = z.string().trim().min(1).max(64);
const sourceIdSchema = z.string().trim().min(1).max(256);

export const trendsSourcePreferenceInputSchema = z.object({
	topicId: topicIdSchema,
	orderedSourceIds: z.array(sourceIdSchema).max(200),
	hiddenSourceIds: z.array(sourceIdSchema).max(200),
	// Optional so preferences saved before pinning existed still parse.
	pinnedSourceIds: z.array(sourceIdSchema).max(200).default([]),
});

export const trendsSourcePreferenceTopicSchema = z.object({
	topicId: topicIdSchema,
});

export type TrendsSourcePreference = z.infer<
	typeof trendsSourcePreferenceInputSchema
>;

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

export function normalizeTrendsSourcePreferences(
	saved: TrendsSourcePreference | undefined,
	availableSourceIds: readonly string[]
): TrendsSourcePreference {
	const available = unique(availableSourceIds);
	const availableSet = new Set(available);
	const savedOrder = unique(saved?.orderedSourceIds ?? []).filter((sourceId) =>
		availableSet.has(sourceId)
	);
	const savedOrderSet = new Set(savedOrder);
	const orderedSourceIds = [
		...savedOrder,
		...available.filter((sourceId) => !savedOrderSet.has(sourceId)),
	];
	const hiddenSourceIds = unique(saved?.hiddenSourceIds ?? []).filter(
		(sourceId) => availableSet.has(sourceId)
	);
	// Pinned sources are kept in the order of `orderedSourceIds`, so pinning
	// never loses the relative order the reader dragged into place.
	const pinnedSet = new Set(saved?.pinnedSourceIds ?? []);
	const pinnedSourceIds = orderedSourceIds.filter((sourceId) =>
		pinnedSet.has(sourceId)
	);

	return {
		topicId: saved?.topicId ?? "",
		orderedSourceIds,
		hiddenSourceIds,
		pinnedSourceIds,
	};
}
