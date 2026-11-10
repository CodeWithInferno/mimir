// Built-in placements (at, attach, nextTo, flow, between) and the setters / methods every node has.
// All of it goes through the public registries, exactly like a feature module would.
import { closest } from './diagnostics.ts'
import { isColor } from './color.ts'
import { add, boxPoint, boxSize, lerp, mul, qFromTo, qmul, qrot, sub, toVec3, transformBox, type Box3, type Vec3 } from './math.ts'
import { anchorRef, defineMethod, defineSetter, isAnchorRef, isNode, type MNode, type Patch } from './node.ts'
import { defineInterp, definePlacement, kindOf } from './registry.ts'
import { ANCHOR_NAMES, oppositeAnchor, spaceOf, type Frame } from './frame.ts'
import { validateOptions, type Schema } from './schema.ts'
import { reportProblems } from './registry.ts'

// ── directions ───────────────────────────────────────────────────────────────────────────────────────
export const UP: Vec3 = [0, 1, 0], DOWN: Vec3 = [0, -1, 0], LEFT: Vec3 = [-1, 0, 0], RIGHT: Vec3 = [1, 0, 0]
export const UL: Vec3 = [-1, 1, 0], UR: Vec3 = [1, 1, 0], DL: Vec3 = [-1, -1, 0], DR: Vec3 = [1, -1, 0]
export const FRONT: Vec3 = [0, 0, 1], BACK: Vec3 = [0, 0, -1], ORIGIN: Vec3 = [0, 0, 0]
const DIRS: Record<string, Vec3> = { up: UP, down: DOWN, left: LEFT, right: RIGHT, front: FRONT, back: BACK, above: UP, below: DOWN, top: UP, bottom: DOWN, ul: UL, ur: UR, dl: DL, dr: DR }

const fail = (node: MNode, code: string, what: string, fix: string[]): null => {
  node.model.diagnostics.add({ code, ids: [node.id], what, fix })
  return null
}
/** 'up' | 'down' | 'left' | 'right' | 'front' | 'back' | [x, y, z] → vector; reports and returns null otherwise. */
export function parseDir(node: MNode, call: string, v: unknown): Vec3 | null {
  if (typeof v === 'string') {
    const d = DIRS[v.toLowerCase()]
    if (d) return d
    const near = closest(v, ['up', 'down', 'left', 'right', 'front', 'back'])
    return fail(node, 'API-UNKNOWN', `${call}: there is no direction "${v}".`, [near ? `use '${near}'` : `use 'up', 'down', 'left', 'right', 'front' or 'back'`])
  }
  const vec = toVec3(v)
  if (vec && vec.every(Number.isFinite) && (vec[0] || vec[1] || vec[2])) return vec
  return fail(node, 'API-TYPE', `${call}: direction must be a word or a vector.`, [`${call.replace(/\(\)$/, '')}(target, 'right')`])
}
const dynNum = (v: unknown): v is number | (() => number) => typeof v === 'number' || typeof v === 'function'

// ── placement resolvers ──────────────────────────────────────────────────────────────────────────────
// A position given as an object or an anchor is resolved into the placed node's own space: a 2D object placed at a
// 3D part lands where that part is drawn.
definePlacement('at', (node, pl, frame) => {
  const pos = pl.pos
  if (isNode(pos) || isAnchorRef(pos)) return { p: frame.point(pos, node), world: true }
  const v = typeof pos === 'function' ? frame.value<unknown>(pos, [0, 0, 0], node, 'at()') : pos
  if (isNode(v) || isAnchorRef(v)) return { p: frame.point(v, node), world: true }
  return { p: toVec3(v) ?? [NaN, NaN, NaN] }
})

/** m.pin(part, anchor?, { offset }): a 2D object that sits on a 3D anchor (or any other object) and follows it. */
definePlacement('pin', (node, pl, frame) => {
  const p = frame.point(pl.ref, node)
  const o = toVec3(frame.value<unknown>(pl.offset, [0, 0, 0], node, 'pin offset')) ?? [0, 0, 0]
  return { p: [p[0] + o[0], p[1] + o[1], node.space === '2d' ? 0 : p[2] + o[2]], world: true }
})

