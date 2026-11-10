// Diagnostics: normalising what the page reports, ordering, the 8-line cap, and the text / JSON renderings
// (DESIGN section 7). Pure: no I/O.
import { isAbsolute, join, relative } from 'node:path'

export interface Diag {
  code: string
  severity: string
  step: number | null
  t: number | null
  ids: string[]
  file: string | null
  line: number | null
  measured: number | string | null
  limit: number | string | null
  what: string
  fix: string[]
  /** title of the step as the page reported it; used for the text header only, not part of the JSON form */
  stepTitle?: string | null
  /** param values the diagnostic was found with, when they are not the story's (a slider extreme); absent otherwise */
  params?: Record<string, number | boolean | string>
}

export interface StepInfo { index: number; title: string; t0: number; t1: number; /** 1-based chapter number, or null (no chapters, or the host does not say) */ chapter?: number | null }
export interface ParamInfo { name: string; min: number; max: number; value: number | boolean | string; /** 'number' | 'toggle' | 'choice' when the host says; null = unknown */ kind: string | null; options: string[] }
export interface PartInfo { id: string; label: string }
export interface FatalInfo { message: string; file: string | null; line: number | null }
export interface ChapterInfo { index: number; title: string; t0: number; t1: number; steps: number[] }
/** One sentence of narration: as written (with its guide spans), as spoken, and when (absolute story seconds). */
export interface NarrationInfo { text: string; plain: string; t0: number; duration: number }
/** One step of the explanation as text (DESIGN section 3.4): what read mode shows and `export --md` writes. */
export interface TranscriptEntry { step: number; title: string; chapter: number | null; chapterTitle: string | null; t0: number; t1: number; narration: NarrationInfo[]; note: string | null }
/** A guide cue as the host reports it (info().cues), in absolute story seconds. */
export interface HostCue { step: number; verb: string; targets: string[]; words: string; /** when the pointer lands and the mark starts */ land: number; /** when the mark has finished drawing on */ drawn: number }
export interface SceneInfo {
  title: string
  subtitle?: string
  duration: number
  steps: StepInfo[]
  params: ParamInfo[]
  parts: PartInfo[]
  /** names setView() accepts, when the host reports them (beyond DESIGN section 9); null = unknown */
  views: string[] | null
  /** problems recorded while the scene was built (before any check sampling); null when the host does not report them */
  problems: { errors: number; warnings: number } | null
  fatal: FatalInfo | null
  /** chapters of a long explanation; empty when the scene has none or the host does not report them */
  chapters?: ChapterInfo[]
  /** the explanation as text, one entry per step; empty when the host does not report it */
  transcript?: TranscriptEntry[]
  /** guide cues computed by the host, or null when it does not report them (the CLI then schedules them itself) */
  cues?: HostCue[] | null
  /** whether the scene has a 3D panel; null = the host does not say */
  has3d?: boolean | null
}

export const MAX_SHOWN = 8

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** `info()` as the page returned it, made total: every field present with the documented type. */
export function normalizeInfo(raw: unknown): SceneInfo {
  const r = obj(raw)
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const steps = arr(r.steps).map((s, i): StepInfo => {
    const o = obj(s)
    return { index: num(o.index) ?? i + 1, title: text(o.title) ?? '', t0: num(o.t0) ?? 0, t1: num(o.t1) ?? 0, ...(num(o.chapter) !== null ? { chapter: num(o.chapter) } : {}) }
  })
  const params = arr(r.params).map((p): ParamInfo => {
    const o = obj(p)
    const v = o.value
    return {
      name: text(o.name) ?? '',
      min: num(o.min) ?? 0,
      max: num(o.max) ?? 0,
      value: typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : 0,
      kind: text(o.kind),
      options: arr(o.options).filter((x): x is string => typeof x === 'string'),
    }
  })
  const parts = arr(r.parts).map((p): PartInfo => {
    const o = obj(p)
    return { id: text(o.id) ?? '', label: text(o.label) ?? '' }
  })
  const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string')
  const chapters = arr(r.chapters).map((c, i): ChapterInfo => {
    const o = obj(c)
    return { index: num(o.index) ?? i + 1, title: text(o.title) ?? '', t0: num(o.t0) ?? 0, t1: num(o.t1) ?? 0, steps: arr(o.steps).filter((x): x is number => typeof x === 'number') }
  })
  const transcript = arr(r.transcript).map((e, i): TranscriptEntry => {
    const o = obj(e)
    return {
      step: num(o.step) ?? i + 1, title: text(o.title) ?? '', chapter: num(o.chapter), chapterTitle: text(o.chapterTitle), t0: num(o.t0) ?? 0, t1: num(o.t1) ?? 0,
      narration: arr(o.narration).map((n): NarrationInfo => {
        const q = obj(n)
        return { text: text(q.text) ?? text(q.plain) ?? '', plain: text(q.plain) ?? text(q.text) ?? '', t0: num(q.t0) ?? 0, duration: num(q.duration) ?? 0 }
      }),
      note: text(o.note),
    }
  })
  const cues = Array.isArray(r.cues)
    ? r.cues.map((c): HostCue | null => {
        const o = obj(c)
        const land = num(o.land) ?? num(o.landAt) ?? num(o.t)
        const step = num(o.step)
        if (land === null || step === null) return null
        return { step, verb: text(o.verb) ?? 'point', targets: strings(o.targets).length ? strings(o.targets) : text(o.target) !== null ? [text(o.target)!] : [], words: text(o.words) ?? '', land, drawn: num(o.drawn) ?? num(o.drawEnd) ?? land }
      }).filter((c): c is HostCue => c !== null)
    : null
  return {
    title: text(r.title) ?? '',
    ...(text(r.subtitle) !== null ? { subtitle: text(r.subtitle)! } : {}),
    duration: num(r.duration) ?? (steps.length ? steps[steps.length - 1]!.t1 : 0),
    steps,
    params,
    parts,
    views: Array.isArray(r.views) ? r.views.filter((v): v is string => typeof v === 'string') : null,
    problems: r.problems !== null && typeof r.problems === 'object' ? { errors: num(obj(r.problems).errors) ?? 0, warnings: num(obj(r.problems).warnings) ?? 0 } : null,
    fatal: normalizeFatal(r.fatal),
    ...(chapters.length ? { chapters } : {}),
    ...(transcript.length ? { transcript } : {}),
    ...(cues !== null ? { cues } : {}),
    ...(typeof r.has3d === 'boolean' ? { has3d: r.has3d } : {}),
  }
}

