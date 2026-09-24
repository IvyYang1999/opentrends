import type { Citation } from "./get-trends-summary";

// The digest as data, for agents and scripts: one entry per line of the
// Markdown list, with the citations resolved to links. Mirrors the parsing
// the share image does on the client.
export interface DigestJsonCitation {
	n: number;
	topic?: string;
	url: string;
}

export interface DigestJsonEntry {
	citations: DigestJsonCitation[];
	n: number;
	reason?: string;
	takeaway: string;
}

const ENTRY_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const CITATION_RE = /\[(\d+)\]/g;
const BOLD_LEAD_RE = /^\*\*(.+?)\*\*\s*(?:[—–-]+\s*)?(.*)$/;
const BOLD_MARK_RE = /\*\*/g;
const TRAILING_PERIOD_RE = /[\s.。]+$/;

export function parseDigestEntries(
	markdown: string,
	citations: readonly Citation[]
): DigestJsonEntry[] {
	const byNumber = new Map(citations.map((citation) => [citation.n, citation]));
	const entries: DigestJsonEntry[] = [];
	for (const line of markdown.split("\n")) {
		const match = ENTRY_RE.exec(line);
		if (!match?.[2]) {
			continue;
		}
		const cited = new Map<number, DigestJsonCitation>();
		for (const hit of match[2].matchAll(CITATION_RE)) {
			const n = Number.parseInt(hit[1] ?? "", 10);
			const citation = byNumber.get(n);
			if (citation && !cited.has(n)) {
				cited.set(n, citation);
			}
		}
		const body = match[2].replace(CITATION_RE, "").trim();
		const lead = BOLD_LEAD_RE.exec(body);
		const takeaway = lead?.[1]?.trim() ?? body.replace(BOLD_MARK_RE, "");
		const reason = lead?.[2]?.replace(TRAILING_PERIOD_RE, "").trim();
		entries.push({
			citations: [...cited.values()],
			n: Number.parseInt(match[1] ?? "", 10),
			reason: reason || undefined,
			takeaway,
		});
	}
	return entries;
}
