// A 480px source card displays roughly seven compact rows. Keep one extra row
// for responsive layouts, then fetch the full source only when it is expanded.
export const TRENDS_PREVIEW_ITEMS_PER_SOURCE = 8;
export const TRENDS_FULL_ITEMS_PER_SOURCE = 30;

// Render two desktop rows initially. Later rows are appended as the reader
// approaches them, so SSR and hydration never build every topic card at once.
export const SOURCE_RENDER_BATCH_SIZE = 8;
