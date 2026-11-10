// tex() as a scene object, without a browser: sizes, text boxes, parts, diagnostics, the font plan, rewrite().
import { describe, expect, test } from 'bun:test'
import { compile, emOf, scene, type MNode, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import { write, fadeIn } from '../../../src/anim/index.ts'
import { estimateBox, rewrite, slots, tex, TEX_STYLE } from '../../../src/tex/index.ts'
import { layoutTex, texSource } from '../../../src/tex/layout.ts'
// the lazy chunk: under bun it fills the slots (the layout is pure), its drawing side is never called
import { layoutOf, partIndices, planOf, writtenAt } from '../../../src/tex/tex.chunk.ts'

const R = String.raw
const build = (fn: (s: any) => void): SceneModel => compile(scene({ title: 'tex' }, fn))
const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)
const width = (m: SceneModel, n: MNode, t = 0): number => { const b = m.state(t).bounds(n); return b.max[0] - b.min[0] }

describe('tex()', () => {
  test('the box of a formula is the box of its ink, in frame units, centred on its position', () => {
    let f!: MNode
    const m = build(() => { f = tex('E = mc^2').at(1, 2) })
    const l = layoutTex('E = mc^2')
    const em = emOf(48)
    const b = m.state(0).bounds(f)
    expect(b.max[0] - b.min[0]).toBeCloseTo((l.box[2] - l.box[0]) * em, 9)
    expect(b.max[1] - b.min[1]).toBeCloseTo((l.box[3] - l.box[1]) * em, 9)
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(1, 9)
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(2, 9)
    expect(codes(m)).toEqual([])
    // the linter's text box is the same rectangle
    const rects = m.state(0).textRects(f)
    expect(rects).toHaveLength(1)
    expect(rects[0]!.text).toBe('E = mc^2')
    expect(rects[0]!.rect.width).toBeCloseTo(b.max[0] - b.min[0], 9)
    expect(rects[0]!.rect.x).toBeCloseTo(b.min[0], 9)
  })

  test('size follows the ladder of text(); inline sets big operators small', () => {
    let a!: MNode, b!: MNode, c!: MNode, d!: MNode
    const m = build(() => { a = tex('x', { size: 48 }); b = tex('x', { size: 'title' }); c = tex(R`\sum_{i=1}^n i`); d = tex(R`\sum_{i=1}^n i`, { inline: true }) })
    expect(width(m, b) / width(m, a)).toBeCloseTo(72 / 48, 9)
    const hc = m.state(0).bounds(c), hd = m.state(0).bounds(d)
    expect(hc.max[1] - hc.min[1]).toBeGreaterThan((hd.max[1] - hd.min[1]) * 1.5)
  })

  test('a formula can follow a param', () => {
    let f!: MNode
    const m = build((s) => {
      const n = s.param('n', { value: 1, min: 1, max: 1000 })
      f = tex(() => `n = ${Math.round(n())}`)
      s.step('grow', (st: any) => { st.set(n, 1000) })
    })
    expect(width(m, f, m.duration)).toBeGreaterThan(width(m, f, 0) + 0.5)
    expect(codes(m)).toEqual([])
  })

  test('prose with maths: what stands between dollar signs is mathematics', () => {
    expect(texSource('E = mc^2')).toBe('E = mc^2')
    expect(texSource(R`the angle $\theta$ grows`)).toBe(R`\text{the angle }\theta\text{ grows}`)
    expect(texSource('$a$ and $b$')).toBe(R`a\text{ and }b`)
    expect(texSource(R`50% of $x_1$ & more`)).toBe(R`\text{50\% of }x_1\text{ \& more}`)
    expect(texSource(R`it costs \$5`)).toBe(R`it costs \$5`) // no pair of dollar signs: all mathematics, as written
    expect(texSource(R`$x$ costs \$5`)).toBe(R`x\text{ costs \$5}`)
    expect(texSource('a $x$ b $')).toBe(R`\text{a }x\text{ b \$}`) // a dollar sign that opens nothing is text
    let f!: MNode
    const m = build(() => { f = tex(R`the angle $\theta$`) })
    expect(codes(m)).toEqual([])
    m.state(0).bounds(f)
    expect(codes(m)).toEqual([])
    expect(layoutOf(R`the angle $\theta$`, true).items.map((it) => (it.kind === 'glyph' ? it.text : '?')).join('')).toBe('theangleθ')
  })

  test('bad input never throws: a diagnostic, and something is still there', () => {
    let a!: MNode, b!: MNode, c!: MNode
    const m = build(() => {
      a = tex(R`\frc{a}{b}`, { id: 'broken' })
      b = (tex as any)()
      c = tex('x', { colour: 'red', size: -3 } as any)
      ;(tex as any)(null)
      ;(tex as any)({ size: 3 })
      tex('x', { colors: { q: '#FF0000' } })
      tex('x', { colors: { x: 'nonsense' } } as any)
    })
    const f = m.state(0)
    for (const n of m.nodes) { const bb = f.bounds(n); expect([...bb.min, ...bb.max].every(Number.isFinite)).toBe(true) }
    const invalid = m.diagnostics.list.filter((d) => d.code === 'TEX-INVALID')
    expect(invalid).toHaveLength(1)
    expect(invalid[0]!.severity).toBe('error')
    expect(invalid[0]!.ids).toEqual(['broken'])
    expect(invalid[0]!.what).toContain(R`Undefined control sequence: \frc`)
    expect(invalid[0]!.what).toContain(R`at "\frc", character 1`)
    expect(invalid[0]!.fix[0]).toBe(R`did you mean \frac?`)
    expect(invalid[0]!.line).not.toBeNull()
    expect(width(m, a)).toBeGreaterThan(1) // the source is shown as text
    expect(codes(m)).toContain('API-UNKNOWN') // colour → did you mean color
    expect(codes(m)).toContain('NUM-INVALID')
    expect(m.diagnostics.list.some((d) => d.code === 'REF-MISSING' && d.what.includes('has no piece set like "q"'))).toBe(true)
    void b; void c
    // asking again reports nothing twice
    const n = m.diagnostics.list.length
    m.state(1).bounds(a)
    m.state(0).bounds(a)
    expect(m.diagnostics.list.length).toBe(n)
  })

  test('the scene asks for the font chunks its formulas need, and only those', () => {
    const chunks = (fn: () => void): string[] => build(fn).chunksNeeded()
    expect(chunks(() => { tex('E = mc^2') })).toEqual(['fonts', 'tex']) // 'fonts': the main faces, shared with all stage text (src/r2d)
    expect(chunks(() => { tex(R`\sum_{i} x_i \in \mathbb{R}`) })).toEqual(['fonts', 'tex', 'texams', 'texsize'])
    expect(chunks(() => { tex(R`\mathbf{A}`); tex(R`\mathcal{L}`) })).toEqual(['fonts', 'tex', 'texbold', 'texcal'])
    // a source that is a function is read as text
    expect(chunks(() => { tex(() => R`\left( ${1} \right)`) })).toEqual(['fonts', 'tex', 'texsize'])
    // a scene without a formula loads nothing of this module
    expect(chunks(() => {})).toEqual([])
  })
})

