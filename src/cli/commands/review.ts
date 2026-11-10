// mimir review <scene> [--sheet] [--json] [--limit name=value ...] [--out dir]
//
// The whole inner loop in ONE command, answering in text: the linter's findings (exactly what `mimir check` prints),
// then a compact account of every step (what is on stage and where, what entered / moved / changed / left, what
// each narration link points at when the pointer lands), then composition findings the linter does not make
// (content hanging at the top, small content, a lopsided frame, content in the caption strip, faint text), and the
// path of ONE small story sheet. An agent should usually not need to open an image to fix a scene; it looks once.
//
// One browser session for the text; the sheet is rendered by `mimir shot --sheet` (in this process) only with
// --sheet or when a composition finding needs eyes.
//
// Hook for a richer description: when the viewer has `window.__mimir.describe()` it is called for the frame on
// screen and may answer a string or a list of strings (one plain line per block, e.g. the `describe(state)` of the
// blocks of explain()); those lines are printed under the step. Without the hook the text comes from the frame state.
import type { ParamValue } from '../args.ts'
import { COMMANDS, parseFlags, toShotOptions, type Parsed } from '../args.ts'
import { REVIEW_LIMITS, REVIEW_SPEC, type ReviewLimits } from '../lean-specs.ts'
import { UsageError } from '../errors.ts'
import { buildCheckResult, fatalToDiag, formatCheckText, formatCheckJson, normalizeDiag, type CheckResult, type FileContext, type SceneInfo } from '../format.ts'
import type { Io } from '../io.ts'
import { imageTokens, planFrames, storyCues } from '../manifest.ts'
import { LIB } from '../pageside.ts'
import { ensureViewer, resolveScene } from '../paths.ts'
import { openSession, timeoutFromEnv } from '../session.ts'
import { relative, resolve, join, isAbsolute } from 'node:path'
import { shot } from './shot.ts'

export { REVIEW_LIMITS, REVIEW_SPEC, type ReviewLimits }

export interface ReviewOptions { scene: string; sheet: boolean; out: string | null; limits: ReviewLimits; json: boolean; /** never render a sheet, whatever is found (the driver of `mimir new` renders its own) */ noSheet?: boolean }

export function toReviewOptions(p: Parsed): ReviewOptions {
  const limits: ReviewLimits = { ...REVIEW_LIMITS }
  const given = p.flags.limit
  for (const item of Array.isArray(given) ? given : []) {
    const eq = item.indexOf('=')
    const name = eq > 0 ? item.slice(0, eq).trim() : ''
    const value = Number(item.slice(eq + 1))
    if (!(name in REVIEW_LIMITS) || !Number.isFinite(value)) throw new UsageError(`--limit must look like name=number, with a name of: ${Object.keys(REVIEW_LIMITS).join(', ')} (got "${item}")`, 'review')
    limits[name as keyof ReviewLimits] = value
  }
  return { scene: p.args[0]!, sheet: p.flags.sheet === true, out: typeof p.flags.out === 'string' ? p.flags.out : null, limits, json: p.json }
}

// ── what the page reports about one frame ────────────────────────────────────────────────────────

export interface SeenNode {
  id: string
  kind: string
  /** the id of the group it is in, or null */
  parent: string | null
  leaf: boolean
  /** px of the stage, origin top-left */
  rect: { x: number; y: number; width: number; height: number }
  /** the text it shows, when it is a text */
  text: string | null
  /** its own opacity as drawn (0..1): the entrance included, the dimming of a focus on something else left out (that is by design, and it passes) */
  ink: number
  /** a short hash of every resolved option: differs when anything about its look differs */
  look: string
}
export interface SeenFrame {
  unavailable?: string
  stage: { width: number; height: number }
  params: Record<string, ParamValue>
  nodes: SeenNode[]
  /** ids that were asked for and are not on stage */
  missing: string[]
  /** lines of __mimir.describe(), when the viewer has it */
  lines: string[]
  /** the caption line as drawn in this frame (px of the stage), or null when none is showing */
  caption?: { x: number; y: number; width: number; height: number } | null
}

