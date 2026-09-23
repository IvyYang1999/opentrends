import { describe, expect, test } from "bun:test";

import {
	isValidEmail,
	newSubscriptionId,
	renderBriefingEmail,
} from "../services/briefing-subscriptions";

const ID_RE = /^[0-9a-f]{32}$/;

describe("briefing subscriptions", () => {
	test("validates addresses and mints opaque ids", () => {
		expect(isValidEmail("someone@example.com")).toBe(true);
		expect(isValidEmail("nope")).toBe(false);
		expect(newSubscriptionId()).toMatch(ID_RE);
	});

	test("renders the digest as a mail with links and an unsubscribe line", () => {
		const mail = renderBriefingEmail({
			day: "2026-09-23",
			entries: [
				{
					citations: [{ n: 1, url: "https://a.example/<x>" }],
					n: 1,
					reason: "because",
					takeaway: "GPT-6 & friends",
				},
			],
			name: "AI",
			unsubscribeUrl: "https://api.example/u/1",
		});
		expect(mail.subject).toBe("AI · 2026-09-23");
		expect(mail.html).toContain("GPT-6 &amp; friends");
		expect(mail.html).toContain('href="https://a.example/&lt;x&gt;"');
		expect(mail.text).toContain("Unsubscribe: https://api.example/u/1");
	});
});
