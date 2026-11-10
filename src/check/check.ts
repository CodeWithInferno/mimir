// The rules of `mimir check` (DESIGN §7). This file is the entry of the lazy check chunk: it holds the rules that
// forward what the build recorded and the first measured ones (EMPTY-FRAME, OFF-FRAME, TEXT-OVERLAP, STATIC-STEP,
// DEAD-PARAM, NOT-PURE), and imports the rest:
//   ./rules-solid.ts  INTERPENETRATE, COLLIDE-IN-MOTION, PARAM-BREAKS, FLOATING, CONTAINED, COINCIDENT, CAMERA-CLIP
//   ./rules-story.ts  EXPECT-FAILED, MECH-OPEN, PLACE-NONE, TEXT-LONG, CHAPTER-LONG, HATCH-USE
//   ./rules-view.ts   OCCLUDED, LABEL-COVERS, TINY, SUBJECT-FIT, TEXT-TINY, CONTRAST-TEXT, COLOR-COUNT
// Every rule, with what it measures, its threshold and its exemptions, is in ./RULES.md.
// A rule reports only what it measured; without a browser the measured rules stay silent (unknown, not pass).
import { defineRule, FRAME_H, FRAME_W, isNode, kindOf, spaceOf, stable, type MNode, type ParamValue, type Rect, type RuleCtx, type Vec3 } from '../core/index.ts'
import type { CheckCtx } from './engine.ts'
import { END_EPSILON, insideShares } from './plan.ts'
import './rules-solid.ts'
import './rules-story.ts'
import './rules-view.ts'

// ── recorded while building or evaluating: forwarded as they are ─────────────────────────────────────
for (const code of ['API-UNKNOWN', 'API-TYPE', 'REF-MISSING', 'NUM-INVALID', 'RUNTIME-ERROR', 'ID-DUP', 'PLACE-CONFLICT']) {
  defineRule({
    code, phase: 'static',
    run(c) { for (const d of c.model.diagnostics.byCode(code)) c.report({ what: d.what, fix: d.fix, ids: d.ids, measured: d.measured, limit: d.limit, severity: d.severity, step: d.step, t: d.t, line: d.line, file: d.file, params: d.params }) },
  })
}

