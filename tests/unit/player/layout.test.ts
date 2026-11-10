// Where everything stands for a window size (UI design specification 5.8, 5.9), and the invariants the layout promises: one
// first baseline, a gutter between anything typeset and the stage, a stage that never vanishes.
import { describe, expect, test } from 'bun:test'
import { TOKENS_CSS, UI_CSS } from '../../../src/player/css.ts'
import { EXTRA_CSS } from '../../../src/player/styles.ts'
import { baseOf, carryBox, freeStage, LAYOUT, letterbox, measure, mixBox, type Tokens } from '../../../src/player/layout.ts'

/** the tokens as the stylesheet declares them for a window width: read from the CSS text, so the two cannot drift */
function tokensFor(width: number): Tokens {
  const base = /\.m-root \{([^}]*)\}/.exec(TOKENS_CSS)![1]!
  const large = /@media \(min-width: 1680px\) \{\s*\.m-root \{([^}]*)\}/.exec(TOKENS_CSS)![1]!
  const phone = /@media \(max-width: 760px\) \{\s*\.m-root \{([^}]*)\}/.exec(TOKENS_CSS)![1]!
  const px = (name: string): number => {
    const find = (block: string): number | null => { const m = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block); return m ? Number(m[1]) : null }
    return (width >= 1680 ? find(large) : width <= 760 ? find(phone) : null) ?? find(base)!
  }
  return { lhCaption: px('lh-caption'), fsUi: px('fs-ui'), lhUi: px('lh-ui'), fsBody: px('fs-body'), lhBody: px('lh-body'), fsSmall: px('fs-small'), lhSmall: px('lh-small'), fsHead: px('fs-head'), lhHead: px('lh-head'), fsTitle: px('fs-title'), lhTitle: px('lh-title'), gutter: px('gutter'), col: px('col'), note: px('note'), first: px('first'), clear: px('clear'), row: px('row'), page: px('page') }
}
const at = (w: number, h: number) => measure(w, h, tokensFor(w))
const SIZES: [number, number][] = [[1920, 1080], [1440, 900], [1280, 720], [1100, 720], [900, 700], [390, 844], [320, 568], [844, 390]]

describe('metrics', () => {
  test('1440 × 900 is the spec\'s table', () => {
    const L = at(1440, 900)
    expect([L.mx, L.top, L.axisY, L.transY, L.first]).toEqual([72, 60, 834, 868, 96])
    expect([L.noteX, L.noteW, L.layerW]).toEqual([1048, 320, 470])
    expect([L.colX, L.colW, L.readLeft, L.readLine, L.readBottom, L.colBottom]).toEqual([102, 440, 542, 622, 778, 794])
    expect([L.short, L.phone, L.stack]).toEqual([false, false, false])
  })
  test('a large display grows type and columns by an eighth and caps the page at 1560', () => {
    const L = at(1920, 1080)
    expect(L.k).toBeCloseTo(19 / 17)
    expect(L.mx).toBe(180)
    expect(L.W - 2 * L.mx).toBe(1560)
    expect(L.noteW).toBe(360)
    expect(L.first).toBe(108)
  })
  test('a phone, a narrow window and a phone on its side are told apart', () => {
    expect([at(390, 844).phone, at(390, 844).stack, at(390, 844).short]).toEqual([true, true, false])
    expect([at(900, 700).phone, at(900, 700).stack]).toEqual([false, true])
    expect([at(844, 390).short, at(844, 390).phone, at(844, 390).stack]).toEqual([true, false, false])
    expect(at(390, 844).axisY).toBe(844 - 84)
    expect(at(844, 390).top).toBe(44)
  })
  test('safe areas move the top row, the line and the margins', () => {
    const L = measure(390, 844, tokensFor(390), { top: 47, right: 0, bottom: 34, left: 0 })
    expect(L.top).toBe(47 + 56)
    expect(L.axisY).toBe(844 - 34 - 84)
    expect(measure(844, 390, tokensFor(844), { top: 0, right: 47, bottom: 21, left: 47 }).mx).toBe(Math.round(844 * 0.05) + 47)
  })
  test('everything that hangs from the first baseline has its baseline there', () => {
    for (const [w, h] of SIZES) {
      const L = at(w, h), t = L.tokens
      expect(L.yNote + baseOf(t.fsHead, t.lhHead)).toBe(L.first)
      expect(L.yShare + baseOf(t.fsUi, t.lhUi)).toBe(L.first)
      expect(L.yGiven + baseOf(t.fsSmall, t.lhSmall)).toBe(L.first)
      expect(L.yLine + 5 + baseOf(t.fsUi, t.lhUi)).toBe(L.first)
    }
  })
  test('a frame too narrow for its own captions hands them to the player and leaves them room', () => {
    expect(at(1440, 900).ownCaptions).toBe(false)
    const p = at(390, 844)
    expect(p.ownCaptions).toBe(true)
    expect(p.stageBottom).toBe(p.axisY - 42 - 3 * p.tokens.lhCaption - 12)
  })
})

