// transform, derive, fadeTransform and flashAround: the verbs that need something drawn that is not one of the
// scene's own objects. A path morph is drawn by a stand-in object (kind `animMorph`) that exists only for the length
// of the move; its drawing side (outlines, hulls, the morph plan) lives in the lazy chunk. What cannot be morphed
// (text, groups, composites, a 3D part as the source) is carried: box to box, cross-fading (manim's FadeTransform).
import {
  constructorOf, defineKind, definePlacement, defineVerb, isAnchorRef, kindOf, lerp3, PACE, smooth, toVec3, verbTarget,
  type Anim, type Box3, type Frame, type Handle, type MNode, type Placed, type RateFn, type Resolved, type Step,
} from '../core/index.ts'
import { atRest, carryTo, isNode, isWorldGeometry, leaves, make, no, options, VERB_DEFAULTS, windows, wrong, type Carry } from './shared.ts'

// ── stand-in kinds (pure side) ───────────────────────────────────────────────────────────────────────
/** The box of a morph end in the stand-in's own space: an object (wherever it lives) or a point. */
function endBox(node: MNode, raw: unknown, resolved: unknown, frame: Frame): Box3 {
  if (isNode(raw)) return frame.boxIn(node, raw)
  const p = toVec3(resolved) ?? [0, 0, 0]
  return { min: [p[0], p[1], 0], max: [p[0], p[1], 0] }
}
/**
 * The shape between two shapes. `from` / `to` are objects (a 3D part counts with its outline on screen) or points;
 * `progress` runs 0 → 1. Listing them as points lets the core see what the stand-in refers to: a morph that starts
 * on a 3D part or a screen object lives on the screen.
 */
const morphShape = defineKind({
  name: 'animMorph', space: '2d', worldGeometry: true, chunk: 'anim',
  schema: {
    from: { type: 'point', example: 'from: circle' }, to: { type: 'point', example: 'to: square' },
    progress: { type: 'unit', default: 0 },
    /** degrees: every point travels along an arc of this angle (manim's path_arc) */
    pathArc: { type: 'number', default: 0 },
    /** share of the progress over which the stand-in appears (a copy lifting off its source) */
    appear: { type: 'unit', default: 0 },
  },
  // every point of the morph lies between where it starts and where it ends, so the box does too
  bounds(node, r: Resolved, frame) {
    const a = endBox(node, node.props.from, r.from, frame), b = endBox(node, node.props.to, r.to, frame)
    return { min: lerp3(a.min, b.min, r.progress), max: lerp3(a.max, b.max, r.progress) }
  },
})
/** The pulse of flashAround: a stroke that swells and thins as it runs once round the box of `target`. */
const flashRing = defineKind({
  name: 'animFlash', space: '2d', worldGeometry: true, chunk: 'anim',
  schema: {
    target: { type: 'point', example: 'target: box' },
    progress: { type: 'unit', default: 0 },
    color: { type: 'color', default: VERB_DEFAULTS.flashColor },
    strokeWidth: { type: 'nonneg', default: VERB_DEFAULTS.flashStroke },
    buff: { type: 'nonneg', default: VERB_DEFAULTS.flashBuff },
    timeWidth: { type: 'positive', default: VERB_DEFAULTS.flashTimeWidth },
  },
  bounds(node, r: Resolved, frame) {
    const b = endBox(node, node.props.target, r.target, frame), g = r.buff + r.strokeWidth / 200
    return { min: [b.min[0] - g, b.min[1] - g, 0], max: [b.max[0] + g, b.max[1] + g, 0] }
  },
})
/** A stand-in is not there until its verb is played, whenever the verb was called. */
const hidden = (node: Handle): Handle => { node.props.present = 0; return node }

// ── copies ───────────────────────────────────────────────────────────────────────────────────────────
/** Where a copy sits: exactly on its original, wherever that is (the core sees `target`: a copy of a screen object is on the screen). */
definePlacement('animCopy', (_node, pl, frame): Placed => {
  const w = frame.world(pl.target as MNode)
  return { p: w.p, q: w.q, world: true }
})
const CHANNELS = ['opacity', 'z', 'dim'] as const
/**
 * A copy of a flat object for derive(): the same kind with the same options (functions stay live), sitting on the
 * original. Returns null for what cannot be copied (a 3D part, an unknown kind).
 */
