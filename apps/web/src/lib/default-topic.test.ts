import { describe, expect, test } from "bun:test";

import { defaultTopicForLocale } from "./default-topic";

describe("defaultTopicForLocale", () => {
	test("lands every locale on the cross-topic tab", () => {
		expect(defaultTopicForLocale("zh")).toBe("all");
		expect(defaultTopicForLocale("en")).toBe("all");
	});
});
