import { describe, expect, test } from "bun:test";

import { sourceCardViewportClasses } from "./source-card-model";

describe("sourceCardViewportClasses", () => {
	test("does not reserve a 480px offscreen box for an empty source", () => {
		const classes = sourceCardViewportClasses(false);
		expect(classes).toContain("h-auto");
		expect(classes).not.toContain("contain-intrinsic-size");
	});

	test("keeps content visibility optimization for populated sources", () => {
		const classes = sourceCardViewportClasses(true);
		expect(classes).toContain("content-visibility:auto");
		expect(classes).toContain("h-[480px]");
	});
});
