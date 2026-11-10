// The pure side of `mimir new`, `mimir serve` and `mimir skill`: adapters (command lines, stream parsing, detection),
// how one is chosen, the config file, stages, and the skill folder itself (frontmatter, size, generated reference).
// No agent, no browser and no network is started here. tests/e2e/new.test.ts drives the real launcher.
import { describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { claude, claudeAllowedTools, CLAUDE_SKILL } from '../../../src/cli/agents/claude.ts'
import { codex } from '../../../src/cli/agents/codex.ts'
import { command, commandTemplate, COMMAND_PLACEHOLDERS } from '../../../src/cli/agents/command.ts'
import { CONFIG_FILE, findConfig, loadConfig, parseAgentConfig } from '../../../src/cli/agents/config.ts'
import { changedScenes, prepare, sceneFiles, type GenerateRequest } from '../../../src/cli/agents/generate.ts'
import { ADAPTERS, DEFAULT_BUDGET_USD, DEFAULT_MAX_TURNS, DEFAULT_TIMEOUT_S, STAGES, adapterNames, detectAll, selectAdapter } from '../../../src/cli/agents/index.ts'
import { API_PREFIX, SKILL_SPEC, diffReferences, moduleSlug, presentTargets, skill, skillDir, skillReferences, snippetPath, targetDir, toSkillOptions, withSnippet, SNIPPET_BEGIN, SNIPPET_END } from '../../../src/cli/agents/skill.ts'
import { StageTracker, mimirCalls, readCheckStatus, shotKinds } from '../../../src/cli/agents/stages.ts'
import { EVENT_TEXT_MAX, OUTPUT_HEAD, OUTPUT_TAIL, clipOutput, parseResultLine, splitCommand, toolSummary, withInstructions } from '../../../src/cli/agents/text.ts'
import type { AgentEvent, AgentOptions, Progress, RunContext } from '../../../src/cli/agents/types.ts'
import { parseFlags } from '../../../src/cli/args.ts'
import { parseDts, renderReference, typesPath } from '../../../src/cli/commands/docs.ts'
import { SERVE_SPEC, freeDir, listScenes, ownHost, slugOf, toServeOptions, DEFAULT_JOBS } from '../../../src/cli/commands/serve.ts'
import { CliError, UsageError } from '../../../src/cli/errors.ts'
import type { Io } from '../../../src/cli/io.ts'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const WORK = mkdtempSync(join(realpathSync(tmpdir()), 'mimir-agents-'))
let n = 0
const fresh = (): string => { const d = join(WORK, `d${++n}`); mkdirSync(d, { recursive: true }); return d }
process.on('exit', () => rmSync(WORK, { recursive: true, force: true }))

const options = (over: Partial<AgentOptions> = {}): AgentOptions => ({
  model: 'some-model', maxTurns: 40, budgetUsd: 2, instructionsFile: '/mimir/skills/mimir/gen-system.md', instructions: 'Follow the loop.\n', resume: null,
  sessionId: 'session-1', binDir: '/mimir/bin', skillDir: '/mimir/skills/mimir', pluginDir: '/mimir', binary: '/usr/local/bin/agent', commandTemplate: null, extraArgs: [], env: { PATH: '/usr/bin' }, ...over,
})
const run = (over: Partial<AgentOptions> = {}): RunContext => ({ options: options(over), workdir: '/work', memo: {} })
const after = (argv: string[], flag: string): string => argv[argv.indexOf(flag) + 1]!
const io = (cwd: string, env: Record<string, string | undefined> = {}): Io & { printed: string; logged: string[] } => {
  const o = { printed: '', logged: [] as string[], json: true, cwd, env, out(text: string) { o.printed += text }, log(m: string) { o.logged.push(m) } }
  return o
}

describe('adapters', () => {
  test('three adapters; none is required, each documents its defaults and says whether it was ever run', () => {
    expect(adapterNames()).toEqual(['command', 'claude', 'codex'])
    for (const a of ADAPTERS) {
      expect(a.describe.length).toBeGreaterThan(10)
      expect(a.defaults.maxTurns).toBe(DEFAULT_MAX_TURNS)
      expect(a.defaults.budgetUsd).toBe(DEFAULT_BUDGET_USD)
      expect(['tested', 'untested']).toContain(a.status)
    }
    expect(codex.status).toBe('untested')
    expect(codex.describe).toContain('Untested')
    // model names live only in adapter defaults: an alias of the agent's own, or nothing
    expect(claude.defaults.model).toBe('sonnet')
    expect(codex.defaults.model).toBeNull()
    expect(command.defaults.model).toBeNull()
    expect([DEFAULT_MAX_TURNS, DEFAULT_BUDGET_USD, DEFAULT_TIMEOUT_S].every((v) => v > 0)).toBe(true)
    expect(STAGES).toEqual(['storyboard', 'writing', 'checking', 'looking', 'fixing', 'ready', 'failed'])
  })

  test('detect never throws: a missing executable is an answer that says what to do', () => {
    const none = { PATH: fresh() }
    expect(claude.detect(none, {})).toMatchObject({ available: false, binary: null })
    expect(claude.detect(none, {}).why).toContain('MIMIR_AGENT_BIN')
    expect(codex.detect(none, {}).available).toBe(false)
    expect(command.detect(none, {})).toMatchObject({ available: false })
    expect(command.detect(none, {}).why).toContain('MIMIR_AGENT_COMMAND')
    const dir = fresh()
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 })
    expect(claude.detect({ PATH: dir }, {})).toMatchObject({ available: true, binary: bin })
    expect(claude.detect({ PATH: '', MIMIR_AGENT_BIN: bin }, {})).toMatchObject({ available: true, binary: bin })
    expect(claude.detect({ PATH: dir, MIMIR_AGENT_BIN: join(dir, 'nope') }, {})).toMatchObject({ available: false })
    expect(command.detect({ MIMIR_AGENT_COMMAND: 'my-agent {prompt}' }, {})).toMatchObject({ available: true, binary: 'my-agent' })
    expect(command.detect({}, { command: 'other {prompt}' })).toMatchObject({ available: true, binary: 'other' })
  })
})

