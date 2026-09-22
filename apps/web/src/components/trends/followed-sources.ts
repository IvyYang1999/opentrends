import { createContext, useCallback, useContext } from "react";

import { useSourcePreferences } from "./source-preferences";

// Followed sources are stored as the "mine" preference: the ordered list is
// the follow list. It lives in localStorage and syncs when signed in, like
// every other preference, so following never asks for an account.
export const FOLLOWED_TOPIC_ID = "mine";

export function useFollowedSources() {
	const preferences = useSourcePreferences(FOLLOWED_TOPIC_ID, null);
	const followedIds = preferences.preference.orderedSourceIds;
	const setOrder = preferences.setOrder;
	const isFollowed = useCallback(
		(sourceId: string) => followedIds.includes(sourceId),
		[followedIds]
	);
	const toggleFollowed = useCallback(
		(sourceId: string) => {
			setOrder(
				followedIds.includes(sourceId)
					? followedIds.filter((id) => id !== sourceId)
					: [...followedIds, sourceId]
			);
		},
		[followedIds, setOrder]
	);
	return { followedIds, isFollowed, preferences, toggleFollowed };
}

export interface FollowedSourcesContextValue {
	isFollowed: (sourceId: string) => boolean;
	toggleFollowed: (sourceId: string) => void;
}

// Provided once per page so every card header shares one follow list.
export const FollowedSourcesContext =
	createContext<FollowedSourcesContextValue | null>(null);

export function useFollowedSourcesContext(): FollowedSourcesContextValue {
	const value = useContext(FollowedSourcesContext);
	return (
		value ?? {
			isFollowed: () => false,
			toggleFollowed: () => undefined,
		}
	);
}
