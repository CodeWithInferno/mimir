// The diagnostics store, call-site capture, did-you-mean, and the text form of the message contract (DESIGN §7).

/** 'unknown' is check's "not measured" (DESIGN §7: report unknown, never pass); it fails nothing. */
export type Severity = 'error' | 'warn' | 'info' | 'unknown'

/** JSON form of one diagnostic. `step` is 1-based (the k of `step {k} "{title}"`); null when not tied to a step. */
export interface Diag {
  code: string
  severity: Severity
  step: number | null
  stepTitle?: string | null
  t: number | null
  ids: string[]
  file: string | null
  line: number | null
  measured: number | string | null
  limit: number | string | null
  what: string
  fix: string[]
  /** present only when the diagnostic was found with params pinned away from the story's values (a slider extreme): name → value */
  params?: Record<string, number | boolean | string>
}
export type DiagInput = Partial<Diag> & { code: string; what: string }

export interface Src { file: string | null; line: number | null; col?: number | null }

// ── call sites ─────────────────────────────────────────────────────────────────────────────────────────
// A frame is "internal" when it is inside the engine itself; the first frame that is not is the scene line.
const SELF = (() => { try { return import.meta.url } catch { return '' } })()
const strip = (u: string): string => u.replace(/^file:\/\//, '')
const selfPath = strip(SELF)
const DEV_ROOT = /\/src\/core\/diagnostics\.ts$/.test(selfPath) ? selfPath.replace(/core\/diagnostics\.ts$/, '') : null
const BUNDLE_DIR = DEV_ROOT ? null : selfPath.replace(/[^/]*$/, '')
const internalExtra: ((file: string) => boolean)[] = []
/** Mark more files as engine-internal (used by tests and by hosts that inline the bundle). */
export function markInternal(test: (file: string) => boolean): void { internalExtra.push(test) }

function isInternal(file: string): boolean {
  if (DEV_ROOT ? file.startsWith(DEV_ROOT) : file === selfPath || (BUNDLE_DIR !== null && file.startsWith(BUNDLE_DIR + 'mimir.'))) return true
  if (file.includes('/node_modules/') || file.startsWith('node:') || file.startsWith('bun:') || file === 'native') return true
  for (const t of internalExtra) if (t(file)) return true
  return false
}

// the column is optional: JavaScriptCore leaves it out for code at the top level of a module
const FRAME_RE = /(?:\(|\s|@|^)((?:[a-z][a-z0-9+.-]*:\/\/|\/|[A-Za-z]:\\)[^\s()]*?):(\d+)(?::(\d+))?\)?\s*$/
const siteCache = new Map<string, Src>()
const NOWHERE: Src = { file: null, line: null, col: null }

/** Parse a stack string to the first frame outside the engine. Cached per distinct stack. */
export function parseStack(stack: string | undefined): Src {
  if (!stack) return NOWHERE
  const hit = siteCache.get(stack)
  if (hit) return hit
  let out = NOWHERE
  for (const raw of stack.split('\n')) {
    const m = raw.match(FRAME_RE)
    if (!m) continue
    const file = strip(m[1]!)
    if (isInternal(file)) continue
    out = { file, line: Number(m[2]), col: m[3] === undefined ? null : Number(m[3]) }
    break
  }
  if (siteCache.size > 5000) siteCache.clear()
  siteCache.set(stack, out)
  return out
}

/** The scene-file line that called into the API right now. */
export function callSite(): Src {
  const E = Error as unknown as { stackTraceLimit?: number }
  const prev = E.stackTraceLimit
  if (typeof prev === 'number' && prev < 30) E.stackTraceLimit = 30
  const stack = new Error().stack
  if (typeof prev === 'number') E.stackTraceLimit = prev
  return parseStack(stack)
}

// ── did-you-mean ───────────────────────────────────────────────────────────────────────────────────────
/** Edit distance with adjacent transpositions counted as one edit ("widht" is 1 from "width"). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const d: number[][] = []
  for (let i = 0; i <= m; i++) { const row = new Array<number>(n + 1).fill(0); row[0] = i; d.push(row) }
  for (let j = 0; j <= n; j++) d[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
    }
  }
  return d[m]![n]!
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/** Closest candidate, or null when nothing is close enough to be a plausible typo. */
export function closest(word: string, candidates: Iterable<string>): string | null {
  const w = squash(word)
  let best: string | null = null, bestD = Infinity
  for (const c of candidates) {
    const cc = squash(c)
    if (!cc) continue
    let d = levenshtein(w, cc)
    if (d > 0 && (cc.startsWith(w) || w.startsWith(cc)) && Math.min(w.length, cc.length) >= 3) d = Math.min(d, 1.5)
    if (d < bestD) { bestD = d; best = c }
  }
  const limit = Math.max(2, Math.floor(Math.max(w.length, 1) / 3))
  return best !== null && bestD <= limit ? best : null
}
/** The `n` closest candidates, best first (for "closest of: …" lists). */
export function nearest(word: string, candidates: Iterable<string>, n = 4): string[] {
  const w = squash(word)
  return [...candidates].map((c) => ({ c, d: levenshtein(w, squash(c)) })).sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.c)
}

