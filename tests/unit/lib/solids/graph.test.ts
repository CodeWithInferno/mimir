import { describe, expect, test } from 'bun:test'
import {
  type Proxy, axisLabel, contactGraph, floaters, mat4Compose, primitiveProxy, span,
} from '../../../../src/lib/solids/index.ts'
import { box, cylinder, moved, prim, sphere, tube } from './helpers.ts'

/** A small engine-like stack: block on the ground, liner in the block, piston in the liner, head on top. */
function assembly(): Proxy[] {
  return [
    box('bed', 6, 0.5, 4, { position: [0, -0.25, 0] }),
    box('block', 2, 1, 2, { position: [0, 0.5, 0] }),
    tube('liner', 0.6, 0.18, 2, { position: [0, 2, 0] }),
    cylinder('piston', 0.4, 0.6, { position: [0, 2.2, 0] }),
    box('head', 2, 0.4, 2, { position: [0, 3.2, 0] }),
  ]
}

describe('contactGraph', () => {
  test('touching parts form one component; a detached part is its own', () => {
    const parts = [...assembly(), box('lid', 3, 0.05, 3, { position: [0, 4.5, 0] })]
    const graph = contactGraph(parts)
    expect(graph.components).toEqual([['bed', 'block', 'liner', 'piston', 'head'], ['lid']])
    expect(graph.edges).toEqual([['bed', 'block'], ['block', 'liner'], ['liner', 'piston'], ['liner', 'head']])
    expect(graph.tolerance).toBeCloseTo(0.01 * span(parts), 12)
  })

  test('the tolerance decides whether a clearance fit counts as contact', () => {
    // the piston has 0.02 clearance in the liner bore
    const parts = assembly()
    expect(contactGraph(parts, 0.05).components.length).toBe(1)
    expect(contactGraph(parts, 0.001).components).toEqual([['bed', 'block', 'liner', 'head'], ['piston']])
    expect(contactGraph(parts, 0).components).toEqual([['bed', 'block', 'liner', 'head'], ['piston']])
  })

  test('overlapping and nested solids are connected', () => {
    const parts = [sphere('big', 2), sphere('inside', 0.3, { position: [0.5, 0, 0] }), box('crossing', 1, 1, 6, { position: [0, 0, 3] })]
    expect(contactGraph(parts).components).toEqual([['big', 'inside', 'crossing']])
  })

  test('a part floating in the middle of a hollow shell is NOT connected to it', () => {
    const shell = primitiveProxy('shell', { kind: 'sphere', radius: 2 }, mat4Compose(), { hollow: true })
    expect(contactGraph([shell, sphere('core', 0.5)], 0.05).components).toEqual([['shell'], ['core']])
    expect(contactGraph([shell, sphere('core', 0.5, { position: [0, -1.5, 0] })], 0.05).components).toEqual([['shell', 'core']])
  })

  test('same graph after an awkward rigid move; empty and single inputs', () => {
    const parts = [...assembly(), box('lid', 3, 0.05, 3, { position: [0, 4.5, 0] })]
    const turned = moved(parts, { position: [5, -3, 2], rotation: [33, 71, -128] })
    expect(contactGraph(turned).components).toEqual(contactGraph(parts).components)
    expect(contactGraph([])).toEqual({ components: [], edges: [], tolerance: 0 })
    expect(contactGraph([box('only', 1, 1, 1)]).components).toEqual([['only']])
  })

  test('a chain of 30 touching links is one component', () => {
    const links: Proxy[] = []
    for (let i = 0; i < 30; i++) links.push(prim(`link-${i}`, { kind: 'torus', radius: 0.5, tube: 0.12 }, { position: [i * 0.76, 0, 0], rotation: { about: 'x', deg: i % 2 ? 90 : 0 } }))
    const graph = contactGraph(links, 0.01)
    expect(graph.components.length).toBe(1)
    expect(graph.edges.length).toBe(29)
  })
})

