import { describe, expect, test } from "bun:test";

import {
	clampItems,
	extractImageFromHtml,
	isValidUrl,
	normalizeText,
} from "../adapters/shared";
import type { NewsItem } from "../types";

function makeItem(title: string, id = title): NewsItem {
	return {
		id,
		sourceId: "test",
		title,
		url: `https://example.com/${id}`,
		fetchedAt: 0,
	};
}

describe("clampItems", () => {
	test("limits to 30 items", () => {
		const items = Array.from({ length: 50 }, (_, i) =>
			makeItem(`item ${i}`, String(i))
		);
		expect(clampItems(items)).toHaveLength(30);
	});
});

describe("isValidUrl", () => {
	test("accepts http and https", () => {
		expect(isValidUrl("https://example.com")).toBe(true);
		expect(isValidUrl("http://example.com")).toBe(true);
	});

	test("rejects other schemes and invalid input", () => {
		expect(isValidUrl("ftp://example.com")).toBe(false);
		expect(isValidUrl("not a url")).toBe(false);
		expect(isValidUrl(undefined)).toBe(false);
		expect(isValidUrl("")).toBe(false);
	});
});

describe("normalizeText", () => {
	test("collapses whitespace and trims", () => {
		expect(normalizeText("  hello\n   world  ")).toBe("hello world");
	});

	test("returns empty string for nullish input", () => {
		expect(normalizeText(undefined)).toBe("");
		expect(normalizeText(null)).toBe("");
	});
});

describe("extractImageFromHtml", () => {
	test("returns the first http(s) <img src>", () => {
		const html = '<p>hi</p><img src="https://cdn.example.com/a.png" alt="">';
		expect(extractImageFromHtml(html)).toBe("https://cdn.example.com/a.png");
	});

	test("rejects relative or non-http urls", () => {
		expect(extractImageFromHtml('<img src="/local.png">')).toBeUndefined();
		expect(
			extractImageFromHtml('<img src="data:image/png;base64,xx">')
		).toBeUndefined();
	});

	test("returns undefined for empty input", () => {
		expect(extractImageFromHtml(undefined)).toBeUndefined();
		expect(extractImageFromHtml("")).toBeUndefined();
		expect(extractImageFromHtml("<p>no image</p>")).toBeUndefined();
	});
});
