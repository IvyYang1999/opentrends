import qrcode from "qrcode-generator";

export interface DigestEntry {
	reason?: string;
	takeaway: string;
}

export interface ShareImageInput {
	dateLabel: string;
	entries: DigestEntry[];
	heading: string;
	scanHint: string;
	slogan: string;
	topicLabel: string;
	/** Full URL encoded into the QR code. */
	url: string;
	/** Short form of the URL printed next to the QR code. */
	urlLabel: string;
}

const ENTRY_RE = /^\s*\d+[.)]\s+(.*)$/;
const CITATION_RE = /\s*\[\d+\]/g;
const BOLD_LEAD_RE = /^\*\*(.+?)\*\*\s*(?:[—–-]+\s*)?(.*)$/;
const BOLD_MARK_RE = /\*\*/g;
const TRAILING_PERIOD_RE = /[\s.。]+$/;

/** Reads the digest entries out of the summary's Markdown ordered list. */
export function parseDigest(markdown: string): DigestEntry[] {
	const entries: DigestEntry[] = [];
	for (const line of markdown.split("\n")) {
		const body = ENTRY_RE.exec(line)?.[1]?.replace(CITATION_RE, "").trim();
		if (!body) {
			continue;
		}
		const lead = BOLD_LEAD_RE.exec(body);
		if (lead?.[1]) {
			const reason = lead[2]?.replace(TRAILING_PERIOD_RE, "").trim();
			entries.push({ reason: reason || undefined, takeaway: lead[1].trim() });
		} else {
			entries.push({ takeaway: body.replace(BOLD_MARK_RE, "") });
		}
	}
	return entries;
}

// The image is laid out in CSS pixels and rendered at 2x so it stays sharp when
// shared to phones.
const SCALE = 2;
const WIDTH = 540;
const PADDING = 32;
const NUMBER_COLUMN = 30;
const TEXT_WIDTH = WIDTH - PADDING * 2 - NUMBER_COLUMN;
const HEADER_HEIGHT = 64;
const HEADING_HEIGHT = 58;
const ENTRY_GAP = 13;
const TAKEAWAY_LINE = 22;
const REASON_LINE = 19;
const FOOTER_HEIGHT = 124;
const QR_SIZE = 84;
const QR_QUIET_ZONE = 6;
const LOGO_SIZE = 22;

// CJK text wraps between any two characters; other scripts wrap between words.
const WRAP_TOKEN_RE = /[⺀-鿿　-〿＀-￯]|[^\s⺀-鿿　-〿＀-￯]+\s*|\s+/g;
const NO_LINE_START_RE = /^[，。、；：！？）】》”’,.;:!?)\]]/;

interface Theme {
	accent: string;
	accentBackground: string;
	background: string;
	border: string;
	fontFamily: string;
	footerBackground: string;
	heading: string;
	monoFamily: string;
	muted: string;
	primary: string;
	secondary: string;
}

function readTheme(): Theme {
	const root = getComputedStyle(document.documentElement);
	const token = (name: string, fallback: string) =>
		root.getPropertyValue(name).trim() || fallback;
	return {
		accent: token("--accent-blue", "#1a4edc"),
		accentBackground: token("--accent-blue-bg", "rgba(21, 93, 255, 0.09)"),
		background: token("--surface-app", "#ffffff"),
		border: token("--border-default", "#e9e9e7"),
		fontFamily: getComputedStyle(document.body).fontFamily || "sans-serif",
		footerBackground: token("--surface-sidebar", "#f4f4f2"),
		heading: token("--text-heading", "#37352f"),
		monoFamily: token("--font-mono", "ui-monospace, monospace"),
		muted: token("--text-muted", "#b4b4b4"),
		primary: token("--text-primary", "#37352f"),
		secondary: token("--text-secondary", "#787774"),
	};
}

