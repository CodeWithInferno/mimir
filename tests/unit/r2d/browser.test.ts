// The drawing side, in a real browser: examples/shapes.scene.js through the CLI and through a viewer session. It
// proves what bun cannot see: the embedded faces are the ones in use, what is measured is what is drawn, text is
// written on glyph by glyph, and lines and text keep their size under the 2D zoom.
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openSession, type Session } from '../../../src/cli/session.ts'
import { resolveScene } from '../../../src/cli/paths.ts'
import { faceOf, FONT_TEXT, lineMetrics } from '../../../src/r2d/index.ts'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const SCENE = join(ROOT, 'examples', 'shapes.scene.js')
const HAVE = existsSync(join(ROOT, 'scripts', 'build.ts')) && existsSync(SCENE)
const T = 120_000

async function mimir(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([join(ROOT, 'bin', 'mimir'), ...args], { cwd: ROOT, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
const open = (): Promise<Session> => openSession({ scene: resolveScene(SCENE, ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
const at = async (s: Session, tau: number): Promise<void> => { await s.host('seek', tau); await s.host('frame') }
const evaluate = <R>(s: Session, body: string): Promise<R> => s.page.evaluate<string>(`JSON.stringify((() => { ${body} })())`, T).then((raw) => JSON.parse(raw) as R)

describe.skipIf(!HAVE)('the 2D layer in a browser', () => {
  test('the example is clean under check (this also builds dist/ when it is stale)', async () => {
    const r = await mimir(['check', SCENE, '--all', '--json'])
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, errors: 0, warnings: 0 })
    expect(r.code).toBe(0)
  }, T)

  test('fonts: the faces chunk is loaded before anything is drawn, the stage carries the variables, and glyphs come from the embedded faces', async () => {
    const s = await open()
    try {
      const info = await s.host<{ chunks: string[] }>('info')
      expect(info.chunks).toEqual(['fonts', 'guide', 'shapes']) // the example also speaks (guide)
      const seen = await evaluate<{ faces: string[]; text: string; math: string; a: number; mono: number; bold: number; italic: number; x: number }>(s, `
        const g = document.createElement('canvas').getContext('2d')
        const w = (font, t) => { g.font = font; return g.measureText(t).width }
        const stage = getComputedStyle(document.querySelector('.mimir-stage'))
        return {
          faces: [...document.fonts].map((f) => f.family + ' ' + f.weight + ' ' + f.style + ' ' + f.status),
          text: stage.getPropertyValue('--mimir-font-text'), math: stage.getPropertyValue('--mimir-font-math'),
          // a missing face would fall through to the monospace one, which is 60 wide
          a: w('100px KaTeX_Main, monospace', 'A'), mono: w('100px monospace', 'A'),
          bold: w('bold 100px KaTeX_Main, monospace', '0'), italic: w('italic 100px KaTeX_Main, monospace', '0'), x: w('italic 100px KaTeX_Math, monospace', 'x'),
        }`)
      expect(seen.faces).toEqual(['KaTeX_Main 400 normal loaded', 'KaTeX_Main 400 italic loaded', 'KaTeX_Main 700 normal loaded', 'KaTeX_Math 400 italic loaded'])
      expect(seen.text).toBe(FONT_TEXT)
      expect(seen.math.startsWith('KaTeX_Math')).toBe(true)
      expect(seen.a).toBeCloseTo(75, 1) // hmtx of KaTeX_Main-Regular: 750
      expect(seen.mono).not.toBeCloseTo(75, 1)
      expect(seen.bold).toBeCloseTo(57.5, 1)
      expect(seen.italic).toBeCloseTo(51.1, 1)
      expect(seen.x).toBeCloseTo(57.2, 1)
      expect(s.consoleErrors).toEqual([])
    } finally { await s.close() }
  }, T)

  test('what is measured is what is drawn: the width of a text from the tables is its width in the DOM, kerning included', async () => {
    const s = await open()
    try {
      await at(s, 5.5) // end of step 1: the ladder and the faces are there
      const drawn = await evaluate<{ text: string; em: number }[]>(s, `
        return [...document.querySelectorAll('.mimir-2d [data-node] text:last-of-type')].filter((t) => t.closest('g[data-node]').style.display !== 'none' && t.querySelectorAll(':scope > tspan').length === 1)
          .map((t) => ({ text: t.textContent, em: t.getBBox().width / parseFloat(t.getAttribute('font-size')), weight: t.getAttribute('font-weight'), style: t.getAttribute('font-style') }))
          .filter((t) => !t.weight && !t.style)`)
      // getBBox is the box of the glyph cells as they are placed: advances plus the kerning that rides on dx
      const roman = faceOf('serif', 'normal', false)
      const checked = drawn.filter((d) => /^[\x20-\x7e]+$/.test(d.text))
      expect(checked.map((d) => d.text)).toEqual(expect.arrayContaining(['The 2D frame', 'title', 'section', 'body', 'label', 'Roman 0123456789']))
      expect(lineMetrics('body', roman).dx).toEqual([0, 0.028, 0.028, 0]) // a kerned word, written on (one element per glyph)
      for (const d of checked) expect(Math.abs(d.em - lineMetrics(d.text, roman).width)).toBeLessThan(0.01 + 0.002 * d.text.length)
    } finally { await s.close() }
  }, T)

  test('write: every glyph is traced, then filled, one after the other; nothing of it is left afterwards', async () => {
    const s = await open()
    try {
      const glyphs = (): Promise<{ ch: string; dash: string | null; fill: string | null; stroke: string | null }[]> => evaluate(s, `
        return [...document.querySelectorAll('[data-node="title"] text:last-of-type > tspan > tspan')].filter((g) => g.textContent.trim())
          .map((g) => ({ ch: g.textContent, dash: g.getAttribute('stroke-dasharray'), fill: g.getAttribute('fill-opacity'), stroke: g.getAttribute('stroke') }))`)
      await at(s, 0.45) // into the one second of write(title): 10 glyphs, lag 0.2, so glyph i is at 1.26 − 0.2 i of its own time
      const mid = await glyphs()
      expect(mid.map((g) => g.ch).join('')).toBe('The2Dframe')
      // 'T', 'h' are done; 'e', '2' are filling; 'D', 'f', 'r' are being traced, the earlier ones further along; 'a', 'm', 'e' have not begun
      expect(mid.slice(0, 2).every((g) => g.dash === null && g.fill === null && g.stroke === null)).toBe(true)
      expect(mid.slice(2, 7).every((g) => g.dash !== null && g.stroke !== null)).toBe(true)
      expect(Number(mid[2]!.fill)).toBeCloseTo(0.72, 2)
      expect(Number(mid[3]!.fill)).toBeCloseTo(0.32, 2)
      expect(mid.slice(4, 7).every((g) => Number(g.fill) === 0)).toBe(true)
      const traced = mid.slice(4, 7).map((g) => parseFloat(g.dash!))
      expect(traced[0]!).toBeGreaterThan(traced[1]!)
      expect(traced[1]!).toBeGreaterThan(traced[2]!)
      expect(mid.slice(7).every((g) => g.fill === '0' && g.dash === null)).toBe(true)
      await at(s, 2)
      expect((await glyphs()).every((g) => g.dash === null && g.fill === null && g.stroke === null)).toBe(true)
      // back in time: the same state as before, whatever was shown in between
      await at(s, 0.45)
      expect(await glyphs()).toEqual(mid)
    } finally { await s.close() }
  }, T)

  test('zoom: outlines keep their width and text its size on screen, except text that asked to grow', async () => {
    const s = await open()
    try {
      const read = (): Promise<{ tile: number; stroke: number; number: number; note: number; title: number }> => evaluate(s, `
        const box = (sel) => document.querySelector(sel).getBoundingClientRect()
        const tile = document.querySelector('[data-node="tile5"] rect')
        const notes = [...document.querySelectorAll('.mimir-2d g[data-node^="text"]')].filter((g) => g.style.display !== 'none')
        const find = (t) => notes.find((g) => g.textContent === t)
        return {
          tile: tile.getBoundingClientRect().width,
          // width on screen = the attribute times the scale of the holder
          stroke: parseFloat(tile.getAttribute('stroke-width')) * tile.getCTM().a,
          number: find('5').querySelector('text:last-of-type').getBBox().height * find('5').querySelector('text:last-of-type').getCTM().d,
          note: find('grid(items, { columns: 3 })').querySelector('text:last-of-type').getBBox().height * find('grid(items, { columns: 3 })').querySelector('text:last-of-type').getCTM().d,
          title: box('[data-node="title"]').height,
        }`)
      await at(s, 35.4) // end of step 5
      const before = await read()
      await at(s, 43) // end of step 6: zoomed in on the grid
      const after = await read()
      const zoom = after.tile / before.tile
      expect(zoom).toBeGreaterThan(1.5)
      expect(after.stroke).toBeCloseTo(before.stroke, 2)
      expect(after.note).toBeCloseTo(before.note, 1)
      expect(after.title).toBeCloseTo(before.title, 1)
      expect(after.number / before.number).toBeCloseTo(zoom, 1)
    } finally { await s.close() }
  }, T)
})
