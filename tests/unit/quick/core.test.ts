// explain(): the stage (pure layout), the story compiler, validation that never throws, and the plain-text account.
// No browser: scenes are compiled under bun and read back from the model.
import { describe, expect, test } from 'bun:test'
import { compile, FRAME_H, FRAME_W, type SceneModel } from '../../../src/core/index.ts'
import { circle } from '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/index.ts'
import { sequence } from '../../../src/diagram/index.ts'
import '../../../src/diagram/diagram.chunk.ts'
import {
  cells, custom, defineBlock, describeAccount, explain, formula, blockKinds, layoutStage, linksOf, plainOf, quickAccount, reduceFormula, reduceSequence, STAGE_DEFAULTS,
  type BlockDef, type ExplainSpec,
} from '../../../src/quick/index.ts'

const build = (spec: unknown): SceneModel => compile(explain(spec as ExplainSpec))
const diags = (m: SceneModel): string[] => m.diagnostics.list.map((d) => `${d.code}: ${d.what} | ${d.fix.join(' | ')}`)
const R = String.raw

describe('stage', () => {
  const inside = (r: { left: number; right: number; top: number; bottom: number }): void => {
    expect(r.left).toBeGreaterThanOrEqual(-FRAME_W / 2 + STAGE_DEFAULTS.margin - 1e-9)
    expect(r.right).toBeLessThanOrEqual(FRAME_W / 2 - STAGE_DEFAULTS.margin + 1e-9)
    expect(r.top).toBeLessThanOrEqual(FRAME_H / 2 - STAGE_DEFAULTS.margin + 1e-9)
    // always above the caption strip
    expect(r.bottom).toBeGreaterThanOrEqual(-FRAME_H / 2 + STAGE_DEFAULTS.captionStrip - 1e-9)
  }
  test('one block gets the whole content area, under the title', () => {
    const l = layoutStage([{ id: 'a' }], { title: true })
    expect(l.arrangement).toBe('single')
    expect(l.rects.a).toEqual(l.content)
    expect(l.title!.bottom).toBeGreaterThan(l.content.top)
    inside(l.rects.a!)
    expect(layoutStage([{ id: 'a' }]).content.height).toBeGreaterThan(l.content.height)
  })
  test('a 3D block and 2D blocks: the panel on the left, the others stacked on the right', () => {
    const l = layoutStage([{ id: 'chart' }, { id: 'engine', is3d: true }, { id: 'note' }], { title: true })
    expect(l.panel).toEqual(l.rects.engine!)
    expect(l.rects.engine!.right).toBeLessThan(l.rects.chart!.left)
    expect(l.rects.chart!.left).toBe(l.rects.note!.left)
    expect(l.rects.chart!.bottom).toBeGreaterThan(l.rects.note!.top)
    for (const r of Object.values(l.rects)) inside(r)
    expect(layoutStage([{ id: 'engine', is3d: true }]).panel).toEqual(layoutStage([{ id: 'x' }]).content)
  })
  test('several 2D blocks: wide ones stack, tall ones stand side by side, and nothing overlaps or leaves the safe area', () => {
    expect(layoutStage([{ id: 'a', aspect: 6 }, { id: 'b', aspect: 6 }]).arrangement).toBe('column')
    expect(layoutStage([{ id: 'a', aspect: 0.7 }, { id: 'b', aspect: 0.7 }]).arrangement).toBe('row')
    for (let n = 2; n <= 7; n++) for (const aspect of [0.5, 1, 1.6, 4]) {
      const l = layoutStage(Array.from({ length: n }, (_, i) => ({ id: `b${i}`, aspect: i % 2 ? aspect : 1.6, weight: 1 + (i % 3) })), { title: n % 2 === 0 })
      const rects = Object.values(l.rects)
      expect(rects.length).toBe(n)
      rects.forEach(inside)
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = rects[i]!, b = rects[j]!
        expect(a.right <= b.left + 1e-9 || b.right <= a.left + 1e-9 || a.top <= b.bottom + 1e-9 || b.top <= a.bottom + 1e-9).toBe(true)
      }
      for (const r of rects) { expect(r.width).toBeGreaterThan(0.5); expect(r.height).toBeGreaterThan(0.3) }
    }
  })
  test('a heavier block gets more room; layout options are named defaults that can be overridden', () => {
    const l = layoutStage([{ id: 'a', aspect: 1, weight: 3 }, { id: 'b', aspect: 1, weight: 1 }, { id: 'c', aspect: 1, weight: 1 }])
    expect(l.arrangement).toBe('row')
    expect(l.rects.a!.width).toBeGreaterThan(l.rects.b!.width * 1.5)
    expect(l.rects.b!.width).toBeCloseTo(l.rects.c!.width, 9)
    // nobody is given room it cannot use while another block could: a wide chart beside a squarer diagram
    const m = layoutStage([{ id: 'wide', aspect: 2.1, weight: 2 }, { id: 'chart', aspect: 1.9, weight: 1 }], { title: true })
    expect(m.arrangement).toBe('row')
    expect(m.rects.wide!.width).toBeGreaterThan(m.rects.chart!.width)
    for (const r of [m.rects.wide!, m.rects.chart!]) expect(r.width).toBeGreaterThan(4)
    expect(layoutStage([{ id: 'a' }], { options: { margin: 1 } }).content.width).toBeCloseTo(FRAME_W - 2, 9)
  })
})

