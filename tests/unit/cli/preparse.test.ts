// The CLI finds the line of a syntax error on disk, because the browser reports a module that does not parse
// without a position.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { displayFile } from '../../../src/cli/format.ts'
import { findSyntaxError, locateFatal } from '../../../src/cli/preparse.ts'

const DIR = mkdtempSync(join(tmpdir(), 'mimir-preparse-'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))
const put = (name: string, text: string): string => {
  const p = join(DIR, name)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
  return p
}

const GOOD = "import { scene, rect } from 'mimir'\nexport default scene({ title: 'ok' }, (s) => { rect({ width: 2 }) })\n"
const BAD = "import { scene, rect } from 'mimir'\n\nexport default scene({ title: 'x' }, (s) => {\n  const a = rect({ width: 2 }\n  s.step('x', (st) => {})\n})\n"

describe('findSyntaxError', () => {
  test('a module that parses has none', () => {
    expect(findSyntaxError(put('good.scene.js', GOOD))).toBeNull()
  })
  test('the first error is reported with its 1-based line', () => {
    const file = put('bad.scene.js', BAD)
    const p = findSyntaxError(file)!
    expect(p.file).toBe(file)
    expect(p.line).toBe(5) // the parser notices the missing ")" at the first token of the next line
    expect(p.message).toContain('Expected ")"')
  })
  test('local imports are followed; bare and missing ones are not', () => {
    put('lib/broken.js', 'export const steps = [1, 2\n')
    const entry = put('nested.scene.js', "import { scene } from 'mimir'\nimport { steps } from './lib/broken.js'\nimport './lib/absent.js'\nexport default scene({ title: 'n' }, () => {})\n")
    const p = findSyntaxError(entry)!
    expect(p.file).toBe(join(DIR, 'lib', 'broken.js'))
    expect(p.line).toBe(1)
  })
  test('an import that leaves the scene directory is not read', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mimir-preparse-out-'))
    try {
      writeFileSync(join(outside, 'bad.js'), 'export const x = (\n')
      mkdirSync(join(outside, 'scenes'))
      const entry = join(outside, 'scenes', 'a.scene.js')
      writeFileSync(entry, "import { x } from '../bad.js'\nexport default x\n")
      expect(findSyntaxError(entry)).toBeNull()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
  test('import cycles end; a missing entry is null, not a throw', () => {
    put('cycle/a.js', "import './b.js'\nexport const a = 1\n")
    put('cycle/b.js', "import './a.js'\nexport const b = 2\n")
    expect(findSyntaxError(join(DIR, 'cycle', 'a.js'))).toBeNull()
    expect(findSyntaxError(join(DIR, 'nope.scene.js'))).toBeNull()
  })
})

describe('locateFatal', () => {
  const ctx = { sceneDir: DIR, cwd: DIR }
  test('a fatal that already has a line is left alone', () => {
    const fatal = { message: 'TypeError: x', file: '/scene/bad.scene.js', line: 2 }
    expect(locateFatal(fatal, join(DIR, 'bad.scene.js'))).toBe(fatal)
  })
  test('a syntax error gets the file and the line; the browser message is kept', () => {
    const f = locateFatal({ message: 'SyntaxError: missing ) after argument list', file: 'http://127.0.0.1:1/scene/bad.scene.js', line: null }, join(DIR, 'bad.scene.js'))
    expect(f.line).toBe(5)
    expect(displayFile(f.file!, ctx)).toBe('bad.scene.js')
    expect(f.message).toBe('SyntaxError: missing ) after argument list (Expected ")" but found "s")')
  })
  test('the error of an imported module points at that module', () => {
    const f = locateFatal({ message: 'SyntaxError: Unexpected end of input', file: null, line: null }, join(DIR, 'nested.scene.js'))
    expect(displayFile(f.file!, ctx)).toBe(join('lib', 'broken.js'))
    expect(f.line).toBe(1)
  })
  test('an unknown import name points at the import line that lists it', () => {
    const entry = put('names.scene.js', "// header\nimport {\n  scene,\n  rectangle,\n} from 'mimir'\nexport default scene({ title: 'n' }, () => { rectangle() })\n")
    const f = locateFatal({ message: "'rectangle' is not part of the mimir API; did you mean 'rect'?", file: null, line: null }, entry)
    expect(f.line).toBe(4)
    expect(displayFile(f.file!, ctx)).toBe('names.scene.js')
    expect(f.message).toContain("did you mean 'rect'")
  })
  test('a failure that is not a parse problem stays without a line', () => {
    const fatal = { message: 'The scene module has no default export made with scene()', file: null, line: null }
    expect(locateFatal(fatal, join(DIR, 'good.scene.js'))).toBe(fatal)
  })
})
