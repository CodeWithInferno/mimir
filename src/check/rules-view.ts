// Rules about the picture at the end of each step: OCCLUDED, LABEL-COVERS, TINY, SUBJECT-FIT, TEXT-TINY,
// CONTRAST-TEXT, COLOR-COUNT. They read pixels (the id pass, measured text boxes, the 3D canvas), so without a
// browser they report nothing: the engine then says that nothing was rendered instead of calling the scene clean.
import {
  defineRule, emOf, isNode, kindOf, luminance, parseColor, spaceOf, Step, toHex, VIEWS,
  type Frame, type IdPassResult, type MNode, type RGBA, type Rect, type Runtime, type ViewOverride,
} from '../core/index.ts'
import { BACKSTROKE_COLOR, K as STROKE_UNITS_PER_UNIT } from '../r2d/index.ts'
import { collect, type CheckCtx, type CheckRule } from './engine.ts'
import { placementRefs, type SolidPart } from './solids.ts'

const rule = (def: CheckRule): void => defineRule(def)
const pct = (x: number): number => Math.round(x * 100)
const area = (r: Rect): number => Math.max(0, r.width) * Math.max(0, r.height)
const meet = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
const hasStepAction = (name: string): boolean => Object.getOwnPropertyNames(Step.prototype).includes(name)
/** px of a 720-line frame → px of the stage being measured */
const px720 = (c: CheckCtx, px: number): number => px * ((c.stage?.height ?? 720) / 720)

interface Target { node: MNode; how: string; line: number | null }
/** What the step points at when it ends: focused, labelled, or named by a span of its narration. */
export function targetsOf(c: CheckCtx, f: Frame): Target[] {
  return f.memo('check.targets', () => {
    const out = new Map<MNode, Target>()
    const add = (node: unknown, how: string, line: number | null): void => { if (isNode(node) && !out.has(node) && f.visible(node)) out.set(node, { node, how, line }) }
    for (const a of f.actions<{ nodes?: unknown[] }>('focus')) if (a.env >= 0.5) for (const n of a.data.nodes ?? []) add(n, 'focused', a.action.src.line)
    for (const a of f.actions<{ node?: unknown }>('label')) if (a.env >= 0.5) add(a.data.node, 'labelled', a.action.src.line)
    for (const n of f.step?.narration ?? []) for (const sp of n.spans) for (const id of sp.targets) add(c.model.byId.get(id), 'pointed at', n.src.line)
    return [...out.values()]
  }, [])
}
/** ids of the 3D things a node draws: itself and everything inside it */
const drawn = (node: MNode): string[] => { const out: string[] = []; const walk = (n: MNode): void => { if (n.space === '3d') out.push(n.id); n.children.forEach(walk) }; walk(node); return out }
const within = (inner: MNode, outer: MNode): boolean => { for (let n: MNode | null = inner; n; n = n.parent) if (n === outer) return true; return false }
/** stage-px box a 3D part would cover if nothing hid it */
const footprint = (c: CheckCtx, f: Frame, node: MNode): Rect | null => { const r = f.frameRect(node); return r && c.runtime ? c.runtime.rectToStage(r) : null }

/** share of a target's own pixels that can be seen, from a solo id pass; null when it draws too little to judge */
function visibility(pass: IdPassResult, ids: string[], minPixels: number): { ratio: number; pixels: number; total: number } | null {
  let pixels = 0, total = 0
  for (const id of ids) { const p = pass.parts[id]; if (!p || p.total === undefined) continue; pixels += Math.min(p.pixels, p.total); total += p.total }
  return total >= minPixels ? { ratio: pixels / total, pixels, total } : null
}

/** volume of a world box, and of what two boxes share (a flat box counts with a sliver of thickness) */
const boxVolume = (b: SolidPart['bounds']): number => [0, 1, 2].reduce((v, k) => v * Math.max(b.max[k]! - b.min[k]!, 1e-9), 1)
const sharedVolume = (a: SolidPart['bounds'], b: SolidPart['bounds']): number => [0, 1, 2].reduce((v, k) => v * Math.max(0, Math.min(a.max[k]!, b.max[k]!) - Math.max(a.min[k]!, b.min[k]!)), 1)
/**
 * The parts a target HOLDS: solids that are not part of it, are smaller than it, and lie inside its box by at least
 * `share` of their own box (a piston in its cylinder, the oil in a tank, a bolt in a plate). A housing is seen around
 * what it holds, so those parts do not hide it. Pure maths on the solids of the state.
 */
