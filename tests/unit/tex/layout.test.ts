// The layout of formulas, without a browser: KaTeX's box tree → positioned glyphs, rules and drawings.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findKey, fitView, layoutTex, matchItems, readingOrder, type TexDrawing, type TexGlyph, type TexItem, type TexRule, type TexView } from '../../../src/tex/layout.ts'

const R = String.raw
const glyphs = (items: readonly TexItem[]): TexGlyph[] => items.filter((it): it is TexGlyph => it.kind === 'glyph')
const face = (g: TexGlyph): string => `${g.family}-${g.bold && g.italic ? 'BoldItalic' : g.bold ? 'Bold' : g.italic ? 'Italic' : 'Regular'}`

describe('tex layout', () => {
  test('a formula is its glyphs, in the faces and sizes TeX gives them', () => {
    const l = layoutTex('E = mc^2')
    expect(l.error).toBeNull()
    expect(glyphs(l.items).map((g) => g.text)).toEqual(['E', '=', 'm', 'c', '2'])
    expect(glyphs(l.items).map(face)).toEqual(['Math-Italic', 'Main-Regular', 'Math-Italic', 'Math-Italic', 'Main-Regular'])
    expect(l.faces).toEqual(['Main-Regular', 'Math-Italic'])
    const [E, eq, m, c, two] = glyphs(l.items) as [TexGlyph, TexGlyph, TexGlyph, TexGlyph, TexGlyph]
    // left to right, on one baseline; the exponent is smaller and raised
    expect(E.x).toBe(0)
    expect(eq.x).toBeGreaterThan(E.x + 0.7)
    expect(m.x).toBeGreaterThan(eq.x + 0.7)
    expect([E.y, eq.y, m.y, c.y]).toEqual([0, 0, 0, 0])
    expect(two.size).toBeCloseTo(0.7, 6)
    expect(two.y).toBeGreaterThan(0.3)
    expect(l.order).toEqual([0, 1, 2, 3, 4])
    expect(l.box[0]).toBe(0)
    expect(l.box[3]).toBeGreaterThan(0.8)
  })

  test('a fraction: numerator over the bar over the denominator, both centred on it', () => {
    const l = layoutTex(R`\frac{a+b}{c}`)
    const bar = l.items.find((it): it is TexRule => it.kind === 'rule')!
    const g = glyphs(l.items)
    const a = g.find((x) => x.text === 'a')!, b = g.find((x) => x.text === 'b')!, c = g.find((x) => x.text === 'c')!
    expect(a.y).toBeGreaterThan(bar.y + bar.height)
    expect(c.box[3]).toBeLessThan(bar.y)
    expect(bar.height).toBeCloseTo(0.04, 6)
    // the bar is as wide as the wider of the two, and the narrower one sits in its middle
    expect(bar.width).toBeCloseTo(b.box[2] - a.box[0], 6)
    expect((c.box[0] + c.box[2]) / 2).toBeCloseTo(bar.x + bar.width / 2, 6)
  })

  test('KaTeX merges runs of characters; the layout still knows every width', () => {
    const l = layoutTex(R`\text{time}_{26}`)
    const g = glyphs(l.items)
    expect(g.map((x) => x.text)).toEqual(['t', 'i', 'm', 'e', '2', '6'])
    for (const x of g) expect(x.text.length).toBe(1)
    // every character starts where the one before it ends
    expect(g[1]!.x).toBeCloseTo(g[0]!.box[2], 6)
    expect(g[2]!.x).toBeCloseTo(g[1]!.box[2], 6)
    expect(g[3]!.x).toBeCloseTo(g[2]!.box[2], 6)
    expect(g[5]!.x).toBeCloseTo(g[4]!.box[2], 6)
  })

  test('a root, a brace and a tall delimiter are drawings with views of their own size', () => {
    const root = layoutTex(R`\sqrt{x+1}`).items.find((it): it is TexDrawing => it.kind === 'svg')!
    expect(root.sig).toBe('svg:sqrt')
    expect(root.views).toHaveLength(1)
    expect(root.views[0]!.paths).toHaveLength(1)
    expect(root.views[0]!.aspect).toBe('xMinYMin slice')
    // the view is as wide as the root and what stands under it, not as wide as KaTeX's 400 em path
    expect(root.width).toBeGreaterThan(2)
    expect(root.width).toBeLessThan(4)
    const brace = layoutTex(R`\underbrace{a+b+c}_{3}`).items.find((it): it is TexDrawing => it.kind === 'svg')!
    expect(brace.views).toHaveLength(3) // left end, middle, right end
    expect(brace.views.reduce((s, v) => Math.max(s, v.x + v.width), 0)).toBeCloseTo(brace.width, 6)
    const paren = layoutTex(R`\left( \begin{array}{c} a \\ b \\ c \\ d \\ e \end{array} \right)`).items.filter((it) => it.kind === 'svg')
    expect(paren.map((p) => p.sig)).toEqual(['svg:lparen', 'svg:rparen'])
    const strokes = layoutTex(R`\cancel{x}`).items.find((it): it is TexDrawing => it.kind === 'svg')!
    expect(strokes.views[0]!.strokes).toEqual([{ x1: 0, y1: 1, x2: 1, y2: 0, width: 0.046 }])
  })

  test('\\boxed is a frame around its content; \\phantom takes room and draws nothing', () => {
    const l = layoutTex(R`\boxed{x}`)
    const frame = l.items.find((it): it is TexRule => it.kind === 'rule')!
    const x = glyphs(l.items)[0]!
    expect(frame.sig).toBe('frame')
    expect(frame.frame).toBeCloseTo(0.04, 6)
    expect(frame.x).toBeLessThan(x.box[0])
    expect(frame.x + frame.width).toBeGreaterThan(x.box[2])
    expect(frame.y).toBeLessThan(x.box[1])
    expect(frame.y + frame.height).toBeGreaterThan(x.box[3])
    const p = glyphs(layoutTex(R`a\phantom{bcd}e`).items)
    expect(p.map((g) => g.text)).toEqual(['a', 'e'])
    expect(p[1]!.x - p[0]!.box[2]).toBeGreaterThan(1)
  })

  test('colours of the source are kept per piece', () => {
    // \textcolor colours its argument; \color colours the rest of its group, as in LaTeX
    const l = layoutTex(R`{\color{#58C4DD} x} + \textcolor{red}{y} + z`)
    expect(glyphs(l.items).map((g) => [g.text, g.color])).toEqual([['x', '#58C4DD'], ['+', null], ['y', 'red'], ['+', null], ['z', null]])
  })

  test('lines of a formula with \\\\ are stacked and centred', () => {
    const l = layoutTex(R`a + b + c \\ d`)
    const g = glyphs(l.items)
    const a = g[0]!, d = g[g.length - 1]!
    expect(d.y).toBeLessThan(-1.2)
    expect((d.box[0] + d.box[2]) / 2).toBeCloseTo((l.box[0] + l.box[2]) / 2, 2)
    expect(a.y).toBe(0)
  })

  test('a source that does not parse never throws: the error names the piece, and the source is set as text', () => {
    const l = layoutTex(R`\frc{a}{b} + 1`)
    expect(l.error).not.toBeNull()
    expect(l.error!.token).toBe(R`\frc`)
    expect(l.error!.position).toBe(0)
    expect(l.error!.message).toContain('Undefined control sequence')
    expect(glyphs(l.items).map((g) => g.text).join('')).toBe(R`\frc{a}{b}+1`)
    for (const bad of ['', '{', '}', '\\', '$', 'x^', 'x_', R`\left(`, R`\begin{pmatrix}`, R`\end{x}`, '&', '#', '%', R`\sqrt[`, '\u0000', '😀', R`\href{javascript:alert(1)}{x}`, 'a'.repeat(5000)]) {
      const r = layoutTex(bad)
      expect(Array.isArray(r.items)).toBe(true)
      for (const it of r.items) for (const v of [it.x, it.y, ...it.box]) expect(Number.isFinite(v)).toBe(true)
    }
    // a macro that would never end is cut off by KaTeX and reported, not looped
    expect(layoutTex(R`\def\x{\x\x}\x`).error).not.toBeNull()
  })

  test('the same source gives the same layout, every time', () => {
    const src = R`\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}`
    expect(JSON.stringify(layoutTex(src))).toBe(JSON.stringify(layoutTex(src)))
    layoutTex(R`\sum_{i=1}^n i`)
    expect(JSON.stringify(layoutTex(src))).toBe(JSON.stringify(layoutTex(src)))
  })

  test('reading order is left to right', () => {
    const l = layoutTex(R`\frac{a}{b} + c`)
    const xs = l.order.map((i) => l.items[i]!.box[0])
    expect([...xs].sort((p, q) => p - q)).toEqual(xs)
    expect(readingOrder(l.items)).toEqual(l.order)
  })

  test('fitView is SVG\'s preserveAspectRatio', () => {
    const v = (aspect: string, width: number, height: number): TexView => ({ x: 0, y: 0, width, height, viewBox: [0, 0, 400000, 1000], aspect, paths: [], strokes: [] })
    // slice from the left: one unit of the path is 0.001 em, the left end of the path is the left end of the view
    expect(fitView(v('xMinYMin slice', 3, 1))).toEqual({ sx: 0.001, sy: 0.001, tx: 0, ty: 0 })
    // slice from the right: the right end of the path is the right end of the view
    expect(fitView(v('xMaxYMin slice', 3, 1)).tx).toBeCloseTo(3 - 400, 9)
    expect(fitView(v('xMidYMin slice', 3, 1)).tx).toBeCloseTo((3 - 400) / 2, 9)
    expect(fitView(v('none', 2, 1))).toEqual({ sx: 2 / 400000, sy: 0.001, tx: 0, ty: 0 })
    const meet = fitView({ ...v('xMidYMid meet', 2, 1), viewBox: [0, 0, 1000, 1000] })
    expect(meet.sx).toBe(0.001)
    expect(meet.tx).toBeCloseTo(0.5, 9)
  })
})