describe('the stage', () => {
  test('the letterbox is the engine\'s: a 16:9 slot is used whole, anything else is centred', () => {
    expect(letterbox({ x: 0, y: 0, width: 1280, height: 720 })).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
    expect(letterbox({ x: 0, y: 60, width: 1440, height: 730 })).toEqual({ x: 71, y: 60, width: 1297, height: 730 })
    expect(letterbox({ x: 10, y: 0, width: 390, height: 600 })).toEqual({ x: 10, y: 190, width: 390, height: 219 })
  })
  test('watch takes the window between the top row and the line; read and explore give way to their columns', () => {
    const L = at(1440, 900), c = L.tokens.clear
    expect(freeStage(L, { mode: 'video', right: false, left: false, sheet: 0 })).toEqual({ x: 0, y: 60, width: 1440, height: L.stageBottom - 60 })
    const r = freeStage(L, { mode: 'read', right: false, left: false, sheet: 0 })
    expect(r.x).toBe(L.readLeft + c)
    expect(r.y + r.height).toBe(L.readBottom)
    const e = freeStage(L, { mode: 'explore', right: false, left: false, sheet: 0 })
    expect(e.x + e.width).toBe(L.idxX - c)
    expect(e.y + e.height).toBe(L.exBottom)
  })
  test('nothing typeset comes within the gutter of the stage, at any size, whatever is open', () => {
    for (const [w, h] of SIZES) {
      const L = at(w, h), c = L.tokens.clear
      for (const mode of ['video', 'read', 'explore'] as const) for (const right of [false, true]) for (const left of [false, true]) {
        const f = freeStage(L, { mode, right, left, sheet: 0 }), box = letterbox(f)
        expect(box.width).toBeGreaterThanOrEqual(16)
        expect(box.x).toBeGreaterThanOrEqual(f.x)
        expect(box.x + box.width).toBeLessThanOrEqual(f.x + f.width)
        if (L.phone) continue
        const squeezed = f.width <= 64 // no room at all: the stage keeps a sliver rather than vanish
        if (right && !squeezed) expect(f.x + f.width).toBeLessThanOrEqual(L.noteX - c)
        if (left && !squeezed) expect(f.x).toBeGreaterThanOrEqual(L.mx + L.layerW + c)
        if (mode === 'read' && !L.stack && !squeezed) expect(f.x).toBeGreaterThanOrEqual(L.readLeft + c)
      }
    }
  })
  test('on a phone a sheet lifts the stage\'s ground, and never takes the stage away', () => {
    const L = at(390, 844)
    const open = freeStage(L, { mode: 'video', right: true, left: false, sheet: 300 })
    expect(open.y + open.height).toBe(844 - 300 - LAYOUT.sheetAir)
    const tall = freeStage(L, { mode: 'video', right: true, left: false, sheet: 800 })
    expect(tall.y + tall.height).toBe(L.top + Math.round(844 * LAYOUT.sheetKeep))
  })
  test('explore docks its columns when the stage between them would be too small, and stacks on a phone', () => {
    expect([at(1440, 900).exDock, at(1440, 900).exTabs, at(1440, 900).exStack]).toEqual([true, true, false])
    expect(at(390, 844).exStack).toBe(true)
    // a wide, low window: the frame is small, so the index and the givens stand either side of it
    const low = at(1560, 600)
    expect(low.exDock).toBe(false)
    expect(low.idxGutter).toBeGreaterThan(0)
    const e = freeStage(low, { mode: 'explore', right: false, left: false, sheet: 0 })
    expect(e.x).toBe(low.mx + low.idxW + low.tokens.clear)
    expect(e.x + e.width).toBe(low.noteX - low.tokens.clear)
  })
  test('a box is carried from where it was to where it is by a translate and one scale', () => {
    const to = { x: 100, y: 60, width: 800, height: 450 }, from = { x: 20, y: 30, width: 1200, height: 675 }
    expect(carryBox(from, to)).toEqual({ x: -80, y: -30, scale: 1.5 })
    expect(carryBox(to, to)).toEqual({ x: 0, y: 0, scale: 1 })
    expect(mixBox(from, to, 0)).toEqual(from)
    expect(mixBox(from, to, 1)).toEqual(to)
    expect(mixBox(from, to, 0.5).width).toBe(1000)
  })
})

