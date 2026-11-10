// The lean generation path: the one page (and that it cannot drift from the engine), `mimir review` (pure side),
// the lean launch of the claude adapter, usage and verdicts, sizes, compact shot output, `mimir bench` (pure side).
// No agent and no browser is started here.
import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { CAPTION_ZONE_TOP } from '../../../src/cli/lean-specs.ts'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { claude, dotComponent, CLAUDE_FAST_MODEL } from '../../../src/cli/agents/claude.ts'
import { prepare, type GenerateRequest } from '../../../src/cli/agents/generate.ts'
import { CONCEPT_SIZES, SIZE_NAMES, sizeFromPrompt } from '../../../src/cli/agents/limits.ts'
import { PAGE_FILE, PAGE_MAX_BYTES, QUICK_BEGIN, checkPage, composePage, declares, pageNames, quickSection, stripQuick } from '../../../src/cli/agents/page.ts'
import { StageTracker, readReviewVerdict } from '../../../src/cli/agents/stages.ts'
import type { AgentEvent, AgentOptions, RunContext } from '../../../src/cli/agents/types.ts'
import { COMMANDS, parseFlags, toNewOptions } from '../../../src/cli/args.ts'
import { formatBench, meanRow, parsePrompts, promptSlug, toBenchOptions, type BenchRow } from '../../../src/cli/commands/bench.ts'
import { REVIEW_LIMITS, boxOf, compositionFlags, contentBox, diffFrames, formatSteps, isAutoId, toReviewOptions, verdictLine, type SeenFrame, type SeenNode, type StepReview, captionCollisions } from '../../../src/cli/commands/review.ts'
import { formatManifestCompact, sheetBase } from '../../../src/cli/commands/shot.ts'
import { CliError } from '../../../src/cli/errors.ts'
import type { ManifestEntry } from '../../../src/cli/manifest.ts'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const page = readFileSync(join(ROOT, PAGE_FILE), 'utf8')
const types = readFileSync(join(ROOT, 'types', 'mimir.d.ts'), 'utf8')

describe('the one page', () => {
  test('every name it uses is declared by the engine (it cannot drift from mimir docs)', () => {
    expect(checkPage(page, types)).toEqual([])
  })
  test('a name the engine does not have is reported', () => {
    expect(checkPage(page + '\n`flubber(1)`\n', types)).toEqual(['PAGE.md names `flubber`, which types/mimir.d.ts does not declare'])
  })
  test('the explain() section is launched only when the engine exports explain', () => {
    expect(page).toContain(QUICK_BEGIN)
    expect(quickSection(page)).toContain('explain({')
    expect(stripQuick(page)).not.toContain('explain(')
    const without = composePage(page, { quick: false, size: 'small' })
    const withQuick = composePage(page, { quick: true, size: 'small' })
    expect(without).not.toContain('explain(')
    expect(withQuick).toContain('export default explain({')
    expect(withQuick).not.toContain('quick:begin')
    // explain() comes before the full API: it is the first choice
    expect(withQuick.indexOf('## First choice: `explain()`')).toBeLessThan(withQuick.indexOf('## The full API'))
    expect(declares('declare function explain(spec: Spec): Scene', 'explain')).toBe(true)
    expect(declares(types, 'scene')).toBe(true)
  })
  test('it fits its budget, and a bigger concept gets its limits appended', () => {
    expect(Buffer.byteLength(composePage(page, { quick: declares(types, 'explain'), size: 'small' }))).toBeLessThanOrEqual(PAGE_MAX_BYTES)
    expect(composePage(page, { quick: false, size: 'small' })).not.toContain('## This run')
    const medium = composePage(page, { quick: false, size: 'medium' })
    expect(medium).toContain(`use ${CONCEPT_SIZES.medium.steps} steps`)
    expect(medium).toContain('ONE filmstrip')
  })
  test('names are read from imports and from calls in backticks', () => {
    expect(pageNames("import { scene, rect } from 'mimir'\nuse `bars(() => [1])` and `st.say('x')`")).toEqual(['scene', 'rect', 'bars'])
  })
})

