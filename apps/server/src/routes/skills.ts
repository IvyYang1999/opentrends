import { Hono } from "hono";

const OPENTRENDS_SKILL_MANIFEST = {
	name: "opentrends",
	version: "2026.05.12.1",
	updatedAt: "2026-05-12T04:20:00Z",
	baseUrl: "https://api.opentrends.io",
	installUrl: "https://opentrends.io/skills/opentrends",
	skillUrl: "https://opentrends.io/skills/opentrends/SKILL.md",
	topics: ["ai", "programming", "hardware", "biotech", "embodied", "cn"],
	endpoints: {
		topic: "/api/trends/:topic",
		source: "/api/trends/:topic/sources/:sourceId",
		summary: "/api/trends/:topic/summary",
		sources: "/api/sources",
	},
	query: {
		lang: ["zh", "en", "zh-Hant", "ru"],
		items: "preview | 1..defaultMax",
		translations: ["background", "sync"],
	},
} as const;

const SKILL_MANIFEST_CACHE_CONTROL =
	"public, max-age=600, s-maxage=1800, stale-while-revalidate=3600";

export const skillsRoutes = new Hono().get("/opentrends", (c) => {
	const response = c.json(OPENTRENDS_SKILL_MANIFEST);
	response.headers.set("Cache-Control", SKILL_MANIFEST_CACHE_CONTROL);
	return response;
});
