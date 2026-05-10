import type { RefreshPolicy, RefreshPolicyId } from "../types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const refreshPolicies: Record<RefreshPolicyId, RefreshPolicy> = {
	hot: {
		softTtlMs: 5 * MINUTE_MS,
		staleTtlMs: 6 * HOUR_MS,
		timeoutMs: 8000,
	},
	community: {
		softTtlMs: 10 * MINUTE_MS,
		staleTtlMs: 6 * HOUR_MS,
		timeoutMs: 8000,
	},
	rss: {
		softTtlMs: 30 * MINUTE_MS,
		staleTtlMs: 24 * HOUR_MS,
		timeoutMs: 8000,
	},
	daily: {
		softTtlMs: 12 * HOUR_MS,
		staleTtlMs: 48 * HOUR_MS,
		timeoutMs: 8000,
	},
	slow: {
		softTtlMs: 2 * HOUR_MS,
		staleTtlMs: 48 * HOUR_MS,
		timeoutMs: 8000,
	},
};

export const REFRESH_LOCK_GRACE_MS = 5000;
