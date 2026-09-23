import { env } from "@opentrends/env/web";
import { useEffect, useState } from "react";

import { FLAME_PATH, RAY_LINES } from "./brand-motif-paths";
import { SourceFavicon } from "./source-favicon";
import type { NewsItem, SourceCardData } from "./types";

// Poster heights; a few so the masonry stays uneven, none so tall that a
// short title floats in empty space.
const RATIOS = ["aspect-[4/3]", "aspect-[16/10]", "aspect-[1/1]"] as const;

// Punctuation that splits a title into a kicker and a headline.
// "谁：说了什么" only: a short speaker before a colon. Dashes and pipes
// separate sections and outlets, not speakers.
const KICKER_RE = /^([^：:]{2,12})[：:]\s*(.{4,})$/;
// A figure is only a headline number when it carries a unit or a
// thousands separator; a bare "8105" is usually a code, not a fact.
const FIGURE_RE =
	/(\d{1,3}(?:,\d{3})+|\d[\d.]*\s*(?:%|万|亿|[kKmM]\b|美元|元|人|次|倍|年|条|款|个))/;
const QUESTION_RE = /[?？]\s*$/;
// Spans worth setting in bold without a language model: quoted phrases,
// Latin names and product names, and figures with their units.
const EMPHASIS_RE =
	/(「[^」]{1,20}」|“[^”]{1,20}”|"[^"]{2,24}"|《[^》]{1,24}》|\b[A-Z][A-Za-z0-9.+-]{1,}(?:\s[A-Z][A-Za-z0-9.+-]{1,}){0,2}\b|\d[\d,.]*\s*[%万亿kKmM]?(?:美元|元|人|次|倍|年|个|条|款|亿|万)?)/g;
const MOTIFS = ["flame", "rays", "grid"] as const;
const HUE_BINS = 12;
const HUE_CACHE = new Map<string, Promise<number | null>>();

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

function faviconSampleUrl(homeUrl: string): string | null {
	try {
		const host = new URL(homeUrl).hostname;
		const favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
		return `${env.VITE_SERVER_URL}/api/image?variant=row&url=${encodeURIComponent(favicon)}`;
	} catch {
		return null;
	}
}

function rgbToHue(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d === 0) {
		return 0;
	}
	let h: number;
	if (max === r) {
		h = ((g - b) / d) % 6;
	} else if (max === g) {
		h = (b - r) / d + 2;
	} else {
		h = (r - g) / d + 4;
	}
	return (((h * 60) % 360) + 360) % 360;
}

function dominantHue(data: Uint8ClampedArray): number | null {
	const bins = new Array<number>(HUE_BINS).fill(0);
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] ?? 0;
		const g = data[i + 1] ?? 0;
		const b = data[i + 2] ?? 0;
		const a = data[i + 3] ?? 0;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		// Skip transparent, near-grey and near-white pixels.
		if (a < 128 || max - min < 40 || max > 245) {
			continue;
		}
		const bin = Math.floor(rgbToHue(r, g, b) / (360 / HUE_BINS)) % HUE_BINS;
		bins[bin] = (bins[bin] ?? 0) + (max - min);
	}
	const best = bins.indexOf(Math.max(...bins));
	return bins[best] ? best * (360 / HUE_BINS) + 360 / HUE_BINS / 2 : null;
}

// The dominant saturated hue of the source's favicon, sampled once per
// source through the image proxy (which sets CORS). Null when the icon is
// grey or cannot be read; the caller then falls back to a hashed hue.
function sampleFaviconHue(homeUrl: string): Promise<number | null> {
	const cached = HUE_CACHE.get(homeUrl);
	if (cached) {
		return cached;
	}
	const promise = new Promise<number | null>((resolve) => {
		const src = faviconSampleUrl(homeUrl);
		if (!src) {
			resolve(null);
			return;
		}
		const image = new Image();
		image.crossOrigin = "anonymous";
		image.onload = () => {
			try {
				const size = 16;
				const canvas = document.createElement("canvas");
				canvas.width = size;
				canvas.height = size;
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					resolve(null);
					return;
				}
				ctx.drawImage(image, 0, 0, size, size);
				resolve(dominantHue(ctx.getImageData(0, 0, size, size).data));
			} catch {
				resolve(null);
			}
		};
		image.onerror = () => resolve(null);
		image.src = src;
	});
	HUE_CACHE.set(homeUrl, promise);
	return promise;
}