function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number
): string[] {
	const lines: string[] = [];
	let line = "";
	for (const token of text.match(WRAP_TOKEN_RE) ?? []) {
		const candidate = line + token;
		const fits = ctx.measureText(candidate.trimEnd()).width <= maxWidth;
		if (fits || line === "" || NO_LINE_START_RE.test(token)) {
			line = candidate;
			continue;
		}
		lines.push(line.trimEnd());
		line = token.trimStart();
	}
	if (line.trim()) {
		lines.push(line.trimEnd());
	}
	return lines;
}

interface EntryLayout {
	reasonLines: string[];
	takeawayLines: string[];
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => resolve(null);
		image.src = src;
	});
}

function drawQrCode(
	ctx: CanvasRenderingContext2D,
	url: string,
	x: number,
	y: number
): void {
	const qr = qrcode(0, "M");
	qr.addData(url);
	qr.make();
	const count = qr.getModuleCount();
	const cell = (QR_SIZE - QR_QUIET_ZONE * 2) / count;
	// Scanners need dark modules on a light field, whatever the page theme is.
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.roundRect(x, y, QR_SIZE, QR_SIZE, 6);
	ctx.fill();
	ctx.fillStyle = "#111111";
	for (let row = 0; row < count; row += 1) {
		for (let col = 0; col < count; col += 1) {
			if (qr.isDark(row, col)) {
				ctx.fillRect(
					x + QR_QUIET_ZONE + col * cell,
					y + QR_QUIET_ZONE + row * cell,
					Math.ceil(cell * SCALE) / SCALE,
					Math.ceil(cell * SCALE) / SCALE
				);
			}
		}
	}
}

function drawHeader(
	ctx: CanvasRenderingContext2D,
	theme: Theme,
	input: ShareImageInput,
	logo: HTMLImageElement | null
): void {
	const baseline = 42;
	let x = PADDING;
	if (logo) {
		ctx.drawImage(logo, x, baseline - 18, LOGO_SIZE, LOGO_SIZE);
		x += LOGO_SIZE + 7;
	}
	ctx.font = `600 17px ${theme.fontFamily}`;
	ctx.fillStyle = theme.primary;
	ctx.fillText("Open", x, baseline);
	x += ctx.measureText("Open").width;
	ctx.fillStyle = theme.accent;
	ctx.fillText("Trends", x, baseline);

	ctx.font = `400 12px ${theme.fontFamily}`;
	ctx.fillStyle = theme.secondary;
	ctx.textAlign = "right";
	ctx.fillText(input.dateLabel, WIDTH - PADDING, baseline);
	ctx.textAlign = "left";

	ctx.fillStyle = theme.border;
	ctx.fillRect(0, HEADER_HEIGHT - 1, WIDTH, 1);
}

function drawHeading(
	ctx: CanvasRenderingContext2D,
	theme: Theme,
	input: ShareImageInput
): void {
	const baseline = HEADER_HEIGHT + 38;
	ctx.font = `700 24px ${theme.fontFamily}`;
	ctx.fillStyle = theme.heading;
	ctx.fillText(input.heading, PADDING, baseline);
	const headingWidth = ctx.measureText(input.heading).width;

	ctx.font = `500 13px ${theme.fontFamily}`;
	const chipWidth = ctx.measureText(input.topicLabel).width + 16;
	const chipX = PADDING + headingWidth + 10;
	ctx.fillStyle = theme.accentBackground;
	ctx.beginPath();
	ctx.roundRect(chipX, baseline - 18, chipWidth, 22, 4);
	ctx.fill();
	ctx.fillStyle = theme.accent;
	ctx.fillText(input.topicLabel, chipX + 8, baseline - 2);
}

