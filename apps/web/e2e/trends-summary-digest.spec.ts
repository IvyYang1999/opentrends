import { expect, test } from "@playwright/test";

const isPlaywrightRuntime =
	typeof process.env.PW_TEST_SOURCE_TRANSFORM === "string";

const NOW = Date.now();
const SHARE_FILE_NAME_RE = /^opentrends-ai-\d{4}-\d{2}-\d{2}\.png$/;
const FAKE_TRENDS_PAGE = {
	id: "ai" as const,
	title: "AI",
	description: "AI news, papers and products",
	updatedAt: NOW,
	sections: [
		{
			id: "default",
			title: "AI Trends",
			sources: [
				{
					sourceId: "openai-news",
					title: "OpenAI News",
					homeUrl: "https://openai.example.com",
					status: "ok" as const,
					updatedAt: NOW,
					items: [
						{
							id: "1",
							sourceId: "openai-news",
							title: "GPT-5 launches",
							url: "https://openai.example.com/gpt-5",
							rank: 1,
							fetchedAt: NOW,
						},
					],
				},
			],
		},
	],
};
const FAKE_DIGEST = [
	"1. **GPT-5 launches** — OpenAI ships extended reasoning to everyone [1]",
	"2. **Claude gets a new tier** — Long-context work becomes cheaper [1]",
].join("\n");

function corsHeaders(route: import("@playwright/test").Route) {
	return {
		"Access-Control-Allow-Origin":
			route.request().headers().origin ?? "http://localhost:3001",
		"Access-Control-Allow-Credentials": "true",
	};
}

if (isPlaywrightRuntime) {
	test.describe("trends summary digest", () => {
		test("requests the chosen period and turns the digest into a share image", async ({
			page,
		}) => {
			const summaryUrls: string[] = [];
			await page.route("**/api/trends/ai**", async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					headers: corsHeaders(route),
					body: JSON.stringify(FAKE_TRENDS_PAGE),
				});
			});
			await page.route("**/api/trends/*/summary**", async (route) => {
				summaryUrls.push(route.request().url());
				await route.fulfill({
					status: 200,
					contentType: "text/plain; charset=utf-8",
					headers: corsHeaders(route),
					body: `${JSON.stringify({
						citations: [{ n: 1, url: "https://openai.example.com/gpt-5" }],
					})}\n${FAKE_DIGEST}`,
				});
			});

			await page.goto("/trends/ai");
			const entries = page
				.getByTestId("trends-summary-body")
				.locator("ol > li");
			await expect(entries).toHaveCount(2, { timeout: 10_000 });
			expect(summaryUrls.at(-1)).toContain("citations=body");
			expect(summaryUrls.at(-1)).not.toContain("window=");
			// Citations arrive as the first line of the body, never as visible text.
			const summaryBody = page.getByTestId("trends-summary-body");
			await expect(summaryBody).not.toContainText("citations");
			await expect(
				summaryBody.locator('[data-streamdown="link"]:has(sup)')
			).toHaveCount(2);

			await page.getByRole("button", { name: "This week" }).click();
			await expect
				.poll(() => summaryUrls.at(-1) ?? "")
				.toContain("window=week");
			await expect(
				page.getByRole("button", { name: "This week" })
			).toHaveAttribute("aria-pressed", "true");
			await expect(entries).toHaveCount(2);

			await page.getByRole("button", { name: "Share" }).click();
			await expect(page.getByTestId("share-image-preview")).toBeVisible({
				timeout: 10_000,
			});
			await expect(
				page.getByRole("link", { name: "Download image" })
			).toHaveAttribute("download", SHARE_FILE_NAME_RE);
		});
	});
}
