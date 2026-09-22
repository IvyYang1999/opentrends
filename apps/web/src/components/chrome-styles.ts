// One look for every tab-like control in the page chrome: topic tabs in the
// header, the trends/events switch, and the digest period buttons. Active
// state works for router links (data-status) and toggles (aria-pressed).
export const segmentClassName =
	"inline-flex h-7 shrink-0 items-center rounded px-2 text-[12px] text-[var(--text-secondary)] whitespace-nowrap transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] data-[status=active]:bg-[var(--accent-blue-bg)] data-[status=active]:text-[var(--accent-blue)] aria-pressed:bg-[var(--accent-blue-bg)] aria-pressed:text-[var(--accent-blue)]";

export const segmentActiveClassName =
	"bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)] hover:text-[var(--accent-blue)]";

// Small outlined tool buttons on the bar above the cards.
export const toolButtonClassName =
	"inline-flex h-7 items-center gap-1.5 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)] data-[popup-open]:bg-[var(--state-hover-subtle)] data-[popup-open]:text-[var(--text-primary)] [&>span]:hidden sm:[&>span]:inline";
