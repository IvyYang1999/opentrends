import { env } from "@opentrends/env/server";
import { recordEmbeddingUsage } from "./model-usage";

const SILICONFLOW_EMBEDDINGS_URL = "https://api.siliconflow.cn/v1/embeddings";
const SILICONFLOW_EMBEDDING_BATCH_SIZE = 8;
const EMBEDDING_INPUT_MAX_CHARS = 4200;

export interface EventEmbeddingInput {
	contentText?: string | null;
	description?: string | null;
	publishedAt?: Date | null;
	sourceName: string;
	title: string;
}

interface SiliconFlowEmbeddingResponse {
	data?: Array<{
		embedding?: number[];
		index?: number;
	}>;
	usage?: unknown;
}

export class EventEmbeddingNotConfiguredError extends Error {
	constructor() {
		super("SiliconFlow embedding is not configured.");
		this.name = "EventEmbeddingNotConfiguredError";
	}
}

export function assertEventEmbeddingConfigured(): void {
	if (!env.SILICONFLOW_API_KEY) {
		throw new EventEmbeddingNotConfiguredError();
	}
}

export function hashText(value: string): string {
	let hash = 0x81_1c_9d_c5;
	for (let i = 0; i < value.length; i += 1) {
		// biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash step uses XOR by design.
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01_00_01_93);
	}
	// biome-ignore lint/suspicious/noBitwiseOperators: convert to unsigned 32-bit hash.
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getEventEmbeddingModel(): string {
	return env.SILICONFLOW_EMBEDDING_MODEL;
}

export function buildCanonicalEmbeddingText(
	input: EventEmbeddingInput
): string {
	const parts = [
		input.title,
		input.description ?? "",
		(input.contentText ?? "").slice(0, EMBEDDING_INPUT_MAX_CHARS),
		`Source: ${input.sourceName}`,
		input.publishedAt
			? `Published: ${input.publishedAt.toISOString().slice(0, 10)}`
			: "",
	];
	return parts
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n\n");
}

async function embedTextBatch(texts: string[]): Promise<number[][]> {
	const usageId = crypto.randomUUID();
	const started = new Date().toISOString();
	let usage: unknown = null;
	let outcome: "ok" | "error" = "error";
	try {
		const response = await fetch(SILICONFLOW_EMBEDDINGS_URL, {
			body: JSON.stringify({
				input: texts,
				model: env.SILICONFLOW_EMBEDDING_MODEL,
				truncate: "right",
				user: "opentrends-event-feed",
			}),
			headers: {
				Authorization: `Bearer ${env.SILICONFLOW_API_KEY}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		if (!response.ok) {
			throw new Error(`SiliconFlow embedding failed (${response.status})`);
		}
		const payload = (await response.json()) as SiliconFlowEmbeddingResponse;
		usage = payload.usage;
		outcome = "ok";
		const vectors = new Array<number[]>(texts.length);
		for (const item of payload.data ?? []) {
			if (typeof item.index === "number" && item.embedding) {
				vectors[item.index] = item.embedding;
			}
		}
		return texts.map((_, index) => {
			const vector = vectors[index];
			if (!vector) {
				throw new Error(
					`SiliconFlow embedding response missing vector at index ${index}`
				);
			}
			return vector;
		});
	} finally {
		await recordEmbeddingUsage(
			usageId,
			env.SILICONFLOW_EMBEDDING_MODEL,
			started,
			usage,
			outcome
		);
	}
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) {
		return [];
	}
	assertEventEmbeddingConfigured();

	const vectors: number[][] = [];
	for (
		let index = 0;
		index < texts.length;
		index += SILICONFLOW_EMBEDDING_BATCH_SIZE
	) {
		vectors.push(
			...(await embedTextBatch(
				texts.slice(index, index + SILICONFLOW_EMBEDDING_BATCH_SIZE)
			))
		);
	}
	return vectors;
}
