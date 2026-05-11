/* biome-ignore lint/style/useFilenamingConvention: TanStack file-route naming escapes the leading dot for /.well-known. */
import { createFileRoute } from "@tanstack/react-router";

const API_CATALOG_URL = "https://opentrends.io/.well-known/api-catalog";
const API_BASE_URL = "https://api.opentrends.io/";
const API_SPEC_URL = "https://api.opentrends.io/api-reference/spec.json";
const API_DOCS_URL = "https://api.opentrends.io/api-reference";
const API_STATUS_URL = "https://api.opentrends.io/";
const API_CATALOG_CONTENT_TYPE =
	'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';
const API_CATALOG_LINK_HEADER = `<${API_CATALOG_URL}>; rel="api-catalog"; type="application/linkset+json"`;

const apiCatalog = {
	linkset: [
		{
			anchor: API_BASE_URL,
			"service-desc": [
				{
					href: API_SPEC_URL,
					type: "application/json",
				},
			],
			"service-doc": [
				{
					href: API_DOCS_URL,
					type: "text/html",
				},
			],
			status: [
				{
					href: API_STATUS_URL,
					type: "text/plain",
				},
			],
		},
	],
} as const;

function apiCatalogHeaders(): Headers {
	return new Headers({
		"cache-control": "public, max-age=3600",
		"content-type": API_CATALOG_CONTENT_TYPE,
		link: API_CATALOG_LINK_HEADER,
	});
}

export const Route = createFileRoute("/.well-known/api-catalog")({
	server: {
		handlers: {
			GET: () =>
				new Response(JSON.stringify(apiCatalog, null, 2), {
					headers: apiCatalogHeaders(),
					status: 200,
				}),
			HEAD: () =>
				new Response(null, {
					headers: apiCatalogHeaders(),
					status: 200,
				}),
		},
	},
});