/** `fatal` may be a string, an Error-like object, or absent. */
export function normalizeFatal(raw: unknown): FatalInfo | null {
  if (raw === null || raw === undefined || raw === false) return null
  if (typeof raw === 'string') return { message: raw, file: null, line: null }
  const o = obj(raw)
  const message = text(o.message) ?? text(o.what) ?? text(o.stack) ?? String(raw)
  return { message, file: text(o.file), line: num(o.line) }
}

/** One diagnostic as reported by the page, made total. Unknown shapes become a readable record, never a throw. */
export function normalizeDiag(raw: unknown): Diag {
  const r = obj(raw)
  const ids = Array.isArray(r.ids)
    ? r.ids.filter((x): x is string => typeof x === 'string')
    : typeof r.id === 'string' ? [r.id] : []
  const fix = Array.isArray(r.fix)
    ? r.fix.filter((x): x is string => typeof x === 'string')
    : typeof r.fix === 'string' ? [r.fix] : []
  const scalar = (v: unknown): number | string | null =>
    typeof v === 'number' ? (Number.isFinite(v) ? v : String(v)) : typeof v === 'string' ? v : null
  return {
    code: text(r.code) ?? 'UNKNOWN',
    severity: text(r.severity) ?? 'error',
    step: num(r.step),
    t: num(r.t),
    ids,
    file: text(r.file),
    line: num(r.line),
    measured: scalar(r.measured),
    limit: scalar(r.limit),
    what: text(r.what) ?? text(r.message) ?? '',
    fix,
    ...(text(r.stepTitle) !== null ? { stepTitle: text(r.stepTitle) } : {}),
    ...(paramsOf(r.params) ? { params: paramsOf(r.params)! } : {}),
  }
}

function paramsOf(raw: unknown): Record<string, number | boolean | string> | null {
  if (raw === null || typeof raw !== 'object') return null
  const out: Record<string, number | boolean | string> = {}
  for (const [k, v] of Object.entries(raw as object)) if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[k] = v
  return Object.keys(out).length ? out : null
}

/** A scene that failed to import or run is reported as exactly one RUNTIME-ERROR. */
export function fatalToDiag(fatal: FatalInfo, sceneFile: string): Diag {
  const first = fatal.message.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? 'the scene module failed to load'
  let file = fatal.file
  let line = fatal.line
  if (line === null) {
    // "…/scene/name.js:12:5" somewhere in the message or stack
    const m = /([^\s()'"]+\.m?js):(\d+)(?::\d+)?/.exec(fatal.message)
    if (m) {
      file = file ?? m[1]!
      line = Number(m[2])
    }
  }
  return {
    code: 'RUNTIME-ERROR',
    severity: 'error',
    step: null,
    t: null,
    ids: [],
    file: file ?? sceneFile,
    line,
    measured: null,
    limit: null,
    what: `the scene module failed to load: ${first}`,
    fix: [
      line !== null
        ? 'fix the error at the line shown, then run mimir check again; the scene must import and build without throwing'
        : 'fix what the message names, then run mimir check again; the scene must import and build without throwing',
    ],
  }
}

const RANK: Record<string, number> = { error: 0, warn: 1, warning: 1, info: 2, unknown: 3 }
const rank = (severity: string): number => RANK[severity] ?? 4

/** Errors first, then warnings, then the rest. Stable: the page's own grouping order is kept inside a class. */
export function sortDiags(diags: readonly Diag[]): Diag[] {
  return diags
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d.severity) - rank(b.d.severity) || a.i - b.i)
    .map((x) => x.d)
}

