// The guide in the real viewer (headless browser), on a fixture built to be in its way: the pointer never rests on
// text, a ring hugs a thin part, names stand in columns beside the figure with leaders that do not cross, a line
// carries its name, names are written glyph by glyph in the hue of their part and go to dust, a turn of the view
// moves the names without a hop, and the same time gives the same pixels in any order.
// Skipped, visibly, when the CLI or a browser is not there.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openSession, type Session } from '../../../src/cli/session.ts'
import { resolveScene } from '../../../src/cli/paths.ts'
import { findChrome } from '../../../src/cli/chrome.ts'
import { VIEWS } from '../../../src/core/index.ts'
import { GUIDE_DEFAULTS } from '../../../src/guide/index.ts'
import { segmentsCross } from '../../../src/guide/solver.ts'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const SCENE = join(import.meta.dir, 'scenes', 'marks.scene.js')
const HAVE = existsSync(join(ROOT, 'bin', 'mimir')) && existsSync(join(ROOT, 'scripts', 'build.ts')) && (() => { try { return !!findChrome() } catch { return false } })()
const WORK = mkdtempSync(join(tmpdir(), 'mimir-guide-'))
const T = 120_000
const PX = 90 // stage px per frame unit at 1280 x 720

interface Box { x: number; y: number; width: number; height: number }
interface Label { text: string; x: number; y: number; width: number; height: number; color: string; align: string; glyphs: number[] }
const hits = (a: Box, b: Box, air = 0): boolean => a.x < b.x + b.width + air && b.x < a.x + a.width + air && a.y < b.y + b.height + air && b.y < a.y + a.height + air

/** read by the page: what the guide drew, in stage px */
const PAGE = `(() => {
  const root = (name) => document.querySelector('[data-overlay="' + name + '"]')
  const o = root('guide.labels').getBoundingClientRect()
  const rel = (r) => ({ x: r.x - o.x, y: r.y - o.y, width: r.width, height: r.height })
  const labels = [...document.querySelectorAll('[data-overlay="guide.labels"] > div')].filter((d) => d.style.display !== 'none' && Number(d.style.opacity) > 0.5).map((d) => ({
    text: d.textContent, ...rel(d.getBoundingClientRect()), color: getComputedStyle(d).color, align: d.style.textAlign,
    glyphs: [...d.querySelectorAll('span > span')].map((g) => (g.style.opacity === '' ? 1 : Number(g.style.opacity))),
  }))
  const leaders = [...document.querySelectorAll('[data-overlay="guide.labels"] svg g')].map((g) => g.querySelector('path').getAttribute('d'))
  const dart = document.querySelector('[data-overlay="guide.pointer"] svg path[transform]')
  const marks = [...document.querySelectorAll('[data-overlay="guide.marks"] svg > path')].filter((p) => p.getAttribute('stroke') !== '#000').map((p) => ({ d: p.getAttribute('d'), box: rel(p.getBoundingClientRect()), stroke: p.getAttribute('stroke') }))
  const caption = [...document.querySelectorAll('[data-overlay="guide.caption"] > div')].filter((d) => d.style.display !== 'none').map((d) => rel(d.getBoundingClientRect()))[0] || null
  const nodes = {}
  for (const el of document.querySelectorAll('[data-node]')) nodes[el.getAttribute('data-node')] = rel(el.getBoundingClientRect())
  return JSON.stringify({ labels, leaders, dart: dart ? { box: rel(dart.getBoundingClientRect()), opacity: Number(dart.getAttribute('opacity')), transform: dart.getAttribute('transform') } : null, marks, caption, nodes })
})()`
interface Seen { labels: Label[]; leaders: string[]; dart: { box: Box; opacity: number; transform: string } | null; marks: { d: string; box: Box; stroke: string }[]; caption: Box | null; nodes: Record<string, Box> }

