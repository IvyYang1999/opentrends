import { describe, expect, test } from "bun:test";

import {
	isDecorativeBadgeImage,
	SOURCE_CARD_GRID_CLASSES,
	shouldLoadFullSource,
	sourceCardViewportClasses,
} from "./source-card-model";

test("source cards stretch to the tallest card in their grid row", () => {
	expect(SOURCE_CARD_GRID_CLASSES).toContain("items-stretch");
	expect(SOURCE_CARD_GRID_CLASSES).not.toContain("items-start");
});

test("loads the full queue behind a populated truncated card", () => {
	expect(shouldLoadFullSource(true, true)).toBe(true);
	expect(shouldLoadFullSource(false, true)).toBe(false);
	expect(shouldLoadFullSource(true, false)).toBe(false);
});

describe("sourceCardViewportClasses", () => {
	test("does not reserve a 480px offscreen box for an empty source", () => {
		const classes = sourceCardViewportClasses(false);
		expect(classes).toContain("h-auto");
		expect(classes).not.toContain("contain-intrinsic-size");
	});

	test("keeps every populated desktop card at the shared viewport height", () => {
		const classes = sourceCardViewportClasses(true);
		expect(classes).toContain("h-[480px]");
		expect(classes).not.toContain("content-visibility:auto");
		expect(classes).not.toContain("contain-intrinsic-size");
	});

	test("bounds only an explicitly expanded source so its full list can scroll", () => {
		const classes = sourceCardViewportClasses(true, true);
		expect(classes).toContain("h-[480px]");
		expect(classes).not.toContain("content-visibility:auto");
	});
});

describe("isDecorativeBadgeImage", () => {
	test("filters ranking badges that are not article covers", () => {
		expect(
			isDecorativeBadgeImage("https://simg.s.weibo.com/moter/flags/1_0.png")
		).toBe(true);
		expect(
			isDecorativeBadgeImage(
				"https://static.yximgs.com/udata/pkg/nebula-app/rank_tag_new3x.png"
			)
		).toBe(true);
		expect(
			isDecorativeBadgeImage(
				"https://p3-sign.douyinpic.com/top-static-files-outer/breaknews/badge.png"
			)
		).toBe(true);
	});

	test("keeps real article covers", () => {
		expect(
			isDecorativeBadgeImage("https://example.com/article-cover.jpg")
		).toBe(false);
		expect(isDecorativeBadgeImage(undefined)).toBe(false);
	});
});