/**
 * Page-side: seek to t, wait for the settled frame, and list what is on stage. With `ids` only those are measured
 * (where a narration link points when its pointer lands).
 */
export function seeExpression(t: number, ids: readonly string[] | null): string {
  return `(async () => {
  ${LIB}
  await m.seek(${JSON.stringify(t)});
  await m.frame();
  const c = await cx();
  if (!c) return JSON.stringify({ unavailable: 'this viewer does not expose its frame state' });
  await m.frame();
  const f = c.runtime.frame, st = c.stage(), only = ${JSON.stringify(ids)};
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const lookOf = (n) => {
    try {
      return hash(JSON.stringify(f.props(n), (k, v) => (typeof v === 'function' ? 'fn' : v && typeof v === 'object' && typeof v.uid === 'number' && typeof v.id === 'string' ? '#' + v.id : v)));
    } catch (e) { return ''; }
  };
  const nodes = [], missing = [];
  for (const n of c.runtime.model.nodes) {
    if (only && !only.includes(n.id)) continue;
    let on = false;
    try { on = f.visible(n); } catch (e) {}
    const r = on ? c.screenRect(n) : null;
    if (!on || !r || !(r.width > 0 || r.height > 0)) { if (only) missing.push(n.id); continue; }
    const leaf = !(n.children && n.children.length);
    let text = null;
    if (leaf) { try { const tr = f.textRects(n); if (tr.length) text = tr.map((x) => x.text).join(' ').slice(0, 60); } catch (e) {} }
    let ink = 1;
    try { ink = f.opacity(n) * f.reveal(n).p; } catch (e) {}
    nodes.push({ id: n.id, kind: n.kind, parent: n.parent ? n.parent.id : null, leaf, rect: rect4(r), text, ink: r4(ink), look: only ? '' : lookOf(n) });
  }
  if (only) for (const id of only) if (!nodes.some((x) => x.id === id) && !missing.includes(id)) missing.push(id);
  let lines = [];
  if (!only && typeof m.describe === 'function') {
    try { const d = await m.describe(); lines = (Array.isArray(d) ? d : d ? [d] : []).map(String).slice(0, 12); } catch (e) {}
  }
  const s = m.state ? (m.state() || {}) : {};
  let caption = null;
  // the text an overlay writes that is not a label on an object is the caption line
  try { const o = c.runtime.overlayRects().find((x) => x.kind === 'text'); if (o && o.rect && o.rect.width > 0) caption = rect4(o.rect); } catch (e) {}
  return JSON.stringify({ stage: { width: st.width, height: st.height }, params: s.params || {}, nodes, missing, lines, caption });
})()`
}

// ── pure: from frames to findings and text ───────────────────────────────────────────────────────

export interface Box { x: number; y: number; w: number; h: number }
export interface Flag { code: string; steps: number[]; what: string; fix: string }
export interface CueLanding { words: string; verb: string; t: number; targets: Array<{ id: string; at: [number, number] | null }> }
export interface StepReview {
  step: number
  title: string
  t0: number
  t1: number
  params: Record<string, ParamValue>
  say: string[]
  /** every object on stage at the end of the step: centre and size in % of the frame */
  stage: Record<string, Box & { text: string | null; parent: string | null }>
  entered: string[]
  moved: string[]
  changed: string[]
  left: string[]
  /** x0, y0, x1, y1 of everything on stage, in % of the frame; null for an empty stage */
  content: [number, number, number, number] | null
  outside: string[]
  cues: CueLanding[]
  lines: string[]
}

const pct = (v: number, of: number): number => Math.round((100 * v) / of)

/** An id nobody chose: the kind and a counter (rect12, text3). Those are counted, not listed. */
export function isAutoId(id: string, kind: string): boolean {
  const m = /^([A-Za-z]+)\d+$/.exec(id)
  return m !== null && (m[1]!.toLowerCase() === kind.toLowerCase() || /^(rect|text|circle|ellipse|line|arrow|group|dot|path|polygon|polyline|row|column|grid|token|arc|brace|node|edge)$/i.test(m[1]!))
}

