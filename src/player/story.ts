// What the player works out from the scene's manifest: where a moment is in the story, where a jump lands, how a
// value is written, what a search matches. Pure: no DOM, no clock. Unit tests: tests/unit/player/story.test.ts.
import type { ChapterInfo, Manifest, NarrationInfo, ParamInfo, StepInfo } from '../host/index.ts'
import { clamp } from './motion.ts'
import { prettyName } from './names.ts'

export { isAutoId, prettyName } from './names.ts'

// ── named defaults ─────────────────────────────────────────────────────────────────────────────────────
/** "previous" goes to the start of the step being told when the story is further into it than this (seconds), else to the step before */
export const PREV_GRACE = 0.6
/** the last instant of the story that still belongs to its last step (the end itself is past it) */
export const END_EPSILON = 0.002
/** playback speeds, slowest first ([ and ] move along this list) */
export const SPEEDS = [0.5, 1, 1.5, 2] as const
/** seconds J and L move; seconds the arrows move while the line of time has the focus */
export const SKIP_SECONDS = 10
export const NUDGE_SECONDS = 5
/** the line of time takes hold of a tick when the pointer is this near (px); Alt lets go */
export const MAGNET_PX = 6
/** a story with more steps than this shows the step ticks of the chapter being played only */
export const CROWDED_STEPS = 24
/** a story with more steps than this lists its chapters in the command palette until something is typed */
export const PALETTE_STEPS = 12

export interface Where { /** 0-based index into info.steps, −1 when the scene has no steps */ step: number; /** 0-based index into info.chapters, −1 when the step belongs to none */ chapter: number }
/** The step and chapter that are being told at story time tau. */
export function locate(info: Pick<Manifest, 'steps' | 'chapters'>, tau: number): Where {
  let step = -1
  for (let i = 0; i < info.steps.length; i++) if (tau >= info.steps[i]!.t0 - 1e-9) step = i
  if (step < 0 && info.steps.length) step = 0
  const ch = step >= 0 ? info.steps[step]!.chapter : null
  return { step, chapter: ch === null ? -1 : info.chapters.findIndex((c) => c.index === ch) }
}

/**
 * Where "previous" (dir −1) or "next" (dir +1) lands from tau, by step or by chapter. Previous inside a step goes to
 * its start first; next past the last one goes to the end of the story.
 */
export function jumpTarget(info: Pick<Manifest, 'steps' | 'chapters' | 'duration'>, tau: number, dir: -1 | 1, byChapter = false): number {
  const starts = (byChapter && info.chapters.length ? info.chapters : info.steps).map((s: StepInfo | ChapterInfo) => s.t0)
  if (!starts.length) return dir < 0 ? 0 : info.duration
  let i = -1
  for (let k = 0; k < starts.length; k++) if (tau >= starts[k]! - 1e-6) i = k
  if (dir > 0) return i + 1 < starts.length ? starts[i + 1]! : info.duration
  if (i <= 0) return starts[0]!
  return tau - starts[i]! > PREV_GRACE ? starts[i]! : starts[i - 1]!
}

/** A graduation of the line of time: a major one opens a chapter (or a step, in a story without chapters), a minor one a step. */
export interface Tick { t: number; major: boolean; /** 0-based chapter the tick belongs to, −1 when none */ chapter: number; /** 0-based step it opens, −1 for the end */ step: number }
export function ticksOf(info: Pick<Manifest, 'steps' | 'chapters' | 'duration'>): Tick[] {
  const out: Tick[] = []
  const chapterOf = (s: StepInfo): number => (s.chapter === null ? -1 : info.chapters.findIndex((c) => c.index === s.chapter))
  info.steps.forEach((s, i) => {
    const ch = chapterOf(s)
    const opens = info.chapters.length ? ch >= 0 && info.chapters[ch]!.steps[0] === s.index : true
    out.push({ t: s.t0, major: opens || i === 0, chapter: ch, step: i })
  })
  out.push({ t: info.duration, major: true, chapter: -1, step: -1 })
  return out
}

/** The parts of the line that carry a name: the chapters, or the steps of a story that has none. */
export interface Section { /** what stands at its tick: the chapter's number, or the step's */ numeral: string; title: string; t0: number; t1: number }
export function sectionsOf(info: Pick<Manifest, 'steps' | 'chapters'>): Section[] {
  if (info.chapters.length) return info.chapters.map((c) => ({ numeral: String(c.index), title: c.title, t0: c.t0, t1: c.t1 }))
  return info.steps.map((s) => ({ numeral: String(s.index), title: s.title, t0: s.t0, t1: s.t1 }))
}
/** Index of the section being told at tau (−1 before the first). */
export const sectionAt = (sections: readonly Section[], tau: number): number => { let i = -1; for (let k = 0; k < sections.length; k++) if (tau >= sections[k]!.t0 - 1e-9) i = k; return i }

