import { afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import { imageRoutes } from "../../routes/images";

interface TransformCall {
	fit?: string;
	height?: number;
	width?: number;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

function createApp(transformCalls: TransformCall[]) {
	const app = new Hono<{
		Bindings: { IMAGES: ImagesBinding };
	}>();
	app.route("/api/image", imageRoutes);
	const images = {
		input() {
			return {
				transform(options: TransformCall) {
					transformCalls.push(options);
					return {
						output() {
							return Promise.resolve({
								contentType: () => "image/webp",
								response: () =>
									new Response("thumbnail", {
										headers: { "Content-Type": "image/webp" },
									}),
							});
						},
					};
				},
			};
		},
	} as unknown as ImagesBinding;
	return { app, images };
}

describe("image thumbnail route", () => {
	test("transforms row covers to a bounded square WebP", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response("original", {
					headers: { "Content-Type": "image/jpeg" },
				})
			)
		) as unknown as typeof fetch;
		const calls: TransformCall[] = [];
		const { app, images } = createApp(calls);

		const response = await app.request(
			"/api/image?variant=row&url=https%3A%2F%2Fcdn.example.com%2Flarge.jpg",
			undefined,
			{ IMAGES: images }
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/webp");
		expect(response.headers.get("Cache-Control")).toContain("s-maxage=2592000");
		expect(calls).toEqual([{ fit: "cover", height: 96, width: 96 }]);
	});

	test("uses a retina 16:9 transform for card covers", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response("original", {
					headers: { "Content-Type": "image/png" },
				})
			)
		) as unknown as typeof fetch;
		const calls: TransformCall[] = [];
		const { app, images } = createApp(calls);

		const response = await app.request(
			"/api/image?variant=card&url=https%3A%2F%2Fcdn.example.com%2Flarge.png",
			undefined,
			{ IMAGES: images }
		);

		expect(response.status).toBe(200);
		expect(calls).toEqual([{ fit: "cover", height: 360, width: 640 }]);
	});

	test("fails closed instead of serving a large original", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response("not an image", {
					headers: { "Content-Type": "text/html" },
				})
			)
		) as unknown as typeof fetch;
		const calls: TransformCall[] = [];
		const { app, images } = createApp(calls);

		const response = await app.request(
			"/api/image?variant=row&url=https%3A%2F%2Fexample.com%2Fpage",
			undefined,
			{ IMAGES: images }
		);

		expect(response.status).toBe(204);
		expect(calls).toHaveLength(0);
	});

	test("rejects unbounded transform variants", async () => {
		const calls: TransformCall[] = [];
		const { app, images } = createApp(calls);

		const response = await app.request(
			"/api/image?variant=huge&url=https%3A%2F%2Fcdn.example.com%2Flarge.jpg",
			undefined,
			{ IMAGES: images }
		);

		expect(response.status).toBe(204);
		expect(calls).toHaveLength(0);
	});
});
