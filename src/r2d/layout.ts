// Layout of 2D objects: the containers grid() and ring(), and the placements m.toEdge(), m.alignTo() and m.fit().
// The arithmetic is src/lib/layout (arrangeGrid, arrangeRing, fitInto); this file turns boxes of nodes into its sizes
// and its centres back into positions. Everything is resolved per frame, so a layout follows tweens and params.
import {
  apply, boxSize, ctx, defineKind, definePlacement, defineSetter, FRAME_H, FRAME_W, isAnchorRef, isNode, parseDir, placementResolver, qmul, TID, toVec3, transformBox, validateOptions, reportProblems,
  type Box3, type Frame, type MNode, type OwnTransform, type Patch, type Placed, type Placement, type Vec3,
} from '../core/index.ts'
import { arrangeGrid, arrangeRing, fitInto } from '../lib/layout/index.ts'

/** Defaults of the layout operations, in frame units. */
export const LAYOUT = {
  /** space between the cells of a grid */
  gridGap: 0.5,
  /** space kept between neighbours on a ring whose radius is worked out */
  ringGap: 0.25,
  /** distance from the edge of the frame for m.toEdge (manim: 0.5) */
  edgeGap: 0.5,
}

// ── containers ───────────────────────────────────────────────────────────────────────────────────────
const adopt = (node: MNode, name: string): MNode[] => {
  const kids = (node.props.children as MNode[] | undefined) ?? []
  delete node.props.children
  kids.forEach((c, index) => {
    node.model.adopt(node, c)
    if (c.placement) node.model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [c.id], what: `#${c.id} already has a placement (${c.placement.type}) and is also an item of ${name}(); the ${name} decides where it goes.`, fix: [`remove the .${c.placement.type === 'at' ? 'at' : c.placement.type}() call on #${c.id}`] }, node.src)
    c.placement = { type: 'arrange', container: node, index }
  })
  return kids
}
/** Where the items of a grid / ring go, memoised per frame: child uid → position in the container's space. */
function arrangement(container: MNode, frame: Frame): Map<number, Vec3> {
  return frame.memo('arrange' + container.uid, () => {
    const out = new Map<number, Vec3>()
    const items = container.children.filter((c) => c.placement?.type === 'arrange')
    // the box of every item around its own origin, with its own turn and scale
    const boxes = items.map((c) => transformBox(frame.localBounds(c), { p: [0, 0, 0], q: frame.ownRotation(c), s: frame.ownScale(c) }))
    const sizes = boxes.map((b) => { const s = boxSize(b); return { width: s[0], height: s[1] } })
    const r = frame.props(container)
    const done = container.kind === 'ring'
      ? arrangeRing(sizes, { radius: typeof r.radius === 'number' ? r.radius : undefined, gap: r.gap, startAngle: r.startAngle, clockwise: r.clockwise !== false })
      : arrangeGrid(sizes, { cols: r.columns ?? undefined, gap: r.gap, align: r.align })
    items.forEach((c, i) => {
      const b = boxes[i]!, at = done.positions[i] ?? [0, 0]
      // the library places the CENTRE of each box; an item's origin is not always the centre of its box
      out.set(c.uid, [at[0] - (b.min[0] + b.max[0]) / 2, at[1] - (b.min[1] + b.max[1]) / 2, 0])
    })
    return out
  }, new Map<number, Vec3>())
}
definePlacement('arrange', (node, pl, frame) => ({ p: arrangement(pl.container as MNode, frame).get(node.uid) ?? [0, 0, 0] }))

