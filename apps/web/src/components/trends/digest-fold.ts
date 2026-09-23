export interface Citation {
	topic?: string;
	url: string;
}
export type CitationMap = ReadonlyMap<number, Citation>;

const LIST_LINE_RE = /^\s*\d+[.)]\s+/;
const FIRST_CITATION_RE = /\[(\d+)\]/;
// Lines shown before the digest folds; the rest wait behind "show more".
export const DIGEST_FOLD = 5;

// A digest drawn from every topic tags each line with the field its first
// citation came from, as a link to that topic's feed. The tag is styled by
// its href (see SummaryBody), so nothing but Markdown crosses into Streamdown.
export function tagDigestLines(
	text: string,
	citations: CitationMap,
	topicLabel: (topicId: string) => string,
	topicHref: (topicId: string) => string
): string {
	return text
		.split("\n")
		.map((line) => {
			const head = LIST_LINE_RE.exec(line)?.[0];
			if (!head) {
				return line;
			}
			const n = Number.parseInt(FIRST_CITATION_RE.exec(line)?.[1] ?? "", 10);
			const topic = citations.get(n)?.topic;
			if (!topic) {
				return line;
			}
			return `${head}[${topicLabel(topic)}](${topicHref(topic)}) ${line.slice(head.length)}`;
		})
		.join("\n");
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
