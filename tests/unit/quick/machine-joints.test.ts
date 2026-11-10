// The pure side of machine(): reading joints (never throws, did-you-mean), dependency order with cycle detection,
// and the pose algebra. No scene, no DOM.
import { describe, expect, test } from 'bun:test'
import { into, nearest, needs, orderParts, parseJoints, parseRef, place, qaxis, qrot, QID, ride, slide, span, spin, sweep, type Joint, type Vec3 } from '../../../src/quick/joints.ts'

const near = (a: readonly number[], b: readonly number[], digits = 9): void => { for (let k = 0; k < 3; k++) expect(a[k]!).toBeCloseTo(b[k]!, digits) }
const PARTS = ['crank', 'rod', 'piston', 'liner', 'crank.web']

describe('reading joints', () => {
  test('every verb parses into a typed joint', () => {
    const law = (): unknown => ({ at: [0, 0, 0] })
    const { joints, problems } = parseJoints([
      ['crank', 'spins', { by: 'turn', about: 'x', at: 'liner.top', pivot: 'pin' }],
      ['piston', 'slides', { by: 2 }],
      ['rod', 'on', 'crank.pin', { my: 'bigEnd', offset: [0, 1, 0] }],
      ['rod', 'between', 'crank.pin', [0, 3, 0]],
      ['liner', 'around', 'piston', 'rod'],
      ['piston', 'follows', law],
      ['liner', 'gas', { from: 'piston.crown', to: 'liner.top', phase: () => 0.5 }],
      [['crank.pin', 'piston.crown'], 'particles', { when: () => true }],
      ['rod', 'particles'],
    ], PARTS)
    expect(problems).toEqual([])
    expect(joints.map((j) => j.verb)).toEqual(['spins', 'slides', 'on', 'between', 'around', 'follows', 'gas', 'particles', 'particles'])
    const s = joints[0] as Extract<Joint, { verb: 'spins' }>
    expect(s.axis).toEqual([1, 0, 0])
    expect(s.at).toEqual({ part: 'liner', anchor: 'top' })
    expect((joints[1] as Extract<Joint, { verb: 'slides' }>).axis).toEqual([0, 1, 0]) // the default axis of a slide
    expect((joints[2] as Extract<Joint, { verb: 'on' }>).offset).toEqual([0, 1, 0])
    expect((joints[4] as Extract<Joint, { verb: 'around' }>).holds).toEqual(['piston', 'rod'])
  })
  test('the longest part name wins in a reference', () => {
    expect(parseRef('crank.web.tip', PARTS)).toEqual({ part: 'crank.web', anchor: 'tip' })
    expect(parseRef('crank.pin', PARTS)).toEqual({ part: 'crank', anchor: 'pin' })
    expect(parseRef('nothing.pin', PARTS)).toBeNull()
  })
  test('bad lines never throw: each is left out with one precise problem and the nearest name', () => {
    const { joints, problems } = parseJoints([
      ['crnk', 'spins', { by: 'turn' }],
      ['crank', 'spinz', { by: 'turn' }],
      ['crank', 'spins', { bye: 'turn', by: 'turn' }],
      ['rod', 'between', 'crank.pin', 'pston.pin'],
      ['piston', 'slides', {}],
      'nonsense', 42, null,
      ['piston', 'follows', 'not a function'],
    ], PARTS)
    expect(joints.map((j) => j.verb)).toEqual(['spins']) // the line with an unknown option still works
    const text = problems.map((p) => `${p.what} ${p.fix ?? ''}`)
    expect(text[0]).toContain("use 'crank'")
    expect(text[1]).toContain("use 'spins'")
    expect(text[2]).toContain('unknown option "bye"')
    expect(text.some((t) => t.includes("use 'piston.pin'"))).toBe(true)
    expect(text.some((t) => t.includes('`by` must be'))).toBe(true)
    expect(problems.length).toBe(9)
    expect(parseJoints('joints', PARTS).problems.length).toBe(1)
    expect(parseJoints(undefined, PARTS)).toEqual({ joints: [], problems: [] })
  })
  test('a mechanism of the engine is taken as a joint over its parts', () => {
    const spec = { tag: 'crankSlider' }
    const { joints, problems } = parseJoints([spec], PARTS, (v) => (v === spec ? { type: 'crankSlider', parts: ['crank', 'rod', 'piston'] } : null))
    expect(problems).toEqual([])
    expect(joints[0]).toMatchObject({ verb: 'mechanism', type: 'crankSlider', parts: ['crank', 'rod', 'piston'] })
    const bad = parseJoints([spec], PARTS, () => ({ type: 'gearPair', parts: ['crank', 'gear'] }))
    expect(bad.joints).toEqual([])
    expect(bad.problems[0]!.what).toContain('"gear" is not a part')
  })
  test('nearest: a typing mistake finds its name, a different word finds nothing', () => {
    expect(nearest('highlite', ['view', 'highlight', 'camera'])).toBe('highlight')
    expect(nearest('zzzzzz', ['view', 'camera'])).toBeNull()
  })
})

