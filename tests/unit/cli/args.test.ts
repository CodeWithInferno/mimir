import { describe, expect, test } from 'bun:test'
import {
  COMMANDS, COMMAND_NAMES, CONTACT_TOLERANCE, FINE_MAX_FRAMES, TURNTABLE_VIEWS, VIDEO_CRF, VIDEO_FPS, VIDEO_JOBS, commandHelp, parseAt, parseFine, parseFlags,
  parseSet, parseSize, parseTopLevel, toCheckOptions, toDocsOptions, toExamplesOptions, toExportOptions, toInitOptions, toNewOptions, toOpenOptions,
  toQueryOptions, toShotOptions, topHelp, wantsJson,
} from '../../../src/cli/args.ts'
import { UsageError, editDistance, suggest } from '../../../src/cli/errors.ts'

const shot = (...argv: string[]) => toShotOptions(parseFlags(COMMANDS.shot!, argv))
const usage = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(UsageError)
    return (e as UsageError).message
  }
  throw new Error('expected a UsageError')
}

describe('parseTopLevel', () => {
  test('no arguments, --help, -h and help give the top-level help', () => {
    for (const argv of [[], ['--help'], ['-h'], ['help']]) expect(parseTopLevel(argv)).toEqual({ kind: 'help' })
  })
  test('help <command> is that command with --help', () => {
    expect(parseTopLevel(['help', 'shot'])).toEqual({ kind: 'command', command: 'shot', rest: ['--help'] })
  })
  test('--version', () => {
    expect(parseTopLevel(['--version'])).toEqual({ kind: 'version' })
    expect(parseTopLevel(['-v'])).toEqual({ kind: 'version' })
  })
  test('a command keeps the rest of argv untouched', () => {
    expect(parseTopLevel(['check', 'a.js', '--all'])).toEqual({ kind: 'command', command: 'check', rest: ['a.js', '--all'] })
  })
  test('unknown command suggests the nearest one', () => {
    expect(usage(() => parseTopLevel(['chek', 'a.js']))).toContain('did you mean check?')
    expect(usage(() => parseTopLevel(['--json']))).toContain('expected a command')
  })
  test('every documented command exists', () => {
    expect(COMMAND_NAMES).toEqual(['check', 'shot', 'open', 'export', 'docs', 'examples', 'init', 'query', 'new', 'serve', 'skill', 'review', 'bench'])
  })
})