export interface NamePlan { /** x of the numeral, or null when it gives way to the one before it */ numeral: (number | null)[]; /** x of the name, or null when it is not written on the line */ name: (number | null)[]; /** every section is named */ all: boolean }
/**
 * Where the numerals and names of the sections go along the line (spec 7.4). Every section keeps its numeral at its
 * tick. If every name fits before the next tick, all are named; if not, only the one being told is: after its
 * numeral when the name ends `air` px before the next tick, else before its numeral when that does not run over the
 * numeral before; when it fits neither way it is left to the transport (null). A numeral gives way only to the
 * numeral before it, when two ticks are closer than a numeral is wide.
 */
export function planNames(xs: readonly number[], end: number, numeralW: readonly number[], nameW: readonly number[], current: number, o: { gap?: number; air?: number; left?: number } = {}): NamePlan {
  const gap = o.gap ?? 7, air = o.air ?? 8, left = o.left ?? xs[0] ?? 0
  const stop = (i: number): number => (i + 1 < xs.length ? xs[i + 1]! : end + 1)
  const all = xs.every((x, i) => x + numeralW[i]! + gap + nameW[i]! + (i + 1 < xs.length ? 2 * gap : 0) <= stop(i))
  const numeral = xs.map((x, i) => (i !== current && i > 0 && x - xs[i - 1]! < numeralW[i - 1]! + gap - 1 ? null : x))
  const name = xs.map((x, i): number | null => {
    if (all) return x + numeralW[i]! + gap
    if (i !== current) return null
    if (x + numeralW[i]! + gap + nameW[i]! <= stop(i) - air) return x + numeralW[i]! + gap
    const before = x - gap - 2 - nameW[i]!
    return before >= (i > 0 ? xs[i - 1]! + numeralW[i - 1]! + air : left - 1) ? before : null
  })
  return { numeral, name, all }
}

/** The tick nearest to a pointer x on the line, when it is within `within` px (the magnet); else the time under the pointer. */
export function magnet(ticks: readonly Tick[], t: number, duration: number, width: number, within = MAGNET_PX): number {
  if (!(duration > 0) || !(width > 0)) return 0
  let best = t, d = within
  for (const k of ticks) { const dx = Math.abs(((k.t - t) / duration) * width); if (dx <= d) { d = dx; best = k.t } }
  return clamp(best, 0, duration)
}

/** The next speed up (dir +1) or down (dir −1) the list; `wrap` goes round (the speed button cycles). */
export function nextSpeed(speed: number, dir: -1 | 1, wrap = false): number {
  let i = SPEEDS.findIndex((s) => Math.abs(s - speed) < 1e-6)
  if (i < 0) i = SPEEDS.indexOf(1)
  const n = i + dir
  if (wrap) return SPEEDS[(n + SPEEDS.length) % SPEEDS.length]!
  return SPEEDS[clamp(n, 0, SPEEDS.length - 1)]!
}
/** 1×, 1.5×: a speed as it is written on its control. */
export const speedText = (s: number): string => `${Number.isInteger(s) ? s : s.toFixed(1)}×`

// ── values ─────────────────────────────────────────────────────────────────────────────────────────────
/** How many decimals a number param shows: what its step needs, else three significant figures of its range. */
export function decimalsOf(p: Pick<ParamInfo, 'step' | 'min' | 'max'>): number {
  if (p.step > 0) { const s = String(p.step); const dot = s.indexOf('.'); return /e-/.test(s) ? Number(s.split('e-')[1]) : dot < 0 ? 0 : s.length - dot - 1 }
  const range = Math.abs(p.max - p.min)
  return !(range > 0) ? 2 : range >= 100 ? 0 : range >= 10 ? 1 : range >= 1 ? 2 : 3
}
/** A number as it is typeset: a real minus sign, a fixed number of decimals. */
export const numberText = (v: number, decimals: number): string => (Number.isFinite(v) ? (v < 0 && Number(v.toFixed(decimals)) !== 0 ? '−' : '') + Math.abs(v).toFixed(decimals) : '–')
/** The step a slider moves by: the param's own, or a four-hundredth of its range. */
export const sliderStep = (p: Pick<ParamInfo, 'step' | 'min' | 'max'>): number => (p.step > 0 ? p.step : (p.max - p.min) / 400 || 0.01)
/** Snap a raw slider value to the param's step (a tenth of it with `fine`) and its range. */
export function snapParam(p: Pick<ParamInfo, 'step' | 'min' | 'max'>, raw: number, fine = false): number {
  const st = sliderStep(p) / (fine ? 10 : 1)
  const v = p.min + Math.round((raw - p.min) / st) * st
  return clamp(Number(v.toFixed(10)), p.min, p.max)
}
/** A probe's value with as many decimals as its size needs (three significant figures). */
export function probeText(v: number): string {
  if (!Number.isFinite(v)) return '–'
  const a = Math.abs(v)
  return numberText(v, a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3)
}

