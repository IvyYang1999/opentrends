import { describe, expect, test } from "bun:test";

import { defaultTopicForLocale } from "./default-topic";

describe("defaultTopicForLocale", () => {
	test("starts Chinese readers on the Chinese trends page", () => {
		expect(defaultTopicForLocale("zh")).toBe("cn");
		expect(defaultTopicForLocale("zh-Hant")).toBe("cn");
	});

	test("keeps AI as the default for other locales", () => {
		expect(defaultTopicForLocale("en")).toBe("ai");
		expect(defaultTopicForLocale("de-DE")).toBe("ai");
	});
});
