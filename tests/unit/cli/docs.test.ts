import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SUMMARY_MAX, describeExample, examplesDir, findUsage, listExamples, listGuides, lookup, parseDts, renderEntry, renderList, renderReference, renderTopic, shortSummary,
  starterScene, titleFromName, topicsDir,
} from '../../../src/cli/commands/docs.ts'

const index = parseDts(readFileSync(join(import.meta.dir, 'fixtures', 'sample.d.ts.txt'), 'utf8'))
const names = index.entries.map((e) => e.name)
const one = (q: string) => {
  const hit = lookup(index, q)
  if (hit.kind !== 'symbol') throw new Error(`no symbol ${q}`)
  return hit.entries
}

describe('parseDts', () => {
  test('finds every top-level declaration and every member', () => {
    expect(names).toEqual([
      'Color', 'Dyn', 'text', 'rect', 'BLUE', 'box', 'kit', 'kit.gear', 'kit.spring',
      'Scene', 'Scene.param', 'Scene.step', 'Scene.t', 'Step', 'Step.say', 'Step.play', 'Step.play', 'scene',
      'Step', 'Step.label',
    ])
  })
  test('the module-form plumbing of the reference is not API: no __helpers, nothing from `declare module`', () => {
    expect(names.some((n) => n.startsWith('__'))).toBe(false)
    expect(names.filter((n) => n === 'box')).toEqual(['box'])
    expect(names.filter((n) => n === 'text')).toEqual(['text'])
    expect(one('box').length).toBe(1)
    expect(one('box')[0]!.decl).toStartWith('export function box(')
  })
  test('topics come from the banner comments', () => {
    expect(index.topics).toEqual(['2d', '3d', 'story', 'guide']) // "module form" has nothing documented: not a topic
    expect(index.entries.find((e) => e.name === 'Color')!.topic).toBeNull()
    expect(index.entries.find((e) => e.name === 'rect')!.topic).toBe('2d')
    expect(index.entries.find((e) => e.name === 'kit.gear')!.topic).toBe('3d')
    expect(index.entries.find((e) => e.name === 'Scene.step')!.topic).toBe('story')
  })
  test('kinds and line numbers', () => {
    expect(index.entries.find((e) => e.name === 'text')).toMatchObject({ kind: 'function', line: 12, parent: null })
    expect(index.entries.find((e) => e.name === 'Scene')).toMatchObject({ kind: 'interface' })
    expect(index.entries.find((e) => e.name === 'Scene.step')).toMatchObject({ kind: 'member', parent: 'Scene' })
    expect(index.entries.find((e) => e.name === 'kit.gear')).toMatchObject({ kind: 'function', parent: 'kit' })
  })
})

describe('lookup', () => {
  test('a symbol gives its JSDoc and its exact declaration', () => {
    expect(renderEntry(one('text')[0]!)).toBe(
      "/** A line of text in frame space. */\nexport function text(str: string, options?: { size?: number | 'title' | 'body'; color?: Color }): Mob",
    )
  })
  test('multi-line declarations and multi-line JSDoc are kept whole', () => {
    expect(renderEntry(one('rect')[0]!)).toBe(
      '/**\n * A rectangle.\n * Width and height are in frame units.\n */\n' +
        'export function rect(options: {\n  width: number\n  height: number\n  radius?: number\n}): Mob',
    )
  })
  test('a trailing semicolon belongs to the declaration; the next one does not leak in', () => {
    expect(one('box')[0]!.decl).toBe('export function box(options: { width: number; height: number; depth: number }): Part;')
    expect(one('BLUE')[0]!.decl).toBe('export const BLUE: Color')
  })
  test('members by full name and by short name', () => {
    expect(renderEntry(one('Scene.step')[0]!)).toBe('/** Add a step to the story. */\nstep(title: string, build: (st: Step) => void): void')
    expect(one('step').map((e) => e.name)).toEqual(['Scene.step'])
    expect(one('kit.gear')[0]!.decl).toBe('function gear(options: { teeth: number; module: number; width: number }): Part')
    expect(one('gear').map((e) => e.name)).toEqual(['kit.gear'])
  })
  test('overloads are all returned; a // comment above counts as the doc', () => {
    const plays = one('Step.play')
    expect(plays.length).toBe(2)
    expect(plays[1]!.doc).toBe('// overload: with options')
  })
  test('an interface declared in two places gives both declarations', () => {
    const steps = one('Step')
    expect(steps.map((e) => e.topic)).toEqual(['story', 'guide'])
    expect(steps[1]!.decl).toContain('label(part: Part, text?: string): void')
    expect(one('Step.label')[0]!.doc).toBe('/** Put a label on a part for this step. */')
  })
  test('a container prints its whole body', () => {
    const scene = one('Scene')[0]!
    expect(scene.decl).toStartWith('export interface Scene {')
    expect(scene.decl).toEndWith('}')
    expect(scene.decl).toContain('t(): number')
  })
  test('an exact top-level name wins over a member with the same short name; case is a fallback only', () => {
    expect(one('scene').map((e) => e.name)).toEqual(['scene'])
    expect(one('Scene').map((e) => e.name)).toEqual(['Scene'])
    expect(one('blue').map((e) => e.name)).toEqual(['BLUE'])
  })
  test('a topic lists its declarations, one line each', () => {
    const hit = lookup(index, '3D')
    expect(hit.kind).toBe('topic')
    if (hit.kind !== 'topic') return
    expect(renderTopic(hit.topic, hit.entries)).toBe(
      '# 3d\n' +
        'export function box(options: { width: number; height: number; depth: number }): Part;   // A box centred on its origin.\n' +
        'export namespace kit {   // Parametric parts.',
    )
  })
  test('no fuzzy matching: a miss returns suggestions only', () => {
    expect(lookup(index, 'sprng')).toEqual({ kind: 'none', suggestions: ['kit.spring'] })
    expect(lookup(index, 'zzzzzzzz')).toEqual({ kind: 'none', suggestions: [] })
  })
})

