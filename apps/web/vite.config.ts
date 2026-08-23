import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import alchemy from "alchemy/cloudflare/tanstack-start";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vite";

import { paraglideCompilerOptions } from "./paraglide.config";

const alchemyConfigPath = fileURLToPath(
	new URL("./.alchemy/local/wrangler.jsonc", import.meta.url)
);
const shouldUseAlchemy = existsSync(alchemyConfigPath);

function loadLocalWebEnv(mode: string): void {
	loadDotenv({
		path: [
			fileURLToPath(new URL(".env.local", import.meta.url)),
			fileURLToPath(new URL(`.env.${mode}.local`, import.meta.url)),
		],
		override: true,
		quiet: true,
	});
}

export default defineConfig(({ mode }) => {
	loadLocalWebEnv(mode);

	return {
		server: {
			port: 3001,
		},
		resolve: {
			tsconfigPaths: true,
		},
		plugins: [
			paraglideVitePlugin(paraglideCompilerOptions),
			tailwindcss(),
			tanstackStart({
				start: {
					entry: "start.ts",
				},
				server: {
					entry: "server.ts",
				},
			}),
			viteReact(),
			...(shouldUseAlchemy ? [alchemy({ configPath: alchemyConfigPath })] : []),
		],
	};
});
