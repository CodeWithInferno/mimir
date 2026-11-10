// The write-once path of `mimir new`: the pure parts, and the driver with a model and an engine that are handed in.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeWriteCommand, parseClaudeReply } from '../../../src/cli/agents/claude.ts'
import { parseCodexReply } from '../../../src/cli/agents/codex.ts'
import { commandWriter, writerTemplate } from '../../../src/cli/agents/command.ts'
import { DEFAULT_FIX_ROUNDS, NAME_WORDS } from '../../../src/cli/agents/limits.ts'
import {
  atLeastAsGood, clipReview, correctionPrompt, editPrompt, extractModule, freeScenePath, generateOnce, needsCorrection, prepareOnce, sceneNameFromPrompt, selectWriter, sumUsage,
  type CallResult, type OnceDeps, type OnceReview, type PreparedOnce,
} from '../../../src/cli/agents/once.ts'
import { LOOP_BEGIN, LOOP_END, composeOncePage, composePage, stripLoop } from '../../../src/cli/agents/page.ts'
import type { AgentOptions, NewResult, Progress } from '../../../src/cli/agents/types.ts'

const ROOT = join(import.meta.dir, '..', '..', '..')
const MODULE = "import { scene } from 'mimir'\nexport default scene({ title: 'x' }, (s) => {})\n"

describe('extractModule', () => {
  test('the fenced block with an export default; text around it is ignored', () => {
    expect(extractModule('Here you go:\n```js\n' + MODULE + '```\nEnjoy.')).toEqual({ module: MODULE, cut: false })
    expect(extractModule('```javascript\n' + MODULE + '```').module).toBe(MODULE)
    expect(extractModule('```\n' + MODULE + '```').module).toBe(MODULE)
  })
  test('of several blocks, the last one that exports', () => {
    const reply = '```js\nconst a = 1\n```\n```js\nexport default 1\n```\n```js\nexport default 2\n```\n```sh\nmimir open x\n```'
    expect(extractModule(reply).module).toBe('export default 2\n')
  })
  test('a block that was never closed is taken and marked as cut', () => {
    expect(extractModule('```js\n' + MODULE)).toEqual({ module: MODULE, cut: true })
  })
  test('a bare module without fences', () => {
    expect(extractModule(MODULE).module).toBe(MODULE)
  })
  test('no module', () => {
    expect(extractModule('I cannot do that.').module).toBeNull()
    expect(extractModule('').module).toBeNull()
    expect(extractModule('```js\n\n```').module).toBeNull()
  })
})

describe('the name of the scene file', () => {
  test('the subject of the question, not its question words', () => {
    expect(sceneNameFromPrompt('how does a TCP three-way handshake work')).toBe('tcp-three-way-handshake')
    expect(sceneNameFromPrompt('How does binary search work?')).toBe('binary-search')
    expect(sceneNameFromPrompt('explain the Wankel rotary engine, please')).toBe('wankel-rotary-engine')
    expect(sceneNameFromPrompt('???')).toBe('scene')
    expect(sceneNameFromPrompt('one two three four five six').split('-')).toHaveLength(NAME_WORDS)
  })
  test('a generation never overwrites a file', () => {
    const taken = new Set(['/d/lever.scene.js', '/d/lever-2.scene.js'])
    expect(freeScenePath('/d', 'lever', (p) => taken.has(p))).toBe('/d/lever-3.scene.js')
    expect(freeScenePath('/d', 'pulley', (p) => taken.has(p))).toBe('/d/pulley.scene.js')
  })
})

describe('the prompts', () => {
  test('a correction carries the request, the module and the review, without the line meant for an agent with tools', () => {
    const review = 'FAIL 1 error\nE GUIDE-TARGET line 4\n\nFLAG SMALL (step 3): tiny\n\nFIX FIRST: 1 error and 1 flag. Fix all of them in one edit, then run mimir review again.\n'
    const p = correctionPrompt('how does a lever work', MODULE, review, 'The scene has no steps.')
    expect(p).toContain('Request: how does a lever work')
    expect(p).toContain('```js\n' + MODULE.trimEnd() + '\n```')
    expect(p).toContain('E GUIDE-TARGET line 4')
    expect(p).toContain('FLAG SMALL')
    expect(p).toContain('The scene has no steps.')
    expect(p).not.toContain('run mimir review again')
    expect(clipReview('CLEAN: no errors, no flags. (no sheet rendered: --sheet renders one)\n')).toBe('')
  })
  test('a long review keeps its start and its end', () => {
    const long = 'START ' + 'x'.repeat(5000) + ' END'
    const c = clipReview(long, 200)
    expect(c.startsWith('START')).toBe(true)
    expect(c.endsWith('END')).toBe(true)
    expect(c).toContain('characters left out')
    expect(c.length).toBeLessThan(300)
  })
  test('an edit carries the scene as it is', () => {
    const p = editPrompt('make the piston red', MODULE)
    expect(p).toContain('Change it: make the piston red')
    expect(p).toContain(MODULE.trimEnd())
  })
})