describe('renderReference', () => {
  test('the whole reference, compact: one line per declaration, members indented under their container, no module-form plumbing', () => {
    const text = renderReference(index)
    expect(text).not.toContain('__')
    expect(text.split('\n').filter((l) => l.startsWith('# '))).toEqual(['# 2d', '# 3d', '# story', '# guide'])
    expect(text).toContain('export namespace kit {   // Parametric parts.\n  function gear(options: { teeth: number; module: number; width: number }): Part   // An involute spur gear.\n')
    expect(text).toContain('\n  label(')
    // every member appears once, under the declaration that holds it (Step is declared twice: by the story and by the guide)
    expect(text.split('\n').filter((l) => /^  (say|play|label)\(/.test(l)).length).toBe(4)
  })
  test('constants of one type that follow each other without a comment share a line: the shades of a palette', () => {
    const palette = parseDts([
      '// ── core ─────────────────────────────────────────', '/** Palette (the bare name is the _C shade). */', 'declare const BLUE: Color', 'declare const BLUE_A: Color', 'declare const BLUE_B: Color', 'declare const TEAL: Color',
      '/** Direction vectors. */', 'declare const UP: Vec3', 'declare const DOWN: Vec3', '/** Frame width. */', 'declare const FRAME_W: number', 'declare function mix(a: Color, b: Color, u: number): Color',
    ].join('\n'))
    expect(renderReference(palette)).toBe([
      '# core',
      'declare const BLUE, BLUE_A, BLUE_B, TEAL: Color   // Palette (the bare name is the _C shade).',
      'declare const UP, DOWN: Vec3   // Direction vectors.',
      'declare const FRAME_W: number   // Frame width.',
      'declare function mix(a: Color, b: Color, u: number): Color',
    ].join('\n'))
  })
})

describe('renderList', () => {
  test('names by topic, then members by container', () => {
    expect(renderList(index)).toBe(
      'general: Color Dyn\n' +
        '2d: text rect BLUE\n' +
        '3d: box kit\n' +
        'story: Scene Step scene\n' +
        'guide: Step\n' +
        'kit.: gear spring\n' +
        'Scene.: param step t\n' +
        'Step.: say play label',
    )
  })
})

describe('example scenes', () => {
  const hello = `// hello-3d: a crank and slider built from primitives. One param drives everything:
// the pin rides on the wheel.
import { scene, box, cylinder, BLUE } from 'mimir'

export default scene({ title: 'Crank and slider' }, (s) => {
  const wheel = cylinder({ id: 'wheel', radius: 2.1 })
  const slider = box({
    id: 'slider',
    width: 1.5,
    color: BLUE,
  }).at(0, 1, 0)
  s.step('The parts', (st) => {
    st.say('A wheel and a slider.')
  })
})
`
  const broken = `// broken: mistakes on purpose.
import { scene, rect, cylinder } from 'mimir'
export default scene({ title: "It's \\"broken\\"" }, (s) => {
  const a = rect({ widht: 2 }) // API-UNKNOWN: "widht"
  const ok = rect({ width: 2 })
})
`
  test('describeExample: the name, the title given to scene(), the opening comment on one line', () => {
    expect(describeExample('/x/hello-3d.scene.js', hello)).toEqual({
      name: 'hello-3d', path: '/x/hello-3d.scene.js', title: 'Crank and slider',
      summary: 'a crank and slider built from primitives. One param drives everything: the pin rides on the wheel.',
    })
    expect(describeExample('/x/broken.scene.js', broken)).toMatchObject({ title: 'It\'s "broken"', summary: 'mistakes on purpose.' })
    // a block comment, a comment that repeats the title, no comment at all
    expect(describeExample('/x/a.scene.js', `/* A pump.\n * Two valves. */\nexport default scene({ title: 'Pump' }, () => {})`).summary).toBe('A pump. Two valves.')
    expect(describeExample('/x/a.scene.js', `// How a pump works. Story: in, out.\nexport default scene({ title: 'How a pump works' }, () => {})`).summary).toBe('Story: in, out.')
    expect(describeExample('/x/a.scene.js', `export default scene({ title: 'Pump' }, () => {})`)).toMatchObject({ title: 'Pump', summary: 'Pump' })
    expect(describeExample('/x/a.scene.js', '')).toMatchObject({ name: 'a', title: '', summary: '' })
  })
  test('shortSummary: the first sentence, cut at a word when even that is long', () => {
    expect(shortSummary('Three boxes. And more.')).toBe('Three boxes.')
    expect(shortSummary('no full stop')).toBe('no full stop')
    const long = shortSummary('word '.repeat(80))
    expect(long.length).toBeLessThanOrEqual(SUMMARY_MAX)
    expect(long.endsWith('…')).toBe(true)
  })
  test('findUsage: the first statement that calls the symbol, whole, never the import line', () => {
    const examples = [{ path: '/x/hello-3d.scene.js', source: hello }]
    expect(findUsage('cylinder', examples)).toEqual({ file: '/x/hello-3d.scene.js', line: 6, text: `const wheel = cylinder({ id: 'wheel', radius: 2.1 })` })
    // a statement over several lines is kept whole
    expect(findUsage('box', examples)).toEqual({ file: '/x/hello-3d.scene.js', line: 7, text: `const slider = box({\n  id: 'slider',\n  width: 1.5,\n  color: BLUE,\n}).at(0, 1, 0)` })
    // members match the method call; a constant matches the bare word outside the import
    expect(findUsage('Step.say', examples)).toMatchObject({ line: 13, text: `st.say('A wheel and a slider.')` })
    expect(findUsage('Scene.step', examples)!.line).toBe(12)
    expect(findUsage('BLUE', examples)).toMatchObject({ line: 10, text: 'color: BLUE,' })
    expect(findUsage('torus', examples)).toBeNull()
    expect(findUsage('Scene.nothing', examples)).toBeNull()
  })
  test('findUsage never quotes a line that shows a mistake, and asks such scenes last', () => {
    const examples = [{ path: '/x/broken.scene.js', source: broken }, { path: '/x/hello-3d.scene.js', source: hello }]
    expect(findUsage('cylinder', examples)!.file).toBe('/x/hello-3d.scene.js')
    // rect only occurs in the scene with mistakes: its correct line is used, the annotated one is not
    expect(findUsage('rect', examples)).toMatchObject({ file: '/x/broken.scene.js', line: 5, text: 'const ok = rect({ width: 2 })' })
  })
  test('listExamples reads *.scene.js of a directory; a missing directory has none; the directory can be set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimir-examples-'))
    try {
      writeFileSync(join(dir, 'b.scene.js'), hello)
      writeFileSync(join(dir, 'a.scene.js'), broken)
      writeFileSync(join(dir, 'notes.md'), '# no')
      expect(listExamples(dir).map((e) => [e.name, e.title])).toEqual([['a', 'It\'s "broken"'], ['b', 'Crank and slider']])
      expect(listExamples(join(dir, 'nope'))).toEqual([])
      expect(examplesDir({ MIMIR_EXAMPLES: dir })).toBe(dir)
      expect(examplesDir({}).endsWith('examples')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('topic guides', () => {
  test('every .md of the directory is a guide named after its file, titled by its first heading', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimir-topics-'))
    try {
      mkdirSync(join(dir, 'sub'))
      writeFileSync(join(dir, 'cutaways.md'), 'intro\n\n## Cutaways and ghosts\n\ntext')
      writeFileSync(join(dir, 'authoring.md'), '# The authoring loop\n')
      writeFileSync(join(dir, 'plain.md'), 'no heading')
      writeFileSync(join(dir, 'skip.txt'), '# no')
      expect(listGuides(dir).map((g) => [g.name, g.title])).toEqual([['authoring', 'The authoring loop'], ['cutaways', 'Cutaways and ghosts'], ['plain', '']])
      expect(listGuides(join(dir, 'nope'))).toEqual([])
      expect(topicsDir({ MIMIR_TOPICS: dir })).toBe(dir)
      expect(topicsDir({}).endsWith(join('docs', 'topics'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('mimir init', () => {
  test('the title comes from the file name', () => {
    expect([titleFromName('my-first_scene'), titleFromName('pump'), titleFromName('--')]).toEqual(['My first scene', 'Pump', 'Untitled'])
  })
  test('the starter is a module that parses, carries the title, and shows the loop', () => {
    const src = starterScene('A "quoted" title')
    expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(src)).not.toThrow()
    expect(src).toContain(`scene({ title: "A \\"quoted\\" title" }`)
    expect(src).toContain(`from 'mimir'`)
    for (const hint of ['mimir check', 'mimir shot', 'mimir open', 'mimir docs', 'mimir examples']) expect(src).toContain(hint)
    // it uses what every scene uses: a parameter, relations, steps with narration and a guide span
    for (const call of ['s.param(', 'row(', '.nextTo(', 's.step(', 'st.say(', '](source)', 'st.set(']) expect(src).toContain(call)
  })
})
