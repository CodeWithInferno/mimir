// What the M1 merge changed in shared code, each with the case that showed it (docs/STATUS.md, "what the merge changed").
import { describe, expect, test } from 'bun:test'
import { compile, defineKind, defineKindSetter, boxOf, scene, spaceOf, type MNode } from '../../../src/core/index.ts'
import { group, rect, polyline, text } from '../../../src/r2d/index.ts'
import { box, cone, extrude, lathe, sweep, mesh } from '../../../src/r3d/index.ts'
import { create, write } from '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/check.ts'
import '../../../src/guide/check.ts'
import { runCheck } from '../../../src/check/engine.ts'
import { codeOnly, featuresIn, localImports, type FeatureInfo } from '../../../src/host/index.ts'

const build = (fn: (s: any) => void) => compile(scene({ title: 'merge' }, fn))

describe('core', () => {
  test('a kind\'s own setter wins over a general setter of the same name, on the object and on .to', () => {
    // src/r2d has a general 2D `fit`; axes and number lines have their own (plot): the general one used to shadow it
    const probe = defineKind({ name: 'mergeFitProbe', space: '2d', schema: { size: { type: 'number', default: 1 } }, bounds: (_n, r) => boxOf(r.size / 2, r.size / 2, 0) })
    defineKindSetter('mergeFitProbe', 'fit', (_n: MNode, v: unknown) => ({ size: typeof v === 'number' ? v : 7 }))
    let p!: any, q!: any
    const m = build((s) => { p = probe(); q = probe(); p.fit(3); s.step('x', (st: any) => { st.play(q.to.fit(5)) }) })
    expect(m.diagnostics.list.map((d) => d.code)).toEqual([])
    expect(m.state(0).prop(p, 'size')).toBe(3)
    expect(m.state(m.duration).prop(q, 'size')).toBe(5)
  })
  test('a chapter does not clear a container whose members have not entered yet: they enter in the new chapter', () => {
    let a!: any, late!: any, g!: any
    const m = build((s) => {
      a = rect({ id: 'a' }); late = rect({ id: 'late' }).at(3, 0); g = group([late])
      s.chapter('One'); s.step('first', (st: any) => { st.play(create(a)) })
      s.chapter('Two'); s.step('second', (st: any) => { st.play(create(late)) })
    })
    const end = m.state(m.duration - 1e-3)
    expect([end.visible(a), end.visible(g), end.visible(late)]).toEqual([false, true, true])
  })
  test('a token on an edge that ends on a 3D part is on the screen like its edge: the 2D camera moves neither', async () => {
    const { edge, node, tokens } = await import('../../../src/diagram/index.ts')
    let onScreen!: MNode, inWorld!: MNode
    const m = build((s) => {
      s.viewport('left', 0.4)
      const part = box({ id: 'part' })
      const a = node('a', { id: 'a' }).at(3, 0), b = node('b', { id: 'b' }).at(5, 0)
      onScreen = tokens(edge(a, part, { id: 'toPart' }), { id: 'onScreen' }) as unknown as MNode
      inWorld = tokens(edge(a, b, { id: 'flat' }), { id: 'inWorld' }) as unknown as MNode
      s.step('x', (st: any) => { st.wait(1) })
    })
    expect(m.diagnostics.list.map((d) => d.code)).toEqual([])
    expect([spaceOf(onScreen), spaceOf(inWorld)]).toEqual(['hud', '2d'])
  })
  test('write records the reveal only: glyphs are staggered by the text backend, so a written title needs no lazy chunk of the verbs', () => {
    const m = build((s) => { const t = text('hello'); s.step('x', (st: any) => { st.play(write(t)) }) })
    expect(m.chunksNeeded()).not.toContain('anim')
  })
})

