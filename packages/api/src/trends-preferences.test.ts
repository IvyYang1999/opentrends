import { describe, expect, test } from "bun:test";

import { normalizeTrendsSourcePreferences } from "./trends-preferences";

describe("normalizeTrendsSourcePreferences", () => {
	test("deduplicates saved IDs, drops stale IDs, and appends new sources", () => {
		expect(
			normalizeTrendsSourcePreferences(
				{
					topicId: "ai",
					orderedSourceIds: ["b", "b", "missing", "a"],
					hiddenSourceIds: ["a", "missing", "a"],
				},
				["a", "b", "c"]
			)
		).toEqual({
			topicId: "ai",
			orderedSourceIds: ["b", "a", "c"],
			hiddenSourceIds: ["a"],
			pinnedSourceIds: [],
		});
	});

	test("creates a stable default when no saved preference exists", () => {
		expect(
			normalizeTrendsSourcePreferences(undefined, ["a", "b", "a"])
		).toEqual({
			topicId: "",
			orderedSourceIds: ["a", "b"],
			hiddenSourceIds: [],
			pinnedSourceIds: [],
		});
	});
});
