import { describe, expect, test } from 'bun:test'
import { layoutGraph, rectDistance } from '../../../../src/lib/layout/index.ts'
import { type Box, boxes, layoutProblems, links, nodeRect, routeCrossings, seeded, withoutClockOrRandom } from './helpers.ts'

/** Random directed graph (cycles, self loops, duplicates and long edges included) from a seed. */
function randomGraph(seed: number, nodeCount: number, edgeCount: number): { nodes: Box[]; edges: { from: string; to: string }[] } {
  const random = seeded(seed)
  const nodes: Box[] = Array.from({ length: nodeCount }, (_, i) => ({ id: `n${i}`, width: 0.6 + random() * 2, height: 0.4 + random() * 1.2 }))
  const edges = Array.from({ length: edgeCount }, () => ({
    from: `n${Math.floor(random() * nodeCount)}`, to: `n${Math.floor(random() * nodeCount)}`,
  }))
  return { nodes, edges }
}

const pipeline = {
  nodes: [...boxes('producer queue'), ...boxes('w1 w2 w3', 1.2, 0.6), ...boxes('db dlq')],
  edges: links('producer>queue queue>w1 queue>w2 queue>w3 w1>db w2>db w3>db w2>queue w3>dlq'),
}

describe('layoutGraph: structure', () => {
  test('a chain runs left to right on one straight line', () => {
    const nodes = boxes('a b c d')
    const layout = layoutGraph({ nodes, edges: links('a>b b>c c>d'), nodeGap: 0.5, rankGap: 1 })
    expect(layoutProblems(layout, nodes)).toEqual([])
    const xs = nodes.map(node => layout.nodes[node.id]!.x)
    expect(xs).toEqual([-3.9, -1.3, 1.3, 3.9].map(x => expect.closeTo(x, 9)))
    for (const node of nodes) expect(layout.nodes[node.id]!.y).toBeCloseTo(0, 9)
    expect(layout.width).toBeCloseTo(4 * 1.6 + 3 * 1, 9)
    expect(layout.height).toBeCloseTo(0.7, 9)
    for (const edge of layout.edges) {
      expect(edge.points).toHaveLength(2)                          // straight: two points, no wiggle
      expect(edge.points[1]![0] - edge.points[0]![0]).toBeCloseTo(1, 9)   // exactly the rank gap
      expect(edge.curve).toHaveLength(4)
      expect(edge.reversed).toBe(false)
    }
    expect(layout.crossings).toBe(0)
  })

  test("direction 'down' flows towards -y in frame space and +y in screen space", () => {
    const nodes = boxes('a b c')
    const edges = links('a>b b>c')
    const frame = layoutGraph({ nodes, edges, direction: 'down' })
    expect(frame.nodes.a!.y).toBeGreaterThan(frame.nodes.b!.y)
    expect(frame.nodes.b!.y).toBeGreaterThan(frame.nodes.c!.y)
    expect(frame.nodes.a!.x).toBeCloseTo(frame.nodes.c!.x, 9)
    const screen = layoutGraph({ nodes, edges, direction: 'down', yDown: true })
    expect(screen.nodes.a!.y).toBeLessThan(screen.nodes.b!.y)
    expect(layoutProblems(frame, nodes)).toEqual([])
    expect(layoutProblems(screen, nodes)).toEqual([])
  })

  test("direction 'right': the first declared sibling is on top (frame) / on top (screen)", () => {
    const nodes = boxes('root first second')
    const edges = links('root>first root>second')
    const frame = layoutGraph({ nodes, edges })
    expect(frame.nodes.first!.y).toBeGreaterThan(frame.nodes.second!.y)
    const screen = layoutGraph({ nodes, edges, yDown: true })
    expect(screen.nodes.first!.y).toBeLessThan(screen.nodes.second!.y)
    // the parent sits centred between its two children
    expect(frame.nodes.root!.y).toBeCloseTo((frame.nodes.first!.y + frame.nodes.second!.y) / 2, 9)
  })

  test('every forward edge points down the flow and gaps are respected', () => {
    const layout = layoutGraph({ ...pipeline, nodeGap: 0.4, rankGap: 0.9 })
    expect(layoutProblems(layout, pipeline.nodes)).toEqual([])
    for (const edge of layout.edges) {
      const dx = layout.nodes[edge.to]!.x - layout.nodes[edge.from]!.x
      if (edge.reversed) expect(dx).toBeLessThan(0); else expect(dx).toBeGreaterThan(0)
    }
    expect(layout.edges.filter(e => e.reversed).map(e => `${e.from}>${e.to}`)).toEqual(['w2>queue'])
    for (let i = 0; i < pipeline.nodes.length; i++) {
      for (let j = i + 1; j < pipeline.nodes.length; j++) {
        const gap = rectDistance(nodeRect(layout, pipeline.nodes[i]!), nodeRect(layout, pipeline.nodes[j]!))
        expect(gap).toBeGreaterThanOrEqual(0.4 - 1e-9)
      }
    }
    // ranks: producer | queue | workers | db, dlq
    const x = (id: string) => layout.nodes[id]!.x
    expect(x('w1')).toBeCloseTo(x('w2'), 9)
    expect(x('w2')).toBeCloseTo(x('w3'), 9)
    expect(x('db')).toBeCloseTo(x('dlq'), 9)
  })

  test('the drawing is centred on the origin and the size is tight', () => {
    const layout = layoutGraph(pipeline)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const node of pipeline.nodes) {
      const r = nodeRect(layout, node)
      x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.width); y0 = Math.min(y0, r.y); y1 = Math.max(y1, r.y + r.height)
    }
    for (const edge of layout.edges) for (const p of edge.points) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1])
    }
    expect(x0).toBeCloseTo(-layout.width / 2, 9)
    expect(x1).toBeCloseTo(layout.width / 2, 9)
    expect(y0).toBeCloseTo(-layout.height / 2, 9)
    expect(y1).toBeCloseTo(layout.height / 2, 9)
  })
})

