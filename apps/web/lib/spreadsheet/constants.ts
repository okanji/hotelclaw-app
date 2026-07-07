/** Spreadsheet UI / model constants. */

/** Starting grid for a brand-new sheet. */
export const INITIAL_COLUMNS = 26;
export const INITIAL_ROWS = 50;

/** Zoom configuration. Steps below match Google Sheets's zoom buttons. */
export const ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

/** Defaults + clamps for column width (in CSS pixels). */
export const COLUMN_DEFAULT_WIDTH = 120;
export const COLUMN_MIN_WIDTH = 60;
export const COLUMN_MAX_WIDTH = 400;

/** Defaults + clamps for row height. */
export const ROW_DEFAULT_HEIGHT = 32;
export const ROW_MIN_HEIGHT = 24;
export const ROW_MAX_HEIGHT = 200;

/** Fixed dimensions for the row/column header cells. */
export const COLUMN_HEADER_HEIGHT = 28;
export const ROW_HEADER_WIDTH = 56;

/** Length of every column/row id. Short to keep cell ids compact in storage. */
export const ID_LENGTH = 8;
