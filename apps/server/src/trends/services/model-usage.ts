import { db } from "@opentrends/db";
import { sql } from "drizzle-orm";

let pendingWrites = 0;
const modelNamePattern = /^[\w./:-]{1,128}$/;

function counter(value: unknown): number | null {
	return typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= 2_147_483_647
		? value
		: null;
}

export function embeddingUsage(value: unknown): number | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	return counter((value as { prompt_tokens?: unknown }).prompt_tokens);
}

/** Counters only. A slow/unavailable ledger cannot fail embedding generation. */
export async function recordEmbeddingUsage(
	id: string,
	model: string,
	started: string,
	usage: unknown,
	outcome: "ok" | "error"
): Promise<void> {
	if (pendingWrites >= 4) {
		return;
	}
	const input = embeddingUsage(usage);
	const safeModel = modelNamePattern.test(model) ? model : "unknown";
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		pendingWrites++;
		const write = Promise.resolve().then(() =>
			db.run(sql`INSERT INTO dc_model_usage (id, product, model, operation, occurred_at, input_tokens, output_tokens, cached_tokens, outcome)
			VALUES (${id}, 'opentrends', ${safeModel}, 'embedding', ${started}, ${input}, 0, 0, ${outcome}) ON CONFLICT (id) DO NOTHING`)
		);
		const boundedWrite = write.finally(() => {
			pendingWrites--;
		});
		await Promise.race([
			boundedWrite,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, 1000);
			}),
		]);
	} catch {
		/* Do not log the provider response, content, or database error. */
	} finally {
		clearTimeout(timer);
	}
}
