import { db, schema } from "@opentrends/db";
import { and, eq, or } from "drizzle-orm";

import type { SourceId } from "../types";

const { sourceItem } = schema;
const CONTENT_FETCH_TIMEOUT_MS = 12_000;
const MIN_CONTENT_TEXT_LENGTH = 280;
const MAX_CONTENT_TEXT_LENGTH = 12_000;

export interface EventSourceItemRef {
	itemId: string;
	sourceId: SourceId;
}

interface ContentExtractionResult {
	error?: string;
	status: "failed" | "ok" | "restricted" | "too_short";
	text?: string;
}

function buildItemPredicates(items: readonly EventSourceItemRef[]) {
	return items.map((item) =>
		and(
			eq(sourceItem.sourceId, item.sourceId),
			eq(sourceItem.itemId, item.itemId)
		)
	);
}

function getFallbackText(row: {
	description: string | null;
	title: string;
}): string {
	return [row.title, row.description ?? ""].filter(Boolean).join("\n\n");
}

async function fetchHtml(url: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		CONTENT_FETCH_TIMEOUT_MS
	);
	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent":
					"OpenTrendsBot/1.0 (+https://opentrends.x-cmd.com; event aggregation)",
			},
			signal: controller.signal,
		});
		if (response.status === 401 || response.status === 403) {
			throw new Error("restricted");
		}
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return await response.text();
	} finally {
		clearTimeout(timeout);
	}
}

async function extractContentText(
	url: string
): Promise<ContentExtractionResult> {
	try {
		const html = await fetchHtml(url);
		const [{ Defuddle }, { JSDOM }] = await Promise.all([
			import("defuddle/node"),
			import("jsdom"),
		]);
		const dom = new JSDOM(html, { url });
		const result = await Defuddle(dom.window.document, url, {
			markdown: true,
			useAsync: false,
		});
		const text = String(result.contentMarkdown ?? result.content ?? "")
			.replace(/\s+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		if (text.length < MIN_CONTENT_TEXT_LENGTH) {
			return {
				status: "too_short",
				text: text.slice(0, MAX_CONTENT_TEXT_LENGTH),
			};
		}
		return {
			status: "ok",
			text: text.slice(0, MAX_CONTENT_TEXT_LENGTH),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: message === "restricted" ? "restricted" : "failed",
			error: message,
		};
	}
}

export async function enrichEventSourceItems(
	items: readonly EventSourceItemRef[]
): Promise<void> {
	if (items.length === 0) {
		return;
	}
	const predicates = buildItemPredicates(items);
	const rows = await db
		.select({
			sourceId: sourceItem.sourceId,
			itemId: sourceItem.itemId,
			url: sourceItem.url,
			title: sourceItem.title,
			description: sourceItem.description,
			contentFetchedAt: sourceItem.contentFetchedAt,
			contentStatus: sourceItem.contentStatus,
		})
		.from(sourceItem)
		.where(or(...predicates));

	for (const row of rows) {
		if (
			row.contentFetchedAt &&
			(row.contentStatus === "ok" || row.contentStatus === "too_short")
		) {
			continue;
		}
		const extracted = await extractContentText(row.url);
		const fallback = getFallbackText(row);
		const text =
			extracted.text && extracted.text.length >= MIN_CONTENT_TEXT_LENGTH
				? extracted.text
				: fallback;
		await db
			.update(sourceItem)
			.set({
				contentText: text,
				contentFetchedAt: new Date(),
				contentStatus: extracted.status,
				contentError: extracted.error ?? null,
			})
			.where(
				and(
					eq(sourceItem.sourceId, row.sourceId),
					eq(sourceItem.itemId, row.itemId)
				)
			);
	}
}
