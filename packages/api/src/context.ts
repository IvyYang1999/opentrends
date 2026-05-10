import type { Context as HonoContext } from "hono";

export interface CreateContextOptions {
	context: HonoContext;
}

export async function createContext({ context }: CreateContextOptions) {
	const { getAuth } = await import("@opentrends/auth");
	const session = await getAuth().api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		auth: null,
		session,
	};
}

export interface Context extends Awaited<ReturnType<typeof createContext>> {}
