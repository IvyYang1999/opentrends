import { expect, test } from "@playwright/test";
const OUT = "/var/folders/l2/ym5w1ld94plccnd69khvvb780000gn/T//ot-compare";
test("live titles", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/zh/trends/ai");
	await expect(page.getByTestId("trends-summary-body").locator("ol > li").first()).toBeVisible({ timeout: 120_000 });
	const count = async () => page.evaluate(() => {
		const rows = [...document.querySelectorAll("main ul li")].map((li) => (li as HTMLElement).innerText.trim()).filter((t) => t.length > 12);
		return { rows: rows.length, chinese: rows.filter((t) => /[㐀-鿿]{4,}/.test(t.replace(/小时前|天前|分钟前|刚刚/g, ""))).length };
	});
	console.log("LIVE t+0s:", JSON.stringify(await count()));
	for (const wait of [30, 30, 30]) {
		await page.waitForTimeout(wait * 1000);
		console.log("LIVE +" + wait + "s:", JSON.stringify(await count()));
	}
	await page.screenshot({ path: OUT + "/live-titles.png" });
});
