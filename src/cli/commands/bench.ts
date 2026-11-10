// mimir bench [--prompts file] [--only word] [--model m] [--agent name] [--runs n] [--size s] [--fast] [--full] [-o dir] [--json]
//
// The measurement behind every claim about what a generation costs: each prompt goes through the real `mimir new`
// (same driver, same verification), one at a time, into its own directory, and one table comes out: verdict, API
// calls, turns, seconds, tokens by kind, cost, whether the first review was clean, whether the agent looked, the
// length of the scene and the sheet to open. The raw stream and the usage of every run stay in its directory.
// A table is not the bar: somebody has to open the sheets.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Parsed } from '../args.ts'
import { DEFAULT_BENCH_RUNS, type ConceptSize, type NewMode } from '../agents/limits.ts'
import type { NewResult } from '../agents/types.ts'
import { onCleanup } from '../chrome.ts'
import { CliError, UsageError } from '../errors.ts'
import type { Io } from '../io.ts'
import { parseNewMode, parseSizeName, resolveNewMode } from '../lean-specs.ts'
import { ROOT } from '../paths.ts'
import { runGeneration } from './new.ts'

/** Where the default prompts live in a checkout; MIMIR_BENCH_PROMPTS or --prompts names another file. */
export const DEFAULT_PROMPTS = join('bench', 'small-concepts.txt')
/** Where the runs go when -o is not given, under the working directory (never a dot-directory: some agents refuse to write there). */
export const DEFAULT_BENCH_DIR = 'mimir-bench'

export interface BenchOptions {
  prompts: string | null
  only: string[]
  model: string | null
  agent: string | null
  runs: number
  size: ConceptSize | null
  fast: boolean
  full: boolean
  /** --once / --loop, or null for the default of mimir new */
  mode: NewMode | null
  /** --fix, or null */
  fix: number | null
  /** --effort, or null */
  effort: string | null
  out: string | null
  json: boolean
}

export function toBenchOptions(p: Parsed): BenchOptions {
  const f = p.flags
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  const runsText = str(f.runs)
  const runs = runsText === null ? DEFAULT_BENCH_RUNS : Number(runsText)
  if (!Number.isInteger(runs) || runs < 1) throw new UsageError(`--runs must be a whole number of at least 1 (got "${runsText}")`, 'bench')
  const size = str(f.size)
  return {
    prompts: str(f.prompts), only: Array.isArray(f.only) ? f.only : [], model: str(f.model), agent: str(f.agent), runs,
    size: size === null ? null : parseSizeName(size, 'bench'), fast: f.fast === true, full: f.full === true,
    mode: parseNewMode(p), fix: fixOf(str(f.fix)), effort: str(f.effort), out: str(f.out), json: p.json,
  }
}

const fixOf = (text: string | null): number | null => {
  if (text === null) return null
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`--fix must be a whole number of at least 0 (got "${text}")`, 'bench')
  return n
}

/** One prompt per line; blank lines and lines that start with `#` are skipped. */
export function parsePrompts(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))
}

/** "how does a TCP three-way handshake work" → "tcp-three-way-handshake" (a directory name). */
export function promptSlug(prompt: string): string {
  const words = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => !['how', 'does', 'do', 'a', 'an', 'the', 'work', 'works', 'is', 'what'].includes(w))
  return words.slice(0, 5).join('-') || 'prompt'
}

export interface BenchRow {
  prompt: string
  run: number
  dir: string
  verdict: string
  ok: boolean
  api_calls: number | null
  turns: number | null
  seconds: number
  tokens: number | null
  cache_read: number | null
  cache_write: number | null
  input: number | null
  output: number | null
  cost_usd: number | null
  first_review_clean: boolean | null
  looks: number
  review_rounds: number
  scene_lines: number | null
  sheet: string | null
  model: string | null
  error: string | null
}

export function rowOf(prompt: string, run: number, dir: string, r: NewResult, cwd: string): BenchRow {
  const rel = (p: string | null): string | null => { if (p === null) return null; const x = relative(cwd, p); return x !== '' && !x.startsWith('..') && !isAbsolute(x) ? x.split('\\').join('/') : p }
  return {
    prompt, run, dir: rel(dir)!, verdict: r.verdict ?? (r.ok ? 'ready' : 'failed'), ok: r.ok, api_calls: r.usage?.api_calls ?? null, turns: r.turns, seconds: Math.round(r.wall_ms / 100) / 10,
    tokens: r.usage?.total ?? null, cache_read: r.usage?.cache_read ?? null, cache_write: r.usage?.cache_write ?? null, input: r.usage?.input ?? null, output: r.usage?.output ?? null,
    cost_usd: r.cost_usd, first_review_clean: r.first_review_clean ?? null, looks: r.rounds.look, review_rounds: r.rounds.check, scene_lines: r.scene_lines ?? null, sheet: rel(r.sheet), model: r.model, error: r.error,
  }
}

