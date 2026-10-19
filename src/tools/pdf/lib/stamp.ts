/**
 * Geometry Fill & Sign's page overlay and its stamping (ops/form.ts) share,
 * kept free of pdf-lib so the screen can draw items exactly as they will be
 * written.
 */

/** A checkmark in a CHECK_BOX × CHECK_BOX square, y down (SVG). */
export const CHECK_PATH = 'M3.5 12.5 L9 18 L20.5 5.5 L18.3 3.6 L8.9 13.8 L5.6 10.4 Z'
export const CHECK_BOX = 24

/** A text stamp's first baseline sits this many font sizes below the top of its box. */
export const TEXT_ASCENT = 0.9
/** Lines of a text stamp are this many font sizes apart. */
export const TEXT_LINE_HEIGHT = 1.2
/** Metric-compatible with the Helvetica the PDF is written in, for measuring and the overlay. */
export const TEXT_FONT_STACK = "Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', sans-serif"
