// The engine: causes before effects, folding, order, the fix cap, states that are not measured twice, and the query side.
import { describe, expect, test } from 'bun:test'
import { box, cylinder, sphere } from '../../../src/r3d/index.ts'
import { rect } from '../../../src/r2d/index.ts'
import { arrange, ruleCodes, trim, CAUSES, ORDER } from '../../../src/check/engine.ts'
import { runQuery } from '../../../src/check/query.ts'
import { allRules, ownerOf, type Diag } from '../../../src/core/index.ts'
import { build, check } from './helpers.ts'

const diag = (code: string, ids: string[], o: Partial<Diag> = {}): Diag => ({ code, severity: 'error', step: 1, t: 1, ids, file: null, line: 1, measured: null, limit: null, what: `${code} ${ids.join(' ')}.`, fix: ['a fix'], ...o })
const entry = (d: Diag, fold: string | null = null, measured = true) => ({ d, fold, rule: d.code, measured })

describe('check engine', () => {
  test('every rule of DESIGN §7 this module owns is registered, and every code has a place in the print order', () => {
    const codes = ruleCodes()
    // MECH-OPEN is not claimed in the registry by this module: the module that builds mechanisms owns it (src/kit/check.ts,
    // registered when another test file of the same run has imported it), and a code has one owner
    expect([null, 'kit/check.ts']).toContain(ownerOf('rule', 'MECH-OPEN'))
    for (const c of ['PLACE-NONE', 'OCCLUDED', 'FLOATING', 'INTERPENETRATE', 'COLLIDE-IN-MOTION', 'EXPECT-FAILED', 'TEXT-LONG', 'LABEL-COVERS', 'TEXT-TINY', 'CONTRAST-TEXT', 'TINY', 'SUBJECT-FIT', 'CONTAINED', 'COINCIDENT', 'MECH-OPEN', 'PARAM-BREAKS', 'CAMERA-CLIP', 'HATCH-USE', 'CHAPTER-LONG', 'COLOR-COUNT']) {
      expect(codes).toContain(c)
      expect(ORDER).toContain(c)
    }
    for (const [cause, effects] of Object.entries(CAUSES)) for (const c of [cause, ...effects]) expect(codes).toContain(c)
  })
  test('an effect is dropped when its cause is reported about the same objects; an unrelated one stays', () => {
    const out = arrange([entry(diag('INTERPENETRATE', ['a', 'b'])), entry(diag('COINCIDENT', ['a', 'b'])), entry(diag('INTERPENETRATE', ['c', 'd'])), entry(diag('OCCLUDED', ['a'], { severity: 'warn' }))])
    expect(out.map((d) => [d.code, d.ids])).toEqual([['COINCIDENT', ['a', 'b']], ['INTERPENETRATE', ['c', 'd']]])
  })
  test('what is measured about an object whose constructor call failed is dropped; a scene-wide cause explains its step', () => {
    const out = arrange([entry(diag('OFF-FRAME', ['a'])), entry(diag('API-TYPE', ['a']), null, false), entry(diag('SUBJECT-FIT', [], { severity: 'warn', step: 2 })), entry(diag('EMPTY-FRAME', [], { step: 2 })), entry(diag('SUBJECT-FIT', [], { severity: 'warn', step: 3, what: 'other.' }))])
    expect(out.map((d) => [d.code, d.step])).toEqual([['API-TYPE', 1], ['EMPTY-FRAME', 2], ['SUBJECT-FIT', 3]])
  })
  test('many reports of one kind are one line that names the others; errors come first, then what explains the most', () => {
    const tiny = (id: string) => entry(diag('TINY', [id], { severity: 'warn', what: `#${id} is 3 px across.` }), 'small')
    const out = arrange([tiny('a'), tiny('b'), tiny('c'), entry(diag('FLOATING', ['x'])), entry(diag('API-UNKNOWN', ['y']), null, false), entry(diag('INTERPENETRATE', ['p', 'q'], { severity: 'unknown' as any }))])
    expect(out.map((d) => `${d.code} ${d.severity}`)).toEqual(['API-UNKNOWN error', 'FLOATING error', 'TINY warn', 'INTERPENETRATE unknown'])
    expect(out[2]!.what).toBe('#a is 3 px across. 2 more like it: #b, #c.')
    expect(out[2]!.ids).toEqual(['a', 'b', 'c'])
  })
  test('at most three edits, most likely first, plus the command that shows the state', () => {
    expect(trim(['one', 'two', 'see it: mimir shot <scene> --step 2', 'three', 'four'])).toEqual(['one', 'two', 'three', 'see it: mimir shot <scene> --step 2'])
  })
  test('a state that was already measured is not measured again; every diagnostic has the contract fields', async () => {
    const r = await check((s) => {
      const p = s.param('p', { value: 0, min: 0, max: 1 })
      const base = box({ id: 'base', width: 3, height: 0.4, depth: 3 })
      box({ id: 'cap', width: 1, height: 0.3, depth: 1 }).at(() => [0, 0.65 + p() * 0, 0])
      s.step('One', (st: any) => { st.label(base) })
      s.step('Same', (st: any) => { st.label(base) })
    })
    // 2 step ends + 3 param samples: "p at its default" is the end of the story again, and p changes nothing visible
    expect(r.stats.samples).toBe(5)
    expect(r.stats.skipped).toBeGreaterThanOrEqual(1)
    for (const d of r.diags) {
      expect(Object.keys(d).sort()).toEqual(expect.arrayContaining(['code', 'file', 'fix', 'ids', 'limit', 'line', 'measured', 'severity', 'step', 't', 'what']))
      expect(d.fix.length).toBeGreaterThanOrEqual(1)
      expect(d.fix.length).toBeLessThanOrEqual(4)
    }
    expect(typeof r.stats.ms).toBe('number')
  })
})