export function copyOf(node: MNode, nested = false): Handle | null {
  const kind = kindOf(node.kind), ctor = constructorOf(node.kind)
  if (!kind || !ctor || node.space !== '2d' || kind.inert) return null
  const given: Record<string, unknown> = {}
  for (const name of Object.keys(kind.schema)) if (name !== 'id' && name !== 'children' && node.props[name] !== undefined) given[name] = node.props[name]
  if (kind.container) given.children = node.children.map((c) => copyOf(c, true)).filter((c): c is Handle => c !== null)
  const copy = ctor(given)
  for (const ch of CHANNELS) if (node.props[ch] !== undefined) copy.props[ch] = node.props[ch]
  if (isWorldGeometry(node)) { if (node.props.shift !== undefined) copy.props.shift = node.props.shift }
  else if (nested) {
    // a member of a copied group keeps its place inside the group (a row or column lays its members out itself)
    if (!copy.placement && node.placement?.type !== 'flow') copy.placement = node.placement
    for (const ch of ['scale', 'rotate', 'shift']) if (node.props[ch] !== undefined) copy.props[ch] = node.props[ch]
  } else {
    // on the original: same place and turn (the placement), same size (scale); the placement's turn is the whole turn
    copy.placement = { type: 'animCopy', target: node }
    copy.props.scale = () => node.model.now().world(node).s
  }
  if (node.isHud) copy.isHud = true
  return nested ? copy : hidden(copy)
}

// ── carrying (box to box, cross-fading) ──────────────────────────────────────────────────────────────
type Other = MNode | ((f: Frame) => Box3)
const NEUTRAL: Carry = { offset: [0, 0, 0], scale: 1 }
/** node leaves towards the box of `other`: clips on its offset and size over [at, at + d] */
function carryOut(rec: Step, node: MNode, other: Other, at: number, d: number, rate: RateFn | undefined): void {
  if (node.space !== '2d') return
  const t = (frame: Frame): Carry => (atRest() ? NEUTRAL : carryTo(frame, node, other))
  rec.clip(node, 'offset', (_: MNode, frame: Frame) => t(frame).offset, { at, duration: d, rate })
  if (!isWorldGeometry(node)) rec.clip(node, 'enterScale', (_: MNode, frame: Frame) => t(frame).scale, { at, duration: d, rate })
}
/** node arrives from the box of `other` (`start` = the size it starts at when `other` is a point) */
function carryIn(rec: Step, node: MNode, other: Other, at: number, d: number, rate: RateFn | undefined, start?: number): void {
  if (node.space !== '2d') return
  const t1 = rec.rec.t0 + at + d
  const t = (frame: Frame): Carry => (atRest() || frame.tau >= t1 ? NEUTRAL : carryTo(frame, node, other, start))
  rec.clip(node, 'offset', [0, 0, 0], { at, duration: d, rate, from: (_: MNode, frame: Frame) => t(frame).offset })
  if (!isWorldGeometry(node)) rec.clip(node, 'enterScale', 1, { at, duration: d, rate, from: (_: MNode, frame: Frame) => t(frame).scale })
}
/** Make sure everything above `node` (up to and including `top`) is on stage at `at`: a group that was faded out comes back with its member. */
function unhide(rec: Step, node: MNode, top: MNode, at: number): void {
  for (let p = node.parent; p; p = p.parent) {
    if (p.model.latest(p, 'present') === 0 && p.model.clipsFor(p, 'present')) rec.clip(p, 'present', 1, { at, duration: 0 })
    if (p === top) break
  }
}
const fadeInClips = (rec: Step, node: MNode, at: number, d: number, rate: RateFn | undefined): void => {
  rec.clip(node, 'revealMode', 'fade', { at, duration: 0 })
  rec.clip(node, 'present', 1, { at, duration: d, rate })
}
const fadeOutClips = (rec: Step, node: MNode, at: number, d: number, rate: RateFn | undefined): void => {
  rec.clip(node, 'revealMode', 'fade', { at, duration: 0 })
  rec.clip(node, 'present', 0, { at, duration: d, rate })
}
/** present of a copy that lifts off its original: it appears over the first part of the move and is gone at the end */
const lift = (rate: RateFn): RateFn => (t) => smooth(Math.min(1, t / VERB_DEFAULTS.deriveAppear)) * (1 - rate(t))

// ── what can be morphed ──────────────────────────────────────────────────────────────────────────────
/** A flat object that is drawn as its outline and nothing else: a shape, a line, a path. Text and composites are carried instead. */
const morphable = (node: MNode): boolean => {
  const kind = kindOf(node.kind)
  return node.space === '2d' && !!kind?.outline && !kind.text && !kind.container && !kind.inert && node.children.length === 0
}
type Source = { node: MNode } | { point: unknown }
const isPointLike = (v: unknown): boolean => isAnchorRef(v) || typeof v === 'function' || !!toVec3(v)?.every(Number.isFinite)
const pointBox = (point: unknown, owner: MNode) => (f: Frame): Box3 => { const p = f.point(point, owner); return { min: [p[0], p[1], p[2]], max: [p[0], p[1], p[2]] } }

