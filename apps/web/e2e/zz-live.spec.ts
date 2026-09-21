import { expect, test } from "@playwright/test";
const OUT = "/var/folders/l2/ym5w1ld94plccnd69khvvb780000gn/T//ot-compare";
test("live preview", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/zh/trends/ai");
	const body = page.getByTestId("trends-summary-body");
	await expect(body.locator("ol > li").first()).toBeVisible({ timeout: 120_000 });
	const count = async () => page.evaluate(() => {
		const rows = [...document.querySelectorAll("main li a, main li button")].map((a) => (a as HTMLElement).innerText.trim()).filter((t) => t.length > 12);
		return { rows: rows.length, chinese: rows.filter((t) => /[㐀-鿿]/.test(t)).length };
	});
	console.log("LIVE summary entries:", await body.locator("ol > li").count());
	console.log("LIVE titles at first paint:", JSON.stringify(await count()));
	await page.screenshot({ path: OUT + "/live-1.png" });
	for (const wait of [20, 40]) {
		await page.waitForTimeout(wait * 1000);
		console.log("LIVE titles after +" + wait + "s:", JSON.stringify(await count()));
	}
	await page.screenshot({ path: OUT + "/live-2.png" });
	await page.getByRole("button", { name: "本周" }).click();
	await expect(body.locator("ol > li").first()).toBeVisible({ timeout: 120_000 });
	await page.waitForTimeout(25_000);
	console.log("LIVE week entries:", await body.locator("ol > li").count());
	console.log("LIVE week text:", (await body.innerText()).slice(0, 400).replace(/\n/g, " | "));
	await page.getByRole("button", { name: "分享" }).click();
	await expect(page.getByTestId("share-image-preview")).toBeVisible({ timeout: 20_000 });
	await page.screenshot({ path: OUT + "/live-3-share.png" });
});
