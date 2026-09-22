import { env } from "@opentrends/env/web";
import { useEffect, useState } from "react";

import { SourceFavicon } from "./source-favicon";
import type { NewsItem, SourceCardData } from "./types";

// Poster heights; a few so the masonry stays uneven, none so tall that a
// short title floats in empty space.
const RATIOS = ["aspect-[4/3]", "aspect-[16/10]", "aspect-[1/1]"] as const;

// Punctuation that splits a title into a kicker and a headline.
const KICKER_RE = /^(.{2,24}?)[：:｜|—–-]\s*(.{4,})$/;
const FIGURE_RE = /(\d[\d,.]*\s*[%万亿kKmM]?)/;
const QUESTION_RE = /[?？]\s*$/;
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

function KickerText({ title }: { title: string }) {
	const match = KICKER_RE.exec(title);
	if (!(match?.[1] && match[2])) {
		return <StatementText title={title} />;
	}
	return (
		<span className="flex flex-col gap-1.5">
			<span className="truncate font-medium text-[11px] uppercase tracking-wide opacity-70">
				{match[1]}
			</span>
			<span className="line-clamp-4 font-semibold text-[17px] leading-snug tracking-tight">
				{match[2]}
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
		<span className="line-clamp-4 font-bold text-[21px] leading-snug tracking-tight">
			{title}
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
						{title}
					</span>
				</span>
			);
		case "statement":
			return <StatementText title={title} />;
		default:
			return (
				<span className="line-clamp-5 border-current border-l-2 pl-3 font-medium text-[14px] leading-relaxed opacity-90">
					{title}
				</span>
			);
	}
}

// A text-only item gets a poster in a light tint of the source's colour
// with dark text, so it reads like a card and not like a banner.
export function GeneratedCover({
	heat,
	item,
	source,
}: {
	heat?: string;
	item: NewsItem;
	source: SourceCardData;
}) {
	const hue = useSourceHue(source);
	const template = pickTemplate(item.title);
	return (
		<span
			aria-hidden
			className={`flex w-full flex-col justify-between p-4 ${coverRatio(item)}`}
			style={{
				backgroundImage: `linear-gradient(160deg, hsl(${hue} 70% 94%) 0%, hsl(${hue} 60% 86%) 100%)`,
				color: `hsl(${hue} 45% 22%)`,
			}}
		>
			<span className="flex items-center gap-1.5 text-[11px] opacity-70">
				<SourceFavicon homeUrl={source.homeUrl} />
				<span className="truncate">{source.title}</span>
			</span>
			<PosterText template={template} title={item.title} />
			<span className="self-end text-[12px] tabular-nums opacity-70">
				{heat ?? ""}
			</span>
		</span>
	);
}