describe('parseFlags', () => {
  test('--flag value, --flag=value and short flags', () => {
    const a = parseFlags(COMMANDS.shot!, ['s.js', '--size', '640x360', '--scale=2', '-o', 'out'])
    expect(a.args).toEqual(['s.js'])
    expect(a.flags).toEqual({ size: '640x360', scale: '2', out: 'out' })
    expect(parseFlags(COMMANDS.shot!, ['s.js', '-oout']).flags.out).toBe('out')
    expect(parseFlags(COMMANDS.shot!, ['s.js', '-o=out']).flags.out).toBe('out')
  })
  test('list flags split on commas and accumulate', () => {
    const a = parseFlags(COMMANDS.shot!, ['s.js', '--set', 'a=1,b=2', '--set', 'c=3', '--views', 'iso,front'])
    expect(a.flags.set).toEqual(['a=1', 'b=2', 'c=3'])
    expect(a.flags.views).toEqual(['iso', 'front'])
  })
  test('flags may come before the scene, and -- ends the options', () => {
    expect(parseFlags(COMMANDS.check!, ['--all', 'a.js']).args).toEqual(['a.js'])
    expect(parseFlags(COMMANDS.check!, ['--', '--odd-name.js']).args).toEqual(['--odd-name.js'])
  })
  test('--json and --help are accepted by every command', () => {
    for (const name of COMMAND_NAMES) {
      const p = parseFlags(COMMANDS[name]!, ['--help'])
      expect(p.help).toBe(true)
    }
    expect(parseFlags(COMMANDS.check!, ['a.js', '--json']).json).toBe(true)
    expect(parseFlags(COMMANDS.check!, ['a.js', '--json=false']).json).toBe(false)
  })
  test('--text forces text, --json forces JSON, a pipe defaults to JSON', () => {
    expect(parseFlags(COMMANDS.check!, ['a.js', '--text'])).toMatchObject({ json: false, text: true })
    expect(usage(() => parseFlags(COMMANDS.check!, ['a.js', '--text', '--json']))).toContain('only one of --json and --text')
    expect(wantsJson(false, false, true)).toBe(false) // terminal
    expect(wantsJson(false, false, false)).toBe(true) // pipe
    expect(wantsJson(true, false, true)).toBe(true) // --json on a terminal
    expect(wantsJson(false, true, false)).toBe(false) // --text into a pipe
  })
  test('unknown option names the command and suggests', () => {
    const m = usage(() => parseFlags(COMMANDS.shot!, ['s.js', '--shet']))
    expect(m).toContain('unknown option --shet for "mimir shot"')
    expect(m).toContain('--sheet')
  })
  test('missing value, missing scene, extra argument', () => {
    expect(usage(() => parseFlags(COMMANDS.shot!, ['s.js', '--at']))).toContain('--at needs a value')
    expect(usage(() => parseFlags(COMMANDS.shot!, ['s.js', '--at', '--sheet']))).toContain('--at needs a value')
    expect(usage(() => parseFlags(COMMANDS.check!, []))).toContain('missing argument: <scene>')
    expect(usage(() => parseFlags(COMMANDS.check!, ['a.js', 'b.js']))).toContain('unexpected argument "b.js"')
    expect(usage(() => parseFlags(COMMANDS.check!, ['a.js', '--all=maybe']))).toContain('takes no value')
  })
  test('a usage error carries its command (so main can print the usage line)', () => {
    try {
      parseFlags(COMMANDS.shot!, [])
    } catch (e) {
      expect((e as UsageError).command).toBe('shot')
      expect((e as UsageError).exitCode).toBe(2)
    }
  })
})