describe('sizes', () => {
  test('a one-line question is a small concept; longer prompts are bigger', () => {
    expect(sizeFromPrompt('how does binary search work')).toBe('small')
    expect(sizeFromPrompt(Array(30).fill('word').join(' '))).toBe('medium')
    expect(sizeFromPrompt(Array(80).fill('word').join(' '))).toBe('large')
    expect(SIZE_NAMES.map((n) => CONCEPT_SIZES[n].maxTurns)).toEqual([30, 50, 90])
  })
  test('mimir new takes --size, --fast and --full', () => {
    const n = (...argv: string[]) => toNewOptions(parseFlags(COMMANDS.new!, argv))
    expect(n('x', '--size', 'medium', '--fast')).toMatchObject({ size: 'medium', fast: true, full: false })
    expect(() => n('x', '--size', 'huge')).toThrow('--size must be one of small, medium, large')
  })
})

const options = (over: Partial<AgentOptions> = {}): AgentOptions => ({
  model: 'some-model', maxTurns: 30, budgetUsd: 2, instructionsFile: '/mimir/skills/mimir/PAGE.md', instructions: 'THE PAGE', resume: null,
  sessionId: 'session-1', binDir: '/mimir/bin', skillDir: null, pluginDir: null, binary: '/agents/bin/agent', commandTemplate: null, extraArgs: [], env: { PATH: '/usr/bin' }, lean: true, ...over,
})

describe('claude: the lean launch', () => {
  const after = (argv: string[], flag: string): string => argv[argv.indexOf(flag) + 1]!
  test('the page replaces the system prompt; no plugin, no skill, the minimum tool set', () => {
    const { argv } = claude.command('how does a lever work', '/work', options())
    expect(after(argv, '--system-prompt')).toBe('THE PAGE')
    expect(argv).not.toContain('--append-system-prompt-file')
    expect(argv).not.toContain('--plugin-dir')
    expect(after(argv, '--tools')).toBe('Read,Write,Edit,Bash')
    expect(after(argv, '--allowedTools')).toBe('Bash(mimir *)')
    expect(argv).toContain('--disable-slash-commands')
    expect(after(argv, '--max-turns')).toBe('30')
    expect(argv.join(' ')).not.toContain('Skill')
  })
  test('a lean run is not stopped for starting without the plugin', () => {
    const run: RunContext = { options: options({ pluginDir: '/mimir' }), workdir: '/work', memo: {} }
    const events = claude.parseEvent(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'm', cwd: '/work', plugins: [] }), run)
    expect(events.some((e) => e.kind === 'abort')).toBe(false)
  })
  test('usage: tokens by kind from the result, API calls = distinct message ids', () => {
    const run: RunContext = { options: options(), workdir: '/work', memo: {} }
    const say = (id: string): string => JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id, content: [{ type: 'text', text: 'hi' }] } })
    for (const id of ['a', 'a', 'b']) claude.parseEvent(say(id), run)
    const end = claude.parseEvent(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, num_turns: 5, total_cost_usd: 0.05, result: 'RESULT /work/x.scene.js',
      usage: { input_tokens: 10, cache_creation_input_tokens: 4000, cache_read_input_tokens: 20000, output_tokens: 2500, output_tokens_details: { thinking_tokens: 700 } },
    }), run)[0] as Extract<AgentEvent, { kind: 'end' }>
    expect(end.outcome.usage).toEqual({ api_calls: 2, input: 10, cache_write: 4000, cache_read: 20000, output: 2500, thinking: 700, total: 26510 })
  })
  test('a working directory under a dot-directory is refused before anything is spent', () => {
    expect(dotComponent('/home/me/.mimir/x')).toBe('.mimir')
    expect(dotComponent('/home/me/work/../x')).toBe(null)
    expect(claude.preflight!('/work/.hidden/x', options())).toContain('cannot write under a dot-directory')
    expect(claude.preflight!('/work/.hidden/x', options({ env: { MIMIR_ALLOW_DOT_DIR: '1' } }))).toBe(null)
    expect(claude.preflight!('/work/plain/x', options())).toBe(null)
    expect(claude.defaults.fastModel).toBe(CLAUDE_FAST_MODEL)
  })
})

