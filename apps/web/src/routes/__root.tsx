import { Toaster } from "@opentrends/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense } from "react";

import { getGithubRepositoryStats } from "@/functions/get-github-repository-stats";
import { HTML_LANG, useLocale } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";
import type { orpc } from "@/utils/orpc";

import Header from "../components/header";

import appCss from "../index.css?url";
export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

const AHREFS_ANALYTICS_KEY = "aqTYEDbRyZ9C1uHShFzNnw";
const AHREFS_ANALYTICS_SRC = "https://analytics.ahrefs.com/analytics.js";
const RouterDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-router-devtools").then((module) => ({
				default: module.TanStackRouterDevtools,
			}))
		)
	: null;
const QueryDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-query-devtools").then((module) => ({
				default: module.ReactQueryDevtools,
			}))
		)
	: null;

export const Route = createRootRouteWithContext<RouterAppContext>()({
	loader: () => getGithubRepositoryStats(),
	head: () => {
		const seo = buildSeo();
		return {
			meta: [
				{ charSet: "utf-8" },
				{
					name: "viewport",
					content: "width=device-width, initial-scale=1",
				},
				{ name: "theme-color", content: "#155DFF" },
				{ name: "format-detection", content: "telephone=no" },
				{ name: "application-name", content: "OpenTrends" },
				{ name: "apple-mobile-web-app-title", content: "OpenTrends" },
				...seo.meta,
			],
			links: [
				{ rel: "icon", href: "/logo-mark.svg", type: "image/svg+xml" },
				{ rel: "stylesheet", href: appCss },
				...seo.links,
			],
		};
	},

	component: RootDocument,
});

function RootDocument() {
	const locale = useLocale();
	const githubStats = Route.useLoaderData();
	return (
		<html lang={HTML_LANG[locale]} suppressHydrationWarning>
			<head>
				<HeadContent />
				<script
					async
					data-key={AHREFS_ANALYTICS_KEY}
					src={AHREFS_ANALYTICS_SRC}
				/>
			</head>
			<body
				className="bg-[var(--surface-app)] text-foreground"
				suppressHydrationWarning
			>
				<ThemeProvider
					attribute={["class", "data-theme"]}
					defaultTheme="system"
					disableTransitionOnChange
					enableSystem
				>
					<div className="grid h-svh grid-rows-[auto_1fr]">
						<Header initialGithubStats={githubStats} />
						<Outlet />
					</div>
					<Toaster richColors />
				</ThemeProvider>
				{RouterDevtools && QueryDevtools ? (
					<Suspense fallback={null}>
						<RouterDevtools position="bottom-left" />
						<QueryDevtools buttonPosition="bottom-right" position="bottom" />
					</Suspense>
				) : null}
				<Scripts />
			</body>
		</html>
	);
}
