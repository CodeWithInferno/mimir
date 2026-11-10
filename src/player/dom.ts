// Small DOM helpers and the player's drawn glyphs. Everything is created with the document at call time: importing
// this file touches nothing.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (html !== undefined) n.innerHTML = html
  return n
}
/** A button set as text or as a glyph: type=button always, so a form around it is never submitted by it. */
export function button(cls: string, html: string, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = el('button', cls, html)
  b.type = 'button'
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v)
  return b
}
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode): T => root.querySelector<T>(sel)!
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode): T[] => [...root.querySelectorAll<T>(sel)]

// Icons: inline SVG on a 16 px grid (spec 7.5). Dots and checks are drawn; nothing here is a font glyph.
const svg = (body: string, size = 16, extra = 'fill="currentColor"'): string => `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ${extra} aria-hidden="true">${body}</svg>`
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"'
export const ICON = {
  play: svg('<path data-pp="1"/><path data-pp="2"/>'),
  prev: svg('<path d="M3 3h1.6v10H3zM13 3v10L5.6 8z"/>'),
  next: svg('<path d="M11.4 3H13v10h-1.6zM3 3v10l7.4-5z"/>'),
  full: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>', 16, 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'),
  voice: svg('<path d="M2.5 6.8h2.7L9 3.6v10.8l-3.8-3.2H2.5z" fill="currentColor" stroke="none"/><path d="M11.6 6.4a3.6 3.6 0 0 1 0 5.2M13.8 4.4a6.4 6.4 0 0 1 0 9.2"/>', 18, stroke),
  captions: svg('<rect x="2" y="4" width="14" height="10" rx="1.6"/><path d="M5 11h3.2M10 11h3M5 8.2h1.6M8.4 8.2h4.6"/>', 18, stroke),
  loop: svg('<path d="M4.2 7.2V6.6a2.4 2.4 0 0 1 2.4-2.4h6.6M11.4 2.2l2 2-2 2M13.8 10.8v.6a2.4 2.4 0 0 1-2.4 2.4H4.8M6.6 15.8l-2-2 2-2"/>', 18, stroke),
  more: svg('<circle cx="3.5" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="14.5" cy="9" r="1.5"/>', 18),
  close: svg('<path d="M2 2l9 9M11 2l-9 9"/>', 13, stroke),
  find: svg('<circle cx="6.3" cy="6.3" r="4.3"/><path d="M9.6 9.6l3.6 3.6"/>', 15, stroke),
  check: svg('<path d="M3 8.4l3.2 3.2L13 4.6"/>', 16, 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'),
}
/** The transport glyph: two halves of a triangle that become two bars, 8 points interpolated (spec 8.12). m = 0 play, 1 pause. */
const PP = { play: [[4, 2.5, 8.9, 5.3, 8.9, 10.7, 4, 13.5], [8.9, 5.3, 13.6, 8, 13.6, 8, 8.9, 10.7]], pause: [[3.6, 2.6, 6.6, 2.6, 6.6, 13.4, 3.6, 13.4], [9.4, 2.6, 12.4, 2.6, 12.4, 13.4, 9.4, 13.4]] } as const
export function playGlyph(m: number): [string, string] {
  const d = (i: 0 | 1): string => { const a = PP.play[i], b = PP.pause[i], q = a.map((x, k) => (x + (b[k]! - x) * m).toFixed(2)); return `M${q[0]} ${q[1]}L${q[2]} ${q[3]}L${q[4]} ${q[5]}L${q[6]} ${q[7]}Z` }
  return [d(0), d(1)]
}
/** A key as it is printed on its control. */
export const key = (k: string): string => `<kbd class="m-key">${k}</kbd>`
/** ⌘ on Apple keyboards, Ctrl elsewhere (read from the platform the page runs on). */
export const MOD = (): string => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl ')
/** True while the reader is typing text: single keys are then letters, not commands (a slider is not a text field). */
export function typing(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null
  if (!t || !t.tagName) return false
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)
}
