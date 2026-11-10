// The verbs that act on one object: enter and exit (write, create, uncreate, fadeIn, fadeOut, grow, growArrow),
// motion (rotate, moveAlong), emphasis (indicate), numbers (count, vary) and timed(). Semantics and defaults are
// manim's (the project research notes); each verb only records clips, so every frame is a pure function of time.
import {
  add, ANCHOR_NAMES, apply, clamp01, closest, currentModel, definePlacement, defineVerb, isAnchorRef, isColor, isParam, linear, mul, PACE, placementResolver, qAxisDeg, qmul, qrot, smooth, sub, thereAndBack, toVec3, verbTarget,
  type Anim, type Frame, type MNode, type Placed, type Placement, type RateFn, type Step, type Vec3,
} from '../core/index.ts'
import { measurePath, pointAt } from '../lib/path/index.ts'
import {
  atRest, hasOption, isAnim, isLineLike, isNode, isWorldGeometry, leaves, make, no, NUMERIC, options, parts, plain, vectorOf, VERB_DEFAULTS, windows, wrong, type Timing,
} from './shared.ts'

// ── enter / exit plumbing ────────────────────────────────────────────────────────────────────────────
/** A text is an object with a `text` option; write() counts its glyphs. */
const isText = (node: MNode): boolean => hasOption(node, 'text')
/** Put back what an earlier exit left behind: the shift / shrink of a fade, and members a lagged exit hid. */
function restore(rec: Step, node: MNode, at: number, keep: { offset?: boolean; scale?: boolean } = {}): void {
  const model = node.model
  if (!keep.offset && model.clipsFor(node, 'offset')) rec.clip(node, 'offset', [0, 0, 0], { at, duration: 0 })
  if (!keep.scale && model.clipsFor(node, 'enterScale')) rec.clip(node, 'enterScale', 1, { at, duration: 0 })
  const down = (n: MNode): void => {
    for (const c of n.children) {
      if (model.latest(c, 'present') === 0 && model.clipsFor(c, 'present')) {
        rec.clip(c, 'present', 1, { at, duration: 0 })
        if (model.clipsFor(c, 'offset')) rec.clip(c, 'offset', [0, 0, 0], { at, duration: 0 })
        if (model.clipsFor(c, 'enterScale')) rec.clip(c, 'enterScale', 1, { at, duration: 0 })
      }
      down(c)
    }
  }
  down(node)
}
type Extra = (rec: Step, node: MNode, at: number, d: number, rate: RateFn | undefined) => { offset?: boolean; scale?: boolean } | void
/** Record an entrance of `node` (or of its members one after another when `lag` > 0). */
function enter(rec: Step, node: MNode, mode: string, at: number, d: number, rate: RateFn | undefined, lag: number, extra?: Extra, reverse = false): void {
  const one = (n: MNode, t: number, dd: number): void => {
    rec.clip(n, 'revealMode', mode, { at: t, duration: 0 })
    rec.clip(n, 'present', 1, { at: t, duration: dd, rate })
    restore(rec, n, t, extra?.(rec, n, t, dd, rate) ?? {})
  }
  const members = parts(node)
  if (!(lag > 0) || members.length < 2) { one(node, at, d); return }
  // the group itself is there from the start; its members arrive one after another
  rec.clip(node, 'present', 1, { at, duration: 0 })
  restore(rec, node, at)
  const w = windows(members.length, lag, at, d)
  members.forEach((n, i) => { const [t, dd] = w[reverse ? members.length - 1 - i : i]!; one(n, t, dd) })
}
/** Record an exit of `node` (or of its members one after another when `lag` > 0). Ends its life. */
function exit(rec: Step, node: MNode, mode: string, at: number, d: number, rate: RateFn | undefined, lag: number, extra?: Extra, reverse = false): void {
  const one = (n: MNode, t: number, dd: number): void => {
    rec.clip(n, 'revealMode', mode, { at: t, duration: 0 })
    rec.clip(n, 'present', 0, { at: t, duration: dd, rate })
    extra?.(rec, n, t, dd, rate)
  }
  const members = parts(node)
  if (!(lag > 0) || members.length < 2) { one(node, at, d); return }
  const w = windows(members.length, lag, at, d)
  members.forEach((n, i) => { const [t, dd] = w[reverse ? members.length - 1 - i : i]!; one(n, t, dd) })
  rec.clip(node, 'present', 0, { at: at + d, duration: 0 })
}