export function heldBy(c: CheckCtx, f: Frame, target: MNode, share: number): MNode[] {
  const solids = c.solids(f)
  const own = solids.filter((p) => within(p.node, target))
  if (!own.length) return []
  const box = { min: [0, 1, 2].map((k) => Math.min(...own.map((p) => p.bounds.min[k]!))), max: [0, 1, 2].map((k) => Math.max(...own.map((p) => p.bounds.max[k]!))) } as SolidPart['bounds']
  const whole = boxVolume(box)
  return solids.filter((p) => !within(p.node, target) && !within(target, p.node) && boxVolume(p.bounds) < whole && sharedVolume(p.bounds, box) >= share * boxVolume(p.bounds)).map((p) => p.node)
}

export interface Shown { /** share that counts as seen: (pixels + held) / total */ ratio: number; pixels: number; total: number; /** pixels where a part it holds shows instead */ held: number; /** ids of the parts it holds */ inside: Set<string> }
/**
 * How much of a 3D part can be seen in a solo id pass of the state `f`: the ONE measure, and with the limit
 * `occludedVisible` the one threshold, for OCCLUDED (end of a step) and GUIDE-TARGET (the moment a mark lands).
 * A housing is seen around what it holds: where a part INSIDE the target shows (heldBy), the target is not hidden
 * behind other geometry. Measured, not assumed: only the pixels those parts actually show are counted, so a housing
 * whose contents are covered as well is still hidden. null = it draws too little to judge.
 */
export function shownShare(c: CheckCtx, f: Frame, node: MNode, pass: IdPassResult): Shown | null {
  const L = c.limits
  const v = visibility(pass, drawn(node), L.occludedMinPixels)
  if (!v) return null
  const inside = new Set<string>()
  let held = 0
  if (v.ratio < L.occludedVisible) {
    for (const id of heldBy(c, f, node, L.occludedInside).flatMap(drawn)) inside.add(id)
    for (const id of inside) held += pass.parts[id]?.pixels ?? 0
    held = Math.min(held, v.total - v.pixels)
  }
  return { ratio: (v.pixels + held) / v.total, pixels: v.pixels, total: v.total, held, inside }
}

