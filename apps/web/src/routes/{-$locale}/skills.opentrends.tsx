import { createFileRoute, redirect } from "@tanstack/react-router";

// The skill page grew into "For Agents"; the old address stays valid because
// the skill manifest and installed skills point here.
export const Route = createFileRoute("/{-$locale}/skills/opentrends")({
	loader: ({ params }) => {
		throw redirect({
			to: "/{-$locale}/agents",
			params: { locale: params.locale },
		});
	},
});
