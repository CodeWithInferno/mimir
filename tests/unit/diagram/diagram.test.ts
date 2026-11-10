// Pure side of the diagram module: nodes, edges, graphs, tokens, sequences. No DOM. The layout engine and the
// simulation are in the lazy chunk, which these tests import the way the runtime loads it.
import { describe, expect, test } from 'bun:test'
import { compile, kindOf, scene, type Handle, type MNode, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import { DIAGRAM_DEFAULTS as D, edge, edgeCurve, graph, graphGeom, node, nodeGeom, queue, seatLocal, sequence, slotLocal, slots, streamAt, timer, token, tokens, actorGapFor } from '../../../src/diagram/index.ts'
import { flattenPath, measurePath, pointAt } from '../../../src/lib/path/index.ts'
import '../../../src/diagram/diagram.chunk.ts'

const build = (fn: (s: any) => void): SceneModel => compile(scene({ title: 'diagram' }, fn))
const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)
const size = (m: SceneModel, n: MNode, tau = 0): [number, number] => { const b = m.state(tau).localBounds(n); return [b.max[0] - b.min[0], b.max[1] - b.min[1]] }
/** distance from a point to a closed outline given in frame coordinates */
const toOutline = (m: SceneModel, n: MNode, p: readonly number[], tau = 0): number => {
  let best = Infinity
  for (const poly of flattenPath(m.state(tau).outline(n), 0.002)) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i]!, b = poly[i + 1]!
    const ex = b[0] - a[0], ey = b[1] - a[1]
    const u = Math.max(0, Math.min(1, ((p[0]! - a[0]) * ex + (p[1]! - a[1]) * ey) / (ex * ex + ey * ey || 1)))
    best = Math.min(best, Math.hypot(a[0] + ex * u - p[0]!, a[1] + ey * u - p[1]!))
  }
  return best
}

