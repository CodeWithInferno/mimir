// Text metrics. Layout needs the size of a string before anything is drawn. In a browser the 2D backend installs
// a real measurer (canvas); without a DOM (unit tests, pure checks) a per-character estimate is used.
import { closeConfigGroup, liveConfig } from './config.ts'

/** manim font_size → em in frame units: at size 144 the digit "0" is 1 unit tall (measured on manim's default text). */
export const emOf = (size: number): number => size / 99
/**
 * The type scale: named sizes accepted wherever a text size is (`size: 'title'`), in manim font-size units (see emOf).
 * Read through the config store: 'text.size.title' and so on.
 */
export const TEXT_SIZES: Record<string, number> = liveConfig('text.size', {
  /** one line that owns the frame */
  hero: 90,
  /** the title of a scene */
  title: 72,
  /** a section heading */
  section: 60,
  /** running text: the size of a text that names none */
  body: 48,
  /** a name beside a part */
  label: 36,
  /** a remark, an axis label */
  note: 24,
  /** the smallest size that still reads at 720p */
  tiny: 16,
}, { min: 1 })
closeConfigGroup('text')
export const FONT_SERIF = '"CMU Serif", "Latin Modern Roman", "STIX Two Text", "Times New Roman", Times, serif'
export const FONT_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif'
export const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

export interface TextMetrics { /** em units */ width: number; ascent: number; descent: number }
export type Measurer = (text: string, weight: string | number, font: string) => TextMetrics

const NARROW = new Set([...'iljtfr.,:;|!\'`()[]{} '])
const WIDE = new Set([...'mwMWGOQD@%'])
/** Estimate for a serif face, em units. Within a few percent for labels; the browser measurer replaces it. */
export const estimate: Measurer = (text) => {
  let w = 0
  for (const ch of text) {
    if (NARROW.has(ch)) w += 0.3
    else if (WIDE.has(ch)) w += 0.82
    else if (ch >= 'A' && ch <= 'Z') w += 0.68
    else if (ch >= '0' && ch <= '9') w += 0.5
    else if (ch.charCodeAt(0) > 0x2e80) w += 1
    else w += 0.47
  }
  return { width: w, ascent: 0.69, descent: 0.2 }
}
let measurer: Measurer = estimate
/** Installed by the 2D backend when a canvas is available. */
export function setMeasurer(m: Measurer | null): void { measurer = m ?? estimate }
/** Size of one line of text in em units. */
export const measure: Measurer = (text, weight, font) => measurer(text, weight, font)
