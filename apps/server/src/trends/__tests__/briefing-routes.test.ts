import { describe, expect, test } from "bun:test";

import { resolveSubscriptionRecipient } from "../../routes/briefings";

describe("briefing subscription recipient", () => {
	test("requires a verified signed-in account", () => {
		expect(resolveSubscriptionRecipient(undefined, undefined)).toEqual({
			error: "authentication_required",
		});
		expect(
			resolveSubscriptionRecipient(
				{
					email: "reader@example.com",
					emailVerified: false,
					id: "user-1",
				},
				undefined
			)
		).toEqual({ error: "verified_email_required" });
	});

	test("locks delivery to the account email", () => {
		const user = {
			email: "Reader@Example.com",
			emailVerified: true,
			id: "user-1",
		};
		expect(resolveSubscriptionRecipient(user, undefined)).toEqual({
			email: "Reader@Example.com",
			userId: "user-1",
		});
		expect(resolveSubscriptionRecipient(user, "reader@example.com")).toEqual({
			email: "Reader@Example.com",
			userId: "user-1",
		});
		expect(resolveSubscriptionRecipient(user, "other@example.com")).toEqual({
			error: "email_mismatch",
		});
	});
});