describe('choosing the adapter: flag, then environment, then config, then the first one found', () => {
  const dir = fresh()
  for (const name of ['claude', 'codex']) writeFileSync(join(dir, name), '#!/bin/sh\n', { mode: 0o755 })
  const both = { PATH: dir }

  test('detection order: a configured command first, then the installed command lines by name', () => {
    expect(selectAdapter(null, both, {})).toMatchObject({ source: 'detected', adapter: { name: 'claude' } })
    expect(selectAdapter(null, { ...both, MIMIR_AGENT_COMMAND: 'x {prompt}' }, {}).adapter.name).toBe('command')
    expect(selectAdapter(null, both, { command: 'x {prompt}' }).adapter.name).toBe('command')
    const onlyCodex = fresh()
    writeFileSync(join(onlyCodex, 'codex'), '#!/bin/sh\n', { mode: 0o755 })
    expect(selectAdapter(null, { PATH: onlyCodex }, {}).adapter.name).toBe('codex')
    expect(detectAll(both, {}).map((r) => [r.name, r.available])).toEqual([['command', false], ['claude', true], ['codex', true]])
  })

  test('overridable by flag, environment and config, in that order', () => {
    expect(selectAdapter(null, both, { name: 'codex' })).toMatchObject({ source: 'config', adapter: { name: 'codex' } })
    expect(selectAdapter(null, { ...both, MIMIR_AGENT: 'claude' }, { name: 'codex' })).toMatchObject({ source: 'env', adapter: { name: 'claude' } })
    expect(selectAdapter('codex', { ...both, MIMIR_AGENT: 'claude' }, {})).toMatchObject({ source: 'flag', adapter: { name: 'codex' } })
  })

  test('errors say what to do: an unknown name, a named agent that is missing, no agent at all', () => {
    expect(() => selectAdapter('claud', both, {})).toThrow(new UsageError('unknown agent "claud"; did you mean claude? (agents: command, claude, codex)', 'new'))
    expect(() => selectAdapter(null, { ...both, MIMIR_AGENT: 'nope' }, {})).toThrow(/named by MIMIR_AGENT/)
    expect(() => selectAdapter('command', both, {})).toThrow(/--agent command: no command template.*Nothing was generated\./s)
    let message = ''
    try { selectAdapter(null, { PATH: fresh() }, {}) } catch (e) { message = (e as Error).message }
    expect(message).toContain('needs a coding agent, and none was found on this machine')
    for (const name of adapterNames()) expect(message).toContain(`  ${name}: `)
  })
})

describe('claude: the command line of the measured recipe', () => {
  const cmd = claude.command('how does a pump work', '/work', options())
  const argv = cmd.argv

  test('headless, isolated from the user settings, no MCP, edits accepted, the plugin loaded in place', () => {
    expect(argv.slice(0, 3)).toEqual(['/usr/local/bin/agent', '-p', 'how does a pump work'])
    expect(after(argv, '--plugin-dir')).toBe('/mimir')
    expect(after(argv, '--setting-sources')).toBe('')
    expect(argv).toContain('--strict-mcp-config')
    expect(after(argv, '--permission-mode')).toBe('acceptEdits')
    expect(after(argv, '--tools')).toBe('Read,Write,Edit,Bash,Skill')
    expect([after(argv, '--output-format'), argv.includes('--verbose')]).toEqual(['stream-json', true])
  })

  test('the three permission traps of a headless run are session rules, one argument each', () => {
    expect(claudeAllowedTools(options())).toEqual([`Skill(${CLAUDE_SKILL})`, 'Bash(mimir *)', 'Read(//mimir/skills/mimir/**)'])
    const at = argv.indexOf('--allowedTools')
    expect(argv.slice(at + 1, at + 4)).toEqual([`Skill(${CLAUDE_SKILL})`, 'Bash(mimir *)', 'Read(//mimir/skills/mimir/**)'])
    expect(argv[at + 4]).toBe('--tools')
    // without a plugin there is no skill to launch and no Skill tool
    const bare = claude.command('x', '/work', options({ pluginDir: null, skillDir: null })).argv
    expect(claudeAllowedTools(options({ pluginDir: null, skillDir: null }))).toEqual(['Bash(mimir *)'])
    expect(bare).not.toContain('--plugin-dir')
    expect(after(bare, '--tools')).toBe('Read,Write,Edit,Bash')
    // a path with a space stays one rule
    expect(claudeAllowedTools(options({ skillDir: '/my files/skills/mimir' }))[2]).toBe('Read(//my files/skills/mimir/**)')
  })

  test('instructions are a file; model and limits are passed on; a new session or a resumed one', () => {
    expect(after(argv, '--append-system-prompt-file')).toBe('/mimir/skills/mimir/gen-system.md')
    expect([after(argv, '--model'), after(argv, '--max-turns'), after(argv, '--max-budget-usd'), after(argv, '--session-id')]).toEqual(['some-model', '40', '2', 'session-1'])
    const resumed = claude.command('make it red', '/work', options({ resume: 'old-session', model: null, extraArgs: ['--effort', 'high'] })).argv
    expect(after(resumed, '--resume')).toBe('old-session')
    expect(resumed).not.toContain('--session-id')
    expect(resumed).not.toContain('--model')
    expect(resumed.slice(-2)).toEqual(['--effort', 'high'])
  })

  test('stdin is closed and this CLI is first on PATH', () => {
    expect(cmd.stdin).toBeNull()
    expect(cmd.env.PATH).toBe(['/mimir/bin', '/usr/bin'].join(delimiter))
  })
})