describe('shot options', () => {
  test('defaults: every step, 1280x720, scale 1, no sheet', () => {
    expect(shot('s.js')).toEqual({
      scene: 's.js', mode: { kind: 'steps' }, sets: [], views: [], turntable: null, sheet: false, cols: null, debug: null,
      size: { width: 1280, height: 720 }, sizeExplicit: false, scale: 1, out: null, json: false,
    })
  })
  test('--steps, --at and --step', () => {
    expect(shot('s.js', '--steps').mode).toEqual({ kind: 'steps' })
    expect(shot('s.js', '--at', '1.5,3').mode).toEqual({ kind: 'at', items: [{ kind: 'time', t: 1.5 }, { kind: 'time', t: 3 }] })
    expect(shot('s.js', '--at', '0').mode).toEqual({ kind: 'at', items: [{ kind: 'time', t: 0 }] })
    expect(shot('s.js', '--step', '2').mode).toEqual({ kind: 'step', step: 2 })
  })
  test('only one frame selector', () => {
    expect(usage(() => shot('s.js', '--steps', '--at', '1'))).toContain('only one of')
    expect(usage(() => shot('s.js', '--step', '1', '--at', '1'))).toContain('only one of')
  })
  test('bad numbers are usage errors', () => {
    expect(usage(() => shot('s.js', '--at', '1,x'))).toContain('--at must be a number')
    expect(usage(() => shot('s.js', '--at', '-1'))).toContain('>= 0')
    expect(usage(() => shot('s.js', '--step', '1.5'))).toContain('whole step number')
    expect(usage(() => shot('s.js', '--scale', '9'))).toContain('between 0.25 and 4')
    expect(usage(() => shot('s.js', '--size', '1280'))).toContain('1280x720')
    expect(usage(() => shot('s.js', '--size', '4x4'))).toContain('between 16x16')
    expect(usage(() => shot('s.js', '--views', 'iso,../x'))).toContain('view names')
    expect(usage(() => shot('s.js', '--debug', 'a b'))).toContain('must be one of ids, boxes, safe')
    expect(usage(() => shot('s.js', '--debug', 'bogus'))).toContain('must be one of ids, boxes, safe')
    for (const mode of ['ids', 'boxes', 'safe']) expect(shot('s.js', '--debug', mode).debug).toBe(mode)
  })
  test('--set parses numbers, booleans and strings', () => {
    const o = shot('s.js', '--set', 'rpm=1200', '--set', 'open=true,mode=fast', '--set', 'x=-0.5')
    expect(o.sets).toEqual([
      { name: 'rpm', value: 1200 }, { name: 'open', value: true }, { name: 'mode', value: 'fast' }, { name: 'x', value: -0.5 },
    ])
    expect(usage(() => parseSet('rpm'))).toContain('name=value')
    expect(usage(() => parseSet('=3'))).toContain('name=value')
  })
  test('everything at once', () => {
    const o = shot('s.js', '--step', '2', '--views', 'iso,front', '--sheet', '--debug', 'ids', '--size', '640x360', '--scale', '2', '--out', 'o', '--json')
    expect(o).toEqual({
      scene: 's.js', mode: { kind: 'step', step: 2 }, sets: [], views: ['iso', 'front'], turntable: null, sheet: true, cols: null, debug: 'ids',
      size: { width: 640, height: 360 }, sizeExplicit: true, scale: 2, out: 'o', json: true,
    })
  })
  test('--at name=value addresses a frame by a parameter value; it mixes with times', () => {
    expect(shot('s.js', '--at', 'crank=90,2.5', '--at', 'open=true').mode).toEqual({
      kind: 'at', items: [{ kind: 'param', name: 'crank', value: 90 }, { kind: 'time', t: 2.5 }, { kind: 'param', name: 'open', value: true }],
    })
    expect(parseAt('mode=fast')).toEqual({ kind: 'param', name: 'mode', value: 'fast' })
    expect(parseAt('x=-0.5')).toEqual({ kind: 'param', name: 'x', value: -0.5 })
    expect(usage(() => parseAt('crank='))).toContain('seconds or name=value')
    expect(usage(() => parseAt('=3'))).toContain('seconds or name=value')
  })
  test('--cues and --fine are frame selectors of their own, and always write their sheet', () => {
    expect(shot('s.js', '--cues')).toMatchObject({ mode: { kind: 'cues' }, sheet: true })
    expect(shot('s.js', '--fine', '2:4:12')).toMatchObject({ mode: { kind: 'fine', t0: 2, t1: 4, count: 12 }, sheet: true })
    expect(parseFine('0:1.5:2')).toEqual({ t0: 0, t1: 1.5, count: 2 })
    expect(usage(() => shot('s.js', '--cues', '--step', '1'))).toContain('only one of --steps, --at, --step, --cues, --fine')
    expect(usage(() => shot('s.js', '--fine', '2:4:12', '--at', '1'))).toContain('only one of')
    for (const bad of ['2:4', '2:4:x', 'a:4:3', '2:4:12:1']) expect(usage(() => parseFine(bad))).toContain('t0:t1:n')
    expect(usage(() => parseFine('4:2:5'))).toContain('0 <= t0 < t1')
    expect(usage(() => parseFine('1:2:1'))).toContain(`2 to ${FINE_MAX_FRAMES} frames`)
    expect(usage(() => parseFine('1:2:2.5'))).toContain('frames')
    expect(usage(() => parseFine(`1:2:${FINE_MAX_FRAMES + 1}`))).toContain('frames')
  })
  test('--turntable is a switch that may carry the number of angles; --cols sets the sheet columns', () => {
    expect(shot('s.js', '--turntable').turntable).toBe(TURNTABLE_VIEWS)
    expect(shot('s.js', '--turntable=12').turntable).toBe(12)
    // the next token is never taken as its value: it is the scene
    expect(toShotOptions(parseFlags(COMMANDS.shot!, ['--turntable', 's.js']))).toMatchObject({ scene: 's.js', turntable: TURNTABLE_VIEWS })
    expect(usage(() => shot('s.js', '--turntable=1'))).toContain('from 2 to 72')
    expect(usage(() => shot('s.js', '--turntable=x'))).toContain('--turntable must be a number')
    expect(usage(() => shot('s.js', '--turntable', '--views', 'iso'))).toContain('only one of --views and --turntable')
    expect(shot('s.js', '--sheet', '--cols', '5').cols).toBe(5)
    expect(usage(() => shot('s.js', '--cols', '0'))).toContain('from 1 to 24')
  })
  test('parseSize accepts x, X and ×', () => {
    expect(parseSize('1920X1080')).toEqual({ width: 1920, height: 1080 })
    expect(parseSize('800×600')).toEqual({ width: 800, height: 600 })
  })
})

