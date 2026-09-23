import type { NewsItem } from "./types";

// What sort of thing an item is, read off its title: a release, a paper, an
// opinion, a tutorial, industry news, policy, a benchmark. Keyword rules in
// both languages; cheap, immediate and good enough for a filter row. A model
// can refine these later without changing the callers.
export const CONTENT_KINDS = [
	"release",
	"paper",
	"opinion",
	"tutorial",
	"industry",
	"policy",
	"benchmark",
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

// Checked in this order: the more specific kinds first, so "a paper on
// benchmarking releases" is a paper, and "OpenAI releases GPT-6" is a release
// even though the sentence has "AI" in it.
const RULES: [ContentKind, RegExp][] = [
	[
		"paper",
		/arxiv|\bpaper\b|preprint|论文|研究表明|研究发现|研究人员|\bresearchers\b|\bstudy (?:finds|shows)|\bfindings\b|new study/i,
	],
	[
		"policy",
		/监管|政策|法案|立法|禁令|反垄断|合规|诉讼|起诉|法院|裁决|工信部|网信办|国务院|白宫|欧盟|\bregulat|\blaw(?:suit|maker)|\bcourt\b|\bban(?:s|ned)?\b|antitrust|\bsues?\b|\bpolicy\b|\blegislat|\bfcc\b|\bftc\b|\bsec\b|executive order|ai act/i,
	],
	[
		"benchmark",
		/评测|测评|跑分|对比测试|横评|benchmark|leaderboard|\beval(?:uation|s)?\b|\bvs\.?\s|head-to-head|\btested\b|\breview:|\bhands-on\b/i,
	],
	[
		"tutorial",
		/教程|指南|手把手|入门|实践|实战|详解|how to\b|how i\b|\bguide\b|tutorial|step-by-step|\btips\b|\bwalkthrough\b|\bexplained\b|\bcheat ?sheet\b/i,
	],
	[
		"release",
		/发布|推出|上线|开源|正式版|新版本?|\brelease[sd]?\b|\blaunch(?:es|ed)?\b|\bintroduc(?:es|ing)\b|\bannounc(?:es|ed|ing)\b|\bunveil(?:s|ed)?\b|\bships?\b|\bnow available\b|\bv?\d+\.\d+(?:\.\d+)?\b|\bbeta\b|\bpreview\b|\bga\b/i,
	],
	[
		"industry",
		/融资|收购|裁员|财报|营收|估值|上市|合作|投资|市值|股价|\bfunding\b|\braises?\b|\bacqui(?:res?|sition)\b|\blayoffs?\b|\brevenue\b|\bvaluation\b|\bipo\b|\bpartnership\b|\bdeal\b|\bearnings\b|\bstock\b|\bshares\b|\bhires?\b|\bceo\b/i,
	],
	[
		"opinion",
		/观点|评论|为什么|反思|争议|思考|专栏|访谈|对话|我认为|\bwhy\b|\bopinion\b|\bthe case (?:for|against)\b|\bessay\b|\binterview\b|\bthoughts on\b|\bi think\b|\bshould\b|\bwrong\b|\bhot take\b|\?\s*$|？\s*$/i,
	],
];

export function classifyTitle(title: string): ContentKind | undefined {
	for (const [kind, pattern] of RULES) {
		if (pattern.test(title)) {
			return kind;
		}
	}
	return;
}

// The translated and the original title are both consulted: the rules are
// bilingual, and a translation can drop a telling word the original had.
export function contentKind(item: NewsItem): ContentKind | undefined {
	return (
		classifyTitle(item.title) ??
		(item.original?.title ? classifyTitle(item.original.title) : undefined)
	);
}
