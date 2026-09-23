export interface Citation {
	topic?: string;
	url: string;
}
export type CitationMap = ReadonlyMap<number, Citation>;

const LIST_LINE_RE = /^\s*\d+[.)]\s+/;
// Lines shown before the digest folds; the rest wait behind "show more".
export const DIGEST_FOLD = 5;

export function shouldShowDigestTopicTags(topicId: string): boolean {
	return topicId === "featured" || topicId === "mine";
}

export function shouldExpandGeneratedSummary(origin: string | null): boolean {
	return origin === "generated";
}

export type DigestLine =
	| { body: string; kind: "entry"; n: number; topic?: string }
	| { kind: "text"; text: string };

const ENTRY_LINE_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const FIRST_CITATION_RE = /\[(\d+)\]/;

// The digest as lines the client lays out itself: numbered entries, each
// knowing the topic of its first citation, and any other text in between.
export function digestLines(
	text: string,
	citations: CitationMap
): DigestLine[] {
	const lines: DigestLine[] = [];
	for (const raw of text.split("\n")) {
		const match = ENTRY_LINE_RE.exec(raw);
		if (!match?.[2]) {
			if (raw.trim()) {
				lines.push({ kind: "text", text: raw });
			}
			continue;
		}
		const first = Number.parseInt(
			FIRST_CITATION_RE.exec(match[2])?.[1] ?? "",
			10
		);
		lines.push({
			body: match[2],
			kind: "entry",
			n: Number.parseInt(match[1] ?? "", 10),
			topic: citations.get(first)?.topic,
		});
	}
	return lines;
}

// The digest folded to its first entries. Returns the text unchanged while it
// is still streaming, so the fold never hides what is being written.
export function foldDigest(text: string, limit: number): string {
	const lines = text.split("\n");
	let seen = 0;
	for (const [index, line] of lines.entries()) {
		if (LIST_LINE_RE.test(line)) {
			seen += 1;
			if (seen > limit) {
				return lines.slice(0, index).join("\n").trimEnd();
			}
		}
	}
	return text;
}

export function countDigestLines(text: string): number {
	return text.split("\n").filter((line) => LIST_LINE_RE.test(line)).length;
}
