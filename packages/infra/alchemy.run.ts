import alchemy from "alchemy";
import { TanStackStart } from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

const app = await alchemy("opentrends");

function required(value: string | undefined, key: string): string {
	if (!value) {
		throw new Error(`Missing required env: ${key}`);
	}
	return value;
}

export const web = await TanStackStart("web", {
	cwd: "../../apps/web",
	bindings: {
		VITE_SERVER_URL: required(alchemy.env.VITE_SERVER_URL, "VITE_SERVER_URL"),
		DATABASE_URL: required(alchemy.secret.env.DATABASE_URL, "DATABASE_URL"),
		CORS_ORIGIN: required(alchemy.env.CORS_ORIGIN, "CORS_ORIGIN"),
		BETTER_AUTH_SECRET: required(
			alchemy.secret.env.BETTER_AUTH_SECRET,
			"BETTER_AUTH_SECRET"
		),
		BETTER_AUTH_URL: required(alchemy.env.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
	},
});

console.log(`Web    -> ${web.url}`);

await app.finalize();
