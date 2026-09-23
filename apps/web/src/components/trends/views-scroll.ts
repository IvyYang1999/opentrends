import { createContext, useContext } from "react";

// The scrolling element the topic views share. The layout that owns the
// digest bar also owns the scroll container, so a view that virtualises
// its list (events) asks here instead of scrolling on its own.
export const ViewsScrollContext = createContext<{
	current: HTMLDivElement | null;
} | null>(null);

export function useViewsScrollElement(): (() => HTMLDivElement | null) | null {
	const ref = useContext(ViewsScrollContext);
	return ref ? () => ref.current : null;
}