describe('mimir query (page side)', () => {
  const model = build((s) => {
    const lift = s.param('lift', { value: 0, min: 0, max: 2 })
    const base = box({ id: 'base', width: 4, height: 0.4, depth: 4 })
    const post = cylinder({ id: 'post', radius: 0.3, height: 2 }).nextTo(base, 'up', 0)
    sphere({ id: 'ball', radius: 0.5 }).at(() => [0, 2.9 + lift(), 0])
    box({ id: 'peg', width: 0.4, height: 0.4, depth: 0.4 }).at(1.5, 0.3, 0)
    rect({ id: 'card' }).at(-3, 0)
    s.probe('height', () => 2.9 + lift())
    s.viewport('right', 0.5)
    s.step('Rest', (st: any) => { st.label(post) })
    s.step('Lift', (st: any) => { st.set(lift, 1) })
  })
  test('distance: a signed distance between two solids, the relation, the direction, at a step, a time or a slider setting', () => {
    const rest = runQuery(null, { what: 'distance', args: ['ball', 'post'], step: 1 }, model)
    expect(rest).toMatchObject({ what: 'distance', a: 'ball', b: 'post', step: 1, relation: 'apart', gap: 0.2, along: '-Y', measured: 'solids' })
    expect(runQuery(null, { what: 'distance', args: ['ball', 'post'], step: 'Lift' }, model)).toMatchObject({ step: 2, gap: 1.2 })
    expect(runQuery(null, { what: 'distance', args: ['ball', 'post'], step: 1, set: { lift: 2 } }, model)).toMatchObject({ gap: 2.2, params: { lift: 2 } })
    expect(runQuery(null, { what: 'distance', args: ['post', 'base'], step: 1 }, model)).toMatchObject({ relation: 'touching', gap: 0 })
    expect(runQuery(null, { what: 'distance', args: ['peg', 'base'], step: 1 }, model)).toMatchObject({ relation: 'overlapping', depth: 0.1 })
  })
  test('contacts: what a part touches, overlaps, and the nearest thing it does not touch', () => {
    const r = runQuery(null, { what: 'contacts', args: ['base'], step: 1 }, model) as any
    expect(r.contacts[0]).toMatchObject({ id: 'base', touching: ['post'], overlapping: [{ id: 'peg', depth: 0.1 }], floating: false })
    expect(r.contacts[0].nearest).toMatchObject({ id: 'ball' })
    expect((runQuery(null, { what: 'contacts', args: ['ball'], step: 1 }, model) as any).contacts[0]).toMatchObject({ floating: true, nearest: { id: 'post', gap: 0.2, along: '-Y' } })
  })
  test('bounds, state and probes along the timeline', () => {
    const b = runQuery(null, { what: 'bounds', args: ['post'], t: 0 }, model) as any
    expect(b.bounds[0]).toMatchObject({ id: 'post', kind: 'cylinder', space: '3d', min: [-0.3, 0.2, -0.3], max: [0.3, 2.2, 0.3], size: [0.6, 2, 0.6], center: [0, 1.2, 0], screen: null })
    const st = runQuery(null, { what: 'state', step: 2 }, model) as any
    expect(st).toMatchObject({ step: 2, title: 'Lift', params: { lift: 1 }, probes: { height: 3.9 } })
    expect(st.onStage).toEqual(expect.arrayContaining(['base', 'post', 'ball', 'peg', 'card']))
    expect(st.positions.ball).toEqual([0, 3.9, 0])
    const p = runQuery(null, { what: 'probes', samples: 4 }, model) as any
    expect(p.times.length).toBe(4)
    expect(p.range.height).toEqual({ min: 2.9, max: 3.9 })
    expect((runQuery(null, { what: 'visible', args: ['ball'], step: 1 }, model) as any).visible[0]).toMatchObject({ onStage: true, pixels: 'unknown' })
  })
  test('the form the CLI uses, query(what, ids, options), a named point of an object, and a contact tolerance', () => {
    expect(runQuery(null, { what: 'distance', args: ['ball.bottom', 'post.top'], step: 1 }, model)).toMatchObject({ a: 'ball.bottom', b: 'post.top', distance: 0.2, measured: 'point to point' })
    expect(runQuery(null, { what: 'distance', args: ['ball.center', 'post'], step: 1 }, model)).toMatchObject({ distance: 0.7, measured: 'point to surface (negative = inside)' })
    expect(runQuery(null, { what: 'distance', args: ['ball', 'post'], step: 1, tolerance: 0.5 }, model)).toMatchObject({ relation: 'touching', gap: 0.2 })
    expect(runQuery(null, { what: 'distance', args: ['ball.botom', 'post'], step: 1 }, model)).toMatchObject({ error: '#ball has no point "botom".', fix: ['use "ball.bottom"'] })
  })
  test('a bad request is answered with what is wrong and the way out, never thrown', () => {
    expect(runQuery(null, { what: 'distanse' }, model)).toEqual({ error: 'there is no query "distanse".', fix: ['use "distance"'] })
    expect(runQuery(null, { what: 'distance', args: ['ball'] }, model)).toMatchObject({ error: 'distance needs two object ids.' })
    expect(runQuery(null, { what: 'bounds', args: ['bal'] }, model)).toEqual({ error: 'no object has the id "bal".', fix: ['use "ball"'] })
    expect(runQuery(null, { what: 'state', step: 9 }, model)).toMatchObject({ error: 'there is no step 9 (the scene has 2).' })
    expect(runQuery(null, { what: 'state', set: { lift: 5 } }, model)).toMatchObject({ error: '"lift" goes from 0 to 2, got 5.' })
    expect(runQuery(null, null, model)).toMatchObject({ error: 'there is no query "".' })
  })
})