describe('prepare: lean by default', () => {
  const request = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
    prompt: 'how does a lever work', workdir: 'out', cwd: tmpdir(), env: { PATH: '/usr/bin', MIMIR_AGENT_BIN: process.execPath, MIMIR_CONFIG: undefined }, root: ROOT,
    agent: 'claude', model: null, maxTurns: null, budgetUsd: null, timeout: null, instructions: null, resume: null, ...over,
  })
  test('the page is the instructions, the size sets the turn limit, no skill is handed over', () => {
    const p = prepare(request())
    expect(p.lean).toBe(true)
    expect(p.size).toBe('small')
    expect(p.options.maxTurns).toBe(CONCEPT_SIZES.small.maxTurns)
    expect(p.options.skillDir).toBe(null)
    expect(p.options.pluginDir).toBe(null)
    expect(p.options.instructions).toContain('mimir review')
    expect(p.command.argv).toContain('--system-prompt')
  })
  test('--full keeps the loop through the skill; --fast picks the cheap model unless one is named', () => {
    const full = prepare(request({ full: true }))
    expect(full.lean).toBe(false)
    expect(full.command.argv).toContain('--append-system-prompt-file')
    expect(prepare(request({ fast: true })).options.model).toBe(CLAUDE_FAST_MODEL)
    expect(prepare(request({ fast: true, model: 'opus' })).options.model).toBe('opus')
    expect(prepare(request({ size: 'large' })).options.maxTurns).toBe(CONCEPT_SIZES.large.maxTurns)
  })
  test('a dot-directory is a setup error', () => {
    expect(() => prepare(request({ workdir: '.mimir/x' }))).toThrow(CliError)
  })
})

describe('stages: mimir review is a check round, and its sheet a picture to look at', () => {
  const tool = (id: string, name: string, action: Extract<AgentEvent, { kind: 'tool' }>['action']): AgentEvent => ({ kind: 'tool', id, name, summary: '', action })
  test('first review clean, looked', () => {
    const t = new StageTracker(() => 0)
    t.feed(tool('1', 'Write', { type: 'write', path: '/w/a.scene.js' }))
    t.feed(tool('2', 'Bash', { type: 'shell', command: 'mimir review a.scene.js --sheet' }))
    t.feed({ kind: 'output', id: '2', failed: false, text: 'OK 0 errors, 0 warnings\n\nCLEAN: no errors, no flags.\nNEXT: open .mimir/review/a/sheet.png with your image-reading tool NOW' })
    t.feed(tool('3', 'Read', { type: 'read', path: '/w/.mimir/review/a/sheet.png' }))
    expect(t.summary()).toMatchObject({ firstClean: true, reviews: 1, looked: true, rounds: { check: 1, look: 1, edit: 1 }, shots: { sheet: 1 } })
  })
  test('flags are not clean; an edit after the look leaves the final frames unseen', () => {
    const t = new StageTracker(() => 0)
    t.feed(tool('1', 'Write', { type: 'write', path: '/w/a.scene.js' }))
    t.feed(tool('2', 'Bash', { type: 'shell', command: 'mimir review a.scene.js --sheet' }))
    t.feed({ kind: 'output', id: '2', failed: false, text: 'OK 0 errors, 0 warnings\nFLAG SMALL (step 2): …\n\nFLAGS: no errors, 1 flag to fix in one edit.\nNEXT: open .mimir/review/a/sheet.png with' })
    t.feed(tool('3', 'Read', { type: 'read', path: '/w/.mimir/review/a/sheet.png' }))
    t.feed(tool('4', 'Edit', { type: 'write', path: '/w/a.scene.js' }))
    expect(t.summary()).toMatchObject({ firstClean: false, looked: false, rounds: { look: 1 } })
    expect(readReviewVerdict('FAIL 2 errors, 0 warnings\n\nFIX FIRST: 2 errors. Fix')).toBe('errors')
    expect(readReviewVerdict('OK 0 errors, 0 warnings')).toBe(null)
  })
})

const node = (id: string, x: number, y: number, w: number, h: number, over: Partial<SeenNode> = {}): SeenNode => ({ id, kind: 'rect', parent: null, leaf: true, rect: { x, y, width: w, height: h }, text: null, ink: 1, look: 'a', ...over })
const frame = (...nodes: SeenNode[]): SeenFrame => ({ stage: { width: 1280, height: 720 }, params: {}, nodes, missing: [], lines: [] })
const stepOf = (n: number, f: SeenFrame, before: SeenFrame | null, over: Partial<StepReview> = {}): StepReview => ({
  step: n, title: `S${n}`, t0: n - 1, t1: n, params: {}, say: [], stage: Object.fromEntries(f.nodes.map((x) => [x.id, { ...boxOf(x, f.stage), text: x.text, parent: x.parent }])),
  ...diffFrames(before, f, { ...REVIEW_LIMITS }), content: contentBox(f), outside: [], cues: [], lines: [], ...over,
})