describe('check', () => {
  const run = async (fn: (s: any) => void, rules: string[]) => (await runCheck(null, { rules }, build(fn))).map((d) => `${d.code} ${d.severity}`)
  test('PLACE-NONE: a group whose members were placed is where they are, not a pile at the origin', async () => {
    expect(await run((s) => {
      group([rect({ id: 'x' }).at(-2, 0), rect({ id: 'y' }).at(2, 0)])
      polyline([[-2, -1], [0, 1], [2, -1]], { id: 'wave' })
      s.step('One', (st: any) => { st.wait(1) })
    }, ['PLACE-NONE'])).toEqual([])
  })
  test('every solid kind of the 3D layer describes its solid: cone, extrude, lathe, sweep and mesh are measured', async () => {
    // a cone whose tip is pushed into a block is a measured overlap, not "not measured"
    const out = await runCheck(null, { rules: ['INTERPENETRATE'] }, build((s) => {
      box({ id: 'block', width: 3, height: 1, depth: 3 })
      cone({ id: 'nozzle', radius: 0.6, height: 1.2 }).at(0, 0.4, 0)
      lathe([[0, 0], [0.5, 0], [0.5, 1], [0, 1]], { id: 'plug' }).at(1, -0.2, 0)
      sweep([[-1, 0.2, 1], [1, 0.2, 1]], { id: 'wire', radius: 0.2 })
      extrude([[0, 0], [1, 0], [1, 1], [0, 1]], { id: 'plate', depth: 0.5 }).at(-1.4, 0.2, -1)
      mesh({ id: 'wedge', positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], indices: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]] }).at(3, 3, 3)
      s.step('One', (st: any) => { st.wait(1) })
    }))
    expect(out.filter((d) => d.severity === 'unknown')).toEqual([])
    const hit = out.filter((d) => d.code === 'INTERPENETRATE').flatMap((d) => d.ids)
    for (const id of ['nozzle', 'plug', 'wire', 'plate']) expect(hit).toContain(id)
    expect(hit).not.toContain('wedge')
  })
  test('NO-VISUAL-BEAT: a first step that only talks shows the stage (a beat); a later one that only talks is reported', async () => {
    const out = await runCheck(null, { rules: ['NO-VISUAL-BEAT'] }, build((s) => {
      rect({ id: 'a' })
      s.step('first', (st: any) => { st.say('Here is a part.') })
      s.step('talk', (st: any) => { st.say('Parts are interesting.') })
    }))
    expect(out.map((d) => [d.code, d.step])).toEqual([['NO-VISUAL-BEAT', 2]])
  })
})

describe('on-demand modules: which ones a scene uses, read from its source', () => {
  const table: FeatureInfo[] = [
    { module: 'kit', chunk: 'kitapi', names: ['kit', 'crankSlider'], methods: [] },
    { module: 'diagram', chunk: 'diagramapi', names: ['node', 'queue', 'graph'], methods: [] },
    { module: 'plot', chunk: 'plotapi', names: ['axes', 'readout', 'guide'], methods: ['dock'] },
  ]
  test('a public name used as a word of its own asks for its module; comments, strings and members do not', () => {
    expect(featuresIn("import { scene, kit } from 'mimir'\nconst g = kit.gear({ teeth: 12 })", table)).toEqual(['kit'])
    expect(featuresIn("// a graph of nodes\nst.say('the [queue](q) fills; see the graph')\nconst n = info.guide.steps; a.node; b.axes", table)).toEqual([])
    expect(featuresIn('const label = `${readout("x", v)} of ${1}`', table)).toEqual(['plot'])
    expect(featuresIn("part.dock(other)", table)).toEqual(['plot']) // a method a module adds to other objects
  })
  test('a name the scene declares itself is its own object, not the public function', () => {
    expect(featuresIn("const queue = rect({ id: 'queue' })\nconst readout = text('x')\nfunction guide() {}\nqueue.at(0, 0)", table)).toEqual([])
    expect(featuresIn("const q = queue({ slots: 4 })", table)).toEqual(['diagram'])
  })
  test('codeOnly keeps the code inside ${…} of a template and drops the rest of it; localImports lists relative specifiers', () => {
    expect(codeOnly('a(`x ${b(`y${c}`)} z`) // d\n/* e */ f("g")').replace(/\s+/g, ' ').trim()).toBe('a( b( c ) ) f( )')
    expect(localImports("import a from './a.js'\nimport { scene } from 'mimir'\nexport * from '../lib/b.js'\nconst c = await import('./c.js')")).toEqual(['./a.js', '../lib/b.js', './c.js'])
  })
})