describe('which version is better', () => {
  const s = (errors: number, steps: number, flags: number, warnings = 0) => ({ errors, steps, flags, warnings })
  test('errors, then a story at all, then findings, then warnings; a tie goes to the later one', () => {
    expect(atLeastAsGood(s(0, 4, 2), s(1, 4, 0))).toBe(true)
    expect(atLeastAsGood(s(1, 4, 0), s(0, 4, 2))).toBe(false)
    expect(atLeastAsGood(s(0, 4, 1), s(0, 0, 0))).toBe(true)
    expect(atLeastAsGood(s(0, 4, 1), s(0, 4, 2))).toBe(true)
    expect(atLeastAsGood(s(0, 4, 2), s(0, 4, 1))).toBe(false)
    expect(atLeastAsGood(s(0, 4, 1, 1), s(0, 4, 1, 0))).toBe(false)
    expect(atLeastAsGood(s(0, 4, 1), s(0, 4, 1))).toBe(true)
  })
  test('what asks for a correction', () => {
    expect(needsCorrection(s(0, 4, 0, 3))).toBe(false)
    expect(needsCorrection(s(1, 4, 0))).toBe(true)
    expect(needsCorrection(s(0, 0, 0))).toBe(true)
    expect(needsCorrection(s(0, 4, 1))).toBe(true)
  })
  test('usage adds up, and a kind nobody reported stays unknown', () => {
    const u = (input: number, output: number) => ({ api_calls: 1, input, cache_write: null, cache_read: 0, output, thinking: null, total: input + output })
    expect(sumUsage([{ usage: u(100, 10) }, { usage: u(200, 20) }])).toEqual({ api_calls: 2, input: 300, cache_write: null, cache_read: 0, output: 30, thinking: null, total: 330 })
    expect(sumUsage([{ usage: null }])).toBeNull()
  })
})

describe('the page of a write-once call', () => {
  const page = readFileSync(join(ROOT, 'skills', 'mimir', 'PAGE.md'), 'utf8')
  const head = readFileSync(join(ROOT, 'skills', 'mimir', 'ONCE.md'), 'utf8')
  test('the page marks the part that is about an agent with tools', () => {
    expect(page).toContain(LOOP_BEGIN)
    expect(page).toContain(LOOP_END)
    expect(page.indexOf(LOOP_BEGIN)).toBeLessThan(page.indexOf(LOOP_END))
  })
  test('a write-once page has the head and the reference, and nothing about tools or a shell', () => {
    for (const quick of [true, false]) {
      const text = composeOncePage(head, page, { quick })
      expect(text.startsWith('You write ONE Mimir scene')).toBe(true)
      expect(text).toContain("from 'mimir'")
      expect(text).not.toContain('mimir review')
      expect(text).not.toContain('Read tool')
      expect(text).not.toContain('<!--')
      expect(text.includes('explain(')).toBe(quick)
    }
  })
  test('with explain() the reference is the explain topic alone, between the head and its rules', () => {
    const topic = '# explain(): write it once\n`mimir check <scene>` must say OK.\n\n**cells(values)**: a row.\n'
    const text = composeOncePage(head, page, { quick: true, quickTopic: topic })
    expect(text).toContain('**cells(values)**: a row.')
    expect(text).not.toContain('mimir check')
    expect(text).not.toContain('## The full API')
    expect(text.indexOf('**cells(values)**')).toBeLessThan(text.indexOf('## What makes it good'))
    expect(text.indexOf('You write ONE Mimir scene')).toBe(0)
    // without explain() the rules of the head (written for it) stay out and the page brings its own
    const plain = composeOncePage(head, page, { quick: false, quickTopic: topic })
    expect(plain).toContain('## The full API')
    expect(plain).not.toContain('## What makes it good')
  })
  test('the page of an agent keeps its loop and loses only the marker lines', () => {
    const text = composePage(page, { quick: false, size: 'small' })
    expect(text).toContain('mimir review')
    expect(text).not.toContain('<!--')
    expect(stripLoop('a\n' + LOOP_BEGIN + ' x -->\nloop\n' + LOOP_END + '\nb\n')).toBe('a\nb\n')
  })
})

