import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { voidPlugin } from "void";

const rootUrl = new URL("../..", import.meta.url);
const isVoidDeploy = Boolean(process.env.VOID_DEPLOY_PROJECT_ID);

const resolveFromRoot = (path: string) => fileURLToPath(new URL(path, rootUrl));

export default defineConfig({
	envDir: isVoidDeploy
		? fileURLToPath(new URL(".void/empty-env", import.meta.url))
		: undefined,
	resolve: {
		alias: [
			{
				find: "@opentrends/env/server",
				replacement: resolveFromRoot("apps/server/src/void-env.ts"),
			},
		],
	},
	plugins: [voidPlugin()],
});