describe('claude: reading stream-json', () => {
  const init = (over: Record<string, unknown> = {}): string => JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1', model: 'model-x', cwd: '/work', plugins: [{ name: 'mimir', path: '/mimir' }], ...over })
  const say = (content: unknown[], over: Record<string, unknown> = {}): string => JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { role: 'assistant', content }, ...over })
  const parse = (line: string, r = run()): AgentEvent[] => claude.parseEvent(line, r)

  test('init → start; tool calls carry what they do; text is one line', () => {
    expect(parse(init())).toEqual([{ kind: 'start', model: 'model-x', session: 's-1', workdir: '/work' }])
    expect(parse(say([
      { type: 'text', text: 'First\n  the storyboard.' },
      { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/work/pump.scene.js', content: '…' } },
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'mimir check pump.scene.js --text' } },
      { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: '/work/.mimir/shots/pump/sheet.png' } },
      { type: 'tool_use', id: 't4', name: 'Skill', input: { skill: 'mimir:mimir' } },
    ]))).toEqual([
      { kind: 'turn' },
      { kind: 'text', text: 'First the storyboard.' },
      { kind: 'tool', id: 't1', name: 'Write', summary: '/work/pump.scene.js', action: { type: 'write', path: '/work/pump.scene.js' } },
      { kind: 'tool', id: 't2', name: 'Bash', summary: 'mimir check pump.scene.js --text', action: { type: 'shell', command: 'mimir check pump.scene.js --text' } },
      { kind: 'tool', id: 't3', name: 'Read', summary: '/work/.mimir/shots/pump/sheet.png', action: { type: 'read', path: '/work/.mimir/shots/pump/sheet.png' } },
      { kind: 'tool', id: 't4', name: 'Skill', summary: 'mimir:mimir', action: { type: 'skill', name: 'mimir:mimir' } },
    ])
  })

  test('a sub-agent\'s messages are not turns of the run, and its calls do not move the stage', () => {
    expect(parse(say([{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'mimir check a.scene.js' } }], { parent_tool_use_id: 'task-1' }))).toEqual([
      { kind: 'tool', id: 'x', name: 'Bash', summary: 'mimir check a.scene.js', action: { type: 'other' } },
    ])
  })

  test('tool results come back with their call id; a picture is left out, long output keeps its start and its end', () => {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't2', content: 'FAIL 2 errors, 0 warnings' },
      { type: 'tool_result', tool_use_id: 't3', content: [{ type: 'image', source: { data: 'AAAA' } }, { type: 'text', text: 'a picture' }], is_error: false },
      { type: 'tool_result', tool_use_id: 't5', content: 'boom', is_error: true },
    ] } })
    expect(parse(line)).toEqual([
      { kind: 'output', id: 't2', text: 'FAIL 2 errors, 0 warnings', failed: false },
      { kind: 'output', id: 't3', text: 'a picture', failed: false },
      { kind: 'output', id: 't5', text: 'boom', failed: true },
    ])
    const long = '{"ok":false,"errors":3,"warnings":0,' + 'x'.repeat(OUTPUT_HEAD + OUTPUT_TAIL + 500) + 'THE END'
    const clipped = clipOutput(long)
    expect(clipped.length).toBeLessThan(long.length)
    expect(clipped.startsWith('{"ok":false,"errors":3')).toBe(true)
    expect(clipped.endsWith('THE END')).toBe(true)
    expect(clipOutput('short')).toBe('short')
  })

  test('the end: success, the limits, an error; refused calls are counted, not hidden', () => {
    const result = (over: Record<string, unknown>): AgentEvent => parse(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 9, duration_ms: 4200, total_cost_usd: 0.25, session_id: 's-1', permission_denials: [], result: 'done\nRESULT /work/pump.scene.js', ...over }))[0]!
    expect(result({})).toEqual({ kind: 'end', outcome: { ok: true, error: null, text: 'done\nRESULT /work/pump.scene.js', turns: 9, costUsd: 0.25, durationMs: 4200, session: 's-1', denials: [], usage: null } })
    expect(result({ subtype: 'error_max_turns', is_error: true })).toMatchObject({ outcome: { ok: false, error: 'the agent hit its turn limit (40; raise it with --max-turns)' } })
    expect(result({ subtype: 'error_max_budget_usd', is_error: true })).toMatchObject({ outcome: { ok: false, error: 'the agent hit its cost ceiling ($2; raise it with --budget-usd)' } })
    expect(result({ subtype: 'error_during_execution', is_error: true, result: 'API error' })).toMatchObject({ outcome: { ok: false, error: 'the agent ended with error_during_execution: API error' } })
    const denied = result({ permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'sed -i s/a/b/ x' } }] })
    expect(denied).toMatchObject({ outcome: { ok: true, denials: ['Bash {"command":"sed -i s/a/b/ x"}'] } })
    expect(parse(JSON.stringify({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', message: 'sed needs approval' }))).toEqual([{ kind: 'denied', tool: 'Bash', reason: 'sed needs approval' }])
  })

  test('fail fast when the plugin did not load', () => {
    expect(parse(init({ plugins: [] }))[1]).toEqual({ kind: 'abort', reason: 'the agent started without the mimir plugin (/mimir): its init event lists no plugins' })
    expect(parse(init({ plugin_errors: [{ plugin: 'mimir', error: 'bad manifest' }] }))[1]).toMatchObject({ kind: 'abort' })
    expect(parse(init({ plugins: [] }), run({ pluginDir: null }))).toHaveLength(1)
  })

  test('lines that are not JSON are log lines; long text is cut; unknown events are ignored', () => {
    expect(parse('warming up')).toEqual([{ kind: 'log', line: 'warming up' }])
    expect(parse('')).toEqual([])
    expect(parse(JSON.stringify({ type: 'system', subtype: 'thinking_tokens' }))).toEqual([])
    const text = parse(say([{ type: 'text', text: 'y'.repeat(EVENT_TEXT_MAX * 2) }]))[1] as { text: string }
    expect(text.text.length).toBe(EVENT_TEXT_MAX)
  })
})

describe('codex: written from its documented command line (untested)', () => {
  test('exec --json in the working directory; instructions travel in front of the request', () => {
    const argv = codex.command('how does a pump work', '/work', options({ binary: '/bin/codex' })).argv
    expect(argv.slice(0, 2)).toEqual(['/bin/codex', 'exec'])
    expect(argv).toContain('--json')
    expect(argv).toContain('--skip-git-repo-check')
    expect(after(argv, '--cd')).toBe('/work')
    expect(after(argv, '--sandbox')).toBe('workspace-write')
    expect(after(argv, '--config')).toBe('sandbox_workspace_write.network_access=true')
    expect(after(argv, '--model')).toBe('some-model')
    const request = argv[argv.length - 1]!
    expect(request).toBe(withInstructions('how does a pump work', options()))
    expect(request).toContain('Follow the loop.')
    expect(request).toContain('/mimir/skills/mimir/SKILL.md')
    expect(request.endsWith('Request: how does a pump work')).toBe(true)
    const noModel = codex.command('x', '/work', options({ model: null, resume: 'thread-9', extraArgs: ['--sandbox', 'danger-full-access'] })).argv
    expect(noModel).not.toContain('--model')
    expect(noModel.slice(1, 4)).toEqual(['exec', 'resume', 'thread-9'])
    expect(noModel.slice(-3, -1)).toEqual(['--sandbox', 'danger-full-access'])
  })

  test('its JSONL: commands, file changes, messages, the end of the turn', () => {
    const r = run()
    const p = (o: unknown): AgentEvent[] => codex.parseEvent(JSON.stringify(o), r)
    expect(p({ type: 'thread.started', thread_id: 'th-1' })).toEqual([{ kind: 'start', model: 'some-model', session: 'th-1', workdir: '/work' }])
    expect(p({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'mimir check pump.scene.js --text' } })).toEqual([
      { kind: 'tool', id: 'i1', name: 'shell', summary: 'mimir check pump.scene.js --text', action: { type: 'shell', command: 'mimir check pump.scene.js --text' } },
    ])
    expect(p({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'mimir check pump.scene.js --text', aggregated_output: 'OK 0 errors, 0 warnings\n', exit_code: 0 } })).toEqual([
      { kind: 'output', id: 'i1', text: 'OK 0 errors, 0 warnings\n', failed: false }, { kind: 'turn' },
    ])
    expect(p({ type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: 'pump.scene.js', kind: 'add' }] } })).toEqual([
      { kind: 'tool', id: 'i2', name: 'write', summary: 'pump.scene.js', action: { type: 'write', path: '/work/pump.scene.js' } }, { kind: 'turn' },
    ])
    expect(p({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Done.\nRESULT /work/pump.scene.js' } })).toEqual([{ kind: 'text', text: 'Done. RESULT /work/pump.scene.js' }, { kind: 'turn' }])
    expect(p({ type: 'turn.completed', usage: { input_tokens: 10 } })).toEqual([
      { kind: 'end', outcome: { ok: true, error: null, text: 'Done.\nRESULT /work/pump.scene.js', turns: 3, costUsd: null, durationMs: null, session: 'th-1', denials: [] } },
    ])
    expect(codex.parseEvent(JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } }), run())[0]).toMatchObject({ kind: 'end', outcome: { ok: false, error: 'the agent ended with an error: quota' } })
    expect(codex.parseEvent('plain words', run())).toEqual([{ kind: 'log', line: 'plain words' }])
  })
})

