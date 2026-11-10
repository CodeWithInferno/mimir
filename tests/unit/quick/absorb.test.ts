// What explain() takes in its stride instead of reporting: the natural mistakes of somebody who writes a script once.
// Each of these cost a real generation a second call before it was absorbed (docs/agents.md, "write once").
import { describe, expect, test } from 'bun:test'
import { compile, type SceneModel } from '../../../src/core/index.ts'
import { circle, line, rect, text, group } from '../../../src/r2d/index.ts'
import '../../../src/plot/index.ts'
import { chart } from '../../../src/quick/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/index.ts'
import { actorGapFor, DIAGRAM_DEFAULTS, sequence } from '../../../src/diagram/index.ts'
import '../../../src/diagram/diagram.chunk.ts'
import { cells, custom, explain, formula, quickAccount, reduceCells, termIn, SEQUENCE_DEFAULTS, type ExplainSpec } from '../../../src/quick/index.ts'

const build = (spec: unknown): SceneModel => compile(explain(spec as ExplainSpec))
const diags = (m: SceneModel): string[] => m.diagnostics.list.map((d) => `${d.code}: ${d.what}`)
const R = String.raw

describe('cells', () => {
  const state = { values: [3, 8, 12], items: [1, 2, 3], pointers: {}, dim: [], found: [], done: [], compare: null }
  test('looking at ONE slot is a comparison: a number, the same slot twice, or a list of one', () => {
    let key = 10
    for (const compare of [1, [1, 1], [1]]) {
      const { next, problems } = reduceCells(state, { compare }, [], () => key++)
      expect(problems).toEqual([])
      expect(next.compare).toEqual([1, 1])
    }
    expect(reduceCells(state, { compare: [0, 2] }, [], () => key++).next.compare).toEqual([0, 2])
    // a swap still needs two different slots, and a slot outside the row is still said
    expect(reduceCells(state, { swap: [1, 1] }, [], () => key++).problems).toHaveLength(1)
    expect(reduceCells(state, { compare: 7 }, [], () => key++).problems).toHaveLength(1)
  })
  test('in a scene: no diagnostic, and the account says which slot is looked at', () => {
    const m = build({ stage: { row: cells([3, 8, 12]) }, story: [{ say: 'The [row](row).' }, { say: 'Look at the middle.', row: { compare: [1, 1] } }] })
    expect(diags(m)).toEqual([])
    expect(quickAccount(m)!.steps[1]!.blocks.row).toContain('looks at slot 1 (8)')
  })
})

describe('formula', () => {
  test('a term named loosely is the term as written', () => {
    const f = R`F_1 \cdot d_1 = F_2 \cdot d_2`
    expect(termIn(f, 'F_1')).toBe('F_1')
    expect(termIn(f, 'F1 d1')).toBe(R`F_1 \cdot d_1`)
    expect(termIn(f, 'F2*d2')).toBe(R`F_2 \cdot d_2`)
    expect(termIn(R`c = \sqrt{a^2 + b^2}`, 'a^2+b^2')).toBe('a^2 + b^2')
    expect(termIn(f, 'z')).toBeNull()
    expect(termIn(f, '')).toBeNull()
    // a stretch never leaves a brace open or closes one it did not open
    expect(termIn(R`\frac{a}{b} + c`, 'a b')).toBe('{a}{b}')
    expect(termIn(R`\frac{a}{b} + c`, 'b c')).toBeNull()
  })
  test('in a scene: the loose name highlights, a term that is not there is still said', () => {
    const m = build({ stage: { eq: formula(R`F_1 \cdot d_1 = F_2 \cdot d_2`) }, story: [{ say: 'The [law](eq).' }, { say: 'The [load side](eq.F1 d1).', eq: { highlight: 'F1 d1' } }, { say: 'Not there.', eq: { highlight: 'torque' } }] })
    const d = diags(m)
    expect(d).toHaveLength(1)
    expect(d[0]).toContain('highlight names "torque"')
  })
})

