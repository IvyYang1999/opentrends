import { cn } from "@opentrends/ui/lib/utils";
import { ImageOff } from "lucide-react";
import type { ImgHTMLAttributes } from "react";
import { useState } from "react";

interface CoverImageProps
	extends Omit<
		ImgHTMLAttributes<HTMLImageElement>,
		"alt" | "height" | "width"
	> {
	alt: string;
	height: number;
	placeholderClassName?: string;
	width: number;
}

export function CoverImage({
	alt,
	className,
	height,
	placeholderClassName,
	src,
	width,
	...props
}: CoverImageProps) {
	const [failedSrc, setFailedSrc] = useState<string | undefined>();
	const normalizedSrc = typeof src === "string" ? src : undefined;

	if (normalizedSrc && failedSrc === normalizedSrc) {
		return (
			<span
				aria-hidden
				className={cn(
					"inline-flex items-center justify-center text-[var(--text-muted)]",
					className,
					placeholderClassName
				)}
			>
				<ImageOff className="size-4 opacity-50" />
			</span>
		);
	}

	return (
		// The error listener replaces a failed decorative cover; it is not a user interaction.
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: see explanation above
		<img
			{...props}
			alt={alt}
			className={className}
			height={height}
			onError={() => setFailedSrc(normalizedSrc)}
			src={src}
			width={width}
		/>
	);
}