describe('narration links', () => {
  test('links are read with their verb, several targets and options', () => {
    expect(linksOf('The [row](row) and [both](ring:row.lo+row.hi,hold).')).toEqual([{ words: 'row', verb: '', targets: ['row'], options: '' }, { words: 'both', verb: 'ring', targets: ['row.lo', 'row.hi'], options: ',hold' }])
    expect(plainOf('The [row](row) is [sorted](row.0).')).toBe('The row is sorted.')
  })
})

describe('explain()', () => {
  const search = (): unknown => ({
    title: 'How binary search works',
    stage: { row: cells([3, 8, 12, 17, 21, 34, 42, 55], { pointers: ['lo', 'mid', 'hi'] }) },
    story: function* ({ row }: any) {
      const target = 34
      let lo = 0, hi = row.length - 1
      yield { say: `We want ${target}. The [row](row) is sorted.`, row: { lo, hi } }
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        yield { say: `Look at the [middle](row.mid): ${row.value(mid)}.`, row: { mid } }
        if (row.value(mid) === target) { yield { say: 'Found it.', row: { found: mid } }; return }
        if (row.value(mid) < target) lo = mid + 1; else hi = mid - 1
        yield { say: 'Half of the row can no longer hold it.', row: { lo, hi, mid: null, lit: [lo, hi] } }
      }
    },
  })
  test('a generator story is a real run: one step per yield, no diagnostics, built in milliseconds', () => {
    const t0 = performance.now()
    const m = build(search())
    const ms = performance.now() - t0
    expect(diags(m)).toEqual([])
    expect(m.steps.length).toBe(5)
    expect(m.opts.title).toBe('How binary search works')
    expect(ms).toBeLessThan(250)
    const a = quickAccount(m)!
    expect(a.steps.map((s) => s.blocks.row)).toEqual([
      '[3 8 12 17 21 34 42 55] lo=0 hi=7',
      '[3 8 12 17 21 34 42 55] lo=0 mid=3 hi=7',
      '[3 8 12 17 21 34 42 55] lo=4 hi=7 · dim slots 0..3',
      '[3 8 12 17 21 34 42 55] lo=4 mid=5 hi=7 · dim slots 0..3',
      '[3 8 12 17 21 34 42 55] lo=4 mid=5 hi=7 · dim slots 0..3 · found 34',
    ])
    expect(a.steps[0]!.entered).toEqual(['row'])
    expect(a.steps[1]!.points).toEqual([{ words: 'middle', target: 'row.mid' }])
    expect(a.steps.every((s) => s.changed.includes('row'))).toBe(true)
  })
  test('links become narration spans on the real objects; the step lasts as long as what it says', () => {
    const m = build(search())
    const spans = m.steps[1]!.narration[0]!.spans
    expect(spans.length).toBe(1)
    expect(m.byId.has(spans[0]!.targets[0]!)).toBe(true)
    expect(spans[0]!.targets[0]).toBe('row.mid')
    expect(m.steps[0]!.narration[0]!.plain).toBe('We want 34. The row is sorted.')
    // a longer sentence makes a longer step; no duration is written anywhere
    const short = build({ stage: { row: cells([1, 2]) }, story: [{ say: 'Two [values](row).' }] })
    const long = build({ stage: { row: cells([1, 2]) }, story: [{ say: 'Two [values](row), and a much longer sentence that takes a good while to say out loud.' }] })
    expect(long.duration).toBeGreaterThan(short.duration + 2)
  })
  test('the story reads the state after every step it has yielded (a real algorithm)', () => {
    const seen: unknown[] = []
    const m = build({
      stage: { row: cells([5, 2, 9]) },
      story: function* ({ row }: any) {
        yield { say: 'A [row](row).' }
        seen.push(row.values())
        yield { row: { swap: [0, 1] } }
        seen.push(row.values(), row.value(0), row.length)
        yield { row: [{ compare: [1, 2] }, { insert: { at: 3, value: 7 } }, { remove: 0 }] }
        seen.push(row.values())
      },
    })
    expect(diags(m)).toEqual([])
    expect(seen).toEqual([[5, 2, 9], [2, 5, 9], 2, 3, [5, 9, 7]])
    // a step without narration still has a length, and a title
    expect(m.steps[1]!.t1 - m.steps[1]!.t0).toBeGreaterThan(1)
    expect(m.steps.map((s) => s.title)).toEqual(['A row', 'Step 2', 'Step 3'])
  })
  test('the whole stage comes on in step one, in stage order, so the frame is balanced from the first second', () => {
    const m = build({
      stage: { a: cells([1, 2]), b: cells([3, 4]), c: cells([5, 6]) },
      story: [{ say: 'First [one](a).' }, { say: 'Then [another](b).', b: { found: 0 } }, { say: 'Done.', a: { found: 1 } }],
    })
    expect(diags(m)).toEqual([])
    expect(quickAccount(m)!.steps.map((s) => s.entered)).toEqual([['a', 'b', 'c'], [], []])
    expect(quickAccount(m)!.steps.map((s) => s.onStage)).toEqual([['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']])
    const none = build({ stage: { a: cells([1, 2]), b: cells([3, 4]) }, story: [{ say: 'Everything at once.' }] })
    expect(quickAccount(none)!.steps[0]!.entered).toEqual(['a', 'b'])
  })
  test('controls become params and `set` sweeps them', () => {
    const m = build({
      controls: { crank: { from: 0, to: 360, unit: '°', cyclic: true }, speed: { from: 1, to: 5, value: 2, hidden: true } },
      stage: { row: cells([1, 2]) },
      story: [{ say: 'Turn [it](row).', set: { crank: 90 } }, { say: 'Further.', set: { crank: 180, speed: 4 } }],
    })
    expect(diags(m)).toEqual([])
    expect(m.params.map((p) => [p.name, p.min, p.max, p.value, p.unit])).toEqual([['crank', 0, 360, 0, '°'], ['speed', 1, 5, 2, '']])
    const crank = m.params[0]!
    expect(m.state(m.steps[0]!.t1 - 0.01).param(crank)).toBeCloseTo(90, 3)
    expect(m.state(m.steps[1]!.t1 - 0.01).param(crank)).toBeCloseTo(180, 3)
    expect(quickAccount(m)!.steps[1]!.set).toEqual({ crank: 180, speed: 4 })
    expect(quickAccount(m)!.controls.crank).toEqual({ from: 0, to: 360, value: 0, unit: '°', cyclic: true })
  })
  test('chapters keep the stage and notes go to read mode', () => {
    const m = build({ stage: { row: cells([1, 2, 3], { pointers: ['p'] }) }, story: [{ chapter: 'One', say: 'A [row](row).', row: { p: 0 } }, { chapter: 'Two', say: 'Again.', note: 'More **depth**.', row: { p: 2 } }] })
    expect(diags(m)).toEqual([])
    expect(m.chapters.map((c) => c.title)).toEqual(['One', 'Two'])
    expect(m.steps[1]!.notes).toEqual(['More **depth**.'])
    // the row and its pointer are still on stage at the end of chapter two
    const f = m.state(m.duration - 0.01)
    expect(f.opacity(m.byId.get('row')!)).toBeGreaterThan(0.9)
    expect(f.reveal(m.byId.get('row.p')!).p).toBeGreaterThan(0.9)
  })
})

