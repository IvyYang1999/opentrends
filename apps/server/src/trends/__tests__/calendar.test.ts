import { describe, expect, test } from "bun:test";

import {
	dayKey,
	parseMonth,
	parseTzOffset,
	pickDay,
} from "../services/get-calendar";
import type { NewsItem } from "../types";

describe("calendar", () => {
	test("parses months and offsets", () => {
		expect(parseMonth("2026-09")).toEqual({
			month: "2026-09",
			monthIndex: 8,
			year: 2026,
		});
		expect(parseMonth("2026-13")).toBeNull();
		expect(parseTzOffset("480")).toBe(480);
		expect(parseTzOffset("x")).toBe(0);
	});

	test("puts an instant on the reader's calendar day", () => {
		const late = Date.UTC(2026, 8, 22, 20);
		expect(dayKey(late, 0)).toBe("2026-09-22");
		expect(dayKey(late, 480)).toBe("2026-09-23");
	});

	test("takes the top of each source in turns, urls once", () => {
		const item = (
			sourceId: string,
			rank: number,
			url = `${sourceId}-${rank}`
		) =>
			({ fetchedAt: 0, id: url, rank, sourceId, title: url, url }) as NewsItem;
		const picked = pickDay([
			item("a", 2),
			item("a", 1),
			item("b", 1),
			item("b", 2, "a-1"),
		]);
		expect(picked.map((i) => i.url)).toEqual(["a-1", "b-1", "a-2"]);
	});
});