describe('command: any agent from a template', () => {
  test('the environment wins over the config file', () => {
    expect(commandTemplate({ MIMIR_AGENT_COMMAND: 'a {prompt}' }, { command: 'b {prompt}' })).toBe('a {prompt}')
    expect(commandTemplate({ MIMIR_AGENT_COMMAND: '  ' }, { command: 'b {prompt}' })).toBe('b {prompt}')
    expect(commandTemplate({}, {})).toBeNull()
  })

  test('placeholders are filled, the request is in the environment and on stdin', () => {
    const o = options({ commandTemplate: 'my-agent --dir {workdir} --model {model} --sys {system} --skill {skill} "{prompt}" {unknown}', extraArgs: ['--fast'] })
    const cmd = command.command('how does a pump work', '/work', o)
    expect(cmd.argv).toEqual(['my-agent', '--dir', '/work', '--model', 'some-model', '--sys', '/mimir/skills/mimir/gen-system.md', '--skill', '/mimir/skills/mimir', 'how does a pump work', '{unknown}', '--fast'])
    expect(cmd.stdin).toBe(withInstructions('how does a pump work', o))
    expect(cmd.env).toMatchObject({ MIMIR_PROMPT: 'how does a pump work', MIMIR_REQUEST: cmd.stdin!, MIMIR_SYSTEM_FILE: '/mimir/skills/mimir/gen-system.md', MIMIR_SKILL_DIR: '/mimir/skills/mimir', MIMIR_WORKDIR: '/work', MIMIR_MODEL: 'some-model', MIMIR_MAX_TURNS: '40', MIMIR_BUDGET_USD: '2' })
    expect(cmd.env.PATH!.startsWith('/mimir/bin')).toBe(true)
    expect(cmd.env.MIMIR_RESUME).toBeUndefined()
    expect(command.command('x', '/work', options({ commandTemplate: 'a', resume: 'r1' })).env.MIMIR_RESUME).toBe('r1')
    expect([...COMMAND_PLACEHOLDERS]).toEqual(['prompt', 'request', 'system', 'skill', 'workdir', 'model', 'max_turns', 'budget_usd'])
  })

  test('its lines: progress events pass through, RESULT ends the run, the rest is log', () => {
    const p = (line: string): AgentEvent[] => command.parseEvent(line, run())
    expect(p('{"event":"tool","name":"sh","summary":"mimir check a.scene.js"}')).toEqual([{ kind: 'tool', id: null, name: 'sh', summary: 'mimir check a.scene.js', action: { type: 'other' } }])
    expect(p('{"event":"stage","stage":"checking"}')).toEqual([{ kind: 'stage', stage: 'checking' }])
    expect(p('{"event":"text","text":"thinking"}')).toEqual([{ kind: 'text', text: 'thinking' }])
    expect(p('working on it')).toEqual([{ kind: 'log', line: 'working on it' }])
    expect(p('RESULT pump.scene.js')[0]).toMatchObject({ kind: 'end', outcome: { ok: true, text: 'RESULT pump.scene.js' } })
    expect(p('  ')).toEqual([])
  })
})

describe('text helpers', () => {
  test('the RESULT line: scene and sheet; the last one wins; paths may contain spaces; none is null, never a guess', () => {
    expect(parseResultLine('done\nRESULT /a/b.scene.js /a/sheet.png')).toEqual({ scene: '/a/b.scene.js', sheet: '/a/sheet.png' })
    expect(parseResultLine('RESULT one.scene.js\nRESULT /my files/two.scene.js')).toEqual({ scene: '/my files/two.scene.js', sheet: null })
    expect(parseResultLine('`RESULT /a/b.scene.js`')).toEqual({ scene: '/a/b.scene.js', sheet: null })
    expect(parseResultLine('the result is fine')).toBeNull()
    expect(parseResultLine('')).toBeNull()
  })
  test('splitCommand: words and quotes, nothing else', () => {
    expect(splitCommand(`a "b c" 'd e' f\\ g ""`)).toEqual(['a', 'b c', 'd e', 'f g', ''])
    expect(splitCommand('  ')).toEqual([])
  })
  test('toolSummary picks what the call is about', () => {
    expect(toolSummary('Bash', { command: 'mimir check\n  a.scene.js' })).toBe('mimir check a.scene.js')
    expect(toolSummary('Read', { file_path: '/a.png' })).toBe('/a.png')
    expect(toolSummary('Odd', {})).toBe('Odd')
  })
})

