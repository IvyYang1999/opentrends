import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/__void/prerender-paths")({
	server: {
		handlers: {
			POST: () => Response.json({ paths: [] }),
		},
	},
});