export interface CheckResult {
  ok: boolean
  errors: number
  warnings: number
  total: number
  shown: number
  diagnostics: Diag[]
  /** present (true) only when the viewer could not be rebuilt and this ran on the last good build: the result does NOT describe the current sources */
  stale?: true
  /** the build error, when stale */
  build_error?: string
}

export function buildCheckResult(diags: readonly Diag[], all: boolean): CheckResult {
  const sorted = sortDiags(diags)
  const errors = sorted.filter((d) => d.severity === 'error').length
  const warnings = sorted.filter((d) => rank(d.severity) === 1).length
  const diagnostics = all ? sorted : sorted.slice(0, MAX_SHOWN)
  return { ok: errors === 0, errors, warnings, total: sorted.length, shown: diagnostics.length, diagnostics }
}

/** Where scene files live, so page-side URLs can be turned back into paths the author can open. */
export interface FileContext { sceneDir: string; cwd: string }

/** "/scene/a.scene.js" or "http://127.0.0.1:5000/scene/a.scene.js?x" → path of the real file, relative to cwd. */
export function displayFile(file: string, ctx: FileContext | null): string {
  let f = file
  const url = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)$/i.exec(f)
  if (url) f = url[1]!
  f = f.replace(/[?#].*$/, '')
  if (ctx && f.startsWith('/scene/')) {
    let rest = f.slice('/scene/'.length)
    try {
      rest = decodeURIComponent(rest)
    } catch {
      // keep the raw text
    }
    const abs = join(ctx.sceneDir, rest)
    const rel = relative(ctx.cwd, abs)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs
  }
  return f
}

/** Seconds with at most 3 decimals and no trailing zeros: 3.5, 2, 1.999. */
export function formatSeconds(t: number): string {
  return String(Number(t.toFixed(3)))
}

/** The three-line text form of DESIGN section 7. Absent parts of the header are left out. */
export function formatDiagText(d: Diag, steps: readonly StepInfo[], ctx: FileContext | null = null): string {
  const head: string[] = [`${d.code} ${d.severity}`]
  const where: string[] = []
  if (d.step !== null) {
    const title = d.stepTitle ?? steps.find((x) => x.index === d.step)?.title ?? ''
    where.push(title !== '' ? `step ${d.step} "${title}"` : `step ${d.step}`)
  }
  if (d.t !== null) where.push(`t=${formatSeconds(d.t)}s`)
  if (where.length) head.push(where.join(' '))
  if (d.ids.length) head.push(d.ids.map((id) => `#${id}`).join(' '))
  if (d.file !== null) head.push(displayFile(d.file, ctx) + (d.line !== null ? `:${d.line}` : ''))
  const lines = [head.join(' | '), `  what: ${oneLine(d.what)}`]
  if (d.fix.length) lines.push(`  fix: ${d.fix.map(oneLine).join('; ')}`)
  return lines.join('\n')
}

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim()
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Last line of `check`: starts with OK or FAIL so nobody needs `; echo $?`. */
export function statusLine(r: CheckResult): string {
  const hidden = r.total - r.shown
  return (
    `${r.ok ? 'OK' : 'FAIL'} ${plural(r.errors, 'error')}, ${plural(r.warnings, 'warning')}` +
    (hidden > 0 ? ` (showing ${r.shown} of ${r.total}; --all prints every one)` : '') +
    (r.stale ? ' - STALE: the viewer could not be rebuilt, so this ran on the last good build and does not describe the current sources (the build error is above)' : '')
  )
}

export function formatCheckText(r: CheckResult, steps: readonly StepInfo[], ctx: FileContext | null = null): string {
  return [...r.diagnostics.map((d) => formatDiagText(d, steps, ctx)), statusLine(r)].join('\n') + '\n'
}

export function formatCheckJson(r: CheckResult, ctx: FileContext | null = null): string {
  // exactly the documented record, in the documented key order
  const diagnostics = r.diagnostics.map((d) => ({
    code: d.code, severity: d.severity, step: d.step, t: d.t, ids: d.ids,
    file: d.file === null ? null : displayFile(d.file, ctx), line: d.line,
    measured: d.measured, limit: d.limit, what: d.what, fix: d.fix,
    ...(d.params ? { params: d.params } : {}),
  }))
  return JSON.stringify({ ...r, diagnostics }) + '\n'
}