describe('the stylesheet', () => {
  const lum = (hex: string): number => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]! }
  const contrast = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }
  const token = (name: string): string => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(TOKENS_CSS)![1]!
  test('text colours meet WCAG AA on the stage, the edge of a control meets 3 : 1', () => {
    const stage = token('stage')
    expect(stage).toBe('#000000')
    for (const name of ['chalk', 'dust', 'faint']) expect(contrast(token(name), stage)).toBeGreaterThanOrEqual(4.5)
    for (const name of ['blue', 'teal', 'green', 'gold', 'red', 'maroon-text', 'purple-text']) expect(contrast(token(name), stage)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('faint'), stage)).toBeGreaterThanOrEqual(3)
    expect(contrast(token('sheet'), token('chalk'))).toBeGreaterThanOrEqual(4.5)
  })
  test('nothing is fetched: no url(), no @import, no @font-face', () => {
    for (const css of [TOKENS_CSS, UI_CSS, EXTRA_CSS]) {
      expect(css).not.toMatch(/url\(/)
      expect(css).not.toMatch(/@import/)
      expect(css).not.toMatch(/@font-face/)
    }
  })
  test('nothing reaches outside the player: no bare element, html or body selector', () => {
    for (const css of [TOKENS_CSS, UI_CSS, EXTRA_CSS]) {
      const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').replace(/@keyframes[^{]*\{[^}]*\{[^}]*\}\s*\}/g, '')
      for (const m of rules.matchAll(/(^|\})\s*([^{}@]+)\{/g)) for (const sel of m[2]!.split(',')) {
        const s = sel.trim()
        if (!s || /^\d+%$/.test(s)) continue
        expect(s).toMatch(/^[.#:]/) // a class, an id of the player's, or :where(.m-app)
        expect(s).not.toMatch(/^(html|body|\*)/)
      }
    }
  })
  test('hover styles exist only where a pointer can hover, and reduced motion stops what moves by itself', () => {
    const outside = UI_CSS.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/, '')
    expect(outside).not.toMatch(/:hover/)
    expect(EXTRA_CSS).not.toMatch(/:hover/)
    expect(UI_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
  test('nothing in Computer Modern is set under 15 px', () => {
    for (const m of TOKENS_CSS.matchAll(/--fs-([a-z]+):\s*(\d+)px/g)) if (m[1] !== 'key') expect(Number(m[2])).toBeGreaterThanOrEqual(15)
  })
})
