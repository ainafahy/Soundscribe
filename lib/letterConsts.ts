/** Mirrors consts.py from the original Cantwell project (A4 @ 300 DPI). */
export const DPI = 300;
export const PAGE_W = 2480; // A4 width in px at 300 DPI
export const PAGE_H = 3508; // A4 height in px at 300 DPI
export const SAMPLE_CONST = 200000; // samples per full-width row in Python
export const MARGIN = 150; // int(DPI * 0.5) — one row of vertical step

/** Horizontal offsets (px at 300 DPI) for each field type. */
export const ADDR_OFF = 1800; // addresses sit right-aligned on the page
export const DEAR_OFF = 200;
export const ROWS_OFF = 200;