describe('node', () => {
  test('every shape has a size, an outline that closes, and stable part ids', () => {
    const made: Record<string, Handle> = {}
    const m = build(() => { for (const shape of ['box', 'pill', 'circle', 'cylinder', 'queue', 'ring']) made[shape] = node(shape, { id: shape, shape }) })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    for (const [shape, n] of Object.entries(made)) {
      const [w, h] = size(m, n)
      expect(w).toBeGreaterThan(0.5)
      expect(h).toBeGreaterThan(0.5)
      const outline = kindOf('node')!.outline!(n, f.props(n), f)
      expect(outline.length).toBe(1)
      expect(outline[0]!.closed).toBe(true)
      expect(m.byId.get(`${shape}.label`)?.kind).toBe('text')
    }
    expect(size(m, made.circle!)[0]).toBeCloseTo(size(m, made.circle!)[1], 12)
    // a cylinder holds its label, so it is at least as wide as the label needs
    expect(size(m, made.cylinder!)[0]).toBeGreaterThan(D.cylinderWidth)
    expect(size(m, made.cylinder!)[1]).toBe(D.cylinderHeight)
  })
  test('a box grows with its label; a count moves the label outside and sits in the middle', () => {
    let short: Handle, long: Handle, counted: Handle
    const m = build(() => { short = node('db'); long = node('authentication service'); counted = node('client', { count: 14 }) })
    expect(size(m, long!)[0]).toBeGreaterThan(size(m, short!)[0] + 1)
    const f = m.state(0)
    expect(nodeGeom(short!, f).labelAt).toBe('inside')
    const g = nodeGeom(counted!, f)
    expect(g.labelAt).toBe('below')
    expect(g.countAt).toBe('center')
    expect(g.label[1]).toBeLessThan(-g.height / 2)
    expect(f.prop(m.byId.get(`${counted!.id}.count`)!, 'text')).toBe('14')
    // the label is outside the outline, so a token may rest in the middle only when no count is there
    expect(seatLocal(g)).toBeNull()
    expect(seatLocal(nodeGeom(short!, f))).toBeNull()
  })
  test('a queue has its slots in a row, head on the right; a ring and a circle seat a token in the middle', () => {
    let q: Handle, r: Handle
    const m = build(() => { q = queue({ slots: 8, label: 'queue', filled: 3 }); r = node('worker', { shape: 'ring' }) })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const g = nodeGeom(q!, f)
    expect(g.slots).toBe(8)
    expect(slotLocal(g, 0)[0]).toBeGreaterThan(slotLocal(g, 7)[0])
    expect(slotLocal(g, 0)[0] - slotLocal(g, 1)[0]).toBeCloseTo(D.slotPitch, 12)
    expect(Math.abs(slotLocal(g, 0)[0]) + D.slotRadius).toBeLessThan(g.width / 2)
    expect(f.anchor(q!, 'head')[0]).toBeCloseTo(slotLocal(g, 0)[0], 12)
    expect(g.labelAt).toBe('above')
    expect(seatLocal(nodeGeom(r!, f))).toEqual([0, 0])
    expect(q!.kind).toBe('node')
  })
  test('setters: state, count, down, progress, filled; as tweens too', () => {
    let n: Handle
    const m = build((s) => {
      n = node('worker', { shape: 'ring' })
      s.step('work', (st: any) => { st.play(n.to.progress(1), { duration: 2, rate: (t: number) => t }); n.state('failed'); st.wait(1) })
    })
    expect(codes(m)).toEqual([])
    expect(m.state(0).prop(n!, 'progress')).toBe(0)
    expect(m.state(1).prop(n!, 'progress')).toBeCloseTo(0.5, 9)
    expect(m.state(1.9).prop(n!, 'state')).toBeNull()
    expect(m.state(2.1).prop(n!, 'state')).toBe('failed')
  })
  test('a failure flashes by itself: a pure function of the time since the state changed', async () => {
    const { flashOf } = await import('../../../src/diagram/index.ts')
    let n: Handle
    const m = build((s) => {
      n = node('worker')
      s.step('fail', (st: any) => { st.wait(1); n.state('failed'); st.wait(2) })
    })
    expect(flashOf(n!, m.state(0.9))).toBeNull()
    expect(flashOf(n!, m.state(1 + D.flashSeconds / 2))).toBeCloseTo(0.5, 9)
    expect(flashOf(n!, m.state(1 + D.flashSeconds + 0.01))).toBeNull()
    // asked in another order, the answers are the same
    expect(flashOf(n!, m.state(1 + D.flashSeconds / 2))).toBeCloseTo(0.5, 9)
  })
  test('bad input is reported with the scene line and still gives a node', () => {
    let a: Handle, b: Handle, c: Handle
    const m = build(() => {
      a = node('x', { shape: 'hexagon' })
      b = node('y', { colour: 'red' })
      c = node('z', { width: -1 })
      a.state(7)
      queue('eight')
    })
    expect(codes(m)).toEqual(['API-UNKNOWN', 'API-UNKNOWN', 'NUM-INVALID', 'NUM-INVALID', 'API-TYPE'])
    expect(m.diagnostics.list[0]!.fix.join(' ')).toContain('box')
    expect(m.diagnostics.list[1]!.fix.join(' ')).toContain('color')
    for (const n of [a!, b!, c!]) { expect(n.invalid).toBe(true); expect(size(m, n)[0]).toBeGreaterThan(0) }
    for (const d of m.diagnostics.list) expect(d.line).not.toBeNull()
  })
})