// ── OCCLUDED ─────────────────────────────────────────────────────────────────────────────────────────
interface Hidden { index: number; id: string; how: string; line: number | null; ratio: number; pixels: number; total: number; /** pixels where a part it holds shows instead: not hidden */ held: number; front: string[]; fix: string[] }
interface OccNotes { hidden: Map<string, Hidden>; ever: Map<string, { seen: boolean; step: number | null }>; trials: number; measured: boolean }
const occNotes = (c: CheckCtx): OccNotes => c.bag<OccNotes>('occluded', () => ({ hidden: new Map(), ever: new Map(), trials: c.limits.viewTrialParts, measured: false }))
// measured at the end of every step, where the picture is; judged by the rule below once every step is known
collect({
  name: 'occlusion', pure: false, for: ['OCCLUDED'], on: ['step-end'],
  run(c) {
    const f = c.frame, rt = c.runtime
    if (!f || !rt || !c.model.has3d) return
    const L = c.limits
    const notes = occNotes(c)
    const targets = targetsOf(c, f).filter((t) => t.node.space === '3d' && f.reveal(t.node).p >= 0.999 && !c.allowed('OCCLUDED', t.node))
    // every part that is on stage is noted, so that one which is never seen at all can be named at the end
    const plain = c.idPass()
    const vp = c.model.viewportRect()
    if (!plain || !vp) return
    notes.measured = true
    const panel = rt.rectToStage(vp)
    for (const n of f.visibleLeaves('3d')) {
      const p = plain.parts[n.id], fp = footprint(c, f, n)
      if (!p || !fp || f.reveal(n).p < 0.999 || f.look(n).shell) continue
      if (meet(fp, panel) < Math.max(L.occludedMinPixels, 0.5 * area(fp))) continue // off the panel or too small: other rules speak
      // covered means: it would draw pixels alone and shows none. A part that draws nothing right now (an effect between
      // its bursts, a flow that is switched off) is not hidden by anything
      if (p.pixels <= 0) { const alone = c.idPass({ solo: true })?.parts[n.id]; if (!((alone?.total ?? alone?.pixels ?? 0) > 0)) continue }
      const e = notes.ever.get(n.id) ?? { seen: false, step: c.sample!.step }
      if (p.pixels > 0) e.seen = true
      notes.ever.set(n.id, e)
    }
    if (!targets.length) return
    const pass = c.idPass({ solo: true })
    if (!pass) return
    for (const t of targets) {
      if (notes.hidden.has(t.node.id)) continue
      const ids = drawn(t.node)
      if (ids.every((id) => f.look(c.model.byId.get(id)!).shell)) continue // a housing is seen through, not hidden
      const v = shownShare(c, f, t.node, pass)
      if (!v) { if (!ids.some((id) => pass.parts[id])) c.unknown('OCCLUDED', [t.node.id], `#${t.node.id} draws nothing the id pass can count, so how much of it is hidden was not measured`); continue }
      if (v.ratio >= L.occludedVisible) continue
      const { ratio, held, inside } = v
      // who is in front: parts that show inside its footprint and are nearer to the camera
      const fp = footprint(c, f, t.node)
      const depth = f.project3(f.anchor(t.node, 'center')).depth
      const inFront = fp ? Object.values(pass.parts).filter((p) => !ids.includes(p.id) && !inside.has(p.id) && p.pixels > 0 && meet(p.rect, fp) > 0).map((p) => ({ p, node: c.model.byId.get(p.id)! })).filter((x) => x.node && !f.look(x.node).shell && f.project3(f.anchor(x.node, 'center')).depth < depth + 1e-6).sort((a, b) => meet(b.p.rect, fp) - meet(a.p.rect, fp)).map((x) => x.p.id) : []
      // declared with part.allow('OCCLUDED', other): it sits partly behind exactly those parts by design; a smaller share must still show
      if (inFront.length && v.ratio >= L.occludedDeclared && inFront.every((id) => c.allowed('OCCLUDED', t.node, c.model.byId.get(id)!))) continue
      const front = inFront.slice(0, 2)
      const fix: string[] = []
      if (front.length) fix.push(hasStepAction('ghost') ? `see through what is in front: st.ghost(${front.join(', ')})` : `make what is in front a housing: ${front.map((id) => `${id}.material('ghost')`).join('; ')}`)
      // a view that shows it, measured (a few parts per run: each trial is a render)
      if (notes.trials > 0) {
        notes.trials--
        const best = bestView(c, rt, ids)
        if (best && best.ratio >= L.occludedVisible) fix.push(`look from where it shows: st.camera({ view: '${best.view}' }) shows ${pct(best.ratio)}% of it`)
      }
      if (hasStepAction('cutaway') && fix.length < 2) fix.push(`cut the model open: st.cutaway({ axis: 'z' })`)
      fix.push(`or do not point at #${t.node.id} in this step`)
      notes.hidden.set(t.node.id, { index: c.index, id: t.node.id, how: t.how, line: t.line ?? t.node.src.line, ratio, pixels: v.pixels, total: v.total, held, front, fix: fix.slice(0, 3) })
    }
  },
})
/** Visibility of a part from the named views, measured: the best one, or null. The view on screen is put back. */
function bestView(c: CheckCtx, rt: Runtime, ids: string[]): { view: string; ratio: number } | null {
  const before: ViewOverride | null = rt.view
  let best: { view: string; ratio: number } | null = null
  try {
    for (const view of ['front', 'side', 'top', 'back', 'left', 'iso', 'bottom'].filter((v) => v in VIEWS).slice(0, c.limits.viewTrials)) {
      rt.setView(view)
      rt.render(true)
      const pass = c.idPass({ solo: true })
      const v = pass ? visibility(pass, ids, c.limits.occludedMinPixels) : null
      if (v && (!best || v.ratio > best.ratio + c.limits.occludedViewGain)) best = { view, ratio: v.ratio }
    }
  } finally { rt.setView(before); rt.render(true) }
  return best
}
rule({
  code: 'OCCLUDED', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    const notes = occNotes(c)
    const L = c.limits
    // a part the step points at, mostly hidden
    for (const h of [...notes.hidden.values()].sort((a, b) => a.index - b.index)) {
      const s = c.samples[h.index]!
      c.report({ ids: [h.id], step: s.step, t: c.where(s).t, line: h.line, measured: pct(h.ratio), limit: pct(L.occludedVisible), what: `${h.pixels === 0 && !h.held ? 'none' : `only ${pct(h.ratio)}%`} of #${h.id} can be seen at the end of step ${s.step} (${h.pixels} of ${h.total} px${h.held ? `, and ${h.held} px more where a part it holds shows` : ''}) while it is ${h.how} there (at least ${pct(L.occludedVisible)}%)${h.front.length ? `: ${h.front.map((id) => `#${id}`).join(' and ')} ${h.front.length === 1 ? 'is' : 'are'} in front of it` : ''}.`, fix: h.fix })
    }
    // a part that no step ever shows
    for (const [id, e] of notes.ever) {
      if (e.seen || notes.hidden.has(id)) continue
      const node = c.model.byId.get(id)
      if (!node || c.allowed('OCCLUDED', node)) continue
      c.report({ severity: 'warn', fold: 'never', ids: [id], step: e.step, t: null, line: node.src.line, measured: 0, limit: 1, what: `#${id} is on stage but not one pixel of it shows at the end of any step: other parts are always in front of it.`, fix: [hasStepAction('ghost') ? 'show it once: st.ghost(…what covers it…), or a cutaway, in the step about it' : `show it once: make what covers it a housing (.material('ghost')), or turn the camera in the step about it`, `or delete #${id} if nothing is said about it`] })
    }
  },
})

