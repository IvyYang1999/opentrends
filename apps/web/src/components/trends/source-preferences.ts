import {
	normalizeTrendsSourcePreferences,
	type TrendsSourcePreference,
	trendsSourcePreferenceInputSchema,
} from "@opentrends/api/trends-preferences";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { togglePinnedSource } from "@/components/trends/source-preferences-model";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

const STORAGE_PREFIX = "opentrends:trends:source-preferences:v1:";
const SYNC_DEBOUNCE_MS = 400;

function storageKey(topicId: string): string {
	return `${STORAGE_PREFIX}${topicId}`;
}

// `availableSourceIds` of null keeps whatever the preference lists: the
// followed-sources list is not bounded by a topic.
function withTopic(
	preference: TrendsSourcePreference | undefined,
	topicId: string,
	availableSourceIds: readonly string[] | null
): TrendsSourcePreference {
	return {
		...normalizeTrendsSourcePreferences(
			preference,
			availableSourceIds ?? preference?.orderedSourceIds ?? []
		),
		topicId,
	};
}

export function readLocalPreference(
	topicId: string
): TrendsSourcePreference | undefined {
	if (typeof window === "undefined") {
		return;
	}
	try {
		const parsed: unknown = JSON.parse(
			window.localStorage.getItem(storageKey(topicId)) ?? "null"
		);
		const result = trendsSourcePreferenceInputSchema.safeParse(parsed);
		return result.success && result.data.topicId === topicId
			? result.data
			: undefined;
	} catch {
		return;
	}
}

function writeLocalPreference(preference: TrendsSourcePreference): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(
		storageKey(preference.topicId),
		JSON.stringify(preference)
	);
}

function serialize(preference: TrendsSourcePreference): string {
	return JSON.stringify(preference);
}

export function useSourcePreferences(
	topicId: string,
	availableSourceIds: readonly string[] | null
) {
	const availableKey = JSON.stringify(availableSourceIds);
	const stableAvailableSourceIds = useMemo(
		() => JSON.parse(availableKey) as string[] | null,
		[availableKey]
	);
	const session = authClient.useSession();
	const userId = session.data?.user.id;
	const [preference, setPreference] = useState(() =>
		withTopic(undefined, topicId, stableAvailableSourceIds)
	);
	const resolvedServerKeyRef = useRef<string | undefined>(undefined);
	const lastSyncedRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		const local = readLocalPreference(topicId);
		const next = withTopic(local, topicId, stableAvailableSourceIds);
		setPreference(next);
		resolvedServerKeyRef.current = undefined;
		lastSyncedRef.current = undefined;
	}, [stableAvailableSourceIds, topicId]);

	const serverQuery = useQuery(
		orpc.trendsPreferences.get.queryOptions({
			input: { topicId },
			enabled: Boolean(userId),
			queryKey: ["trends-preferences", userId, topicId],
			retry: false,
			staleTime: 30_000,
		})
	);
	const mutation = useMutation(
		orpc.trendsPreferences.set.mutationOptions({
			onSuccess: (saved) => {
				lastSyncedRef.current = serialize(saved);
			},
		})
	);
	const serverKey = userId ? `${userId}:${topicId}` : undefined;
	const mutatePreference = mutation.mutate;

	useEffect(() => {
		if (!(serverKey && serverQuery.isSuccess)) {
			return;
		}
		if (resolvedServerKeyRef.current === serverKey) {
			return;
		}
		resolvedServerKeyRef.current = serverKey;
		lastSyncedRef.current = undefined;

		if (serverQuery.data) {
			const next = withTopic(
				serverQuery.data,
				topicId,
				stableAvailableSourceIds
			);
			lastSyncedRef.current = serialize(next);
			setPreference(next);
			writeLocalPreference(next);
		}
	}, [
		serverKey,
		serverQuery.data,
		serverQuery.isSuccess,
		stableAvailableSourceIds,
		topicId,
	]);

	useEffect(() => {
		if (!(serverKey && resolvedServerKeyRef.current === serverKey)) {
			return;
		}
		const serialized = serialize(preference);
		if (serialized === lastSyncedRef.current) {
			return;
		}
		const timeout = window.setTimeout(() => {
			lastSyncedRef.current = serialized;
			mutatePreference(preference, {
				onError: () => {
					if (lastSyncedRef.current === serialized) {
						lastSyncedRef.current = undefined;
					}
				},
			});
		}, SYNC_DEBOUNCE_MS);
		return () => window.clearTimeout(timeout);
	}, [mutatePreference, preference, serverKey]);

	const updatePreference = useCallback(
		(update: (current: TrendsSourcePreference) => TrendsSourcePreference) => {
			setPreference((current) => {
				const next = withTopic(
					update(current),
					topicId,
					stableAvailableSourceIds
				);
				writeLocalPreference(next);
				return next;
			});
		},
		[stableAvailableSourceIds, topicId]
	);

	return {
		preference,
		setOrder: (orderedSourceIds: string[]) =>
			updatePreference((current) => ({ ...current, orderedSourceIds })),
		setSourceVisible: (sourceId: string, visible: boolean) =>
			updatePreference((current) => ({
				...current,
				hiddenSourceIds: visible
					? current.hiddenSourceIds.filter((id) => id !== sourceId)
					: [...new Set([...current.hiddenSourceIds, sourceId])],
			})),
		togglePinned: (sourceId: string) =>
			updatePreference((current) => ({
				...current,
				pinnedSourceIds: togglePinnedSource(current.pinnedSourceIds, sourceId),
			})),
		showAllSources: () =>
			updatePreference((current) => ({
				...current,
				hiddenSourceIds: [],
			})),
		isSignedIn: Boolean(userId),
		isSyncing: mutation.isPending,
	};
}