definePlacement('attach', (node, pl, frame, own) => {
  const target = pl.target as MNode
  const to = pl.to as string, my = pl.my as string
  const gap = frame.value<number>(pl.gap, 0, node, 'attach gap') || 0
  const s = own.parentS * own.s
  const mine = frame.anchorLocal(node, my) ?? [0, 0, 0]
  if (spaceOf(node) !== spaceOf(target)) {
    // across spaces (a 2D tag on a 3D part): follow the point where the anchor is drawn, keep the node's own turn
    const q = qmul(own.parentQ, own.q)
    return { p: sub(frame.into(node, target, frame.anchor(target, to)), qrot(q, mul(mine, s))), world: true }
  }
  const tw = frame.world(target)
  const q = qmul(tw.q, own.q) // rigid: the attached part turns with its target
  const at = add(frame.anchor(target, to), mul(frame.anchorOut(target, to), gap))
  return { p: sub(at, qrot(q, mul(mine, s))), q, world: true }
})

definePlacement('nextTo', (node, pl, frame, own) => {
  const dir = pl.dir as Vec3
  const gap = frame.value<number>(pl.gap, 0.25, node, 'nextTo gap')
  const target = pl.target
  let tb: Box3
  if (isNode(target)) tb = frame.boxIn(node, target)
  else { const p = frame.point(target, node); tb = { min: [...p] as Vec3, max: [...p] as Vec3 } }
  const mine = transformBox(frame.localBounds(node), { p: [0, 0, 0], q: qmul(own.parentQ, own.q), s: own.parentS * own.s })
  const p = sub(add(boxPoint(tb, dir), mul(dir, Number.isFinite(gap) ? gap : 0.25)), boxPoint(mine, mul(dir, -1)))
  if (node.space === '2d') p[2] = 0
  return { p, world: true }
})

/** Layout of a row / column container, memoised per frame: child uid → local position. */
function flowLayout(container: MNode, frame: Frame): Map<number, Vec3> {
  return frame.memo('flow' + container.uid, () => {
    const out = new Map<number, Vec3>()
    const column = frame.prop<string>(container, 'layout') === 'column'
    const gap = frame.prop<number>(container, 'gap') ?? 0.5
    const align = frame.prop<string>(container, 'align') ?? 'center'
    const items = container.children.filter((c) => c.placement?.type === 'flow')
    const boxes = items.map((c) => transformBox(frame.localBounds(c), { p: [0, 0, 0], q: frame.ownRotation(c), s: frame.ownScale(c) }))
    const main = column ? 1 : 0, cross = column ? 0 : 1
    const total = boxes.reduce((sum, b) => sum + boxSize(b)[main], 0) + gap * Math.max(0, items.length - 1)
    const crossMax = Math.max(0, ...boxes.map((b) => boxSize(b)[cross]))
    let cursor = -total / 2
    items.forEach((c, i) => {
      const b = boxes[i]!
      const size = boxSize(b)
      const p: Vec3 = [0, 0, 0]
      // rows run left → right; columns run top → bottom
      if (column) p[1] = -(cursor + size[1]) - b.min[1]
      else p[0] = cursor - b.min[0]
      const lo = align === 'left' || align === 'bottom', hi = align === 'right' || align === 'top'
      p[cross] = lo ? -crossMax / 2 - b.min[cross] : hi ? crossMax / 2 - b.max[cross] : -(b.min[cross] + b.max[cross]) / 2
      cursor += size[main] + gap
      out.set(c.uid, p)
    })
    return out
  }, new Map<number, Vec3>())
}
definePlacement('flow', (node, pl, frame) => ({ p: flowLayout(pl.container as MNode, frame).get(node.uid) ?? [0, 0, 0] }))

