import { describe, expect, test } from "bun:test";

import { type AppDatabase, getDb, runWithDbClient } from "./index";

describe("D1 request context", () => {
	test("keeps concurrent database bindings isolated", async () => {
		const first = { name: "first" } as unknown as AppDatabase;
		const second = { name: "second" } as unknown as AppDatabase;
		let releaseFirst: (() => void) | undefined;
		const firstPaused = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const firstRequest = runWithDbClient(first, async () => {
			expect(getDb()).toBe(first);
			await firstPaused;
			expect(getDb()).toBe(first);
		});
		const secondRequest = runWithDbClient(second, () => {
			expect(getDb()).toBe(second);
			releaseFirst?.();
			expect(getDb()).toBe(second);
		});

		await Promise.all([firstRequest, secondRequest]);
	});

	test("fails closed outside a Worker request", () => {
		expect(() => getDb()).toThrow("D1 database binding is unavailable");
	});
});
