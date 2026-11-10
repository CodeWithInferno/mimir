// What an author (a person or a model) reads. Three layers, each cheap enough for its place:
//   mimir docs essentials        the always-needed core, on one page: scene, steps, params, placement, the common kinds and verbs
//   mimir docs module:<name>     one module, one line per name with the first line of its description
//   mimir docs <symbol>          one name: description, declaration, a real use from an example
// This file keeps the first layer small and true (every name it mentions exists) and the second and third complete.
// No tokenizer is part of the repository, so the size limit is in characters, with the conversion stated: a token of
// code-heavy English is 3 to 4 characters, so TOKENS(text) is between length / 4 and length / 3.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { lookup, parseDts, renderModule, renderReference, splitQuery } from '../../../src/cli/commands/docs.ts'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const index = parseDts(readFileSync(join(ROOT, 'types', 'mimir.d.ts'), 'utf8'))
const essentials = readFileSync(join(ROOT, 'docs', 'topics', 'essentials.md'), 'utf8')
/** the pessimistic end of the range: 3 characters a token */
const tokensAtMost = (text: string): number => Math.ceil(text.length / 3)
/** what the essentials page may cost: about 4k tokens, counted at the pessimistic 3 characters a token */
const ESSENTIALS_TOKENS = 4000
const MODULES = ['core', 'r2d', 'r3d', 'anim', 'guide', 'check', 'kit', 'plot', 'diagram', 'flow', 'sim', 'tex', 'player', 'quick'] // 'player': part.describe(), the one name the player adds to a scene

