import { describe, expect, test } from "bun:test";

import { shouldReturnConfigStatus } from "../../routes/sources-mode";

describe("sources route status mode", () => {
	test("only returns config-only status for the explicit config mode", () => {
		expect(shouldReturnConfigStatus("config")).toBe(true);
		expect(shouldReturnConfigStatus(undefined)).toBe(false);
		expect(shouldReturnConfigStatus("")).toBe(false);
	});
});