describe('writers', () => {
  const options = { binary: '/bin/model', model: 'm1', writerTemplate: null } as unknown as AgentOptions
  test('the first adapter: no tools, the page as the whole system prompt, the request on stdin', () => {
    const argv = claudeWriteCommand('PAGE', options)
    expect(argv.slice(0, 2)).toEqual(['/bin/model', '-p'])
    expect(argv[argv.indexOf('--system-prompt') + 1]).toBe('PAGE')
    expect(argv[argv.indexOf('--tools') + 1]).toBe('')
    expect(argv[argv.indexOf('--model') + 1]).toBe('m1')
    expect(argv).not.toContain('--allowedTools')
  })
  test('its answer: text, cost, tokens, one request', () => {
    const out = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 1750, total_cost_usd: 0.001, result: '```js\nexport default 1\n```', usage: { input_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 12 }, modelUsage: { 'model-x': {} } })
    const r = parseClaudeReply(out, 0, '')
    expect(r).toMatchObject({ error: null, model: 'model-x', costUsd: 0.001, durationMs: 1750 })
    expect(r.usage).toMatchObject({ api_calls: 1, input: 400, output: 12, total: 412 })
    expect(parseClaudeReply('', 1, 'not signed in').error).toContain('not signed in')
    expect(parseClaudeReply(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' }), 1, '').error).toContain('boom')
  })
  test('the second adapter: the last message of the stream, and the tokens of the turn', () => {
    const lines = [
      { type: 'thread.started', thread_id: 't1' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'thinking' } },
      { type: 'item.completed', item: { type: 'agent_message', text: '```js\nexport default 1\n```' } },
      { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50 } },
    ].map((l) => JSON.stringify(l)).join('\n')
    const r = parseCodexReply(lines, 0, '')
    expect(r.text).toContain('export default 1')
    expect(r.usage).toMatchObject({ input: 400, cache_read: 600, output: 50, total: 1050 })
    expect(parseCodexReply('', 1, 'no login').error).toContain('no login')
  })
  test('any command: the page and the request on stdin, or as placeholders', () => {
    expect(writerTemplate({ MIMIR_WRITER_COMMAND: 'run it' }, { writer: 'other' })).toBe('run it')
    expect(writerTemplate({}, { writer: 'other' })).toBe('other')
    expect(writerTemplate({}, {})).toBeNull()
    expect(commandWriter.detect({}, {}).available).toBe(false)
    expect(commandWriter.detect({ MIMIR_WRITER_COMMAND: 'my-model --fast' }, {})).toMatchObject({ available: true, binary: 'my-model' })
    const piped = commandWriter.command('PAGE', 'Request: x', { ...options, writerTemplate: 'my-model --name {model}' })
    expect(piped.argv).toEqual(['my-model', '--name', 'm1'])
    expect(piped.stdin).toBe('PAGE\n\nRequest: x')
    expect(piped.env).toMatchObject({ MIMIR_SYSTEM: 'PAGE', MIMIR_PROMPT: 'Request: x' })
    const args = commandWriter.command('PAGE with spaces', 'a "quoted" request', { ...options, writerTemplate: 'my-model --system {system} {prompt}' })
    expect(args.argv).toEqual(['my-model', '--system', 'PAGE with spaces', 'a "quoted" request'])
    expect(args.stdin).toBeNull()
    expect(commandWriter.parse('', 1, 'oops').error).toContain('oops')
    expect(commandWriter.parse('text', 0, '').error).toBeNull()
  })
  test('choosing: a named agent must be able to write, and nothing found is a setup error that lists what was tried', () => {
    expect(() => selectWriter(null, { PATH: '' }, {})).toThrow(/none was found/)
    expect(() => selectWriter('nobody', { PATH: '' }, {})).toThrow(/unknown agent/)
    const s = selectWriter(null, { PATH: '', MIMIR_WRITER_COMMAND: 'cat' }, {})
    expect(s.adapter.name).toBe('command')
    expect(s.source).toBe('detected')
  })
})

// ── the driver, with a model and an engine that are handed in ────────────────────────────────────

const review = (errors: number, flags: number, steps = 4, warnings = 0): OnceReview => ({ ok: errors === 0, errors, warnings, flags, steps, text: `review: ${errors} errors, ${flags} flags\n` })
const reply = (text: string, extra: Partial<CallResult> = {}): CallResult => ({ text, error: null, model: 'm1', costUsd: 0.01, durationMs: 900, usage: { api_calls: 1, input: 3000, cache_write: null, cache_read: null, output: 800, thinking: null, total: 3800 }, wallMs: 1000, ...extra })
const block = (body: string): string => '```js\n' + body + '\n```'

