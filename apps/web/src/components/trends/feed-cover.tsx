import { SourceFavicon } from "./source-favicon";
import type { NewsItem, SourceCardData } from "./types";

// Palettes for generated covers. Each source always gets the same one, so a
// reader learns to spot Hacker News or 36氪 by colour the way they would by
// a real cover.
const PALETTES = [
	["#1f3a8a", "#3b82f6"],
	["#7c2d12", "#f97316"],
	["#14532d", "#22c55e"],
	["#581c87", "#a855f7"],
	["#831843", "#ec4899"],
	["#134e4a", "#14b8a6"],
	["#713f12", "#eab308"],
	["#1e293b", "#64748b"],
] as const;

// A few heights keep the masonry uneven without letting any card sprawl.
const RATIOS = ["aspect-[4/3]", "aspect-[16/10]", "aspect-[1/1]"] as const;

function hash(value: string): number {
	let h = 0;
	for (let i = 0; i < value.length; i += 1) {
		h = (h * 31 + value.charCodeAt(i)) % 2_147_483_647;
	}
	return h;
}

export function coverRatio(item: NewsItem): string {
	return RATIOS[hash(item.id) % RATIOS.length] as string;
}

// A text-only item gets a poster: the title set large on the source's
// gradient, with its favicon and heat, so nothing in the feed is a bare row.
export function GeneratedCover({
	heat,
	item,
	source,
}: {
	heat?: string;
	item: NewsItem;
	source: SourceCardData;
}) {
	const [from, to] = PALETTES[hash(source.sourceId) % PALETTES.length] as [
		string,
		string,
	];
	const large = item.title.length <= 40;
	return (
		<span
			aria-hidden
			className={`flex w-full flex-col justify-between p-4 text-white ${coverRatio(item)}`}
			style={{
				backgroundImage: `linear-gradient(160deg, ${from} 0%, ${to} 100%)`,
			}}
		>
			<span className="flex items-center gap-1.5 text-[11px] text-white/80">
				<SourceFavicon homeUrl={source.homeUrl} />
				<span className="truncate">{source.title}</span>
			</span>
			<span
				className={`line-clamp-5 font-semibold leading-snug tracking-tight ${large ? "text-[18px]" : "text-[15px]"}`}
			>
				{item.title}
			</span>
			{heat ? (
				<span className="self-end text-[12px] text-white/80 tabular-nums">
					{heat}
				</span>
			) : (
				<span />
			)}
		</span>
	);
}