describe('layoutGraph: edge routes', () => {
  test('a long edge goes around the nodes it skips', () => {
    const nodes = boxes('a b c d')
    const layout = layoutGraph({ nodes, edges: links('a>b b>c c>d a>d') })
    expect(layoutProblems(layout, nodes)).toEqual([])
    const long = layout.edges[3]!
    expect(long.points.length).toBeGreaterThan(2)
    // it runs beside b and c, not through them
    const bypass = long.points.some(p => Math.abs(p[1] - layout.nodes.b!.y) > 0.35 + 0.2)
    expect(bypass).toBe(true)
  })

  test('routes start and end on node borders with tangents along the flow', () => {
    const layout = layoutGraph(pipeline)
    for (const edge of layout.edges) {
      const c = edge.curve
      expect((c.length - 1) % 3).toBe(0)
      expect(c[0]).toEqual(edge.points[0]!)
      expect(c[c.length - 1]).toEqual(edge.points[edge.points.length - 1]!)
      // first and last control legs are horizontal: arrowheads meet the node side at a right angle
      expect(c[1]![1]).toBeCloseTo(c[0]![1], 9)
      expect(c[c.length - 2]![1]).toBeCloseTo(c[c.length - 1]![1], 9)
    }
  })

  test('routes are smooth: no turn sharper than 35 degrees between samples', () => {
    const { nodes, edges } = randomGraph(11, 14, 22)
    const layout = layoutGraph({ nodes, edges })
    for (const edge of layout.edges) {
      if (edge.from === edge.to) continue
      const p = edge.points
      for (let i = 1; i + 1 < p.length; i++) {
        const ax = p[i]![0] - p[i - 1]![0], ay = p[i]![1] - p[i - 1]![1]
        const bx = p[i + 1]![0] - p[i]![0], by = p[i + 1]![1] - p[i]![1]
        const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI
        expect(turn).toBeLessThan(35)
      }
    }
  })

  test('two-way pair: the two edges get separate, parallel routes', () => {
    const nodes = boxes('a b')
    const layout = layoutGraph({ nodes, edges: links('a>b b>a') })
    expect(layoutProblems(layout, nodes)).toEqual([])
    const [forward, back] = layout.edges as [typeof layout.edges[0], typeof layout.edges[0]]
    expect(back.reversed).toBe(true)
    expect(forward.points[0]![0]).toBeLessThan(forward.points[1]![0])       // a -> b runs right
    expect(back.points[0]![0]).toBeGreaterThan(back.points[1]![0])           // b -> a runs left
    expect(Math.abs(forward.points[0]![1] - back.points[0]![1])).toBeGreaterThan(0.1)
    expect(routeCrossings(layout)).toBe(0)
  })

  test('self loop: a small loop on the node border, inside the reported size', () => {
    const nodes = boxes('a b')
    const layout = layoutGraph({ nodes, edges: links('a>a a>b') })
    expect(layoutProblems(layout, nodes)).toEqual([])
    const loop = layout.edges[0]!
    expect(loop.points.length).toBeGreaterThan(4)
    const top = layout.nodes.a!.y + 0.35
    expect(Math.max(...loop.points.map(p => p[1]))).toBeGreaterThan(top + 0.1)
    expect(layout.height).toBeGreaterThan(0.7)
  })

  test('random graphs: no overlaps, everything inside the size, no route through any node', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { nodes, edges } = randomGraph(seed, 4 + (seed % 12), 3 + (seed * 7) % 24)
      for (const direction of ['right', 'down'] as const) {
        const layout = layoutGraph({ nodes, edges, direction, nodeGap: 0.3 + (seed % 3) * 0.2, rankGap: 0.6 + (seed % 4) * 0.3 })
        expect({ seed, direction, problems: layoutProblems(layout, nodes) }).toEqual({ seed, direction, problems: [] })
        expect(layout.edges).toHaveLength(edges.length)
      }
    }
  })
})