describe('other commands', () => {
  test('check', () => {
    expect(toCheckOptions(parseFlags(COMMANDS.check!, ['a.js']))).toEqual({ scene: 'a.js', all: false, json: false, describe: false })
    expect(toCheckOptions(parseFlags(COMMANDS.check!, ['a.js', '--all', '--json']))).toEqual({ scene: 'a.js', all: true, json: true, describe: false })
  })
  test('open', () => {
    expect(toOpenOptions(parseFlags(COMMANDS.open!, ['a.js']))).toEqual({ scene: 'a.js', port: null, open: true, json: false })
    expect(toOpenOptions(parseFlags(COMMANDS.open!, ['a.js', '--port', '5000', '--no-open']))).toEqual({ scene: 'a.js', port: 5000, open: false, json: false })
    expect(usage(() => toOpenOptions(parseFlags(COMMANDS.open!, ['a.js', '--port', '70000'])))).toContain('0..65535')
  })
  test('export: -o, --mp4 and --md, alone or together; at least one', () => {
    const base = { scene: 'a.js', out: null, mp4: null, md: null, frames: false, fps: VIDEO_FPS, size: null, crf: VIDEO_CRF, from: null, to: null, jobs: VIDEO_JOBS, fonts: 'used' as const, sets: [], json: false }
    const exp = (...argv: string[]) => toExportOptions(parseFlags(COMMANDS.export!, ['a.js', ...argv]))
    expect(exp('-o', 'out.html')).toEqual({ ...base, out: 'out.html' })
    expect(exp('--mp4', 'v.mp4')).toEqual({ ...base, mp4: 'v.mp4' })
    expect(exp('--md', 'a.md', '--frames')).toEqual({ ...base, md: 'a.md', frames: true })
    expect(exp('-o', 'o.html', '--mp4', 'v.mp4', '--md', 'a.md', '--fps', '60', '--size', '1280x720', '--crf', '20', '--from', '2', '--to', '5', '--jobs', '2', '--fonts', 'all', '--set', 'rpm=3')).toEqual({
      ...base, out: 'o.html', mp4: 'v.mp4', md: 'a.md', fps: 60, size: { width: 1280, height: 720 }, crf: 20, from: 2, to: 5, jobs: 2, fonts: 'all', sets: [{ name: 'rpm', value: 3 }],
    })
    expect(usage(() => exp())).toContain('missing -o <out.html>')
    expect(usage(() => exp('-o', 'o.html', '--frames'))).toContain('--frames belongs to --md')
    expect(usage(() => exp('-o', 'o.html', '--fps', '24'))).toContain('--fps belongs to --mp4')
    expect(usage(() => exp('-o', 'o.html', '--size', '640x360'))).toContain('--size belongs to --mp4 or to --md --frames')
    expect(usage(() => exp('--mp4', 'v.mp4', '--size', '641x360'))).toContain('even width and height')
    expect(usage(() => exp('--mp4', 'v.mp4', '--fps', '0'))).toContain('between 1 and 240')
    expect(usage(() => exp('--mp4', 'v.mp4', '--crf', '60'))).toContain('between 0 and 51')
    expect(usage(() => exp('--mp4', 'v.mp4', '--from', '5', '--to', '2'))).toContain('0 <= from < to')
    expect(usage(() => exp('--mp4', 'v.mp4', '--jobs', '99'))).toContain('from 1 to 16')
    expect(usage(() => exp('-o', 'o.html', '--fonts', 'some'))).toContain('used or all')
  })
  test('docs takes zero or one argument', () => {
    expect(toDocsOptions(parseFlags(COMMANDS.docs!, []))).toEqual({ query: null, json: false })
    expect(toDocsOptions(parseFlags(COMMANDS.docs!, ['Scene.step']))).toEqual({ query: 'Scene.step', json: false })
    expect(usage(() => parseFlags(COMMANDS.docs!, ['a', 'b']))).toContain('unexpected argument')
  })
  test('query validates what is asked, how many ids it takes, and when', () => {
    const q = (...argv: string[]) => toQueryOptions(parseFlags(COMMANDS.query!, ['a.js', ...argv]))
    expect(q('distance', 'piston', 'head')).toEqual({
      scene: 'a.js', what: 'distance', args: ['piston', 'head'], at: null, step: null, sets: [], tolerance: CONTACT_TOLERANCE, json: false,
    })
    expect(q('bounds', 'piston', '--at', '2.5', '--set', 'rpm=900')).toMatchObject({ what: 'bounds', at: { kind: 'time', t: 2.5 }, sets: [{ name: 'rpm', value: 900 }] })
    expect(q('visible', 'piston', '--at', 'crank=90')).toMatchObject({ at: { kind: 'param', name: 'crank', value: 90 } })
    expect(q('contacts', '--step', '3', '--tolerance', '0.1')).toMatchObject({ what: 'contacts', args: [], step: 3, tolerance: 0.1 })
    expect(q('contacts', 'rod').args).toEqual(['rod'])
    expect(q('state').args).toEqual([])
    expect(q('probes').what).toBe('probes')
    expect(usage(() => q('weight'))).toContain('distance, contacts, bounds, visible, state, probes')
    expect(usage(() => q('bound', 'x'))).toContain('did you mean bounds?')
    expect(usage(() => q('distance', 'a'))).toContain('query distance takes 2 ids (got 1: a)')
    expect(usage(() => q('bounds'))).toContain('query bounds takes 1 id (got 0)')
    expect(usage(() => q('state', 'x'))).toContain('query state takes no ids')
    expect(usage(() => q('contacts', 'a', 'b'))).toContain('takes 0 to 1 ids')
    expect(usage(() => q('state', '--at', '1', '--step', '1'))).toContain('only one of --at and --step')
    expect(usage(() => q('contacts', '--tolerance', '-1'))).toContain('>= 0')
    expect(usage(() => parseFlags(COMMANDS.query!, ['a.js']))).toContain('missing argument')
  })
  test('new takes a prompt, an agent, a model and its limits', () => {
    const n = (...argv: string[]) => toNewOptions(parseFlags(COMMANDS.new!, argv))
    expect(n('how does an engine work', '-o', 'dir')).toEqual({
      prompt: 'how does an engine work', out: 'dir', agent: null, model: null, maxTurns: null, maxUsd: null, system: null, resume: null, timeout: null, json: false, size: null, fast: false, full: false, mode: null, fix: null, edit: null, open: false, effort: null,
    })
    expect(n('x', '--once', '--fix', '2')).toMatchObject({ mode: 'once', fix: 2 })
    expect(n('x', '--loop')).toMatchObject({ mode: 'loop' })
    expect(n('x', '--full')).toMatchObject({ mode: 'loop', full: true })
    expect(n('make it red', '--edit', 'a.scene.js', '--open')).toMatchObject({ mode: 'once', edit: 'a.scene.js', open: true })
    expect(usage(() => n('x', '--once', '--loop'))).toContain('only one of --once and --loop')
    expect(usage(() => n('x', '--edit', 'a.scene.js', '--loop'))).toContain('--edit changes a scene in one call')
    expect(usage(() => n('x', '--fix', '-1'))).toContain('--fix must be a whole number')
    expect(n('x', '--agent', 'command', '--model', 'm1', '--max-turns', '12', '--budget-usd', '0.5', '--system', 's.md', '--resume', 'abc', '--timeout', '60')).toMatchObject({
      agent: 'command', model: 'm1', maxTurns: 12, maxUsd: 0.5, system: 's.md', resume: 'abc', timeout: 60,
    })
    expect(usage(() => n('  '))).toContain('empty')
    expect(usage(() => n('x', '--max-turns', '0'))).toContain('greater than 0')
    expect(usage(() => n('x', '--max-turns', '2.5'))).toContain('whole number')
    expect(usage(() => n('x', '--budget-usd', 'lots'))).toContain('--budget-usd must be a number')
  })
  test('examples takes an optional name; init takes a file name', () => {
    expect(toExamplesOptions(parseFlags(COMMANDS.examples!, []))).toEqual({ name: null, json: false })
    expect(toExamplesOptions(parseFlags(COMMANDS.examples!, ['hello-3d']))).toEqual({ name: 'hello-3d', json: false })
    expect(usage(() => parseFlags(COMMANDS.examples!, ['x', 'y']))).toContain('unexpected argument')
    expect(toInitOptions(parseFlags(COMMANDS.init!, ['my-scene']))).toEqual({ name: 'my-scene', out: null, force: false, json: false })
    expect(toInitOptions(parseFlags(COMMANDS.init!, ['pump.scene.js', '-o', 'scenes', '--force']))).toEqual({ name: 'pump.scene.js', out: 'scenes', force: true, json: false })
    expect(usage(() => toInitOptions(parseFlags(COMMANDS.init!, ['../x'])))).toContain('file name')
    expect(usage(() => toInitOptions(parseFlags(COMMANDS.init!, ['a b'])))).toContain('file name')
  })
})

