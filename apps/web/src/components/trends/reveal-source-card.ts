const HIGHLIGHT_CLASS = "source-card-revealed";
const HIGHLIGHT_MS = 2400;

export function sourceCardElementId(sourceId: string): string {
	return `source-${sourceId}`;
}

// Scrolls a source card into the middle of the viewport and flashes it, so a
// reader arriving from search sees which card they were sent to. Returns
// false when the card is not on the page yet.
export function revealSourceCard(sourceId: string): boolean {
	const card = document.getElementById(sourceCardElementId(sourceId));
	if (!card) {
		return false;
	}
	card.scrollIntoView({ behavior: "smooth", block: "center" });
	card.classList.add(HIGHLIGHT_CLASS);
	window.setTimeout(() => card.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
	return true;
}
