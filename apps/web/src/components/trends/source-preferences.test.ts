import { describe, expect, test } from "bun:test";

import { moveSource } from "./source-preferences-model";

describe("moveSource", () => {
	test("moves a source without dropping its neighbors", () => {
		expect(moveSource(["a", "b", "c", "d"], "a", "c")).toEqual([
			"b",
			"c",
			"a",
			"d",
		]);
	});

	test("returns the same order for unknown sources", () => {
		expect(moveSource(["a", "b"], "missing", "b")).toEqual(["a", "b"]);
	});
});
