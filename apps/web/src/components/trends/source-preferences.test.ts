import { describe, expect, test } from "bun:test";

import {
	moveSource,
	orderWithPinned,
	togglePinnedSource,
} from "./source-preferences-model";

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

describe("pinned sources", () => {
	test("pinned sources come first and keep their relative drag order", () => {
		expect(orderWithPinned(["a", "b", "c", "d"], ["d", "b"])).toEqual([
			"b",
			"d",
			"a",
			"c",
		]);
	});

	test("toggling adds and removes a pin", () => {
		expect(togglePinnedSource([], "c")).toEqual(["c"]);
		expect(togglePinnedSource(["c", "a"], "c")).toEqual(["a"]);
	});
});
