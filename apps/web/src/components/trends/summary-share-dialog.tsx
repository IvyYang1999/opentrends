import { Button } from "@opentrends/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@opentrends/ui/components/dialog";
import { Check, Copy, Download } from "lucide-react";
import { useCallback, useState } from "react";

import {
	type Locale,
	localePathParam,
	type TranslationKey,
	useLocale,
	useT,
} from "@/lib/i18n";
import { SITE_URL } from "@/lib/seo";

import type { DigestEntry } from "./share-image";

export type ShareWindow = "today" | "week" | "month";

interface SummaryShareDialogProps {
	entries: DigestEntry[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	summaryWindow: ShareWindow;
	topicId: string;
	topicTitle: string;
}

type ShareState =
	| { status: "rendering" }
	| { status: "error" }
	| { blob: Blob; status: "ready"; url: string };

const HEADING_KEYS = {
	today: "share.headingToday",
	week: "share.headingWeek",
	month: "share.headingMonth",
} as const;

// Printed under the code: the address people remember, whatever host
// served the page (a preview deployment would otherwise print its own).
const SITE_LABEL = "opentrends.io";
const COPIED_FEEDBACK_MS = 2000;

function buildShareUrl(topicId: string, locale: Locale): string {
	const origin = SITE_URL || window.location.origin;
	const localePrefix = localePathParam(locale);
	const path = `${localePrefix ? `/${localePrefix}` : ""}/trends/${encodeURIComponent(topicId)}`;
	return `${origin}${path}`;
}

function canCopyImages(): boolean {
	return (
		typeof ClipboardItem !== "undefined" &&
		typeof navigator.clipboard?.write === "function"
	);
}

export function SummaryShareDialog({
	entries,
	onOpenChange,
	open,
	summaryWindow,
	topicId,
	topicTitle,
}: SummaryShareDialogProps) {
	const locale = useLocale();
	const t = useT();
	const [state, setState] = useState<ShareState>({ status: "rendering" });
	const [copied, setCopied] = useState(false);

	const topicKey = `topic.${topicId}` as TranslationKey;
	const translatedTopic = t(topicKey);
	const topicLabel =
		translatedTopic === topicKey ? topicTitle : translatedTopic;
	const heading = t(HEADING_KEYS[summaryWindow]);
	const scanHint = t("share.scanHint");
	const slogan = t("share.slogan");

	// The preview node mounts when the dialog opens and unmounts when it closes,
	// which is exactly the lifetime of the rendered image. Only plain values are
	// dependencies, so re-renders do not restart the drawing.
	const previewRef = useCallback(
		(el: HTMLDivElement | null) => {
			if (!el) {
				return;
			}
			let cancelled = false;
			let objectUrl: string | null = null;
			setState({ status: "rendering" });

			const pageUrl = buildShareUrl(topicId, locale);
			import("./share-image")
				.then(({ renderShareImage }) =>
					renderShareImage({
						dateLabel: new Intl.DateTimeFormat(locale, {
							dateStyle: "long",
						}).format(new Date()),
						entries,
						heading,
						scanHint,
						slogan,
						topicLabel,
						url: `${pageUrl}?utm_source=share_image&utm_medium=qr`,
						urlLabel: SITE_LABEL,
					})
				)
				.then((blob) => {
					if (cancelled) {
						return;
					}
					objectUrl = URL.createObjectURL(blob);
					setState({ blob, status: "ready", url: objectUrl });
				})
				.catch(() => {
					if (!cancelled) {
						setState({ status: "error" });
					}
				});

			return () => {
				cancelled = true;
				if (objectUrl) {
					URL.revokeObjectURL(objectUrl);
				}
			};
		},
		[entries, heading, locale, scanHint, slogan, topicId, topicLabel]
	);

	const handleCopy = async () => {
		if (state.status !== "ready") {
			return;
		}
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": state.blob }),
			]);
			setCopied(true);
			window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
		} catch {
			/* Clipboard access was denied; the download button still works. */
		}
	};

	const fileName = `opentrends-${topicId}-${new Date().toISOString().slice(0, 10)}.png`;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="w-[min(420px,92vw)]">
				<DialogHeader>
					<DialogTitle>{t("share.title")}</DialogTitle>
				</DialogHeader>
				<div
					className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-sidebar)] p-3"
					ref={previewRef}
				>
					{state.status === "ready" ? (
						<img
							alt={t("share.title")}
							className="w-full border border-[var(--border-default)]"
							data-testid="share-image-preview"
							height={0}
							src={state.url}
							style={{ height: "auto" }}
							width={540}
						/>
					) : (
						<p className="py-10 text-center text-[12px] text-[var(--text-secondary)]">
							{state.status === "error"
								? t("share.failed")
								: t("summary.writing")}
						</p>
					)}
				</div>
				<div className="flex items-center justify-end gap-2 border-[var(--border-default)] border-t px-3 py-2">
					{canCopyImages() ? (
						<Button
							disabled={state.status !== "ready"}
							onClick={handleCopy}
							size="sm"
							variant="outline"
						>
							{copied ? <Check /> : <Copy />}
							{copied ? t("share.copied") : t("share.copy")}
						</Button>
					) : null}
					{state.status === "ready" ? (
						<a
							className="inline-flex h-7 items-center gap-1 bg-[var(--accent-blue)] px-2.5 text-[12px] text-white transition-colors hover:bg-[var(--accent-blue-hover)] [&_svg]:size-3.5"
							download={fileName}
							href={state.url}
						>
							<Download />
							{t("share.download")}
						</a>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
