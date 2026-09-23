import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { defaultTopicForLocale } from "@/lib/default-topic";
import { isLocale, resolveLocale } from "@/lib/i18n";

export const Route = createFileRoute("/{-$locale}/_views/trends/")({
	loader: ({ params }) => {
		if (params.locale && !isLocale(params.locale)) {
			throw notFound();
		}
		throw redirect({
			to: "/{-$locale}/trends/$topic",
			params: {
				...params,
				topic: defaultTopicForLocale(resolveLocale(params.locale)),
			},
		});
	},
});
