import { defineEnv, string, url } from "void/env";

export default defineEnv({
	VITE_SERVER_URL: url(),
	VITE_SITE_URL: url().optional(),
	VITE_SUPPORTED_LOCALES: string().optional(),
});
