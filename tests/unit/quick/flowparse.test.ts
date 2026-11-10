// flow(): the arrow text and the { nodes, links } form. Pure: no engine.
import { describe, expect, test } from 'bun:test'
import { idOf, nearest, parseFlow, readLabel, resolveNodes } from '../../../src/quick/flowparse.ts'

const QUEUE = 'producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters'

describe('parseFlow: arrow text', () => {
  test('names, slots, replicas, labels and chains', () => {
    const g = parseFlow(QUEUE)
    expect(g.problems).toEqual([])
    expect(g.nodes.map((n) => n.id)).toEqual(['producer', 'queue', 'worker1', 'worker2', 'worker3', 'database', 'retry', 'deadLetters'])
    expect(g.nodes.find((n) => n.id === 'queue')!.slots).toBe(8)
    expect(g.nodes.filter((n) => n.base === 'worker').map((n) => n.replica)).toEqual([1, 2, 3])
    expect(g.nodes.find((n) => n.id === 'deadLetters')!.label).toBe('dead letters')
    // queue → 3 workers, 3 workers → database, 3 workers → retry, producer → queue, retry → queue, retry → dead letters
    expect(g.links.length).toBe(12)
    expect(g.links.filter((l) => l.kind === 'fail').map((l) => l.from)).toEqual(['worker1', 'worker2', 'worker3'])
    expect(g.links.find((l) => l.to === 'deadLetters')).toMatchObject({ kind: 'after', tries: 3, label: '3x' })
  })
  test('a share on a link, and newlines between chains', () => {
    const g = parseFlow('client -> server*2 -> cache\ncache -miss 35%-> database')
    expect(g.problems).toEqual([])
    expect(g.links.find((l) => l.to === 'database')).toMatchObject({ kind: 'go', share: 0.35, label: 'miss 35%' })
  })
  test('one replica can be named after the group was declared', () => {
    const g = parseFlow('a -> worker*2 -> b; worker2 -fail-> a')
    expect(g.links.filter((l) => l.kind === 'fail').map((l) => l.from)).toEqual(['worker2'])
    expect(resolveNodes(g, 'worker')).toEqual(['worker1', 'worker2'])
    expect(resolveNodes(g, 'worker2')).toEqual(['worker2'])
    expect(resolveNodes(g, 'nobody')).toEqual([])
  })
  test('readLabel', () => {
    expect(readLabel('fail')).toMatchObject({ kind: 'fail' })
    expect(readLabel('timeout 10%')).toMatchObject({ kind: 'fail', share: 0.1 })
    expect(readLabel('5x')).toMatchObject({ kind: 'after', tries: 5 })
    expect(readLabel('reads')).toMatchObject({ kind: 'go', share: null })
    expect(idOf('Dead  letter queue')).toBe('deadLetterQueue')
  })
})

describe('parseFlow: bad input never throws', () => {
  test.each([[null], [42], [''], ['->'], ['a -> '], ['a -> a'], [{ nodes: 3 }], [{ links: [['a']] }], ['q[999] -> w*99']])('%p', (spec) => {
    const g = parseFlow(spec)
    expect(g.problems.length).toBeGreaterThan(0)
    for (const p of g.problems) { expect(p.what).toBeTruthy(); expect(p.fix).toBeTruthy() }
  })
  test('what can be read is kept', () => {
    const g = parseFlow('a -> b -> ; b -> c')
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(g.links.length).toBe(2)
    const clamped = parseFlow('q[999] -> w*99')
    expect(clamped.nodes.find((n) => n.id === 'q')!.slots).toBe(16)
    expect(clamped.nodes.filter((n) => n.base === 'w').length).toBe(6)
  })
})

describe('parseFlow: { nodes, links }', () => {
  test('the same graph as the text', () => {
    const g = parseFlow({ nodes: { client: 'browser', 'load balancer': { slots: 4 }, server: { replicas: 2 } }, links: [['client', 'load balancer'], ['load balancer', 'server'], ['server', 'store', 'miss 20%']] })
    expect(g.problems).toEqual([])
    expect(g.nodes.map((n) => n.id)).toEqual(['client', 'loadBalancer', 'server1', 'server2', 'store'])
    expect(g.nodes[0]!.label).toBe('browser')
    expect(g.links.filter((l) => l.to === 'store').every((l) => l.share === 0.2)).toBe(true)
  })
})

test('nearest: did-you-mean', () => {
  expect(nearest('worker4', ['worker1', 'queue', 'database'])).toBe('worker1')
  expect(nearest('untill', ['until', 'crash', 'poison'])).toBe('until')
  expect(nearest('zzz', ['until', 'crash'])).toBeNull()
})