// ── GUIDE-TARGET: what the build recorded (a span that names no object), and marks that point at nothing visible ──────
defineRule({
  code: 'GUIDE-TARGET', phase: 'static',
  run(c) {
    for (const d of c.model.diagnostics.byCode('GUIDE-TARGET')) c.report({ what: d.what, fix: d.fix, ids: d.ids, measured: d.measured, limit: d.limit, severity: d.severity, step: d.step, t: d.t, line: d.line, file: d.file })
    // st.focus / st.label on something that is not on stage: the mark shows nothing, and a focus dims everything else
    for (const a of c.model.actions) {
      if (a.type !== 'focus' && a.type !== 'label') continue
      const step = c.model.steps[a.step]
      const data = a.data as { node?: unknown; nodes?: unknown[] }
      const nodes = (a.type === 'focus' ? data.nodes ?? [] : [data.node]).filter(isNode)
      if (!step || !nodes.length) continue
      const f = c.stateAt(Math.max(step.t0, step.t1 - END_EPSILON))
      const gone = nodes.filter((n: MNode) => !f.visible(n))
      if (!gone.length || (a.type === 'focus' && gone.length < nodes.length)) continue
      const n = gone[0]!
      c.report({ severity: 'warn', ids: gone.map((x) => x.id), step: step.k, t: null, line: a.src.line, file: a.src.file ?? undefined, what: `st.${a.type}() in step ${step.k} points at ${gone.map((x) => `#${x.id}`).join(', ')}, which ${gone.length === 1 ? 'is' : 'are'} not visible in that step${a.type === 'focus' ? ', so the whole stage is dimmed and nothing stands out' : ''}.`, fix: [`show it first: st.play(fadeIn(${n.id}))`, `or remove this st.${a.type}()`] })
    }
  },
})

const pct = (x: number): string => (x * 100 < 10 ? (x * 100).toFixed(1) : String(Math.round(x * 100)))
const overlap = (a: Rect, b: Rect): { w: number; h: number } => ({ w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) })
const r1 = (x: number): number => Math.round(x * 10) / 10

// ── EMPTY-FRAME ──────────────────────────────────────────────────────────────────────────────────────
defineRule({
  code: 'EMPTY-FRAME', phase: 'sample', on: ['step-end'],
  run(c) {
    const st = c.stage
    if (!st || !c.frame) return
    // 2D: cells of a coarse grid touched by any visible object; 3D: pixels of the id pass
    const L = (c as CheckCtx).limits
    const GX = Math.max(1, Math.round(L.emptyGrid)), GY = Math.max(1, Math.round((GX * st.height) / st.width))
    const grid = new Uint8Array(GX * GY)
    for (const n of c.visible('2d')) {
      const r = c.screenRect(n)
      if (!r) continue
      const x0 = Math.max(0, Math.floor((r.x / st.width) * GX)), x1 = Math.min(GX - 1, Math.floor(((r.x + Math.max(r.width, 1)) / st.width) * GX))
      const y0 = Math.max(0, Math.floor((r.y / st.height) * GY)), y1 = Math.min(GY - 1, Math.floor(((r.y + Math.max(r.height, 1)) / st.height) * GY))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * GX + x] = 1
    }
    let covered = grid.reduce((s, v) => s + v, 0) / (GX * GY)
    const pass = c.idPass()
    if (pass) covered += Object.values(pass.parts).reduce((s, p) => s + p.pixels, 0) / (st.width * st.height)
    const least = L.emptyFrame
    if (covered >= least) return
    const all = c.model.nodes.filter((n) => !kindOf(n.kind)?.container)
    const hidden = all.filter((n) => !c.frame!.visible(n))
    // one 3D part far from all the others: the camera fits everything, so everything becomes a speck
    const parts = c.visible('3d')
    if (parts.length >= 2) {
      const f = c.frame
      const centres = parts.map((n) => f.anchor(n, 'center'))
      const mid = (i: number): number => { const v = centres.map((p) => p[i]!).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]! }
      const m: Vec3 = [mid(0), mid(1), mid(2)]
      const far = centres.map((p) => Math.hypot(p[0] - m[0], p[1] - m[1], p[2] - m[2]))
      const order = [...far].sort((a, b) => a - b)
      const worst = far.indexOf(order[order.length - 1]!)
      const rest = Math.max(order[order.length - 2] ?? 0, 1)
      if (far[worst]! > L.emptyFar * rest) {
        const n = parts[worst]!
        c.report({ ids: [n.id], line: n.src.line, file: n.src.file ?? undefined, measured: r1(covered * 100), limit: least * 100, what: `${pct(covered)}% of the frame is covered: #${n.id} is ${Math.round(far[worst]!)} units from the other parts (they are within ${r1(rest)} of each other), and the camera frames all of them, so each is a speck.`, fix: [`move #${n.id} next to the others (check the numbers in its .at(…) or the function that places it)`, `or frame the others: st.camera({ fit: [${parts.filter((x) => x !== n).slice(0, 3).map((x) => x.id).join(', ')}] })`] })
        return
      }
    }
    const fix = !all.length ? ['create something: text("…"), rect({ … }), box({ … })']
      : hidden.length === all.length ? [`show something in this step, e.g. st.play(fadeIn(${hidden[0]!.id}))`, 'or create the objects without an enter verb so they are visible from the start']
      : c.model.cameraClips().length ? ['remove the st.camera() call of this step (the camera fits the model on its own)', 'st.camera({ fit: true })'] : ['move the objects into the frame: x within ±6.6, y within ±3.5']
    c.report({ measured: r1(covered * 100), limit: least * 100, what: `${pct(covered)}% of the frame is covered (${!all.length ? 'the scene has no objects' : hidden.length === all.length ? `all ${all.length} objects are hidden at this time` : 'nothing visible is inside the frame'}).`, fix })
  },
})

