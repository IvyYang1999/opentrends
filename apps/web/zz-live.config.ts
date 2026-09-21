import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", reporter: "list", timeout: 240_000,
	use: { baseURL: "https://opentrends-web-preview.opentrends.workers.dev", launchOptions: { executablePath: "/Users/yytyyf/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell" } } });
