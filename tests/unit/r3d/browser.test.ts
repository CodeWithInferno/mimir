// The 3D look in the real viewer (headless browser): what only pixels can show.
// A section plane caps every closed solid of a part, the copies of an instanced one too (the balls of a bearing): the
// cut face of a ball is the same flat, hatched face as that of the races. Skipped, visibly, when the CLI or a browser is not there.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openSession, type Session } from '../../../src/cli/session.ts'
import { resolveScene } from '../../../src/cli/paths.ts'
import { findChrome } from '../../../src/cli/chrome.ts'
import { COUNT_VERT } from '../../../src/r3d/shaders.ts'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const HAVE = existsSync(join(ROOT, 'bin', 'mimir')) && existsSync(join(ROOT, 'scripts', 'build.ts')) && (() => { try { return !!findChrome() } catch { return false } })()
const WORK = mkdtempSync(join(tmpdir(), 'mimir-r3d-'))
const T = 180_000

/**
 * Decode a screenshot in the page and compare two places of it: the section face of the outer race (a ring just
 * inside the outside of the bearing) and the face of the ball at 3 o'clock. Returns the share of the ball's pixels
 * whose colour also occurs on the race's section face (fill, hatch line, or a blend of the two at a line's edge).
 * Sizes are read off the picture: the bearing is the only thing in it, its outside radius is 1.6 units.
 */
const compare = (png: Uint8Array): string => `(async () => {
  const img = new Image()
  img.src = 'data:image/png;base64,${Buffer.from(png).toString('base64')}'
  await img.decode()
  const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d')
  g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, img.width, img.height).data
  const at = (x, y) => { const i = 4 * (Math.round(y) * img.width + Math.round(x)); return [d[i], d[i + 1], d[i + 2]] }
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const p = at(x, y); if (p[0] + p[1] + p[2] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y } }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, unit = (x1 - x0) / 2 / 1.6
  const race = []
  for (let a = 0; a < 360; a += 0.5) for (const r of [1.6 - 0.05, 1.6 - 0.08]) race.push(at(cx + r * unit * Math.cos(a * Math.PI / 180), cy + r * unit * Math.sin(a * Math.PI / 180)))
  const near = (p) => race.some((q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) <= 24)
  let same = 0, all = 0
  const bx = cx + 1.15 * unit, by = cy, rad = 0.13 * unit
  for (let y = by - rad; y <= by + rad; y++) for (let x = bx - rad; x <= bx + rad; x++) { if (Math.hypot(x - bx, y - by) > rad) continue; all++; if (near(at(x, y))) same++ }
  return JSON.stringify({ share: same / Math.max(all, 1), pixels: all, unit })
})()`

test('the section counters draw every copy of an instanced part where it stands', () => {
  expect(COUNT_VERT).toContain('USE_INSTANCING')
  expect(COUNT_VERT).toContain('instanceMatrix')
})

describe.skipIf(!HAVE)('section caps in the real viewer', () => {
  let session: Session
  let before: string | undefined
  let info: any
  beforeAll(async () => {
    const tmp = join(WORK, 'tmp')
    mkdirSync(tmp, { recursive: true })
    before = process.env.TMPDIR
    process.env.TMPDIR = tmp // the browser profile of this session goes into the directory this file removes
    session = await openSession({ scene: resolveScene(join(import.meta.dir, 'scenes', 'cut-copies.scene.js'), ROOT, 'shot'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
    info = await session.host<any>('info')
  }, T)
  afterAll(async () => {
    await session?.close()
    // give the process its own temp directory back: later test files must not inherit one that is gone
    if (before === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = before
    rmSync(WORK, { recursive: true, force: true })
  })
  const look = async (tau: number): Promise<{ share: number; pixels: number; unit: number }> => {
    await session.host('seek', tau)
    await session.host('frame')
    return JSON.parse(await session.page.evaluate<string>(compare(await session.page.screenshot(60_000)), 60_000))
  }

  test('a cut ball of a bearing shows the same section face as the races it runs in (it was an open bowl with its lit inside showing)', async () => {
    expect(info.fatal ?? null).toBeNull()
    const cut = await look(info.steps[1].t1 - 0.05)
    expect(cut.pixels).toBeGreaterThan(300) // the patch that is compared is really a patch
    // measured with the cap of instanced copies switched off: 0.81 (the lit inside of the bowl is shaded, the hatch
    // is missing); with it the patch is the section face
    expect(cut.share).toBeGreaterThan(0.97)
  }, T)
})
