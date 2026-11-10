// End to end: `mimir new --once` through the real launcher and the REAL engine (the review is the point), with a
// stand-in for the model: a script that prints a canned answer. No model is called here; what a real one does is
// measured in docs/agents.md. After EVERY test: no browser started by the CLI may still be running.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pngSize } from '../../src/cli/png.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const EXAMPLES = join(ROOT, 'examples')

const WORK = mkdtempSync(join(realpathSync(tmpdir()), 'mimir-e2e-once-'))
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: TMP, MIMIR_LAUNCH_DEPTH: '0' }
for (const name of Object.keys(ENV)) if (name.startsWith('MIMIR_') && name !== 'MIMIR_LAUNCH_DEPTH' && name !== 'MIMIR_CHROME') delete ENV[name]

let dirCount = 0
const freshDir = (): string => {
  const d = join(WORK, `d${++dirCount}`)
  mkdirSync(d)
  return d
}
interface Result { code: number; stdout: string; stderr: string }
async function mimir(args: string[], opts: { env?: Record<string, string>; cwd?: string } = {}): Promise<Result> {
  const proc = Bun.spawn([BIN, ...args], { cwd: opts.cwd ?? WORK, env: { ...ENV, ...opts.env }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
const events = (r: Result): Array<Record<string, any>> => r.stdout.trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
function browsersRunning(): string[] {
  return Bun.spawnSync(['ps', '-axo', 'command=']).stdout.toString().split('\n').filter((l) => l.includes(WORK) && l.includes('--user-data-dir'))
}
afterEach(async () => {
  for (let i = 0; i < 40 && browsersRunning().length > 0; i++) await Bun.sleep(50)
  expect(browsersRunning()).toEqual([])
})
afterAll(() => rmSync(WORK, { recursive: true, force: true }))
const T = 240_000

/**
 * A stand-in for a model: it keeps what it was given on stdin (one file per call) and answers call k with the k-th
 * of `answers` (the last one again after that), each inside a fenced block with some chatter around it.
 */
function fakeWriter(dir: string, answers: string[]): string {
  answers.forEach((a, i) => writeFileSync(join(dir, `answer-${i + 1}.txt`), 'Here is the scene.\n\n```js\n' + a + '\n```\n\nIt should render as asked.\n'))
  const script = join(dir, 'fake-writer')
  writeFileSync(script, [
    '#!/bin/sh',
    `n=$(cat "${join(dir, 'count')}" 2>/dev/null || echo 0)`,
    'n=$((n + 1))',
    `echo "$n" > "${join(dir, 'count')}"`,
    `cat > "${join(dir, 'stdin')}-$n.txt"`,
    `k=$n; [ "$k" -gt ${answers.length} ] && k=${answers.length}`,
    `cat "${join(dir, 'answer')}-$k.txt"`,
    '',
  ].join('\n'))
  chmodSync(script, 0o755)
  return script
}
const example = (name: string): string => readFileSync(join(EXAMPLES, `${name}.scene.js`), 'utf8')

describe('mimir new --once', () => {
  test('a clean answer: one call, the scene on disk, reviewed by the real engine, a sheet rendered', async () => {
    const dir = freshDir()
    const writer = fakeWriter(dir, [example('hello-2d')])
    const r = await mimir(['new', 'how does a request queue work', '--once', '-o', 'out', '--json'], { cwd: dir, env: { MIMIR_WRITER_COMMAND: writer } })
    expect(r.code).toBe(0)
    const ev = events(r)
    const result = ev[ev.length - 1]!
    expect(result).toMatchObject({ event: 'result', ok: true, stage: 'ready', verdict: 'ready', mode: 'once', agent: 'command', turns: 1, first_review_clean: true, looked: false })
    expect(result.scene).toBe(join(dir, 'out', 'request-queue.scene.js'))
    expect(readFileSync(result.scene, 'utf8').trim()).toBe(example('hello-2d').trim())
    expect(result.check).toEqual({ ok: true, errors: 0, warnings: 0, flags: 0 })
    expect(existsSync(result.sheet)).toBe(true)
    expect(pngSize(readFileSync(result.sheet))!.width).toBeGreaterThan(600)
    // the model was given the page and the request, and nothing about tools
    const asked = readFileSync(join(dir, 'stdin-1.txt'), 'utf8')
    expect(asked.startsWith('You write ONE Mimir scene')).toBe(true)
    expect(asked).toContain('Request: how does a request queue work')
    expect(asked).not.toContain('mimir review')
    expect(readFileSync(join(dir, 'count'), 'utf8').trim()).toBe('1')
    expect(ev.map((e) => e.stage)).toContain('checking')
  }, T)

  test('an answer with errors is sent back once with the review; the corrected scene is what stays', async () => {
    const dir = freshDir()
    const writer = fakeWriter(dir, [example('broken'), example('hello-2d')])
    const r = await mimir(['new', 'how does a request queue work', '--once', '--json'], { cwd: dir, env: { MIMIR_WRITER_COMMAND: writer } })
    const result = events(r).pop()!
    expect(result).toMatchObject({ ok: true, verdict: 'ready', turns: 2, first_review_clean: false })
    expect(result.calls[0].errors).toBeGreaterThan(0)
    expect(result.calls[1]).toMatchObject({ errors: 0, flags: 0 })
    expect(readFileSync(result.scene, 'utf8').trim()).toBe(example('hello-2d').trim())
    const second = readFileSync(join(dir, 'stdin-2.txt'), 'utf8')
    expect(second).toContain('You answered with this module:')
    expect(second).toContain('The engine built it and measured every step. Its review:')
    expect(second).toMatch(/FAIL \d+ error/)
    expect(r.code).toBe(0)
  }, T)

  test('errors that survive are a failure (exit 1) that leaves the file and says what to run', async () => {
    const dir = freshDir()
    const writer = fakeWriter(dir, [example('broken')])
    const r = await mimir(['new', 'how does a request queue work', '--once', '--fix', '1', '--json'], { cwd: dir, env: { MIMIR_WRITER_COMMAND: writer } })
    expect(r.code).toBe(1)
    const result = events(r).pop()!
    expect(result).toMatchObject({ ok: false, stage: 'failed', verdict: 'failed', turns: 2 })
    expect(result.error).toMatch(/error.* after 1 correction: run mimir review /)
    expect(existsSync(result.scene)).toBe(true)
  }, T)

  test('--edit changes a scene in one call; text on a terminal says what it cost', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'queue.scene.js'), example('broken'))
    const writer = fakeWriter(dir, [example('hello-2d')])
    const r = await mimir(['new', 'fix the labels', '--edit', 'queue.scene.js', '--text'], { cwd: dir, env: { MIMIR_WRITER_COMMAND: writer } })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain(`READY ${join(dir, 'queue.scene.js')}`)
    expect(r.stdout).toContain('written once: 1 call')
    expect(readFileSync(join(dir, 'queue.scene.js'), 'utf8').trim()).toBe(example('hello-2d').trim())
    expect(readFileSync(join(dir, 'stdin-1.txt'), 'utf8')).toContain('Change it: fix the labels')
  }, T)

  test('nothing that can answer in text is a setup error before anything is spent', async () => {
    const dir = freshDir()
    const r = await mimir(['new', 'x', '--once', '--agent', 'command'], { cwd: dir })
    expect(r.code).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('MIMIR_WRITER_COMMAND')
    const both = await mimir(['new', 'x', '--once', '--loop'], { cwd: dir })
    expect(both.code).toBe(2)
    expect(both.stderr).toContain('only one of --once and --loop')
  }, T)
})
