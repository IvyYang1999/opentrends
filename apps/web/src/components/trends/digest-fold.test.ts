import { describe, expect, test } from "bun:test";

import {
	countDigestLines,
	DIGEST_FOLD,
	digestLines,
	foldDigest,
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

describe("digestLines", () => {
	test("splits entries and finds each line's topic from its first citation", () => {
		const citations = new Map([
			[1, { topic: "ai", url: "https://a" }],
			[2, { url: "https://b" }],
		]);
		expect(
			digestLines(
				"1. **A** — why [1]\n2. **B** — why [2]\n\nnot a list line",
				citations
			)
		).toEqual([
			{ body: "**A** — why [1]", kind: "entry", n: 1, topic: "ai" },
			{ body: "**B** — why [2]", kind: "entry", n: 2, topic: undefined },
			{ kind: "text", text: "not a list line" },
		]);
	});
});