// ── names ──────────────────────────────────────────────────────────────────────────────────────────────
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/**
 * The probes that are about one part: those whose name starts or ends with the part's id (sliderHeight for #slider).
 * Each comes with the rest of its name as a label ("Height").
 */
export function probesOf(partId: string, probes: Readonly<Record<string, number>>): { name: string; label: string; value: number }[] {
  const id = squash(partId.split('.').pop() ?? partId)
  if (!id) return []
  const out: { name: string; label: string; value: number }[] = []
  for (const [name, value] of Object.entries(probes)) {
    const n = squash(name)
    if (n === id) out.push({ name, label: prettyName(name), value })
    else if (n.startsWith(id) || n.endsWith(id)) {
      const rest = n.startsWith(id) ? name.slice(name.length - (n.length - id.length)) : name.slice(0, n.length - id.length)
      out.push({ name, label: prettyName(rest) || prettyName(name), value })
    }
  }
  return out
}

// ── search ─────────────────────────────────────────────────────────────────────────────────────────────
/** Subsequence match of q in text: the indices of the matched letters, or null. An empty query matches everything. */
export function fuzzy(q: string, text: string): number[] | null {
  const lq = q.trim().toLowerCase()
  if (!lq) return []
  const hits: number[] = []
  let i = 0
  const lt = text.toLowerCase()
  for (let k = 0; k < lt.length && i < lq.length; k++) if (lt[k] === lq[i]) { hits.push(k); i++ }
  return i === lq.length ? hits : null
}
/** How good a match is: lower is better (a prefix beats a word start beats letters scattered through the text). */
export function fuzzyRank(q: string, text: string): number {
  const hits = fuzzy(q, text)
  if (!hits) return Infinity
  if (!hits.length) return 0
  const lt = text.toLowerCase(), lq = q.trim().toLowerCase()
  if (lt.startsWith(lq)) return 0
  if (lt.includes(' ' + lq)) return 1
  if (lt.includes(lq)) return 2
  return 3 + (hits[hits.length - 1]! - hits[0]!)
}
export function levenshtein(a: string, b: string): number {
  const m = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = m[0]!
    m[0] = i
    for (let j = 1; j <= b.length; j++) { const keep = m[j]!; m[j] = Math.min(m[j]! + 1, m[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = keep }
  }
  return m[b.length]!
}
/** The name nearest to what was typed (for "No part called …. Nearest: …"); null for an empty list. */
export function nearest(q: string, names: readonly string[]): string | null {
  let best: string | null = null, d = Infinity
  const lq = q.trim().toLowerCase()
  for (const n of names) { const k = levenshtein(lq, n.toLowerCase().slice(0, Math.max(lq.length, 3))); if (k < d) { d = k; best = n } }
  return best
}

// ── text ───────────────────────────────────────────────────────────────────────────────────────────────
export const escapeHtml = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
/** The inline marks of a note (st.note): **bold**, *italic*, `code`; a blank line starts a paragraph. Everything else is text. */
export function noteHtml(md: string): string {
  const inline = (s: string): string => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
  return md.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${inline(p.replace(/\s*\n\s*/g, ' '))}</p>`).join('')
}
/** One word of a narration sentence, and the span (a word that names a part) it belongs to, if any. */
export interface Word { text: string; /** index into narration.spans, −1 when the word names nothing */ span: number; /** the next word belongs to the same span */ joined: boolean }
/** A sentence cut into words, each knowing the span it lies in (offsets are into `plain`). Punctuation after a span stays outside it. */
export function wordsOf(n: Pick<NarrationInfo, 'plain' | 'spans'>): Word[] {
  const out: Word[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(n.plain))) {
    const a = m.index, b = a + m[0].length
    const span = n.spans.findIndex((s) => s.targets.length > 0 && a < s.end && b > s.start && s.end > s.start)
    out.push({ text: m[0], span, joined: false })
  }
  for (let i = 0; i + 1 < out.length; i++) out[i]!.joined = out[i]!.span >= 0 && out[i]!.span === out[i + 1]!.span
  return out
}
/** A word of a span, and the punctuation that follows the name without being part of it. */
export function splitTail(word: string): [string, string] {
  const m = /^(.*?)([.,;:!?…)\]”’"']*)$/u.exec(word)
  return m && m[1] ? [m[1], m[2] ?? ''] : [word, '']
}

// ── sharing ────────────────────────────────────────────────────────────────────────────────────────────
/** The page's address, with or without the moment to start at (whole seconds). Other query parts are kept. */
export function shareUrl(href: string, t: number | null): string {
  const u = new URL(href)
  u.searchParams.delete('t')
  u.searchParams.delete('step')
  if (t !== null && t >= 1) u.searchParams.set('t', String(Math.floor(t)))
  return u.href
}
/** The name a downloaded page gets: the scene's title as a file name. */
export function fileNameOf(title: string, fallback = 'scene'): string {
  const base = title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()
  return (base || fallback) + '.html'
}
/** 412 KB, 1.2 MB: a size as a fact. */
export const sizeText = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

// ── home ───────────────────────────────────────────────────────────────────────────────────────────────
/** "2 hours ago": how long ago a moment was, in the largest whole unit. `now` and `then` are epoch milliseconds. */
export function ago(then: number, now: number): string {
  const s = Math.max(0, (now - then) / 1000)
  const units: [number, string][] = [[365 * 86400, 'year'], [30 * 86400, 'month'], [7 * 86400, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']]
  for (const [len, name] of units) if (s >= len) { const n = Math.floor(s / len); return `${n} ${name}${n === 1 ? '' : 's'} ago` }
  return 'just now'
}
/** The stages of a build, in the order they are listed (the server's names, spec 7.17), and the word each row carries. */
export const BUILD_STAGES: readonly { stage: string; label: string }[] = [
  { stage: 'storyboard', label: 'Storyboard' }, { stage: 'writing', label: 'Building' }, { stage: 'checking', label: 'Checking' },
  { stage: 'looking', label: 'Looking at renders' }, { stage: 'fixing', label: 'Fixing' }, { stage: 'ready', label: 'Ready' },
]
export interface BuildEvent { stage: string; message?: string; frame?: string; scene?: string }
export interface BuildRow { stage: string; label: string; state: 'todo' | 'now' | 'done'; /** times the build came back to this stage */ passes: number; fact: string; /** seconds spent in it so far (all passes) */ seconds: number }
export interface BuildState { rows: BuildRow[]; frames: string[]; /** index into frames of the one being looked at, −1 when none */ looking: number; status: string; ready: string | null; failed: string | null }
/**
 * The generating view as a function of the events so far (each stamped with the second it arrived at) and the time
 * now: which stage is now, which are done and how long they took, the frames that have arrived. A page that joins
 * late gets the same state from the same events.
 */
export function buildState(events: readonly (BuildEvent & { at: number })[], now: number): BuildState {
  const rows: BuildRow[] = BUILD_STAGES.map((s) => ({ ...s, state: 'todo', passes: 0, fact: '', seconds: 0 }))
  const frames: string[] = []
  let cur = -1, since = 0, looking = -1, ready: string | null = null, failed: string | null = null, status = ''
  const close = (at: number): void => { if (cur >= 0) { rows[cur]!.seconds += Math.max(0, at - since); rows[cur]!.state = 'done' } }
  for (const e of events) {
    if (e.stage === 'failed') { failed = e.message || 'The build failed.'; close(e.at); cur = -1; continue }
    const i = rows.findIndex((r) => r.stage === e.stage)
    if (i < 0) continue
    if (i !== cur) { close(e.at); cur = i; since = e.at; rows[i]!.passes++; rows[i]!.state = 'now' }
    if (e.message) rows[i]!.fact = e.message
    if (e.frame) { let k = frames.indexOf(e.frame); if (k < 0) { frames.push(e.frame); k = frames.length - 1 } looking = k }
    if (e.stage === 'ready') { ready = e.scene ?? null; rows[i]!.state = 'done'; for (const r of rows) if (r.passes && r.state !== 'done') r.state = 'done' }
    status = rows[i]!.label + (e.message ? ', ' + e.message : '')
  }
  if (cur >= 0 && rows[cur]!.state === 'now') rows[cur]!.seconds += Math.max(0, now - since)
  return { rows, frames, looking, status: failed ? failed : status || 'Starting', ready, failed }
}
