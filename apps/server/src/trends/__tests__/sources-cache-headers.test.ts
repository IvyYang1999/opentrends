import { describe, expect, it } from "bun:test";

import { withSourcesCacheHeaders } from "../../routes/sources";

describe("sources response cache headers", () => {
	it("clones a response whose headers are immutable", () => {
		const immutableResponse = Response.redirect("https://example.com");
		const response = withSourcesCacheHeaders(immutableResponse, "edge");

		expect(response.headers.get("X-Sources-Cache")).toBe("edge");
		expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
			"X-Sources-Cache"
		);
		expect(response.status).toBe(302);
	});

	it("does not duplicate the exposed header on a cache hit", () => {
		const first = withSourcesCacheHeaders(
			new Response(null, {
				headers: { "Access-Control-Expose-Headers": "X-Request-Id" },
			}),
			"miss"
		);
		const second = withSourcesCacheHeaders(first, "edge");

		expect(second.headers.get("Access-Control-Expose-Headers")).toBe(
			"X-Request-Id, X-Sources-Cache"
		);
	});
});
