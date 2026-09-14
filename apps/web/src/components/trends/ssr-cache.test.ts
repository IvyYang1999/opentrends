import { expect, test } from "bun:test";
import { dehydrate, hydrate, QueryObserver } from "@tanstack/react-query";
import { createQueryClient } from "../../utils/orpc";
import { trendsPageQueryOptions } from "./trends-query";

test("SSR requests stay isolated and hydrated previews do not fetch again", async () => {
	const first = createQueryClient();
	const second = createQueryClient();
	const browser = createQueryClient();
	const options = trendsPageQueryOptions("ai", "en");
	const page = { id: "ai", title: "AI", updatedAt: 1, sections: [] };
	first.setQueryData(options.queryKey, page);
	expect(second.getQueryData(options.queryKey)).toBeUndefined();
	expect(
		first.getQueryData(trendsPageQueryOptions("ai", "zh").queryKey)
	).toBeUndefined();
	hydrate(browser, dehydrate(first));
	let reads = 0;
	const observer = new QueryObserver(browser, {
		...options,
		queryFn: () => {
			reads += 1;
			return Promise.resolve(page);
		},
	});
	const unsubscribe = observer.subscribe(() => undefined);
	await Promise.resolve();
	expect(observer.getCurrentResult().data).toEqual(page);
	expect(observer.getCurrentResult().isFetching).toBe(false);
	expect(reads).toBe(0);
	unsubscribe();
	for (const cache of [first, second, browser]) {
		cache.clear();
	}
});
