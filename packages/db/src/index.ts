/// <reference types="@cloudflare/workers-types" />

import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/d1";

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

function createD1Client(database: D1Database) {
	return drizzle(database, { schema });
}

export type AppDatabase = ReturnType<typeof createD1Client>;

const databaseContext = new AsyncLocalStorage<AppDatabase>();

export function runWithDbClient<T>(
	database: AppDatabase,
	callback: () => T
): T {
	return databaseContext.run(database, callback);
}

export function runWithD1Database<T>(
	database: D1Database,
	callback: () => T
): T {
	return runWithDbClient(createD1Client(database), callback);
}

export function getDb(): AppDatabase {
	const database = databaseContext.getStore();
	if (!database) {
		throw new Error(
			"D1 database binding is unavailable outside a Cloudflare Worker request"
		);
	}
	return database;
}

export function createDb(): AppDatabase {
	return getDb();
}

export const db = new Proxy(
	{},
	{
		get(_target, property, receiver) {
			return Reflect.get(getDb(), property, receiver);
		},
	}
) as AppDatabase;

export { schema };
