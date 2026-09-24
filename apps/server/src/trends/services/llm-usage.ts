import { wrapLanguageModel } from "ai";
import { recordModelUsage, usageCounter } from "./model-usage";

type Model = Parameters<typeof wrapLanguageModel>[0]["model"];
type Usage = Awaited<ReturnType<Model["doGenerate"]>>["usage"];
type Operation = "summary" | "translation";

export function isSiliconFlow(baseUrl: string): boolean {
	const host = new URL(baseUrl).hostname;
	return host === "api.siliconflow.cn" || host === "api.siliconflow.com";
}

export function llmCounters(usage: Usage | undefined) {
	const raw = usage?.raw;
	const hasRaw = raw !== undefined && raw !== null;
	const fields =
		hasRaw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const details = fields.prompt_tokens_details;
	const input = usageCounter(
		hasRaw ? fields.prompt_tokens : usage?.inputTokens.total
	);
	const output = usageCounter(
		hasRaw ? fields.completion_tokens : usage?.outputTokens.total
	);
	const rawCached =
		details && typeof details === "object" && !Array.isArray(details)
			? details.cached_tokens
			: undefined;
	const cached = usageCounter(
		hasRaw ? rawCached : usage?.inputTokens.cacheRead
	);
	return {
		input,
		output,
		cached: input !== null && cached !== null && cached > input ? null : cached,
	};
}

function attempt(model: string, operation: Operation) {
	const id = crypto.randomUUID();
	const started = new Date().toISOString();
	let recorded = false;
	return async (usage: Usage | undefined, outcome: "ok" | "error") => {
		if (recorded) {
			return;
		}
		recorded = true;
		await recordModelUsage(
			id,
			model,
			operation,
			started,
			llmCounters(usage),
			outcome
		);
	};
}

/** Observe provider attempts, including SDK retries. Never inspect or persist content. */
export function trackSiliconFlowModel(
	model: Model,
	operation: Operation,
	baseUrl: string
): Model {
	if (!isSiliconFlow(baseUrl)) {
		return model;
	}
	return wrapLanguageModel({
		model,
		middleware: {
			specificationVersion: "v3",
			async wrapGenerate({ doGenerate }) {
				const record = attempt(model.modelId, operation);
				try {
					const result = await doGenerate();
					await record(
						result.usage,
						result.finishReason.unified === "error" ? "error" : "ok"
					);
					return result;
				} catch (error) {
					await record(undefined, "error");
					throw error;
				}
			},
			async wrapStream({ doStream }) {
				const record = attempt(model.modelId, operation);
				try {
					const result = await doStream();
					const reader = result.stream.getReader();
					let usage: Usage | undefined;
					let finished = false;
					let failed = false;
					return {
						...result,
						stream: new ReadableStream({
							async pull(controller) {
								try {
									const next = await reader.read();
									if (next.done) {
										await record(usage, finished && !failed ? "ok" : "error");
										controller.close();
										return;
									}
									if (next.value.type === "finish") {
										usage = next.value.usage;
										finished = true;
										failed ||= next.value.finishReason.unified === "error";
									} else if (next.value.type === "error") {
										failed = true;
									}
									controller.enqueue(next.value);
								} catch (error) {
									await record(usage, "error");
									controller.error(error);
								}
							},
							async cancel(reason) {
								try {
									await reader.cancel(reason);
								} finally {
									await record(usage, finished && !failed ? "ok" : "error");
								}
							},
						}),
					};
				} catch (error) {
					await record(undefined, "error");
					throw error;
				}
			},
		},
	});
}
