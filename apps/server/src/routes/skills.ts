import { Hono } from "hono";

const OPENTRENDS_SKILL_MANIFEST = {
	name: "opentrends",
	version: "2026.09.23.1",
	updatedAt: "2026-09-23T00:00:00Z",
	baseUrl: "https://api.opentrends.io",
	installUrl: "https://opentrends.io/agents",
	skillUrl: "https://opentrends.io/skills/opentrends/SKILL.md",
	llmsTxtUrl: "https://opentrends.io/llms.txt",
	topics: [
		"featured",
		"ai",
		"programming",
		"hardware",
		"biotech",
		"embodied",
		"cn",
	],
	endpoints: {
		topic: "/api/trends/:topic",
		source: "/api/trends/:topic/sources/:sourceId",
		summary: "/api/trends/:topic/summary",
		events: "/api/trends/:topic/events",
		sources: "/api/sources",
	},
	query: {
		lang: ["zh", "en", "zh-Hant", "ru", "fr-FR", "es-ES", "de-DE", "pt-BR"],
		items: "preview | 1..defaultMax",
		translations: ["background"],
		summary: {
			format: ["json", "markdown"],
			window: ["today", "week", "month"],
			pending: "HTTP 202 while generating; retry after Retry-After seconds",
		},
	},
} as const;

const SKILL_MANIFEST_CACHE_CONTROL =
	"public, max-age=600, s-maxage=1800, stale-while-revalidate=3600";

export const skillsRoutes = new Hono().get("/opentrends", (c) => {
	const response = c.json(OPENTRENDS_SKILL_MANIFEST);
	response.headers.set("Cache-Control", SKILL_MANIFEST_CACHE_CONTROL);
	return response;
});