describe('order', () => {
  const read = (lines: unknown[]): Joint[] => parseJoints(lines, PARTS).joints
  test('every part comes after the parts it depends on', () => {
    const joints = read([['liner', 'around', 'piston'], ['piston', 'on', 'rod.top'], ['rod', 'between', 'crank.pin', [0, 3, 0]], ['crank', 'spins', { by: 'turn' }]])
    const o = orderParts(PARTS, joints)
    const at = (p: string): number => o.order.indexOf(p)
    expect(at('crank')).toBeLessThan(at('rod'))
    expect(at('rod')).toBeLessThan(at('piston'))
    expect(at('piston')).toBeLessThan(at('liner'))
    expect(o.cycles).toEqual([])
    expect(o.free).toEqual(['crank.web']) // in no joint: at the origin, and reported by the block
    expect(needs(joints[1]!)).toEqual(['rod'])
  })
  test('a circle of joints is found and named, and every part is still ordered', () => {
    const o = orderParts(PARTS, read([['rod', 'on', 'piston.pin'], ['piston', 'on', 'crank.pin'], ['crank', 'on', 'rod.top']]))
    expect(o.cycles.length).toBe(1)
    expect([...o.cycles[0]!].sort()).toEqual(['crank', 'piston', 'rod'])
    expect([...o.order].sort()).toEqual([...PARTS].sort())
  })
  test('two joints that both place a part are a conflict; spins on top of a base are not', () => {
    const o = orderParts(PARTS, read([['rod', 'on', 'crank.pin'], ['rod', 'follows', () => ({})], ['piston', 'on', 'rod.top'], ['piston', 'spins', { by: 1 }]]))
    expect(o.conflicts).toEqual([{ part: 'rod', lines: [0, 1] }])
  })
})

describe('pose algebra', () => {
  test('spin about a pivot turns the position and the orientation', () => {
    const p = spin({ p: [1, 0, 0], q: QID }, [0, 0, 1], 90, [0, 0, 0])
    near(p.p, [0, 1, 0])
    near(qrot(p.q, [1, 0, 0]), [0, 1, 0])
    near(spin({ p: [2, 0, 0], q: QID }, [0, 0, 1], 180).p, [2, 0, 0]) // about its own origin: it stays
  })
  test('slide moves along the unit axis', () => near(slide({ p: [1, 1, 1], q: QID }, [0, 2, 0], 3).p, [1, 4, 1]))
  test('ride: the own point sits on the carrier point and turns with the carrier', () => {
    const carrier = qaxis([0, 0, 1], 90)
    const pose = ride(carrier, [5, 0, 0], [1, 0, 0])
    near(place(pose, [1, 0, 0]), [5, 0, 0])
    near(pose.p, [5, -1, 0])
  })
  test('span: the first end is on a, the link points at b, whatever the direction', () => {
    for (const b of [[3, 4, 0], [0, -2, 0], [-1, 0, 2], [0, 5, 0]] as Vec3[]) {
      const a: Vec3 = [1, 1, 0], pose = span(a, b, [0, -1, 0], [0, 1, 0])
      near(place(pose, [0, -1, 0]), a)
      const dir = place(pose, [0, 1, 0]).map((x, i) => x - a[i]!), want = b.map((x, i) => x - a[i]!), n = Math.hypot(...want) / 2
      near(dir, want.map((x) => x / n))
    }
  })
  test('into is the inverse of place', () => {
    const pose = spin({ p: [1, 2, 3], q: QID }, [1, 1, 0], 37)
    near(into(pose, place(pose, [0.3, -0.2, 0.9])), [0.3, -0.2, 0.9])
  })
  test('sweep: both ends, or a cyclic range without its last value', () => {
    expect(sweep(0, 360, 5)).toEqual([0, 90, 180, 270, 360])
    expect(sweep(0, 360, 4, true)).toEqual([0, 90, 180, 270])
  })
})
