import { db, schema } from "@opentrends/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";

import type { SourceId } from "../types";

const { source } = schema;

let lockOwner: string | undefined;

function getLockOwner(): string {
	lockOwner ??= `server:${crypto.randomUUID()}`;
	return lockOwner;
}

export async function acquireRefreshLock(
	sourceId: SourceId,
	lockDurationMs: number
): Promise<boolean> {
	const now = new Date();
	const lockedUntil = new Date(now.getTime() + lockDurationMs);

	const inserted = await db
		.insert(source)
		.values({
			sourceId,
			refreshOwner: getLockOwner(),
			refreshLockedUntil: lockedUntil,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.returning({ sourceId: source.sourceId });

	if (inserted.length > 0) {
		return true;
	}

	const taken = await db
		.update(source)
		.set({
			refreshOwner: getLockOwner(),
			refreshLockedUntil: lockedUntil,
			updatedAt: now,
		})
		.where(
			and(
				eq(source.sourceId, sourceId),
				or(
					isNull(source.refreshLockedUntil),
					lt(source.refreshLockedUntil, now)
				)
			)
		)
		.returning({ sourceId: source.sourceId });

	return taken.length > 0;
}

export async function releaseRefreshLock(sourceId: SourceId): Promise<void> {
	await db
		.update(source)
		.set({
			refreshOwner: null,
			refreshLockedUntil: null,
			updatedAt: new Date(),
		})
		.where(eq(source.sourceId, sourceId));
}
