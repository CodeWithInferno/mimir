// Colours: palette tokens (ManimGL values), parsing, squared-RGB mixing, ramps, material presets.
import { ctx } from './context.ts'

export type Color = string
export type RGBA = [number, number, number, number] // 0..1 each

/** Every palette token (the values of ManimGL's palette). The bare name is the _C shade. */
export const PALETTE = {
  BLUE: '#58C4DD', BLUE_A: '#C7E9F1', BLUE_B: '#9CDCEB', BLUE_C: '#58C4DD', BLUE_D: '#29ABCA', BLUE_E: '#1C758A',
  TEAL: '#5CD0B3', TEAL_A: '#ACEAD7', TEAL_B: '#76DDC0', TEAL_C: '#5CD0B3', TEAL_D: '#55C1A7', TEAL_E: '#49A88F',
  GREEN: '#83C167', GREEN_A: '#C9E2AE', GREEN_B: '#A6CF8C', GREEN_C: '#83C167', GREEN_D: '#77B05D', GREEN_E: '#699C52',
  YELLOW: '#FFFF00', YELLOW_A: '#FFF1B6', YELLOW_B: '#FFEA94', YELLOW_C: '#FFFF00', YELLOW_D: '#F4D345', YELLOW_E: '#E8C11C',
  GOLD: '#F0AC5F', GOLD_A: '#F7C797', GOLD_B: '#F9B775', GOLD_C: '#F0AC5F', GOLD_D: '#E1A158', GOLD_E: '#C78D46',
  RED: '#FC6255', RED_A: '#F7A1A3', RED_B: '#FF8080', RED_C: '#FC6255', RED_D: '#E65A4C', RED_E: '#CF5044',
  MAROON: '#C55F73', MAROON_A: '#ECABC1', MAROON_B: '#EC92AB', MAROON_C: '#C55F73', MAROON_D: '#A24D61', MAROON_E: '#94424F',
  PURPLE: '#9A72AC', PURPLE_A: '#CAA3E8', PURPLE_B: '#B189C6', PURPLE_C: '#9A72AC', PURPLE_D: '#715582', PURPLE_E: '#644172',
  GREY: '#888888', GREY_A: '#DDDDDD', GREY_B: '#BBBBBB', GREY_C: '#888888', GREY_D: '#444444', GREY_E: '#222222',
  WHITE: '#FFFFFF', BLACK: '#000000', PINK: '#D147BD', LIGHT_PINK: '#DC75CD', ORANGE: '#FF862F',
} as const satisfies Record<string, Color>
const TOKENS: Record<string, Color> = PALETTE

/** Plain-language names an author may type; they resolve to palette values, never to raw CSS primaries. */
const NAMED: Record<string, Color> = {
  white: '#FFFFFF', black: '#000000', red: PALETTE.RED, green: PALETTE.GREEN, blue: PALETTE.BLUE, yellow: PALETTE.YELLOW,
  teal: PALETTE.TEAL, gold: PALETTE.GOLD, maroon: PALETTE.MAROON, purple: PALETTE.PURPLE, pink: PALETTE.PINK,
  orange: PALETTE.ORANGE, grey: PALETTE.GREY, gray: PALETTE.GREY, none: '#00000000', transparent: '#00000000',
}

const cache = new Map<string, RGBA | null>()
/** '#rgb' | '#rrggbb' | '#rrggbbaa' | 'rgb(r,g,b)' | 'rgba(r,g,b,a)' | palette token | plain name → RGBA, or null. */
export function parseColor(c: unknown): RGBA | null {
  if (typeof c !== 'string') return null
  const hit = cache.get(c)
  if (hit !== undefined) return hit
  let out: RGBA | null = null
  const s = c.trim()
  const named = TOKENS[s] ?? TOKENS[s.toUpperCase()] ?? NAMED[s.toLowerCase()]
  const h = named ?? s
  let m: RegExpMatchArray | null
  if ((m = h.match(/^#([0-9a-f]{3,8})$/i))) {
    const x = m[1]!
    if (x.length === 3 || x.length === 4) {
      const n = [...x].map((ch) => parseInt(ch + ch, 16) / 255)
      out = [n[0]!, n[1]!, n[2]!, n[3] ?? 1]
    } else if (x.length === 6 || x.length === 8) {
      const n = [0, 2, 4, 6].filter((i) => i < x.length).map((i) => parseInt(x.slice(i, i + 2), 16) / 255)
      out = [n[0]!, n[1]!, n[2]!, n[3] ?? 1]
    }
  } else if ((m = h.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i))) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    out = [parseFloat(m[1]!) / 255, parseFloat(m[2]!) / 255, parseFloat(m[3]!) / 255, a]
  }
  if (out && !out.every(Number.isFinite)) out = null
  cache.set(c, out)
  return out
}
export const isColor = (c: unknown): boolean => parseColor(c) !== null

