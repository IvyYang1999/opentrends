import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { voidPlugin } from "void";

const rootUrl = new URL("../..", import.meta.url);

const resolveFromRoot = (path: string) => fileURLToPath(new URL(path, rootUrl));

export default defineConfig({
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
