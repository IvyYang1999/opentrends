import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useLocation,
	useParams,
	useSearch,
} from "@tanstack/react-router";
import { useRef } from "react";

import {
	setDisplaySetting,
	useDisplaySettings,
} from "@/components/trends/display-settings";
import {
	FOLLOWED_TOPIC_ID,
	useFollowedSources,
} from "@/components/trends/followed-sources";
import { trendsPageQueryOptions } from "@/components/trends/trends-query";
import { TrendsSummary } from "@/components/trends/trends-summary";
import { ViewsScrollContext } from "@/components/trends/views-scroll";
import { useLocale } from "@/lib/i18n";

// The four ways of looking at a topic (feed, sources, events, calendar)
// share this frame: one scroll container and one digest bar that stays
// mounted while the view below it changes, so switching views or topics
// never redraws the bar.
export const Route = createFileRoute("/{-$locale}/_views")({
	component: ViewsLayout,
});

function TopicDigest({ topicId }: { topicId: string }) {
	const locale = useLocale();
	const settings = useDisplaySettings();
	const { followedIds } = useFollowedSources();
	const followed = topicId === FOLLOWED_TOPIC_ID;
	const page = useQuery({
		...trendsPageQueryOptions(
			topicId,
			locale,
			followed ? followedIds : undefined
		),
		enabled: !followed || followedIds.length > 0,
	});
	if (!page.data) {
		return (
			<div className="h-10 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)]" />
		);
	}
	return (
		<TrendsSummary
			collapsed={settings.summaryCollapsed}
			onCollapsedChange={(collapsed) =>
				setDisplaySetting("summaryCollapsed", collapsed)
			}
			page={page.data}
			topicId={topicId}
		/>
	);
}

function ViewsLayout() {
	const params = useParams({ strict: false }) as { topic?: string };
	const search = useSearch({ strict: false }) as { topic?: string };
	const location = useLocation();
	const scrollRef = useRef<HTMLDivElement>(null);
	// The events view without a topic is the all-topics feed; it has no
	// digest of its own.
	const onEvents = location.pathname.includes("/events");
	const topic =
		params.topic ?? search.topic ?? (onEvents ? undefined : "featured");
	return (
		<ViewsScrollContext.Provider value={scrollRef}>
			<div
				className="min-w-0 flex-1 overflow-auto bg-[var(--surface-app)] text-[var(--text-primary)]"
				ref={scrollRef}
			>
				{topic ? (
					<TopicDigest topicId={topic} />
				) : (
					<div className="h-10 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)]" />
				)}
				<Outlet />
			</div>
		</ViewsScrollContext.Provider>
	);
}