function setup(env: Record<string, string> = {}, more: Partial<PreparedOnce['request']> = {}): { p: PreparedOnce; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mimir-once-'))
  const p = prepareOnce({ prompt: 'how does a lever work', workdir: dir, cwd: dir, env: { PATH: '', MIMIR_WRITER_COMMAND: 'cat', ...env }, root: ROOT, agent: null, model: null, maxTurns: null, budgetUsd: null, timeout: null, instructions: null, resume: null, ...more })
  return { p, dir }
}

async function run(p: PreparedOnce, replies: CallResult[], reviews: OnceReview[]): Promise<{ result: NewResult; events: Array<Progress | NewResult>; prompts: string[]; systems: string[] }> {
  const prompts: string[] = [], systems: string[] = [], events: Array<Progress | NewResult> = []
  let r = 0, v = 0
  const deps: OnceDeps = {
    write: async (system, prompt) => { systems.push(system); prompts.push(prompt); return replies[r++]! },
    review: async () => reviews[v++]!,
    sheet: async (_scene, out) => join(out, 'sheet.png'),
  }
  const result = await generateOnce(p, deps, { emit: (e) => events.push(e), log: () => {}, now: () => 0 })
  return { result, events, prompts, systems }
}

describe('generateOnce', () => {
  test('a clean first answer is ONE call: the file is written, reviewed here, and reported ready', async () => {
    const { p, dir } = setup()
    expect(p.fixRounds).toBe(DEFAULT_FIX_ROUNDS)
    const { result, prompts, systems, events } = await run(p, [reply(block('export default 1'))], [review(0, 0)])
    expect(result).toMatchObject({ ok: true, stage: 'ready', verdict: 'ready', mode: 'once', turns: 1, cost_usd: 0.01, first_review_clean: true, looked: false, scene_lines: 1, rounds: { check: 1, look: 0, edit: 1 } })
    expect(result.scene).toBe(join(dir, 'lever.scene.js'))
    expect(readFileSync(result.scene!, 'utf8')).toBe('export default 1\n')
    expect(result.usage).toMatchObject({ api_calls: 1, total: 3800 })
    expect(result.sheet).toContain('sheet.png')
    expect(prompts).toEqual(['Request: how does a lever work'])
    expect(systems[0]!.startsWith('You write ONE Mimir scene')).toBe(true)
    expect(events[events.length - 1]).toBe(result)
    expect(existsSync(join(result.run_dir!, 'usage.json'))).toBe(true)
    expect(result.notes.join(' ')).toContain('no model looked at the frames')
  })
  test('a finding asks once more, with the module and the review; the corrected file is what stays', async () => {
    const { p } = setup()
    const { result, prompts } = await run(p, [reply(block('export default 1')), reply(block('export default 2'))], [review(1, 1), review(0, 0)])
    expect(result).toMatchObject({ ok: true, verdict: 'ready', turns: 2, cost_usd: 0.02, first_review_clean: false })
    expect(readFileSync(result.scene!, 'utf8')).toBe('export default 2\n')
    expect(prompts[1]).toContain('export default 1')
    expect(prompts[1]).toContain('review: 1 errors, 1 flags')
    expect(result.calls).toEqual([{ seconds: 1, tokens: 3800, cost_usd: 0.01, errors: 1, flags: 1 }, { seconds: 1, tokens: 3800, cost_usd: 0.01, errors: 0, flags: 0 }])
  })
  test('a correction that makes things worse is not kept', async () => {
    const { p } = setup()
    const { result } = await run(p, [reply(block('export default 1')), reply(block('export default 2'))], [review(0, 1), review(2, 0)])
    expect(result).toMatchObject({ ok: true, verdict: 'ready-with-flags', flags: 1 })
    expect(readFileSync(result.scene!, 'utf8')).toBe('export default 1\n')
    expect(result.notes.join(' ')).toContain('the better earlier version was kept')
  })
  test('errors that survive the corrections are a failure that says so, and the file stays for a person to fix', async () => {
    const { p } = setup({ MIMIR_FIX_ROUNDS: '2' })
    expect(p.fixRounds).toBe(2)
    const { result } = await run(p, [reply(block('export default 1')), reply(block('export default 2')), reply(block('export default 3'))], [review(3, 0), review(2, 0), review(1, 0)])
    expect(result).toMatchObject({ ok: false, stage: 'failed', verdict: 'failed', turns: 3 })
    expect(result.error).toContain('1 error after 2 corrections')
    expect(readFileSync(result.scene!, 'utf8')).toBe('export default 3\n')
  })
  test('--fix 0 never asks again', async () => {
    const { p } = setup({}, { fixRounds: 0 })
    const { result } = await run(p, [reply(block('export default 1'))], [review(0, 2)])
    expect(result).toMatchObject({ ok: true, verdict: 'ready-with-flags', turns: 1 })
  })
  test('an answer without a module, or a model that fails, writes nothing', async () => {
    const a = setup()
    const none = await run(a.p, [reply('I would rather not.')], [])
    expect(none.result).toMatchObject({ ok: false, scene: null, check: null })
    expect(none.result.error).toContain('without a module')
    expect(existsSync(join(a.dir, 'lever.scene.js'))).toBe(false)
    const b = setup()
    const failed = await run(b.p, [reply('', { error: 'the model ended with an error: overloaded' })], [])
    expect(failed.result.error).toContain('overloaded')
  })
  test('a scene without steps is asked about, and is a failure when it stays that way', async () => {
    const { p } = setup()
    const { result, prompts } = await run(p, [reply(block('export default 1')), reply(block('export default 2'))], [review(0, 0, 0), review(0, 0, 0)])
    expect(prompts[1]).toContain('The scene has no steps')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('tells no story')
  })
  test('the cost ceiling stops further corrections', async () => {
    const { p } = setup({ MIMIR_BUDGET_USD: '0.005', MIMIR_FIX_ROUNDS: '3' })
    const { result } = await run(p, [reply(block('export default 1'))], [review(0, 1)])
    expect(result.turns).toBe(1)
    expect(result.over_budget).toBe(true)
    expect(result.notes.join(' ')).toContain('reached the ceiling')
  })
  test('a second generation of the same request does not overwrite the first', async () => {
    const { p, dir } = setup()
    writeFileSync(join(dir, 'lever.scene.js'), 'mine\n')
    const { result } = await run(p, [reply(block('export default 1'))], [review(0, 0)])
    expect(result.scene).toBe(join(dir, 'lever-2.scene.js'))
    expect(readFileSync(join(dir, 'lever.scene.js'), 'utf8')).toBe('mine\n')
  })
  test('--edit changes the named scene in one call and keeps what it was', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimir-once-'))
    const file = join(dir, 'engine.scene.js')
    writeFileSync(file, 'export default 1\n')
    const p = prepareOnce({ prompt: 'make the piston red', workdir: dir, cwd: dir, env: { PATH: '', MIMIR_WRITER_COMMAND: 'cat' }, root: ROOT, agent: null, model: null, maxTurns: null, budgetUsd: null, timeout: null, instructions: null, resume: null, edit: 'engine.scene.js' })
    const { result, prompts } = await run(p, [reply(block('export default 2'))], [review(0, 0)])
    expect(result).toMatchObject({ ok: true, scene: file, turns: 1 })
    expect(prompts[0]).toContain('Change it: make the piston red')
    expect(prompts[0]).toContain('export default 1')
    expect(readFileSync(file, 'utf8')).toBe('export default 2\n')
    expect(readFileSync(join(result.run_dir!, 'before-edit.scene.js'), 'utf8')).toBe('export default 1\n')
    // an edit that produces nothing leaves the file as it was
    const again = await run(p, [reply('no')], [])
    expect(again.result.ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('export default 2\n')
  })
  test('what can be wrong before a model is called is a setup error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimir-once-'))
    const base = { prompt: 'x', workdir: dir, cwd: dir, root: ROOT, agent: null, model: null, maxTurns: null, budgetUsd: null, timeout: null, instructions: null, resume: null }
    expect(() => prepareOnce({ ...base, env: { PATH: '' } })).toThrow(/needs a model that answers in text/)
    expect(() => prepareOnce({ ...base, env: { PATH: '', MIMIR_WRITER_COMMAND: 'cat' }, edit: 'missing.scene.js' })).toThrow(/no scene file/)
    expect(() => prepareOnce({ ...base, env: { PATH: '', MIMIR_WRITER_COMMAND: 'cat' }, instructions: 'missing.md' })).toThrow(/do not exist/)
    expect(() => prepareOnce({ ...base, env: { PATH: '', MIMIR_WRITER_COMMAND: 'cat' }, fast: true })).toThrow(/names no cheap model/)
  })
})
