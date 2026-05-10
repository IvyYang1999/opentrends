import { cn } from "@opentrends/ui/lib/utils";

interface SourceFaviconProps {
	alt?: string;
	className?: string;
	homeUrl?: string;
	size?: number;
	title?: string;
}

export interface SourceLogoStackItem {
	homeUrl?: string;
	id: string;
	label: string;
}

function getFaviconSrc(homeUrl?: string): string | null {
	if (!homeUrl) {
		return null;
	}
	let host: string;
	try {
		host = new URL(homeUrl).hostname;
	} catch {
		return null;
	}
	return `https://favicon.im/${host}`;
}

export function SourceFavicon({
	alt = "",
	className,
	homeUrl,
	size = 16,
	title,
}: SourceFaviconProps) {
	const src = getFaviconSrc(homeUrl);
	if (!src) {
		return null;
	}
	return (
		<img
			alt={alt}
			className={cn("size-4 shrink-0 rounded-sm", className)}
			height={size}
			loading="lazy"
			src={src}
			title={title}
			width={size}
		/>
	);
}

export function SourceLogoStack({
	sources,
	limit = 6,
	className,
	showRemaining = true,
	size = "md",
}: {
	className?: string;
	limit?: number;
	showRemaining?: boolean;
	size?: "sm" | "md";
	sources: readonly SourceLogoStackItem[];
}) {
	const seenFavicons = new Set<string>();
	const logos: SourceLogoStackItem[] = [];
	for (const source of sources) {
		const src = getFaviconSrc(source.homeUrl);
		if (!src || seenFavicons.has(src)) {
			continue;
		}
		seenFavicons.add(src);
		logos.push(source);
		if (logos.length >= limit) {
			break;
		}
	}

	if (logos.length === 0) {
		return null;
	}

	const remaining = Math.max(0, sources.length - logos.length);
	const isSmall = size === "sm";
	const imageSize = isSmall ? 20 : 24;

	return (
		<div
			aria-label={`${sources.length} sources`}
			className={cn("flex shrink-0 items-center", className)}
			role="img"
		>
			{logos.map((source) => (
				<SourceFavicon
					className={cn(
						"rounded-full border border-[var(--surface-sidebar)] bg-[var(--surface-card)] object-cover shadow-sm first:ml-0",
						isSmall ? "-ml-1.5 size-5" : "-ml-2 size-6"
					)}
					homeUrl={source.homeUrl}
					key={source.id}
					size={imageSize}
					title={source.label}
				/>
			))}
			{showRemaining && remaining > 0 ? (
				<span
					className={cn(
						"inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--surface-sidebar)] bg-[var(--surface-card)] font-mono text-[var(--text-secondary)] tabular-nums shadow-sm",
						isSmall ? "-ml-1.5 size-5 text-[9px]" : "-ml-2 size-6 text-[10px]"
					)}
				>
					+{remaining}
				</span>
			) : null}
		</div>
	);
}