describe('validation never throws', () => {
  test('unknown top-level key, block kind, step key, state key and link targets: one precise diagnostic each, the rest still renders', () => {
    const m = build({
      title: 'Typos', colour: 'blue',
      stage: { row: cells([3, 4, 5], { pointers: ['leg'] }), ghost: { kind: 'cels' }, nothing: 42 },
      story: [
        { say: 'Two [legs](row.leg).', row: { leg: 0 } },
        { say: 'A [typo](row.nope) and a [stranger](nobody.x).', row: { legg: 1, found: 2 }, rwo: { leg: 2 }, sett: { a: 1 } },
      ],
    })
    const list = diags(m)
    expect(list.length).toBe(8)
    expect(list[0]).toContain('explain() has no key "colour"')
    expect(list[1]).toContain('names the block kind "cels"')
    expect(list[1]).toContain('did you mean "cells"?')
    expect(list[1]).toMatch(/blocks: .*cells.*formula/)
    expect(list[2]).toContain('stage.nothing is not a block (got number)')
    expect(list.find((d) => d.includes('"row.nope"'))).toContain('parts of row: leg, 0, 1, 2')
    expect(list.find((d) => d.includes('"nobody.x"'))).toContain('targets: row, row.leg')
    expect(list.find((d) => d.includes('"rwo"'))).toContain('did you mean "row"?')
    expect(list.find((d) => d.includes('"sett"'))).toContain('did you mean "set"?')
    expect(list.find((d) => d.includes('no state "legg"'))).toContain('did you mean "leg"? states of cells: leg, lit, dim, found, done, compare, swap, insert, remove')
    // the rest still renders: both steps exist, the valid part of step 2 was applied, the bad link speaks without a mark
    expect(m.steps.length).toBe(2)
    expect(quickAccount(m)!.steps[1]!.blocks.row).toBe('[3 4 5] leg=0 · found 5')
    expect(m.steps[1]!.narration[0]!.plain).toBe('A typo and a stranger.')
    expect(m.steps[1]!.narration[0]!.spans.map((s) => s.targets)).toEqual([['row']])
  })
  test('nonsense in every position is reported, not thrown', () => {
    for (const spec of [undefined, null, 7, [], { stage: 3, story: 4, controls: 5 }, { stage: { a: null }, story: [null, 3, { say: 9 }] }, { story: () => { throw new Error('boom') } }, { stage: { row: cells([1]) }, story: function* () { yield 5; yield { row: 'no' }; throw new Error('late') } }, { controls: { k: { frm: 0 } }, stage: { row: cells([1]) }, story: [{ set: { j: 1, k: 'x' }, focus: [3, 'row.zzz'] }] }]) {
      const m = build(spec)
      expect(m.diagnostics.list.length).toBeGreaterThan(0)
      expect(m.duration).toBeGreaterThan(0)
    }
    const endless = build({ stage: { row: cells([1, 2], { pointers: ['p'] }) }, story: function* () { for (let i = 0; ; i++) yield { row: { p: i % 2 } } } })
    expect(diags(endless).join('\n')).toContain('more than 240 steps')
    expect(endless.steps.length).toBe(240)
    const broken: BlockDef = { kind: 'broken', build: () => { throw new Error('cannot build') } }
    const m = build({ stage: { bad: broken, row: cells([1, 2]) }, story: [{ say: 'The [row](row) is still here.' }] })
    expect(diags(m).join('\n')).toContain('cannot build')
    expect(quickAccount(m)!.steps[0]!.onStage).toEqual(['row'])
  })
  test('a step that changes nothing is not left dead (STATIC-STEP): what the story touched last gets a pulse', () => {
    const m = build({ stage: { row: cells([1, 2]) }, story: [{ say: 'A [row](row).' }, { say: 'Nothing happens here.' }] })
    // the step is not left dead: the layer puts the eye on what the story touched last, and says so
    expect(describeAccount(quickAccount(m)!)).toContain('adjusted: nothing changes on stage in this step: #row gets a pulse')
    // a pulse, not a focus: nothing else on stage is dimmed for the whole step
    expect(m.actions.some((a) => a.step === 1 && a.type === 'focus')).toBe(false)
  })
})

