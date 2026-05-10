import type { AppRouter } from "@opentrends/api/routers/index";
import { env } from "@opentrends/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const queryClient = new QueryClient({
	queryCache: new QueryCache({
		onError: (error, query) => {
			toast.error(`Error: ${error.message}`, {
				action: {
					label: "retry",
					onClick: query.invalidate,
				},
			});
		},
	}),
});

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
