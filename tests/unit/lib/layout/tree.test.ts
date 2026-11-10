import { describe, expect, test } from 'bun:test'
import { layoutTree, rectDistance } from '../../../../src/lib/layout/index.ts'
import { type Box, boxes, layoutProblems, links, nodeRect, routeCrossings, seeded, withoutClockOrRandom } from './helpers.ts'

/** Random tree: every node after the first hangs under an earlier one. */
function randomTree(seed: number, count: number): { nodes: Box[]; edges: { from: string; to: string }[] } {
  const random = seeded(seed)
  const nodes: Box[] = Array.from({ length: count }, (_, i) => ({ id: `t${i}`, width: 0.5 + random() * 1.5, height: 0.4 + random() * 0.6 }))
  const edges = Array.from({ length: count - 1 }, (_, i) => ({ from: `t${Math.floor(random() * (i + 1))}`, to: `t${i + 1}` }))
  return { nodes, edges }
}

describe('layoutTree', () => {
  test('a parent sits centred above its children, children keep their order, levels are rows', () => {
    const nodes = boxes('root a b c', 1, 0.6)
    const layout = layoutTree({ nodes, edges: links('root>a root>b root>c'), nodeGap: 0.5, rankGap: 1 })
    expect(layoutProblems(layout, nodes)).toEqual([])
    const { root, a, b, c } = layout.nodes as Record<string, { x: number; y: number }>
    expect(a!.x).toBeLessThan(b!.x)
    expect(b!.x).toBeLessThan(c!.x)
    expect(b!.x - a!.x).toBeCloseTo(1.5, 9)                       // width + nodeGap
    expect(root!.x).toBeCloseTo((a!.x + c!.x) / 2, 9)
    expect(a!.y).toBeCloseTo(b!.y, 9)
    expect(root!.y - a!.y).toBeCloseTo(1.6, 9)                     // height + rankGap, root on top in frame space
    expect(layout.width).toBeCloseTo(4, 9)
    expect(layout.height).toBeCloseTo(2.2, 9)
    expect(layout.crossings).toBe(0)
  })

  test('yDown puts the root at the smaller y; direction right grows along +x', () => {
    const nodes = boxes('root a b', 1, 0.6)
    const edges = links('root>a root>b')
    const screen = layoutTree({ nodes, edges, yDown: true })
    expect(screen.nodes.root!.y).toBeLessThan(screen.nodes.a!.y)
    const right = layoutTree({ nodes, edges, direction: 'right' })
    expect(right.nodes.root!.x).toBeLessThan(right.nodes.a!.x)
    expect(right.nodes.a!.y).toBeGreaterThan(right.nodes.b!.y)      // first child on top
    expect(right.nodes.root!.y).toBeCloseTo((right.nodes.a!.y + right.nodes.b!.y) / 2, 9)
    expect(layoutProblems(right, nodes)).toEqual([])
  })

  test('subtrees are packed as close as their outlines allow', () => {
    // a has a wide family, b is a leaf: b tucks in beside a, not beside a's grandchildren
    const nodes = boxes('r a b a1 a2 a3 a4', 1, 0.5)
    const layout = layoutTree({ nodes, edges: links('r>a r>b a>a1 a>a2 a>a3 a>a4'), nodeGap: 0.5 })
    expect(layoutProblems(layout, nodes)).toEqual([])
    expect(layout.nodes.b!.x - layout.nodes.a!.x).toBeCloseTo(1.5, 9)
    expect(layout.nodes.b!.x).toBeLessThan(layout.nodes.a4!.x)
  })

  test('small subtrees between two big ones are spread evenly', () => {
    const nodes = boxes('r A l1 l2 l3 B A1 A2 A3 A4 B1 B2 B3 B4', 0.8, 0.5)
    const layout = layoutTree({ nodes, edges: links('r>A r>l1 r>l2 r>l3 r>B A>A1 A>A2 A>A3 A>A4 B>B1 B>B2 B>B3 B>B4') })
    expect(layoutProblems(layout, nodes)).toEqual([])
    const xs = ['A', 'l1', 'l2', 'l3', 'B'].map(id => layout.nodes[id]!.x)
    const steps = xs.slice(1).map((x, i) => x - xs[i]!)
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 9)
    expect(layout.nodes.r!.x).toBeCloseTo(0, 9)                      // symmetric tree, root in the middle
  })

  test('random trees: no overlaps, gaps kept, edges avoid nodes and never cross', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { nodes, edges } = randomTree(seed, 5 + seed)
      for (const direction of ['down', 'right'] as const) {
        const layout = layoutTree({ nodes, edges, direction, nodeGap: 0.4, rankGap: 0.8 })
        expect({ seed, direction, problems: layoutProblems(layout, nodes) }).toEqual({ seed, direction, problems: [] })
        expect(routeCrossings(layout)).toBe(0)
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            expect(rectDistance(nodeRect(layout, nodes[i]!), nodeRect(layout, nodes[j]!))).toBeGreaterThanOrEqual(0.4 - 1e-9)
          }
        }
        // every parent is centred over its first and last child
        const kids = new Map<string, string[]>()
        for (const e of edges) kids.set(e.from, [...(kids.get(e.from) ?? []), e.to])
        for (const [parent, list] of kids) {
          const axis = direction === 'down' ? 'x' : 'y'
          const first = layout.nodes[list[0]!]![axis], last = layout.nodes[list[list.length - 1]!]![axis]
          expect(layout.nodes[parent]![axis]).toBeCloseTo((first + last) / 2, 9)
        }
      }
    }
  })

  test('forests, extra links, loops and unknown ids', () => {
    const nodes = boxes('r a b x y', 1, 0.5)
    const layout = layoutTree({ nodes, edges: [...links('r>a r>b x>y b>a a>r ghost>a'), { from: 'a', to: 'a' }] })
    expect(layoutProblems(layout, nodes, { checkRoutes: false })).toEqual([])
    expect(layout.nodes.r!.y).toBeCloseTo(layout.nodes.x!.y, 9)      // two roots share the top level
    expect(layout.nodes.r!.x).toBeLessThan(layout.nodes.x!.x)
    expect(layout.edges.map(e => e.points.length)).toEqual([17, 17, 2, 2, 2, 0, 0])
    expect(layoutTree({ nodes: [], edges: [] })).toEqual({ nodes: {}, edges: [], width: 0, height: 0, crossings: 0 })
  })

  test('deterministic, no clock, no Math.random', () => {
    const { nodes, edges } = randomTree(99, 40)
    const first = withoutClockOrRandom(() => layoutTree({ nodes, edges }))
    const second = withoutClockOrRandom(() => layoutTree({ nodes, edges }))
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})