// ── TINY ─────────────────────────────────────────────────────────────────────────────────────────────
interface TinyNotes { /** largest size each object ever had at the end of a step, px */ best: Map<MNode, { size: number; step: number | null }>; height: number }
const tinyNotes = (c: CheckCtx): TinyNotes => c.bag<TinyNotes>('tiny', () => ({ best: new Map(), height: 720 }))
/** an object the author made: a root, or something inside plain containers (the parts of a composite are judged with it) */
const authored = (n: MNode): boolean => { for (let p = n.parent; p; p = p.parent) if (!kindOf(p.kind)?.container) return false; return true }
collect({
  name: 'sizes', pure: false, for: ['TINY'], on: ['step-end'],
  run(c) {
    const f = c.frame, st = c.stage
    if (!f || !st) return
    const notes = tinyNotes(c)
    notes.height = st.height
    for (const n of c.model.nodes) {
      if (!f.visible(n) || f.reveal(n).p < 0.999 || kindOf(n.kind)?.container || kindOf(n.kind)?.text || !authored(n)) continue
      if (n.space === '3d' && f.look(n).shell) continue
      const r = n.space === '3d' ? footprint(c, f, n) : c.screenRect(n)
      if (!r) continue
      const size = Math.max(r.width, r.height)
      const had = notes.best.get(n)
      if (!had || size > had.size) notes.best.set(n, { size, step: had?.step ?? c.sample!.step })
    }
  },
})
rule({
  code: 'TINY', phase: 'story', severity: 'warn',
  run(c0) {
    const c = c0 as CheckCtx
    const notes = tinyNotes(c)
    const L = c.limits
    const H = notes.height
    const least = L.tinyPixels * (H / 720)
    // 1. an object that is never large enough to make out, in any step (one that shrinks to nothing on purpose is not this)
    for (const [node, e] of notes.best) {
      if (e.size >= least || c.allowed('TINY', node)) continue
      c.report({ fold: 'small', ids: [node.id], step: e.step, t: null, line: node.src.line, measured: Math.round(e.size * 10) / 10, limit: Math.round(least), what: `#${node.id} is never more than ${Math.round(e.size * 10) / 10} px across (under ${Math.round(least)} px on a ${H} px frame it cannot be made out).`, fix: [node.space === '3d' ? `frame what matters: st.camera({ fit: [${node.id}] })` : `make it larger: ${node.id}.scale(${Math.ceil((least * 2) / Math.max(e.size, 0.5))})`, `or delete #${node.id} if it carries no meaning`] })
    }
    // 2. what a step points at must be large enough to matter at some moment of that step (pure maths: its box on screen)
    if (!c.runtime) return
    const scale = c.runtime.stage().scale
    const done = new Set<MNode>()
    for (const s of c.samples) {
      if (s.kind !== 'step-end' || s.step === null) continue
      const step = c.model.steps[s.step - 1]!
      const end = c.stateAt(s.tau)
      for (const t of targetsOf(c, end)) {
        const node = t.node
        // a point marker (a kind that says `marker: true`: a dot on a curve) is small by nature: the mark the guide draws
        // on it is what the viewer finds. It is still held to the first limit (it must be large enough to see at all)
        if (done.has(node) || kindOf(node.kind)?.text || kindOf(node.kind)?.marker === true || c.allowed('TINY', node) || (notes.best.get(node)?.size ?? Infinity) < least) continue
        let size = 0
        const moments = Math.max(2, Math.round(L.tinyMoments))
        for (const u of Array.from({ length: moments }, (_, i) => i / (moments - 1))) { const f = c.stateAt(Math.min(s.tau, step.t0 + step.active * u)); const r = f.visible(node) ? f.frameRect(node) : null; if (r) size = Math.max(size, Math.max(r.width, r.height) * scale) }
        if (!size || size >= L.tinyFocused * H) continue
        done.add(node)
        c.report({ fold: 'focused', ids: [node.id], step: s.step, t: null, line: t.line ?? node.src.line, measured: Math.round(size), limit: Math.round(L.tinyFocused * H), what: `#${node.id} is ${t.how} in step ${s.step} but never more than ${Math.round(size)} px across there (${pct(size / H)}% of the frame height; what a step is about should reach ${pct(L.tinyFocused)}%).`, fix: [node.space === '3d' ? `move in on it: st.camera({ fit: [${node.id}] })` : `move in on it: st.zoom(${node.id})`, `or make #${node.id} larger`] })
      }
    }
  },
})