export const grid = defineKind({
  name: 'grid', space: '2d', container: true, positional: ['children'],
  aliases: { cols: 'columns' },
  schema: {
    children: { type: 'nodes', default: [], example: 'grid([a, b, c, d], { columns: 2 })' },
    columns: { type: 'int', nullable: true, default: null, example: 'columns: 3' },
    gap: { type: 'nonneg', default: LAYOUT.gridGap },
    align: { type: ['center', 'left', 'right', 'top', 'bottom'], default: 'center' },
  },
  init: (node) => { adopt(node, 'grid') },
})
export const ring = defineKind({
  name: 'ring', space: '2d', container: true, positional: ['children'],
  schema: {
    children: { type: 'nodes', default: [], example: 'ring([a, b, c, d, e], { radius: 2 })' },
    radius: { type: 'positive', nullable: true, default: null, example: 'radius: 2' },
    gap: { type: 'nonneg', default: LAYOUT.ringGap },
    startAngle: { type: 'number', default: 90, example: 'startAngle: 90' },
    clockwise: { type: 'boolean', default: true },
  },
  init: (node) => { adopt(node, 'ring') },
})

// ── m.toEdge(dir, gap) and m.alignTo(target, dir) ────────────────────────────────────────────────────
// Both move an object along one axis (two for a corner) until an edge of its box lines up with an edge of something
// else, and leave the other axis to the placement the object already has: label.nextTo(box, 'down').alignTo(box, 'left').
const fail = (node: MNode, code: string, what: string, fix: string[]): null => { node.model.diagnostics.add({ code, ids: [node.id], what, fix }); return null }
/** x, y, width, height (the min corner, y up): what s.area() and s.viewport() return */
const rectOf = (v: unknown): Box3 | null => {
  if (typeof v !== 'object' || v === null || isNode(v) || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (![o.x, o.y, o.width, o.height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return { min: [o.x as number, o.y as number, 0], max: [(o.x as number) + (o.width as number), (o.y as number) + (o.height as number), 0] }
}
/** the placement an object has now (the last one recorded), and whether a change made now is a change of its base state */
function current(node: MNode): { prev: Placement | null; base: boolean } {
  const st = ctx.step
  return { prev: (node.model.latest(node, 'placement') as Placement | null) ?? null, base: !st || (node.createdStep === st.index && node.createdAt === st.t0 + st.cursor) }
}
/** what a placement refers to, so that the core sees an object that follows something on screen (a 3D part, a hud object) */
const refsOf = (pl: Placement | null): unknown[] => (pl ? ['pos', 'ref', 'target', 'a', 'b'].map((k) => pl[k]).filter((v) => v !== undefined && v !== null).flat() : [])
/**
 * Wrap the placement the object has in an 'edge' placement. Outside a step (or on an object made this instant) the
 * object's base placement is replaced in place: it is still one placement, so no PLACE-CONFLICT. Inside a step the
 * wrapped placement is returned as a patch, and the object moves there (m.to.alignTo(…) tweens).
 */
function wrap(node: MNode, edge: Placement): Patch | null {
  const { prev, base } = current(node)
  const next: Placement = { ...edge, type: 'edge', inner: prev, ref: refsOf(prev) }
  if (base && node.placement) { node.placement = next; node.model.revision++; return null }
  return { placement: next }
}
function resolveInner(node: MNode, inner: Placement | null, frame: Frame, own: OwnTransform): Placed {
  const r = inner ? placementResolver(inner.type)?.(node, inner, frame, own) : undefined
  if (!r) return { p: [0, 0, 0], world: !node.parent }
  if (r.world || !node.parent) return { ...r, world: true }
  return { ...r, p: apply(frame.world(node.parent), r.p), world: true }
}
definePlacement('edge', (node, pl, frame, own) => {
  const at = resolveInner(node, (pl.inner as Placement | null) ?? null, frame, own)
  const p: Vec3 = at.world ? [...at.p] as Vec3 : apply(node.parent ? frame.world(node.parent) : TID, at.p)
  const mine = transformBox(frame.localBounds(node), { p, q: at.q ?? qmul(own.parentQ, own.q), s: own.parentS * own.s })
  const gap = frame.value<number>(pl.gap, 0, node, 'toEdge gap') || 0
  const to = pl.target
  let box: Box3
  if (to === undefined || to === null) box = { min: [-FRAME_W / 2 + gap, -FRAME_H / 2 + gap, 0], max: [FRAME_W / 2 - gap, FRAME_H / 2 - gap, 0] }
  else if (isNode(to)) box = frame.boxIn(node, to)
  else {
    const rect = rectOf(to)
    if (rect) box = rect
    else { const q = frame.point(to, node); box = { min: [...q] as Vec3, max: [...q] as Vec3 } }
  }
  const dir = pl.dir as Vec3
  for (const i of [0, 1] as const) {
    if (dir[i] > 0) p[i] += box.max[i] - mine.max[i]
    else if (dir[i] < 0) p[i] += box.min[i] - mine.min[i]
  }
  return { p, q: at.q, world: true }
})
defineSetter('2d', 'toEdge', (node, dir: unknown = 'up', gap: unknown = LAYOUT.edgeGap): Patch | null => {
  const call = `${node.kind}.toEdge()`
  const d = parseDir(node, call, dir)
  if (!d) return null
  if (typeof gap !== 'function' && !(typeof gap === 'number' && Number.isFinite(gap))) return fail(node, typeof gap === 'number' ? 'NUM-INVALID' : 'API-TYPE', `${call}: gap must be a finite number, got ${String(gap)}.`, [".toEdge('up', 0.5)"])
  return wrap(node, { type: 'edge', dir: d, gap })
})
defineSetter('2d', 'alignTo', (node, target: unknown, dir: unknown = 'left'): Patch | null => {
  const call = `${node.kind}.alignTo()`
  let t: unknown = target
  if (!isAnchorRef(target) && typeof target !== 'function' && !toVec3(target) && !rectOf(target)) { t = node.model.resolveNode(target, call); if (!t) return null }
  if (t === node) return fail(node, 'PLACE-CONFLICT', `${call}: #${node.id} cannot be aligned to itself.`, ['pass another object'])
  const d = parseDir(node, call, dir)
  if (!d) return null
  return wrap(node, { type: 'edge', target: t, dir: d, gap: 0 })
})

// ── m.fit(rect) ──────────────────────────────────────────────────────────────────────────────────────
interface FitResult { scale: number; p: Vec3 }
function fitOf(node: MNode, pl: Placement, frame: Frame): FitResult {
  return frame.memo('fit' + node.uid, () => {
    const to = pl.target
    const box = isNode(to) ? frame.boxIn(node, to) : rectOf(to)
    const b = frame.localBounds(node)
    const size = boxSize(b)
    if (!box || !(size[0] > 0 || size[1] > 0)) return { scale: 1, p: box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, 0] : [0, 0, 0] }
    const padding = frame.value<number>(pl.padding, 0, node, 'fit padding') || 0
    const f = fitInto({ x: box.min[0], y: box.min[1], width: box.max[0] - box.min[0], height: box.max[1] - box.min[1] }, { x: b.min[0], y: b.min[1], width: size[0], height: size[1] }, { padding })
    return { scale: f.scale > 0 ? f.scale : 1, p: [f.offset[0], f.offset[1], 0] }
  }, { scale: 1, p: [0, 0, 0] })
}
definePlacement('fit', (node, pl, frame) => ({ p: fitOf(node, pl, frame).p, world: true }))
defineSetter('2d', 'fit', (node, target: unknown, opts?: unknown): Patch | null => {
  const call = `${node.kind}.fit()`
  let t: unknown = target
  if (!rectOf(target)) { t = node.model.resolveNode(target, call); if (!t) return null }
  if (t === node) return fail(node, 'PLACE-CONFLICT', `${call}: #${node.id} cannot be fitted into itself.`, ["pass a rectangle such as s.area('left'), or another object"])
  const v = validateOptions(call, opts, { padding: { type: 'nonneg', example: 'padding: 0.3' } }, undefined, node.model)
  reportProblems(node.model, v.problems, [node.id])
  const placement: Placement = { type: 'fit', target: t, padding: v.props.padding ?? 0 }
  // the size is part of the fit: the object is scaled (uniformly) to be as large as the rectangle allows
  return { placement, scale: () => fitOf(node, placement, node.model.now()).scale }
})