export function boxOf(n: SeenNode, stage: { width: number; height: number }): Box {
  return { x: pct(n.rect.x + n.rect.width / 2, stage.width), y: pct(n.rect.y + n.rect.height / 2, stage.height), w: pct(n.rect.width, stage.width), h: pct(n.rect.height, stage.height) }
}

/** Share (0..100) of a node's box that is inside the frame. */
export function insideShare(n: SeenNode, stage: { width: number; height: number }): number {
  const r = n.rect
  const area = Math.max(r.width, 1) * Math.max(r.height, 1)
  const w = Math.max(0, Math.min(r.x + Math.max(r.width, 1), stage.width) - Math.max(r.x, 0))
  const h = Math.max(0, Math.min(r.y + Math.max(r.height, 1), stage.height) - Math.max(r.y, 0))
  return (100 * w * h) / area
}

/** What changed between the ends of two steps. */
export function diffFrames(before: SeenFrame | null, now: SeenFrame, limits: ReviewLimits): Pick<StepReview, 'entered' | 'moved' | 'changed' | 'left'> {
  const was = new Map((before?.nodes ?? []).map((n) => [n.id, n]))
  const is = new Map(now.nodes.map((n) => [n.id, n]))
  const entered: string[] = [], moved: string[] = [], changed: string[] = [], left: string[] = []
  for (const n of now.nodes) {
    const p = was.get(n.id)
    if (!p) { entered.push(n.id); continue }
    const a = boxOf(p, before!.stage), b = boxOf(n, now.stage)
    if (Math.abs(a.x - b.x) > limits.moved || Math.abs(a.y - b.y) > limits.moved || Math.abs(a.w - b.w) > limits.moved || Math.abs(a.h - b.h) > limits.moved) moved.push(n.id)
    else if (n.leaf && (p.look !== n.look || p.text !== n.text || Math.abs(p.ink - n.ink) > 0.05)) changed.push(n.id)
  }
  for (const id of was.keys()) if (!is.has(id)) left.push(id)
  return { entered, moved, changed, left }
}

/** The box of everything on stage, in % of the frame. */
export function contentBox(frame: SeenFrame): [number, number, number, number] | null {
  const leaves = frame.nodes.filter((n) => n.leaf)
  if (!leaves.length) return null
  const { width: W, height: H } = frame.stage
  const x0 = Math.min(...leaves.map((n) => n.rect.x)), x1 = Math.max(...leaves.map((n) => n.rect.x + n.rect.width))
  const y0 = Math.min(...leaves.map((n) => n.rect.y)), y1 = Math.max(...leaves.map((n) => n.rect.y + n.rect.height))
  return [pct(Math.max(0, x0), W), pct(Math.max(0, y0), H), pct(Math.min(W, x1), W), pct(Math.min(H, y1), H)]
}

/**
 * The objects that reach into the caption line of a frame: the line as it is drawn there when one is showing, else
 * the zone every caption is drawn in (`limits.caption`), in both cases with `limits.captionGap` of air above it.
 */
export function captionCollisions(frame: SeenFrame | undefined, limits: ReviewLimits): Array<{ id: string; bottom: number; top: number }> {
  if (!frame) return []
  const { width: W, height: H } = frame.stage
  const cap = frame.caption ?? null
  const top = (cap ? (100 * cap.y) / H : limits.caption) - limits.captionGap
  const x0 = cap ? cap.x : 0, x1 = cap ? cap.x + cap.width : W
  const out: Array<{ id: string; bottom: number; top: number }> = []
  for (const n of frame.nodes) {
    if (!n.leaf) continue
    const bottom = (100 * Math.min(H, n.rect.y + n.rect.height)) / H
    if (bottom <= top || n.rect.x + n.rect.width <= x0 || n.rect.x >= x1 || n.rect.y >= H) continue
    out.push({ id: n.id, bottom: Math.round(bottom), top: Math.round(top + limits.captionGap) })
  }
  return out.sort((a, b) => b.bottom - a.bottom)
}

