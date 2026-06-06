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
const isVoidDeploy = Boolean(process.env.VOID_DEPLOY_PROJECT_ID);
const shouldUseAlchemy = !isVoidDeploy && existsSync(alchemyConfigPath);
const cloudflareWorkersShimPath = fileURLToPath(
	new URL("../../packages/env/src/cloudflare-local.ts", import.meta.url)
);
const cloudflareWorkersAlias: Record<string, string> = shouldUseAlchemy
	? {}
	: {
			"cloudflare:workers": cloudflareWorkersShimPath,
		};

function loadLocalWebEnv(mode: string): void {
	if (isVoidDeploy) {
		return;
	}
	loadDotenv({
		path: [
			fileURLToPath(new URL(".env.local", import.meta.url)),
			fileURLToPath(new URL(`.env.${mode}.local`, import.meta.url)),
		],
		override: true,
		quiet: true,
	});
}

export default defineConfig(async ({ mode }) => {
	loadLocalWebEnv(mode);
	const voidPackageName = "void";
	const voidDeployPlugins = isVoidDeploy
		? [(await import(voidPackageName)).voidPlugin()]
		: [];

	return {
		envDir: isVoidDeploy
			? fileURLToPath(new URL(".void/empty-env", import.meta.url))
			: undefined,
		server: {
			port: 3001,
		},
		resolve: {
			tsconfigPaths: true,
			alias: cloudflareWorkersAlias,
		},
		plugins: [
			...voidDeployPlugins,
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
