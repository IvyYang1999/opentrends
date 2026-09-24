import { describe, expect, test } from "bun:test";

import { defaultTopicForLocale } from "./default-topic";

describe("defaultTopicForLocale", () => {
	test("lands every locale on the featured tab", () => {
		expect(defaultTopicForLocale("zh")).toBe("featured");
		expect(defaultTopicForLocale("en")).toBe("featured");
	});
});