// ── SUBJECT-FIT ──────────────────────────────────────────────────────────────────────────────────────
rule({
  code: 'SUBJECT-FIT', phase: 'sample', on: ['step-end'], severity: 'warn',
  run(c0) {
    const c = c0 as CheckCtx
    const f = c.frame, rt = c.runtime, vp = c.model.viewportRect()
    if (!f || !rt || !vp) return
    const pass = c.idPass()
    if (!pass) return
    const panel = rt.rectToStage(vp)
    const shown = Object.values(pass.parts).filter((p) => p.pixels > 0)
    if (!shown.length) return
    const x0 = Math.min(...shown.map((p) => p.rect.x)), y0 = Math.min(...shown.map((p) => p.rect.y))
    const x1 = Math.max(...shown.map((p) => p.rect.x + p.rect.width)), y1 = Math.max(...shown.map((p) => p.rect.y + p.rect.height))
    const fill = Math.max((x1 - x0) / panel.width, (y1 - y0) / panel.height)
    const own = c.model.cameraClips().some((clip) => clip.step === f.k)
    if (fill < c.limits.subjectFill) {
      c.report({ ids: [], line: f.step?.src.line ?? null, measured: pct(fill), limit: pct(c.limits.subjectFill), what: `everything drawn in the 3D panel fits in ${pct(fill)}% of its ${x1 - x0 >= y1 - y0 ? 'width' : 'height'} (${Math.round(x1 - x0)} x ${Math.round(y1 - y0)} px of ${Math.round(panel.width)} x ${Math.round(panel.height)}): the camera is about ${(c.limits.subjectFill * 1.8 / Math.max(fill, 0.01)).toFixed(1)}x too far.`, fix: [own ? `remove distance / zoom from the st.camera() call of step ${f.k + 1} (the camera frames the model on its own)` : `frame what this step shows: st.camera({ fit: [${shown.slice(0, 3).map((p) => p.id).join(', ')}] })`, 'st.camera({ fit: true })'] })
      return
    }
    const big = shown.filter((p) => !f.look(c.model.byId.get(p.id)!)?.shell).reduce<(typeof shown)[number] | null>((a, b) => (!a || b.pixels > a.pixels ? b : a), null)
    if (big && big.pixels / (panel.width * panel.height) > c.limits.subjectMax) c.report({ ids: [big.id], line: c.model.byId.get(big.id)?.src.line ?? null, measured: pct(big.pixels / (panel.width * panel.height)), limit: pct(c.limits.subjectMax), what: `#${big.id} alone covers ${pct(big.pixels / (panel.width * panel.height))}% of the 3D panel: the camera is too close to show anything else.`, fix: [own ? `remove distance / zoom from the st.camera() call of step ${f.k + 1}` : 'st.camera({ fit: true })'] })
  },
})

// ── LABEL-COVERS ─────────────────────────────────────────────────────────────────────────────────────
rule({
  code: 'LABEL-COVERS', phase: 'sample', on: ['step-end'], severity: 'warn',
  run(c0) {
    const c = c0 as CheckCtx
    const f = c.frame
    if (!f || !c.stage) return
    const targets = targetsOf(c, f)
    if (!targets.length) return
    const pass = c.model.has3d ? c.idPass() : null
    for (const t of targets) {
      // the box of what can be seen of the target
      let box: Rect | null = null
      /** 3D: the points of a grid over its box where the part itself is what shows (a thin diagonal rod fills little of its box) */
      let shows: { x: number; y: number }[] | null = null
      if (t.node.space === '3d') {
        const ids = drawn(t.node)
        const parts = ids.map((id) => pass?.parts[id]).filter((p): p is NonNullable<typeof p> => !!p && p.pixels > 0)
        if (!parts.length) continue
        const x0 = Math.min(...parts.map((p) => p.rect.x)), y0 = Math.min(...parts.map((p) => p.rect.y))
        box = { x: x0, y: y0, width: Math.max(...parts.map((p) => p.rect.x + p.rect.width)) - x0, height: Math.max(...parts.map((p) => p.rect.y + p.rect.height)) - y0 }
        const pick = c.runtime?.renderers.get('3d')?.pick
        if (!pick) { c.unknown('LABEL-COVERS', [t.node.id], `the 3D renderer cannot say which part shows at a point, so how much of #${t.node.id} a text covers was not measured`); continue }
        shows = []
        const N = Math.max(2, Math.round(c.limits.coverGrid))
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
          const x = box.x + ((i + 0.5) / N) * box.width, y = box.y + ((j + 0.5) / N) * box.height
          const hit = c.runtime!.renderers.get('3d')!.pick!(x, y)
          if (hit && ids.includes(hit.id)) shows.push({ x, y })
        }
        if (shows.length < 6) continue // too little of it shows to say what a text hides: OCCLUDED and TINY speak about that
      } else if (!kindOf(t.node.kind)?.text) box = c.screenRect(t.node)
      if (!box || area(box) < 16) continue
      for (const text of c.textBoxes()) {
        const owners = text.ids.map((id) => c.model.byId.get(id)).filter(isNode)
        // its own label, a text that is placed on it (a caption of the shape), or a text inside it
        if (owners.some((o) => within(o, t.node) || within(t.node, o) || placementRefs(o, f).some((r) => within(t.node, r) || within(r, t.node)))) continue
        const r = text.rect
        const share = shows ? shows.filter((p) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height).length / shows.length : meet(r, box) / area(box)
        if (pct(share) <= pct(c.limits.labelCovers)) continue
        c.report({ fold: 'covers', ids: [t.node.id, ...text.ids], line: text.line ?? t.line, measured: pct(share), limit: pct(c.limits.labelCovers), what: `${text.name} hides ${pct(share)}% of #${t.node.id}, which is ${t.how} in this step (at most ${pct(c.limits.labelCovers)}%).`, fix: text.fix ?? (owners[0] && text.from === 'node' ? [`move the text off it: ${owners[0].id}.nextTo(${t.node.id}, 'up')`] : ['shorten the text, or label fewer parts in this step', `or move #${t.node.id} away from where the text sits`]) })
      }
    }
  },
})