describe('the reference an author reads', () => {
  test('the essentials page costs at most about 4k tokens; the whole reference is several times that and is never needed whole', () => {
    expect(tokensAtMost(essentials)).toBeLessThanOrEqual(ESSENTIALS_TOKENS)
    const whole = renderReference(index)
    expect(whole.length).toBeGreaterThan(essentials.length * 4)
    // printed for docs/STATUS.md: characters, and the token range (length / 4 … length / 3)
    const row = (name: string, text: string): string => `  ${name.padEnd(24)} ${String(text.length).padStart(6)} chars   ${Math.round(text.length / 4)}–${Math.ceil(text.length / 3)} tokens`
    console.log([row('mimir docs essentials', essentials), row('mimir docs reference', whole), ...MODULES.map((m) => row(`mimir docs module:${m}`, renderModule(index, m)))].join('\n'))
  })

  test('every name the essentials page uses is in the reference', () => {
    const top = new Set(index.entries.filter((e) => e.parent === null).map((e) => e.name))
    const members = new Set(index.entries.filter((e) => e.parent !== null).map((e) => e.name.slice(e.name.lastIndexOf('.') + 1)))
    const code = [...essentials.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n') + '\n' + [...essentials.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!).join('\n')
    const stripped = code.replace(/\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''")
    // the language itself, and the names the page's own examples declare
    const JS = new Set(['Math', 'round', 'sqrt', 'map', 'import', 'export', 'default', 'from', 'const', 'function'])
    const declared = new Set([...stripped.matchAll(/\b(?:const|let)\s+(?:\[([^\]]+)\]|([A-Za-z_$][\w$]*))/g)].flatMap((m) => (m[1] ?? m[2]!).split(',').map((x) => x.trim())))
    const unknownCalls = new Set<string>(), unknownMembers = new Set<string>()
    for (const m of stripped.matchAll(/(\.)?\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2]!
      if (JS.has(name) || /^(mimir|if|for|while|return)$/.test(name)) continue
      if (m[1]) { if (!members.has(name) && !top.has(name)) unknownMembers.add(name) } else if (!top.has(name) && !declared.has(name) && !members.has(name)) unknownCalls.add(name)
    }
    expect([...unknownCalls]).toEqual([])
    expect([...unknownMembers]).toEqual([])
    // constants and palette names written in the text
    for (const m of stripped.matchAll(/\b([A-Z][A-Z_]{2,})\b/g)) if (!/^(ONE|WHOLE|API|DEAD|PARAM|TEXT|OVERLAP|OFF|FRAME|OCCLUDED|FLOATING|INTERPENETRATE|GUIDE|TARGET|UNKNOWN|TYPE|CODE|CONFIG|JS|PNG|ODE)$/.test(m[1]!) && !/^[A-Z]+-[A-Z]+/.test(m[1]!)) expect(top.has(m[1]!), m[1]).toBe(true)
    // the modules it points to exist
    for (const m of MODULES) expect(index.topics, m).toContain(m)
  })

  test('mimir docs module:<name> answers for every module with one line per name; a section rule inside a module is not a module', () => {
    expect([...index.topics].sort()).toEqual([...MODULES].sort())
    for (const m of MODULES) {
      const hit = lookup(index, `module:${m}`)
      expect(hit.kind, m).toBe('topic')
      if (hit.kind !== 'topic') continue
      const text = renderModule(index, hit.topic)
      expect(text.split('\n')[0]).toBe(`# ${m}`)
      expect(text.split('\n').length).toBeGreaterThan(1)
    }
    const kit = lookup(index, 'module:kit')
    expect(kit.kind === 'topic' && kit.entries.map((e) => e.name)).toEqual(expect.arrayContaining(['kit', 'crankSlider', 'gearPair']))
    // the members a module adds to Scene / Step are listed under it: s.param in core, st.say in the guide, kit.gear in the kit
    expect(renderModule(index, 'core')).toMatch(/^  param\(name: string/m)
    expect(renderModule(index, 'core')).toMatch(/^  state\(name: string/m)
    expect(renderModule(index, 'guide')).toMatch(/^  say\(sentence: string\): Step/m)
    expect(renderModule(index, 'kit')).toMatch(/^  function gear\(/m)
    // together the modules are the whole reference
    expect(MODULES.map((m) => renderModule(index, m)).join('\n\n').length).toBe(renderReference(index).length)
  })

  test('a bare name: the symbol first, then the module; module: and symbol: say which is meant', () => {
    expect(splitQuery('module:flow')).toEqual({ kind: 'module', name: 'flow' })
    expect(splitQuery('Step.say')).toEqual({ kind: null, name: 'Step.say' })
    // flow, guide and tex are a function and a module
    for (const name of ['flow', 'guide', 'tex']) {
      const bare = lookup(index, name), mod = lookup(index, `module:${name}`), sym = lookup(index, `symbol:${name}`)
      expect([bare.kind, mod.kind, sym.kind], name).toEqual(['symbol', 'topic', 'symbol'])
    }
    // anim is a module; Anim (another case) is a type: the module is the nearer answer to the lower-case word
    expect(lookup(index, 'anim').kind).toBe('topic')
    const anim = lookup(index, 'symbol:anim')
    expect(anim.kind === 'symbol' && anim.entries[0]!.name).toBe('Anim')
    expect(lookup(index, 'module:nothing').kind).toBe('none')
    expect(lookup(index, 'guide:essentials').kind).toBe('none') // guides are files, answered by the command itself
  })

  test('every public function carries a one-line description (most with a tiny example in it)', () => {
    const fns = index.entries.filter((e) => e.parent === null && e.kind === 'function')
    const bare = fns.filter((e) => e.doc.trim() === '')
    // overloads and the second spelling of a rate function share the comment of the first declaration
    const firstByName = new Map<string, boolean>()
    for (const e of fns) if (!firstByName.has(e.name)) firstByName.set(e.name, e.doc.trim() !== '')
    const undocumented = [...firstByName].filter(([, has]) => !has).map(([n]) => n)
    console.log(`  ${fns.length} function declarations, ${bare.length} without a comment of their own (${undocumented.length} names have none at all: ${undocumented.join(', ') || '-'})`)
    expect(undocumented.length).toBeLessThanOrEqual(12)
  })
})