export function useSourceHue(source: SourceCardData): number {
	const fallback = hash(source.sourceId) % 360;
	const [hue, setHue] = useState(fallback);
	useEffect(() => {
		let cancelled = false;
		if (!source.homeUrl) {
			return;
		}
		sampleFaviconHue(source.homeUrl).then((sampled) => {
			if (!cancelled && sampled !== null) {
				setHue(sampled);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [source.homeUrl]);
	return hue;
}

type Template = "statement" | "kicker" | "figure" | "question" | "essay";

// Which layout a title gets depends on its shape, not on chance: short
// titles become statements, "谁：说了什么" splits into kicker and headline,
// a number becomes the figure, a question gets its mark, long titles read
// as an essay lede.
export function pickTemplate(title: string): Template {
	if (KICKER_RE.test(title)) {
		return "kicker";
	}
	if (QUESTION_RE.test(title)) {
		return "question";
	}
	if (FIGURE_RE.test(title) && title.length <= 48) {
		return "figure";
	}
	if (title.length <= 22) {
		return "statement";
	}
	return "essay";
}

// Bolds the spans EMPHASIS_RE finds, leaving the rest as is.
export function Emphasized({ text }: { text: string }) {
	const parts = text.split(EMPHASIS_RE);
	return (
		<>
			{parts.map((part, index) =>
				index % 2 === 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: static text fragments
					<strong className="font-bold" key={index}>
						{part}
					</strong>
				) : (
					part
				)
			)}
		</>
	);
}

// "谁：说了什么" reads as a quotation: a large opening mark, the words, and
// the speaker on an attribution line.
function KickerText({ title }: { title: string }) {
	const match = KICKER_RE.exec(title);
	if (!(match?.[1] && match[2])) {
		return <StatementText title={title} />;
	}
	return (
		<span className="flex flex-col gap-1">
			<span className="-mb-4 font-serif text-[44px] leading-none opacity-25">
				“
			</span>
			<span className="line-clamp-4 font-semibold text-[17px] leading-snug tracking-tight">
				<Emphasized text={match[2]} />
			</span>
			<span className="mt-1 flex items-center gap-1.5 text-[12px] opacity-75">
				<span className="h-px w-4 bg-current" />
				<span className="truncate font-medium">{match[1]}</span>
			</span>
		</span>
	);
}

function FigureText({ title }: { title: string }) {
	const figure = FIGURE_RE.exec(title)?.[1]?.trim();
	if (!figure) {
		return <StatementText title={title} />;
	}
	const [before = "", after = ""] = title.split(figure, 2);
	return (
		<span className="flex flex-col gap-1">
			<span className="font-bold text-[28px] leading-none tracking-tight">
				{figure}
			</span>
			<span className="line-clamp-3 text-[14px] leading-snug opacity-90">
				{`${before}${after}`.trim()}
			</span>
		</span>
	);
}

function StatementText({ title }: { title: string }) {
	return (
		<span className="line-clamp-4 font-semibold text-[21px] leading-snug tracking-tight">
			<Emphasized text={title} />
		</span>
	);
}

function PosterText({
	template,
	title,
}: {
	template: Template;
	title: string;
}) {
	switch (template) {
		case "kicker":
			return <KickerText title={title} />;
		case "figure":
			return <FigureText title={title} />;
		case "question":
			return (
				<span className="flex flex-col gap-1">
					<span className="font-serif text-[40px] leading-none opacity-30">
						?
					</span>
					<span className="line-clamp-4 font-semibold text-[16px] leading-snug tracking-tight">
						<Emphasized text={title} />
					</span>
				</span>
			);
		case "statement":
			return <StatementText title={title} />;
		default:
			return (
				<span className="line-clamp-5 border-current border-l-2 pl-3 font-medium text-[14px] leading-relaxed opacity-90">
					<Emphasized text={title} />
				</span>
			);
	}
}

// Brand motifs drawn behind the text in the source's hue: the flame from
// the logo, its rays, or a dot grid. Flat tint, no gradient, so posters sit
// with the rest of the site rather than looking like banners.
function Motif({ hue, kind }: { hue: number; kind: (typeof MOTIFS)[number] }) {
	const stroke = `hsl(${hue} 55% 45%)`;
	if (kind === "flame") {
		return (
			<svg
				aria-hidden
				className="pointer-events-none absolute -right-6 -bottom-8 h-[78%] opacity-[0.10]"
				fill={stroke}
				role="presentation"
				viewBox="0 0 1024 1024"
			>
				<path d={FLAME_PATH} />
			</svg>
		);
	}
	if (kind === "rays") {
		return (
			<svg
				aria-hidden
				className="pointer-events-none absolute top-0 right-0 h-full opacity-[0.13]"
				fill="none"
				role="presentation"
				stroke={stroke}
				strokeLinecap="round"
				strokeWidth="5"
				viewBox="0 0 1024 1024"
			>
				{RAY_LINES.map((line) => (
					<line key={`${line.x2}:${line.y2}`} {...line} />
				))}
			</svg>
		);
	}
	return (
		<span
			aria-hidden
			className="pointer-events-none absolute inset-0 opacity-[0.12]"
			style={{
				backgroundImage: `radial-gradient(${stroke} 1px, transparent 1.5px)`,
				backgroundSize: "14px 14px",
			}}
		/>
	);
}

// A text-only item gets a poster: a flat light tint of the source's colour,
// a brand motif behind, dark text laid out by the title's shape. A thumbnail
// too small to be a cover is set inside the poster instead.
export function GeneratedCover({
	heat,
	item,
	source,
	thumbnail,
}: {
	heat?: string;
	item: NewsItem;
	source: SourceCardData;
	thumbnail?: string;
}) {
	const hue = useSourceHue(source);
	const template = pickTemplate(item.title);
	const motif = MOTIFS[
		hash(item.url) % MOTIFS.length
	] as (typeof MOTIFS)[number];
	return (
		<span
			aria-hidden
			className={`relative flex w-full flex-col justify-between overflow-hidden p-4 ${coverRatio(item)}`}
			style={{
				backgroundColor: `hsl(${hue} 60% 93%)`,
				color: `hsl(${hue} 45% 22%)`,
			}}
		>
			<Motif hue={hue} kind={motif} />
			<span className="relative flex items-center gap-1.5 text-[11px] opacity-70">
				<SourceFavicon homeUrl={source.homeUrl} />
				<span className="truncate">{source.title}</span>
			</span>
			{/* A thumbnail sits beside the text, large enough to read, so the
			    poster stays balanced instead of carrying a stamp in a corner. */}
			<span className="relative flex items-center gap-3">
				<span className="min-w-0 flex-1">
					<PosterText template={template} title={item.title} />
				</span>
				{thumbnail ? (
					<img
						alt=""
						className="size-24 shrink-0 rounded-sm border border-white/70 object-cover shadow-sm"
						height={96}
						src={thumbnail}
						width={96}
					/>
				) : null}
			</span>
			<span className="relative flex justify-end text-[12px] tabular-nums opacity-70">
				{heat ?? ""}
			</span>
		</span>
	);
}
