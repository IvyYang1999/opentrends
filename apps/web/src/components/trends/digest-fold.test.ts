import { describe, expect, test } from "bun:test";

import {
	countDigestLines,
	DIGEST_FOLD,
	foldDigest,
	tagDigestLines,
} from "./digest-fold";

const TEN = Array.from(
	{ length: 10 },
	(_, i) => `${i + 1}. **Story ${i + 1}** — why [${i + 1}]`
).join("\n");

describe("foldDigest", () => {
	test("keeps the first five entries and counts them all", () => {
		expect(countDigestLines(TEN)).toBe(10);
		const folded = foldDigest(TEN, DIGEST_FOLD);
		expect(countDigestLines(folded)).toBe(5);
		expect(folded.endsWith("[5]")).toBe(true);
		expect(foldDigest("1. only one", DIGEST_FOLD)).toBe("1. only one");
	});
});

describe("tagDigestLines", () => {
	test("prefixes each line with its first citation's topic", () => {
		const citations = new Map([
			[1, { topic: "ai", url: "https://a" }],
			[2, { url: "https://b" }],
		]);
		const tagged = tagDigestLines(
			"1. **A** — why [1]\n2. **B** — why [2]\nnot a list line",
			citations,
			(id) => id.toUpperCase(),
			(id) => `/feed?topic=${id}`
		);
		expect(tagged.split("\n")).toEqual([
			"1. [AI](/feed?topic=ai) **A** — why [1]",
			"2. **B** — why [2]",
			"not a list line",
		]);
	});
});
