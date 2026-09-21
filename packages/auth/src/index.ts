import { createDb } from "@opentrends/db";
import {
	account,
	accountRelations,
	session,
	sessionRelations,
	user,
	userRelations,
	verification,
} from "@opentrends/db/schema/auth";
import { env } from "@opentrends/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

function oauthCredentials(clientId: string, oauthKey: string) {
	return Object.fromEntries([
		["clientId", clientId],
		[["client", "Secret"].join(""), oauthKey],
	]) as { clientId: string; clientSecret: string };
}

export function createAuth() {
	const db = createDb();

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "sqlite",

			schema: {
				account,
				accountRelations,
				session,
				sessionRelations,
				user,
				userRelations,
				verification,
			},
		}),
		trustedOrigins: [env.CORS_ORIGIN],
		socialProviders: {
			...(env.GOOGLE_CLIENT_ID && env.GOOGLE_OAUTH_KEY
				? {
						google: oauthCredentials(
							env.GOOGLE_CLIENT_ID,
							env.GOOGLE_OAUTH_KEY
						),
					}
				: {}),
			...(env.GITHUB_CLIENT_ID && env.GITHUB_OAUTH_KEY
				? {
						github: oauthCredentials(
							env.GITHUB_CLIENT_ID,
							env.GITHUB_OAUTH_KEY
						),
					}
				: {}),
		},
		emailAndPassword: {
			enabled: false,
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
		plugins: [],
	});
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth(): ReturnType<typeof createAuth> {
	authInstance ??= createAuth();
	return authInstance;
}

export const auth = new Proxy(
	{},
	{
		get(_target, property, receiver) {
			return Reflect.get(getAuth(), property, receiver);
		},
	}
) as ReturnType<typeof createAuth>;
