// The solid rules without a browser: they are pure maths on the model, so every case here runs under bun.
import { describe, expect, test } from 'bun:test'
import { box, cone, cylinder, sphere, tube, between } from '../../../src/r3d/index.ts'
import { group } from '../../../src/r2d/index.ts'
import { expect as claim, declareInvariant } from '../../../src/check/index.ts'
import { boxOf, defineKind } from '../../../src/core/index.ts'
import { check } from './helpers.ts'

const rail = () => box({ id: 'rail', width: 8, height: 0.4, depth: 1 }).at(0, 0, 0)

const blob = defineKind({ name: 'checkTestBlob', space: '3d', solid: true, schema: {}, bounds: () => boxOf(0.6, 0.6, 0.6) })

describe('INTERPENETRATE', () => {
  test('two parts that move against each other and overlap at the end of a step: an error with depth, limit, where, and literal fixes', async () => {
    const r = await check((s) => {
      const travel = s.param('travel', { value: 0, min: 0, max: 1 })
      rail()
      box({ id: 'slider', width: 1, height: 0.8, depth: 0.8 }).at(() => [-3 + 6 * travel(), 0.5, 0])
      s.step('Across', (st: any) => { st.set(travel, 1) })
    })
    expect(r.codes).toEqual(['INTERPENETRATE error', 'HATCH-USE info'])
    const d = r.of('INTERPENETRATE')[0]!
    expect(d).toMatchObject({ ids: ['slider', 'rail'], step: 1, measured: 0.1, limit: 0.008 })
    expect(typeof d.line).toBe('number')
    expect(d.what).toMatch(/#slider and #rail overlap by 0\.1 units at the end of step 1 \(limit 0\.008: 2% of the thinner part\)/)
    expect(d.fix.length).toBeGreaterThanOrEqual(3)
    expect(d.fix.at(-1)).toMatch(/^see it: mimir shot <scene> --step 1$/)
  })
  test('touching is not overlapping; a housing, a declared fit and a group are exempt', async () => {
    const r = await check((s) => {
      const travel = s.param('travel', { value: 0, min: 0, max: 1 })
      rail()
      const slider = box({ id: 'slider', width: 1, height: 0.8, depth: 0.8 }).at(() => [-3 + 6 * travel(), 0.6, 0])
      box({ id: 'cover', width: 8.4, height: 1.6, depth: 1.4, material: 'glass' }).at(0, 0.5, 0)
      box({ id: 'shellBox', width: 8.4, height: 1.6, depth: 1.4, shell: true }).at(0, 0.5, 0)
      cylinder({ id: 'pin', radius: 0.1, height: 1.2 }).rotate({ about: 'x', deg: 90 }).attach(slider, { my: 'center', to: 'center' })
      group([box({ id: 'foot', width: 1, height: 0.3, depth: 1 }).at(0, -0.35, 0), box({ id: 'stem', width: 0.4, height: 1, depth: 0.4 }).at(0, -0.7, 0)])
      const liner = box({ id: 'liner', width: 0.5, height: 0.5, depth: 0.5 }).at(3, -0.1, 0)
      claim.inside(liner, 'rail', { tolerance: 1 })
      box({ id: 'wedge', width: 0.5, height: 0.5, depth: 0.5 }).at(-3.5, -0.1, 0.2).allow('INTERPENETRATE', 'rail')
      s.step('Across', (st: any) => { st.set(travel, 1) })
    })
    expect(r.codes).toEqual([])
  })
  test('primitives that overlap and never move against each other are asked about once, as a warning with group() first', async () => {
    const r = await check((s) => {
      box({ id: 'body', width: 3, height: 1, depth: 1.5 }).at(0, 0, 0)
      box({ id: 'cabin', width: 1.4, height: 1, depth: 1.3 }).at(0.3, 0.7, 0)
      box({ id: 'boot', width: 1, height: 0.6, depth: 1.3 }).at(-1.3, 0.6, 0)
      s.step('A car', (st: any) => { st.wait(1) })
    }, ['INTERPENETRATE'])
    expect(r.codes).toEqual(['INTERPENETRATE warn'])
    expect(r.diags[0]!.ids.sort()).toEqual(['body', 'boot', 'cabin'])
    expect(r.diags[0]!.fix[0]).toMatch(/^if they are one body, say so: group\(\[/)
  })
  test('a wheel that spins on an axle through it is one body, not a collision (the overlap never changes)', async () => {
    const r = await check((s) => {
      const turn = s.param('turn', { value: 0, min: 0, max: 360, unit: '°' })
      cylinder({ id: 'wheel', radius: 2, height: 0.5 }).at(0, 0, 0).rotate({ about: 'y', deg: turn })
      cylinder({ id: 'axle', radius: 0.3, height: 2 }).at(0, 0, 0)
      s.step('Spin', (st: any) => { st.set(turn, 180) })
    }, ['INTERPENETRATE', 'COLLIDE-IN-MOTION'])
    expect(r.codes).toEqual(['INTERPENETRATE warn'])
  })
  test('a part that is still entering is not judged; a kind without a solid description is reported as not measured', async () => {
    const r = await check((s) => {
      box({ id: 'block', width: 3, height: 1, depth: 3 })
      // a kind that says it is a solid and describes none (no sdf, no mesh): every kind of src/r3d has one since the merge
      blob({ id: 'nozzle' }).at(0, 0.2, 0)
      s.step('One', (st: any) => { st.wait(1) })
    }, ['INTERPENETRATE'])
    expect(r.codes).toEqual([])
    expect(r.stats.unknown.INTERPENETRATE![0]).toMatchObject({ ids: ['nozzle'] })
    expect(r.stats.unknown['*']![0]!.why).toMatch(/no browser/)
  })
})

describe('COLLIDE-IN-MOTION and PARAM-BREAKS', () => {
  const ram = (z: number) => (s: any) => {
    const travel = s.param('travel', { value: 0, min: 0, max: 1 })
    const floor = box({ id: 'floor', width: 9, height: 0.2, depth: 3 }).at(0, -0.1, 0)
    box({ id: 'post', width: 0.5, height: 1.5, depth: 0.5 }).nextTo(floor, 'up', 0)
    box({ id: 'ram', width: 1, height: 0.6, depth: 0.6 }).at(() => [-3 + 6 * travel(), 0.3, z])
    s.step('Start', (st: any) => { st.wait(1) })
    s.step('Across', (st: any) => { st.set(travel, 1) })
  }
  test('clear at the end of every step, through the post on the way: named with the moment and the command that shows it', async () => {
    const r = await check(ram(0))
    expect(r.codes).toEqual(['COLLIDE-IN-MOTION error'])
    const d = r.diags[0]!
    expect(d).toMatchObject({ ids: ['ram', 'post'], step: 2, measured: 0.25 })
    expect(d.what).toMatch(/#ram passes through #post \(0\.25 units deep\) 50% of the way through step 2 \(t = [\d.]+ s\); they are clear at the end of every step/)
    expect(d.fix[d.fix.length - 1]).toMatch(/^see it: mimir shot <scene> --at [\d.]+$/)
  })
  test('passing beside it is clean', async () => { expect((await check(ram(1))).codes).toEqual([]) })
  test('a collision that only a phase of a cyclic param shows is found (8 phases)', async () => {
    const r = await check((s) => {
      const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°' })
      box({ id: 'stop', width: 0.4, height: 0.4, depth: 0.4 }).at(0, -2, 0)
      box({ id: 'arm', width: 0.3, height: 0.3, depth: 0.3 }).at(() => [2 * Math.sin((crank() * Math.PI) / 180), 2 * Math.cos((crank() * Math.PI) / 180), 0])
      s.step('A little', (st: any) => { st.set(crank, 40) })
    })
    expect(r.codes).toEqual(['COLLIDE-IN-MOTION error', 'HATCH-USE info'])
    expect(r.diags[0]!).toMatchObject({ params: { crank: 180 } })
    expect(r.diags[0]!.what).toContain('when crank = 180')
    expect(r.diags[0]!.fix.at(-1)).toBe('see it: mimir shot <scene> --step 1 --set crank=180')
  })
  const stroke = (max: number) => (s: any) => {
    const p = s.param('stroke', { value: 1, min: 0.5, max })
    const floor = box({ id: 'floor', width: 3, height: 0.2, depth: 3 }).at(0, -0.1, 0)
    box({ id: 'piston', width: 1.6, height: 1, depth: 1.6 }).at(() => [0, 0.5 + p() * 0.5, 0])
    const post = box({ id: 'post', width: 0.3, height: 2.2, depth: 0.3 }).nextTo(floor, 'up', 0).shift(1.2, 0, 1.2)
    box({ id: 'head', width: 3, height: 0.4, depth: 3 }).nextTo(post, 'up', 0).shift(-1.2, 0, -1.2)
    s.step('The stroke', (st: any) => { st.set(p, 1.5) })
  }
  test('sound in the story, broken at the slider maximum: PARAM-BREAKS with the value, the depth and a fix about the param', async () => {
    const r = await check(stroke(3))
    expect(r.codes).toEqual(['PARAM-BREAKS error'])
    expect(r.diags[0]!).toMatchObject({ ids: ['piston', 'head'], params: { stroke: 3 }, measured: 0.3 })
    expect(r.diags[0]!.what).toMatch(/when stroke = 3 \(its maximum\) #piston cuts 0\.3 units into #head/)
    expect(r.diags[0]!.fix[0]).toContain("s.param('stroke'")
  })
  test('a slider that stops in time is clean', async () => { expect((await check(stroke(2))).codes).toEqual([]) })
})

describe('FLOATING', () => {
  const table = (lamp: (top: any) => void) => (s: any) => {
    const top = box({ id: 'top', width: 4, height: 0.2, depth: 2.4 }).at(0, 2, 0)
    ;[[-1.8, -1], [1.8, -1], [-1.8, 1], [1.8, 1]].forEach(([x, z], i) => box({ id: `leg${i + 1}`, width: 0.2, height: 2, depth: 0.2 }).nextTo(top, 'down', 0).shift(x, 0, z))
    lamp(top)
    s.step('A table', (st: any) => { st.wait(1) })
  }
  test('a part that hovers near the model: the gap, the direction, a relation first, then the literal move, then the exemption', async () => {
    const r = await check(table(() => { cylinder({ id: 'lamp', radius: 0.3, height: 0.8 }).at(0.8, 2.8, 0) }), ['FLOATING'])
    expect(r.codes).toEqual(['FLOATING error'])
    const d = r.diags[0]!
    expect(d).toMatchObject({ ids: ['lamp'], measured: 0.3 })
    expect(d.what).toBe('#lamp touches nothing else: the nearest part, #top, is 0.3 units away (along -Y).')
    expect(d.fix).toEqual(["close the gap with a relation: lamp.nextTo(top, 'up', 0)", 'or move it by the gap: lamp.shift(0, -0.3, 0)', "if it is meant to hang free: lamp.allow('FLOATING')"])
  })
  test('standing on it, allowed to hover, or far away from a small model: clean; far away from a real assembly: a warning', async () => {
    expect((await check(table((top) => { cylinder({ id: 'lamp', radius: 0.3, height: 0.8 }).nextTo(top, 'up', 0) }), ['FLOATING'])).codes).toEqual([])
    expect((await check(table(() => { cylinder({ id: 'lamp', radius: 0.3, height: 0.8 }).at(0.8, 2.8, 0).allow('FLOATING') }), ['FLOATING'])).codes).toEqual([])
    const far = await check(table(() => { cylinder({ id: 'lamp', radius: 0.3, height: 0.8 }).at(0.8, 6, 0) }), ['FLOATING'])
    expect(far.codes).toEqual(['FLOATING warn'])
    expect(far.diags[0]!.what).toContain('far from the 5 parts that hold together')
  })
  test('nothing else holds together, but the part almost touches its neighbour: still a near miss (a table whose legs all stop short)', async () => {
    const r = await check((s) => {
      box({ id: 'top', width: 4, height: 0.2, depth: 2.4 }).at(0, 2, 0)
      ;[-1.8, 1.8].forEach((x, i) => box({ id: `leg${i + 1}`, width: 0.2, height: 1.8, depth: 0.2 }).at(x, 0.92, 0))
      s.step('A table', (st: any) => { st.wait(1) })
    }, ['FLOATING'])
    expect(r.codes).toEqual(['FLOATING error'])
    expect(r.diags[0]!.ids).toEqual(['leg1', 'leg2'])
    expect(r.diags[0]!.what).toBe('#leg1 touches nothing else: the nearest part, #top, is 0.08 units away (along +Y). 1 more like it: #leg2.')
  })
  test('bodies that are meant to be apart are not an assembly: nothing touches anything, nothing is reported', async () => {
    const r = await check((s) => {
      sphere({ id: 'sun', radius: 1 })
      sphere({ id: 'earth', radius: 0.3 }).at(3, 0, 0)
      sphere({ id: 'mars', radius: 0.2 }).at(-4.5, 0, 0)
      s.step('Planets', (st: any) => { st.wait(1) })
    })
    expect(r.codes).toEqual([])
  })
  test('something that moves near the model (an orbit) is not a part that failed to touch; a glass housing is not a floater', async () => {
    const r = await check((s) => {
      const turn = s.param('turn', { value: 0, min: 0, max: 360, unit: '°' })
      const base = box({ id: 'base', width: 2, height: 0.4, depth: 2 })
      box({ id: 'post', width: 0.4, height: 1.5, depth: 0.4 }).nextTo(base, 'up', 0)
      sphere({ id: 'moon', radius: 0.2 }).at(() => [1.2 * Math.cos((turn() * Math.PI) / 180), 2.3, 1.2 * Math.sin((turn() * Math.PI) / 180)])
      tube({ id: 'jar', radius: 1.8, thickness: 0.1, height: 3, material: 'glass' }).at(0, 1.4, 0)
      s.step('Orbit', (st: any) => { st.set(turn, 180) })
    })
    expect(r.codes).toEqual([])
  })
})

describe('CONTAINED, COINCIDENT, CAMERA-CLIP', () => {
  test('attach() without anchors centres a part inside an opaque one: it can never be seen', async () => {
    const r = await check((s) => {
      const housing = box({ id: 'housing', width: 3, height: 2, depth: 2 })
      sphere({ id: 'core', radius: 0.5 }).attach(housing)
      s.step('One', (st: any) => { st.wait(1) })
    })
    expect(r.codes).toEqual(['CONTAINED error'])
    expect(r.diags[0]!).toMatchObject({ ids: ['core', 'housing'] })
    expect(r.diags[0]!.fix[0]).toBe("put it on the outside: core.nextTo(housing, 'up', 0)")
  })
  test('inside glass, inside something that is cut open in one step, or declared: clean', async () => {
    expect((await check((s) => { const h = box({ id: 'housing', width: 3, height: 2, depth: 2, material: 'glass' }); sphere({ id: 'core', radius: 0.5 }).attach(h); s.step('One', (st: any) => { st.wait(1) }) })).codes).toEqual([])
    expect((await check((s) => { const h = box({ id: 'housing', width: 3, height: 2, depth: 2 }); const core = sphere({ id: 'core', radius: 0.5 }).attach(h); claim.inside(core, h); s.step('One', (st: any) => { st.wait(1) }) })).codes).toEqual([])
    const shown = await check((s) => {
      const h = box({ id: 'housing', width: 3, height: 2, depth: 2 })
      sphere({ id: 'core', radius: 0.5 }).attach(h)
      s.step('Closed', (st: any) => { st.wait(1) })
      s.step('Open', (st: any) => { st.play(h.to.opacity(0.2)) })
    })
    expect(shown.codes).toEqual([])
  })
  test('two parts of the same size in the same place', async () => {
    const r = await check((s) => {
      const head = box({ id: 'head', width: 4, height: 0.5, depth: 2 })
      cylinder({ id: 'intake', radius: 0.4, height: 1 }).nextTo(head, 'up', 0)
      cylinder({ id: 'exhaust', radius: 0.4, height: 1 }).nextTo(head, 'up', 0)
      s.step('One', (st: any) => { st.wait(1) })
    })
    expect(r.codes).toEqual(['COINCIDENT error'])
    expect(r.diags[0]!).toMatchObject({ ids: ['intake', 'exhaust'], measured: 100, limit: 90 })
  })
  test('the camera inside a solid: said about the end of the step, with the st.camera() call as the cause', async () => {
    const r = await check((s) => {
      const block = box({ id: 'block', width: 6, height: 4, depth: 6 })
      s.step('The block', (st: any) => { st.wait(1) })
      s.step('Closer', (st: any) => { st.camera({ target: block, distance: 1.5 }) })
    })
    expect(r.codes).toEqual(['CAMERA-CLIP error'])
    expect(r.diags[0]!.what).toBe('the camera is inside #block at the end of step 2: the frame shows the inside of the part, or nothing.')
    expect(r.diags[0]!.fix[0]).toContain('st.camera() call of step 2')
  })
})

describe('MECH-OPEN', () => {
  test('an invariant that a mechanism declares is sampled over the story, 8 phases and the slider extremes', async () => {
    const r = await check((s) => {
      const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°' })
      const pin = sphere({ id: 'pin', radius: 0.1 }).at(() => [Math.sin((crank() * Math.PI) / 180), Math.cos((crank() * Math.PI) / 180), 0])
      const eye = sphere({ id: 'eye', radius: 0.1 }).at(() => [crank() > 100 ? 0.6 : Math.sin((crank() * Math.PI) / 180), Math.cos((crank() * Math.PI) / 180), 0.5])
      declareInvariant({ name: 'rod on pin', parts: [eye, pin], what: 'the rod end #eye stays on the crank pin #pin', residual: (f) => Math.hypot(f.anchor(eye)[0] - f.anchor(pin)[0], f.anchor(eye)[1] - f.anchor(pin)[1]), fix: ['drive #eye from #pin: eye.attach(pin)'] })
      s.step('A quarter', (st: any) => { st.set(crank, 90) })
    }, ['MECH-OPEN'])
    expect(r.codes).toEqual(['MECH-OPEN error'])
    const d = r.diags[0]!
    expect(d.ids).toEqual(['eye', 'pin'])
    expect(d.what).toMatch(/^the rod end #eye stays on the crank pin #pin does not hold: it is off by [\d.]+ units when crank = \d+/)
    expect(d.fix[0]).toBe('drive #eye from #pin: eye.attach(pin)')
    expect(d.params).toBeDefined()
  })
  test('a rod between two points that changes length is a warning; one that keeps it, or is allowed to stretch, is clean', async () => {
    const rod = (keep: boolean, allow = false) => (s: any) => {
      const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°' })
      const pin = sphere({ id: 'pin', radius: 0.1 }).at(() => [Math.sin((crank() * Math.PI) / 180), Math.cos((crank() * Math.PI) / 180), 0])
      const slider = box({ id: 'slider', width: 0.4, height: 0.4, depth: 0.4 }).at(() => { const [x, y] = pin.world(); return keep ? [0, y + Math.sqrt(9 - x * x), 0] : [0, 3, 0] })
      const r = between(pin, slider, { id: 'rod', radius: 0.05 })
      if (allow) r.allow('MECH-OPEN')
      s.step('Half', (st: any) => { st.set(crank, 180) })
    }
    const bad = await check(rod(false), ['MECH-OPEN'])
    expect(bad.codes).toEqual(['MECH-OPEN warn'])
    expect(bad.diags[0]!.what).toMatch(/#rod spans two points whose distance goes from 2 .* to 4 /)
    expect((await check(rod(true), ['MECH-OPEN'])).codes).toEqual([])
    expect((await check(rod(false, true), ['MECH-OPEN'])).codes).toEqual([])
  })
})

describe('performance: 40 parts, 8 steps', () => {
  test('the pure rules of a full check take well under 3 s, and parts that do not move are measured once', async () => {
    const r = await check((s) => {
      const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°' })
      const lift = s.param('lift', { value: 0, min: 0, max: 1 })
      const base = box({ id: 'base', width: 12, height: 0.4, depth: 6 })
      // placed with numbers, so that every contact has to be measured (a relation would be taken at its word)
      const posts = Array.from({ length: 36 }, (_, i) => { const h = 1 + (i % 3) * 0.4; return box({ id: `post${i}`, width: 0.4, height: h, depth: 0.4 }).at(-5.5 + (i % 12), 0.2 + h / 2, -2 + Math.floor(i / 12) * 2) })
      const wheel = cylinder({ id: 'wheel', radius: 0.8, height: 0.3 }).nextTo(posts[5], 'up', 0).rotate({ about: 'y', deg: crank })
      const cap = box({ id: 'cap', width: 0.6, height: 0.2, depth: 0.6 }).nextTo(posts[20], 'up', () => lift())
      for (let k = 0; k < 8; k++) s.step(`Step ${k + 1}`, (st: any) => { st.set(crank, 45 * (k + 1)); if (k === 3) st.set(lift, 0.5); st.label(k % 2 ? wheel : cap) })
    })
    expect(r.model.nodes.length).toBe(39)
    expect(r.model.steps.length).toBe(8)
    expect(r.codes).toEqual([])
    console.log(`  pure check of 39 parts x 8 steps: ${r.stats.ms} ms, ${r.stats.samples} samples, ${r.stats.pairTests} pair measurements, ${r.stats.pairHits} from the cache`)
    expect(r.stats.ms).toBeLessThan(3000)
    expect(r.stats.pairHits).toBeGreaterThan(r.stats.pairTests * 5)
  })
})
