// Source cards have a fixed viewport, but their full queue is part of the first
// page response. CSS decides how many rows fit; the data layer must not paint a
// short preview and replace it after hydration because that creates a visible
// layout/content jump and one request per card.
export const TRENDS_FULL_ITEMS_PER_SOURCE = 30;

// Render two desktop rows initially. Later rows are appended as the reader
// approaches them, so SSR and hydration never build every topic card at once.
export const SOURCE_RENDER_BATCH_SIZE = 8;
