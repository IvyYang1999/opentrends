import type { AppRouter } from "@opentrends/api/routers/index";
import { env } from "@opentrends/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";

// Query surfaces own their loading/error UI. A global query-cache toast exposed
// raw server errors for harmless background refetches even when cached data was
// still on screen, making a transient failure look like a page-wide outage.
export const createQueryClient = () => new QueryClient();

const link = new RPCLink({
	url: `${env.VITE_SERVER_URL}/rpc`,
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

const getORPCClient = () => createORPCClient(link) as RouterClient<AppRouter>;

export const client: RouterClient<AppRouter> = getORPCClient();

export const orpc = createTanstackQueryUtils(client);
