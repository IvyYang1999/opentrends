export interface CacheEnvelope<T> {
	createdAt: number;
	freshUntil: number;
	schemaVersion: number;
	staleUntil: number;
	value: T;
}

export interface HotCache {
	delete(key: string): Promise<void>;
	get<T>(key: string): Promise<CacheEnvelope<T> | null>;
	put<T>(
		key: string,
		value: CacheEnvelope<T>,
		ttlSeconds: number
	): Promise<void>;
}

type VoidKv = typeof import("void/kv")["kv"];

let kvPromise: Promise<VoidKv> | undefined;

function getKv(): Promise<VoidKv> {
	kvPromise ??= import("void/kv").then(({ kv }) => kv);
	return kvPromise;
}

function isCacheEnvelope<T>(value: unknown): value is CacheEnvelope<T> {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<CacheEnvelope<T>>;
	return (
		typeof candidate.createdAt === "number" &&
		typeof candidate.freshUntil === "number" &&
		typeof candidate.schemaVersion === "number" &&
		typeof candidate.staleUntil === "number" &&
		"value" in candidate
	);
}

class VoidKvHotCache implements HotCache {
	async delete(key: string): Promise<void> {
		try {
			const kv = await getKv();
			await kv.delete(key);
		} catch (error) {
			console.warn("[hot-cache] failed to delete KV entry", { error, key });
		}
	}

	async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
		try {
			const kv = await getKv();
			const value = await kv.get<CacheEnvelope<T>>(key);
			return isCacheEnvelope<T>(value) ? value : null;
		} catch (error) {
			console.warn("[hot-cache] failed to read KV entry", { error, key });
			return null;
		}
	}

	async put<T>(
		key: string,
		value: CacheEnvelope<T>,
		ttlSeconds: number
	): Promise<void> {
		try {
			const kv = await getKv();
			await kv.put(key, value, { ttl: ttlSeconds });
		} catch (error) {
			console.warn("[hot-cache] failed to write KV entry", { error, key });
		}
	}
}

export const hotCache: HotCache = new VoidKvHotCache();