// ── fadeIn / fadeOut ─────────────────────────────────────────────────────────────────────────────────
const FADE = { shift: { type: 'any', example: 'shift: UP' }, scale: { type: 'positive', dynamic: false, example: 'scale: 0.5' } } as const
/**
 * Scaling is about an object's own origin. The push that keeps its CENTRE still while it is drawn at `scale` times its
 * size: (centre - origin) * (1 - scale), measured at rest. Nothing for an object that is centred on its origin.
 */
function aboutCentre(n: MNode, frame: Frame, scale: number): Vec3 {
  if (atRest()) return [0, 0, 0]
  return plain(frame, (f) => { const c = f.anchor(n, 'center'), o = f.world(n).p; return [(c[0] - o[0]) * (1 - scale), (c[1] - o[1]) * (1 - scale), (c[2] - o[2]) * (1 - scale)] as Vec3 })
}
/** fadeIn(m, { shift?, scale? }): appear. shift = the direction it arrives along; scale = the size it starts at. */
export const fadeIn = defineVerb('fadeIn', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'fadeIn()')
  if (!node) return no('fadeIn')
  const o = options('fadeIn()', opts, FADE, node.model, [node.id])
  const shift = vectorOf(node, 'fadeIn()', 'shift', o.shift)
  const scale = typeof o.scale === 'number' ? o.scale : null
  return make('fadeIn', o, PACE.enter, (rec, at, d, rate) => enter(rec, node, 'fade', at, d, rate, o.lag ?? 0, (r, n, t, dd, rt) => {
    if (scale === null) { if (shift) r.clip(n, 'offset', [0, 0, 0], { at: t, duration: dd, rate: rt, from: [-shift[0], -shift[1], -shift[2]] }); return { offset: !!shift, scale: false } }
    // the size changes about the object's own centre, wherever its origin is (a dot of a plot has the origin of its axes)
    r.clip(n, 'enterScale', 1, { at: t, duration: dd, rate: rt, from: () => (atRest() ? 1 : scale) })
    r.clip(n, 'offset', [0, 0, 0], { at: t, duration: dd, rate: rt, from: (_: MNode, frame: Frame): Vec3 => { const c = aboutCentre(n, frame, scale); return shift ? [c[0] - shift[0], c[1] - shift[1], c[2] - shift[2]] : c } })
    return { offset: true, scale: true }
  }))
})
/** fadeOut(m, { shift?, scale? }): leave. shift = the direction it leaves along; scale = the size it ends at. Ends the object's life (fadeIn brings it back). */
export const fadeOut = defineVerb('fadeOut', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'fadeOut()')
  if (!node) return no('fadeOut')
  const o = options('fadeOut()', opts, FADE, node.model, [node.id])
  const shift = vectorOf(node, 'fadeOut()', 'shift', o.shift)
  const scale = typeof o.scale === 'number' ? o.scale : null
  return make('fadeOut', o, PACE.enter, (rec, at, d, rate) => exit(rec, node, 'fade', at, d, rate, o.lag ?? 0, (r, n, t, dd, rt) => {
    if (scale === null) { if (shift) r.clip(n, 'offset', shift, { at: t, duration: dd, rate: rt }); return }
    r.clip(n, 'enterScale', () => (atRest() ? 1 : scale), { at: t, duration: dd, rate: rt })
    r.clip(n, 'offset', (_: MNode, frame: Frame): Vec3 => { const c = aboutCentre(n, frame, scale); return shift ? [c[0] + shift[0], c[1] + shift[1], c[2] + shift[2]] : c }, { at: t, duration: dd, rate: rt })
  }))
})

