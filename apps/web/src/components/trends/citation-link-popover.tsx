import {
	Popover,
	PopoverPopup,
	PopoverPortal,
	PopoverPositioner,
} from "@opentrends/ui/components/popover";
import type { PointerEventHandler } from "react";

import { SourceFavicon } from "./source-favicon";

export interface CitationMeta {
	description?: string;
	homeUrl?: string;
	sourceTitle: string;
	title: string;
}

export type CitationMetaMap = ReadonlyMap<string, CitationMeta>;

interface CitationLinkPopoverProps {
	anchor: HTMLElement;
	metadata: CitationMetaMap;
	onPointerEnter: PointerEventHandler<HTMLDivElement>;
	onPointerLeave: PointerEventHandler<HTMLDivElement>;
	url: string;
}

export function CitationLinkPopover({
	anchor,
	metadata,
	onPointerEnter,
	onPointerLeave,
	url,
}: CitationLinkPopoverProps) {
	const meta = metadata.get(url);
	const faviconHost = meta?.homeUrl ?? safeOrigin(url);

	return (
		<Popover open>
			<PopoverPortal>
				<PopoverPositioner align="center" anchor={anchor} side="top">
					<PopoverPopup
						className="w-[min(340px,92vw)] p-3"
						data-citation-popover-popup=""
						onPointerEnter={onPointerEnter}
						onPointerLeave={onPointerLeave}
					>
						<div className="mb-1.5 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
							{faviconHost ? <SourceFavicon homeUrl={faviconHost} /> : null}
							<span className="truncate">
								{meta?.sourceTitle ?? hostnameOf(url)}
							</span>
						</div>
						<div className="mb-1 whitespace-normal font-semibold text-[14px] text-[var(--text-primary)] leading-snug">
							{meta?.title ?? "External link"}
						</div>
						{meta?.description ? (
							<p className="mb-2 line-clamp-3 text-[12px] text-[var(--text-secondary)] leading-[1.5]">
								{meta.description}
							</p>
						) : null}
						<p className="break-all font-mono text-[10px] text-[var(--text-muted)]">
							{url}
						</p>
					</PopoverPopup>
				</PopoverPositioner>
			</PopoverPortal>
		</Popover>
	);
}

function safeOrigin(url: string): string | undefined {
	try {
		return new URL(url).origin;
	} catch {
		return;
	}
}

function hostnameOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}