describe('help', () => {
  test('top-level help lists every command and the exit codes', () => {
    const h = topHelp('9.9.9')
    expect(h).toContain('mimir 9.9.9')
    for (const n of COMMAND_NAMES) expect(h).toContain(`  ${n}`)
    expect(h).toContain('0 clean, 1 errors found, 2 usage or internal failure')
  })
  test('command help lists every flag of the command', () => {
    const h = commandHelp(COMMANDS.shot!)
    for (const f of COMMANDS.shot!.flags) expect(h).toContain(`--${f.name}`)
    expect(h).toContain('usage: mimir shot <scene>')
    expect(h).toContain('-o, --out dir')
    expect(h).toContain('--turntable[=n]') // a switch that may carry a value says how
  })
  test('every command has help, and every flag of every command a description', () => {
    for (const name of COMMAND_NAMES) {
      const spec = COMMANDS[name]!
      const h = commandHelp(spec)
      expect(h).toStartWith(`mimir ${name} - `)
      expect(h).toContain(`usage: mimir ${name}`)
      for (const f of spec.flags) {
        expect(f.help.length).toBeGreaterThan(8)
        expect(h).toContain(`--${f.name}`)
      }
      expect(h).toContain('--help')
    }
  })
})

describe('did-you-mean', () => {
  test('editDistance', () => {
    expect(editDistance('sheet', 'sheet')).toBe(0)
    expect(editDistance('shet', 'sheet')).toBe(1)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('kitten', 'sitting')).toBe(3)
  })
  test('suggest returns near names only, nearest first', () => {
    expect(suggest('chek', COMMAND_NAMES)).toEqual(['check'])
    expect(suggest('zzzzzz', COMMAND_NAMES)).toEqual([])
    expect(suggest('step', ['Scene.step', 'Step', 'stepper'])[0]).toBe('Step')
    // a short name that merely occurs inside the word is not a suggestion (was: "cylindr" → "DR, cylinder")
    expect(suggest('cylindr', ['DR', 'UR', 'cylinder', 'circle'])).toEqual(['cylinder'])
    expect(suggest('gear', ['kit.gearPair', 'kit.gear', 'rect'])).toEqual(['kit.gear', 'kit.gearPair'])
  })
})