// ── TEXT-TINY and CONTRAST-TEXT ──────────────────────────────────────────────────────────────────────
/** font size of a text node on screen, in stage px: its `size` option through its scale and the 2D camera */
function fontPx(c: CheckCtx, f: Frame, n: MNode): number | null {
  const st = c.stage
  if (!st) return null
  const size = f.prop<unknown>(n, 'size')
  const zoom = spaceOf(n) === '2d' ? f.camera2d().zoom : 1
  if (typeof size === 'number' && size > 0) return emOf(size) * f.world(n).s * zoom * st.scale
  // a text kind without a size option: the height of its box per line
  const r = f.frameRect(n)
  const lines = String(f.prop(n, 'text') ?? '').split('\n').length
  return r ? (r.height / lines / 0.9) * st.scale : null
}
rule({
  code: 'TEXT-TINY', phase: 'sample', on: ['step-end'],
  run(c0) {
    const c = c0 as CheckCtx
    const f = c.frame, st = c.stage
    if (!f || !st) return
    const least = c.limits.textTiny * st.height
    for (const n of f.visibleLeaves('2d')) {
      if (!kindOf(n.kind)?.text || f.reveal(n).p < 0.999 || c.allowed('TEXT-TINY', n)) continue
      const px = fontPx(c, f, n)
      if (px === null || px >= least - 0.05) continue
      const scale = f.world(n).s, zoom = spaceOf(n) === '2d' ? f.camera2d().zoom : 1
      const why = zoom < 0.99 ? ` because the 2D camera is zoomed out ${(1 / zoom).toFixed(1)}x` : scale < 0.99 ? ` because it is scaled to ${Math.round(scale * 100)}%` : ''
      const need = Math.ceil((least / px) * 10) / 10
      c.report({ fold: 'text', ids: [n.id], line: n.src.line, measured: Math.round(px * 10) / 10, limit: Math.round(least), what: `text "${String(f.prop(n, 'text')).slice(0, 24)}" is ${Math.round(px * 10) / 10} px tall${why} (minimum ${Math.round(least)} px on a ${st.height} px frame: 2% of its height).`, fix: [zoom < 0.99 ? `keep it out of the zoom: ${n.id}.hud()` : scale < 0.99 ? `remove the .scale() of #${n.id}, or of the group it is in` : "use a named size: size: 'note'", `or make it ${need}x larger: size: ${Math.ceil(Number(f.prop(n, 'size') ?? 16) * need)}`] })
    }
    // text drawn by kinds and overlays: only the box is known, and a box shorter than the limit holds text that is smaller still
    for (const t of c.textBoxes()) {
      if (t.from === 'node' || t.rect.height >= least * 0.9 || !t.text.trim()) continue
      const owner = t.ids.map((id) => c.model.byId.get(id)).find(isNode)
      c.report({ fold: 'box', ids: t.ids, line: t.line, measured: Math.round(t.rect.height * 10) / 10, limit: Math.round(least), what: `${t.name} is drawn ${Math.round(t.rect.height * 10) / 10} px tall (minimum ${Math.round(least)} px on a ${st.height} px frame).`, fix: [owner ? `make #${owner.id} larger, or zoom in on it: st.zoom(${owner.id})` : 'show fewer of them at once'] })
    }
  },
})

