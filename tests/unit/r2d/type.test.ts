// Typography, pure side: the metrics of the embedded faces, kerning, the faces chunk and when a scene asks for it.
import { describe, expect, test } from 'bun:test'
import { compile, kindOf, scene, setMeasurer, emOf, type MNode } from '../../../src/core/index.ts'
import {
  clearLineCache, faceOf, FONT_CHUNK, FONT_FAMILY_MATH, FONT_FAMILY_TEXT, FONT_MATH, FONT_TEXT, FONT_VARS, FONTS, layoutText, lineMetrics, LINE_CACHE_SIZE, rect, text, TEXT_BOX_EM,
} from '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import { FACES } from '../../../src/r2d/fontdata.ts'
import { registerFonts } from '../../../src/r2d/fonts.chunk.ts'

const build = (fn: (s: any) => void) => compile(scene({ title: 'type' }, fn))
const roman = faceOf('serif', 'normal', false)

describe('metrics of the embedded faces', () => {
  test('widths come from the font tables: the same answer with and without a browser', () => {
    expect(lineMetrics('', roman)).toEqual({ width: 0, dx: null })
    expect(lineMetrics(' ', roman).width).toBeCloseTo(0.25, 6)
    expect(lineMetrics('M', roman).width).toBeCloseTo(0.917, 6)
    expect(lineMetrics('i', roman).width).toBeCloseTo(0.278, 6)
    // measured in headless Chrome with the embedded face: getComputedTextLength() / font-size = 11.5333 em
    expect(lineMetrics('Every shape has an outline', roman).width).toBeCloseTo(11.53, 2)
  })
  test('figures are tabular in every face: a changing number does not move its neighbours', () => {
    for (const face of [roman, faceOf('serif', 'bold', false), faceOf('serif', 'normal', true), faceOf('math', 'normal', false)]) {
      const widths = [...'0123456789'].map((d) => lineMetrics(d, face).width)
      expect(new Set(widths).size).toBe(1)
      expect(lineMetrics('1111', face).width).toBeCloseTo(lineMetrics('8888', face).width, 9)
    }
    expect(lineMetrics('0', roman).width).toBeCloseTo(0.5, 6)
    expect(lineMetrics('0', faceOf('serif', 'bold', false)).width).toBeCloseTo(0.575, 6)
  })
  test("kerning is Computer Modern's (the faces carry none): pairs pull together, as a dx list per character", () => {
    const av = lineMetrics('AV', roman)
    expect(av.dx).toEqual([0, -0.111])
    expect(av.width).toBeCloseTo(0.75 + 0.75 - 0.111, 6)
    expect(lineMetrics('To', roman).dx).toEqual([0, -0.083])
    expect(lineMetrics('look', roman).dx).toEqual([0, 0, 0.028, 0]) // TeX opens "oo" a little
    expect(lineMetrics('mmm', roman).dx).toBeNull()
    // bold and italic have their own pairs; the math face and the system stacks have none
    expect(lineMetrics('AV', faceOf('serif', 'bold', false)).dx![1]).toBeLessThan(0)
    expect(lineMetrics('AV', faceOf('math', 'normal', false)).dx).toBeNull()
    expect(lineMetrics('AV', faceOf('sans', 'normal', false)).dx).toBeNull()
  })
  test('faces: what the options choose, and what a face lacks falls through like the font stack does', () => {
    expect(roman).toMatchObject({ family: FONT_TEXT, weight: 'normal', italic: false })
    expect(faceOf('serif', 'bold', false)).toMatchObject({ weight: 'bold', kern: 'bold' })
    expect(faceOf('serif', 'normal', true)).toMatchObject({ italic: true, kern: 'italic' })
    expect(faceOf('math', 'bold', false)).toMatchObject({ family: FONT_MATH, weight: 'normal', italic: true }) // one cut
    expect(faceOf('mono', 'normal', false).tables).toEqual([])
    expect(FONT_TEXT.startsWith(`${FONT_FAMILY_TEXT}, ${FONT_FAMILY_MATH}`)).toBe(true)
    expect(FONTS.serif).toBe(FONT_TEXT)
    expect(FONT_VARS).toEqual({ text: '--mimir-font-text', math: '--mimir-font-math' })
    // θ is not in the text face: its width is the math face's, exactly
    expect(lineMetrics('θ', roman).width).toBeCloseTo(0.469, 6)
    // '(' is not in the math face: its width is the text face's
    expect(lineMetrics('(', faceOf('math', 'normal', false)).width).toBeCloseTo(0.389, 6)
  })
  test('a character no embedded face has, and a font that is not embedded, are asked of the measurer', () => {
    const asked: string[] = []
    setMeasurer((t, weight, font) => { asked.push(`${t}|${weight}|${font.slice(0, 10)}`); return { width: 0.7 * t.length, ascent: 0.7, descent: 0.2 } })
    clearLineCache()
    try {
      expect(lineMetrics('aé', roman).width).toBeCloseTo(0.5 + 0.7, 6)
      expect(asked).toEqual(['é|normal|KaTeX_Main'])
      expect(lineMetrics('ab', faceOf('sans', 'bold', true)).width).toBeCloseTo(1.4, 6)
      expect(asked[1]).toBe('ab|italic bold|ui-sans-se')
    } finally { setMeasurer(null); clearLineCache() }
  })
  test('the cache of measured lines is bounded', () => {
    clearLineCache()
    for (let i = 0; i < LINE_CACHE_SIZE + 50; i++) lineMetrics('n' + i, roman)
    expect(lineMetrics('n7', roman).width).toBeGreaterThan(0) // still answers after the cache was emptied
    clearLineCache()
  })
})

