import { describe, expect, test } from "bun:test";

import {
	isDecorativeBadgeImage,
	sourceCardViewportClasses,
} from "./source-card-model";

describe("sourceCardViewportClasses", () => {
	test("does not reserve a 480px offscreen box for an empty source", () => {
		const classes = sourceCardViewportClasses(false);
		expect(classes).toContain("h-auto");
		expect(classes).not.toContain("contain-intrinsic-size");
	});

	test("keeps content visibility optimization for populated sources", () => {
		const classes = sourceCardViewportClasses(true);
		expect(classes).toContain("content-visibility:auto");
		expect(classes).toContain("h-[480px]");
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
