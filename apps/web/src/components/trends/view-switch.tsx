import { cn } from "@opentrends/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import {
	segmentActiveClassName,
	segmentClassName,
} from "@/components/chrome-styles";
import { type Locale, useT } from "@/lib/i18n";

import { FOLLOWED_TOPIC_ID } from "./followed-sources";

interface ViewSwitchProps {
	localeParam: Locale | undefined;
	/** Topic to keep when switching; omitted on the all-topics events feed. */
	topicId?: string;
	view: "feed" | "trends" | "events";
}

// Trends (source cards) or Events (clustered stories) for the open topic.
export function ViewSwitch({ localeParam, topicId, view }: ViewSwitchProps) {
	const t = useT();
	return (
		<nav aria-label={t("nav.trends")} className="flex items-center gap-0.5">
			<Link
				className={cn(
					segmentClassName,
					view === "feed" && segmentActiveClassName
				)}
				params={{ locale: localeParam }}
				search={topicId ? { topic: topicId } : {}}
				to="/{-$locale}/feed"
			>
				{t("nav.feed")}
			</Link>
			<Link
				className={cn(
					segmentClassName,
					view === "trends" && segmentActiveClassName
				)}
				params={{ locale: localeParam, topic: topicId ?? "ai" }}
				to="/{-$locale}/trends/$topic"
			>
				{t("nav.trends")}
			</Link>
			{topicId === FOLLOWED_TOPIC_ID ? null : (
				<Link
					className={cn(
						segmentClassName,
						view === "events" && segmentActiveClassName
					)}
					params={{ locale: localeParam }}
					search={topicId ? { topic: topicId } : {}}
					to="/{-$locale}/events"
				>
					{t("nav.events")}
				</Link>
			)}
		</nav>
	);
}
