import { Hono } from "hono";

const IMAGE_PROXY_CACHE_CONTROL =
	"public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
const IMAGE_PROXY_TIMEOUT_MS = 8000;
const PRIVATE_172_RE = /^172\.(\d{1,2})\./;

function isPrivateHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	if (
		normalized === "localhost" ||
		normalized.endsWith(".localhost") ||
		normalized === "::1" ||
		normalized === "[::1]"
	) {
		return true;
	}
	if (
		normalized.startsWith("127.") ||
		normalized.startsWith("10.") ||
		normalized.startsWith("169.254.") ||
		normalized.startsWith("192.168.")
	) {
		return true;
	}
	const match = normalized.match(PRIVATE_172_RE);
	return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function parseImageUrl(value: string | undefined): URL | null {
	if (!value) {
		return null;
	}
	try {
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol)) {
			return null;
		}
		if (isPrivateHostname(url.hostname)) {
			return null;
		}
		return url;
	} catch {
		return null;
	}
}

function emptyImageResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			"Cache-Control": "public, max-age=300",
		},
	});
}

export const imageRoutes = new Hono().get("/", async (c) => {
	const url = parseImageUrl(c.req.query("url"));
	if (!url) {
		return emptyImageResponse();
	}

	try {
		const upstream = await fetch(url, {
			headers: {
				Accept:
					"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
				"User-Agent":
					"Mozilla/5.0 (compatible; OpenTrends image proxy; +https://opentrends.io)",
			},
			signal: AbortSignal.timeout(IMAGE_PROXY_TIMEOUT_MS),
		});
		const contentType = upstream.headers.get("Content-Type") ?? "";
		if (!(upstream.ok && contentType.toLowerCase().startsWith("image/"))) {
			return emptyImageResponse();
		}

		return new Response(upstream.body, {
			headers: {
				"Cache-Control": IMAGE_PROXY_CACHE_CONTROL,
				"Content-Type": contentType,
			},
		});
	} catch {
		return emptyImageResponse();
	}
});