const hex2 = (x: number): string => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')
export function toHex(c: RGBA | Color, withAlpha = false): string {
  const v = typeof c === 'string' ? parseColor(c) ?? [1, 0, 1, 1] : c
  return '#' + hex2(v[0]) + hex2(v[1]) + hex2(v[2]) + (withAlpha && v[3] < 1 ? hex2(v[3]) : '')
}
/** 0xRRGGBB number (for three.js). */
export function toInt(c: Color): number {
  const v = parseColor(c) ?? [1, 0, 1, 1]
  return (Math.round(v[0] * 255) << 16) | (Math.round(v[1] * 255) << 8) | Math.round(v[2] * 255)
}
export const alphaOf = (c: Color): number => (parseColor(c) ?? [0, 0, 0, 1])[3]

/** Blend two colours in squared RGB (manim's interpolate_color): mix(BLUE, RED, 0.5). */
export function mix(c1: Color, c2: Color, u: number): Color {
  const a = parseColor(c1) ?? [1, 0, 1, 1], b = parseColor(c2) ?? [1, 0, 1, 1]
  const t = u < 0 ? 0 : u > 1 ? 1 : Number.isFinite(u) ? u : 0
  const ch = (i: 0 | 1 | 2): number => Math.sqrt(a[i] * a[i] * (1 - t) + b[i] * b[i] * t)
  return toHex([ch(0), ch(1), ch(2), a[3] + (b[3] - a[3]) * t], true)
}
/** Piecewise colour scale: ramp([BLUE_E, GREEN, YELLOW, RED])(u) with u in 0..1. */
export function ramp(colors: readonly Color[]): (u: number) => Color {
  const given = Array.isArray(colors) ? colors.filter((c) => isColor(c)) : []
  if (!Array.isArray(colors) || given.length !== colors.length || !colors.length) {
    // D9: never throw on bad input; say what was wrong and hand back a scale that works
    ctx.model?.diagnostics.add({ code: 'API-TYPE', what: `ramp() expects a list of colours, got ${Array.isArray(colors) ? (colors.length ? 'a list with something that is not a colour' : 'an empty list') : colors === null ? 'null' : typeof colors}.`, fix: ['ramp([BLUE, GREEN, YELLOW, RED])'] })
  }
  const cs = given.length ? given : ['#000000', '#FFFFFF']
  return (u) => {
    if (cs.length === 1) return cs[0]!
    const x = (u < 0 ? 0 : u > 1 ? 1 : Number.isFinite(u) ? u : 0) * (cs.length - 1)
    const i = Math.min(cs.length - 2, Math.floor(x))
    return mix(cs[i]!, cs[i + 1]!, x - i)
  }
}
/** Relative luminance (WCAG) of a colour. */
export function luminance(c: Color): number {
  const v = parseColor(c) ?? [0, 0, 0, 1]
  const f = (x: number): number => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2])
}

// ── materials (3D) ─────────────────────────────────────────────────────────────────────────────────────
export interface MaterialSpec {
  color: Color
  metalness: number
  roughness: number
  opacity: number
  emissive: number // 0..1: how much of the colour glows regardless of light
  /** exempt housing for check (ghost / glass) */
  shell?: boolean
}
/** Presets tuned for the default look: readable flat-ish shading, not photoreal. */
export const MATERIALS: Record<string, MaterialSpec> = {
  matte: { color: '#BBBBBB', metalness: 0, roughness: 0.85, opacity: 1, emissive: 0 },
  plastic: { color: '#58C4DD', metalness: 0, roughness: 0.45, opacity: 1, emissive: 0 },
  rubber: { color: '#3A3A3A', metalness: 0, roughness: 0.95, opacity: 1, emissive: 0 },
  steel: { color: '#B4BDC8', metalness: 0.15, roughness: 0.4, opacity: 1, emissive: 0 },
  aluminium: { color: '#D8DDE3', metalness: 0.1, roughness: 0.5, opacity: 1, emissive: 0 },
  iron: { color: '#737B86', metalness: 0.15, roughness: 0.65, opacity: 1, emissive: 0 },
  brass: { color: '#E0B85C', metalness: 0.2, roughness: 0.38, opacity: 1, emissive: 0 },
  copper: { color: '#DE8E62', metalness: 0.2, roughness: 0.38, opacity: 1, emissive: 0 },
  glass: { color: '#9CDCEB', metalness: 0, roughness: 0.15, opacity: 0.2, emissive: 0, shell: true },
  ghost: { color: '#DDDDDD', metalness: 0, roughness: 1, opacity: 0.12, emissive: 0, shell: true },
  glow: { color: '#FFFF00', metalness: 0, roughness: 1, opacity: 1, emissive: 0.85 },
}
/** Common spelling accepted silently. */
export const MATERIAL_ALIASES: Record<string, string> = { aluminum: 'aluminium', metal: 'steel' }
