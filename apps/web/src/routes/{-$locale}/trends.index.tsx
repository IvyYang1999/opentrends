import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/{-$locale}/trends/")({
	loader: ({ params }) => {
		throw redirect({
			to: "/{-$locale}/trends/$topic",
			params: { ...params, topic: "ai" },
		});
	},
});