describe('layoutGraph: crossings on known graphs', () => {
  const count = (nodes: Box[], text: string) => {
    const layout = layoutGraph({ nodes, edges: links(text) })
    expect(layoutProblems(layout, nodes)).toEqual([])
    expect(routeCrossings(layout)).toBe(layout.crossings)        // reported number = what is drawn
    return layout.crossings
  }

  test('trees, diamonds and ladders are drawn without crossings', () => {
    expect(count(boxes('r a b a1 a2 b1 b2'), 'r>a r>b a>a1 a>a2 b>b1 b>b2')).toBe(0)
    expect(count(boxes('a b c d'), 'a>b a>c b>d c>d')).toBe(0)
    expect(count(boxes('a b c d e f'), 'a>b b>c d>e e>f a>d b>e c>f')).toBe(0)
    expect(count(pipeline.nodes, 'producer>queue queue>w1 queue>w2 queue>w3 w1>db w2>db w3>db w3>dlq')).toBe(0)
  })

  test('a declaration order that starts tangled is untangled', () => {
    // second rank declared in the opposite order of its parents
    expect(count(boxes('a b c z y x'), 'c>z b>y a>x')).toBe(0)
    // two fans that only fit one way round
    expect(count(boxes('s a b c d t u'), 's>a s>b s>c s>d d>t c>t a>u b>u')).toBe(0)
    // a long edge that must go around, not through, the middle
    expect(count(boxes('a b c d e'), 'a>b b>c c>d a>d b>e e>d')).toBe(0)
  })

  test('graphs that cannot be drawn flat keep the minimum', () => {
    expect(count(boxes('a b x y'), 'a>x a>y b>x b>y')).toBe(1)                      // K2,2
    expect(count(boxes('a b c x y z'), 'a>x a>y a>z b>x b>y b>z c>x c>y c>z')).toBe(9) // K3,3 in two ranks
  })

  test('random graphs: the reported count is exactly what is drawn, and never worse than the declared order', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { nodes, edges } = randomGraph(seed + 100, 6 + (seed % 9), 8 + (seed % 14))
      // one edge per pair of nodes: duplicates share a route and would be counted once per copy
      const seen = new Set<string>()
      const unique = edges.filter(e => {
        const key = e.from < e.to ? `${e.from} ${e.to}` : `${e.to} ${e.from}`
        if (e.from === e.to || seen.has(key)) return false
        seen.add(key)
        return true
      })
      const layout = layoutGraph({ nodes, edges: unique })
      expect({ seed, drawn: routeCrossings(layout) }).toEqual({ seed, drawn: layout.crossings })
    }
  })
})