interface Pair { from: Source; to: MNode; /** how the pair is played */ how: 'morph' | 'carry'; ghost: Handle | null; copy: Handle | null }
/** Pair up the pieces of `a` and `b` and build what each pair needs (a stand-in, or a copy for derive). */
function pairs(a: Source, b: MNode, copy: boolean, pathArc: number): Pair[] {
  const out: Pair[] = []
  const targets = leaves(b)
  const add = (from: Source, to: MNode): void => {
    const flat = 'node' in from && from.node.space === '2d'
    const how = morphable(to) && (!flat || morphable((from as { node: MNode }).node)) ? 'morph' : 'carry'
    if (how === 'morph') {
      // a copy that lifts off something on screen appears over the first part of the move; a shape that turns into another is there at once
      const ghost = hidden(morphShape({ from: 'node' in from ? from.node : from.point, to, pathArc, appear: copy ? VERB_DEFAULTS.deriveAppear : 0 }))
      out.push({ from, to, how, ghost, copy: null })
    } else out.push({ from, to, how, ghost: null, copy: copy && flat ? copyOf((from as { node: MNode }).node) : null })
  }
  if ('node' in a && a.node.space === '2d') {
    const sources = leaves(a.node)
    // piece by piece when both have the same number of pieces, otherwise the two wholes
    if (sources.length === targets.length && sources.length > 0) sources.forEach((s, i) => add({ node: s }, targets[i]!))
    else add(a, b)
  } else if (targets.length) for (const t of targets) add(a, t)
  else add(a, b)
  return out
}
/** Record one pair over [at, at + d]. `replace` = the source leaves (transform); otherwise it stays (derive). */
function playPair(rec: Step, p: Pair, top: MNode, replace: boolean, at: number, d: number, rate: RateFn | undefined): void {
  const src = 'node' in p.from ? p.from.node : null
  unhide(rec, p.to, top, at)
  if (p.how === 'morph' && p.ghost) {
    rec.clip(p.ghost, 'present', 1, { at, duration: 0 })
    rec.clip(p.ghost, 'progress', 1, { at, duration: d, rate, from: 0 })
    rec.clip(p.ghost, 'present', 0, { at: at + d, duration: 0 })
    if (replace && src) rec.clip(src, 'present', 0, { at, duration: 0 })
    // the target takes over from the stand-in in the same instant, already the shape the stand-in has reached
    rec.clip(p.to, 'revealMode', 'fade', { at: at + d, duration: 0 })
    rec.clip(p.to, 'present', 1, { at: at + d, duration: 0 })
    if (p.to.model.clipsFor(p.to, 'offset')) rec.clip(p.to, 'offset', [0, 0, 0], { at: at + d, duration: 0 })
    if (p.to.model.clipsFor(p.to, 'enterScale')) rec.clip(p.to, 'enterScale', 1, { at: at + d, duration: 0 })
    return
  }
  const other: Other = src ?? pointBox((p.from as { point: unknown }).point, p.to)
  if (src && src.space === '2d') {
    const mover = replace ? src : p.copy
    if (mover) {
      if (replace) fadeOutClips(rec, mover, at, d, rate)
      else rec.clip(mover, 'present', 1, { at, duration: d, rate: lift(rate ?? smooth), from: 0 })
      carryOut(rec, mover, p.to, at, d, rate)
    }
  } else if (src && replace) fadeOutClips(rec, src, at, d, rate)
  fadeInClips(rec, p.to, at, d, rate)
  carryIn(rec, p.to, other, at, d, rate, src ? undefined : VERB_DEFAULTS.growStart)
}

