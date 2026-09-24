import type { TrendsPageData } from "../types";

// A topic page carries every item's original text so a translated title can
// be checked against it. The original description is only ever shown in a
// tooltip, and it is a third of the download, so list responses leave it
// out; the single-source endpoint keeps the full item.
export function slimTrendsPage(page: TrendsPageData): TrendsPageData {
	return {
		...page,
		sections: page.sections.map((section) => ({
			...section,
			sources: section.sources.map((source) => ({
				...source,
				items: source.items.map((item) =>
					item.original?.description === undefined
						? item
						: { ...item, original: { title: item.original.title } }
				),
			})),
		})),
	};
}