// ── OFF-FRAME ────────────────────────────────────────────────────────────────────────────────────────
defineRule({
  code: 'OFF-FRAME', phase: 'sample', on: ['step-end', 'param'],
  run(c) {
    const st = c.stage
    const f = c.frame
    if (!st || !f) return
    const vp = c.model.viewportRect()
    // while the 2D camera is zoomed in, 2D objects outside the view are the point of the zoom, not a mistake:
    // only screen-space (hud) objects and 3D parts are held to the frame then
    const zoomed = f.zoomed()
    // a problem that shows only with a param pinned (a slider extreme) is not fixed by moving the object in the default picture
    const pinned = c.sample && c.sample.kind !== 'step-end' ? Object.keys(c.sample.params) : []
    for (const n of c.visible()) {
      if (zoomed && spaceOf(n) === '2d') continue
      let r: Rect | null
      let box: Rect // what the object must stay inside, stage px
      if (n.space === '3d') {
        const fr = f.frameRect(n)
        if (!fr || !vp) continue
        r = c.runtime!.rectToStage(fr)
        box = c.runtime!.rectToStage(vp)
      } else {
        r = c.screenRect(n)
        box = { x: 0, y: 0, width: st.width, height: st.height }
      }
      if (!r) continue
      const w = Math.max(r.width, 1), h = Math.max(r.height, 1)
      const over = { left: box.x - r.x, right: r.x + w - (box.x + box.width), top: box.y - r.y, bottom: r.y + h - (box.y + box.height) }
      const side = (Object.keys(over) as (keyof typeof over)[]).reduce((a, b) => (over[b] > over[a] ? b : a))
      const past = over[side]
      if (past <= 0) continue
      const iw = Math.max(0, Math.min(r.x + w, box.x + box.width) - Math.max(r.x, box.x)), ih = Math.max(0, Math.min(r.y + h, box.y + box.height) - Math.max(r.y, box.y))
      const outside = 1 - (iw * ih) / (w * h)
      const isText = !!kindOf(n.kind)?.text
      if (isText ? past <= (c as CheckCtx).limits.offFrameTextPixels : outside <= (c as CheckCtx).limits.offFrame) continue
      const units = r1(past / st.scale + 0.3)
      const fix = pinned.length
        ? [`keep #${n.id} in the frame for every value of ${pinned.join(', ')}: limit where it can go (Math.min / Math.max in the function that places it)`, `or narrow the range in s.param('${pinned[0]}', { min, max })`]
        : n.space === '3d'
        ? [c.model.cameraClips().length ? 'remove the st.camera() call that frames this step (the camera fits the model on its own)' : `st.camera({ fit: true })`, `st.camera({ fit: [${n.id}] })`]
        : [`move it back in: .shift(${side === 'left' ? units : side === 'right' ? -units : 0}, ${side === 'top' ? -units : side === 'bottom' ? units : 0})`, 'or place it relative to something inside the frame: .nextTo(other, \'down\')']
      c.report({ ids: [n.id], line: n.src.line, file: n.src.file ?? undefined, measured: Math.round(outside * 100), limit: isText ? 0 : Math.round((c as CheckCtx).limits.offFrame * 100), what: `${Math.round(outside * 100)}% of ${n.id} is beyond the ${side} edge of the ${n.space === '3d' ? '3D panel' : 'frame'} (extends ${Math.round(past)} px past it).`, fix })
    }
  },
})

// ── TEXT-OVERLAP ─────────────────────────────────────────────────────────────────────────────────────
defineRule({
  code: 'TEXT-OVERLAP', phase: 'sample', on: ['step-end'],
  run(c) {
    if (!c.stage || !c.frame) return
    // every piece of text on screen: text nodes, text inside composite kinds (textRects), overlays (labels, caption)
    const items = c.textBoxes()
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i]!, B = items[j]!
      const o = overlap(A.rect, B.rect)
      const L = (c as CheckCtx).limits
      if (o.w <= L.textOverlapPixels || o.h <= L.textOverlapPixels) continue
      const smaller = Math.min(A.rect.width * A.rect.height, B.rect.width * B.rect.height)
      const share = (o.w * o.h) / Math.max(1, smaller)
      if (share <= L.textOverlap) continue
      // whoever drew the text knows the way out best: an overlay's own fix wins over the generic one
      // a part of a composite ('node.label') is not a variable of the scene: name the composite the author made
      const name = (id: string | undefined, dflt: string): string => { let n = id === undefined ? undefined : c.model.byId.get(id); while (n?.parent && n.id.startsWith(n.parent.id + '.')) n = n.parent; return n?.id ?? id ?? dflt }
      const a = name(A.ids[0], 'a'), b = name(B.ids[0], 'b')
      const fix = B.fix ?? A.fix ?? (a === b ? [`#${a} draws both texts: make it larger, or shorten one of them`] : [`put one beside the other: ${b}.nextTo(${a}, 'down')`, `or stack them with column([${a}, ${b}])`])
      c.report({ ids: [...new Set([...A.ids, ...B.ids])], line: B.line ?? A.line, measured: Math.round(share * 100), limit: Math.round(L.textOverlap * 100), what: `${A.name} and ${B.name} overlap by ${Math.round(o.w)} x ${Math.round(o.h)} px (${Math.round(share * 100)}% of the smaller).`, fix })
    }
  },
})