definePlacement('between', (node, pl, frame, own) => {
  const a = frame.point(pl.a, node), b = frame.point(pl.b, node)
  const d = sub(b, a)
  const q = Math.hypot(d[0], d[1], d[2]) > 1e-9 ? qFromTo([0, 1, 0], d) : own.q
  return { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q: qmul(q, own.q), world: true }
})

// ── rotation lists (3D) blend entry by entry ─────────────────────────────────────────────────────────
interface Rot { about: unknown; deg: unknown }
const sameAxis = (a: unknown, b: unknown): boolean => (typeof a === 'string' || typeof b === 'string' ? a === b : JSON.stringify(a) === JSON.stringify(b))
defineInterp('*', 'rotate', (a, b, u, frame, node) => {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, u)
  if (!Array.isArray(a) || !Array.isArray(b)) return u >= 0.5 ? b : a
  const val = (e: Rot | undefined): number => (e ? frame.value<number>(e.deg, 0, node, 'rotate.deg') || 0 : 0)
  const out: Rot[] = (a as Rot[]).map((e) => ({ about: e.about, deg: lerp(val(e), val((b as Rot[]).find((x) => sameAxis(x.about, e.about))), u) }))
  for (const e of b as Rot[]) if (!(a as Rot[]).some((x) => sameAxis(x.about, e.about))) out.push({ about: e.about, deg: lerp(0, val(e), u) })
  return out
})

// ── setters every node has ───────────────────────────────────────────────────────────────────────────
defineSetter('*', 'at', (node, ...args: unknown[]): Patch | null => {
  const call = `${node.kind}.at()`
  if (args.length === 1) {
    const a = args[0]
    if (isNode(a) || typeof a === 'function') return { placement: { type: 'at', pos: a } }
    if (typeof a === 'string' || a === undefined || a === null) { const t = node.model.resolveNode(a, call); return t ? { placement: { type: 'at', pos: t } } : null }
    const v = toVec3(a)
    if (!v) return fail(node, 'API-TYPE', `${call} expects coordinates or an object.`, [node.space === '3d' ? '.at(x, y, z)' : '.at(x, y)', '.at(otherObject)'])
    args = v
  }
  if (args.length < 2 || args.length > 3 || !args.every(dynNum)) return fail(node, 'API-TYPE', `${call} expects ${node.space === '3d' ? 'x, y, z' : 'x, y'} as numbers.`, [node.space === '3d' ? '.at(0, 2, 0)' : '.at(0, 2)'])
  const names = ['x', 'y', 'z']
  for (let i = 0; i < args.length; i++) if (typeof args[i] === 'number' && !Number.isFinite(args[i])) return fail(node, 'NUM-INVALID', `${call}: ${names[i]} is ${args[i]}.`, [`pass a finite number for ${names[i]}, e.g. ${node.space === '3d' ? '.at(0, 2, 0)' : '.at(0, 2)'}`])
  if (args.some((x) => typeof x === 'function')) {
    const fns = args.map((x) => (typeof x === 'function' ? (x as () => number) : () => x as number))
    return { placement: { type: 'at', pos: () => [fns[0]!(), fns[1]!(), fns[2] ? fns[2]() : 0] } }
  }
  return { placement: { type: 'at', pos: [args[0] as number, args[1] as number, (args[2] as number | undefined) ?? 0] } }
})

defineSetter('*', 'shift', (node, dx: unknown = 0, dy: unknown = 0, dz: unknown = 0): Patch | null => {
  let d: unknown[] = [dx, dy, dz]
  if (Array.isArray(dx)) d = [dx[0] ?? 0, dx[1] ?? 0, dx[2] ?? 0]
  if (!d.every((x) => typeof x === 'number' && Number.isFinite(x))) return fail(node, d.some((x) => typeof x === 'number') ? 'NUM-INVALID' : 'API-TYPE', `${node.kind}.shift() expects finite numbers, got (${d.map(String).join(', ')}).`, ['.shift(0.5, 0)'])
  const prev = node.model.latest(node, 'shift')
  const base = toVec3(prev) ?? [0, 0, 0]
  return { shift: [base[0] + (d[0] as number), base[1] + (d[1] as number), base[2] + (d[2] as number)] }
})