/** Composition findings over the whole story: each code once, with the steps it holds in. */
export function compositionFlags(steps: readonly StepReview[], frames: readonly SeenFrame[], limits: ReviewLimits): Flag[] {
  const hits = new Map<string, { steps: number[]; what: string; fix: string }>()
  const add = (code: string, step: number, what: string, fix: string): void => {
    const h = hits.get(code)
    if (h) h.steps.push(step)
    else hits.set(code, { steps: [step], what, fix })
  }
  const last = steps[steps.length - 1]
  steps.forEach((s, i) => {
    const b = s.content
    if (!b) return
    const [x0, y0, x1, y1] = b
    const w = x1 - x0, h = y1 - y0
    // a story builds up: size is judged where the picture is complete (the last step), position at every step
    if (s === last && (w < limits.smallWidth || (w * h) / 100 < limits.smallArea)) add('SMALL', s.step, `the finished picture is ${w}% of the frame wide and ${h}% tall`, 'make the main object larger (width, height, gap, scale) so the content spans 70-90% of the width')
    // an early step may well start at the top of a picture that is still filling up
    if (s === last && (y0 + y1) / 2 < limits.topHeavy) add('TOP-HEAVY', s.step, `the content sits at y ${y0}-${y1}% with an empty band below it`, 'centre the main object near y 45% (one .at(0, 0.5) on the main group)')
    const under = captionCollisions(frames[i], limits)
    if (under.length) add('CAPTION', s.step, `${under.slice(0, 3).map((u) => `#${u.id} reaches y ${u.bottom}%`).join(', ')}${under.length > 3 ? ` (+${under.length - 3})` : ''}: the caption line is drawn from y ${under[0]!.top}% down`, 'move it up or make it shorter; nothing goes below y -3.0 in frame units')
    const faint = (frames[i]?.nodes ?? []).filter((n) => n.leaf && n.text !== null && n.text.trim() !== '' && n.ink * 100 < limits.faintText)
    if (faint.length) add('FAINT-TEXT', s.step, `${faint.slice(0, 3).map((n) => `#${n.id} "${n.text}" at ${Math.round(n.ink * 100)}% opacity`).join(', ')}${faint.length > 3 ? ` (+${faint.length - 3})` : ''}`, 'raise its opacity or remove it; text nobody can read is noise')
    for (const c of s.cues) for (const t of c.targets) if (t.at === null) add('NOT ON STAGE YET', s.step, `"${c.words}" points at #${t.id} at ${c.t.toFixed(1)} s, before it is on stage`, `show #${t.id} in an earlier step, or leave it out of this step's entrance verbs so it is there when the sentence starts`)
  })
  if (last?.content) {
    const [x0, , x1] = last.content
    const left = x0, right = 100 - x1
    if (left > limits.lopsidedFar && right < limits.lopsidedNear) add('LOPSIDED', last.step, `the left ${left}% of the frame is empty while the content touches the right edge`, 'centre the whole layout (one .at(0, y) on the outer group)')
    if (right > limits.lopsidedFar && left < limits.lopsidedNear) add('LOPSIDED', last.step, `the right ${right}% of the frame is empty while the content touches the left edge`, 'centre the whole layout (one .at(0, y) on the outer group)')
  }
  return [...hits].map(([code, h]) => ({ code, steps: [...new Set(h.steps)], what: h.what, fix: h.fix }))
}

const num = (v: ParamValue): string => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v))

