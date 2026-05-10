import { expect, test } from "@playwright/test";

const SYNTHESIZED_FROM_RE = /Synthesized from/;

const isPlaywrightRuntime =
	typeof process.env.PW_TEST_SOURCE_TRANSFORM === "string";

const FAKE_TRENDS_PAGE = {
	id: "ai" as const,
	title: "AI",
	description: "AI news, papers and products",
	updatedAt: Date.now(),
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
					updatedAt: Date.now(),
					items: [
						{
							id: "1",
							sourceId: "openai-news",
							title: "GPT-5 launches",
							url: "https://openai.example.com/gpt-5",
							description:
								"OpenAI rolls out GPT-5 with extended reasoning and multimodal support.",
							rank: 1,
							fetchedAt: Date.now(),
						},
					],
				},
				{
					sourceId: "anthropic-news",
					title: "Anthropic News",
					homeUrl: "https://anthropic.example.com",
					status: "ok" as const,
					updatedAt: Date.now(),
					items: [
						{
							id: "2",
							sourceId: "anthropic-news",
							title: "Claude refresh",
							url: "https://anthropic.example.com/claude",
							description:
								"Anthropic ships a new Claude tier focused on long-context reasoning.",
							rank: 1,
							fetchedAt: Date.now(),
						},
						{
							id: "3",
							sourceId: "anthropic-news",
							title: "Claude API update",
							url: "https://anthropic.example.com/api",
							rank: 2,
							fetchedAt: Date.now(),
						},
					],
				},
			],
		},
	],
};

async function mockTrendsPage(route: import("@playwright/test").Route) {
	const origin = route.request().headers().origin ?? "http://localhost:3001";
	await route.fulfill({
		status: 200,
		contentType: "application/json",
		headers: {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Credentials": "true",
		},
		body: JSON.stringify(FAKE_TRENDS_PAGE),
	});
}