const ATTACH: Schema = { my: { type: 'string', dynamic: false, example: "my: 'bottom'" }, to: { type: 'string', dynamic: false, example: "to: 'top'" }, gap: { type: 'number', example: 'gap: 0.2' } }
function checkAnchor(node: MNode, of: MNode, name: string, call: string): boolean {
  const frame = node.model.now()
  if (frame.anchorLocal(of, name)) return true
  const names = frame.anchorNames(of)
  const near = closest(name, names)
  fail(node, 'API-UNKNOWN', `${call}: #${of.id} (${of.kind}) has no anchor "${name}".`, [`${near ? `use "${near}". ` : ''}Anchors: ${names.join(', ')}.`])
  return false
}
defineSetter('*', 'attach', (node, target: unknown, opts?: unknown): Patch | null => {
  const call = `${node.kind}.attach()`
  const t = node.model.resolveNode(isAnchorRef(target) ? target.node : target, call)
  if (!t) return null
  if (t === node) return fail(node, 'PLACE-CONFLICT', `${call}: #${node.id} cannot be attached to itself.`, ['attach it to another object'])
  const v = validateOptions(call, opts, ATTACH, undefined, node.model)
  reportProblems(node.model, v.problems, [node.id])
  let to = v.props.to as string | undefined, my = v.props.my as string | undefined
  if (isAnchorRef(target) && !to) to = target.anchor
  if (to && !my) my = oppositeAnchor(to)
  if (my && !to) to = oppositeAnchor(my)
  to ??= 'center'
  my ??= 'center'
  if (!checkAnchor(node, t, to, call)) to = 'center'
  if (!checkAnchor(node, node, my, call)) my = 'center'
  return { placement: { type: 'attach', target: t, my, to, gap: v.props.gap ?? 0 } }
})

defineSetter('*', 'nextTo', (node, target: unknown, dir: unknown = 'right', gap: unknown = 0.25): Patch | null => {
  const call = `${node.kind}.nextTo()`
  let t: unknown = target
  if (!isAnchorRef(target) && typeof target !== 'function' && !toVec3(target)) { t = node.model.resolveNode(target, call); if (!t) return null }
  if (t === node) return fail(node, 'PLACE-CONFLICT', `${call}: #${node.id} cannot be next to itself.`, ['pass another object'])
  const d = parseDir(node, call, dir)
  if (!d) return null
  if (!dynNum(gap) || (typeof gap === 'number' && !Number.isFinite(gap))) return fail(node, typeof gap === 'number' ? 'NUM-INVALID' : 'API-TYPE', `${call}: gap must be a finite number, got ${String(gap)}.`, [".nextTo(target, 'right', 0.25)"])
  return { placement: { type: 'nextTo', target: t, dir: d, gap } }
})

const numSetter = (name: string, example: string, positive = false) =>
  defineSetter('*', name, (node, v: unknown): Patch | null => {
    if (typeof v === 'function') return { [name]: v }
    if (typeof v !== 'number') return fail(node, 'API-TYPE', `${node.kind}.${name}() expects a number, got ${typeof v}.`, [example])
    if (!Number.isFinite(v) || (positive && v <= 0)) return fail(node, 'NUM-INVALID', `${node.kind}.${name}(${v}): must be a finite ${positive ? 'number greater than 0' : 'number'}.`, [example])
    return { [name]: v }
  })
numSetter('scale', '.scale(1.5)', true)
numSetter('opacity', '.opacity(0.5)')
numSetter('z', '.z(1)')

defineSetter('*', 'color', (node, c: unknown): Patch | null => {
  if (typeof c === 'function' || isColor(c)) return { color: c }
  return fail(node, typeof c === 'string' ? 'API-UNKNOWN' : 'API-TYPE', `${node.kind}.color(): ${typeof c === 'string' ? `"${c}"` : String(c)} is not a colour.`, [".color(BLUE)  or  .color('#58C4DD')"])
})