function drawEntries(
	ctx: CanvasRenderingContext2D,
	theme: Theme,
	layouts: EntryLayout[]
): number {
	let y = HEADER_HEIGHT + HEADING_HEIGHT;
	for (const [index, layout] of layouts.entries()) {
		ctx.fillStyle = theme.border;
		ctx.fillRect(PADDING, y, WIDTH - PADDING * 2, 1);
		y += ENTRY_GAP;

		ctx.font = `400 12px ${theme.monoFamily}`;
		ctx.fillStyle = theme.muted;
		ctx.fillText(String(index + 1).padStart(2, "0"), PADDING, y + 16);

		ctx.font = `600 15px ${theme.fontFamily}`;
		ctx.fillStyle = theme.primary;
		for (const line of layout.takeawayLines) {
			ctx.fillText(line, PADDING + NUMBER_COLUMN, y + 16);
			y += TAKEAWAY_LINE;
		}
		ctx.font = `400 13px ${theme.fontFamily}`;
		ctx.fillStyle = theme.secondary;
		for (const line of layout.reasonLines) {
			ctx.fillText(line, PADDING + NUMBER_COLUMN, y + 15);
			y += REASON_LINE;
		}
		y += ENTRY_GAP;
	}
	return y;
}

function drawFooter(
	ctx: CanvasRenderingContext2D,
	theme: Theme,
	input: ShareImageInput,
	top: number
): void {
	ctx.fillStyle = theme.footerBackground;
	ctx.fillRect(0, top, WIDTH, FOOTER_HEIGHT);
	ctx.fillStyle = theme.border;
	ctx.fillRect(0, top, WIDTH, 1);

	const qrX = WIDTH - PADDING - QR_SIZE;
	const textWidth = qrX - PADDING - 16;
	ctx.font = `600 15px ${theme.fontFamily}`;
	ctx.fillStyle = theme.primary;
	let y = top + 44;
	for (const line of wrapText(ctx, input.slogan, textWidth)) {
		ctx.fillText(line, PADDING, y);
		y += TAKEAWAY_LINE;
	}
	ctx.font = `500 13px ${theme.fontFamily}`;
	ctx.fillStyle = theme.accent;
	ctx.fillText(input.urlLabel, PADDING, y + 2);
	ctx.font = `400 12px ${theme.fontFamily}`;
	ctx.fillStyle = theme.secondary;
	ctx.fillText(input.scanHint, PADDING, y + 22);

	drawQrCode(ctx, input.url, qrX, top + (FOOTER_HEIGHT - QR_SIZE) / 2);
}

function layoutEntries(
	ctx: CanvasRenderingContext2D,
	theme: Theme,
	entries: DigestEntry[]
): EntryLayout[] {
	return entries.map((entry) => {
		ctx.font = `600 15px ${theme.fontFamily}`;
		const takeawayLines = wrapText(ctx, entry.takeaway, TEXT_WIDTH);
		ctx.font = `400 13px ${theme.fontFamily}`;
		const reasonLines = entry.reason
			? wrapText(ctx, entry.reason, TEXT_WIDTH)
			: [];
		return { reasonLines, takeawayLines };
	});
}

/**
 * Draws the digest as a portrait image in the site's own colors and fonts, so
 * it follows the viewer's light or dark theme.
 */
export async function renderShareImage(input: ShareImageInput): Promise<Blob> {
	await document.fonts?.ready;
	const theme = readTheme();
	const logo = await loadImage("/logo-mark.svg");

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas is not available.");
	}
	const layouts = layoutEntries(ctx, theme, input.entries);
	const entriesHeight = layouts.reduce(
		(total, layout) =>
			total +
			ENTRY_GAP * 2 +
			layout.takeawayLines.length * TAKEAWAY_LINE +
			layout.reasonLines.length * REASON_LINE,
		0
	);
	const height = HEADER_HEIGHT + HEADING_HEIGHT + entriesHeight + FOOTER_HEIGHT;

	// Resizing resets the context, so every style is set again while drawing.
	canvas.width = WIDTH * SCALE;
	canvas.height = height * SCALE;
	ctx.scale(SCALE, SCALE);
	ctx.textBaseline = "alphabetic";
	ctx.fillStyle = theme.background;
	ctx.fillRect(0, 0, WIDTH, height);

	drawHeader(ctx, theme, input, logo);
	drawHeading(ctx, theme, input);
	const entriesBottom = drawEntries(ctx, theme, layouts);
	drawFooter(ctx, theme, input, entriesBottom);

	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error("Failed to encode the share image."));
			}
		}, "image/png");
	});
}