describe('tex layout against a browser', () => {
  // tests/unit/tex/fixtures/chrome-katex.json: positions measured in Chrome with KaTeX's own HTML, stylesheet and fonts
  const fixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'chrome-katex.json'), 'utf8')) as { formulas: { source: string; display: boolean; glyphs: [string, number, number, number, string][]; rules: [number, number, number, number][]; views: [number, number, number, number][] }[] }
  /** em; a glyph of a 48 px formula is then within a quarter of a pixel of where the browser puts it */
  const TOLERANCE = 0.005

  test(`${fixture.formulas.length} formulas land where Chrome puts them (within ${TOLERANCE} em)`, () => {
    expect(fixture.formulas.length).toBeGreaterThan(150)
    const off: string[] = []
    let worst = 0
    for (const f of fixture.formulas) {
      const l = layoutTex(f.source, f.display)
      if (l.error) { off.push(`${f.source}: ${l.error.message}`); continue }
      const g = glyphs(l.items)
      if (g.length !== f.glyphs.length) { off.push(`${f.source}: ${g.length} glyphs, the browser has ${f.glyphs.length}`); continue }
      g.forEach((mine, i) => {
        const [text, x, y, size, name] = f.glyphs[i]!
        const d = Math.max(Math.abs(mine.x - x), Math.abs(mine.y - y))
        worst = Math.max(worst, d)
        if (mine.text !== text || face(mine) !== name || Math.abs(mine.size - size) > 0.002 || d > TOLERANCE) off.push(`${f.source}: glyph ${i} "${mine.text}" ${face(mine)} at (${mine.x.toFixed(4)}, ${mine.y.toFixed(4)}) size ${mine.size}; the browser: "${text}" ${name} at (${x}, ${y}) size ${size}`)
      })
      const rules = l.items.filter((it): it is TexRule => it.kind === 'rule' && it.sig === 'rule' && it.width > 0.005 && it.height > 0.005)
      if (rules.length !== f.rules.length) off.push(`${f.source}: ${rules.length} rules, the browser has ${f.rules.length}`)
      else rules.forEach((r, i) => { const [x, y, w, h] = f.rules[i]!; if (Math.max(Math.abs(r.x - x), Math.abs(r.y - y), Math.abs(r.width - w), Math.abs(r.height - h)) > 0.012) off.push(`${f.source}: rule ${i} is [${r.x}, ${r.y}, ${r.width}, ${r.height}], the browser has [${x}, ${y}, ${w}, ${h}]`) })
      const views = l.items.filter((it): it is TexDrawing => it.kind === 'svg').flatMap((d) => d.views.map((v) => [d.x + v.x, d.y + v.y, v.width, v.height]))
      if (views.length !== f.views.length) off.push(`${f.source}: ${views.length} drawing views, the browser has ${f.views.length}`)
      else views.forEach((v, i) => { const b = f.views[i]!; if (v.some((n, k) => Math.abs(n! - b[k]!) > 0.012)) off.push(`${f.source}: view ${i} is [${v.join(', ')}], the browser has [${b.join(', ')}]`) })
    }
    expect(off).toEqual([])
    expect(worst).toBeLessThan(TOLERANCE)
  })
})

