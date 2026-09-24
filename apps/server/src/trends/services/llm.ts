import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@opentrends/env/server";
import type { LanguageModel } from "ai";
import { isSiliconFlow, trackSiliconFlowModel } from "./llm-usage";

const PROVIDER_NAME = "llm";

// Translation is high-volume and latency-bound, digests are low-volume and
// judgment-bound, so translation can be pointed at a smaller, faster model.
export function translationModelId(): string {
	return env.LLM_TRANSLATION_MODEL ?? env.LLM_MODEL;
}

export function llmModel(
	operation: "summary" | "translation",
	modelId: string = env.LLM_MODEL
): LanguageModel {
	const provider = createOpenAICompatible({
		name: PROVIDER_NAME,
		apiKey: env.LLM_API_KEY ?? "",
		baseURL: env.LLM_BASE_URL,
		includeUsage: isSiliconFlow(env.LLM_BASE_URL),
	});
	return trackSiliconFlowModel(provider(modelId), operation, env.LLM_BASE_URL);
}

// Hybrid reasoning models (Kimi, Qwen3, GLM on SiliconFlow) think before they
// answer unless told not to, which costs a digest its first-chunk timeout and
// a translation its request budget. The flag is only sent when configured
// because strict OpenAI-compatible providers reject unknown parameters.
export function llmProviderOptions():
	| Record<string, Record<string, boolean>>
	| undefined {
	if (env.LLM_ENABLE_THINKING === undefined) {
		return;
	}
	return {
		[PROVIDER_NAME]: { enable_thinking: env.LLM_ENABLE_THINKING === "true" },
	};
}