// ── create / uncreate ────────────────────────────────────────────────────────────────────────────────
const groupLag = (node: MNode, lag: number | undefined): number => lag ?? (parts(node).length > 1 ? VERB_DEFAULTS.createLag : 0)
/** create(m): draw the outline on, then fill (manim's ShowCreation). The members of a group are drawn one after another. */
export const create = defineVerb('create', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'create()')
  if (!node) return no('create')
  const o = options('create()', opts, {}, node.model, [node.id])
  const mode = 'create' // a flat object's outline, a 3D part's edge lines (src/r3d draws them on, then fills the body)
  return make('create', o, PACE.enter, (rec, at, d, rate) => enter(rec, node, mode, at, d, rate, groupLag(node, o.lag)))
})
/** uncreate(m): the reverse of create: the fill goes, then the outline is taken back from its end. Ends the object's life. */
export const uncreate = defineVerb('uncreate', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'uncreate()')
  if (!node) return no('uncreate')
  const o = options('uncreate()', opts, {}, node.model, [node.id])
  const mode = 'create'
  return make('uncreate', o, PACE.enter, (rec, at, d, rate) => exit(rec, node, mode, at, d, rate, groupLag(node, o.lag), undefined, true))
})

// ── write ────────────────────────────────────────────────────────────────────────────────────────────
/** Glyphs of a text as written: every character that is not white space. */
export const glyphsOf = (text: string): string[] => Array.from(text).filter((ch) => !/\s/.test(ch))
function glyphCount(node: MNode): number {
  if (!isText(node)) return 1
  const raw = node.model.latest(node, 'text')
  // a text given as a function is read as it is when the verb is recorded
  const text = typeof raw === 'function' ? node.model.now().prop<unknown>(node, 'text') : raw
  return Math.max(1, glyphsOf(String(text ?? '')).length)
}
/**
 * write(m): manim's Write. Each glyph's outline is traced, then the outline gives way to the fill; glyphs follow each
 * other with a lag of min(4 / (n + 1), 0.2) (the text backend staggers them: WRITE in src/r2d/svg.ts; `lag` here
 * spaces the texts of a group). 1 s under 15 glyphs, else 2 s; linear. A shape is drawn then filled.
 */
export const write = defineVerb('write', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'write()')
  if (!node) return no('write', PACE.write)
  const model = node.model
  const o = options('write()', opts, {}, model, [node.id])
  const mode = 'write'
  const units = leaves(node).map((n) => ({ node: n, glyphs: glyphCount(n) }))
  const n = units.reduce((s, u) => s + u.glyphs, 0)
  const lag = o.lag ?? Math.min(VERB_DEFAULTS.writeLagSpread / (n + 1), VERB_DEFAULTS.writeLagMax)
  return make('write', o, n < VERB_DEFAULTS.writeLongFrom ? PACE.write : PACE.writeLong, (rec, at, d, rate) => {
    const rt = rate ?? linear
    if (units.length === 1 && units[0]!.node === node) {
      enter(rec, node, mode, at, d, rt, 0)
      return
    }
    // a group: its glyphs are one run. Glyph k of n occupies [k·lag, k·lag + 1] / ((n − 1)·lag + 1) of the time
    if (node.model.latest(node, 'present') === 0 || !node.model.clipsFor(node, 'present')) rec.clip(node, 'present', 1, { at, duration: 0 })
    const full = (n - 1) * lag + 1
    let first = 0
    for (const u of units) {
      const t = at + ((first * lag) / full) * d, dd = (((u.glyphs - 1) * lag + 1) / full) * d
      enter(rec, u.node, mode, t, dd, rt, 0)
      first += u.glyphs
    }
  })
})
// ── grow / growArrow ─────────────────────────────────────────────────────────────────────────────────
const EDGES = [...ANCHOR_NAMES, 'start', 'end']
/**
 * grow(m, { from? }): the object grows from nothing to its size (manim's GrowFromCenter / GrowFromEdge /
 * GrowFromPoint). from = 'center' (default), an edge or corner of the object ('left', 'bottom', 'ul' …), or a point,
 * an object or an anchor to grow out of. A line or an arrow grows from its start.
 */
