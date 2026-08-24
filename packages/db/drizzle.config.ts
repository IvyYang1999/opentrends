import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/schema",
	out: "./src/d1-migrations",
	dialect: "sqlite",
});
