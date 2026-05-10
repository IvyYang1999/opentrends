import type { Translator } from "@/lib/i18n";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(
	timestamp: number | undefined,
	t: Translator,
	now: number = Date.now()
): string {
	if (!timestamp) {
		return "";
	}
	const diff = now - timestamp;
	if (diff < MINUTE) {
		return t("relTime.justNow");
	}
	if (diff < HOUR) {
		const m = Math.floor(diff / MINUTE);
		return t("relTime.mAgo", { m });
	}
	if (diff < DAY) {
		const h = Math.floor(diff / HOUR);
		return t("relTime.hAgo", { h });
	}
	if (diff < 30 * DAY) {
		const d = Math.floor(diff / DAY);
		return t("relTime.dAgo", { d });
	}
	return new Date(timestamp).toISOString().slice(0, 10);
}