export const grow = defineVerb('grow', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'grow()')
  if (!node) return no('grow')
  const o = options('grow()', opts, { from: { type: 'any', example: "from: 'left'" } }, node.model, [node.id])
  if (isWorldGeometry(node)) {
    if (!isLineLike(node)) wrong(node, 'grow()', `#${node.id} (${node.kind}) is drawn between points and has no size of its own to grow; it fades in instead.`, [`fadeIn(${node.id})`])
    const mode = isLineLike(node) ? 'create' : 'fade'
    return make('grow', o, PACE.enter, (rec, at, d, rate) => enter(rec, node, mode, at, d, rate, 0))
  }
  let edge: string | null = null
  let point: unknown
  if (typeof o.from === 'string') {
    const name = o.from.toLowerCase()
    if (EDGES.includes(name)) edge = name === 'center' ? null : name
    else if (node.model.byId.has(o.from)) point = node.model.byId.get(o.from)
    else { const near = closest(o.from, EDGES); wrong(node, 'grow()', `from: "${o.from}" is not an edge of the object.`, [near ? `use '${near}'` : `use one of: ${EDGES.join(', ')}`, 'or pass a point, an object or an anchor: from: other.top'], 'API-UNKNOWN') }
  } else if (o.from !== undefined && o.from !== null) {
    if (isNode(o.from) || isAnchorRef(o.from) || typeof o.from === 'function' || toVec3(o.from)?.every(Number.isFinite)) point = o.from
    else wrong(node, 'grow()', 'from must be an edge name, a point, an object or an anchor.', ["grow(m, { from: 'left' })", 'grow(m, { from: other.top })'])
  }
  const start = VERB_DEFAULTS.growStart
  return make('grow', o, PACE.enter, (rec, at, d, rate) => enter(rec, node, 'fade', at, 0, rate, 0, (r, n) => {
    // (measured at rest the object has its full size: see plain() in ./shared.ts)
    r.clip(n, 'enterScale', 1, { at, duration: d, rate, from: () => (atRest() ? 1 : start) })
    if (edge === null && point === undefined) return { scale: true }
    const t1 = r.rec.t0 + at + d
    // scaling is about the object's own origin: to keep the chosen point still, the object is pushed towards it by (1 − scale)
    const from = (_: MNode, frame: Frame): Vec3 => {
      if (atRest() || frame.tau >= t1) return [0, 0, 0]
      return plain(frame, (f) => mul(sub(edge !== null ? f.anchor(n, edge) : f.point(point, n), f.world(n).p), 1 - start))
    }
    r.clip(n, 'offset', [0, 0, 0], { at, duration: d, rate, from })
    return { scale: true, offset: true }
  }))
})
/** growArrow(arrow): the arrow (or line) is drawn out of its start; its head arrives with the end. */
export const growArrow = defineVerb('growArrow', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'growArrow()')
  if (!node) return no('growArrow')
  const o = options('growArrow()', opts, {}, node.model, [node.id])
  if (!isLineLike(node)) {
    wrong(node, 'growArrow()', `#${node.id} is a ${node.kind}, not an arrow or a line (something that runs from a to b).`, [`grow(${node.id})`, `or create(${node.id})`])
    return grow(node, opts as never)
  }
  return make('growArrow', o, PACE.enter, (rec, at, d, rate) => enter(rec, node, 'create', at, d, rate, 0))
})

// ── rotate ───────────────────────────────────────────────────────────────────────────────────────────
interface Rot { about: unknown; deg: unknown }
const sameAxis = (a: unknown, b: unknown): boolean => (typeof a === 'string' || typeof b === 'string' ? a === b : JSON.stringify(a) === JSON.stringify(b))
const plus = (v: unknown, deg: number): unknown => (typeof v === 'function' ? () => ((v as () => number)() || 0) + deg : (typeof v === 'number' ? v : 0) + deg)
interface OrbitPlacement extends Placement { inner: Placement | null; pivot: unknown; deg: number; t0: number; t1: number; rate: RateFn }
/** A placement that turns another placement about a point (2D): the position rotate(m, deg, { about }) gives. */
definePlacement('animOrbit', (node, pl, frame, own): Placed => {
  const o = pl as OrbitPlacement
  const resolver = o.inner ? placementResolver(o.inner.type) : undefined
  const inner: Placed = o.inner && resolver ? resolver(node, o.inner, frame, own) : { p: [0, 0, 0] }
  const p = !inner.world && node.parent ? apply(frame.world(node.parent), inner.p) : inner.p
  const span = o.t1 - o.t0
  const u = span > 0 ? o.rate(clamp01((frame.tau - o.t0) / span)) : 1
  const c = frame.point(o.pivot, node)
  const out: Placed = { p: add(c, qrot(qAxisDeg([0, 0, 1], o.deg * u), sub(p, c))), world: true }
  if (inner.q) out.q = qmul(qAxisDeg([0, 0, 1], o.deg * u), inner.q)
  return out
})
/**
 * rotate(m, degrees, { about? }): turn by that many degrees (counter-clockwise for a flat object). 2D: about = a
 * point, object or anchor to turn around (default: the object's own centre). 3D: about = the axis, 'x' | 'y' | 'z'
 * or a vector (default 'y').
 */
