import { describe, expect, test } from 'bun:test'
import { forceLayout, rectDistance } from '../../../../src/lib/layout/index.ts'
import { boxes, layoutProblems, links, nodeRect, withoutClockOrRandom } from './helpers.ts'

const wheel = {
  nodes: boxes('hub n1 n2 n3 n4 n5', 1, 0.6),
  edges: links('hub>n1 hub>n2 hub>n3 hub>n4 hub>n5 n1>n2 n2>n3 n3>n4 n4>n5 n5>n1'),
}

describe('forceLayout', () => {
  test('same seed, same layout; another seed, another layout', () => {
    const first = withoutClockOrRandom(() => forceLayout({ ...wheel, seed: 4 }))
    const again = withoutClockOrRandom(() => forceLayout({ ...wheel, seed: 4 }))
    expect(JSON.stringify(again)).toBe(JSON.stringify(first))
    const other = forceLayout({ ...wheel, seed: 5 })
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(first))
    expect(JSON.stringify(forceLayout(wheel))).toBe(JSON.stringify(forceLayout({ ...wheel, seed: 1 })))   // default seed is 1
  })

  test('no two boxes closer than nodeGap, everything inside the size, edges end on borders', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const nodes = boxes(Array.from({ length: 24 }, (_, i) => `v${i}`).join(' '), 1.4, 0.6)
      const edges = Array.from({ length: 23 }, (_, i) => ({ from: `v${Math.floor(i / 2)}`, to: `v${i + 1}` })).concat(links('v3>v9 v20>v1'))
      const layout = forceLayout({ nodes, edges, seed, nodeGap: 0.3 })
      // straight edges may pass a third node; overlaps, bounds and attachment must hold
      const problems = layoutProblems(layout, nodes).filter(text => !text.includes('passes through'))
      expect({ seed, problems }).toEqual({ seed, problems: [] })
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodeRect(layout, nodes[i]!), b = nodeRect(layout, nodes[j]!)
          const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)), dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
          expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(0.3 - 1e-6)
        }
      }
    }
  })

  test('rings, grids and trees come out untangled for every seed tried', () => {
    const ring = { nodes: boxes('a b c d e f g h', 1, 0.6), edges: links('a>b b>c c>d d>e e>f f>g g>h h>a') }
    const shuffled = { nodes: ring.nodes, edges: links('a>e e>c c>g g>b b>h h>d d>f f>a') }
    const gridEdges: { from: string; to: string }[] = []
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (c < 3) gridEdges.push({ from: `g${r}${c}`, to: `g${r}${c + 1}` })
      if (r < 3) gridEdges.push({ from: `g${r}${c}`, to: `g${r + 1}${c}` })
    }
    const grid = { nodes: boxes(Array.from({ length: 16 }, (_, i) => `g${Math.floor(i / 4)}${i % 4}`).join(' '), 1, 0.6), edges: gridEdges }
    const tree = { nodes: boxes(Array.from({ length: 15 }, (_, i) => `t${i}`).join(' '), 1, 0.6), edges: Array.from({ length: 14 }, (_, i) => ({ from: `t${Math.floor(i / 2)}`, to: `t${i + 1}` })) }
    for (let seed = 1; seed <= 20; seed++) {
      for (const [name, graph] of Object.entries({ ring, shuffled, grid, tree })) {
        expect({ name, seed, crossings: forceLayout({ ...graph, seed }).crossings }).toEqual({ name, seed, crossings: 0 })
      }
    }
  })

  test('a hub ends up in the middle of its ring, and linked nodes sit closer than unlinked ones', () => {
    const layout = forceLayout(wheel)
    const hub = layout.nodes.hub!
    const rim = ['n1', 'n2', 'n3', 'n4', 'n5'].map(id => layout.nodes[id]!)
    const cx = rim.reduce((sum, p) => sum + p.x, 0) / 5, cy = rim.reduce((sum, p) => sum + p.y, 0) / 5
    const radius = rim.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / 5
    expect(Math.hypot(hub.x - cx, hub.y - cy)).toBeLessThan(0.25 * radius)
    expect(layout.crossings).toBe(0)
    const linked = new Set(wheel.edges.map(e => [e.from, e.to].sort().join(' ')))
    let near = 0, nearCount = 0, far = 0, farCount = 0
    for (let i = 0; i < wheel.nodes.length; i++) for (let j = i + 1; j < wheel.nodes.length; j++) {
      const a = wheel.nodes[i]!, b = wheel.nodes[j]!
      const d = Math.hypot(layout.nodes[a.id]!.x - layout.nodes[b.id]!.x, layout.nodes[a.id]!.y - layout.nodes[b.id]!.y)
      if (linked.has([a.id, b.id].sort().join(' '))) { near += d; nearCount++ } else { far += d; farCount++ }
    }
    expect(near / nearCount).toBeLessThan(far / farCount)
  })

  test('linkDistance sets the scale', () => {
    const pair = { nodes: [{ id: 'a' }, { id: 'b' }], edges: links('a>b') }
    const short = forceLayout({ ...pair, linkDistance: 2, nodeGap: 0 })
    const long = forceLayout({ ...pair, linkDistance: 6, nodeGap: 0 })
    const length = (l: typeof short) => Math.hypot(l.nodes.a!.x - l.nodes.b!.x, l.nodes.a!.y - l.nodes.b!.y)
    expect(length(long) / length(short)).toBeCloseTo(3, 1)
    expect(length(short)).toBeGreaterThan(2)                        // repulsion stretches a lone spring a little
    expect(length(short)).toBeLessThan(3.2)
  })

  test('odd input: empty, single, unknown ids, self loops, separate groups', () => {
    expect(forceLayout({ nodes: [], edges: [] })).toEqual({ nodes: {}, edges: [], width: 0, height: 0, crossings: 0 })
    const one = forceLayout({ nodes: boxes('only', 2, 1), edges: [] })
    expect(one.nodes.only!.x).toBeCloseTo(0, 9)
    expect(one.width).toBeCloseTo(2, 9)
    const nodes = boxes('a b c d e', 1, 0.6)
    const layout = forceLayout({ nodes, edges: [...links('a>b c>d a>ghost'), { from: 'e', to: 'e' }] })
    expect(layout.edges.map(e => e.points.length)).toEqual([2, 2, 0, 0])
    for (const p of Object.values(layout.nodes)) expect(Number.isFinite(p.x + p.y)).toBe(true)
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      expect(rectDistance(nodeRect(layout, nodes[i]!), nodeRect(layout, nodes[j]!))).toBeGreaterThan(0.4)
    }
  })
})