/** The mean of the numeric columns over the rows that have a value (a failed run still cost what it cost). */
export function meanRow(rows: readonly BenchRow[]): Record<string, number | null> {
  const mean = (pick: (r: BenchRow) => number | null): number | null => {
    const v = rows.map(pick).filter((x): x is number => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const known = rows.filter((r) => r.first_review_clean !== null)
  return {
    api_calls: mean((r) => r.api_calls), turns: mean((r) => r.turns), seconds: mean((r) => r.seconds), tokens: mean((r) => r.tokens), cache_read: mean((r) => r.cache_read),
    cache_write: mean((r) => r.cache_write), input: mean((r) => r.input), output: mean((r) => r.output), cost_usd: mean((r) => r.cost_usd), looks: mean((r) => r.looks),
    scene_lines: mean((r) => r.scene_lines), ready: rows.filter((r) => r.ok).length / Math.max(1, rows.length), first_review_clean: known.length ? known.filter((r) => r.first_review_clean).length / known.length : null,
  }
}

const k = (n: number | null): string => (n === null ? '?' : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))

export function formatBench(rows: readonly BenchRow[]): string {
  const head = ['prompt', 'verdict', 'calls', 'turns', 's', 'tokens', 'cache rd', 'cache wr', 'in', 'out', 'cost', '1st clean', 'looks', 'lines', 'sheet']
  const line = (r: BenchRow): string[] => [
    r.prompt.length > 34 ? r.prompt.slice(0, 33) + '…' : r.prompt, r.verdict, k(r.api_calls), k(r.turns), r.seconds.toFixed(0), k(r.tokens), k(r.cache_read), k(r.cache_write), k(r.input), k(r.output),
    r.cost_usd === null ? '?' : `$${r.cost_usd.toFixed(3)}`, r.first_review_clean === null ? '?' : r.first_review_clean ? 'yes' : 'no', String(r.looks), k(r.scene_lines), r.sheet ?? '-',
  ]
  const m = meanRow(rows)
  const table = [head, ...rows.map(line), [
    `mean of ${rows.length}`, `${Math.round((m.ready ?? 0) * 100)}% ready`, m.api_calls === null ? '?' : m.api_calls.toFixed(1), m.turns === null ? '?' : m.turns.toFixed(1), m.seconds === null ? '?' : m.seconds.toFixed(0), k(m.tokens ?? null), k(m.cache_read ?? null), k(m.cache_write ?? null), k(m.input ?? null), k(m.output ?? null),
    m.cost_usd === null ? '?' : `$${m.cost_usd.toFixed(3)}`, m.first_review_clean === null ? '?' : `${Math.round(m.first_review_clean * 100)}%`, m.looks === null ? '?' : m.looks.toFixed(1), k(m.scene_lines ?? null), '',
  ]]
  const width = head.map((_, i) => Math.max(...table.map((row) => row[i]!.length)))
  const failed = rows.filter((r) => r.error !== null).map((r) => `failed: ${r.prompt}: ${r.error}`)
  return table.map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(width[i]!))).join('  ').trimEnd()).join('\n') + '\n' + (failed.length ? failed.join('\n') + '\n' : '') + 'Open every sheet: the numbers do not say how it looks.\n'
}

export async function bench(opts: BenchOptions, io: Io): Promise<number> {
  const named = opts.prompts ?? (io.env.MIMIR_BENCH_PROMPTS && io.env.MIMIR_BENCH_PROMPTS !== '' ? io.env.MIMIR_BENCH_PROMPTS : null)
  const file = named !== null ? resolve(io.cwd, named) : join(ROOT, DEFAULT_PROMPTS)
  if (!existsSync(file)) throw new CliError(`mimir bench: no prompts file ${file} (one prompt per line; give one with --prompts)`)
  let prompts = parsePrompts(readFileSync(file, 'utf8'))
  if (opts.only.length) prompts = prompts.filter((p) => opts.only.some((w) => p.toLowerCase().includes(w.toLowerCase())))
  if (!prompts.length) throw new CliError(`mimir bench: no prompt to run (${file}${opts.only.length ? `, --only ${opts.only.join(',')}` : ''})`)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const outDir = opts.out !== null ? resolve(io.cwd, opts.out) : join(io.cwd, DEFAULT_BENCH_DIR, stamp)
  mkdirSync(outDir, { recursive: true })
  const rows: BenchRow[] = []
  const mode = resolveNewMode(opts.mode, io.env)
  for (const prompt of prompts) {
    for (let run = 1; run <= opts.runs; run++) {
      const dir = join(outDir, promptSlug(prompt) + (opts.runs > 1 ? `-${run}` : ''))
      io.log(`bench ${rows.length + 1}/${prompts.length * opts.runs}: "${prompt}" -> ${dir}`)
      const quiet: Io = { ...io, log: () => {} }
      const result = await runGeneration(
        { prompt, workdir: dir, cwd: io.cwd, env: io.env, root: ROOT, agent: opts.agent, model: opts.model, maxTurns: null, budgetUsd: null, timeout: null, instructions: null, resume: null, size: opts.size, fast: opts.fast, full: opts.full, fixRounds: opts.fix, effort: opts.effort },
        mode, quiet, { emit: () => {}, log: () => {}, onCleanup: (fn) => onCleanup(fn) },
      )
      const row = rowOf(prompt, run, dir, result, io.cwd)
      rows.push(row)
      io.log(`  ${row.verdict}: ${row.api_calls ?? '?'} calls, ${k(row.tokens)} tokens, ${row.seconds.toFixed(0)} s, ${row.cost_usd === null ? '?' : `$${row.cost_usd.toFixed(3)}`}`)
    }
  }
  const report = { prompts: file, mode, lean: !opts.full, runs: rows, mean: meanRow(rows) }
  writeFileSync(join(outDir, 'bench.json'), JSON.stringify(report, null, 2) + '\n')
  io.out(io.json ? JSON.stringify(report) + '\n' : formatBench(rows))
  return rows.every((r) => r.ok) ? 0 : 1
}
