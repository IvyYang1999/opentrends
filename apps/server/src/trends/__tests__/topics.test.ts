import { describe, expect, test } from "bun:test";

import { sourceNotes, sourcePresets } from "../config/sources";
import { topicPresets } from "../config/topics";

describe("topicPresets", () => {
	test("every section's source IDs map to a known source preset", () => {
		for (const [topicId, topic] of Object.entries(topicPresets)) {
			for (const section of topic.sections) {
				for (const sourceId of section.sourceIds) {
					expect(
						(sourcePresets as Record<string, unknown>)[sourceId],
						`topic ${topicId} references missing source ${sourceId}`
					).toBeDefined();
				}
			}
		}
	});

	test("every source preset has a simple note", () => {
		expect(Object.keys(sourceNotes).sort()).toEqual(
			Object.keys(sourcePresets).sort()
		);

		for (const [sourceId, note] of Object.entries(sourceNotes)) {
			expect(note.trim(), `${sourceId} note should not be empty`).toBe(note);
			expect(note.length, `${sourceId} note should stay concise`).toBeLessThan(
				120
			);
		}
	});
});
