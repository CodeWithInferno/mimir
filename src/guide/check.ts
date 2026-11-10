// src/guide/check.ts: the guide's check rules (lazy check chunk). GUIDE-TARGET (a mark on something the viewer cannot
// see at the moment it lands), the narration lint of src/lib/guide (long sentences, crowded sentences, dead air, a
// pointer that arrives late, symbols speech cannot say, a part pointed at twice) and NO-VISUAL-BEAT. TEXT-LONG (labels
// and captions) is owned by src/check/rules-story.ts; it reads the `label` actions this module records.
// A rule reports what it measured: without a browser the pixel checks stay silent.
import { defineRule, isNode, kindOf, type MNode, type RuleCtx } from '../core/index.ts'
import { lintNarration } from '../lib/guide/lint.ts'
import type { NarrationLint } from '../lib/guide/types.ts'
import { guideConfig, guideStore, type GuideCueRec, type GuideSay, type GuideStep } from './index.ts'

/** A part whose box on screen is smaller than this (px, either way) cannot be pointed at. */
export const GUIDE_MIN_PIXELS = 4
const leavesOf = (node: MNode): MNode[] => (node.children.length ? node.children.flatMap(leavesOf) : [node])
/** Do two boxes share any area? */
const meets = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const pct = (x: number): number => Math.round(x * 100)