describe('floaters', () => {
  test('a detached part is reported with its nearest part, the distance and the direction', () => {
    const parts = [...assembly(), box('lid', 3, 0.05, 3, { position: [0, 4.5, 0] })]
    const found = floaters(parts, ['bed'])
    expect(found.length).toBe(1)
    const lid = found[0]!
    expect(lid.ids).toEqual(['lid'])
    expect(lid.fromId).toBe('lid')
    expect(lid.nearestId).toBe('head')
    // head top is at 3.4, lid underside at 4.475
    expect(lid.distance).toBeCloseTo(1.075, 6)
    expect(lid.direction.map(v => +v.toFixed(6))).toEqual([0, -1, 0])
    expect(axisLabel(lid.direction)).toBe('-Y')
    expect(lid.span).toBeCloseTo(Math.hypot(3, 0.05, 3), 9)
    expect(lid.spanFraction).toBeCloseTo(lid.span / span(parts), 12)
  })

  test('a fully connected model has no floaters', () => {
    expect(floaters(assembly(), ['bed'])).toEqual([])
    expect(floaters([], ['bed'])).toEqual([])
  })

  test('floaters are measured by span, not volume: a thin detached panel counts, a speck does not', () => {
    const panel = box('panel', 5, 0.01, 3, { position: [0, 6, 0] }) // tiny volume, large span
    const speck = sphere('speck', 0.02, { position: [4, 5, 0] }) // 0.07 span in a ~9 unit model: below 1%
    const parts = [...assembly(), panel, speck]
    expect(floaters(parts, ['bed']).map(f => f.ids)).toEqual([['panel']])
    expect(floaters(parts, ['bed'], { minSpanFraction: 0 }).map(f => f.ids)).toEqual([['panel'], ['speck']])
    expect(floaters(parts, ['bed'], { minSpanFraction: 0.9 })).toEqual([])
  })

  test('a detached group of several parts is one floater', () => {
    // a bolt hovering 0.2 above the bed, beside the block
    const parts = [...assembly(), box('bolt-head', 0.4, 0.2, 0.4, { position: [2.5, 0.9, 0] }), cylinder('bolt-shank', 0.1, 0.6, { position: [2.5, 0.5, 0] })]
    const found = floaters(parts, ['bed'])
    expect(found.length).toBe(1)
    expect(found[0]!.ids).toEqual(['bolt-head', 'bolt-shank'])
    expect(found[0]!.fromId).toBe('bolt-shank')
    expect(found[0]!.nearestId).toBe('bed')
    expect(found[0]!.distance).toBeCloseTo(0.2, 6)
    expect(axisLabel(found[0]!.direction)).toBe('-Y')
  })

  test('without a base id the largest component is the base', () => {
    const parts = [...assembly(), box('lid', 3, 0.05, 3, { position: [0, 4.5, 0] })]
    expect(floaters(parts).map(f => f.ids)).toEqual([['lid']])
    expect(floaters(parts, ['no-such-part']).map(f => f.ids)).toEqual([['lid']])
    // naming the lid as the base turns the rest of the engine into the floater
    expect(floaters(parts, ['lid']).map(f => f.ids)).toEqual([['bed', 'block', 'liner', 'piston', 'head']])
    // several bases: nothing attached to either floats
    expect(floaters(parts, ['bed', 'lid'])).toEqual([])
  })

  test('the contact tolerance is adjustable', () => {
    const parts = [box('a', 1, 1, 1), box('b', 1, 1, 1, { position: [1.05, 0, 0] })]
    expect(floaters(parts, ['a'], { tolerance: 0.1 })).toEqual([])
    const found = floaters(parts, ['a'], { tolerance: 0.01 })
    expect(found.map(f => f.ids)).toEqual([['b']])
    expect(found[0]!.distance).toBeCloseTo(0.05, 9)
    expect(found[0]!.nearestId).toBe('a')
  })

  test('axisLabel names the dominant axis', () => {
    expect(axisLabel([0.9, 0.1, -0.2])).toBe('+X')
    expect(axisLabel([-0.9, 0.1, -0.2])).toBe('-X')
    expect(axisLabel([0.1, 0.5, -0.2])).toBe('+Y')
    expect(axisLabel([0.1, 0.1, -0.2])).toBe('-Z')
    expect(axisLabel([0, 0, 1])).toBe('+Z')
  })
})
