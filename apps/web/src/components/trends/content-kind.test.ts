import { describe, expect, test } from "bun:test";

import { classifyTitle, contentKind } from "./content-kind";
import type { NewsItem } from "./types";

describe("classifyTitle", () => {
	test("reads the kind off bilingual titles", () => {
		expect(classifyTitle("OpenAI releases GPT-6 Sol and Luna")).toBe("release");
		expect(classifyTitle("阿里开源 Qwen3.5，推出多模态版本")).toBe("release");
		expect(classifyTitle("arXiv: Scaling laws for sparse attention")).toBe(
			"paper"
		);
		expect(classifyTitle("研究人员发现大模型会在长上下文中丢失指令")).toBe(
			"paper"
		);
		expect(
			classifyTitle("EU regulators open antitrust probe into Nvidia")
		).toBe("policy");
		expect(classifyTitle("网信办发布生成式 AI 服务管理办法")).toBe("policy");
		expect(classifyTitle("Claude Opus 5.5 vs GPT-6: coding benchmark")).toBe(
			"benchmark"
		);
		expect(classifyTitle("How to run a 27B model on a laptop")).toBe(
			"tutorial"
		);
		expect(classifyTitle("Moonshot AI raises $1B at a $35B valuation")).toBe(
			"industry"
		);
		expect(classifyTitle("Why agents still fail at long tasks")).toBe(
			"opinion"
		);
		expect(classifyTitle("有在用非云端的 Wispr Flow 替代方案吗？")).toBe(
			"opinion"
		);
		expect(
			classifyTitle("Meta admits Muse resembles OpenClaw")
		).toBeUndefined();
	});

	test("falls back to the original title", () => {
		const item = {
			id: "1",
			fetchedAt: 0,
			original: { title: "Introducing the Claude Agent SDK" },
			sourceId: "s",
			title: "Claude Agent SDK 来了",
			url: "u",
		} as unknown as NewsItem;
		expect(contentKind(item)).toBe("release");
	});
});