describe('mimir.config.json', () => {
  test('found in the working directory or above it; MIMIR_CONFIG names one', () => {
    const top = fresh()
    const deep = join(top, 'a', 'b')
    mkdirSync(deep, { recursive: true })
    expect(findConfig(deep, {})).toBeNull()
    writeFileSync(join(top, CONFIG_FILE), '{"agent":{"name":"codex","maxTurns":30,"budgetUsd":1.5,"timeout":600,"args":["--x"],"model":"m"}}')
    expect(findConfig(deep, {})).toBe(join(top, CONFIG_FILE))
    expect(loadConfig(deep, {})).toEqual({ file: join(top, CONFIG_FILE), agent: { name: 'codex', maxTurns: 30, budgetUsd: 1.5, timeout: 600, args: ['--x'], model: 'm' } })
    const other = join(fresh(), 'other.json')
    writeFileSync(other, '{"agent":{"command":"x {prompt}"},"player":{"theme":"dark"}}')
    expect(loadConfig(deep, { MIMIR_CONFIG: other }).agent).toEqual({ command: 'x {prompt}' })
    expect(() => findConfig(deep, { MIMIR_CONFIG: join(top, 'missing.json') })).toThrow(/MIMIR_CONFIG points to a file that does not exist/)
  })
  test('a typo is an error that names the file, never silence', () => {
    expect(parseAgentConfig('{}', 'f')).toEqual({})
    expect(() => parseAgentConfig('{"agent":{"maxTurn":3}}', 'f.json')).toThrow('f.json: unknown field agent.maxTurn; did you mean maxTurns?')
    expect(() => parseAgentConfig('{"agent":{"maxTurns":1.5}}', 'f')).toThrow('agent.maxTurns must be a whole number')
    expect(() => parseAgentConfig('{"agent":{"budgetUsd":-1}}', 'f')).toThrow('agent.budgetUsd must be a number greater than 0')
    expect(() => parseAgentConfig('{"agent":{"args":"--x"}}', 'f')).toThrow('agent.args must be a list of strings')
    expect(() => parseAgentConfig('{"agent":[]}', 'f')).toThrow('"agent" must be an object')
    expect(() => parseAgentConfig('{nope', 'f.json')).toThrow(/f\.json is not valid JSON/)
  })
})

describe('prepare: every value is flag, then environment, then config, then the adapter default', () => {
  const root = fresh()
  mkdirSync(join(root, 'skills', 'mimir'), { recursive: true })
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(join(root, 'skills', 'mimir', 'SKILL.md'), '---\nname: mimir\n---\n')
  writeFileSync(join(root, 'skills', 'mimir', 'gen-system.md'), 'Follow the loop.\n')
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{"name":"mimir"}')
  const bin = fresh()
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 })
  const request = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({ prompt: 'x', workdir: 'out', cwd: fresh(), env: { PATH: bin }, root, agent: null, model: null, maxTurns: null, budgetUsd: null, timeout: null, instructions: null, resume: null, ...over })

  test('defaults', () => {
    const p = prepare(request())
    expect(p.selection.adapter.name).toBe('claude')
    expect(p.options).toMatchObject({ model: 'sonnet', maxTurns: DEFAULT_MAX_TURNS, budgetUsd: DEFAULT_BUDGET_USD, instructionsFile: join(root, 'skills', 'mimir', 'gen-system.md'), instructions: 'Follow the loop.\n', skillDir: join(root, 'skills', 'mimir'), pluginDir: root, binDir: join(root, 'bin'), binary: join(bin, 'claude') })
    expect(p.timeoutS).toBe(DEFAULT_TIMEOUT_S)
    expect(p.request.workdir).toBe(join(p.request.cwd, 'out'))
    expect(p.command.argv[0]).toBe(join(bin, 'claude'))
  })
  test('config < environment < flag', () => {
    const cwd = fresh()
    writeFileSync(join(cwd, CONFIG_FILE), '{"agent":{"model":"from-config","maxTurns":11,"budgetUsd":1,"timeout":99,"args":["--x"]}}')
    expect(prepare(request({ cwd }))).toMatchObject({ options: { model: 'from-config', maxTurns: 11, budgetUsd: 1, extraArgs: ['--x'] }, timeoutS: 99 })
    const env = { PATH: bin, MIMIR_MODEL: 'from-env', MIMIR_MAX_TURNS: '22', MIMIR_BUDGET_USD: '2.5', MIMIR_SESSION: 'fixed' }
    expect(prepare(request({ cwd, env })).options).toMatchObject({ model: 'from-env', maxTurns: 22, budgetUsd: 2.5, sessionId: 'fixed' })
    expect(prepare(request({ cwd, env, model: 'from-flag', maxTurns: 33, budgetUsd: 3.5, timeout: 5 }))).toMatchObject({ options: { model: 'from-flag', maxTurns: 33, budgetUsd: 3.5 }, timeoutS: 5 })
    expect(() => prepare(request({ env: { PATH: bin, MIMIR_MAX_TURNS: 'many' } }))).toThrow('MIMIR_MAX_TURNS must be a whole number greater than 0 (got "many")')
  })
  test('nothing starts without the instructions; the message says where they are expected', () => {
    expect(() => prepare(request({ instructions: 'nope.md' }))).toThrow(/needs the instructions for a headless run, and .*nope\.md does not exist\. Check the path given with --system/)
    expect(() => prepare(request({ env: { PATH: bin, MIMIR_PLUGIN_DIR: fresh() } }))).toThrow(/MIMIR_PLUGIN_DIR is not a plugin directory/)
    const cwd = fresh()
    writeFileSync(join(cwd, 'mine.md'), 'My rules.\n')
    writeFileSync(join(cwd, CONFIG_FILE), '{"agent":{"instructions":"mine.md"}}')
    expect(prepare(request({ cwd })).options.instructions).toBe('My rules.\n')
  })
  test('scene files: new or changed, newest first; hidden directories do not count', () => {
    const dir = fresh()
    mkdirSync(join(dir, '.mimir'))
    writeFileSync(join(dir, 'a.scene.js'), '')
    writeFileSync(join(dir, '.mimir', 'b.scene.js'), '')
    writeFileSync(join(dir, 'notes.md'), '')
    const before = sceneFiles(dir)
    expect([...before.keys()]).toEqual([join(dir, 'a.scene.js')])
    expect(changedScenes(before, before)).toEqual([])
    expect(changedScenes(before, new Map([[join(dir, 'a.scene.js'), before.get(join(dir, 'a.scene.js'))! + 5], [join(dir, 'c.scene.mjs'), 1]]))).toEqual([join(dir, 'a.scene.js'), join(dir, 'c.scene.mjs')])
  })
})