export const rotate = defineVerb('rotate', (target: unknown, degrees?: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'rotate()')
  if (!node) return no('rotate', PACE.play)
  const model = node.model
  const o = options('rotate()', opts, { about: { type: 'any', example: node.space === '3d' ? "about: 'y'" : 'about: [0, 0]' } }, model, [node.id])
  if (typeof degrees !== 'number' || !Number.isFinite(degrees)) {
    wrong(node, 'rotate()', `the angle must be a finite number of degrees, got ${String(degrees)}.`, [`rotate(${node.id}, 90)`], typeof degrees === 'number' ? 'NUM-INVALID' : 'API-TYPE')
    return no('rotate', PACE.play)
  }
  if (isWorldGeometry(node)) {
    wrong(node, 'rotate()', `#${node.id} (${node.kind}) is drawn between points and has no angle of its own.`, ['turn what it is attached to: a line between two objects follows them', `or rotate one of its ends about the other: rotate(end, ${degrees}, { about: start })`])
    return no('rotate', PACE.play)
  }
  const deg = degrees
  if (node.space === '3d') {
    let axis: unknown = o.about ?? 'y'
    if (!(axis === 'x' || axis === 'y' || axis === 'z') && !toVec3(axis)?.every(Number.isFinite)) {
      wrong(node, 'rotate()', `about must be the axis a 3D part turns around: 'x', 'y', 'z' or a vector.`, [`rotate(${node.id}, ${deg}, { about: 'y' })`])
      axis = 'y'
    }
    return make('rotate', o, PACE.play, (rec, at, d, rate) => {
      const latest = model.latest(node, 'rotate')
      const list: Rot[] = Array.isArray(latest) ? (latest as Rot[]).map((e) => ({ ...e })) : []
      const hit = list.find((e) => sameAxis(e.about, axis))
      if (hit) hit.deg = plus(hit.deg, deg)
      else list.push({ about: axis, deg })
      rec.clip(node, 'rotate', list, { at, duration: d, rate })
    })
  }
  const pivot = o.about
  if (pivot !== undefined && !(isNode(pivot) || isAnchorRef(pivot) || typeof pivot === 'function' || toVec3(pivot)?.every(Number.isFinite))) {
    wrong(node, 'rotate()', 'about must be a point, an object or an anchor to turn around.', [`rotate(${node.id}, ${deg}, { about: [0, 0] })`, `rotate(${node.id}, ${deg}, { about: other.center })`])
    return no('rotate', PACE.play)
  }
  return make('rotate', o, PACE.play, (rec, at, d, rate) => {
    rec.clip(node, 'rotate', plus(model.latest(node, 'rotate'), deg), { at, duration: d, rate })
    if (pivot === undefined) return
    const inner = model.latest(node, 'placement') as Placement | null | undefined
    const pl: OrbitPlacement = { type: 'animOrbit', inner: inner ?? null, pivot, deg, t0: rec.rec.t0 + at, t1: rec.rec.t0 + at + d, rate: rate ?? smooth }
    rec.clip(node, 'placement', pl, { at, duration: 0 })
    rec.need(at + d)
  })
})

// ── moveAlong ────────────────────────────────────────────────────────────────────────────────────────
interface AlongPlacement extends Placement { /** the object whose outline is the path (seen by the core: an object on a screen-space path is on the screen too) */ target: MNode | null; points: unknown[] | null; t0: number; t1: number; rate: RateFn }
/** Point at a share u of the length of a chain of points. */
function alongPoints(points: Vec3[], u: number): Vec3 {
  if (points.length === 1) return points[0]!
  const cum = [0]
  for (let i = 1; i < points.length; i++) { const a = points[i - 1]!, b = points[i]!; cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) }
  const s = clamp01(u) * cum[cum.length - 1]!
  let i = 1
  while (i < points.length - 1 && cum[i]! < s) i++
  const a = points[i - 1]!, b = points[i]!, span = cum[i]! - cum[i - 1]!
  const k = span > 0 ? (s - cum[i - 1]!) / span : 0
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}
/** The position moveAlong() gives: the point at the eased share of the path's length (manim's MoveAlongPath). */
definePlacement('animAlong', (node, pl, frame): Placed => {
  const o = pl as AlongPlacement
  const span = o.t1 - o.t0
  const u = span > 0 ? o.rate(clamp01((frame.tau - o.t0) / span)) : 1
  if (o.target) {
    const path = o.target
    const m = frame.memo('anim.path' + path.uid, () => measurePath(frame.outline(path)), null)
    if (!m || !m.subpaths.length) return { p: frame.point(path, node), world: true }
    const q = pointAt(m, clamp01(u)).point
    return { p: frame.into(node, path, [q[0], q[1], 0]), world: true }
  }
  return { p: alongPoints((o.points ?? []).map((p) => frame.point(p, node)), u), world: true }
})
/**
 * moveAlong(m, path): m travels along the path, its centre on it (manim's MoveAlongPath), and stays at the end.
 * path = a 2D object (its outline, from start to end) or a list of at least two points, objects or anchors.
 */