describe('edge', () => {
  test('ends on the outlines of the two nodes; an anchor or a point is used exactly', () => {
    let a: Handle, b: Handle, e: Handle, p: Handle
    const m = build(() => {
      a = node('a', { shape: 'circle' }).at(-2, 0)
      b = node('b').at(2, 1)
      e = edge(a, b)
      p = edge(a.right, [3, -2])
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const c = edgeCurve(e!, f)
    expect(toOutline(m, a!, [c[0]!, c[1]!])).toBeLessThan(D.edgeBuff + 0.01)
    expect(toOutline(m, b!, [c[6]!, c[7]!])).toBeLessThan(D.edgeBuff + 0.01)
    expect(Math.hypot(c[0]!, c[1]!) ).toBeGreaterThan(0) // not at a's centre (-2, 0) … and outside its circle:
    expect(Math.hypot(c[0]! + 2, c[1]!)).toBeGreaterThanOrEqual(nodeGeom(a!, f).width / 2 - 1e-9)
    const q = edgeCurve(p!, f)
    expect([q[0], q[1]]).toEqual([f.anchor(a!, 'right')[0], f.anchor(a!, 'right')[1]])
    expect([q[6], q[7]]).toEqual([3, -2])
    expect(f.anchor(e!, 'start')[0]).toBeCloseTo(c[0]!, 12)
    expect(f.anchor(e!, 'end')[1]).toBeCloseTo(c[7]!, 12)
  })
  test('a bend makes a curve; a label is a part that sits beside the middle, clear of the line', () => {
    let e: Handle, a: Handle, b: Handle
    const m = build(() => { a = node('a').at(-2, 0); b = node('b').at(2, 0); e = edge(a, b, { bend: 40, label: 'retry', dashed: true }) })
    const f = m.state(0)
    const mid = pointAt(measurePath(f.outline(e!)), 0.5).point
    expect(Math.abs(mid[1])).toBeGreaterThan(0.2)
    const label = m.byId.get(`${e!.id}.label`)!
    expect(label.kind).toBe('text')
    const lb = f.bounds(label)
    // the label's box does not contain the middle of the line
    expect(mid[1] < lb.min[1] || mid[1] > lb.max[1]).toBe(true)
    expect(Math.abs((lb.min[0] + lb.max[0]) / 2 - mid[0])).toBeLessThan(0.05)
  })
  test('pointAt walks the edge: tokens ride on it', () => {
    let e: Handle, t: Handle
    const m = build((s) => {
      const u = s.param('u', { value: 0.25, min: 0, max: 1 })
      e = edge([-3, 0], [3, 0])
      t = token({ on: e, at: u, label: 'job' })
    })
    expect(codes(m)).toEqual([])
    const b = m.state(0).bounds(t!)
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(-1.5, 9)
    const b2 = m.state(0, { u: 1 }).bounds(t!)
    expect((b2.min[0] + b2.max[0]) / 2).toBeCloseTo(3, 9)
    const rects = m.state(0).textRects(t!)
    expect(rects[0]!.text).toBe('job')
    expect(rects[0]!.rect.y).toBeGreaterThan(D.tokenRadius)
  })
})

describe('graph', () => {
  const pipeline = () => graph({
    nodes: { producer: 'producer', queue: { shape: 'queue', slots: 8 }, a: { label: 'worker', shape: 'ring' }, b: { label: 'worker', shape: 'ring' }, db: { label: 'database', shape: 'cylinder' } },
    edges: [['producer', 'queue'], ['queue', 'a'], ['queue', 'b'], ['a', 'db'], ['b', 'db']],
  })
  test('lays itself out in layers along the flow, centred, with no overlap and no crossing', () => {
    let g: Handle
    const m = build(() => { g = pipeline() })
    expect(codes(m)).toEqual([])
    expect(slots.layout).toBeDefined()
    const f = m.state(0)
    const x = (id: string): number => f.anchor(g.nodes[id], 'center')[0], y = (id: string): number => f.anchor(g.nodes[id], 'center')[1]
    expect(x('producer')).toBeLessThan(x('queue'))
    expect(x('queue')).toBeLessThan(x('a'))
    expect(x('a')).toBeCloseTo(x('b'), 9)
    expect(x('a')).toBeLessThan(x('db'))
    expect(y('a')).toBeGreaterThan(y('b'))
    expect(y('producer')).toBeCloseTo(y('queue'), 9)
    const lay = graphGeom(g!, f)
    expect(lay.crossings).toBe(0)
    expect(lay.scale).toBe(1)
    // boxes of the nodes (with their labels) do not overlap
    const ids = Object.keys(g!.nodes)
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = f.bounds(g!.nodes[ids[i]!]), q = f.bounds(g!.nodes[ids[j]!])
      expect(p.max[0] <= q.min[0] || q.max[0] <= p.min[0] || p.max[1] <= q.min[1] || q.max[1] <= p.min[1]).toBe(true)
    }
    const all = f.bounds(g!)
    expect((all.min[0] + all.max[0]) / 2).toBeCloseTo(0, 1)
  })
  test('every edge starts on the outline of its source and ends a tip gap before the outline of its target', () => {
    let g: Handle
    const m = build(() => { g = pipeline().at(1, 0.5) })
    const f = m.state(0)
    for (const e of g!.edges as MNode[]) {
      const c = edgeCurve(e, f), n = c.length
      const [from, to] = [e.props.a as MNode, e.props.b as MNode]
      expect(toOutline(m, from, [c[0]!, c[1]!])).toBeLessThan(0.012)
      expect(toOutline(m, to, [c[n - 2]!, c[n - 1]!])).toBeLessThan(D.edgeBuff + 0.012)
      expect(toOutline(m, to, [c[n - 2]!, c[n - 1]!])).toBeGreaterThan(D.edgeBuff - 0.012)
      // and it runs between them: no point of the route is inside either node's box
      const fb = f.bounds(from), tb = f.bounds(to)
      const path = measurePath(f.outline(e))
      for (let u = 0.1; u < 0.95; u += 0.1) {
        const p = pointAt(path, u).point
        const inside = (b: typeof fb): boolean => p[0] > b.min[0] + 0.02 && p[0] < b.max[0] - 0.02 && p[1] > b.min[1] + 0.02 && p[1] < b.max[1] - 0.02
        expect(inside(fb) || inside(tb)).toBe(false)
      }
    }
    expect(g!.edge('queue', 'a').id).toBe('queue-a')
    expect(g!.node('db')).toBe(g!.nodes.db)
  })
  test('direction down; node ids are the names; the graph moves as one', () => {
    let g: Handle
    const m = build(() => { g = graph({ nodes: { a: 'A', b: 'B', c: { label: 'worker', shape: 'ring' } }, edges: [['a', 'b'], ['a', 'c']], direction: 'down' }).at(2, 1) })
    const f = m.state(0)
    // edges arrive from above in a graph that flows down, so a label that would sit above goes beside its node
    expect(nodeGeom(g!.nodes.c, f).labelAt).toBe('right')
    expect(f.anchor(g!.nodes.a, 'center')[1]).toBeGreaterThan(f.anchor(g!.nodes.b, 'center')[1])
    expect(f.anchor(g!.nodes.b, 'center')[1]).toBeCloseTo(f.anchor(g!.nodes.c, 'center')[1], 9)
    expect(m.byId.get('a')).toBe(g!.nodes.a)
    // what is drawn (the nodes with their labels) is centred on the graph's position
    const boxes = m.nodes.filter((n) => n.kind === 'node' || (n.kind === 'text' && n.parent?.kind === 'node')).map((n) => f.bounds(n))
    const lo = (i: number): number => Math.min(...boxes.map((b) => b.min[i]!)), hi = (i: number): number => Math.max(...boxes.map((b) => b.max[i]!))
    expect((lo(0) + hi(0)) / 2).toBeCloseTo(2, 6)
    expect((lo(1) + hi(1)) / 2).toBeCloseTo(1, 6)
  })
  test('a graph too large for its box is squeezed, then shrunk as a whole', () => {
    let g: Handle
    const names = Array.from({ length: 14 }, (_, i) => `service ${i + 1}`)
    const m = build(() => { g = graph({ nodes: Object.fromEntries(names.map((n, i) => [`n${i}`, n])), edges: names.slice(1).map((_, i) => [`n${i}`, `n${i + 1}`]) }) })
    const f = m.state(0)
    const lay = graphGeom(g!, f)
    expect(lay.scale).toBeLessThan(1)
    const all = f.bounds(g!)
    expect(all.max[0] - all.min[0]).toBeLessThanOrEqual(D.graphWidth + 0.05)
    expect(all.max[1] - all.min[1]).toBeLessThanOrEqual(D.graphHeight + 0.05)
  })
  test('draw() enters nodes and edges along the flow: sources first, an edge after the node it leaves', () => {
    let g: Handle
    const m = build((s) => { g = pipeline(); s.step('draw', (st: any) => { st.play(g.draw()) }) })
    expect(codes(m)).toEqual([])
    const enters = (n: MNode): number => m.clipsFor(n, 'present')![0]!.t0
    expect(enters(g!.nodes.producer)).toBe(0)
    expect(enters(g!.edge('producer', 'queue'))).toBeGreaterThan(enters(g!.nodes.producer))
    expect(enters(g!.nodes.queue)).toBeGreaterThan(enters(g!.nodes.producer))
    expect(enters(g!.nodes.db)).toBeGreaterThan(enters(g!.nodes.a))
    expect(m.state(0).reveal(g!.nodes.db).p).toBe(0)
    expect(m.state(m.duration).reveal(g!.nodes.db).p).toBe(1)
    // the label is a part: it comes with its node
    expect(m.state(0).reveal(m.byId.get('db.label')!).p).toBe(0)
  })
  test('the layout is the same whatever was asked first, and is kept per input', () => {
    let g: Handle
    const m = build(() => { g = pipeline() })
    const a = m.state(3), b = m.state(1)
    const pa = a.anchor(g!.nodes.db, 'center'), pb = b.anchor(g!.nodes.db, 'center')
    expect(pa).toEqual(pb)
    expect(graphGeom(g!, a)).toBe(graphGeom(g!, b))
  })
  test('groups: a box round its nodes and their labels, with its own label on top; drawn last; a wrong name is reported', async () => {
    const { clusterBox } = await import('../../../src/diagram/index.ts')
    let g: Handle
    const m = build((s) => {
      g = graph({
        nodes: { api: 'API', a: { label: 'worker', shape: 'ring' }, b: { label: 'worker', shape: 'ring' }, db: { label: 'db', shape: 'cylinder' } },
        edges: [['api', 'a'], ['api', 'b'], ['a', 'db'], ['b', 'db']],
        groups: { workers: ['a', 'b'], stores: { label: 'data', nodes: ['db', 'nope'] } },
      })
      s.step('draw', (st: any) => { st.play(g.draw()) })
    })
    expect(codes(m)).toEqual(['REF-MISSING'])
    const f = m.state(m.duration)
    const box = clusterBox(g!.groups.workers, f)
    for (const id of ['a', 'b', 'a.label', 'b.label']) {
      const b = f.bounds(m.byId.get(id)!)
      expect(b.min[0]).toBeGreaterThan(box.min[0]); expect(b.max[0]).toBeLessThan(box.max[0])
      expect(b.min[1]).toBeGreaterThan(box.min[1]); expect(b.max[1]).toBeLessThan(box.max[1])
    }
    // its label is a part, inside the box, above the nodes
    const label = f.bounds(m.byId.get('workers.label')!)
    expect(label.max[1]).toBeLessThan(box.max[1])
    expect(label.min[1]).toBeGreaterThan(f.bounds(m.byId.get('a.label')!).max[1])
    // the api node is outside it
    expect(f.bounds(g!.nodes.api).max[0]).toBeLessThan(box.min[0])
    expect(g!.groups.stores.kind).toBe('cluster')
    const enters = (n: MNode): number => m.clipsFor(n, 'present')![0]!.t0
    expect(enters(g!.groups.workers)).toBeGreaterThan(enters(g!.nodes.db))
  })
  test('bad input: an edge to a node that is not there, nodes that are not an object', () => {
    const m = build(() => {
      const g = graph({ nodes: { api: 'API', db: 'db' }, edges: [['api', 'dbb'], ['api'], ['api', 'db']] })
      g.edge('db', 'api')
      graph({ nodes: 5 })
      graph('x')
    })
    expect(codes(m)).toEqual(['REF-MISSING', 'API-TYPE', 'REF-MISSING', 'API-TYPE', 'API-TYPE'])
    expect(m.diagnostics.list[0]!.fix[0]).toContain('"db"')
    expect(m.byId.get('api-db')?.kind).toBe('edge')
  })
})

describe('tokens and timer', () => {
  test('a stream: evenly spaced, moving with time at a speed in units per second, fading at both ends', () => {
    const at = (time: number) => streamAt({ count: 4, speed: 2, phase: 0, active: true, time }, 4)
    const a = at(0), b = at(0.5)
    expect(a.map((s) => s.u)).toEqual([0, 0.25, 0.5, 0.75])
    expect(b[1]!.u).toBeCloseTo(0.5, 12) // 2 units per second on an edge 4 long: a quarter of it in half a second
    expect(a[0]!.alpha).toBe(0)
    expect(a[2]!.alpha).toBe(1)
    expect(streamAt({ count: 4, speed: 2, phase: 0, active: false, time: 0 }, 4).every((s) => s.alpha === 0)).toBe(true)
    expect(streamAt({ count: 3, speed: 1, phase: 0.1, active: 0.5, time: 0 }, 2)[1]!.alpha).toBe(0.5)
  })
  test('tokens() and timer() are kinds with bounds; tokens without an edge are reported', () => {
    let s1: Handle, t1: Handle
    const m = build(() => {
      const e = edge([-2, 0], [2, 0])
      s1 = tokens(e, { count: 5 })
      t1 = timer(0.4, { radius: 0.3 })
      tokens(undefined as any)
      token({ at: 0.5 } as any)
    })
    expect(codes(m).sort()).toEqual(['API-TYPE', 'API-TYPE', 'REF-MISSING'].sort())
    const f = m.state(0)
    expect(f.bounds(s1!).max[0]).toBeCloseTo(2 + D.tokenRadius, 9)
    expect(size(m, t1!)).toEqual([0.6, 0.6])
    expect(f.prop(s1!, 'time')).toBe(0)
  })
})

describe('sequence', () => {
  test('lifelines side by side, messages top to bottom, drawn in order', () => {
    let q: Handle
    const m = build((s) => {
      q = sequence({ actors: ['client', 'server', 'database'], messages: [['client', 'server', 'GET /cart'], ['server', 'database', 'query'], ['database', 'server', 'rows', { dashed: true }], ['server', 'client', '200']] }).at(0, 0.5)
      s.step('talk', (st: any) => { st.play(q.draw()) })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(m.duration)
    const x = (id: string): number => f.anchor(q!.actors[id], 'center')[0]
    expect(x('client')).toBeLessThan(x('server'))
    expect(x('server') - x('client')).toBeCloseTo(actorGapFor(3), 9)
    expect(actorGapFor(2)).toBe(D.actorGapMax)
    expect(actorGapFor(3)).toBeCloseTo(D.sequenceSpan / 2, 9)
    expect(actorGapFor(6)).toBe(D.actorGap)
    const ys = (q!.messages as MNode[]).map((e) => edgeCurve(e, f)[1]!)
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]!)
    // each message runs between the two lifelines it names
    const first = edgeCurve(q!.messages[0], f)
    expect(first[0]).toBeCloseTo(x('client'), 9)
    expect(first[6]).toBeCloseTo(x('server'), 9)
    const back = edgeCurve(q!.messages[2], f)
    expect(back[0]).toBeCloseTo(x('database'), 9)
    // in order: each arrow enters after the one before
    const enters = (q!.messages as MNode[]).map((e) => m.clipsFor(e, 'present')![0]!.t0)
    for (let i = 1; i < enters.length; i++) expect(enters[i]!).toBeGreaterThan(enters[i - 1]!)
    expect(m.state(0).reveal(q!.messages[3]).p).toBe(0)
    expect(m.byId.get(`${q!.id}.m1.label`)?.kind).toBe('text')
  })
  test('shown draws messages part of the way; an unknown actor is reported', () => {
    let q: Handle
    const m = build(() => {
      q = sequence({ actors: ['a', 'b'], messages: [['a', 'b', 'one'], ['b', 'a', 'two'], ['a', 'c', 'three']], shown: 1.5 })
    })
    expect(codes(m)).toEqual(['REF-MISSING'])
    const f = m.state(0)
    expect(f.prop(q!.messages[0], 'drawn')).toBe(1)
    expect(f.prop(q!.messages[1], 'drawn')).toBe(0.5)
    expect(q!.messages.length).toBe(2)
  })
})