describe('stages: read off what the agent does', () => {
  const tool = (action: AgentEvent & { kind: 'tool' } extends infer T ? T extends { action: infer A } ? A : never : never, id: string | null = null): AgentEvent => ({ kind: 'tool', id, name: 't', summary: 's', action })
  const stagesOf = (events: Progress[]): string[] => events.filter((e) => e.event === 'stage').map((e) => e.stage)

  test('mimirCalls finds the commands of a shell line; readCheckStatus reads both output forms', () => {
    expect(mimirCalls('mimir check a.scene.js --text')).toEqual(['check'])
    expect(mimirCalls('cd out && ./bin/mimir check a.scene.js; /abs/bin/mimir shot a.scene.js --sheet')).toEqual(['check', 'shot'])
    expect(mimirCalls('echo mimirror check; ls')).toEqual([])
    expect(shotKinds('mimir shot a.scene.js --sheet && mimir shot a.scene.js --cues; mimir shot a.scene.js --fine 2:4:8 | cat; mimir shot a.scene.js --step 2; mimir check a --sheet')).toEqual(['sheet', 'cues', 'fine', 'frames'])
    expect(readCheckStatus('X warn | …\nOK 0 errors, 1 warning\n')).toEqual({ ok: true, errors: 0, warnings: 1 })
    expect(readCheckStatus('FAIL 1 error, 0 warnings')).toEqual({ ok: false, errors: 1, warnings: 0 })
    expect(readCheckStatus('{"ok":false,"errors":4,"warnings":2,"total":6}')).toEqual({ ok: false, errors: 4, warnings: 2 })
    expect(readCheckStatus('command not found')).toBeNull()
  })

  test('a clean run: storyboard → writing → checking → looking → fixing → checking → looking', () => {
    let clock = 0
    const t = new StageTracker(() => (clock += 1000))
    const all: Progress[] = []
    const feed = (e: AgentEvent): void => { all.push(...t.feed(e)) }
    expect(t.stage).toBe('storyboard')
    feed(tool({ type: 'skill', name: 'mimir' }))
    feed(tool({ type: 'read', path: '/skill/references/api.md' }))
    feed(tool({ type: 'write', path: '/work/gear.storyboard.md' }))
    expect(t.stage).toBe('storyboard')
    feed(tool({ type: 'write', path: '/work/gear.scene.js' }))
    feed(tool({ type: 'write', path: '/work/gear.scene.js' }))
    expect(t.stage).toBe('writing')
    feed(tool({ type: 'shell', command: 'mimir check gear.scene.js --text' }, 'c1'))
    feed({ kind: 'output', id: 'c1', text: 'FAIL 2 errors, 0 warnings', failed: true })
    feed(tool({ type: 'write', path: '/work/gear.scene.js' }))
    feed(tool({ type: 'shell', command: 'mimir check gear.scene.js --text' }, 'c2'))
    feed({ kind: 'output', id: 'c2', text: 'OK 0 errors, 0 warnings', failed: false })
    feed(tool({ type: 'shell', command: 'mimir shot gear.scene.js --sheet' }, 's1'))
    feed({ kind: 'output', id: 's1', text: '/work/.mimir/shots/gear/sheet.png', failed: false })
    feed(tool({ type: 'read', path: '/work/.mimir/shots/gear/sheet.png' }))
    expect(stagesOf(all)).toEqual(['writing', 'checking', 'fixing', 'checking', 'looking'])
    expect(all.filter((e) => e.event === 'check')).toEqual([
      { event: 'check', stage: 'checking', round: 1, ok: false, errors: 2, warnings: 0 },
      { event: 'check', stage: 'checking', round: 2, ok: true, errors: 0, warnings: 0 },
    ])
    expect(all.filter((e) => e.event === 'look')).toEqual([{ event: 'look', stage: 'looking', round: 1, image: '/work/.mimir/shots/gear/sheet.png' }])
    expect(all.find((e) => e.event === 'stage')).toMatchObject({ stage: 'writing', round: 1, elapsed_ms: 1000 })
    expect(t.summary()).toEqual({ firstClean: false, reviews: 0, rounds: { check: 2, look: 1, edit: 3 }, shots: { sheet: 1, cues: 0, fine: 0, frames: 0 }, looked: true, lastCheck: { ok: true, errors: 0, warnings: 0 }, scenes: ['/work/gear.scene.js'], storyboard: '/work/gear.storyboard.md' })
    // every tool line carries the stage it happened in
    expect(all.filter((e) => e.event === 'tool').every((e) => (STAGES as readonly string[]).includes(e.stage))).toBe(true)
  })

  test('looked is true only for a picture rendered after the last change to the scene', () => {
    const t = new StageTracker(() => 0)
    t.feed(tool({ type: 'write', path: 'a.scene.js' }))
    t.feed(tool({ type: 'shell', command: 'mimir shot a.scene.js --sheet' }))
    t.feed(tool({ type: 'read', path: 'sheet.png' }))
    expect(t.summary().looked).toBe(true)
    t.feed(tool({ type: 'write', path: 'a.scene.js' })) // an edit after the look
    expect(t.summary().looked).toBe(false)
    t.feed(tool({ type: 'read', path: 'sheet.png' })) // the old picture again: still not a look at the new scene
    expect(t.summary().looked).toBe(false)
    t.feed(tool({ type: 'shell', command: 'mimir shot a.scene.js --sheet' }))
    t.feed(tool({ type: 'read', path: 'sheet.png' }))
    expect(t.summary()).toMatchObject({ looked: true, rounds: { look: 3, edit: 2 } })
  })

  test('an agent whose calls cannot be seen: looked is unknown, never yes; files on disk and its own reports move the stage', () => {
    const t = new StageTracker(() => 0)
    expect(t.summary().looked).toBeNull()
    expect(t.observeWrite('/work/a.scene.js')).toEqual([{ event: 'stage', stage: 'writing', round: 1, elapsed_ms: 0 }])
    expect(t.feed({ kind: 'stage', stage: 'checking' })).toEqual([{ event: 'stage', stage: 'checking', round: 1, elapsed_ms: 0 }])
    expect(t.observeWrite('/work/a.scene.js')).toEqual([{ event: 'stage', stage: 'fixing', round: 2, elapsed_ms: 0 }])
    // the verdict is never the agent's
    expect(t.feed({ kind: 'stage', stage: 'ready' })).toEqual([])
    expect(t.feed({ kind: 'stage', stage: 'nonsense' })).toEqual([])
    expect(t.stage).toBe('fixing')
    expect(t.summary()).toMatchObject({ looked: null, scenes: ['/work/a.scene.js'], rounds: { check: 1, edit: 2 } })
  })
})