describe('tex parts', () => {
  test('a part is the piece that is set like its key: an object with a box of its own', () => {
    let f!: any, c2!: MNode, a!: MNode, plus2!: MNode, first!: MNode
    const m = build(() => {
      f = tex('a^2 + b^2 = c^2', { id: 'pyth' }).at(2, 1)
      c2 = f.part('c^2')
      a = f.part('a')
      plus2 = f.part('2', 2)
      first = f.part(0)
    })
    expect(codes(m)).toEqual([])
    expect([c2.id, a.id, plus2.id, first.id]).toEqual(['pyth.c-2', 'pyth.a', 'pyth.2-2', 'pyth.piece0'])
    expect(c2.parent).toBe(f)
    const fr = m.state(0)
    const whole = fr.bounds(f), right = fr.bounds(c2), left = fr.bounds(a)
    // c² is the right end of the formula, a its left end; both inside it
    expect(right.max[0]).toBeCloseTo(whole.max[0], 6)
    expect(left.min[0]).toBeCloseTo(whole.min[0], 6)
    expect(right.min[0]).toBeGreaterThan(left.max[0])
    expect(right.max[1]).toBeLessThanOrEqual(whole.max[1] + 1e-9)
    // the second 2 is the exponent of b
    const l = layoutOf('a^2 + b^2 = c^2', true)
    expect(partIndices(l, '2', 2)).toEqual({ indices: [4] })
    expect(partIndices(l, 0, 1)).toEqual({ indices: [0] })
    // a part follows its formula
    expect(fr.bounds(first).min[0]).toBeCloseTo(whole.min[0], 6)
    expect(fr.anchor(c2, 'center')[1]).toBeGreaterThan(0.5)
  })

  test('asking twice gives the same object; a part made in a step does not hide its pieces before it', () => {
    let f!: any, early!: MNode, late!: MNode, entering!: MNode
    const m = build((s) => {
      f = tex('x + y + z')
      early = f.part('x')
      s.step('one', (st: any) => { st.wait(1) })
      s.step('two', (st: any) => {
        late = f.part('y')
        expect(f.part('x')).toBe(early)
        st.play(late.to.color('#FFFF00'))
        entering = f.part('z')
        st.play(fadeIn(entering))
      })
    })
    expect(codes(m)).toEqual([])
    const before = m.state(0.5), after = m.state(m.duration)
    expect(before.reveal(late).p).toBe(1)
    expect(before.prop(late, 'color')).toBeNull()
    expect(after.prop(late, 'color')).toBe('#FFFF00')
    // half way through the tween the colour is between the formula's and the target, not transparent
    const mid = m.state(m.steps[1]!.t0 + 0.5).prop<string>(late, 'color')
    expect(mid).toMatch(/^#[0-9A-F]{6}$/i)
    expect(mid.toUpperCase()).not.toBe('#FFFF00')
    // a part that a verb brings in is hidden until then, like any object
    expect(before.reveal(entering).p).toBe(0)
    expect(after.reveal(entering).p).toBe(1)
  })

  test('a part the formula does not have is REF-MISSING with the pieces it does have', () => {
    let f!: any
    const m = build(() => {
      f = tex('x^2 + 1', { id: 'f' })
      f.part('y')
      f.part('x', 3)
      f.part(99)
      f.part('')
      f.part('x', 0)
      f.part(R`\frc`)
    })
    m.state(0).bounds(f)
    const missing = m.diagnostics.list.filter((d) => d.code === 'REF-MISSING')
    expect(missing.map((d) => d.what)).toEqual([
      'tex.part("y"): the formula "x^2 + 1" has no piece set like "y".',
      'tex.part("x"): the formula "x^2 + 1" has "x" 1 time, not 3.',
      'tex.part(99): the formula "x^2 + 1" has 4 pieces, so there is no piece 99.',
      R`tex.part("\\frc"): the formula "x^2 + 1" has no part "\frc": the key is not LaTeX that can be set (Undefined control sequence: \frc).`,
    ])
    expect(missing[0]!.fix[0]).toBe('its pieces, left to right: x 2 + 1')
    expect(m.diagnostics.list.filter((d) => d.code === 'API-TYPE').length).toBe(2)
    for (const n of m.nodes) { const b = m.state(0).bounds(n); expect([...b.min, ...b.max].every(Number.isFinite)).toBe(true) }
  })

  test('colours: the colours map covers every occurrence; the last part made owns a piece two parts share', () => {
    let f!: any, whole!: MNode, exp!: MNode
    const m = build(() => {
      f = tex('x^2 + x', { colors: { x: '#58C4DD' } })
      whole = f.part('x^2')
      exp = f.part('2')
    })
    const plan = planOf(f, m.state(0))
    expect(plan.colors).toEqual(['#58C4DD', null, null, '#58C4DD'])
    expect(plan.owner.map((o) => o?.id ?? null)).toEqual([whole.id, exp.id, null, null])
    expect(codes(m)).toEqual([])
  })
})

describe('tex animation', () => {
  test('write() reveals the pieces left to right with a lag', () => {
    const n = 8
    // nothing at 0, everything at 1, never backwards
    for (let k = 0; k < n; k++) { expect(writtenAt(0, k, n)).toBe(0); expect(writtenAt(1, k, n)).toBe(1) }
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) for (let k = 1; k < n; k++) expect(writtenAt(p, k, n)).toBeLessThanOrEqual(writtenAt(p, k - 1, n))
    for (let k = 0; k < n; k++) for (let i = 1; i <= 20; i++) expect(writtenAt(i / 20, k, n)).toBeGreaterThanOrEqual(writtenAt((i - 1) / 20, k, n))
    // the first piece is done while the last has not started
    expect(writtenAt(0.45, 0, n)).toBe(1)
    expect(writtenAt(0.45, n - 1, n)).toBe(0)
    // the lag is manim's: min(4 / (n + 1), 0.2) of one piece's time
    const lag = Math.min(TEX_STYLE.writeLagTotal / (n + 1), TEX_STYLE.writeLag)
    expect(writtenAt(0.2, 1, n)).toBeCloseTo(0.2 * (1 + lag * (n - 1)) - lag, 9)
    expect(writtenAt(0.5, 0, 1)).toBe(0.5)
    // write() from the verbs module drives it
    let f!: MNode
    const m = build((s) => { f = tex('a + b'); s.step('w', (st: any) => { st.play(write(f)) }) })
    expect(m.state(0).reveal(f)).toEqual({ p: 0, mode: 'write' })
    expect(m.state(0.5).reveal(f).p).toBeCloseTo(0.5, 6)
  })

  test('rewrite(a, b): b is hidden before, takes the stage at once, and a leaves unless it is kept', () => {
    let a!: MNode, b!: MNode, c!: MNode
    const m = build((s) => {
      a = tex('a^2 + b^2 = c^2', { id: 'one' }).at(0, 1)
      b = tex(R`c = \sqrt{a^2 + b^2}`, { id: 'two' })
      c = tex('c = 5', { id: 'three' }).at(0, -1)
      s.step('derive', (st: any) => { st.play(rewrite(a, b, { keep: true })) })
      s.step('replace', (st: any) => { st.play(rewrite(b, c, { duration: 2 })) })
    })
    expect(codes(m)).toEqual([])
    const t1 = m.steps[0]!.t0, t2 = m.steps[1]!.t0
    expect(m.state(t1 - 0).reveal(b).p).toBe(1)
    expect(m.state(t1).prop(b, 'rewriteFrom')).toBe('one')
    expect(m.state(t1).prop(b, 'rewrite')).toBe(0)
    expect(m.state(t1 + TEX_STYLE.rewriteDuration / 2).prop<number>(b, 'rewrite')).toBeCloseTo(0.5, 6)
    expect(m.state(t1 + TEX_STYLE.rewriteDuration).prop(b, 'rewrite')).toBe(1)
    expect(m.state(t1 + 1).reveal(a).p).toBe(1) // kept
    expect(m.state(t1 + 1).prop(b, 'rewriteKeep')).toBe(true)
    // the second one replaces: b is gone the moment c starts drawing its pieces
    expect(m.state(t2 - 0.01).reveal(c).p).toBe(0)
    expect(m.state(t2 + 0.01).reveal(c).p).toBe(1)
    expect(m.state(t2 + 0.01).reveal(b).p).toBe(0)
    expect(m.state(t2 + 1).prop<number>(c, 'rewrite')).toBeCloseTo(0.5, 6)
    expect(m.state(t2 + 1).prop(c, 'rewriteKeep')).toBe(false)
    expect(m.steps[1]!.t1 - t2).toBeGreaterThanOrEqual(2)
  })

  test('rewrite() of something that is not a formula is API-TYPE and a no-op', () => {
    const m = build((s) => {
      const f = tex('x')
      s.step('bad', (st: any) => {
        st.play((rewrite as any)(f, 'nope'))
        st.play((rewrite as any)(f, f))
        st.play((rewrite as any)(f, tex('y'), { keeep: true }))
        st.play((rewrite as any)())
      })
    })
    expect(codes(m).sort()).toEqual(['API-TYPE', 'API-UNKNOWN', 'REF-MISSING', 'REF-MISSING'])
  })
})

describe('tex without its chunk', () => {
  test('sizes are an estimate until the chunk is there', () => {
    const b = estimateBox(R`\frac{a}{b} + c`)
    expect(b[2] - b[0]).toBeGreaterThan(1)
    expect(b[2] - b[0]).toBeLessThan(6)
    expect(typeof slots.box).toBe('function') // filled by the import at the top of this file
  })
})
