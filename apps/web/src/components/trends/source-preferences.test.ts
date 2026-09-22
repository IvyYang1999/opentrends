import { describe, expect, test } from "bun:test";

import { moveSource, pinSource } from "./source-preferences-model";

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

describe("pinSource", () => {
	test("moves the selected source to the first position", () => {
		expect(pinSource(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]);
	});

	test("preserves the order for an already-first or unknown source", () => {
		expect(pinSource(["a", "b"], "a")).toEqual(["a", "b"]);
		expect(pinSource(["a", "b"], "missing")).toEqual(["a", "b"]);
	});
});