/** The text of a review (without the linter block and the last line). */
export function formatSteps(steps: readonly StepReview[], kinds: ReadonlyMap<string, string>, limits: ReviewLimits, duration: number): string[] {
  const out: string[] = [`story ${duration.toFixed(1)} s, ${steps.length} step${steps.length === 1 ? '' : 's'}. id@x,y WxH = centre and size in % of the frame (x from the left, y from the top)`]
  const auto = (id: string): boolean => isAutoId(id, kinds.get(id) ?? '')
  const list = (s: StepReview, ids: readonly string[], show: (id: string) => string): string => {
    // a group that is listed speaks for its parts
    const named = ids.filter((id) => !auto(id) && !(s.stage[id]?.parent != null && ids.includes(s.stage[id]!.parent!)))
    const rest = ids.length - named.length + Math.max(0, named.length - limits.listed)
    return named.slice(0, limits.listed).map(show).join('  ') + (rest > 0 ? `${named.length ? '  ' : ''}(+${rest} more)` : '')
  }
  let prev: StepReview | null = null
  for (const s of steps) {
    const params = Object.entries(s.params).map(([k, v]) => `${k}=${num(v)}`).join(' ')
    out.push(`step ${s.step} "${s.title}" ${s.t0.toFixed(1)}-${s.t1.toFixed(1)}s${params ? `  ${params}` : ''}`)
    for (const text of s.say) out.push(`  say: ${text}`)
    for (const line of s.lines) out.push(`  ${line}`)
    const at = (id: string): string => { const b = s.stage[id]!; return `${id}@${b.x},${b.y} ${b.w}x${b.h}${b.text !== null && b.text !== '' ? ` "${b.text}"` : ''}` }
    if (s.entered.length) out.push(`  new: ${list(s, s.entered, at)}`)
    if (s.moved.length) out.push(`  moved: ${list(s, s.moved, (id) => { const a = prev?.stage[id], b = s.stage[id]!; return `${id} ${a ? `${a.x},${a.y}->` : ''}${b.x},${b.y} ${b.w}x${b.h}` })}`)
    if (s.changed.length) out.push(`  changed look: ${list(s, s.changed, (id) => { const a = prev?.stage[id], b = s.stage[id]!; return a && a.text !== b.text && b.text !== null ? `${id} "${a.text ?? ''}"->"${b.text}"` : id })}`)
    if (s.left.length) out.push(`  gone: ${list(s, s.left, (id) => id)}`)
    if (prev && !s.entered.length && !s.moved.length && !s.changed.length && !s.left.length) out.push('  nothing entered, moved, changed or left: this step shows nothing new')
    if (s.outside.length) out.push(`  outside the frame: ${s.outside.join('; ')}`)
    out.push(s.content ? `  on stage: ${Object.keys(s.stage).length} objects, content x ${s.content[0]}-${s.content[2]}, y ${s.content[1]}-${s.content[3]}` : '  on stage: nothing')
    for (const c of s.cues) out.push(`  "${c.words}" ${c.verb} at ${c.t.toFixed(1)}s -> ${c.targets.map((t) => (t.at ? `#${t.id}@${t.at[0]},${t.at[1]}` : `#${t.id} NOT ON STAGE YET`)).join(' + ')}`)
    prev = s
  }
  return out
}

export interface SheetRef { path: string; width: number; height: number; tokens: number }

/** The last line: what to do next. */
export function verdictLine(check: Pick<CheckResult, 'ok' | 'errors'>, flags: readonly Flag[], sheet: SheetRef | null): string {
  const n = flags.length
  // text cannot say how it looks: when a sheet was rendered, opening it is the next thing to do, whatever else was found
  const look = sheet ? `\nNEXT: open ${sheet.path} with your image-reading tool NOW (${sheet.width}x${sheet.height}, about ${sheet.tokens} tokens; one look, required: a scene nobody looked at is reported as unseen), then fix what you saw and everything above in one edit.` : ''
  if (!check.ok) return `FIX FIRST: ${check.errors} error${check.errors === 1 ? '' : 's'}${n ? ` and ${n} flag${n === 1 ? '' : 's'}` : ''}. Fix all of them in one edit, then run mimir review again.${look}`
  if (n) return `FLAGS: no errors, ${n} flag${n === 1 ? '' : 's'} to fix in one edit.${look}`
  return `CLEAN: no errors, no flags.${sheet ? look : ' (no sheet rendered: --sheet renders one)'}`
}

/** What a scene made by explain() says about itself (info().quick on the host), as far as a review reads it. */
interface QuickTold { steps?: Array<{ step: number; onStage?: string[]; blocks?: Record<string, string>; changed?: string[] }> }

/** the composition findings that only a position or a size can answer */
export const LAYOUT_CODES: readonly string[] = ['SMALL', 'TOP-HEAVY', 'LOPSIDED', 'CAPTION']

/**
 * Whose finding is it? In a scene made by explain() the author writes no position and no size: the stage arranges,
 * fits and centres. A finding about size or place is then the stage's own (a note for whoever works on the engine),
 * and asking the author to fix it would cost a round that can change nothing.
 */
export function splitFlags(flags: readonly Flag[], staged: boolean): { flags: Flag[]; layout: Flag[] } {
  if (!staged) return { flags: [...flags], layout: [] }
  return { flags: flags.filter((f) => !LAYOUT_CODES.includes(f.code)), layout: flags.filter((f) => LAYOUT_CODES.includes(f.code)) }
}

export interface ReviewResult {
  ok: boolean
  errors: number
  warnings: number
  clean: boolean
  flags: Flag[]
  /** findings about size and place in a scene whose layout the stage of explain() made: reported, not the author's to fix */
  layout?: Flag[]
  steps: StepReview[]
  sheet: SheetRef | null
  check: CheckResult
  /** set when the frame state could not be read: only the linter ran */
  unavailable?: string
}

const shown = (path: string, cwd: string): string => {
  const rel = relative(cwd, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : path
}

/** Run the review; nothing is printed. */
export async function reviewScene(opts: ReviewOptions, io: Io): Promise<{ result: ReviewResult; info: SceneInfo; ctx: FileContext; kinds: Map<string, string> }> {
  const scene = resolveScene(opts.scene, io.cwd, 'review')
  const viewer = await ensureViewer(io.env, io.log)
  const quiet = (_message: string): void => {}
  const session = await openSession({ scene, viewerRoot: viewer.dir, width: 1280, height: 720, scale: 1, log: quiet })
  const ctx: FileContext = { sceneDir: scene.dir, cwd: io.cwd }
  const steps: StepReview[] = []
  const frames: SeenFrame[] = []
  const kinds = new Map<string, string>()
  let check: CheckResult
  let unavailable: string | undefined
  let info: SceneInfo
  const told: { quick: QuickTold | null } = { quick: null }
  try {
    info = session.info
    if (info.fatal) {
      check = buildCheckResult([fatalToDiag(info.fatal, scene.url)], false)
    } else {
      const raw = await session.host<unknown>('diagnostics', { sample: true })
      check = buildCheckResult((Array.isArray(raw) ? raw : []).map(normalizeDiag).map((d) => ({ ...d, fix: d.fix.map((f) => f.replace('mimir shot <scene>', `mimir shot ${opts.scene}`)) })), false)
      try { told.quick = (await session.host<{ quick?: QuickTold | null }>('info'))?.quick ?? null } catch { told.quick = null }
      const timeoutMs = timeoutFromEnv(io.env)
      const see = async (t: number, ids: readonly string[] | null): Promise<SeenFrame> => JSON.parse(await session.page.evaluate<string>(seeExpression(t, ids), timeoutMs)) as SeenFrame
      const cues = storyCues(info).cues
      let before: SeenFrame | null = null
      for (const plan of planFrames(info, { kind: 'steps' })) {
        const frame = await see(plan.t, null)
        if (frame.unavailable) { unavailable = frame.unavailable; break }
        for (const n of frame.nodes) kinds.set(n.id, n.kind)
        const step = info.steps.find((s) => s.index === plan.step)
        const entry = (info.transcript ?? []).find((t) => t.step === plan.step)
        const stage: StepReview['stage'] = {}
        for (const n of frame.nodes) stage[n.id] = { ...boxOf(n, frame.stage), text: n.text, parent: n.parent }
        const landings: CueLanding[] = []
        for (const c of cues.filter((c) => c.step === plan.step)) {
          const at = await see(Math.min(c.land + opts.limits.landGrace, step?.t1 ?? c.land + opts.limits.landGrace), c.targets)
          landings.push({ words: c.words, verb: c.verb, t: c.land, targets: c.targets.map((id) => { const n = (at.nodes ?? []).find((x) => x.id === id); const b = n ? boxOf(n, at.stage) : null; return { id, at: b ? [b.x, b.y] as [number, number] : null } }) })
        }
        steps.push({
          step: plan.step ?? steps.length + 1, title: step?.title ?? plan.title, t0: step?.t0 ?? 0, t1: step?.t1 ?? plan.t, params: frame.params,
          say: (entry?.narration ?? []).map((n) => n.text), stage, ...diffFrames(before, frame, opts.limits), content: contentBox(frame),
          outside: frame.nodes.filter((n) => n.leaf && insideShare(n, frame.stage) < opts.limits.inside).map((n) => `${n.id} ${Math.round(100 - insideShare(n, frame.stage))}%`),
          cues: landings, lines: frame.lines ?? [],
        })
        frames.push(frame)
        before = frame
      }
    }
  } finally {
    await session.close()
  }
  if (viewer.stale) { check.stale = true; check.build_error = viewer.stale }
  // an explain() scene keeps an account of itself (info().quick on the host): its stage made the layout
  const account = told.quick
  const { flags, layout } = splitFlags(compositionFlags(steps, frames, opts.limits), account !== null)
  if (account?.steps) for (const s of steps) {
    const told = account.steps.find((a) => a.step === s.step)
    // one line per block from the block itself (what state it is in), `*` on the ones this step changed
    if (told?.blocks && !s.lines.length) s.lines = (told.onStage ?? Object.keys(told.blocks)).map((id) => `${told.changed?.includes(id) ? '*' : ' '} ${id}: ${told.blocks![id] ?? ''}`).slice(0, 12)
  }

  let sheet: SheetRef | null = null
  if (!info.fatal && opts.noSheet !== true && (opts.sheet || flags.length > 0)) {
    const dir = opts.out !== null ? resolve(io.cwd, opts.out) : join(io.cwd, '.mimir', 'review', scene.name)
    let printed = ''
    const capture: Io = { ...io, json: true, log: quiet, out: (text) => { printed += text } }
    try {
      await shot(toShotOptions(parseFlags(COMMANDS.shot!, [opts.scene, '--sheet', '--out', dir, '--json'])), capture)
      const entries = JSON.parse(printed) as Array<{ path?: string; width?: number; height?: number; sheet?: unknown }>
      const e = entries.find((x) => x.sheet !== undefined && typeof x.path === 'string')
      if (e) sheet = { path: shown(e.path!, io.cwd), width: e.width ?? 0, height: e.height ?? 0, tokens: imageTokens(e.width ?? 0, e.height ?? 0) }
    } catch (e) {
      io.log(`no sheet: ${(e as Error).message.split('\n')[0]}`)
    }
  }
  return { result: { ok: check.ok, errors: check.errors, warnings: check.warnings, clean: check.ok && flags.length === 0, flags, ...(layout.length ? { layout } : {}), steps, sheet, check, ...(unavailable ? { unavailable } : {}) }, info, ctx, kinds }
}

export function formatReviewText(r: ReviewResult, info: SceneInfo, ctx: FileContext, kinds: ReadonlyMap<string, string>, limits: ReviewLimits): string {
  const out: string[] = [formatCheckText(r.check, info.steps, ctx).trimEnd()]
  if (r.steps.length) out.push('', ...formatSteps(r.steps, kinds, limits, info.duration))
  if (r.unavailable) out.push('', `(no step description: ${r.unavailable})`)
  if (r.flags.length) out.push('', ...r.flags.map((f) => `FLAG ${f.code} (step ${f.steps.join(', ')}): ${f.what}. Fix: ${f.fix}`))
  if (r.layout?.length) out.push('', ...r.layout.map((f) => `NOTE ${f.code} (step ${f.steps.join(', ')}): ${f.what}. The stage of explain() arranged this: nothing in the script sets it.`))
  out.push('', verdictLine(r.check, r.flags, r.sheet))
  return out.join('\n') + '\n'
}

export async function review(opts: ReviewOptions, io: Io): Promise<number> {
  const { result, info, ctx, kinds } = await reviewScene(opts, io)
  if (opts.json) {
    const { check, ...rest } = result
    io.out(JSON.stringify({ ...rest, diagnostics: (JSON.parse(formatCheckJson(check, ctx)) as { diagnostics: unknown[] }).diagnostics }) + '\n')
  } else io.out(formatReviewText(result, info, ctx, kinds, opts.limits))
  return result.ok ? 0 : 1
}
