// docs/CONFIG.md is generated from the defaults the modules register (defineConfig) and the comments on them. This
// file keeps the two from drifting: the document on disk is what the build would write now, every setting of the core
// is documented, and the groups the brief names are there (pacing, type scale, camera, viewer, the 3D look, the guide).
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const printed = (() => {
  const run = Bun.spawnSync([process.execPath, join(ROOT, 'scripts', 'build.ts'), '--print-config'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString()
})()
const rows = [...printed.matchAll(/^\| `([^`]+)` \| `(.*?)` \| (.*) \|$/gm)].map((m) => ({ key: m[1]!, value: m[2]!, doc: m[3]! }))

describe('docs/CONFIG.md', () => {
  test('is exactly what the build writes from the registered defaults (run `bun scripts/build.ts` after changing a default)', () => {
    expect(readFileSync(join(ROOT, 'docs', 'CONFIG.md'), 'utf8')).toBe(printed)
  })
  test('lists every registered setting once, with its default', async () => {
    await import('../../../src/index.ts').catch(() => {}) // the barrel needs a DOM-free import of every module: the modules below are enough when it does not load
    const core = await import('../../../src/core/index.ts')
    for (const m of ['r2d', 'r3d', 'anim', 'guide', 'host', 'check']) await import(`../../../src/${m}/index.ts`)
    await import('../../../src/r3d/look.ts')
    // what the modules under src/ registered (other test files of the same run register groups of their own)
    const fromSrc = new Set(core.registrations().filter((r) => r.registry === 'config' && /\/src\/[^/]+\/[^/]+\.ts:/.test(r.site ?? '')).map((r) => r.name))
    const registered = core.allConfig().filter(([key]) => fromSrc.has(key))
    expect(registered.length).toBeGreaterThan(30)
    const keys = rows.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const [key, value] of registered) {
      const row = rows.find((r) => r.key === key)
      expect(row, key).toBeDefined()
      const shown = JSON.stringify(value)
      expect(row!.value.replace(/\\\|/g, '|'), key).toBe(shown.length > 60 ? shown.slice(0, 57) + '…' : shown)
    }
  })
  test('pacing, the type scale, the camera and the viewer are documented key by key', () => {
    for (const key of ['pace.play', 'pace.camera', 'pace.hold', 'pace.lag', 'pace.sweep', 'pace.chapterClear', 'text.size.title', 'text.size.body', 'camera.fov', 'camera.view', 'viewer.autoplay', 'viewer.mode']) {
      expect(rows.find((r) => r.key === key)?.doc ?? '', key).not.toBe('')
    }
    // every setting of the modules this pass owns carries its own comment
    const own = rows.filter((r) => /^(pace|text|camera|viewer)\./.test(r.key))
    expect(own.filter((r) => r.doc === '').map((r) => r.key)).toEqual([])
    expect(new Set(own.map((r) => r.doc)).size).toBe(own.length) // and no two share one (a comment that slid onto the next key)
  })
  test('the 3D look and the guide are in the store', () => {
    for (const key of ['look.creaseDeg', 'look.light.keyGain', 'look.role.housing.base', 'look.line.sigma', 'look.cut.soft', 'guide.hop', 'guide.charactersPerSecond', 'guide.captions']) expect(rows.some((r) => r.key === key), key).toBe(true)
    expect(rows.find((r) => r.key === 'look.creaseDeg')!.doc).toContain('one threshold, in degrees')
    expect(rows.find((r) => r.key === 'guide.hop')!.doc).not.toBe('')
  })
})
