import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { isLocale } from "@/lib/i18n";

export const Route = createFileRoute("/{-$locale}/")({
	loader: ({ params }) => {
		if (params.locale && !isLocale(params.locale)) {
			throw notFound();
		}
		throw redirect({
			to: "/{-$locale}/trends/$topic",
			params: { ...params, topic: "ai" },
		});
	},
});
