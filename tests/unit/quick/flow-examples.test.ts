// The flow / chart / layers examples in the real viewer, as they are shipped: each renders, `mimir check` is clean,
// and the frames at the ends of three steps differ.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const mimir = join(root, 'bin', 'mimir')
const work = mkdtempSync(join(tmpdir(), 'mimir-quick-'))
const run = (args: string[]): { code: number; out: string } => { const p = Bun.spawnSync(args, { cwd: root, stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() } }
const sceneOf = (name: string): string => join(root, 'examples', `${name}.scene.js`)

describe.each(['quick-job-queue', 'quick-request-flow', 'quick-gradient-descent', 'quick-neural-network'])('%s', (name) => {
  test('is short', () => {
    const lines = readFileSync(join(root, 'examples', `${name}.scene.js`), 'utf8').trimEnd().split('\n').length
    expect(lines).toBeLessThanOrEqual(40)
  })
  test('check is clean', () => {
    const r = run([mimir, 'check', sceneOf(name), '--text', '--all'])
    expect(r.out).toContain('OK 0 errors, 0 warnings')
    expect(r.code).toBe(0)
  }, 120_000)
  test('frames at three steps differ', () => {
    const out = join(work, name)
    const r = run([mimir, 'shot', sceneOf(name), '--steps', '--out', out, '--json'])
    expect(r.code).toBe(0)
    const frames = (JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as { sha256: string; step?: number }[]).filter((f) => f.step !== undefined)
    expect(frames.length).toBeGreaterThanOrEqual(5)
    expect(new Set([frames[0]!.sha256, frames[Math.floor(frames.length / 2)]!.sha256, frames[frames.length - 1]!.sha256]).size).toBe(3)
  }, 120_000)
})
