import { expect, test } from "bun:test";
import { readTrendsSnapshot } from "./ssr-snapshot";

const page = { id: "ai", title: "AI", updatedAt: 1, sections: [] };

test("SSR reads the complete localized snapshot without credentials or generation", async () => {
	let calls = 0;
	const result = await readTrendsSnapshot(
		(request) => {
			calls += 1;
			const url = new URL(request.url);
			expect(url.pathname).toBe("/api/trends/ai");
			expect(url.searchParams.get("lang")).toBe("zh");
			expect(url.searchParams.get("translations")).toBe("background");
			// The first response already carries the complete source queue. This
			// prevents every card from painting eight rows and jumping later when
			// a second per-source request arrives.
			expect(url.searchParams.get("items")).toBe("30");
			// Bun 1.3 reports Request.credentials as include even when constructed with omit.
			expect(request.headers.has("authorization")).toBe(false);
			expect(request.headers.has("cookie")).toBe(false);
			return Promise.resolve(Response.json(page));
		},
		"https://api.example.test",
		"ai",
		"zh"
	);
	expect(result).toEqual(page);
	expect(calls).toBe(1);
});

test("failed or wrong-topic responses preserve the browser fallback without retry", async () => {
	for (const response of [
		new Response(null, { status: 503 }),
		Response.json({ ...page, id: "hardware" }),
	]) {
		let calls = 0;
		expect(
			await readTrendsSnapshot(
				() => {
					calls += 1;
					return Promise.resolve(response);
				},
				"https://api.example.test",
				"ai",
				"en"
			)
		).toBeNull();
		expect(calls).toBe(1);
	}
});

test("deadline bounds headers and body even when the transport ignores abort", async () => {
	let signal: AbortSignal | undefined;
	const started = Date.now();
	expect(
		await readTrendsSnapshot(
			(request) => {
				signal = request.signal;
				return new Promise<Response>(() => undefined);
			},
			"https://api.example.test",
			"ai",
			"en",
			20
		)
	).toBeNull();
	expect(signal?.aborted).toBe(true);
	expect(Date.now() - started).toBeLessThan(500);
	const response = new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("{"));
			},
		})
	);
	expect(
		await readTrendsSnapshot(
			() => Promise.resolve(response),
			"https://api.example.test",
			"ai",
			"en",
			20
		)
	).toBeNull();
});