if (isPlaywrightRuntime) {
	test.describe("trends AI summary", () => {
		test("renders citation tags as clickable footnote links", async ({
			page,
		}) => {
			await page.route(
				"**/api/trends/ai",
				async (route) => await mockTrendsPage(route)
			);
			const fakeMarkdown =
				"OpenAI shipped GPT-5 [1] while Anthropic countered with new Claude models [2][3].";
			const citations = [
				{ n: 1, url: "https://openai.example.com/gpt-5" },
				{ n: 2, url: "https://anthropic.example.com/claude" },
				{ n: 3, url: "https://anthropic.example.com/api" },
			];
			await page.route("**/api/trends/*/summary", async (route) => {
				// Browsers won't expose `X-Trends-Citations` to credentialed
				// cross-origin reads unless the response includes matching CORS
				// headers, so the mock has to mimic what the real server emits.
				const origin =
					route.request().headers().origin ?? "http://localhost:3001";
				await route.fulfill({
					status: 200,
					contentType: "text/plain; charset=utf-8",
					headers: {
						"X-Trends-Citations": encodeURIComponent(JSON.stringify(citations)),
						"Access-Control-Expose-Headers": "X-Trends-Citations",
						"Access-Control-Allow-Origin": origin,
						"Access-Control-Allow-Credentials": "true",
					},
					body: fakeMarkdown,
				});
			});

			await page.goto("/trends/ai");
			const summary = page.getByTestId("trends-summary-body");
			await expect(summary).toBeVisible({ timeout: 10_000 });

			// Each `[N]` got rewritten to a Streamdown link button containing
			// `<sup>N</sup>`. With linkSafety enabled, the rendered element is a
			// button (not <a href>) — clicking it opens our custom modal.
			const citationButtons = summary.locator(
				'[data-streamdown="link"]:has(sup)'
			);
			await expect(citationButtons).toHaveCount(3);
			await expect(citationButtons.nth(0).locator("sup")).toHaveText("1");
			await expect(citationButtons.nth(1).locator("sup")).toHaveText("2");
			await expect(citationButtons.nth(2).locator("sup")).toHaveText("3");

			// Click the first citation — the custom modal should show the
			// item's title and description from the loaded page data.
			await citationButtons.nth(0).click();
			const modalTitle = page.getByRole("dialog").getByText("GPT-5 launches");
			await expect(modalTitle).toBeVisible();
			await expect(
				page
					.getByRole("dialog")
					.getByText("OpenAI rolls out GPT-5", { exact: false })
			).toBeVisible();
			await expect(
				page.getByRole("dialog").getByText("OpenAI News")
			).toBeVisible();
			// Single primary action that actually opens the link.
			const openButton = page.getByRole("button", { name: "Open original" });
			await expect(openButton).toBeVisible();

			await page.screenshot({
				path: "test-results/trends-ai-citations.png",
				fullPage: false,
			});
		});

		test("renders mocked streaming markdown without hitting the LLM", async ({
			page,
		}) => {
			await page.route(
				"**/api/trends/ai",
				async (route) => await mockTrendsPage(route)
			);
			// Stub the summary endpoint so this test stays deterministic and fast,
			// independent of model availability or cache state.
			const fakeMarkdown = [
				"This is a **mocked** summary used to verify Streamdown rendering.",
				"",
				"- First **highlight** with bold emphasis",
				"- Second highlight",
				"- Third highlight",
			].join("\n");
			await page.route("**/api/trends/*/summary", async (route) => {
				const origin =
					route.request().headers().origin ?? "http://localhost:3001";
				await route.fulfill({
					status: 200,
					contentType: "text/plain; charset=utf-8",
					headers: {
						"Access-Control-Allow-Origin": origin,
						"Access-Control-Allow-Credentials": "true",
					},
					body: fakeMarkdown,
				});
			});

			await page.goto("/trends/ai");

			await expect(page.getByText(SYNTHESIZED_FROM_RE)).toBeVisible({
				timeout: 15_000,
			});
			const summary = page.getByTestId("trends-summary-body");
			await expect(summary).toBeVisible({ timeout: 10_000 });
			await expect(summary).toContainText("mocked");

			// Streamdown turned the markdown into bold + list elements.
			await expect(
				summary.locator('[data-streamdown="strong"]').first()
			).toBeVisible();
			await expect(
				summary.locator('[data-streamdown="unordered-list"]').first()
			).toBeVisible();
		});

		test("renders streaming markdown summary above the source grid", async ({
			page,
		}) => {
			// Cold-cache LLM calls can take 60–90s; cache hits ~2s. Pick a
			// generous test budget so the first run after a server restart still
			// passes without flaking.
			test.setTimeout(150_000);

			await page.goto("/trends/ai");

			// The page itself should mount before we wait for the summary block.
			await expect(page.getByText(SYNTHESIZED_FROM_RE)).toBeVisible({
				timeout: 15_000,
			});

			// Cold-cache responses can take ~60–90s because DeepSeek-V4-PRO does
			// substantial silent reasoning before emitting the first token. Cache
			// hits resolve in ~2s.
			const summary = page.getByTestId("trends-summary-body");
			await expect(summary).toBeVisible({ timeout: 120_000 });
			await expect(summary).not.toBeEmpty();

			// Streamdown should parse Markdown (bold or list), not render raw text.
			// Either bold emphasis or a list is acceptable — the model is asked for
			// a short prose paragraph plus optional 2-5 bullet highlights.
			const hasMarkdownStructure = await summary
				.locator(
					'[data-streamdown="strong"], [data-streamdown="unordered-list"], [data-streamdown="list-item"]'
				)
				.first()
				.isVisible({ timeout: 5000 });
			expect(hasMarkdownStructure).toBe(true);

			// Source cards should still render below the summary.
			await expect(page.getByText("OpenAI News").first()).toBeVisible();

			// Capture a screenshot for manual inspection.
			await page.screenshot({
				path: "test-results/trends-ai.png",
				fullPage: false,
			});
		});

		test("text grows progressively while streaming (visible streaming effect)", async ({
			page,
		}) => {
			// Hits the real server. The cache replay yields ~16 chars every 20ms,
			// so the body should grow by clearly distinct amounts over ~1–3s.
			// The previous test in this file warms the cache for /trends/ai, so a
			// retry isn't needed — assertions allow up to 30s anyway.
			await page.goto("/trends/ai");
			const summary = page.getByTestId("trends-summary-body");
			await expect(summary).toBeVisible({ timeout: 60_000 });

			const lengths: number[] = [];
			const deadline = Date.now() + 5000;
			let captured = false;
			while (Date.now() < deadline) {
				const len = await summary
					.evaluate((el) => (el.textContent ?? "").length)
					.catch(() => 0);
				lengths.push(len);
				// Snap a mid-stream screenshot once the body is non-empty but not
				// yet finished, so we have visual proof of partial render.
				if (!(captured || len < 200 || len > 900)) {
					captured = true;
					await page.screenshot({
						path: "test-results/trends-ai-streaming-mid.png",
						fullPage: false,
					});
				}
				await page.waitForTimeout(120);
				const last = lengths.at(-1) ?? 0;
				if (last > 800 && last === lengths.at(-3)) {
					break;
				}
			}

			// We should see a sequence of strictly increasing samples — that's
			// progressive rendering, not a single flush at the end.
			const increasing = lengths.filter(
				(len, i) => i === 0 || len > (lengths[i - 1] ?? 0)
			);
			expect(increasing.length).toBeGreaterThanOrEqual(4);
		});
	});
}