const MORPH = { pathArc: { type: 'number', dynamic: false, example: 'pathArc: 45' } } as const
function morphVerb(verb: 'transform' | 'derive', a: unknown, b: unknown, opts: unknown): Anim {
  const call = `${verb}()`
  const replace = verb === 'transform'
  const to = verbTarget(b, call)
  let from: Source | null = null
  if (isNode(a) || typeof a === 'string' || a === undefined || a === null || replace) { const n = verbTarget(a, call); if (n) from = { node: n } }
  else if (isPointLike(a)) from = { point: a }
  else wrong(null, call, `the source must be an object, an anchor or a point, got ${typeof a}.`, ['derive(circle, curve)', "derive(part.anchor('top'), label)"])
  if (!to || !from) return no(verb, PACE.transform)
  const model = to.model
  const o = options(call, opts, MORPH, model, [to.id])
  const src = 'node' in from ? from.node : null
  if (src === to) { wrong(to, call, `#${to.id} cannot turn into itself.`, ['pass two different objects', `to change one object in place: ${to.id}.to.set({ … })`]); return no(verb, PACE.transform) }
  if (to.space === '3d') {
    wrong(to, call, `#${to.id} is a 3D part; a shape can only turn into a flat object. It fades in instead.`, [`fadeTransform(${src ? src.id : 'a'}, ${to.id})`, `fadeIn(${to.id})`])
    return make(verb, o, PACE.transform, (rec, at, d, rate) => { if (replace && src) fadeOutClips(rec, src, at, d, rate); fadeInClips(rec, to, at, d, rate) })
  }
  if (replace && src && src.space === '3d') wrong(src, call, `#${src.id} is a 3D part: it cannot be reshaped into #${to.id}. It fades out while #${to.id} arrives from it.`, [`derive(${src.id}, ${to.id})  (the part stays)`, `fadeTransform(${src.id}, ${to.id})`])
  model.requireChunk('anim')
  const list = pairs(from, to, !replace, typeof o.pathArc === 'number' ? o.pathArc : 0)
  return make(verb, o, PACE.transform, (rec, at, d, rate) => {
    const w = windows(list.length, o.lag ?? 0, at, d)
    list.forEach((p, i) => playPair(rec, p, to, replace, w[i]![0], w[i]![1], rate))
  })
}
/**
 * transform(a, b): a turns into b (manim's ReplacementTransform). a leaves the stage; b is the live object afterwards
 * (hidden before). Outlines morph with corners kept sharp; text, groups and composites are carried box to box.
 */
export const transform = defineVerb('transform', (a: unknown, b?: unknown, opts?: unknown): Anim => morphVerb('transform', a, b, opts))
/**
 * derive(a, b): a stays; a copy of it becomes b (manim's TransformFromCopy). b is hidden before and live afterwards.
 * a = a flat object, a 3D part (its outline on screen lifts off), or a point / anchor (b grows out of it).
 */
export const derive = defineVerb('derive', (a: unknown, b?: unknown, opts?: unknown): Anim => morphVerb('derive', a, b, opts))

/** fadeTransform(a, b): a fades out while it travels and scales to where b is; b fades in from where a was (manim's FadeTransform). Works for anything. */
export const fadeTransform = defineVerb('fadeTransform', (a: unknown, b?: unknown, opts?: unknown): Anim => {
  const from = verbTarget(a, 'fadeTransform()'), to = verbTarget(b, 'fadeTransform()')
  if (!from || !to) return no('fadeTransform', PACE.transform)
  const o = options('fadeTransform()', opts, {}, to.model, [from.id, to.id])
  if (from === to) { wrong(to, 'fadeTransform()', `#${to.id} cannot turn into itself.`, ['pass two different objects']); return no('fadeTransform', PACE.transform) }
  return make('fadeTransform', o, PACE.transform, (rec, at, d, rate) => {
    fadeOutClips(rec, from, at, d, rate)
    // only flat objects travel: a 3D part fades where it is
    carryOut(rec, from, to, at, d, rate)
    fadeInClips(rec, to, at, d, rate)
    carryIn(rec, to, from, at, d, rate)
  })
})

// ── flashAround ──────────────────────────────────────────────────────────────────────────────────────
const FLASH = {
  color: { type: 'color', dynamic: false, example: 'color: YELLOW' }, strokeWidth: { type: 'positive', dynamic: false, example: 'strokeWidth: 4' },
  buff: { type: 'nonneg', dynamic: false, example: 'buff: 0.1' }, timeWidth: { type: 'positive', dynamic: false, example: 'timeWidth: 1' },
} as const
/**
 * flashAround(m, { color?, strokeWidth?, buff?, timeWidth? }): a pulse of stroke runs once round the box of m and
 * leaves nothing behind (manim's FlashAround). Works on flat objects and on 3D parts (round where they are drawn).
 */
export const flashAround = defineVerb('flashAround', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'flashAround()')
  if (!node) return no('flashAround')
  const model = node.model
  const o = options('flashAround()', opts, FLASH, model, [node.id])
  model.requireChunk('anim')
  const given: Record<string, unknown> = { target: node }
  for (const name of ['color', 'strokeWidth', 'buff', 'timeWidth']) if (o[name] !== undefined) given[name] = o[name]
  const ring = hidden(flashRing(given))
  return make('flashAround', o, PACE.enter, (rec, at, d, rate) => {
    rec.clip(ring, 'present', 1, { at, duration: 0 })
    rec.clip(ring, 'progress', 1, { at, duration: d, rate, from: 0 })
    rec.clip(ring, 'present', 0, { at: at + d, duration: 0 })
  })
})