// ── GUIDE-TARGET ─────────────────────────────────────────────────────────────────────────────────────
defineRule({
  code: 'GUIDE-TARGET', phase: 'story', override: true, // replaces the seed rule of src/check: same forwarding, plus the measured part
  run(c) {
    const model = c.model
    // 1. what the build recorded: a span that names no object (with its did-you-mean)
    for (const d of model.diagnostics.byCode('GUIDE-TARGET')) c.report({ what: d.what, fix: d.fix, ids: d.ids, measured: d.measured, limit: d.limit, severity: d.severity, step: d.step, t: d.t, line: d.line, file: d.file })
    // 2. st.focus / st.label on something that is not on stage at the end of the step
    for (const a of model.actions) {
      if (a.type !== 'focus' && a.type !== 'label') continue
      const step = model.steps[a.step]
      const data = a.data as { node?: unknown; nodes?: unknown[]; cue?: number }
      if (data.cue !== undefined) continue // a label made by a span is judged at its landing time, below
      const nodes = (a.type === 'focus' ? data.nodes ?? [] : [data.node]).filter(isNode)
      if (!step || !nodes.length) continue
      const f = c.stateAt(Math.max(step.t0, step.t1 - 1e-3))
      const gone = nodes.filter((n: MNode) => !f.visible(n))
      if (!gone.length || (a.type === 'focus' && gone.length < nodes.length)) continue
      c.report({ severity: 'warn', ids: gone.map((x) => x.id), step: step.k, t: null, line: a.src.line, file: a.src.file ?? undefined, what: `st.${a.type}() in step ${step.k} points at ${gone.map((x) => `#${x.id}`).join(', ')}, which ${gone.length === 1 ? 'is' : 'are'} not visible in that step${a.type === 'focus' ? ', so the whole stage is dimmed and nothing stands out' : ''}.`, fix: [`show it first: st.play(fadeIn(${gone[0]!.id}))`, `or remove this st.${a.type}()`] })
    }
    // 3. every cue, at the moment its mark lands: the part must be shown, inside the frame and not covered
    const cfg = guideConfig(model)
    for (const gs of guideStore(model).steps.values()) {
      const rec = model.steps[gs.index]
      if (!rec) continue
      for (const cue of gs.cues) {
        if (!cue.nodes.length) continue
        const tau = Math.min(rec.t0 + cue.landAt, rec.t1 - 1e-3)
        const frame = c.stateAt(tau)
        const where = { step: rec.k, t: Math.round(tau * 100) / 100, line: cue.src.line, file: cue.src.file ?? undefined }
        const said = `"[${cue.words}](${cue.verb}:…)"`
        const hidden = cue.nodes.filter((n) => !frame.visible(n))
        for (const n of hidden) c.report({ ...where, ids: [n.id], what: `st.say(): ${said} lands on #${n.id} at ${where.t} s, but #${n.id} is not shown then.`, fix: [`show it before the sentence: st.play(fadeIn(${n.id}))`, 'or name a part that is on stage', `or say the words plainly: ${cue.words}`] })
        const rt = c.runtime, stage = c.stage
        if (!rt || !stage) continue // no browser: nothing below was measured
        rt.seek(tau)
        rt.render(true)
        const pass = cue.nodes.some((n) => n.space === '3d') ? rt.idPass({ solo: true }) : null
        for (const n of cue.nodes) {
          if (hidden.includes(n)) continue
          const r = rt.screenRect(n)
          // how much of its box lies inside the frame, each way (a level line has a box of no height: zero is still inside)
          const inside = r ? Math.min(r.x + r.width, stage.width) - Math.max(r.x, 0) : -1, tall = r ? Math.min(r.y + r.height, stage.height) - Math.max(r.y, 0) : -1
          if (!r || inside < 0 || tall < 0 || (inside <= 0 && tall <= 0)) { c.report({ ...where, ids: [n.id], what: `st.say(): ${said} lands on #${n.id} at ${where.t} s, but #${n.id} is outside the frame then.`, fix: [n.space === '3d' ? `bring it into view first: st.camera({ fit: [${n.id}] })` : `move it into the frame: ${n.id}.at(0, 0)`, `or say the words plainly: ${cue.words}`] }); continue }
          if (Math.max(r.width, r.height) < GUIDE_MIN_PIXELS) { c.report({ ...where, ids: [n.id], measured: Math.round(Math.max(r.width, r.height)), limit: GUIDE_MIN_PIXELS, what: `st.say(): ${said} lands on #${n.id}, which is ${Math.round(Math.max(r.width, r.height))} px across at ${where.t} s (minimum ${GUIDE_MIN_PIXELS} px).`, fix: [n.space === '3d' ? `st.camera({ fit: [${n.id}] })` : `${n.id}.scale(2)`] }); continue }
          if (n.space !== '3d' || !pass) continue
          // how much of a part shows is ONE finding with OCCLUDED: a part the scene declared as hidden by nature
          // (allow('OCCLUDED'): a rod between its piston and its crank webs) is not asked about a second time here
          if ((c as RuleCtx & { allowed?: (code: string, node: MNode) => boolean }).allowed?.('OCCLUDED', n)) continue
          let seen = 0, total = 0
          for (const leaf of leavesOf(n)) { const p = pass.parts[leaf.id]; if (p) { seen += p.pixels; total += p.total ?? p.pixels } }
          if (total <= 0) continue // nothing of it was drawn alone: a housing, or not measurable
          const share = seen / total
          // the same exception as OCCLUDED: a part declared to sit behind its neighbours (part.allow('OCCLUDED', other):
          // a shaft inside its rotor) is held to the smaller share that rule asks of it, when every part that overlaps
          // it on screen was declared
          const ctx = c as RuleCtx & { allowed?: (code: string, a: MNode, b?: MNode) => boolean; limits?: { occludedDeclared?: number } }
          const over = r ? frame.visibleLeaves('3d').filter((o) => !leavesOf(n).includes(o) && pass.parts[o.id] && meets(pass.parts[o.id]!.rect, r)) : []
          const declared = over.length > 0 && typeof ctx.limits?.occludedDeclared === 'number' && over.every((o) => ctx.allowed?.('OCCLUDED', n, o))
          const need = declared ? Math.min(cfg.minimumVisibleShare, ctx.limits!.occludedDeclared!) : cfg.minimumVisibleShare
          if (share >= need) continue
          c.report({ ...where, ids: [n.id], measured: pct(share), limit: pct(need), what: `st.say(): ${said} lands on #${n.id} at ${where.t} s, but only ${pct(share)}% of it can be seen (${seen} of ${total} px; at least ${pct(need)}% must show).`, fix: [`turn the camera before the sentence: st.camera({ fit: [${n.id}] })`, 'or make what covers it a ghost / cut it away', `or say the words plainly: ${cue.words}`] })
        }
      }
    }
  },
})

// ── narration lint: one rule per finding of src/lib/guide ────────────────────────────────────────────
interface Finding extends NarrationLint { gs: GuideStep; say: GuideSay }
function findings(c: RuleCtx): Finding[] {
  return c.model.store<{ list: Finding[] | null }>('guide.lint', () => ({ list: null })).list ??= (() => {
    const cfg = guideConfig(c.model), out: Finding[] = []
    const clips = c.model.allClips()
    for (const gs of guideStore(c.model).steps.values()) gs.says.forEach((say, j) => {
      // a step in which something else happens on screen (a play, a sweep, a camera move, st.label, st.focus, a flow or a
      // simulation that runs with time) has no dead air
      const busy = clips.some((clip) => clip.step === gs.index && clip.prop !== 'guideGlow') || c.model.actions.some((a) => a.step === gs.index && a.type !== 'say' && a.type !== 'cue' && (a.data as { cue?: number })?.cue === undefined) || movesAlone(c, gs.index)
      // the cues as they were compiled for the whole step (a flight may start during the sentence before), in the sentence's own time
      const cues = gs.cues.filter((q: GuideCueRec) => q.say === j).map((q) => ({ ...q, wordAt: q.wordAt - say.at, wordEnd: q.wordEnd - say.at, fireAt: q.fireAt - say.at, landAt: q.landAt - say.at, drawEnd: q.drawEnd - say.at, markEnd: q.markEnd - say.at }))
      const schedule = { duration: say.timing.duration, speechStart: say.timing.speechStart, speechEnd: say.timing.speechEnd, cues }
      // every id is taken as known here: unknown parts are GUIDE-TARGET, reported when the scene is built
      const manifest = say.parsed.spans.flatMap((sp) => sp.targets).map((id) => ({ id }))
      for (const f of lintNarration({ ...say.parsed, errors: [] }, schedule, manifest, { maxSentenceWords: cfg.maximumSentenceWords, maxMarksPerSentence: cfg.maximumMarksPerSentence, maxDeadAir: cfg.maximumDeadAir, maxLate: cfg.maximumLate })) if (!(busy && f.code === 'GUIDE-DEAD-AIR')) out.push({ ...f, gs, say })
    })
    return out
  })()
}
for (const code of ['SAY-LONG', 'GUIDE-CROWDED', 'GUIDE-DEAD-AIR', 'GUIDE-LATE', 'SAY-SYMBOL', 'GUIDE-REPEAT']) {
  defineRule({
    code, severity: 'warn', phase: 'static',
    run(c) {
      for (const f of findings(c)) {
        if (f.code !== code) continue
        const rec = c.model.steps[f.gs.index]
        c.report({ step: rec ? rec.k : null, t: null, line: f.say.src.line, file: f.say.src.file ?? undefined, measured: f.measured === undefined ? null : Math.round(f.measured * 100) / 100, limit: f.limit ?? null, what: `st.say(): ${f.what}.`, fix: f.fix })
      }
    },
  })
}

/** Moments of a step (shares of its active time) compared to see whether the picture changes with time alone. */
const MOTION_PROBES = [0.2, 0.5, 0.8]
/** Something on stage moves during the step without a clip: a flow, a pendulum, anything that reads s.t(). */
function movesAlone(c: RuleCtx, index: number): boolean {
  const rec = c.model.steps[index]
  if (!rec) return false
  const seen = new Set(MOTION_PROBES.map((u) => c.stateAt(rec.t0 + rec.active * u).signature({ excludeActions: ['say', 'cue'] })))
  return seen.size > 1
}

/** The step puts something on stage that was not there at the end of the step before (in step 1: the stage itself). */
function showsSomethingNew(c: RuleCtx, index: number): boolean {
  const rec = c.model.steps[index], prev = c.model.steps[index - 1]
  if (!rec) return false
  const now = c.stateAt(rec.t1 - 1e-3), before = prev ? c.stateAt(prev.t1 - 1e-3) : null
  return c.model.nodes.some((n) => !kindOf(n.kind)?.container && now.visible(n) && !(before && before.visible(n)))
}

// ── NO-VISUAL-BEAT: narration with nothing on screen that goes with it ───────────────────────────────
defineRule({
  code: 'NO-VISUAL-BEAT', severity: 'warn', phase: 'static',
  run(c) {
    const clips = c.model.allClips()
    for (const gs of guideStore(c.model).steps.values()) {
      const rec = c.model.steps[gs.index]
      if (!rec || !gs.says.length) continue
      if (gs.cues.some((q) => q.nodes.length > 0)) continue
      if (c.model.actions.some((a) => a.step === gs.index && a.type !== 'say')) continue
      if (clips.some((clip) => clip.step === gs.index)) continue
      if (movesAlone(c, gs.index) || showsSomethingNew(c, gs.index)) continue
      const words = gs.says.reduce((n, say) => n + say.parsed.words.length, 0)
      const first = c.model.nodes.find((n) => !n.parent)
      c.report({ step: rec.k, t: null, line: gs.says[0]!.src.line, file: gs.says[0]!.src.file ?? undefined, measured: words, what: `step ${rec.k} speaks ${words} words and nothing on screen moves, appears or is pointed at.`, fix: [`link the words that name a part: st.say('… the [${first?.id ?? 'part'}](${first?.id ?? 'partId'}) …')`, 'or show what the sentence is about: st.play(…), st.set(param, value), st.camera(…), st.focus(part)'] })
    }
  },
})