export const moveAlong = defineVerb('moveAlong', (target: unknown, path?: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'moveAlong()')
  if (!node) return no('moveAlong', PACE.play)
  const model = node.model
  const o = options('moveAlong()', opts, {}, model, [node.id])
  if (isWorldGeometry(node)) {
    wrong(node, 'moveAlong()', `#${node.id} (${node.kind}) is drawn between points and cannot be moved as one object.`, ['move what it is attached to: a line between two objects follows them'])
    return no('moveAlong', PACE.play)
  }
  let via: MNode | null = null
  let points: unknown[] | null = null
  const isPoint = (p: unknown): boolean => isNode(p) || isAnchorRef(p) || typeof p === 'function' || !!toVec3(p)?.every(Number.isFinite)
  if (isNode(path) || typeof path === 'string') {
    via = verbTarget(path, 'moveAlong()')
    if (via && via.space === '3d') { wrong(node, 'moveAlong()', `the path #${via.id} is a 3D part; a path is a flat object (its outline) or a list of points.`, ['moveAlong(m, [[0, 0, 0], [2, 1, 0]])']); via = null }
    else if (via === node) { wrong(node, 'moveAlong()', `#${node.id} cannot travel along itself.`, ['pass another object, or a list of points']); via = null }
    if (!via) return no('moveAlong', PACE.play)
  } else if (Array.isArray(path) && path.length >= 2 && path.every(isPoint) && !path.every((x) => typeof x === 'number')) points = path
  else {
    wrong(node, 'moveAlong()', `the path must be a 2D object or a list of at least two points, got ${Array.isArray(path) ? 'a list that is too short or holds something else' : path === undefined ? 'nothing' : typeof path}.`, ['moveAlong(dot, curve)', 'moveAlong(dot, [[-2, 0], [0, 1], [2, 0]])'], path === undefined || path === null ? 'REF-MISSING' : 'API-TYPE')
    return no('moveAlong', PACE.play)
  }
  return make('moveAlong', o, PACE.play, (rec, at, d, rate) => {
    const pl: AlongPlacement = { type: 'animAlong', target: via, points, t0: rec.rec.t0 + at, t1: rec.rec.t0 + at + d, rate: rate ?? smooth }
    rec.clip(node, 'placement', pl, { at, duration: 0 })
    rec.need(at + d)
  })
})