describe('text()', () => {
  test('sizes are the ladder; the box is the widest line by the lines', () => {
    let t: MNode
    const m = build(() => { t = text('AV\nmmm', { size: 'title' }) })
    const lay = layoutText(m.state(0).props(t!))
    expect(lay.em).toBeCloseTo(emOf(72), 9)
    expect(lay.lines).toEqual(['AV', 'mmm'])
    expect(lay.width).toBeCloseTo(3 * 0.833 * emOf(72), 4)
    expect(lay.height).toBeCloseTo((1.25 + TEXT_BOX_EM) * emOf(72), 9)
    const b = m.state(0).bounds(t!)
    expect(b.max[0] - b.min[0]).toBeCloseTo(lay.width, 9)
    expect(m.diagnostics.list).toEqual([])
  })
  test('options: italic, math, align, backstroke, scaleWithZoom; a wrong one is reported and the text is still there', () => {
    let a: MNode, b: MNode
    const m = build(() => {
      a = text('x', { font: 'math', italic: true, align: 'left', backstroke: 0, scaleWithZoom: true })
      b = text('y', { font: 'fraktur', align: 'justify' })
    })
    expect(m.state(0).props(a!)).toMatchObject({ font: 'math', italic: true, align: 'left', backstroke: 0, scaleWithZoom: true })
    expect(m.diagnostics.list.map((d) => [d.code, d.ids])).toEqual([['API-UNKNOWN', [b!.id]], ['API-UNKNOWN', [b!.id]]])
    expect(m.state(0).props(b!)).toMatchObject({ font: 'serif', align: 'center', backstroke: 5 })
  })
  test('text keeps its size on screen under the 2D zoom, unless it asked to grow with the picture; hud text is not touched', () => {
    let plain: MNode, grows: MNode, hud: MNode, box: MNode
    const m = build((s) => {
      box = rect({ width: 2, height: 1 }).at(2, 1)
      plain = text('label').at(2, 1)
      grows = text('label', { scaleWithZoom: true }).at(2, -1)
      hud = text('label').at(-3, 3).hud()
      s.step('before', (st: any) => { st.wait(1) })
      s.step('in', (st: any) => { st.zoom([2, 0], { zoom: 4, duration: 0 }) })
    })
    const before = m.state(0.5), after = m.state(m.duration)
    expect(before.camera2d().zoom).toBe(1)
    expect(after.camera2d().zoom).toBe(4)
    const w = (f: typeof before, n: MNode): number => f.frameRect(n)!.width
    expect(w(after, plain!)).toBeCloseTo(w(before, plain!), 9) // same size on screen
    expect(w(after, grows!)).toBeCloseTo(4 * w(before, grows!), 9)
    expect(w(after, hud!)).toBeCloseTo(w(before, hud!), 9)
    expect(w(after, box!)).toBeCloseTo(4 * w(before, box!), 9)
    // … and it stays centred where it was put
    const r = after.frameRect(plain!)!, c = after.toScreen([2, 1])
    expect(r.x + r.width / 2).toBeCloseTo(c[0], 9)
    expect(r.y + r.height / 2).toBeCloseTo(c[1], 9)
  })
  test('the 2D camera can frame a text: it is measured at its natural size, and is not taken for something that follows the camera', () => {
    let t: MNode
    const m = build((s) => {
      t = text('a label to look at').at(3, 2)
      s.step('in', (st: any) => { st.zoom(t, { duration: 0 }) })
    })
    const f = m.state(m.duration)
    expect(m.diagnostics.list).toEqual([])
    expect(f.camera2d().zoom).toBeGreaterThan(1)
    const r = f.frameRect(t!)!
    expect(r.x + r.width / 2).toBeCloseTo(0, 9)
    expect(r.y + r.height / 2).toBeCloseTo(0, 9)
  })
})

describe('the faces chunk', () => {
  test('four faces, woff2, under the family names the stacks start with', () => {
    expect(FACES.map((f) => `${f.family} ${f.weight} ${f.style}`)).toEqual(['KaTeX_Main 400 normal', 'KaTeX_Main 400 italic', 'KaTeX_Main 700 normal', 'KaTeX_Math 400 italic'])
    for (const f of FACES) {
      expect(atob(f.data).slice(0, 4)).toBe('wOF2')
      expect(f.data.length).toBeGreaterThan(20000)
    }
  })
  test('importing the chunk without a document does nothing and does not throw', async () => {
    await registerFonts({} as Document) // no FontFace under bun: a no-op
    expect(typeof registerFonts).toBe('function')
  })
  test('a scene asks for the faces when it shows text or says something, and only then', () => {
    expect(kindOf('text')!.chunks).toEqual([FONT_CHUNK])
    expect(build(() => { rect() }).chunksNeeded()).toEqual([])
    expect(build(() => { text('a') }).chunksNeeded()).toEqual([FONT_CHUNK])
    expect(build((s) => { rect(); s.step('one', (st: any) => { st.wait(1) }) }).chunksNeeded()).toEqual([])
    expect(build((s) => { rect(); s.step('one', (st: any) => { st.say('A rectangle.') }) }).chunksNeeded()).toEqual([FONT_CHUNK, 'guide']) // the caption's faces, and the guide that draws it
  })
})