/**
 * m.pin(part, anchor?, { offset? }): sit on a point of another object and follow it. For a 2D object pinned to a 3D
 * part that point is where the anchor is drawn (its projection): the object stays flat and readable, and it is in
 * screen space like m.hud() (the 2D camera does not zoom the 3D panel, so it does not zoom what is pinned to it).
 */
defineSetter('*', 'pin', (node, target: unknown, anchor?: unknown, opts?: unknown): Patch | null => {
  const call = `${node.kind}.pin()`
  if (typeof anchor === 'object' && anchor !== null && opts === undefined) { opts = anchor; anchor = undefined }
  const t = node.model.resolveNode(isAnchorRef(target) ? target.node : target, call)
  if (!t) return null
  if (t === node) return fail(node, 'PLACE-CONFLICT', `${call}: #${node.id} cannot be pinned to itself.`, ['pin it to another object'])
  let name = isAnchorRef(target) ? target.anchor : 'center'
  if (anchor !== undefined) {
    if (typeof anchor !== 'string') return fail(node, 'API-TYPE', `${call}: the anchor must be a name, got ${typeof anchor}.`, [".pin(part, 'top')"])
    name = anchor
  }
  if (!checkAnchor(node, t, name, call)) name = 'center'
  const v = validateOptions(call, opts, { offset: { type: 'vec2', example: 'offset: [0, 0.4]' } }, undefined, node.model)
  reportProblems(node.model, v.problems, [node.id])
  // a flat object on a 3D part is a billboard: it belongs to the 3D panel, which the 2D camera does not zoom
  if (node.space === '2d' && t.space === '3d') node.isHud = true
  return { placement: { type: 'pin', ref: anchorRef(t, name), offset: v.props.offset ?? [0, 0, 0] } }
})

/** m.set({ option: value, … }): change any option of the object's kind; m.to.set({ … }) tweens to it. */
defineSetter('*', 'set', (node, opts: unknown): Patch | null => {
  const kind = kindOf(node.kind)
  if (!kind) return null
  const { id: _id, ...schema } = kind.schema
  const v = validateOptions(`${node.kind}.set()`, opts, schema, kind.aliases, node.model)
  reportProblems(node.model, v.problems, [node.id])
  return Object.keys(v.props).length ? v.props : null
})

// ── methods every node has ───────────────────────────────────────────────────────────────────────────
/** p.anchor('top') → a live point usable wherever a point is expected. */
defineMethod('*', 'anchor', (node: MNode, name: unknown = 'center') => {
  const n = typeof name === 'string' ? name : 'center'
  if (!checkAnchor(node, node, n, `${node.kind}.anchor()`)) return anchorRef(node, 'center')
  return anchorRef(node, n)
})
/** m.hud(): a 2D object in screen space. The 2D camera (st.zoom) does not move or scale it; titles and readouts stay put. */
defineMethod('2d', 'hud', (node: MNode) => { node.isHud = true; node.model.revision++; return node })
/** p.world('top') → [x, y, z] in the state being evaluated. */
defineMethod('*', 'world', (node: MNode, name: unknown = 'center') => node.model.now().anchor(node, typeof name === 'string' ? name : 'center'))
/** p.define('pin', [x, y, z]) → adds a named local point. */
defineMethod('*', 'define', (node: MNode, name: unknown, p: unknown) => {
  if (typeof name !== 'string' || !name) { fail(node, 'API-TYPE', `${node.kind}.define() needs a name.`, [".define('pin', [0, 1, 0])"]); return node }
  if (typeof p !== 'function' && !(toVec3(p)?.every(Number.isFinite))) { fail(node, 'API-TYPE', `${node.kind}.define("${name}") needs a local point.`, [`.define('${name}', [0, 1, 0])`]); return node }
  node.anchors[name] = p as Vec3
  return node
})
export { ANCHOR_NAMES }
