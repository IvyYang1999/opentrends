import { isLocale } from "@/lib/i18n";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/{-$locale}/trends/")({
	loader: ({ params }) => {
        if (params.locale && !isLocale(params.locale)) throw notFound();
		throw redirect({
			to: "/{-$locale}/trends/$topic",
			params: { ...params, topic: "ai" },
		});
	},
});