describe('review: from frames to text and findings', () => {
  test('what entered, moved, changed look and left', () => {
    const a = frame(node('box', 100, 100, 200, 100), node('label', 100, 300, 100, 40, { kind: 'text', text: '20 %' }), node('old', 0, 0, 10, 10))
    const b = frame(node('box', 400, 100, 200, 100), node('label', 100, 300, 100, 40, { kind: 'text', text: '90 %' }), node('new', 600, 600, 50, 50))
    expect(diffFrames(a, b, { ...REVIEW_LIMITS })).toEqual({ entered: ['new'], moved: ['box'], changed: ['label'], left: ['old'] })
    expect(boxOf(a.nodes[0]!, a.stage)).toEqual({ x: 16, y: 21, w: 16, h: 14 })
  })
  test('composition: small, top-heavy, caption strip, lopsided, faint text, a link that lands on nothing', () => {
    const top = frame(node('row', 400, 40, 400, 80))
    const flags = (f: SeenFrame, over: Partial<StepReview> = {}): string[] => compositionFlags([stepOf(1, f, null, over)], [f], { ...REVIEW_LIMITS }).map((x) => x.code)
    expect(flags(top)).toEqual(['SMALL', 'TOP-HEAVY'])
    expect(flags(frame(node('big', 100, 150, 1080, 500)))).toEqual(['CAPTION'])
    expect(flags(frame(node('big', 100, 150, 1080, 420)))).toEqual([])
    expect(flags(frame(node('right', 500, 150, 760, 400)))).toEqual(['LOPSIDED'])
    expect(flags(frame(node('big', 100, 150, 1080, 420), node('t', 200, 200, 100, 30, { text: 'ghost', ink: 0.2 })))).toEqual(['FAINT-TEXT'])
    expect(flags(frame(node('big', 100, 150, 1080, 420)), { cues: [{ words: 'the pump', verb: 'point', t: 0.5, targets: [{ id: 'pump', at: null }] }] })).toEqual(['NOT ON STAGE YET'])
    // the caption line is measured where it is drawn: an object beside it is fine, an object under its words is not
    const line = { x: 440, y: 650, width: 400, height: 30 }
    expect(flags({ ...frame(node('big', 100, 150, 1080, 420), node('legend', 60, 600, 200, 100)), caption: line })).toEqual([])
    expect(flags({ ...frame(node('big', 100, 150, 1080, 420), node('bars', 500, 560, 200, 100)), caption: line })).toEqual(['CAPTION'])
    expect(captionCollisions({ ...frame(node('bars', 500, 560, 200, 100)), caption: line }, { ...REVIEW_LIMITS })).toEqual([{ id: 'bars', bottom: 92, top: 90 }])
    expect(REVIEW_LIMITS.caption).toBe(CAPTION_ZONE_TOP)
    expect(CAPTION_ZONE_TOP).toBeGreaterThan(85)
    // a story fills its picture up: where the content hangs is judged on the finished picture only
    const full = frame(node('big', 100, 150, 1080, 420))
    expect(compositionFlags([stepOf(1, top, null), stepOf(2, full, top)], [top, full], { ...REVIEW_LIMITS }).map((x) => x.code)).toEqual([])
    // a threshold is a named default that a call can change
    expect(toReviewOptions(parseFlags(COMMANDS.review!, ['a.scene.js', '--limit', 'smallWidth=20', '--limit', 'smallArea=1'])).limits.smallWidth).toBe(20)
    expect(() => toReviewOptions(parseFlags(COMMANDS.review!, ['a.scene.js', '--limit', 'nope=1']))).toThrow('--limit must look like name=number')
  })
  test('the text: named objects with place and size, unnamed ones counted, a step that shows nothing new says so', () => {
    const a = frame(node('plank', 100, 300, 1000, 40), node('rect7', 0, 0, 10, 10), node('n', 300, 200, 60, 30, { kind: 'text', text: '100 N' }))
    const s1 = stepOf(1, a, null, { say: ['A [plank](plank).'], params: { push: 0 }, cues: [{ words: 'plank', verb: 'point', t: 0.5, targets: [{ id: 'plank', at: [47, 44] }] }] })
    const s2 = stepOf(2, a, a)
    const text = formatSteps([s1, s2], new Map([['plank', 'line'], ['rect7', 'rect'], ['n', 'text']]), { ...REVIEW_LIMITS }, 12).join('\n')
    expect(text).toContain('step 1 "S1" 0.0-1.0s  push=0')
    expect(text).toContain('new: plank@47,44 78x6  n@26,30 5x4 "100 N"  (+1 more)')
    expect(text).toContain('"plank" point at 0.5s -> #plank@47,44')
    expect(text).toContain('nothing entered, moved, changed or left: this step shows nothing new')
    expect(isAutoId('rect12', 'rect')).toBe(true)
    expect(isAutoId('crate', 'rect')).toBe(false)
  })
  test('the last line says what to do next, and demands the one look when there is a sheet', () => {
    const sheet = { path: '.mimir/review/a/sheet.png', width: 1280, height: 544, tokens: 928 }
    expect(verdictLine({ ok: true, errors: 0 }, [], sheet)).toStartWith('CLEAN: no errors, no flags.\nNEXT: open .mimir/review/a/sheet.png with your image-reading tool NOW')
    expect(verdictLine({ ok: true, errors: 0 }, [{ code: 'SMALL', steps: [2], what: '', fix: '' }], null)).toBe('FLAGS: no errors, 1 flag to fix in one edit.')
    expect(verdictLine({ ok: false, errors: 2 }, [], null)).toStartWith('FIX FIRST: 2 errors.')
  })
})