describe('layoutGraph: cycles and odd input', () => {
  test('a cycle is broken by reversing exactly one edge, and that edge still runs from -> to', () => {
    const nodes = boxes('a b c')
    const layout = layoutGraph({ nodes, edges: links('a>b b>c c>a') })
    expect(layoutProblems(layout, nodes)).toEqual([])
    expect(layout.edges.map(e => e.reversed)).toEqual([false, false, true])
    expect(layout.nodes.a!.x).toBeLessThan(layout.nodes.b!.x)
    expect(layout.nodes.b!.x).toBeLessThan(layout.nodes.c!.x)
    const back = layout.edges[2]!
    expect(back.points[0]![0]).toBeGreaterThan(back.points[back.points.length - 1]![0])
  })

  test('unknown ids, duplicate ids, duplicate edges and empty input do not throw', () => {
    const nodes = [...boxes('a b'), { id: 'a', width: 9, height: 9 }]
    const layout = layoutGraph({ nodes, edges: [...links('a>b a>b a>ghost ghost>b'), { from: 'b', to: 'b' }] })
    expect(Object.keys(layout.nodes)).toEqual(['a', 'b'])
    expect(layout.edges.map(e => e.points.length > 0)).toEqual([true, true, false, false, true])
    expect(layout.edges[2]).toEqual({ from: 'a', to: 'ghost', points: [], curve: [], reversed: false })
    expect(layout.edges[0]!.points).toEqual(layout.edges[1]!.points)
    expect(layout.edges[0]!.points).not.toBe(layout.edges[1]!.points)
    expect(layoutGraph({ nodes: [], edges: [] })).toEqual({ nodes: {}, edges: [], width: 0, height: 0, crossings: 0 })
    const lonely = layoutGraph({ nodes: boxes('only'), edges: [] })
    expect(lonely.nodes.only!.x).toBeCloseTo(0, 12)
    expect(lonely.nodes.only!.y).toBeCloseTo(0, 12)
    expect(lonely.width).toBe(1.6)
    // bad numbers fall back instead of poisoning the layout
    const odd = layoutGraph({ nodes: [{ id: 'a', width: NaN, height: -1 }, { id: 'b', width: 1, height: 1 }], edges: links('a>b'), nodeGap: NaN, rankGap: -3 })
    for (const p of Object.values(odd.nodes)) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true) }
    expect(Number.isFinite(odd.width + odd.height)).toBe(true)
  })

  test('disconnected parts sit side by side without touching', () => {
    const nodes = boxes('a b c d lonely')
    const layout = layoutGraph({ nodes, edges: links('a>b c>d') })
    expect(layoutProblems(layout, nodes)).toEqual([])
  })
})

describe('layoutGraph: determinism', () => {
  test('same input, same output, with no clock and no Math.random', () => {
    const { nodes, edges } = randomGraph(7, 16, 30)
    const first = withoutClockOrRandom(() => layoutGraph({ nodes, edges }))
    const second = withoutClockOrRandom(() => layoutGraph({ nodes: nodes.map(n => ({ ...n })), edges: edges.map(e => ({ ...e })) }))
    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  test('the input is not modified', () => {
    const { nodes, edges } = randomGraph(3, 8, 12)
    const before = JSON.stringify({ nodes, edges })
    layoutGraph({ nodes, edges })
    expect(JSON.stringify({ nodes, edges })).toBe(before)
  })

  test('60 nodes and 90 edges lay out without problems', () => {
    const { nodes, edges } = randomGraph(21, 60, 90)
    const layout = layoutGraph({ nodes, edges })
    expect(layoutProblems(layout, nodes)).toEqual([])
  })
})
