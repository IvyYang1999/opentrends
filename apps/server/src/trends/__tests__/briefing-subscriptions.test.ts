import { describe, expect, test } from "bun:test";

import {
	briefingMessageId,
	createEmailProviderRequest,
	deliveryAttemptDecision,
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

	test("builds the Forward Email request without provider guessing", () => {
		const credential = "credential-fixture";
		const request = createEmailProviderRequest({
			apiUrl: "https://api.forwardemail.net/v1/emails",
			credential,
			from: "briefing@opentrends.io",
			message: {
				html: "<p>Hello</p>",
				messageId: "<briefing.2026-09-24.abc@opentrends.io>",
				subject: "Daily briefing",
				text: "Hello",
				to: "reader@example.com",
				unsubscribeUrl: "https://api.example/unsubscribe/abc",
			},
			provider: "forward-email",
		});

		expect(request.url).toBe("https://api.forwardemail.net/v1/emails");
		expect(request.init.headers).toEqual({
			Authorization: `Basic ${btoa(`${credential}:`)}`,
			"Content-Type": "application/json",
		});
		expect(JSON.parse(String(request.init.body))).toMatchObject({
			from: "briefing@opentrends.io",
			headers: {
				"List-Unsubscribe": "<https://api.example/unsubscribe/abc>",
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
			},
			messageId: "<briefing.2026-09-24.abc@opentrends.io>",
			to: "reader@example.com",
		});
	});

	test("uses a stable per-subscription daily Message-ID", () => {
		expect(
			briefingMessageId({
				day: "2026-09-24",
				from: "briefing@opentrends.io",
				subscriptionId: "0123456789abcdef",
			})
		).toBe("<briefing.2026-09-24.0123456789abcdef@opentrends.io>");
	});

	test("bounds retries and leaves an active delivery alone", () => {
		const now = Date.parse("2026-09-24T08:00:00Z");
		expect(deliveryAttemptDecision(undefined, now)).toBe("send");
		expect(
			deliveryAttemptDecision(
				{ attempts: 1, state: "sending", updatedAt: now - 60_000 },
				now
			)
		).toBe("wait");
		expect(
			deliveryAttemptDecision(
				{ attempts: 1, state: "failed", updatedAt: now - 31 * 60_000 },
				now
			)
		).toBe("send");
		expect(
			deliveryAttemptDecision(
				{ attempts: 3, state: "failed", updatedAt: now - 31 * 60_000 },
				now
			)
		).toBe("stop");
		expect(
			deliveryAttemptDecision(
				{ attempts: 1, state: "sent", updatedAt: now },
				now
			)
		).toBe("already-sent");
	});
});