describe('shot: compact text, sheets named by kind', () => {
  test('the directory once, names only, no hash; the sheet says what a look costs', () => {
    const entries: ManifestEntry[] = [
      { path: '/w/.mimir/shots/a/step-01.png', step: 1, title: 'Intake', t: 1.999, camera: null, width: 1280, height: 720, sha256: 'aa' },
      { path: '/w/.mimir/shots/a/sheet.png', step: null, title: 'story sheet', t: null, camera: null, width: 1280, height: 284, sha256: 'cc', sheet: { cols: 2, rows: 1, frames: 2, tokens: 485 } },
    ]
    const text = formatManifestCompact(entries, '/w/.mimir/shots/a', '/w')
    expect(text).toBe('in .mimir/shots/a/\nstep 1 "Intake" t=1.999s  1280x720  step-01.png\nsheet 2x1  1280x284  sheet.png  (about 485 tokens to look at)\n')
    expect(text).not.toContain('aa')
  })
  test('a cue sheet and a filmstrip have their own file names', () => {
    expect([sheetBase('steps'), sheetBase('step'), sheetBase('cues'), sheetBase('fine')]).toEqual(['sheet', 'sheet', 'cues', 'film'])
  })
})

describe('bench (pure side)', () => {
  test('prompts: one per line, comments skipped; the default file has six small concepts and none of the held-out ones', () => {
    const prompts = parsePrompts(readFileSync(join(ROOT, 'bench', 'small-concepts.txt'), 'utf8'))
    expect(prompts.length).toBe(6)
    expect(prompts.join(' ').toLowerCase()).not.toMatch(/turbofan|jet engine|rc circuit|attention/)
    expect(prompts.every((p) => sizeFromPrompt(p) === 'small')).toBe(true)
    expect(promptSlug('how does a TCP three-way handshake work')).toBe('tcp-three-way-handshake')
    expect(toBenchOptions(parseFlags(COMMANDS.bench!, ['--runs', '2', '--only', 'lever', '--fast']))).toMatchObject({ runs: 2, only: ['lever'], fast: true, full: false })
  })
  test('one table: a row per run and the mean', () => {
    const row = (over: Partial<BenchRow>): BenchRow => ({
      prompt: 'how does a lever work', run: 1, dir: 'b/lever', verdict: 'ready', ok: true, api_calls: 4, turns: 9, seconds: 30, tokens: 40000, cache_read: 30000, cache_write: 8000, input: 10, output: 2000,
      cost_usd: 0.05, first_review_clean: true, looks: 1, review_rounds: 2, scene_lines: 50, sheet: 'b/lever/.mimir/new/lever/sheet.png', model: 'm', error: null, ...over,
    })
    const rows = [row({}), row({ prompt: 'how does binary search work', api_calls: 6, cost_usd: 0.07, first_review_clean: false })]
    const mean = meanRow(rows)
    expect(mean).toMatchObject({ api_calls: 5, first_review_clean: 0.5, ready: 1 })
    expect(mean.cost_usd).toBeCloseTo(0.06, 6)
    const text = formatBench(rows)
    expect(text.split('\n')[0]).toMatch(/^prompt\s+verdict\s+calls\s+turns\s+s\s+tokens/)
    expect(text).toContain('mean of 2')
    expect(text).toContain('b/lever/.mimir/new/lever/sheet.png')
  })
})