describe('custom', () => {
  test('`rect` taken apart is the block\'s rectangle AND still draws a rectangle', () => {
    const m = build({
      stage: {
        lever: custom(({ rect: r }: { rect: any }) => {
          expect(r.width).toBeGreaterThan(1)
          expect(Array.isArray(r.center)).toBe(true)
          return group([r({ id: 'plank', width: 6, height: 0.2 }), circle({ id: 'pivot', radius: 0.3 }).at(0, -0.4), text('load', { id: 'load', size: 'label' }).at(-2, 0.6)])
        }),
      },
      story: [{ say: 'A [plank](lever) on a pivot.' }],
    })
    expect(diags(m)).toEqual([])
    expect(m.byId.get('plank')?.kind).toBe('rect')
  })
  test('`area` is the same rectangle under a name that hides nothing', () => {
    let seen: any = null
    const m = build({ stage: { a: custom(({ area }: { area: any }) => { seen = area; return rect({ width: 2, height: 1 }) }) }, story: [{ say: 'A [box](a).' }] })
    expect(diags(m)).toEqual([])
    expect(seen.width).toBeGreaterThan(1)
    expect(typeof seen).toBe('object')
  })
})

describe('sequence', () => {
  test('two or three parties use the width a frame has; many keep the engine\'s gap', () => {
    expect(actorGapFor(2)).toBe(DIAGRAM_DEFAULTS.actorGapMax)
    expect(actorGapFor(3)).toBeCloseTo(DIAGRAM_DEFAULTS.sequenceSpan / 2, 9)
    expect(actorGapFor(5)).toBe(DIAGRAM_DEFAULTS.actorGap)
    expect(actorGapFor(1)).toBe(DIAGRAM_DEFAULTS.actorGap)
  })
  test('the party that opens the conversation and what it sends share one hue; the others are neutral', () => {
    const m = build({ stage: { wire: sequence({ actors: ['client', 'server'], messages: [['client', 'server', 'SYN'], ['server', 'client', 'SYN-ACK']] }) }, story: [{ say: 'A [client](wire.client).', wire: { upTo: 2 } }] })
    expect(diags(m)).toEqual([])
    const f = m.state(m.duration)
    const color = (id: string): string => String(f.prop(m.nodes.find((n) => n.id.endsWith(id))!, 'color')).toUpperCase()
    expect(color('.m1')).toBe(SEQUENCE_DEFAULTS.openerColor.toUpperCase())
    expect(color('.m2')).toBe(SEQUENCE_DEFAULTS.otherColor.toUpperCase())
  })
})

