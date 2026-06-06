import { env } from "@opentrends/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import {
	account,
	accountRelations,
	session,
	sessionRelations,
	user,
	userRelations,
	verification,
} from "./schema/auth";
import {
	source,
	sourceItem,
	sourceItemEmbedding,
	sourceItemTranslation,
	trendEvent,
	trendEventSourceItem,
	trendEventTopic,
	trendsSummary,
} from "./schema/trends";

const schema = {
	account,
	accountRelations,
	session,
	sessionRelations,
	source,
	sourceItemEmbedding,
	sourceItem,
	sourceItemTranslation,
	trendEvent,
	trendEventSourceItem,
	trendEventTopic,
	trendsSummary,
	user,
	userRelations,
	verification,
};

const DB_QUERY_TIMEOUT_MS = 8000;
const DB_IDLE_TIMEOUT_MS = 30_000;

export function createDb() {
	const pool = new pg.Pool({
		allowExitOnIdle: true,
		connectionString: env.DATABASE_URL,
		connectionTimeoutMillis: DB_QUERY_TIMEOUT_MS,
		idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
		max: 4,
		query_timeout: DB_QUERY_TIMEOUT_MS,
		statement_timeout: DB_QUERY_TIMEOUT_MS,
	});
	return drizzle({ client: pool, schema });
}

let dbInstance: ReturnType<typeof createDb> | undefined;

export function getDb(): ReturnType<typeof createDb> {
	dbInstance ??= createDb();
	return dbInstance;
}

export const db = new Proxy(
	{},
	{
		get(_target, property, receiver) {
			return Reflect.get(getDb(), property, receiver);
		},
	}
) as ReturnType<typeof createDb>;
export { schema };