// ── store ──────────────────────────────────────────────────────────────────────────────────────────────
export const SEVERITY: Record<string, Severity> = {
  'API-UNKNOWN': 'error', 'API-TYPE': 'error', 'REF-MISSING': 'error', 'NUM-INVALID': 'error', 'RUNTIME-ERROR': 'error',
  'ID-DUP': 'error', 'PLACE-CONFLICT': 'error', 'EMPTY-FRAME': 'error', 'OFF-FRAME': 'error', 'TEXT-OVERLAP': 'error',
  'STATIC-STEP': 'warn', 'DEAD-PARAM': 'error', 'GUIDE-TARGET': 'error', 'NOT-PURE': 'error',
}

export class DiagStore {
  readonly list: Diag[] = []
  private seen = new Set<string>()
  /** context supplied by whoever is running: the step being recorded, the time being evaluated */
  context: { step: number | null; stepTitle: string | null; t: number | null; file: string | null } = { step: null, stepTitle: null, t: null, file: null }

  /** Record once per (code, ids, line, what). Returns the stored diagnostic (or the earlier identical one). */
  add(d: DiagInput, src?: Src | null): Diag {
    const site = src === undefined ? callSite() : src
    const full: Diag = {
      code: d.code,
      severity: d.severity ?? SEVERITY[d.code] ?? 'error',
      step: d.step !== undefined ? d.step : this.context.step,
      stepTitle: d.stepTitle !== undefined ? d.stepTitle : d.step === undefined ? this.context.stepTitle : null,
      t: d.t !== undefined ? d.t : this.context.t,
      ids: d.ids ?? [],
      file: d.file !== undefined ? d.file : site?.file ?? this.context.file,
      line: d.line !== undefined ? d.line : site?.line ?? null,
      measured: d.measured ?? null,
      limit: d.limit ?? null,
      what: d.what,
      fix: d.fix ?? [],
      ...(d.params && Object.keys(d.params).length ? { params: d.params } : {}),
    }
    const key = `${full.code}|${full.ids.join(',')}|${full.line}|${full.what}`
    if (this.seen.has(key)) return this.list.find((x) => `${x.code}|${x.ids.join(',')}|${x.line}|${x.what}` === key) ?? full
    this.seen.add(key)
    this.list.push(full)
    return full
  }
  byCode(code: string): Diag[] { return this.list.filter((d) => d.code === code) }
  get errors(): number { return this.list.filter((d) => d.severity === 'error').length }
}

const baseName = (f: string): string => f.replace(/[?#].*$/, '').split('/').pop() || f
const fmtT = (t: number): string => (Math.round(t * 100) / 100).toString()

/** Text form of the message contract:
 *  {CODE} {severity} | step {k} "{title}" t={t}s | #{id} | {file}:{line}
 *    what: …
 *    fix: … */
export function formatDiag(d: Diag): string {
  const head: string[] = [`${d.code} ${d.severity}`]
  if (d.step !== null && d.step !== undefined) head.push(`step ${d.step}${d.stepTitle ? ` "${d.stepTitle}"` : ''}${d.t !== null && d.t !== undefined ? ` t=${fmtT(d.t)}s` : ''}`)
  else if (d.t !== null && d.t !== undefined) head.push(`t=${fmtT(d.t)}s`)
  if (d.ids.length) head.push(d.ids.map((i) => `#${i}`).join(', '))
  if (d.file) head.push(`${baseName(d.file)}${d.line !== null ? `:${d.line}` : ''}`)
  const lines = [head.join(' | '), `  what: ${d.what}`]
  if (d.fix.length) lines.push(`  fix: ${d.fix.join(' | ')}`)
  return lines.join('\n')
}

/** Errors first, then warnings, then info; stable inside a severity. */
export function sortDiags(list: readonly Diag[]): Diag[] {
  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2, unknown: 3 }
  return list.map((d, i) => ({ d, i })).sort((a, b) => rank[a.d.severity] - rank[b.d.severity] || a.i - b.i).map((x) => x.d)
}