// ── indicate ─────────────────────────────────────────────────────────────────────────────────────────
/** indicate(m, { scale?, color? }): swell and take a colour, then settle back (manim's Indicate). Nothing is left behind. */
export const indicate = defineVerb('indicate', (target: unknown, opts?: unknown): Anim => {
  const node = verbTarget(target, 'indicate()')
  if (!node) return no('indicate')
  const model = node.model
  const o = options('indicate()', opts, { scale: { type: 'positive', dynamic: false, default: VERB_DEFAULTS.indicateScale, example: 'scale: 1.2' }, color: { type: 'color', nullable: true, dynamic: false, example: 'color: YELLOW' } }, model, [node.id])
  const scale: number = o.scale ?? VERB_DEFAULTS.indicateScale
  const color: string | null = o.color === null ? null : o.color ?? VERB_DEFAULTS.indicateColor
  const pulse = pulseOf(node, 'indicate()', o)
  // the objects that have a colour to tint: the node, or the nearest ones inside it; only where the colour is a plain colour now
  const tinted: MNode[] = []
  if (color) {
    const now = model.now()
    const walk = (n: MNode): void => { if (model.accepts(n, 'color') && hasOption(n, 'color')) { if (isColor(now.prop(n, 'color'))) tinted.push(n) } else n.children.forEach(walk) }
    walk(node)
  }
  return make('indicate', o, PACE.enter, (rec, at, d) => {
    if (!isWorldGeometry(node)) rec.clip(node, 'enterScale', scale, { at, duration: d, rate: pulse })
    else if (hasOption(node, 'strokeWidth', NUMERIC)) { const w = model.now().prop<number>(node, 'strokeWidth'); if (typeof w === 'number') rec.clip(node, 'strokeWidth', w * scale, { at, duration: d, rate: pulse }) }
    for (const n of tinted) rec.clip(n, 'color', color, { at, duration: d, rate: pulse })
  })
})
/** The rate of a pulse: it must come back to 0, or the emphasis would stay. The rate of the play does not replace it. */
export function pulseOf(node: MNode, call: string, o: Timing): RateFn {
  if (!o.rate) return thereAndBack
  let end = NaN
  try { end = o.rate(1) } catch { /* reported when it is evaluated */ }
  if (Math.abs(end) < 1e-6) return o.rate
  wrong(node, call, `rate ends at ${Number.isFinite(end) ? Math.round(end * 1000) / 1000 : String(end)}; a pulse must come back to 0, or the emphasis would stay.`, ['rate: thereAndBack', 'rate: wiggle', 'leave rate out'])
  return thereAndBack
}

// ── numbers ──────────────────────────────────────────────────────────────────────────────────────────
const format = (v: number, decimals: number): string => { const s = v.toFixed(decimals); return Number(s) === 0 ? (0).toFixed(decimals) : s }
const decimalsOf = (v: number): number => { const s = String(v); const i = s.indexOf('.'); return i < 0 || s.includes('e') ? 0 : Math.min(6, s.length - i - 1) }
/**
 * count(target, to, { from?, decimals? }): a number runs to a value. target = a param, an object with a numeric
 * `value` (a readout), or a text: the first number in it runs and what is written around it stays (from = where it
 * starts, default the number it shows now; decimals = digits after the point).
 */
export const count = defineVerb('count', (target: unknown, to?: unknown, opts?: unknown): Anim => {
  const model = isNode(target) ? target.model : currentModel()
  if (typeof to !== 'number' || !Number.isFinite(to)) {
    model.diagnostics.add({ code: typeof to === 'number' ? 'NUM-INVALID' : 'API-TYPE', ids: isNode(target) ? [target.id] : [], what: `count(): the value to count to must be a finite number, got ${String(to)}.`, fix: ['count(label, 100)'] })
    return no('count', PACE.play)
  }
  const end = to
  if (isParam(target)) {
    const def = target.def
    const o = options('count()', opts, {}, model, [])
    if (def.kind !== 'number') { model.diagnostics.add({ code: 'API-TYPE', what: `count(): the param "${def.name}" is not a number.`, fix: [`st.set(${def.name}, value)`] }); return no('count', PACE.play) }
    return make('count', o, PACE.play, (rec, at, d, rate) => { rec.clip(def, 'value', end, { at, duration: d, rate }) })
  }
  const node = verbTarget(target, 'count()')
  if (!node) return no('count', PACE.play)
  const o = options('count()', opts, { from: { type: 'number', dynamic: false, example: 'from: 0' }, decimals: { type: 'int', dynamic: false, example: 'decimals: 1' } }, model, [node.id])
  if (hasOption(node, 'value', NUMERIC)) {
    return make('count', o, PACE.play, (rec, at, d, rate) => { rec.clip(node, 'value', end, { at, duration: d, rate, ...(typeof o.from === 'number' ? { from: o.from } : {}) }) })
  }
  if (!isText(node)) {
    wrong(node, 'count()', `#${node.id} is a ${node.kind}, which shows no number: count() takes a param, an object with a numeric value, or a text.`, ["count(text('0'), 100)", 'count(param, 100)'])
    return no('count', PACE.play)
  }
  // the first number in the text runs; whatever is written around it stays ("0°" → "360°")
  const now = String(model.now().prop<unknown>(node, 'text') ?? '')
  const hit = /-?\d+(?:\.\d+)?/.exec(now)
  const before = hit ? now.slice(0, hit.index) : '', after = hit ? now.slice(hit.index + hit[0].length) : ''
  const start: number = typeof o.from === 'number' ? o.from : hit ? Number(hit[0]) : 0
  const decimals: number = typeof o.decimals === 'number' && o.decimals >= 0 ? Math.min(o.decimals, 12) : Math.max(decimalsOf(start), decimalsOf(end))
  return make('count', o, PACE.play, (rec, at, d, rate) => {
    const t0 = rec.rec.t0 + at, ease = rate ?? smooth
    // the text is a function of time from here on: the number at this moment, then the value it reached
    rec.clip(node, 'text', (_: MNode, frame: Frame) => before + format(start + (end - start) * (d > 0 ? ease(clamp01((frame.tau - t0) / d)) : 1), decimals) + after, { at, duration: 0 })
    rec.need(at + d)
  })
})