describe('tex keys and matching', () => {
  test('a key is found as the run of pieces that is set like it, whatever their size', () => {
    const l = layoutTex(R`x^2 + 2x + e^{x}`)
    const hit = (key: string): number[][] => findKey(l, layoutTex(key))
    expect(hit('x')).toEqual([[0], [4], [7]])
    expect(hit('2')).toEqual([[1], [3]])
    expect(hit('x^2')).toEqual([[0, 1]])
    expect(hit('2x')).toEqual([[3, 4]])
    expect(hit('+')).toEqual([[2], [5]])
    expect(hit('y')).toEqual([])
    expect(hit(R`\frc`)).toEqual([])
    // a fraction is found as a fraction
    const f = layoutTex(R`1 + \frac{a}{b}`)
    expect(findKey(f, layoutTex(R`\frac{a}{b}`))).toEqual([[2, 3, 4]])
    expect(findKey(f, layoutTex(R`\mathbf{a}`))).toEqual([]) // another face is another piece
  })

  test('matching pairs the pieces two formulas share: in order first, then across', () => {
    const a = layoutTex(R`a^2 + b^2 = c^2`), b = layoutTex(R`c = \sqrt{a^2 + b^2}`)
    const m = matchItems(a, b)
    const text = (l: typeof a, i: number): string => { const it = l.items[i]!; return it.kind === 'glyph' ? it.text : it.sig }
    const pairs = m.pairs.map(([i, j]) => [text(a, i), text(b, j)])
    for (const [x, y] of pairs) expect(x).toBe(y)
    // a² + b² keeps its order; = and c change sides; the third exponent has no partner, the root is new
    expect(pairs.map((p) => p[0]).sort()).toEqual(['+', '2', '2', '=', 'a', 'b', 'c'])
    expect(m.onlyA.map((i) => text(a, i))).toEqual(['2'])
    expect(m.onlyB.map((i) => text(b, i))).toEqual(['svg:sqrt'])
    // every piece is used exactly once
    expect(new Set([...m.pairs.map((p) => p[0]), ...m.onlyA]).size).toBe(a.items.length)
    expect(new Set([...m.pairs.map((p) => p[1]), ...m.onlyB]).size).toBe(b.items.length)
    // a formula matches itself piece for piece
    const self = matchItems(a, a)
    expect(self.pairs.every(([i, j]) => i === j)).toBe(true)
    expect(self.onlyA).toEqual([])
    // nothing in common: nothing pairs
    expect(matchItems(layoutTex('x'), layoutTex('y')).pairs).toEqual([])
    expect(matchItems(layoutTex(''), layoutTex('y')).onlyB).toEqual([0])
  })
})
