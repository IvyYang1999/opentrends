import { db } from "@opentrends/db";
import { userTrendsPreference } from "@opentrends/db/schema/preferences";

import { protectedProcedure } from "../index";
import {
	normalizeTrendsSourcePreferences,
	trendsSourcePreferenceInputSchema,
	trendsSourcePreferenceTopicSchema,
} from "../trends-preferences";

function parseStoredIds(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return [];
	}
}

export const trendsPreferencesRouter = {
	get: protectedProcedure
		.input(trendsSourcePreferenceTopicSchema)
		.handler(async ({ context, input }) => {
			const row = await db.query.userTrendsPreference.findFirst({
				where: (preference, { and, eq }) =>
					and(
						eq(preference.userId, context.session.user.id),
						eq(preference.topicId, input.topicId)
					),
			});

			if (!row) {
				return null;
			}

			const stored = trendsSourcePreferenceInputSchema.safeParse({
				topicId: row.topicId,
				orderedSourceIds: parseStoredIds(row.orderedSourceIds),
				hiddenSourceIds: parseStoredIds(row.hiddenSourceIds),
			});
			return stored.success ? stored.data : null;
		}),
	set: protectedProcedure
		.input(trendsSourcePreferenceInputSchema)
		.handler(async ({ context, input }) => {
			const normalized = normalizeTrendsSourcePreferences(
				input,
				input.orderedSourceIds
			);
			const values = {
				userId: context.session.user.id,
				topicId: normalized.topicId,
				orderedSourceIds: JSON.stringify(normalized.orderedSourceIds),
				hiddenSourceIds: JSON.stringify(normalized.hiddenSourceIds),
			};
			await db
				.insert(userTrendsPreference)
				.values(values)
				.onConflictDoUpdate({
					target: [userTrendsPreference.userId, userTrendsPreference.topicId],
					set: {
						orderedSourceIds: values.orderedSourceIds,
						hiddenSourceIds: values.hiddenSourceIds,
						updatedAt: new Date(),
					},
				});
			return normalized;
		}),
};
