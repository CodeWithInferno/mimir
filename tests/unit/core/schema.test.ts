import { describe, expect, test } from 'bun:test'
import { arrow, circle, rect, text } from '../../../src/r2d/index.ts'
import { box, cylinder } from '../../../src/r3d/index.ts'
import { closest, defineKind, formatDiag, levenshtein, boxOf, defineKindMethod, type MNode } from '../../../src/core/index.ts'
import { build, codes } from './helpers.ts'

const HERE = 'schema.test.ts'
/** line number of the caller, read the same way a person would: from a stack trace */
const hereLine = (): number => Number(new Error().stack!.split('\n')[2]!.match(/:(\d+):\d+\)?\s*$/)![1])

describe('schema validation', () => {
  test('aliases r w h d are accepted silently', () => {
    let a: any, b: any, c: any
    const m = build(() => { a = rect({ w: 3, h: 2 }); b = circle({ r: 0.7 }); c = box({ w: 1, h: 2, d: 3 }) })
    expect(a.props).toMatchObject({ width: 3, height: 2 })
    expect(b.props.radius).toBe(0.7)
    expect(c.props).toMatchObject({ width: 1, height: 2, depth: 3 })
    expect(codes(m)).toEqual([])
  })
  test('unknown option → API-UNKNOWN with did-you-mean, the valid list and the scene line; the node is still built', () => {
    let n: any
    let line = 0
    const m = build(() => {
      line = hereLine() + 1
      n = rect({ widht: 3, height: 2 })
    })
    const d = m.diagnostics.list[0]!
    expect(d.code).toBe('API-UNKNOWN')
    expect(d.severity).toBe('error')
    expect(d.what).toBe('rect() has no option "widht".')
    expect(d.fix[0]).toStartWith('use "width". Valid options: id, opacity, width, height')
    expect(d.file).toEndWith(HERE)
    expect(d.line).toBe(line)
    expect(d.ids).toEqual([n.id])
    expect(n.invalid).toBe(true)
    expect(n.props).toMatchObject({ width: 2, height: 2 }) // default width, given height
    expect(m.state(0).bounds(n).max[1]).toBe(1)
  })
  test('wrong type → API-TYPE with one correct example', () => {
    const m = build(() => { circle({ radius: 'big' }); rect({ dashed: 'yes' }); circle(2 as any) })
    const [a, b, c] = m.diagnostics.list
    expect(a).toMatchObject({ code: 'API-TYPE' })
    expect(a!.what).toContain('radius expects a number greater than 0, got the string "big"')
    expect(a!.fix[0]).toBe('radius: 2')
    expect(b!.fix[0]).toBe('dashed: true')
    expect(c!.what).toContain('expects an options object')
    expect(c!.fix[0]).toContain('circle({')
  })
  test('NaN, Infinity and non-positive sizes → NUM-INVALID', () => {
    const m = build(() => { rect({ width: NaN }); circle({ radius: 0 }); box({ depth: -1 }); rect({ height: Infinity }); rect().at(NaN, 1); rect().scale(0) })
    expect(codes(m)).toEqual(['NUM-INVALID', 'NUM-INVALID', 'NUM-INVALID', 'NUM-INVALID', 'NUM-INVALID', 'NUM-INVALID'])
    expect(m.diagnostics.list[0]!.what).toContain('width is NaN')
    expect(m.diagnostics.list[1]!.what).toContain('must be greater than 0')
  })
  test('missing references → REF-MISSING: undefined variable, unknown id (with the closest id)', () => {
    let st0: any
    const m = build((s) => {
      const a = rect({ id: 'spark-plug' })
      const parts: Record<string, any> = { a }
      arrow(a, parts.nope)
      s.step('x', (st: any) => { st0 = st; st.focus('sparkplug'); st.label(undefined) })
    })
    const refs = m.diagnostics.byCode('REF-MISSING')
    expect(refs.length).toBe(3)
    expect(refs[0]!.what).toContain('b is undefined')
    expect(refs[1]!.what).toContain('"sparkplug" - no object has that id')
    expect(refs[1]!.fix[0]).toContain('use "spark-plug"')
    expect(refs[1]!.step).toBe(1)
    expect(st0).toBeDefined()
  })
  test('unknown colour, enum value and material are reported with a suggestion', () => {
    const m = build(() => { rect({ color: 'BLEU' }); text('x', { size: 'titel' }); cylinder({ material: 'stel' }); rect({ color: 'red' }) })
    expect(codes(m)).toEqual(['API-UNKNOWN', 'API-UNKNOWN', 'API-UNKNOWN'])
    expect(m.diagnostics.list[0]!.fix[0]).toContain('BLUE')
    expect(m.diagnostics.list[1]!.fix[0]).toContain('title')
    expect(m.diagnostics.list[2]!.fix[0]).toContain('steel')
  })
  test('tokens resolve to values (text size ladder)', () => {
    let t: any
    build(() => { t = text('piston', { size: 'label' }) })
    expect(t.props.size).toBe(36)
  })
  test('unknown methods never throw while building: API-UNKNOWN with did-you-mean, chain continues', () => {
    let n: any
    const m = build((s) => {
      n = rect().colour('#fff').next_to(undefined).shift(1, 0)
      s.stepp('x', () => {})
      s.step('y', (st: any) => { st.plya(); st.wait(1) })
      n.to.colour('#000')
    })
    expect(n.props.shift).toEqual([1, 0, 0])
    const list = m.diagnostics.byCode('API-UNKNOWN')
    expect(list.map((d) => d.what)).toEqual(['rect has no method "colour".', 'rect has no method "next_to".', 'the scene (s) has no method "stepp".', 'the step (st) has no method "plya".', 'rect.to has no method "colour".'])
    expect(list[0]!.fix[0]).toBe('use "color"')
    expect(list[1]!.fix[0]).toBe('use "nextTo"')
    expect(list[2]!.fix[0]).toBe('use "step"')
    expect(list[3]!.fix[0]).toBe('use "play"')
    expect(m.steps.length).toBe(1)
  })
  test('an exception in the builder or in a step is RUNTIME-ERROR; what came before still exists', () => {
    const m = build((s) => {
      rect({ id: 'kept' })
      s.step('ok', (st: any) => { st.wait(1) })
      s.step('bad', (st: any) => { st.wait(1); (undefined as any).boom() })
      s.step('after', (st: any) => { st.wait(1) })
      // @ts-expect-error deliberately undefined
      hexagonn({ sides: 6 })
      rect({ id: 'never' })
    })
    expect(m.byId.has('kept')).toBe(true)
    expect(m.byId.has('never')).toBe(false)
    expect(m.steps.map((s) => s.title)).toEqual(['ok', 'bad', 'after'])
    const errs = m.diagnostics.byCode('RUNTIME-ERROR')
    expect(errs.length).toBe(2)
    expect(errs[0]!.step).toBe(2)
    expect(errs[0]!.file).toEndWith(HERE)
    expect(errs[1]!.what).toContain('hexagonn')
  })
  test('duplicate ids → ID-DUP and a distinct id', () => {
    let a: any, b: any
    const m = build(() => { a = rect({ id: 'valve' }); b = rect({ id: 'valve' }) })
    expect(a.id).toBe('valve')
    expect(b.id).toBe('valve-2')
    expect(codes(m)).toEqual(['ID-DUP'])
  })
  test('ids are readable by default', () => {
    let a: any, b: any, c: any
    build(() => { a = rect(); b = rect(); c = circle() })
    expect([a.id, b.id, c.id]).toEqual(['rect1', 'rect2', 'circle1'])
  })
  test('defineKind + defineKindMethod: a new kind validates and gets its own methods without touching shared files', () => {
    const star = defineKind({ name: 'test-star', space: '2d', schema: { points: { type: 'int', default: 5 }, radius: { type: 'positive', default: 1 } }, bounds: (_n, r) => boxOf(r.radius, r.radius, 0) })
    defineKindMethod('test-star', 'sharpen', (node: MNode, by: number) => { node.props.points = (node.props.points as number) + by; return node })
    let n: any, r: any
    const m = build(() => { n = star({ points: 7, raduis: 2 }).sharpen(1); r = rect().sharpen(1) })
    expect(n.props.points).toBe(8)
    expect(m.diagnostics.list.map((d) => d.what)).toEqual(['test-star() has no option "raduis".', 'rect has no method "sharpen".'])
    expect(r.kind).toBe('rect')
  })
})

describe('did-you-mean', () => {
  test('levenshtein with transpositions', () => {
    expect(levenshtein('width', 'width')).toBe(0)
    expect(levenshtein('widht', 'width')).toBe(1)
    expect(levenshtein('colour', 'color')).toBe(1)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
  })
  test('closest returns null when nothing is plausible', () => {
    expect(closest('colour', ['color', 'opacity', 'width'])).toBe('color')
    expect(closest('next_to', ['nextTo', 'attach'])).toBe('nextTo')
    expect(closest('zzzzzz', ['color', 'opacity'])).toBeNull()
  })
  test('formatDiag follows the message contract', () => {
    const m = build((s) => { s.step('Power', () => { rect({ id: 'rod', widht: 1 }) }) })
    const text0 = formatDiag(m.diagnostics.list[0]!)
    const lines = text0.split('\n')
    expect(lines[0]).toMatch(/^API-UNKNOWN error \| step 1 "Power" \| #rod \| schema\.test\.ts:\d+$/)
    expect(lines[1]).toBe('  what: rect() has no option "widht".')
    expect(lines[2]).toStartWith('  fix: use "width".')
  })
})