describe('the skill folder', () => {
  const dir = skillDir(ROOT)
  const body = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const front = /^---\n([\s\S]*?)\n---\n/.exec(body)![1]!

  test('frontmatter: only the keys every agent accepts; the name is the folder; the description says what and when', () => {
    const keys = front.split('\n').filter((l) => /^[a-z-]+:/.test(l)).map((l) => l.split(':')[0])
    expect(keys).toEqual(['name', 'description', 'allowed-tools', 'license', 'metadata'])
    expect(front).toContain('name: mimir\n')
    const description = /^description: (.*)$/m.exec(front)![1]!
    expect(description.length).toBeLessThanOrEqual(1024) // the limit of the skill format
    expect(description).toMatch(/Use when/)
    expect(description).toMatch(/Not for/)
    expect(front).toContain('allowed-tools: Bash(mimir *) Read(/${CLAUDE_SKILL_DIR}/**)')
  })

  test('the always-loaded part stays small: under 500 lines and well under the 5,000 tokens an agent re-attaches', () => {
    expect(body.split('\n').length).toBeLessThan(500)
    // about four characters a token: 14,000 characters is about 3,500 tokens
    expect(body.length).toBeLessThan(14_000)
  })

  test('it names the loop, the hard rules and only files that exist', () => {
    for (const phrase of ['Storyboard', 'mimir check <name>.scene.js --text', 'mimir shot <name>.scene.js --sheet', 'LOOK at the sheet', '--cues', '--fine', 'mimir open <name>.scene.js', 'Concrete first', 'at most four words', 'One colour, one meaning', 'Nothing faked: compute it', 'Relations, not coordinates', 'Never claim a scene is right']) expect(body).toContain(phrase)
    const named = [...body.matchAll(/`([a-z-]+\.md)`/g)].map((m) => m[1]!)
    expect(named.length).toBeGreaterThan(8)
    for (const file of named) expect(existsSync(join(dir, 'references', file))).toBe(true)
    for (const text of [body, ...readdirSync(join(dir, 'references')).map((f) => readFileSync(join(dir, 'references', f), 'utf8'))]) {
      for (const m of text.matchAll(/mimir examples ([a-z0-9-]+)/g)) expect(existsSync(join(ROOT, 'examples', `${m[1]}.scene.js`))).toBe(true)
    }
    expect(existsSync(join(dir, 'gen-system.md'))).toBe(true)
    expect(readFileSync(join(dir, 'gen-system.md'), 'utf8')).toContain('RESULT <absolute scene path>')
    expect(readFileSync(snippetPath(ROOT), 'utf8')).toContain('mimir check <name>.scene.js --text')
  })

  test('nothing in it is tied to a machine or to one agent\'s tool names', () => {
    for (const f of [join(dir, 'SKILL.md'), join(dir, 'gen-system.md'), snippetPath(ROOT), ...readdirSync(join(dir, 'references')).map((r) => join(dir, 'references', r))]) {
      const text = readFileSync(f, 'utf8')
      expect(text).not.toMatch(/\/Users\/|\/home\/[a-z]|C:\\\\/)
    }
  })

  test('the API reference is generated: the files on disk are what `mimir skill refresh` writes', () => {
    const index = parseDts(readFileSync(typesPath({}), 'utf8'))
    const want = skillReferences(index)
    expect(diffReferences(join(dir, 'references'), want)).toEqual({ missing: [], changed: [], stale: [] })
    expect([...want.keys()].filter((k) => k !== `${API_PREFIX}.md`).length).toBe(index.topics.length)
    // every line of every module file is a line of `mimir docs reference`
    const reference = new Set(renderReference(index).split('\n'))
    for (const [name, text] of want) {
      if (name === `${API_PREFIX}.md`) continue
      const lines = text.slice(text.indexOf('```ts\n') + 6, text.lastIndexOf('\n```')).split('\n')
      expect(lines.length).toBeGreaterThan(1) // a module may add one name (the player: part.describe)
      for (const line of lines) expect(reference.has(line)).toBe(true)
    }
    expect(moduleSlug('parts kit: believable machine parts')).toBe('parts-kit')
    expect(moduleSlug('core')).toBe('core')
    const stale = fresh()
    writeFileSync(join(stale, 'api-gone.md'), 'old')
    writeFileSync(join(stale, 'api-core.md'), 'old')
    writeFileSync(join(stale, 'cookbook.md'), 'hand-written files are not touched')
    const d = diffReferences(stale, want)
    expect(d.stale).toEqual(['api-gone.md'])
    expect(d.changed).toEqual(['api-core.md'])
    expect(d.missing).toContain('api.md')
  })
})

