// The faces: the embedded files are KaTeX's own, the font plan never asks for less than a formula uses, and the
// few glyphs whose advance differs between KaTeX's metrics and the font files are known exactly.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FACE_GROUP, FONT_CHUNKS, UNUSED_FACES, faceCss, fontGroups, installFaces } from '../../../src/tex/index.ts'
import { FONT_ADVANCE, layoutTex } from '../../../src/tex/layout.ts'
import { FONT_CHUNK } from '../../../src/r2d/index.ts'
import { FACES as STAGE_FACES } from '../../../src/r2d/fontdata.ts'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const KATEX = join(ROOT, 'node_modules', 'katex')
const R = String.raw
const groupsOf = (faces: readonly string[]): string[] => [...new Set(faces.map((f) => FACE_GROUP[f] ?? `?${f}`))]

describe('tex faces', () => {
  test('every woff2 file of KaTeX that it sets anything in is in exactly one group, and every group is a chunk', () => {
    const files = readdirSync(join(KATEX, 'dist', 'fonts')).filter((f) => f.endsWith('.woff2')).map((f) => f.replace(/^KaTeX_/, '').replace(/\.woff2$/, '')).sort()
    expect([...Object.keys(FACE_GROUP), ...UNUSED_FACES].sort()).toEqual(files)
    for (const group of new Set(Object.values(FACE_GROUP))) {
      if (group === 'main') continue
      expect(FONT_CHUNKS[group]).toBe('tex' + group)
      expect(existsSync(join(ROOT, 'src', 'tex', `tex${group}.chunk.ts`))).toBe(true)
    }
    // the main group is the faces all stage text is set in: the 2D layer's chunk carries them, once, under the names KaTeX uses
    expect(FONT_CHUNKS.main).toBe(FONT_CHUNK)
    const stage = STAGE_FACES.map((f) => f.file.replace(/^KaTeX_/, '').replace(/\.woff2$/, '')).sort()
    expect(Object.keys(FACE_GROUP).filter((f) => FACE_GROUP[f] === 'main').sort()).toEqual(stage)
    for (const f of STAGE_FACES) { const css = faceCss(f.file.replace(/^KaTeX_/, '').replace(/\.woff2$/, '')); expect([f.family, f.weight === '700' ? 'bold' : 'normal', f.style]).toEqual([css.family, css.weight, css.style]) }
  })

  test('the embedded faces are the files of the installed katex package, byte for byte', async () => {
    for (const group of new Set(Object.values(FACE_GROUP))) {
      if (group === 'main') continue // embedded by src/r2d (tests/unit/r2d/type.test.ts compares those bytes)
      const mod = (await import(join(ROOT, 'src', 'tex', 'fonts', `${group}.ts`))) as { FACES: Record<string, string> }
      const faces = Object.keys(FACE_GROUP).filter((f) => FACE_GROUP[f] === group)
      expect(Object.keys(mod.FACES).sort()).toEqual(faces.sort())
      for (const face of faces) expect(mod.FACES[face] === readFileSync(join(KATEX, 'dist', 'fonts', `KaTeX_${face}.woff2`)).toString('base64')).toBe(true)
    }
  })

  test('faces are named as KaTeX\'s stylesheet names them', () => {
    expect(faceCss('Main-Regular')).toEqual({ family: 'KaTeX_Main', weight: 'normal', style: 'normal' })
    expect(faceCss('Math-Italic')).toEqual({ family: 'KaTeX_Math', weight: 'normal', style: 'italic' })
    expect(faceCss('Main-BoldItalic')).toEqual({ family: 'KaTeX_Main', weight: 'bold', style: 'italic' })
    expect(faceCss('Size3-Regular')).toEqual({ family: 'KaTeX_Size3', weight: 'normal', style: 'normal' })
  })

  test('without a document installing faces does nothing and does not throw', async () => {
    await installFaces({ 'Main-Regular': 'AAAA' })
  })
})