describe('custom: a drawing in its own coordinates', () => {
  test('a line between two POINTS follows the block into its rectangle (it used to stay where the numbers put it)', () => {
    const m = build({
      stage: {
        rig: custom(() => group([rect({ id: 'bar', width: 5, height: 0.3 }).at(0, 3), line([-1, 3], [-1, 0.5], { id: 'rope' }), circle({ id: 'wheel', radius: 1 }).at(0, 0.5)])),
        other: custom(() => rect({ id: 'side', width: 4, height: 4 })),
      },
      story: [{ say: 'A [rig](rig) beside a [box](other).' }],
    })
    expect(diags(m)).toEqual([])
    const f = m.state(m.duration)
    const box = (id: string) => f.bounds(m.byId.get(id)!)
    const rope = box('rope'), bar = box('bar'), wheel = box('wheel')
    // the rope hangs from the bar and reaches the wheel, wherever the stage put the block
    expect(rope.max[1]!).toBeCloseTo((bar.min[1]! + bar.max[1]!) / 2, 3)
    expect(rope.min[0]!).toBeGreaterThan(bar.min[0]!)
    expect(rope.min[0]!).toBeLessThan(wheel.max[0]!)
    expect(rope.min[1]!).toBeGreaterThanOrEqual(wheel.min[1]! - 1e-6)
    // and the block is not where the author's numbers were: it shares the frame with another block
    expect(bar.max[0]!).toBeLessThan(box('side').min[0]!)
  })
  test('a free line counts for the size of the drawing, and a target made a second time outside it is taken in', () => {
    const m = build({
      stage: {
        seesaw: custom(() => ({
          root: group([line([-4, 0], [4, 0], { id: 'plank' }), circle({ id: 'pivot', radius: 0.2 }).at(0, 0), rect({ id: 'load', width: 1.2, height: 0.8 }).at(-4, 0.5)]),
          targets: { lever: line([-4, 0], [4, 0], { id: 'again' }) },
        })),
        other: custom(() => rect({ id: 'side', width: 4, height: 4 })),
      },
      story: [{ say: 'A [lever](seesaw.lever) beside a [box](other).' }],
    })
    expect(diags(m)).toEqual([])
    const f = m.state(m.duration)
    const box = (id: string) => f.bounds(m.byId.get(id)!)
    const side = box('side')
    // the whole plank is inside its own block, and so is the copy that was only named as a target
    for (const id of ['plank', 'again']) { expect(box(id).max[0]!).toBeLessThan(side.min[0]!); expect(box(id).max[0]! - box(id).min[0]!).toBeGreaterThan(2) }
    expect(box('again').min[0]!).toBeCloseTo(box('plank').min[0]!, 6)
  })
  test('words keep their size when the drawing is scaled down to fit', () => {
    const m = build({ stage: { big: custom(() => group([rect({ id: 'wide', width: 40, height: 10 }), text('load 80 N', { id: 'words', size: 'label' }).at(0, 0)])) }, story: [{ say: 'A [thing](big).' }] })
    const f = m.state(0)
    const wide = f.bounds(m.byId.get('wide')!)
    const shrink = (wide.max[0]! - wide.min[0]!) / 40
    expect(shrink).toBeLessThan(0.5)
    // the text is drawn larger than the shapes around it by the factor they lost (up to the cap)
    expect(f.world(m.byId.get('words')!).s / shrink).toBeGreaterThan(1.9)
  })
})

describe('chart: marks', () => {
  test('a run of marks keeps every line and the newest name; names that have room all stay', () => {
    const m = build({
      stage: { hill: chart({ x: [0, 10], y: [0, 10], curve: (x: number) => x }) },
      story: [
        { say: 'The [start](hill).', hill: { mark: [1, 'start'] } },
        { say: 'One step.', hill: { mark: [1.3, 'step 1'] } },
        { say: 'Far away.', hill: { mark: [9, 'end'] } },
      ],
    })
    expect(diags(m)).toEqual([])
    const f = m.state(m.duration)
    const shown = (id: string): number => f.opacity(m.byId.get(id)!) * f.reveal(m.byId.get(id)!).p
    expect(shown('hill.mark1')).toBeLessThan(0.05) // "start" gave way to "step 1" beside it
    expect(shown('hill.mark2')).toBeGreaterThan(0.95)
    expect(shown('hill.mark3')).toBeGreaterThan(0.95)
    for (const k of [1, 2, 3]) expect(shown(`hill.mark${k}.line`)).toBeGreaterThan(0.3) // every line stays
  })
  test('a curve named with a phrase is linked by its name, and the chart answers to `plot`', () => {
    const m = build({
      stage: { effort: chart({ x: [0, 10], y: [0, 10], curves: { 'lifting by hand': (x: number) => x, 'with a pulley': (x: number) => x / 2 } }) },
      story: [{ say: 'By [hand](effort.lifting by hand), with a [pulley](effort.withAPulley), on one [plot](effort.plot).' }],
    })
    expect(diags(m)).toEqual([])
    expect(m.byId.has('effort.liftingByHand')).toBe(true)
  })
  test('a part a block does not have is a warning: the words still land on the block', () => {
    const m = build({ stage: { hill: chart({ x: [0, 10], y: [0, 10], curve: (x: number) => x }) }, story: [{ say: 'The [top](hill.summit).' }] })
    const list = m.diagnostics.list
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ code: 'GUIDE-TARGET', severity: 'warn' })
  })
})
