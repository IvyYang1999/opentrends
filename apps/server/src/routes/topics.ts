import { Hono } from "hono";

import { FEATURED_TOPIC_ID, topicPresets } from "../trends/config/topics";

// The topics and the sources each one carries, for clients that build
// something from a topic without loading its whole page: a briefing that
// follows "all of AI", a picker, an agent.
const TOPICS_CACHE_CONTROL =
	"public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

export const topicsRoutes = new Hono().get("/", (c) => {
	const topics = Object.entries(topicPresets)
		.filter(([id]) => id !== FEATURED_TOPIC_ID)
		.map(([id, preset]) => ({
			description: preset.description,
			id,
			sourceIds: [
				...new Set(preset.sections.flatMap((section) => section.sourceIds)),
			],
			title: preset.title,
		}));
	return c.json({ topics }, 200, { "Cache-Control": TOPICS_CACHE_CONTROL });
});