/**
 * vary(param, stops, { hold? }): a param runs to a value, or through several, easing in and out of each
 * (`duration` seconds per leg, default 3) and resting `hold` seconds at each stop on the way.
 */
export const vary = defineVerb('vary', (param: unknown, stops?: unknown, opts?: unknown): Anim => {
  const model = currentModel()
  if (!isParam(param) || param.def.kind !== 'number') {
    model.diagnostics.add({ code: param === undefined || param === null ? 'REF-MISSING' : 'API-TYPE', what: `vary(): the first argument must be a number param, got ${isParam(param) ? `the ${param.def.kind} "${param.def.name}"` : isNode(param) ? `the object #${param.id}` : param === null ? 'null' : typeof param}.`, fix: ["const angle = s.param('angle', { value: 0, min: 0, max: 360 })  …  st.play(vary(angle, 360))"] })
    return no('vary', PACE.sweep)
  }
  const def = param.def
  const list = Array.isArray(stops) ? stops : [stops]
  if (!list.length || !list.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    model.diagnostics.add({ code: list.some((v) => typeof v === 'number') ? 'NUM-INVALID' : 'API-TYPE', what: `vary(${def.name}, …): the stops must be finite numbers, got ${list.map(String).join(', ') || 'none'}.`, fix: [`vary(${def.name}, ${def.max})`, `vary(${def.name}, [${def.max}, ${def.min}])`] })
    return no('vary', PACE.sweep)
  }
  const values = list as number[]
  const o = options('vary()', opts, { hold: { type: 'nonneg', dynamic: false, default: VERB_DEFAULTS.varyHold, example: 'hold: 0.5' } }, model, [])
  const hold: number = o.hold ?? VERB_DEFAULTS.varyHold
  const leg = o.duration ?? PACE.sweep
  const total = values.length * leg + (values.length - 1) * hold
  return make('vary', { ...o, duration: total }, total, (rec, at, d, rate) => {
    const k = total > 0 ? d / total : 1
    values.forEach((v, i) => rec.clip(def, 'value', v, { at: at + i * (leg + hold) * k, duration: leg * k, rate }))
  })
})

/**
 * timed(anim, { duration?, rate?, span? }): the same animation with its own timing inside a play. For what takes no
 * options of its own: m.to…, param.to(v), all(), seq(), lagged().
 */
export const timed = defineVerb('timed', (inner: unknown, opts?: unknown): Anim => {
  const model = currentModel()
  if (!isAnim(inner)) {
    model.diagnostics.add({ code: inner === undefined || inner === null ? 'REF-MISSING' : 'API-TYPE', ids: isNode(inner) ? [inner.id] : [], what: `timed() expects an animation (m.to…, param.to(v), a verb), got ${isNode(inner) ? `the object #${inner.id}` : inner === null ? 'null' : typeof inner}.`, fix: ['timed(box.to.shift(2, 0), { span: [1, 2] })'] })
    return no('timed', 0)
  }
  const o = options('timed()', opts, {}, model, [])
  if (o.lag !== undefined) model.diagnostics.add({ code: 'API-UNKNOWN', what: 'timed() has no option "lag": a lag belongs to the verb or to lagged().', fix: ['lagged([a, b], { lag: 0.1 })'] })
  return make('timed', o, inner.duration, (rec, at, d, rate) => inner.record(rec, at, d, rate))
})