describe('tex font plan', () => {
  test('common formulas ask for what they use and no more', () => {
    const plan = (s: string): string[] => fontGroups(s).sort()
    expect(plan('E = mc^2')).toEqual(['main'])
    expect(plan(R`\frac{a}{b} + \sqrt{x} + \alpha \le \beta \to \infty`)).toEqual(['main'])
    expect(plan(R`\sum_{i=1}^n i`)).toEqual(['main', 'size'])
    expect(plan(R`\left( x \right)`)).toEqual(['main', 'size'])
    expect(plan(R`\begin{pmatrix} a \\ b \end{pmatrix}`)).toEqual(['main', 'size'])
    expect(plan(R`x \in \mathbb{R}`)).toEqual(['ams', 'main'])
    expect(plan(R`\mathbf{A}\vec{x}`)).toEqual(['bold', 'main'])
    expect(plan(R`\mathcal{L}`)).toEqual(['cal', 'main'])
    expect(plan(R`\mathsf{T} \texttt{code}`)).toEqual(['main', 'sans'])
    expect(plan('ℝ')).toContain('ams')
    expect(plan('∑')).toContain('size')
    // a source written as JavaScript (a function turned into text) has its backslashes doubled: the commands are still found
    expect(plan(String(() => `\\mathbb{R}^${3}`))).toContain('ams')
  })

  // every control sequence, environment and character KaTeX knows, set in the ways it can be used
  const names = new Set<string>()
  const grab = (text: string): void => { for (const m of text.matchAll(/"(\\\\[A-Za-z]+|\\\\[^A-Za-z@\s"])"/g)) names.add(m[1]!.replace(/\\\\/g, '\\')) }
  grab(readFileSync(join(KATEX, 'src', 'symbols.ts'), 'utf8'))
  grab(readFileSync(join(KATEX, 'src', 'macros.ts'), 'utf8'))
  for (const f of readdirSync(join(KATEX, 'src', 'functions'))) if (f.endsWith('.ts')) grab(readFileSync(join(KATEX, 'src', 'functions', f), 'utf8'))
  const environments = new Set<string>()
  for (const f of readdirSync(join(KATEX, 'src', 'environments'))) if (f.endsWith('.ts')) for (const m of readFileSync(join(KATEX, 'src', 'environments', f), 'utf8').matchAll(/"([A-Za-z]+\*?)"/g)) environments.add(m[1]!)
  // \message, \errmessage and \show print to the console
  const quiet = <T>(fn: () => T): T => { const log = console.log, warn = console.warn, error = console.error; console.log = console.warn = console.error = () => {}; try { return fn() } finally { console.log = log; console.warn = warn; console.error = error } }

  test(`the plan covers the faces of every command KaTeX knows (${names.size} names, ${environments.size} environments)`, () => {
    expect(names.size).toBeGreaterThan(900)
    const short: string[] = []
    let set = 0
    const tryOut = (source: string): boolean => {
      const l = quiet(() => layoutTex(source, true))
      if (l.error) return false
      const have = new Set(fontGroups(source))
      const missing = groupsOf(l.faces).filter((g) => !have.has(g))
      if (missing.length) short.push(`${source}: uses ${l.faces.join(', ')}; the plan lacks ${missing.join(', ')}`)
      return true
    }
    for (const n of names) {
      let ok = false
      for (const v of [n, `${n}{Aa1}`, `${n}{Aa1}{b}`, `${n} A`, `a ${n} b`, `\\left${n} a \\right.`, `\\text{${n}}`, `\\text{${n}{Aa}}`, `${n}[a]{b}`, `${n}{red}{a}`, `${n}{red}{blue}{a}`, `${n}{1em}{1em}`, `${n}|a|`]) ok = tryOut(v) || ok
      if (ok) set++
    }
    for (const e of environments) for (const body of ['a & b \\\\ c & d', 'a \\\\ b \\\\ c \\\\ d \\\\ e \\\\ f']) for (const v of [`\\begin{${e}}${body}\\end{${e}}`, `\\begin{${e}}{cc}${body}\\end{${e}}`, `\\begin{${e}}{2}${body}\\end{${e}}`]) tryOut(v)
    // nesting alphabets, and tall things
    for (const v of [R`\mathbf{\mathcal{A}}`, R`\boldsymbol{\mathcal{A}}`, R`\textbf{\textit{a}}`, R`\boldsymbol{\alpha x}`, R`\mathbf{\mathfrak{A}}`, R`\textsf{\textbf{a}\textit{b}}`, R`\mathbb{R}^n \to \mathcal{L}`, R`\sqrt{\frac{\frac{a}{b}}{\frac{c}{d}}}`, R`\Braket{a|b}`, R`\Set{x | y}`, R`\genfrac(){1pt}{0}{a}{b}`, R`\binom{\frac{a}{b}}{c}`, R`\lim_{x\to0}`, R`\pmod{n}`, R`\hbar \ell \wp \Re \Im \aleph \nabla \partial`, R`\not= \neq \notin \ne`, R`\vec{x} \widehat{abc} \overbrace{x}^{y} \xrightarrow{a}`, R`\cancel{x} \boxed{y}`]) expect(tryOut(v)).toBe(true)
    expect(short).toEqual([])
    expect(set).toBeGreaterThan(names.size - 60)
    // (a face that is not embedded would show up above as a group the plan lacks: '?Caligraphic-Bold')
  })

  test('the plan covers characters typed directly', () => {
    const short: string[] = []
    const probe = (cp: number): void => {
      const ch = String.fromCodePoint(cp)
      for (const source of [ch, `\\text{${ch}}`]) {
        const l = quiet(() => layoutTex(source, true))
        if (l.error) continue
        const have = new Set(fontGroups(source))
        const missing = groupsOf(l.faces).filter((g) => !have.has(g))
        if (missing.length) short.push(`U+${cp.toString(16)} ${ch}: uses ${l.faces.join(', ')}; the plan lacks ${missing.join(', ')}`)
      }
    }
    for (let cp = 0xa0; cp < 0x3000; cp++) probe(cp)
    for (let cp = 0x1d400; cp < 0x1d800; cp++) probe(cp)
    expect(short).toEqual([])
  })
})

describe('tex glyph advances', () => {
  /** advance widths of a TrueType file, by code point, in em */
  function advances(file: string): Map<number, number> {
    const b = readFileSync(file)
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const tables: Record<string, number> = {}
    for (let i = 0; i < v.getUint16(4); i++) { const o = 12 + i * 16; tables[String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!)] = v.getUint32(o + 8) }
    const upm = v.getUint16(tables.head! + 18), count = v.getUint16(tables.hhea! + 34)
    const adv = (g: number): number => v.getUint16(tables.hmtx! + 4 * Math.min(g, count - 1)) / upm
    const out = new Map<number, number>()
    const cmap = tables.cmap!
    for (let i = 0; i < v.getUint16(cmap + 2); i++) {
      const off = cmap + v.getUint32(cmap + 4 + i * 8 + 4)
      const format = v.getUint16(off)
      if (format === 4) {
        const seg = v.getUint16(off + 6) / 2
        for (let s = 0; s < seg; s++) {
          const end = v.getUint16(off + 14 + s * 2), start = v.getUint16(off + 16 + seg * 2 + s * 2), delta = v.getInt16(off + 16 + seg * 4 + s * 2), range = v.getUint16(off + 16 + seg * 6 + s * 2)
          for (let c = start; c <= end && c < 0xffff; c++) {
            let g = range === 0 ? (c + delta) & 0xffff : v.getUint16(off + 16 + seg * 6 + s * 2 + range + (c - start) * 2)
            if (range !== 0 && g) g = (g + delta) & 0xffff
            if (g) out.set(c, adv(g))
          }
        }
      } else if (format === 12) {
        for (let k = 0; k < v.getUint32(off + 12); k++) { const s = v.getUint32(off + 16 + k * 12), e = v.getUint32(off + 20 + k * 12), g0 = v.getUint32(off + 24 + k * 12); for (let c = s; c <= e; c++) out.set(c, adv(g0 + c - s)) }
      }
    }
    return out
  }

  test('FONT_ADVANCE lists every glyph whose advance in the font is not the width in KaTeX\'s metrics', async () => {
    const metrics = ((await import(join(KATEX, 'src', 'fontMetricsData.js'))) as { default: Record<string, Record<string, number[]>> }).default
    const differ: Record<string, number> = {}
    let checked = 0
    for (const file of readdirSync(join(KATEX, 'dist', 'fonts')).filter((f) => f.endsWith('.ttf'))) {
      const face = file.replace('KaTeX_', '').replace('.ttf', '')
      const table = metrics[face]
      if (!table) continue
      const inFont = advances(join(KATEX, 'dist', 'fonts', file))
      for (const [code, m] of Object.entries(table)) {
        const font = inFont.get(Number(code))
        if (font === undefined) continue
        checked++
        // a glyph with no advance is a combining accent: KaTeX sets it in a box of no width, so its metrics width is never used
        // (U+E020, the stroke of \not, is the reverse case and sits in a box of no width too)
        if (font === 0 || m[4] === 0) continue
        if (Math.abs(font - m[4]!) > 0.0015) differ[`${face}:${String.fromCodePoint(Number(code))}`] = Math.round(font * 1000) / 1000
      }
    }
    expect(checked).toBeGreaterThan(2000)
    expect(FONT_ADVANCE).toEqual(differ)
  })
})
