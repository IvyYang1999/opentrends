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

import { getWorkerBindings } from "../../runtime";

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

class CloudflareKvHotCache implements HotCache {
	async delete(key: string): Promise<void> {
		try {
			await getWorkerBindings()?.HOT_CACHE.delete(key);
		} catch (error) {
			console.warn("[hot-cache] failed to delete KV entry", { error, key });
		}
	}

	async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
		try {
			const value = await getWorkerBindings()?.HOT_CACHE.get<CacheEnvelope<T>>(
				key,
				"json"
			);
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
			await getWorkerBindings()?.HOT_CACHE.put(key, JSON.stringify(value), {
				expirationTtl: ttlSeconds,
			});
		} catch (error) {
			console.warn("[hot-cache] failed to write KV entry", { error, key });
		}
	}
}

export const hotCache: HotCache = new CloudflareKvHotCache();
