import { defineScheduled } from "void";

import { runTrendsRefreshTick } from "../src/trends/services/refresh-scheduler";

export const cron = "*/5 * * * *";

export default defineScheduled(async () => {
	await runTrendsRefreshTick();
});