describe('mimir skill', () => {
  const parse = (argv: string[]) => toSkillOptions(parseFlags(SKILL_SPEC, argv))

  test('arguments', () => {
    expect(parse(['install'])).toEqual({ action: 'install', targets: [], copy: false, force: false, dryRun: false, agentsMd: null })
    expect(parse(['install', '--target', 'claude,codex', '--target', './x', '--copy', '--force', '--dry-run', '--agents-md', 'AGENTS.md'])).toEqual({ action: 'install', targets: ['claude', 'codex', './x'], copy: true, force: true, dryRun: true, agentsMd: 'AGENTS.md' })
    expect(() => parse(['instal'])).toThrow('unknown skill action "instal"; did you mean install?')
    expect(() => parse(['path', '--copy'])).toThrow('--copy belongs to mimir skill install')
  })

  test('where agents keep skills', () => {
    const env = { HOME: '/home/me' }
    expect(targetDir('claude', env, '/cwd')).toEqual({ name: 'claude', dir: join('/home/me', '.claude', 'skills') })
    expect(targetDir('claude', { ...env, CLAUDE_CONFIG_DIR: '/cfg' }, '/cwd')).toEqual({ name: 'claude', dir: join('/cfg', 'skills') })
    expect(targetDir('codex', env, '/cwd')).toEqual({ name: 'codex', dir: join('/home/me', '.agents', 'skills') })
    expect(targetDir('.agents/skills', env, '/cwd')).toEqual({ name: 'dir', dir: join('/cwd', '.agents', 'skills') })
    const home = fresh()
    expect(presentTargets({ HOME: home })).toEqual([])
    mkdirSync(join(home, '.claude'))
    mkdirSync(join(home, '.codex'))
    expect(presentTargets({ HOME: home })).toEqual(['claude', 'codex'])
  })

  test('install links by default, copies on request, never replaces without --force, and --dry-run changes nothing', async () => {
    const home = fresh()
    const env = { HOME: home, PATH: '' }
    const go = async (argv: string[], cwd = home) => { const o = io(cwd, env); const code = await skill(parse(argv), o); return { code, out: JSON.parse(o.printed) as Record<string, any> } }
    await expect(skill(parse(['install']), io(home, env))).rejects.toThrow(/no agent was found on this machine/)

    const planned = await go(['install', '--target', 'claude', '--dry-run'])
    expect(planned.out.installed).toEqual([{ target: 'claude', path: join(home, '.claude', 'skills', 'mimir'), mode: 'link', status: 'planned' }])
    expect(existsSync(join(home, '.claude'))).toBe(false)

    const linked = await go(['install', '--target', 'claude'])
    const at = join(home, '.claude', 'skills', 'mimir')
    expect(linked.out.installed[0]).toMatchObject({ status: 'installed', mode: 'link', path: at })
    expect(lstatSync(at).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(at, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(skillDir(ROOT), 'SKILL.md'), 'utf8'))
    expect(linked.out.mimir_on_path).toBeNull()
    expect(linked.out.next.join('\n')).toContain('put the mimir command on PATH')
    expect(linked.out.next.join('\n')).toContain('claude plugin marketplace add')
    expect((await go(['install', '--target', 'claude'])).out.installed[0].status).toBe('unchanged')

    // now that ~/.claude exists it is found without --target; a copy into a directory; an existing target is kept
    const copied = await go(['install', '--target', 'skills-here', '--copy'])
    const copy = join(home, 'skills-here', 'mimir')
    expect(copied.out.installed[0]).toMatchObject({ target: 'dir', mode: 'copy', status: 'installed', path: copy })
    expect(lstatSync(copy).isSymbolicLink()).toBe(false)
    expect(existsSync(join(copy, 'references', 'cookbook.md'))).toBe(true)
    await expect(skill(parse(['install', '--target', 'skills-here', '--copy']), io(home, env))).rejects.toThrow(/already exists; pass --force to replace it/)
    expect((await go(['install', '--target', 'skills-here', '--copy', '--force'])).out.installed[0].status).toBe('replaced')
    expect((await go(['install'])).out.installed.map((r: { target: string }) => r.target)).toEqual(['claude'])
    await expect(skill(parse(['install', '--target', join(skillDir(ROOT), '..')]), io(home, env))).rejects.toThrow(/is the skill folder itself/)
  })

  test('the AGENTS.md pointer is written between markers, and written once', async () => {
    const snippet = readFileSync(snippetPath(ROOT), 'utf8')
    const first = withSnippet('# My project\n\nRules.\n', snippet)
    expect(first.startsWith('# My project\n\nRules.\n\n' + SNIPPET_BEGIN)).toBe(true)
    expect(first.trimEnd().endsWith(SNIPPET_END)).toBe(true)
    expect(withSnippet(first, snippet)).toBe(first)
    expect(withSnippet(first.replace('use the `mimir` skill', 'OLD TEXT'), snippet)).toBe(first)
    expect(withSnippet('', snippet).startsWith(SNIPPET_BEGIN)).toBe(true)

    const home = fresh()
    const o = io(home, { HOME: home, PATH: '' })
    await skill(parse(['install', '--target', 'codex', '--agents-md', 'AGENTS.md']), o)
    const out = JSON.parse(o.printed) as Record<string, any>
    expect(out.agents_md).toEqual({ path: join(home, 'AGENTS.md'), status: 'written' })
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toContain('## Explainers, diagrams and simulations: use Mimir')
    expect(lstatSync(join(home, '.agents', 'skills', 'mimir')).isSymbolicLink()).toBe(true)
    const again = io(home, { HOME: home, PATH: '' })
    await skill(parse(['install', '--target', 'codex', '--agents-md', 'AGENTS.md']), again)
    expect((JSON.parse(again.printed) as Record<string, any>).agents_md.status).toBe('unchanged')
  })

  test('path and snippet print; check says OK on this checkout', async () => {
    const p = io(ROOT)
    expect(await skill(parse(['path']), p)).toBe(0)
    expect(JSON.parse(p.printed)).toEqual({ path: skillDir(ROOT) })
    const s = io(ROOT)
    await skill(parse(['snippet']), s)
    expect((JSON.parse(s.printed) as { snippet: string }).snippet).toContain('use the `mimir` skill')
    const missing = fresh()
    await expect(skill(parse(['path']), io(ROOT), missing)).rejects.toThrow(CliError)
  })
})

describe('mimir serve: the pure side', () => {
  const parse = (argv: string[]) => toServeOptions(parseFlags(SERVE_SPEC, argv))
  test('arguments: a free port unless one is named', () => {
    expect(parse([])).toEqual({ dir: null, port: null, open: false, jobs: DEFAULT_JOBS })
    expect(parse(['scenes', '--port', '5000', '--open', '--jobs', '2'])).toEqual({ dir: 'scenes', port: 5000, open: true, jobs: 2 })
    expect(() => parse(['--port', '70000'])).toThrow('--port must be a whole number from 0 to 65535')
    expect(() => parse(['--jobs', '0'])).toThrow('--jobs must be a whole number from 1 to 64')
  })
  test('only requests addressed to the server itself count', () => {
    expect(ownHost('127.0.0.1:4000', 4000)).toBe(true)
    expect(ownHost('localhost:4000', 4000)).toBe(true)
    expect(ownHost('[::1]:4000', 4000)).toBe(true)
    expect(ownHost('LOCALHOST:4000', 4000)).toBe(true)
    expect(ownHost('localhost:4001', 4000)).toBe(false)
    expect(ownHost('evil.example:4000', 4000)).toBe(false)
    expect(ownHost('127.0.0.1.evil.example:4000', 4000)).toBe(false)
    expect(ownHost(null, 4000)).toBe(false)
  })
  test('a generation gets a directory named after its prompt', () => {
    expect(slugOf('How does a bicycle gear change work?')).toBe('how-does-a-bicycle-gear-change')
    expect(slugOf('  ¿Qué es / un "árbol"?  ')).toBe('que-es-un-arbol')
    expect(slugOf('???')).toBe('scene')
    const dir = fresh()
    expect(freeDir(dir, 'gears')).toBe('gears')
    mkdirSync(join(dir, 'gears'))
    mkdirSync(join(dir, 'gears-2'))
    expect(freeDir(dir, 'gears')).toBe('gears-3')
  })
  test('scenes are listed from their text: title, summary, a viewer URL; hidden directories are left out', () => {
    const dir = fresh()
    mkdirSync(join(dir, 'sub dir'))
    mkdirSync(join(dir, '.mimir'))
    writeFileSync(join(dir, 'gear.scene.js'), `// gear: two wheels that mesh. More words.\nexport default scene({ title: 'How gears mesh' }, (s) => {})\n`)
    writeFileSync(join(dir, 'sub dir', 'pump.scene.js'), `export default scene({ title: "A pump" }, (s) => {})\n`)
    writeFileSync(join(dir, '.mimir', 'old.scene.js'), '')
    writeFileSync(join(dir, 'readme.md'), '')
    const rows = listScenes(dir).sort((a, b) => (a.name < b.name ? -1 : 1))
    expect(rows.map((r) => [r.name, r.title, r.summary, r.path, r.url])).toEqual([
      ['gear', 'How gears mesh', 'two wheels that mesh.', 'gear.scene.js', '/viewer.html?scene=%2Fscene%2Fgear.scene.js'],
      ['pump', 'A pump', 'A pump', 'sub dir/pump.scene.js', '/viewer.html?scene=%2Fscene%2Fsub%2520dir%2Fpump.scene.js'],
    ])
    expect(rows.every((r) => !Number.isNaN(Date.parse(r.modified)))).toBe(true)
  })
})
