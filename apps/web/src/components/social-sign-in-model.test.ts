import { describe, expect, test } from "bun:test";

import { buildSocialCallbackUrl } from "./social-sign-in-model";

describe("buildSocialCallbackUrl", () => {
	test("returns to the web origin instead of the API origin", () => {
		expect(
			buildSocialCallbackUrl(
				"https://opentrends-web-preview.opentrends.workers.dev",
				"zh"
			)
		).toBe(
			"https://opentrends-web-preview.opentrends.workers.dev/zh/trends/ai"
		);
	});

	test("uses the unprefixed route for English", () => {
		expect(buildSocialCallbackUrl("https://opentrends.io", undefined)).toBe(
			"https://opentrends.io/trends/ai"
		);
	});
});