describe.skipIf(!HAVE)('the guide in the real viewer', () => {
  let session: Session
  let before: string | undefined
  let info: any
  const at = async (tau: number, view?: object | null): Promise<Seen> => {
    await session.host('seek', tau)
    if (view !== undefined) await session.host('setView', view)
    await session.host('frame')
    return JSON.parse(await session.page.evaluate<string>(PAGE, 20_000)) as Seen
  }
  const cue = (step: number, words: string): { land: number; fire: number; word: number } => info.guide.steps[step].cues.find((q: any) => q.words.startsWith(words))
  beforeAll(async () => {
    const tmp = join(WORK, 'tmp')
    mkdirSync(tmp, { recursive: true })
    before = process.env.TMPDIR
    process.env.TMPDIR = tmp // the browser profile of this session goes into the directory this file removes
    session = await openSession({ scene: resolveScene(SCENE, ROOT, 'shot'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
    info = await session.host<any>('info')
  }, T)
  afterAll(async () => {
    await session?.close()
    // give the process its own temp directory back: later test files must not inherit one that is gone
    if (before === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = before
    rmSync(WORK, { recursive: true, force: true })
  })

  test('the scene loads clean', () => {
    expect(info.fatal ?? null).toBeNull()
    expect(info.guide.steps.length).toBe(3)
    expect(session.consoleErrors).toEqual([])
  })

  test('a resting pointer covers no text: not the words under and beside its box, not a number it names, not a label, not the caption', async () => {
    const texts = ['below', 'beside', 'value']
    for (const [words, own] of [['box', null], ['number', 'value'], ['bar', null], ['knob', null]] as const) {
      const q = cue(0, words)
      for (const dt of [0.02, 0.2, 0.33]) { // from touch-down to just before it leaves again
        const seen = await at(q.land + dt)
        expect(seen.dart).not.toBeNull()
        expect(seen.dart!.opacity).toBeGreaterThan(0.9)
        const body = seen.dart!.box
        for (const id of texts) {
          // the pointer may touch the edge of the words it names (it points at them); it never lies on them
          const box = seen.nodes[id]!
          const inner = id === own ? { x: box.x + 3, y: box.y + 3, width: box.width - 6, height: box.height - 6 } : box
          expect([words, dt, id, hits(body, inner)]).toEqual([words, dt, id, false])
        }
        for (const l of seen.labels) expect([words, dt, l.text, hits(body, l)]).toEqual([words, dt, l.text, false])
        if (seen.caption) expect([words, dt, 'caption', hits(body, seen.caption)]).toEqual([words, dt, 'caption', false])
        expect(body.x >= 0 && body.y >= 0 && body.x + body.width <= 1280 && body.y + body.height <= 720).toBe(true)
      }
    }
    // by default it would hang below right of the box, on "words under the box": that side was really taken
    const seen = await at(cue(0, 'box').land + 0.2)
    const target = seen.nodes.target!, below = seen.nodes.below!
    expect(hits({ x: target.x + target.width * 0.6, y: target.y + target.height, width: 20, height: 20 }, below)).toBe(true)
  }, T)

  test('a ring hugs a thin part: a capsule as wide as the part, not an ellipse round its box', async () => {
    const q = cue(0, 'bar')
    const seen = await at(q.land + GUIDE_DEFAULTS.drawTime + 0.05)
    const bar = seen.nodes.bar!, pad = GUIDE_DEFAULTS.ringPad * PX
    const ring = seen.marks.find((m) => hits(m.box, bar) && m.box.height > bar.height)!
    expect(ring).toBeDefined()
    // the stroke of the bar itself is in its DOM box, and the ring's stroke in the ring's: a few px of slack
    expect(Math.abs(ring.box.width - (bar.width + 2 * pad))).toBeLessThan(6)
    expect(Math.abs(ring.box.height - (bar.height + 2 * pad))).toBeLessThan(6)
    // the ellipse that was drawn before (1.22 x the box + pad) would be 60 px taller
    expect(ring.box.height).toBeLessThan(bar.height * 1.22 + 2 * pad - 30)
    expect(ring.d).toContain('L') // straight sides
    // and round a 3D post seen at an angle: tall and narrow, with straight sides
    const post = await at(cue(1, 'post').land + GUIDE_DEFAULTS.drawTime + 0.05)
    const hug = post.marks.find((m) => m.d.includes('A') && m.box.height > 200)!
    expect(hug).toBeDefined()
    expect(hug.box.height / hug.box.width).toBeGreaterThan(3)
    expect(hug.d).toContain('L')
  }, T)

  test('names stand in two columns beside the figure, inside the free stage, on no text, and their leaders do not cross', async () => {
    const end = info.steps[0].t1 - 0.05
    const seen = await at(end)
    const names = seen.labels.filter((l) => l.text !== 'a wire')
    expect(names.map((l) => l.text).sort()).toEqual(['base plate', 'beam', 'left post', 'right post', 'weight'])
    // two columns: left names are right-aligned and end on one line, right names start on one line
    const left = names.filter((l) => l.align === 'right'), right = names.filter((l) => l.align === 'left')
    expect(left.length + right.length).toBe(names.length)
    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
    expect(Math.max(...left.map((l) => l.x + l.width)) - Math.min(...left.map((l) => l.x + l.width))).toBeLessThanOrEqual(1)
    expect(Math.max(...right.map((l) => l.x)) - Math.min(...right.map((l) => l.x))).toBeLessThanOrEqual(1)
    // each on the side its part is nearer to
    expect(left.map((l) => l.text).sort()).toEqual(['base plate', 'beam', 'left post'])
    expect(right.map((l) => l.text).sort()).toEqual(['right post', 'weight'])
    const safeX = (14.2222 / 2 - 6.6) * PX, safeY = (8 / 2 - 3.5) * PX
    for (const l of seen.labels) {
      expect(l.x >= safeX - 1 && l.x + l.width <= 1280 - safeX + 1 && l.y >= safeY - 1).toBe(true)
      if (seen.caption) expect(l.y + l.height <= seen.caption.y).toBe(true)
      for (const id of ['below', 'beside', 'value']) expect([l.text, id, hits(l, seen.nodes[id]!)]).toEqual([l.text, id, false])
    }
    for (let i = 0; i < seen.labels.length; i++) for (let j = i + 1; j < seen.labels.length; j++) expect([seen.labels[i]!.text, seen.labels[j]!.text, hits(seen.labels[i]!, seen.labels[j]!)]).toEqual([seen.labels[i]!.text, seen.labels[j]!.text, false])
    // leaders: M tip L elbow L end. No oblique segment crosses another
    const segs = seen.leaders.map((d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })))
    expect(segs.length).toBe(names.length)
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) expect(segmentsCross(segs[i]![0]!, segs[i]![1]!, segs[j]![0]!, segs[j]![1]!)).toBe(false)
    // every leader ends on its part: the id under its tip is a part of the figure (never the background)
    for (const s of segs) expect(await session.host<string | null>('pick', s[0]!.x, s[0]!.y)).not.toBeNull()
  }, T)

  test('a line carries its name: at its middle, just off it, with no leader', async () => {
    const seen = await at(info.steps[0].t1 - 0.05)
    const name = seen.labels.find((l) => l.text === 'a wire')!, wire = seen.nodes.wire!
    const mid = { x: wire.x + wire.width / 2, y: wire.y + wire.height / 2 }
    const centre = { x: name.x + name.width / 2, y: name.y + name.height / 2 }
    expect(Math.hypot(centre.x - mid.x, centre.y - mid.y)).toBeLessThan(name.width / 2 + name.height) // on the line, not out at a corner of its box
    expect(Math.hypot(centre.x - mid.x, centre.y - mid.y)).toBeGreaterThan(name.height / 2) // and off the stroke itself
    expect(seen.leaders.length).toBe(seen.labels.length - 1)
  }, T)

  test('a name is written glyph by glyph, in the hue of its part while its word is said, and goes to dust when the pointer moves on', async () => {
    const q = cue(0, 'weight'), next = cue(0, 'knob')
    const writing = await at(q.land + GUIDE_DEFAULTS.labelTextAt + GUIDE_DEFAULTS.labelText * 0.6)
    const w = writing.labels.find((l) => l.text === 'weight')!
    expect(w.glyphs.length).toBe(6)
    for (let i = 1; i < w.glyphs.length; i++) expect(w.glyphs[i]!).toBeLessThanOrEqual(w.glyphs[i - 1]!) // reading order
    expect(w.glyphs[0]!).toBeGreaterThan(0.9)
    expect(w.glyphs[5]!).toBeLessThan(0.5)
    const said = await at(q.land + GUIDE_DEFAULTS.labelTextAt + GUIDE_DEFAULTS.labelText + 0.2)
    const lit = said.labels.find((l) => l.text === 'weight')!
    expect(lit.glyphs.every((g) => g === 1)).toBe(true)
    const rgb = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const hue = rgb(lit.color)
    expect(Math.max(...hue) - Math.min(...hue)).toBeGreaterThan(60) // the teal of the weight
    const later = await at(next.fire + GUIDE_DEFAULTS.labelDust + 0.3)
    expect(rgb(later.labels.find((l) => l.text === 'weight')!.color)).toEqual([187, 187, 187]) // dust (#BBBBBB)
    expect(rgb(later.labels.find((l) => l.text === 'left post')!.color)).toEqual([187, 187, 187]) // a name nobody says is dust
  }, T)

  test('a long name is set on two lines', async () => {
    const seen = await at(info.steps[1].t1 - 0.05)
    const long = seen.labels.find((l) => l.text.replace(/\s+/g, ' ') === 'the weight that swings on the beam')!
    expect(long).toBeDefined()
    const one = seen.labels.find((l) => l.text === 'knob')!
    expect(long.height).toBeGreaterThan(one.height * 1.8)
    expect(long.width).toBeLessThanOrEqual(GUIDE_DEFAULTS.labelMaxWidth * PX + 1)
  }, T)

  test('a turn of the view moves the names without a hop: no name changes side, none jumps over another', async () => {
    const tau = info.steps[0].t1 - 0.05
    const first = await at(tau, null)
    const sideOf = (s: Seen): Record<string, string> => Object.fromEntries(s.labels.map((l) => [l.text, l.align]))
    let before = first, widest = 0
    for (let k = 1; k <= 30; k++) {
      const seen = await at(tau, { azimuth: VIEWS.iso!.azimuth + k * 2 })
      expect(sideOf(seen)).toEqual(sideOf(first))
      for (const l of seen.labels) { const was = before.labels.find((p) => p.text === l.text)!; widest = Math.max(widest, Math.abs(l.y - was.y), Math.abs(l.x - was.x)) }
      before = seen
    }
    // 2 degrees of orbit move a part of this figure by a few px; a name that changed places would move by a line (25 px) or a column (400 px)
    expect(widest).toBeLessThan(20)
    // and back at the story's own view everything is exactly where it was
    const back = await at(tau, null)
    expect(back.labels).toEqual(first.labels)
  }, T)

  test('the same time gives the same picture whatever was shown before, inside a labelled step and inside a camera move', async () => {
    const times = [info.steps[0].t0 + 3.1, info.steps[0].t0 + 6.4, info.steps[1].t0 + 0.9, info.steps[1].t0 + 1.7, info.steps[2].t0 + 2.2]
    const shot = async (tau: number): Promise<string> => { await session.host('seek', tau); await session.host('frame'); return Bun.hash(await session.page.screenshot(20_000)).toString(16) }
    await session.host('setView', null)
    const a: Record<number, string> = {}, b: Record<number, string> = {}
    for (const t of times) a[t] = await shot(t)
    for (const t of [...times].reverse()) b[t] = await shot(t)
    await shot(info.steps[2].t1 - 0.1)
    for (const t of [times[2]!, times[0]!, times[4]!, times[1]!, times[3]!]) expect([t, await shot(t)]).toEqual([t, a[t]!])
    expect(b).toEqual(a)
    expect(new Set(Object.values(a)).size).toBe(times.length)
  }, T)
})