const over = (top: RGBA, alpha: number, under: RGBA): RGBA => { const a = Math.min(1, Math.max(0, alpha * top[3])); return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1] }
const ratio = (a: RGBA, b: RGBA): number => { const la = luminance(toHex(a)), lb = luminance(toHex(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
const BLACK: RGBA = [0, 0, 0, 1]
/** The picture of the 3D panel as it was just drawn, readable: stage px → colour. null when it cannot be read. */
function panelPixels(c: CheckCtx, f: Frame): ((r: Rect) => RGBA | null) | null {
  return f.memo('check.panel', () => {
    const rt = c.runtime
    if (!rt || !c.model.has3d || typeof document === 'undefined') return null
    const gl = [...rt.stageEl.children].find((el) => el.tagName === 'CANVAS') as HTMLCanvasElement | undefined
    if (!gl) return null
    try {
      rt.render(true) // the drawing buffer is only readable in the task it was drawn in
      const copy = document.createElement('canvas')
      copy.width = rt.width
      copy.height = rt.height
      const g = copy.getContext('2d', { willReadFrequently: true })
      if (!g) return null
      const box = gl.getBoundingClientRect(), stage = rt.stageEl.getBoundingClientRect()
      g.drawImage(gl, box.left - stage.left, box.top - stage.top, box.width, box.height)
      return (r: Rect): RGBA | null => {
        const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y)), w = Math.min(copy.width - x, Math.ceil(r.width)), h = Math.min(copy.height - y, Math.ceil(r.height))
        if (w <= 0 || h <= 0) return null
        const d = g.getImageData(x, y, w, h).data
        // the median pixel by luminance (WCAG: what is behind the text, not its brightest or darkest speck)
        const px: [number, number][] = []
        for (let i = 0; i < d.length; i += 4) px.push([0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!, i])
        px.sort((a, b) => a[0] - b[0])
        const i = px[Math.floor(px.length / 2)]![1]
        const a = d[i + 3]! / 255
        return [(d[i]! / 255) * a, (d[i + 1]! / 255) * a, (d[i + 2]! / 255) * a, 1]
      }
    } catch { return null }
  }, null)
}
/**
 * The outline a text draws round its glyphs (the `backstroke` option of text), as it is on screen: its colour and how
 * far it reaches beyond a glyph, in stage px (half of the stroke lies under the glyph). null when the text has none.
 * The 2D backend draws no outline behind ink that is nearly black; such ink against the black outline is under 3 : 1
 * anyway, so the answer of the rule is the same at the WCAG limits.
 */
function outlineOf(c: CheckCtx, f: Frame, n: MNode): { color: RGBA; px: number } | null {
  const width = f.prop<unknown>(n, 'backstroke')
  const color = parseColor(BACKSTROKE_COLOR)
  if (typeof width !== 'number' || !(width > 0) || !color || !c.stage) return null
  return { color, px: ((width / STROKE_UNITS_PER_UNIT) * c.stage.scale) / 2 }
}
rule({
  code: 'CONTRAST-TEXT', phase: 'sample', on: ['step-end'],
  run(c0) {
    const c = c0 as CheckCtx
    const f = c.frame, st = c.stage, rt = c.runtime
    if (!f || !st || !rt) return
    const L = c.limits
    const order = new Map(c.model.nodes.map((n, i) => [n, i]))
    const below = (a: MNode, b: MNode): boolean => f.z(a) < f.z(b) || (f.z(a) === f.z(b) && order.get(a)! < order.get(b)!)
    const panel = c.model.viewportRect() ? rt.rectToStage(c.model.viewportRect()!) : null
    for (const n of f.visibleLeaves('2d')) {
      if (!kindOf(n.kind)?.text || f.reveal(n).p < 0.999 || f.dim(n) > 0.01 || c.allowed('CONTRAST-TEXT', n)) continue
      const ink = parseColor(f.prop(n, 'color'))
      const box = c.screenRect(n)
      if (!ink || !box || area(box) < 4 || !String(f.prop(n, 'text') ?? '').trim()) continue
      // what is behind it, back to front: black, the 3D picture, then filled 2D shapes drawn before it
      let behind: RGBA = BLACK
      let on = 'the black background'
      if (panel && meet(box, panel) > L.behindShare * area(box)) {
        const read = panelPixels(c, f)
        const got = read ? read(box) : null
        if (!got) { c.unknown('CONTRAST-TEXT', [n.id], `the 3D picture behind ${n.id} could not be read back, so its contrast was not measured`); continue }
        behind = got
        if (luminance(toHex(got)) > 0.01) on = 'the 3D model behind it'
      }
      for (const m of f.visibleLeaves('2d')) {
        if (m === n || kindOf(m.kind)?.text || !below(m, n)) continue
        const fill = parseColor(f.prop(m, 'fill'))
        if (!fill) continue
        const r = c.screenRect(m)
        if (!r || meet(r, box) < L.behindShare * area(box)) continue
        const a = (Number(f.prop(m, 'fillOpacity') ?? 1) || 0) * f.opacity(m) * f.reveal(m).p
        if (a <= 0.02) continue
        behind = over(fill, a, behind)
        on = `#${m.id}`
      }
      const shown = over(ink, f.opacity(n), behind)
      let got = ratio(shown, behind)
      // an outline round the glyphs is what the ink is read against, whatever lies behind: white text with its black
      // outline reads on a yellow box. It counts when it is wide enough to see, and it fades with the text
      const outline = outlineOf(c, f, n)
      if (outline && outline.px >= px720(c, L.contrastOutlinePx)) {
        const edge = ratio(shown, over(outline.color, f.opacity(n), behind))
        if (edge > got) { got = edge; on = `its own outline (and ${on} behind it)` }
      }
      const px = fontPx(c, f, n) ?? 0
      const need = px >= px720(c, L.largeTextPx) ? L.contrastLarge : L.contrastSmall
      if (got >= need) continue
      const white = ratio([1, 1, 1, 1], behind), black = ratio(BLACK, behind)
      const better = white >= black ? ['WHITE', white] as const : ['BLACK', black] as const
      c.report({ ids: [n.id], line: n.src.line, measured: Math.round(got * 10) / 10, limit: need, what: `text "${String(f.prop(n, 'text')).slice(0, 24)}" has a contrast of ${got.toFixed(1)}:1 against ${on} (${toHex(behind)}); text this size needs ${need}:1.`, fix: [better[1] >= need ? `${n.id}.color(${better[0]}) gives ${better[1].toFixed(1)}:1` : `move it off ${on}: no single colour reads on ${toHex(behind)}`, on.startsWith('#') ? `or put it beside ${on}: ${n.id}.nextTo(${on.slice(1)}, 'up')` : outline ? `or give it a wider outline: backstroke: ${Math.ceil((Number(f.prop(n, 'backstroke')) || 1) * 2)}` : f.opacity(n) < 1 ? `or raise its opacity (it is ${f.opacity(n).toFixed(2)})` : `or use a lighter shade of the same hue (the _A and _B palette tokens)`] })
    }
  },
})

// ── COLOR-COUNT ──────────────────────────────────────────────────────────────────────────────────────
const hueOf = (c: RGBA): number | null => {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn
  if (d === 0) return null
  const h = mx === c[0] ? ((c[1] - c[2]) / d) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4
  return (h * 60 + 360) % 360
}
const HUE_NAMES: [number, string][] = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [150, 'green'], [180, 'teal'], [255, 'blue'], [290, 'purple'], [335, 'pink'], [360, 'red']]
const hueName = (h: number): string => HUE_NAMES.find(([limit]) => h <= limit)![1]
defineRule({
  code: 'COLOR-COUNT', phase: 'sample', on: ['step-end'], severity: 'warn', pure: true,
  run(c0) {
    const c = c0 as CheckCtx
    const f = c.frame
    if (!f) return
    const L = c.limits
    const hues: { h: number; id: string }[] = []
    for (const n of f.visibleLeaves()) {
      if (f.dim(n) > 0.5 || f.opacity(n) * f.reveal(n).p < 0.5) continue
      const colours: unknown[] = n.space === '3d' ? (f.look(n).shell ? [] : [f.look(n).color]) : [f.prop(n, 'color'), Number(f.prop(n, 'fillOpacity') ?? 1) > 0.05 ? f.prop(n, 'fill') : null, f.prop(n, 'stroke')]
      for (const col of colours) {
        const rgb = parseColor(col)
        if (!rgb || rgb[3] < 0.5 || Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) < L.hueChroma) continue
        const h = hueOf(rgb)
        if (h !== null) hues.push({ h, id: n.id })
      }
    }
    if (hues.length <= L.hueCount) return
    // hues that are neighbours on the wheel are one colour to the eye: start a new group at every gap wider than hueMerge
    hues.sort((a, b) => a.h - b.h)
    const gaps = hues.map((x, i) => (hues[(i + 1) % hues.length]!.h - x.h + 360) % 360)
    const start = gaps.indexOf(Math.max(...gaps))
    const ring = [...hues.slice(start + 1), ...hues.slice(0, start + 1)]
    const groups: { h: number; id: string }[][] = []
    ring.forEach((x, i) => { const prev = ring[i - 1]; if (i === 0 || (x.h - prev!.h + 360) % 360 > L.hueMerge) groups.push([x]); else groups[groups.length - 1]!.push(x) })
    if (groups.length <= L.hueCount) return
    const named = groups.map((g) => `${hueName(g[Math.floor(g.length / 2)]!.h)} (${[...new Set(g.map((x) => `#${x.id}`))].slice(0, 2).join(', ')}${new Set(g.map((x) => x.id)).size > 2 ? ', …' : ''})`)
    const least = groups.reduce((a, b) => (new Set(b.map((x) => x.id)).size < new Set(a.map((x) => x.id)).size ? b : a))
    c.report({ ids: [...new Set(least.map((x) => x.id))], line: c.model.byId.get(least[0]!.id)?.src.line ?? null, measured: groups.length, limit: L.hueCount, what: `${groups.length} different hues are on screen at once (a viewer tracks about ${L.hueCount}): ${named.join(', ')}.`, fix: [`give colour one meaning each: draw #${least[0]!.id} in grey (GREY_B) or in the hue of what it belongs to`, 'or push back what this step is not about: st.focus(…the parts it is about…)'] })
  },
} as CheckRule)
