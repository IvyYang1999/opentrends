import { describe, expect, test } from "bun:test";

import {
	countDigestLines,
	DIGEST_FOLD,
	digestLines,
	foldDigest,
	shouldExpandGeneratedSummary,
	shouldShowDigestTopicTags,
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

describe("digest presentation", () => {
	test("shows topic tags only when a digest combines several topics", () => {
		expect(shouldShowDigestTopicTags("featured")).toBe(true);
		expect(shouldShowDigestTopicTags("mine")).toBe(true);
		expect(shouldShowDigestTopicTags("ai")).toBe(false);
		expect(shouldShowDigestTopicTags("embodied")).toBe(false);
	});

	test("keeps a summary expanded only when this response generated it live", () => {
		expect(shouldExpandGeneratedSummary("generated")).toBe(true);
		expect(shouldExpandGeneratedSummary("cache")).toBe(false);
		expect(shouldExpandGeneratedSummary(null)).toBe(false);
	});
});