// ── STATIC-STEP ──────────────────────────────────────────────────────────────────────────────────────
defineRule({
  code: 'STATIC-STEP', phase: 'story',
  run(c) {
    const steps = c.model.steps
    const sig = (i: number): string => c.stateAt(Math.max(steps[i]!.t0, steps[i]!.t1 - END_EPSILON)).signature({ excludeActions: ['say'] })
    for (let i = 1; i < steps.length; i++) {
      if (sig(i) !== sig(i - 1)) continue
      const s = steps[i]!
      // a step may also move and come back; look inside it before calling it static
      const inside = insideShares((c as CheckCtx).limits.planTransitions).some((u) => c.stateAt(s.t0 + s.active * u).signature({ excludeActions: ['say'] }) !== sig(i - 1))
      if (inside) continue
      const acts = c.model.actions.filter((a) => a.step === i).map((a) => `st.${a.type}()`)
      const only = acts.length && acts.every((a) => a === 'st.say()') ? `step ${s.k} only calls st.say()` : `step ${s.k} changes nothing that is drawn`
      const p = c.model.params[0]
      c.report({ step: s.k, t: null, line: s.src.line, file: s.src.file ?? undefined, measured: 0, what: `the picture at the end of step ${s.k} is identical to step ${s.k - 1}.`, fix: [`${only}; add the visual: ${p ? `st.set(${p.name}, ${p.max})` : 'st.play(fadeIn(m))'}`, 'st.focus(part) or st.label(part) to point at what the sentence is about'] })
    }
  },
})

// ── DEAD-PARAM ───────────────────────────────────────────────────────────────────────────────────────
defineRule({
  code: 'DEAD-PARAM', phase: 'story',
  run(c: RuleCtx) {
    const steps = c.model.steps
    const times = [0, ...steps.map((s) => Math.max(s.t0, s.t1 - END_EPSILON)), ...steps.map((s) => s.t0 + s.active / 2)]
    const L = (c as CheckCtx).limits
    for (const p of c.model.params) {
      const values: ParamValue[] = p.kind === 'number' ? [p.min, p.max, p.min + (p.max - p.min) * L.deadParamProbe] : p.kind === 'toggle' ? [false, true] : p.options
      if (values.length < 2 || (p.kind === 'number' && p.min === p.max)) continue
      let alive = false
      for (const t of times) {
        // what the viewer sees: visible objects only, to a hundredth of a unit (under a pixel). A probe is not a picture.
        if (new Set(values.map((v) => c.stateAt(t, { [p.name]: v }).signature({ digits: L.deadParamDigits }))).size > 1) { alive = true; break }
      }
      if (alive) continue
      c.report({ step: null, t: null, line: p.src.line, file: p.src.file ?? undefined, what: `moving "${p.name}" from ${String(values[0])} to ${String(values[1])} changes nothing that can be seen: no property of a visible object reads it (a probe, a hidden object or a change far smaller than a pixel does not count).`, fix: [`use it in a property, e.g. part.rotate({ about: 'z', deg: ${p.name} }) or m.at(() => [${p.name}(), 0])`, `or delete s.param('${p.name}', …)`] })
    }
  },
})

// ── NOT-PURE: a dynamic function that answers differently for the same time and params (DESIGN §3.1, D5) ────────────
defineRule({
  code: 'NOT-PURE', phase: 'story',
  run(c) {
    const fix = ['draw random numbers once while the scene is built: const r = s.rng(1), then use the stored numbers', 'use s.t() for time and params for state; a function must not count its own calls']
    for (const s of c.model.steps) {
      const t = Math.max(s.t0, s.t1 - END_EPSILON)
      const a = c.stateAt(t), b = c.stateAt(t)
      for (const n of c.model.nodes) {
        if (!a.visible(n)) continue
        const pa = a.props(n), pb = b.props(n)
        const name = Object.keys(pa).find((k) => stable(pa[k]) !== stable(pb[k])) ?? (stable(a.world(n)) !== stable(b.world(n)) ? 'position' : null)
        if (name === null) continue
        c.report({ ids: [n.id], step: s.k, t: null, line: n.src.line, file: n.src.file ?? undefined, measured: `${stable(name === 'position' ? a.world(n).p : pa[name])} then ${stable(name === 'position' ? b.world(n).p : pb[name])}`, what: `${name} of #${n.id} gave two different values for the same time and params: the function behind it reads Math.random, a clock, or a counter it changes itself. The same time must always give the same picture.`, fix })
      }
      const qa = a.probes(), qb = b.probes()
      for (const name of Object.keys(qa)) {
        if (Object.is(qa[name], qb[name])) continue
        c.report({ ids: [], step: s.k, t: null, measured: `${qa[name]} then ${qb[name]}`, what: `probe "${name}" gave two different values for the same time and params: its function reads Math.random, a clock, or a counter it changes itself.`, fix })
      }
    }
  },
})

export const FRAME = { width: FRAME_W, height: FRAME_H }
