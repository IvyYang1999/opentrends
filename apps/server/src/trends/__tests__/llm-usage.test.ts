import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type AppDatabase, runWithDbClient } from "@opentrends/db";
import { generateText, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
	isSiliconFlow,
	llmCounters,
	trackSiliconFlowModel,
} from "../services/llm-usage";

const usage = {
	inputTokens: { total: 20, noCache: 15, cacheRead: 5, cacheWrite: 0 },
	outputTokens: { total: 3, text: 3, reasoning: 0 },
};
const migration = readFileSync(
	new URL(
		"../../../../../packages/db/src/d1-migrations/0001_dc_model_usage.sql",
		import.meta.url
	),
	"utf8"
);
const options = { prompt: [] };

async function withDatabase(run: (db: Database) => Promise<void>) {
	const db = new Database(":memory:");
	db.exec(migration);
	try {
		await runWithDbClient(drizzle(db) as unknown as AppDatabase, () => run(db));
	} finally {
		db.close();
	}
}

test("SDK generation records each attempt without recording prompt or output", async () => {
	await withDatabase(async (db) => {
		const model = trackSiliconFlowModel(
			new MockLanguageModelV3({
				modelId: "test/model",
				doGenerate: async () => ({
					content: [{ type: "text", text: "private output" }],
					finishReason: { unified: "stop", raw: "stop" },
					usage,
					warnings: [],
				}),
			}),
			"translation",
			"https://api.siliconflow.cn/v1"
		);
		for (let i = 0; i < 2; i++) {
			const result = await generateText({ model, prompt: "private prompt" });
			expect(result.text).toBe("private output");
		}
		const rows = db.query("SELECT * FROM dc_model_usage").all();
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			operation: "translation",
			input_tokens: 20,
			output_tokens: 3,
			cached_tokens: 5,
			outcome: "ok",
		});
		expect(JSON.stringify(rows)).not.toContain("private");
	});
});

test("stream finish and close create only one usage row", async () => {
	await withDatabase(async (db) => {
		const model = trackSiliconFlowModel(
			new MockLanguageModelV3({
				doStream: async () => ({
					stream: new ReadableStream({
						start(c) {
							c.enqueue({
								type: "finish",
								finishReason: { unified: "stop", raw: "stop" },
								usage,
							});
							c.close();
						},
					}),
				}),
			}),
			"summary",
			"https://api.siliconflow.cn/v1"
		);
		const result = await model.doStream(options);
		const reader = result.stream.getReader();
		expect((await reader.read()).value?.type).toBe("finish");
		expect((await reader.read()).done).toBe(true);
		expect(
			db
				.query(
					"SELECT input_tokens, output_tokens, outcome FROM dc_model_usage"
				)
				.all()
		).toEqual([{ input_tokens: 20, output_tokens: 3, outcome: "ok" }]);
	});
});

test("stream cancellation keeps unknown usage and provider cancellation", async () => {
	await withDatabase(async (db) => {
		let cancelled = false;
		const model = trackSiliconFlowModel(
			new MockLanguageModelV3({
				doStream: async () => ({
					stream: new ReadableStream({
						cancel() {
							cancelled = true;
						},
					}),
				}),
			}),
			"summary",
			"https://api.siliconflow.cn/v1"
		);
		const result = await model.doStream(options);
		await result.stream.cancel();
		expect(cancelled).toBe(true);
		expect(
			db
				.query(
					"SELECT input_tokens, output_tokens, outcome FROM dc_model_usage"
				)
				.get()
		).toEqual({ input_tokens: null, output_tokens: null, outcome: "error" });
	});
});

test("another provider is not counted toward SiliconFlow", () => {
	const model = new MockLanguageModelV3();
	expect(
		trackSiliconFlowModel(model, "summary", "https://example.com/v1")
	).toBe(model);
});

test("provider errors propagate and are recorded without error contents", async () => {
	await withDatabase(async (db) => {
		const model = trackSiliconFlowModel(
			new MockLanguageModelV3({
				doGenerate: () => Promise.reject(new Error("private failure")),
			}),
			"translation",
			"https://api.siliconflow.cn/v1"
		);
		await expect(model.doGenerate(options)).rejects.toThrow("private failure");
		const rows = db.query("SELECT * FROM dc_model_usage").all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ outcome: "error", input_tokens: null });
		expect(JSON.stringify(rows)).not.toContain("private");
	});
});

test("raw provider omissions stay unknown despite SDK zero defaults", () => {
	expect(llmCounters({ ...usage, raw: { prompt_tokens: 7 } })).toEqual({
		input: 7,
		output: null,
		cached: null,
	});
	expect(
		llmCounters({
			...usage,
			raw: {
				prompt_tokens: 7,
				completion_tokens: 0,
				prompt_tokens_details: { cached_tokens: 9 },
			},
		})
	).toEqual({ input: 7, output: 0, cached: null });
});

test("OpenAI-compatible stream requests usage and persists real wire counters", async () => {
	await withDatabase(async (db) => {
		let requestBody: Record<string, unknown> = {};
		const baseURL = "https://api.siliconflow.cn/v1";
		const provider = createOpenAICompatible({
			name: "llm",
			baseURL,
			apiKey: "fixture",
			includeUsage: isSiliconFlow(baseURL),
			fetch: (_url, init) => {
				requestBody = JSON.parse(String(init?.body));
				const frames = [
					{
						choices: [
							{ index: 0, delta: { content: "answer" }, finish_reason: null },
						],
					},
					{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
					{
						choices: [],
						usage: {
							prompt_tokens: 12,
							completion_tokens: 2,
							total_tokens: 14,
							prompt_tokens_details: { cached_tokens: 4 },
						},
					},
				];
				return Promise.resolve(
					new Response(
						frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") +
							"data: [DONE]\n\n",
						{ headers: { "content-type": "text/event-stream" } }
					)
				);
			},
		});
		const result = streamText({
			model: trackSiliconFlowModel(provider("test/model"), "summary", baseURL),
			prompt: "fixture",
		});
		expect(await result.text).toBe("answer");
		expect(requestBody.stream_options).toEqual({ include_usage: true });
		expect(
			db
				.query(
					"SELECT input_tokens, output_tokens, cached_tokens, operation FROM dc_model_usage"
				)
				.all()
		).toEqual([
			{
				input_tokens: 12,
				output_tokens: 2,
				cached_tokens: 4,
				operation: "summary",
			},
		]);
	});
});
