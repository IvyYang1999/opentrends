import { env } from "@opentrends/env/web";

import type { SourcesStatusResponse } from "./sources-types";

const SOURCES_FETCH_TIMEOUT_MS = 20_000;

export async function loadSourcesStatus(): Promise<SourcesStatusResponse> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		SOURCES_FETCH_TIMEOUT_MS
	);
	let response: Response;
	try {
		response = await fetch(`${env.VITE_SERVER_URL}/api/sources`, {
			cache: "default",
			credentials: "omit",
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
	if (!response.ok) {
		throw new Error(`Failed to load sources status (${response.status})`);
	}
	return (await response.json()) as SourcesStatusResponse;
}
