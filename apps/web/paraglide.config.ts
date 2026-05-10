import type { CompilerOptions } from "@inlang/paraglide-js";

export const paraglideCompilerOptions = {
	project: "./project.inlang",
	outdir: "./src/paraglide",
	emitGitIgnore: true,
	emitTsDeclarations: true,
	isServer: "import.meta.env.SSR",
	strategy: ["url", "cookie", "preferredLanguage", "baseLocale"],
	urlPatterns: [
		{
			pattern: "/:path(.*)?",
			localized: [
				["en", "/:path(.*)?"],
				["zh", "/zh/:path(.*)?"],
				["zh-Hant", "/zh-Hant/:path(.*)?"],
				["ru", "/ru/:path(.*)?"],
				["fr-FR", "/fr-FR/:path(.*)?"],
				["es-ES", "/es-ES/:path(.*)?"],
				["de-DE", "/de-DE/:path(.*)?"],
				["pt-BR", "/pt-BR/:path(.*)?"],
			],
		},
	],
} satisfies CompilerOptions;
