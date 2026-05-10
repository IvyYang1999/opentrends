import type { SourceAdapter, SourcePreset } from "../types";
import { nativeAdapters } from "./native";
import { createRssAdapter } from "./rss";
import { createRssHubAdapter } from "./rsshub";

export function getAdapterForPreset(preset: SourcePreset): SourceAdapter {
	if (preset.provider === "native") {
		const adapter = nativeAdapters[preset.adapter];
		if (!adapter) {
			throw new Error(`Unknown native adapter: ${preset.adapter}`);
		}
		return adapter;
	}
	if (preset.provider === "rsshub") {
		return createRssHubAdapter(preset);
	}
	if (preset.provider === "rss") {
		return createRssAdapter(preset);
	}
	throw new Error("Unknown source provider");
}