describe('blocks', () => {
  test('the registry knows the kinds; a second registration keeps the first', () => {
    expect(blockKinds().map((k) => k.kind)).toEqual(expect.arrayContaining(['cells', 'formula', 'sequence', 'custom']))
    const n = blockKinds().length
    defineBlock({ kind: 'cells', example: 'other' })
    expect(blockKinds().length).toBe(n)
    expect(blockKinds().find((k) => k.kind === 'cells')!.example).toContain('pointers')
    expect(defineBlock(null as never)).toBe(null as never)
  })
  test('custom() gets the rectangle and returns an object, or an object with targets and a change function', () => {
    const calls: unknown[] = []
    const m = build({
      stage: {
        dot: custom(({ rect }) => circle({ id: 'ball', radius: 0.5 }).at(rect.center[0], rect.center[1])),
        gauge: custom(({ rect }) => { const needle = circle({ id: 'needle', radius: 0.2 }).at(rect.center[0], rect.center[1]); return { root: needle, targets: { needle }, change: (st, change) => { calls.push(change); st.play(needle.to.scale(2)) }, describe: (s) => `gauge at ${String(s.value)}` } }),
      },
      story: [{ say: 'A [ball](dot) and a [needle](gauge.needle).', gauge: { value: 3 } }],
    })
    expect(diags(m)).toEqual([])
    expect(calls).toEqual([{ value: 3 }])
    expect(quickAccount(m)!.steps[0]!.blocks.gauge).toBe('gauge at 3')
    expect(m.steps[0]!.narration[0]!.spans.map((s) => s.targets[0])).toEqual(['ball', 'needle'])
    // side by side, each inside its rectangle
    const [a, b] = quickAccount(m)!.blocks
    expect(m.state(0).world(m.byId.get('ball')!).p[0]).toBeCloseTo(a!.rect[0] + a!.rect[2] / 2, 2)
    expect(m.state(0).world(m.byId.get('needle')!).p[0]).toBeCloseTo(b!.rect[0] + b!.rect[2] / 2, 2)
  })
  test('formula: the reducer, and a highlight then a rewrite in a scene', () => {
    expect(reduceFormula({ latex: 'a', highlight: 'a' }, { latex: 'b' }).next).toEqual({ latex: 'b', highlight: null })
    expect(reduceFormula({ latex: 'a', highlight: null }, { highlight: 7 }).problems.length).toBe(1)
    const m = build({ stage: { eq: formula(R`a^2 + b^2 = c^2`) }, story: [{ say: 'The [theorem](eq).' }, { say: 'Its [right side](eq.c^2).', eq: { highlight: 'c^2' } }, { say: 'Solved.', eq: { latex: R`c = \sqrt{a^2 + b^2}` } }, { say: 'Wrong term.', eq: { highlight: 'z' } }] })
    expect(diags(m).length).toBe(1)
    expect(diags(m)[0]).toContain('highlight names "z", which is not written in the formula')
    expect(quickAccount(m)!.steps.map((s) => s.blocks.eq)).toEqual([R`a^2 + b^2 = c^2`, 'a^2 + b^2 = c^2 · highlights c^2', R`c = \sqrt{a^2 + b^2}`, R`c = \sqrt{a^2 + b^2}`])
  })
  test('sequence: the reducer, and the engine\'s sequence() adopted as a block', () => {
    const s0 = { upTo: 0, lost: [], retry: [] }
    expect(reduceSequence(s0, { upTo: 3, lost: 3 }, 5).next).toEqual({ upTo: 3, lost: [3], retry: [] })
    expect(reduceSequence(s0, { upTo: 'end', retry: [4, 4] }, 5).next).toEqual({ upTo: 5, lost: [], retry: [4] })
    expect(reduceSequence(s0, { upTo: 9, lost: 0 }, 5).problems.length).toBe(2)
    const m = build({
      stage: { wire: sequence({ actors: ['client', 'server'], messages: [['client', 'server', 'SYN'], ['server', 'client', 'SYN-ACK'], ['client', 'server', 'ACK'], ['client', 'server', 'ACK']] }) },
      story: [{ say: 'The [client](wire.client) sends a SYN.', wire: { upTo: 1 } }, { say: 'This [one](wire.m3) is lost.', wire: { upTo: 3, lost: 3 } }, { say: 'Again.', wire: { upTo: 4, retry: 4, upto: 1 } }],
    })
    expect(diags(m).length).toBe(1)
    expect(diags(m)[0]).toContain('did you mean')
    expect(diags(m)[0]).toContain('states of sequence: upTo, lost, retry')
    const q = [...m.byId.values()].find((n) => n.kind === 'sequence')!
    const drawn = (k: number, i: number): number => m.state(m.steps[k]!.t1 - 0.01).prop<number>(m.byId.get(`${q.id}.m${i}`)!, 'drawn')
    expect([drawn(0, 1), drawn(0, 2), drawn(1, 2), drawn(1, 3), drawn(2, 3), drawn(2, 4)].map((v) => Math.round(v * 100) / 100)).toEqual([1, 0, 1, 0.72, 0.72, 1])
    expect(m.state(m.steps[1]!.t1 - 0.01).opacity(m.byId.get('wire.lost3')!)).toBeCloseTo(1, 3)
    expect(m.state(m.steps[0]!.t1 - 0.01).opacity(m.byId.get('wire.lost3')!)).toBe(0)
    expect(quickAccount(m)!.steps[2]!.blocks.wire).toBe('client, server · 4 of 4 messages drawn: 1 client -> server "SYN", 2 server -> client "SYN-ACK", 3 client -> server "ACK" (lost), 4 client -> server "ACK" (sent again)')
  })
})
