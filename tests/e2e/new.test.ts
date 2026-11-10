// End to end: `mimir new` through the real launcher with a stand-in agent (a script that plays an agent's output
// stream back), the home API of `mimir serve` over real HTTP, and the skill's own example scenes through the real
// engine. No model is called here: what a real agent does with the skill is measured in docs/agents.md.
// The stub viewer (tests/fixtures/stub-viewer) answers check and shot for the stand-in runs; the scenes of the
// skill are checked with the real viewer. After EVERY test: no browser started by the CLI may still be running.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { DEFAULT_BUDGET_USD, DEFAULT_MAX_TURNS } from '../../src/cli/agents/limits.ts'
import { skillDir } from '../../src/cli/agents/skill.ts'
import { COMMANDS } from '../../src/cli/args.ts'
import { startHome, type HomeServer } from '../../src/cli/commands/serve.ts'
import type { Io } from '../../src/cli/io.ts'
import { pngSize } from '../../src/cli/png.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const STUB = join(ROOT, 'tests', 'fixtures', 'stub-viewer')
const SCENES = join(import.meta.dir, 'scenes')
const scene = (name: string): string => join(SCENES, `${name}.scene.js`)

const WORK = mkdtempSync(join(realpathSync(tmpdir()), 'mimir-e2e-new-'))
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
const BASE: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: TMP, MIMIR_LAUNCH_DEPTH: '0' }
for (const name of Object.keys(BASE)) if (name.startsWith('MIMIR_') && name !== 'MIMIR_LAUNCH_DEPTH' && name !== 'MIMIR_CHROME') delete BASE[name]
// these tests drive the agent loop with a stand-in agent: the loop is asked for (the default is one call, tests/e2e/once.test.ts)
BASE.MIMIR_NEW_MODE = 'loop'
const ENV: Record<string, string> = { ...BASE, MIMIR_VIEWER_ROOT: STUB }

let dirCount = 0
const freshDir = (): string => {
  const d = join(WORK, `d${++dirCount}`)
  mkdirSync(d)
  return d
}
interface Result { code: number; stdout: string; stderr: string }
async function mimir(args: string[], opts: { env?: Record<string, string>; cwd?: string; base?: Record<string, string> } = {}): Promise<Result> {
  const proc = Bun.spawn([BIN, ...args], { cwd: opts.cwd ?? WORK, env: { ...(opts.base ?? ENV), ...opts.env }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
const events = (r: Result): Array<Record<string, any>> => r.stdout.trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
function browsersRunning(): string[] {
  return Bun.spawnSync(['ps', '-axo', 'command=']).stdout.toString().split('\n').filter((l) => l.includes(WORK) && l.includes('--user-data-dir'))
}
afterEach(async () => {
  for (let i = 0; i < 40 && browsersRunning().length > 0; i++) await Bun.sleep(50)
  const left = browsersRunning()
  for (const line of Bun.spawnSync(['ps', '-axo', 'pid=,command=']).stdout.toString().split('\n')) {
    if (line.includes(WORK) && line.includes('--user-data-dir')) { try { process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGKILL') } catch { /* gone */ } }
  }
  expect(left).toEqual([])
})
afterAll(() => rmSync(WORK, { recursive: true, force: true }))
/** ms a test may take: these start browsers and agents, and the machine may be busy */
const T = 240_000

/** A stand-in for an agent's command line: records how it was called, writes files, plays a stream back. */
function fakeAgent(dir: string, opts: { stream: string[]; scene?: string | null; sceneName?: string; exit?: number; sleep?: number; linger?: number; before?: string }): string {
  const stream = join(dir, 'stream.ndjson')
  writeFileSync(stream, opts.stream.join('\n') + '\n')
  const script = join(dir, 'fake-agent')
  writeFileSync(script, [
    '#!/bin/sh',
    `for a in "$@"; do printf '%s\\n' "$a"; done > "${join(dir, 'argv.txt')}"`,
    `pwd > "${join(dir, 'cwd.txt')}"`,
    `command -v mimir > "${join(dir, 'which.txt')}"`,
    `env | grep '^MIMIR_' | sort > "${join(dir, 'env.txt')}"`,
    `cat > "${join(dir, 'stdin.txt')}"`,
    opts.before ?? ':',
    opts.sleep ? `sleep ${opts.sleep}` : ':',
    opts.scene ? `cp "${opts.scene}" "./${opts.sceneName ?? 'pump.scene.js'}"` : ':',
    `cat "${stream}"`,
    opts.linger ? `sleep ${opts.linger}` : ':',
    `exit ${opts.exit ?? 0}`,
    '',
  ].join('\n'))
  chmodSync(script, 0o755)
  return script
}
// the stream of a headless Claude Code run, as the adapter reads it
const init = (cwd: string, over: Record<string, unknown> = {}): string => JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1', model: 'fake-model', cwd, tools: ['Read', 'Write', 'Edit', 'Bash', 'Skill'], plugins: [{ name: 'mimir', path: ROOT }], ...over })
let callId = 0
const use = (name: string, input: unknown, id = `t${++callId}`): string => JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const output = (id: string, content: string): string => JSON.stringify({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } })
const done = (over: Record<string, unknown> = {}): string => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 7, duration_ms: 1234, total_cost_usd: 0.0123, session_id: 's-1', permission_denials: [], result: 'Done.', ...over })

describe('mimir new: a headless agent, driven, staged and checked', () => {
  test('the loop end to end: recipe flags, a stage on every line, a result that was checked and rendered here', async () => {
    const dir = freshDir()
    const out = join(dir, 'out')
    const file = join(out, 'pump.scene.js')
    const sheet = join(out, '.mimir', 'shots', 'pump', 'sheet.png')
    const agent = fakeAgent(dir, {
      scene: scene('clean'),
      stream: [
        init(out),
        use('Skill', { skill: 'mimir:mimir' }),
        use('Write', { file_path: join(out, 'pump.storyboard.md'), content: '# How a pump works' }),
        use('Write', { file_path: file, content: '…' }),
        use('Bash', { command: 'mimir check pump.scene.js --text' }, 'c1'),
        output('c1', 'TEXT-OVERLAP error | …\nFAIL 1 error, 0 warnings'),
        use('Edit', { file_path: file, old_string: 'a', new_string: 'b' }),
        use('Bash', { command: 'mimir check pump.scene.js --text' }, 'c2'),
        output('c2', 'OK 0 errors, 0 warnings'),
        use('Bash', { command: 'mimir shot pump.scene.js --sheet' }),
        use('Read', { file_path: sheet }),
        use('Bash', { command: 'mimir shot pump.scene.js --cues' }),
        done({ result: `Looked at the sheet.\nRESULT ${file}` }),
      ],
      before: `mkdir -p "${out}" && printf '# How a pump works\\n' > "${join(out, 'pump.storyboard.md')}"`,
    })
    const r = await mimir(['new', '--full', 'how does a pump work', '-o', out, '--agent', 'claude', '--model', 'fast-one', '--max-turns', '12'], { env: { MIMIR_AGENT_BIN: agent, MIMIR_SESSION: 'fixed-session', MIMIR_BUDGET_USD: '0.5' } })
    expect(r.code).toBe(0)
    const ev = events(r)
    // every line says which stage the run is in
    expect(ev.every((e) => ['storyboard', 'writing', 'checking', 'looking', 'fixing', 'ready', 'failed'].includes(e.stage))).toBe(true)
    expect(ev[0]).toEqual({ event: 'start', stage: 'storyboard', agent: 'claude', model: 'fake-model', session: 's-1', workdir: out })
    expect(ev.filter((e) => e.event === 'stage').map((e) => [e.stage, e.round])).toEqual([['writing', 1], ['checking', 1], ['fixing', 2], ['checking', 2], ['looking', 1]])
    expect(ev.filter((e) => e.event === 'stage').every((e) => typeof e.elapsed_ms === 'number' && e.elapsed_ms >= 0)).toBe(true)
    expect(ev.filter((e) => e.event === 'check')).toEqual([
      { event: 'check', stage: 'checking', round: 1, ok: false, errors: 1, warnings: 0 },
      { event: 'check', stage: 'checking', round: 2, ok: true, errors: 0, warnings: 0 },
    ])
    expect(ev.filter((e) => e.event === 'look')).toEqual([{ event: 'look', stage: 'looking', round: 1, image: sheet }])
    expect(ev.filter((e) => e.event === 'tool').slice(0, 4)).toEqual([
      { event: 'tool', stage: 'storyboard', name: 'Skill', summary: 'mimir:mimir' },
      { event: 'tool', stage: 'storyboard', name: 'Write', summary: join(out, 'pump.storyboard.md') },
      { event: 'tool', stage: 'writing', name: 'Write', summary: file },
      { event: 'tool', stage: 'checking', name: 'Bash', summary: 'mimir check pump.scene.js --text' },
    ])
    // the last line: the scene, the check that was run HERE, and a sheet that was rendered HERE from the final file
    const last = ev[ev.length - 1]!
    expect(last).toMatchObject({
      event: 'result', stage: 'ready', ok: true, scene: file, check: { ok: true, errors: 0, warnings: 0 }, storyboard: join(out, 'pump.storyboard.md'), looked: true,
      rounds: { check: 2, look: 1, edit: 2 }, shots: { sheet: 1, cues: 1, fine: 0, frames: 0 }, agent: 'claude', model: 'fake-model', session: 's-1', turns: 7, cost_usd: 0.0123, duration_ms: 1234, denials: 0, error: null, notes: [],
    })
    expect(last.sheet).toBe(join(out, '.mimir', 'new', 'pump', 'sheet.png'))
    expect(pngSize(new Uint8Array(readFileSync(last.sheet)))!.width).toBeGreaterThan(100)
    expect(last.wall_ms).toBeGreaterThan(0)
    expect(last.over_budget).toBeUndefined()
    // how the agent was called: the measured recipe
    const argv = readFileSync(join(dir, 'argv.txt'), 'utf8').split('\n')
    const after = (flag: string): string => argv[argv.indexOf(flag) + 1]!
    expect(argv.slice(0, 2)).toEqual(['-p', 'how does a pump work'])
    expect(after('--plugin-dir')).toBe(ROOT)
    expect(after('--setting-sources')).toBe('')
    expect(argv).toContain('--strict-mcp-config')
    expect(after('--permission-mode')).toBe('acceptEdits')
    expect(argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--tools'))).toEqual(['Skill(mimir:mimir)', 'Bash(mimir *)', `Read(/${skillDir(ROOT)}/**)`])
    expect(after('--tools')).toBe('Read,Write,Edit,Bash,Skill')
    expect(after('--append-system-prompt-file')).toBe(join(skillDir(ROOT), 'gen-system.md'))
    expect([after('--model'), after('--max-turns'), after('--max-budget-usd'), after('--session-id'), after('--output-format')]).toEqual(['fast-one', '12', '0.5', 'fixed-session', 'stream-json'])
    // where it ran, and which mimir it finds
    expect(readFileSync(join(dir, 'cwd.txt'), 'utf8').trim()).toEndWith('/out')
    expect(readFileSync(join(dir, 'which.txt'), 'utf8').trim()).toBe(BIN)
  }, T)

  test('honest when the agent stops without a clean check: failed, and why', async () => {
    // 1. the scene the agent wrote has an error (the stub's demo scene reports one), although the agent said it was fine
    const a = freshDir()
    const withErrors = await mimir(['new', '--full', 'x', '-o', join(a, 'out'), '--agent', 'claude'], {
      env: { MIMIR_AGENT_BIN: fakeAgent(a, { scene: scene('demo'), stream: [init(a), use('Bash', { command: 'mimir check pump.scene.js' }, 'k'), output('k', 'OK 0 errors, 0 warnings'), done({ result: `All clean.\nRESULT ${join(a, 'out', 'pump.scene.js')}` })] }) },
    })
    expect(withErrors.code).toBe(1)
    const last = events(withErrors).pop()!
    expect(last).toMatchObject({ event: 'result', stage: 'failed', ok: false, scene: join(a, 'out', 'pump.scene.js'), check: { ok: false, errors: 1, warnings: 1 } })
    expect(last.error).toBe(`the scene has 1 error: run mimir check ${join(a, 'out', 'pump.scene.js')}`)
    expect(typeof last.sheet).toBe('string') // a sheet of what there is: the person can look at what failed
    // the agent never rendered or opened a picture: said, not hidden
    expect(last.looked).toBe(false)
    expect(last.notes).toContain('the agent did not open a picture rendered after its last change to the scene: nobody has looked at the final frames')

    // 2. the RESULT line names a file that is not there, and nothing else was written
    const c = freshDir()
    const ghost = await mimir(['new', '--full', 'x', '-o', join(c, 'out'), '--agent', 'claude'], {
      env: { MIMIR_AGENT_BIN: fakeAgent(c, { scene: null, stream: [init(c), done({ result: `RESULT ${join(c, 'out', 'ghost.scene.js')}` })] }) },
    })
    expect(ghost.code).toBe(1)
    expect(events(ghost).pop()).toMatchObject({ stage: 'failed', ok: false, scene: null, check: null, sheet: null, error: `the agent reported the scene ${join(c, 'out', 'ghost.scene.js')}, which does not exist` })

    // 3. it finished without writing anything
    const d = freshDir()
    const nothing = await mimir(['new', '--full', 'x', '-o', join(d, 'out'), '--agent', 'claude'], { env: { MIMIR_AGENT_BIN: fakeAgent(d, { scene: null, stream: [init(d), done()] }) } })
    expect(events(nothing).pop()).toMatchObject({ stage: 'failed', ok: false, error: 'the agent finished without writing a scene file (*.scene.js)' })

    // 4. refused tool calls are counted and named; the scene is clean, so the run stands
    const b = freshDir()
    const denied = await mimir(['new', '--full', 'x', '-o', join(b, 'out'), '--agent', 'claude'], {
      env: { MIMIR_AGENT_BIN: fakeAgent(b, { scene: scene('clean'), stream: [
        init(b), JSON.stringify({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', message: 'sed command requires approval' }),
        done({ result: `RESULT ${join(b, 'out', 'pump.scene.js')}`, permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'sed -i s/a/b/ pump.scene.js' } }] }),
      ] }) },
    })
    expect(denied.code).toBe(0)
    const dl = events(denied)
    expect(dl[1]).toEqual({ event: 'denied', stage: 'storyboard', tool: 'Bash', reason: 'sed command requires approval' })
    expect(dl[dl.length - 1]).toMatchObject({ ok: true, denials: 1 })
    expect(dl[dl.length - 1]!.notes[0]).toBe('1 tool call was refused (Bash {"command":"sed -i s/a/b/ pump.scene.js"})')
  }, T)

  test('a run that ends badly: the turn limit, a runaway agent, no result at all, a timeout, a plugin that did not load', async () => {
    const a = freshDir()
    const turns = await mimir(['new', '--full', 'x', '-o', join(a, 'out'), '--agent', 'claude', '--max-turns', '3'], {
      env: { MIMIR_AGENT_BIN: fakeAgent(a, { scene: scene('clean'), exit: 1, stream: [init(a), done({ subtype: 'error_max_turns', is_error: true, result: '' })] }) },
    })
    expect(turns.code).toBe(1)
    // the scene it left is clean, and the result still says failed: the agent did not finish its loop
    expect(events(turns).pop()).toMatchObject({ stage: 'failed', ok: false, check: { ok: true }, error: 'the agent hit its turn limit (3; raise it with --max-turns)', turns: 7 })

    // the agent ignores its limit (it keeps talking): the driver counts its turns and stops it
    const over = freshDir()
    const began = Date.now()
    const many = Array.from({ length: 6 }, (_, i) => use('Bash', { command: `mimir docs name${i}` }))
    const runaway = await mimir(['new', '--full', 'x', '-o', join(over, 'out'), '--agent', 'claude', '--max-turns', '4'], {
      env: { MIMIR_AGENT_BIN: fakeAgent(over, { scene: scene('clean'), linger: 30, stream: [init(over), ...many] }) },
    })
    expect(Date.now() - began).toBeLessThan(20_000) // it was stopped, not waited for
    expect(runaway.code).toBe(1)
    expect(events(runaway).pop()).toMatchObject({ stage: 'failed', ok: false, error: 'the agent was stopped at its turn limit (4; raise it with --max-turns)' })

    const b = freshDir()
    const silent = await mimir(['new', '--full', 'x', '-o', join(b, 'out'), '--agent', 'claude'], { env: { MIMIR_AGENT_BIN: fakeAgent(b, { scene: null, exit: 7, stream: ['not json at all'] }) } })
    expect(silent.code).toBe(1)
    const sl = events(silent)
    expect(sl[0]).toEqual({ event: 'log', stage: 'storyboard', line: 'not json at all' })
    expect(sl[sl.length - 1]!.error).toContain('the agent exited with code 7 without reporting a result')

    const c = freshDir()
    const started = Date.now()
    const slow = await mimir(['new', '--full', 'x', '-o', join(c, 'out'), '--agent', 'claude', '--timeout', '1'], { env: { MIMIR_AGENT_BIN: fakeAgent(c, { scene: null, sleep: 30, stream: [init(c)] }) } })
    expect(slow.code).toBe(1)
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(events(slow).pop()).toMatchObject({ stage: 'failed', ok: false, error: 'the agent was stopped after 1 s (--timeout)' })

    const e = freshDir()
    const noPlugin = await mimir(['new', '--full', 'x', '-o', join(e, 'out'), '--agent', 'claude'], { env: { MIMIR_AGENT_BIN: fakeAgent(e, { scene: null, linger: 30, stream: [init(e, { plugins: [] })] }) } })
    expect(noPlugin.code).toBe(1)
    expect(events(noPlugin).pop()!.error).toBe(`the agent started without the mimir plugin (${ROOT}): its init event lists no plugins`)
  }, T)

  test('nothing is generated when the setup is wrong: exit 2, nothing on stdout, what to do on stderr', async () => {
    const dir = freshDir()
    const agent = fakeAgent(dir, { stream: [], scene: scene('clean') })
    const noSystem = await mimir(['new', '--full', 'x', '-o', join(dir, 'out'), '--agent', 'claude', '--system', join(dir, 'missing.md')], { env: { MIMIR_AGENT_BIN: agent } })
    expect(noSystem.code).toBe(2)
    expect(noSystem.stderr).toContain(`needs the instructions for a headless run, and ${join(dir, 'missing.md')} does not exist`)
    expect(noSystem.stderr).toContain('Nothing was generated.')
    expect(noSystem.stdout).toBe('')
    expect(existsSync(join(dir, 'argv.txt'))).toBe(false) // the agent was never started
    const noAgent = await mimir(['new', '--full', 'x', '--agent', 'claude'], { cwd: dir, env: { MIMIR_AGENT_BIN: join(dir, 'no-such-agent') } })
    expect(noAgent.code).toBe(2)
    expect(noAgent.stderr).toContain('MIMIR_AGENT_BIN points to a file that does not exist')
    const unknown = await mimir(['new', '--full', 'x', '--agent', 'claud'], { cwd: dir })
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('unknown agent "claud"; did you mean claude? (agents: command, claude, codex)')
    const noTemplate = await mimir(['new', '--full', 'x', '--agent', 'command'], { cwd: dir })
    expect(noTemplate.code).toBe(2)
    expect(noTemplate.stderr).toContain('no command template: set MIMIR_AGENT_COMMAND')
    expect((await mimir(['new'])).stderr).toContain('missing argument: "<prompt>"')
    // a machine with no agent at all: every adapter says what it needs
    const bare = freshDir()
    const bun = Bun.which('bun')!
    const none = await mimir(['new', '--full', 'x'], { cwd: bare, env: { PATH: [join(bun, '..'), '/usr/bin', '/bin'].join(delimiter) } })
    if (!Bun.which('claude', { PATH: '/usr/bin:/bin' }) && !Bun.which('codex', { PATH: '/usr/bin:/bin' }) && !existsSync(join(bun, '..', 'claude')) && !existsSync(join(bun, '..', 'codex'))) {
      expect(none.code).toBe(2)
      expect(none.stderr).toContain('mimir new needs a coding agent, and none was found on this machine')
      expect(none.stderr).toContain('  codex: ')
    }
  }, T)

  test('no vendor needed: a command template from the environment or from mimir.config.json drives any agent', async () => {
    const b = freshDir()
    const out = join(b, 'out')
    // an agent that reports nothing about its work: it writes the scene after a moment and names it
    const script = fakeAgent(b, { scene: scene('clean'), sleep: 2.5, linger: 1.5, stream: ['working on it', '{"event":"tool","name":"sh","summary":"mimir check pump.scene.js"}', 'RESULT pump.scene.js'] })
    const custom = await mimir(['new', '--full', 'how does a pump work', '-o', out, '--model', 'm9'], { env: { MIMIR_AGENT_COMMAND: `${script} --dir {workdir} --model {model} --skill {skill} "{prompt}"` } })
    expect(custom.code).toBe(0)
    const ev = events(custom)
    // `command` is chosen because a template is configured: as explicit as a choice gets
    expect(ev[0]).toEqual({ event: 'start', stage: 'storyboard', agent: 'command', model: 'm9', session: null, workdir: out })
    expect(ev).toContainEqual(expect.objectContaining({ event: 'log', line: 'working on it' }))
    // its tool calls cannot be seen: the scene file appearing on disk is what moved the stage
    expect(ev.find((e) => e.event === 'stage')).toMatchObject({ stage: 'writing', round: 1 })
    const last = ev[ev.length - 1]!
    expect(last).toMatchObject({ event: 'result', stage: 'ready', ok: true, scene: join(out, 'pump.scene.js'), check: { ok: true, errors: 0, warnings: 0 }, agent: 'command', model: 'm9', session: null, turns: null, cost_usd: null, looked: null })
    expect(last.notes).toContain('unknown whether the agent looked at its frames: its tool calls cannot be seen')
    expect(readFileSync(join(b, 'argv.txt'), 'utf8').split('\n').slice(0, 7)).toEqual(['--dir', out, '--model', 'm9', '--skill', skillDir(ROOT), 'how does a pump work'])
    // the request (instructions, where the skill is, the prompt) is on its stdin and in its environment
    const stdin = readFileSync(join(b, 'stdin.txt'), 'utf8')
    expect(stdin).toContain('You are running non-interactively as the Mimir scene generator')
    expect(stdin).toContain(`${skillDir(ROOT)}/SKILL.md`)
    expect(stdin).toEndWith('Request: how does a pump work')
    const env = readFileSync(join(b, 'env.txt'), 'utf8')
    for (const line of ['MIMIR_PROMPT=how does a pump work', `MIMIR_WORKDIR=${out}`, `MIMIR_SKILL_DIR=${skillDir(ROOT)}`, 'MIMIR_MODEL=m9', `MIMIR_MAX_TURNS=${DEFAULT_MAX_TURNS}`, `MIMIR_BUDGET_USD=${DEFAULT_BUDGET_USD}`]) expect(env).toContain(line)

    // the same from a config file in the project, with its own limits
    const c = freshDir()
    const viaConfig = fakeAgent(c, { scene: scene('clean'), stream: ['{"event":"stage","stage":"checking"}', 'RESULT pump.scene.js'] })
    writeFileSync(join(c, 'mimir.config.json'), JSON.stringify({ agent: { command: `${viaConfig} {prompt}`, maxTurns: 9, budgetUsd: 0.75, model: 'local-model' } }))
    const r = await mimir(['new', '--full', 'x', '-o', 'made'], { cwd: c })
    expect(r.code).toBe(0)
    expect(events(r).pop()).toMatchObject({ ok: true, agent: 'command', model: 'local-model', scene: join(c, 'made', 'pump.scene.js') })
    expect(events(r)).toContainEqual(expect.objectContaining({ event: 'stage', stage: 'checking' }))
    const cenv = readFileSync(join(c, 'env.txt'), 'utf8')
    expect(cenv).toContain('MIMIR_MAX_TURNS=9')
    expect(cenv).toContain('MIMIR_BUDGET_USD=0.75')
    // a typo in the config is an error, not a silent default
    writeFileSync(join(c, 'mimir.config.json'), JSON.stringify({ agent: { comand: 'x' } }))
    const typo = await mimir(['new', '--full', 'x'], { cwd: c })
    expect(typo.code).toBe(2)
    expect(typo.stderr).toContain('unknown field agent.comand; did you mean command?')
  }, T)

  test('the text form reads like a log; the scene is found without a RESULT line; over budget is said', async () => {
    const c = freshDir()
    const file = join(c, 'out', 'made.scene.js')
    const text = await mimir(['new', '--full', 'x', '-o', join(c, 'out'), '--agent', 'claude', '--text'], {
      env: { MIMIR_BUDGET_USD: '0.01', MIMIR_AGENT_BIN: fakeAgent(c, { scene: scene('clean'), sceneName: 'made.scene.js', stream: [init(c), use('Write', { file_path: file }), use('Bash', { command: 'mimir check made.scene.js --text' }, 'q'), output('q', 'OK 0 errors, 0 warnings'), done({ result: 'I am done.' })] }) },
    })
    expect(text.code).toBe(0)
    const lines = text.stdout.split('\n')
    expect(lines.slice(0, 6)).toEqual([`agent claude (fake-model) in ${join(c, 'out')}`, '[writing]', `  Write  ${file}`, '[checking]', '  Bash  mimir check made.scene.js --text', '  check 1: OK 0 errors, 0 warnings'])
    expect(lines[6]).toMatch(new RegExp(`^READY ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}  check: 0 errors, 0 warnings  rounds: 1 check, 0 look  7 turns  \\$0\\.0123  \\d+ s$`))
    // the honest verdict: checked clean, and this agent never opened a picture
    expect(lines[7]).toBe('verdict: ready-unseen  first review clean: yes')
    expect(lines[8]).toBe(`sheet: ${join(c, 'out', '.mimir', 'new', 'made', 'sheet.png')}`)
    expect(text.stdout).toContain('note: the agent did not open a picture rendered after its last change to the scene')
    const json = await mimir(['new', '--full', 'x', '-o', join(c, 'out2'), '--agent', 'claude'], { env: { MIMIR_BUDGET_USD: '0.01', MIMIR_AGENT_BIN: fakeAgent(c, { scene: scene('clean'), stream: [init(c), done()] }) } })
    expect(events(json).pop()).toMatchObject({ ok: true, over_budget: true, cost_usd: 0.0123 })
  }, T)
})

describe('mimir serve: the home API', () => {
  const io = (cwd: string, env: Record<string, string>): Io => ({ json: true, cwd, env, out: () => {}, log: () => {} })
  let home: HomeServer | null = null
  afterEach(() => { home?.stop(); home = null })

  test('scenes, agents, a generation with its events as server-sent events, its sheet, an export', async () => {
    const dir = freshDir()
    const root = join(dir, 'scenes')
    mkdirSync(root)
    writeFileSync(join(root, 'clean.scene.js'), readFileSync(scene('clean')))
    const agent = fakeAgent(dir, { scene: scene('clean'), sleep: 1.2, stream: ['{"event":"stage","stage":"checking"}', 'RESULT pump.scene.js'] })
    home = await startHome({ dir: root, port: null, open: false, jobs: 1 }, io(dir, { ...ENV, MIMIR_AGENT_COMMAND: `${agent} {prompt}` }))
    const get = (path: string, initOpts: RequestInit = {}) => fetch(home!.origin + path, initOpts)
    expect(home.port).toBeGreaterThan(0)

    // GET /api/scenes
    const scenes = (await (await get('/api/scenes')).json()) as { root: string; scenes: Array<Record<string, string>> }
    expect(scenes.root).toBe(root)
    expect(scenes.scenes.map((s) => [s.name, s.title, s.path, s.url])).toEqual([['clean', 'Clean pipeline', 'clean.scene.js', '/viewer.html?scene=%2Fscene%2Fclean.scene.js']])
    // GET /api/agents: what a generation would use
    const agents = (await (await get('/api/agents')).json()) as { default: string; agents: Array<{ name: string; available: boolean }> }
    expect(agents.default).toBe('command')
    expect(agents.agents.map((a) => a.name)).toEqual(['command', 'claude', 'codex'])
    // the viewer and the files of the directory
    expect((await get('/')).headers.get('content-type')).toContain('text/html')
    expect(await (await get('/scene/clean.scene.js')).text()).toContain('Clean pipeline')

    // POST /api/new → 202, then the events
    const started = await get('/api/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'How does a pump work?', model: 'm1' }) })
    expect(started.status).toBe(202)
    const job = (await started.json()) as Record<string, any>
    expect(job).toMatchObject({ id: '1', prompt: 'How does a pump work?', dir: 'how-does-a-pump-work', status: 'running', events_url: '/api/new/1/events' })
    // one at a time: a second one is refused while the first runs
    const second = await get('/api/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'another' }) })
    expect(second.status).toBe(429)
    expect(((await second.json()) as { running: string[] }).running).toEqual(['1'])

    const stream = await get(job.events_url)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const text = await stream.text() // the stream closes after the result
    const frames = text.split('\n\n').filter((f) => f.includes('data: ')).map((f) => ({ id: /^id: (\d+)$/m.exec(f)?.[1], event: /^event: (\w+)$/m.exec(f)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(f)![1]!) as Record<string, any> }))
    expect(frames.map((f) => f.id)).toEqual(frames.map((_, i) => String(i + 1)))
    expect(frames[0]).toMatchObject({ event: 'start', data: { event: 'start', agent: 'command', model: 'm1', workdir: join(root, 'how-does-a-pump-work') } })
    expect(frames.map((f) => f.event)).toContain('stage')
    const result = frames[frames.length - 1]!
    expect(result.event).toBe('result')
    expect(result.data).toMatchObject({ stage: 'ready', ok: true, scene: join(root, 'how-does-a-pump-work', 'pump.scene.js'), check: { ok: true, errors: 0, warnings: 0 } })
    // a late reader gets the same events again, or only what it has not seen
    expect(await (await get(job.events_url)).text()).toBe(text)
    const tail = await (await get(job.events_url, { headers: { 'last-event-id': String(frames.length - 1) } })).text()
    expect(tail.split('\n\n').filter((f) => f.includes('data: '))).toHaveLength(1)

    const status = (await (await get('/api/new/1')).json()) as Record<string, any>
    expect(status).toMatchObject({ status: 'ready', stage: 'ready', result: { ok: true } })
    const sheet = await get('/api/new/1/sheet')
    expect(sheet.headers.get('content-type')).toBe('image/png')
    expect(pngSize(new Uint8Array(await sheet.arrayBuffer()))!.width).toBeGreaterThan(100)
    // the new scene is in the list, newest first
    const after = (await (await get('/api/scenes')).json()) as { scenes: Array<Record<string, string>> }
    expect(after.scenes.map((s) => s.path)).toEqual(['how-does-a-pump-work/pump.scene.js', 'clean.scene.js'])
    expect((await get('/api/new/99')).status).toBe(404)

    // GET /api/export and /api/sheet for a scene of the directory
    const exported = await get('/api/export?scene=clean.scene.js')
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-disposition')).toBe('attachment; filename="clean.html"')
    expect(await exported.text()).toContain('<html')
    const thumb = await get('/api/sheet?scene=clean.scene.js')
    expect(thumb.headers.get('content-type')).toBe('image/png')
    expect((await get('/api/export?scene=clean.scene.js&format=pdf')).status).toBe(400)
    expect((await get('/api/export?scene=nope.scene.js')).status).toBe(404)
    expect((await get('/api/export')).status).toBe(400)
  }, T)

  test('safe by default: its own address only, same-origin JSON for anything that changes something, no dot files, no way out of the directory', async () => {
    const dir = freshDir()
    const root = join(dir, 'scenes')
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.env'), 'SECRET=1')
    writeFileSync(join(root, '.git', 'config'), 'secret')
    writeFileSync(join(dir, 'outside.scene.js'), 'export default 1')
    writeFileSync(join(root, 'clean.scene.js'), readFileSync(scene('clean')))
    home = await startHome({ dir: root, port: null, open: false, jobs: 1 }, io(dir, { ...ENV, PATH: '/usr/bin:/bin' }))
    const origin = home.origin
    expect(origin).toBe(`http://127.0.0.1:${home.port}`)
    const raw = async (path: string, headers: Record<string, string> = {}, method = 'GET', body?: string): Promise<{ status: number; text: string }> => {
      // curl sends the Host header and the path exactly as written
      const args = ['curl', '-s', '--path-as-is', '-o', '-', '-w', '\n%{http_code}', '-X', method, ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), ...(body !== undefined ? ['-d', body] : []), origin + path]
      const out = (await new Response(Bun.spawn(args, { stdout: 'pipe', stderr: 'ignore' }).stdout).text()).split('\n')
      return { status: Number(out.pop()), text: out.join('\n') }
    }
    // a made-up host name (DNS rebinding) is refused, for pages and for the API
    expect((await raw('/api/scenes', { Host: 'evil.example' })).status).toBe(403)
    expect((await raw('/', { Host: `evil.example:${home.port}` })).status).toBe(403)
    expect((await raw('/api/scenes', { Host: `localhost:${home.port}` })).status).toBe(200)
    // another site cannot start an agent: not with a form, not with JSON from its own origin
    expect((await raw('/api/new', {}, 'POST', 'prompt=x')).status).toBe(415)
    expect((await raw('/api/new', { 'content-type': 'application/json', Origin: 'http://evil.example' }, 'POST', '{"prompt":"x"}')).status).toBe(403)
    expect((await raw('/api/new', { 'content-type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, 'POST', '{"prompt":"x"}')).status).toBe(403)
    // bad requests say what is wrong
    const post = (body: string) => raw('/api/new', { 'content-type': 'application/json', Origin: origin }, 'POST', body)
    expect((await post('{"prompt":""}')).text).toContain('prompt must be a non-empty string')
    expect((await post('{"prompt":"x","dir":"../escape"}')).status).toBe(400)
    expect((await post('{"prompt":"x","dir":".hidden"}')).status).toBe(400)
    expect((await post('{"prompt":"x","shell":"rm"}')).text).toContain('unknown field shell')
    expect((await post('not json')).status).toBe(400)
    // no agent on this machine (PATH has none): the answer says so, nothing runs
    const none = await post('{"prompt":"x"}')
    if (!Bun.which('claude', { PATH: '/usr/bin:/bin' }) && !Bun.which('codex', { PATH: '/usr/bin:/bin' })) {
      expect(none.status).toBe(503)
      expect(none.text).toContain('needs a coding agent, and none was found on this machine')
    }
    expect(home.jobs.size).toBe(0)
    // dot files and dot directories are never served; no path leaves the directory
    for (const path of ['/scene/.env', '/scene/.git/config', '/scene/%2eenv', '/scene/../outside.scene.js', '/scene/%2e%2e/outside.scene.js', '/scene/..%2foutside.scene.js', '/.env', '/api/export?scene=../outside.scene.js', '/api/export?scene=.git/config', '/api/sheet?scene=%2e%2e/outside.scene.js']) {
      const r = await raw(path)
      expect([path, r.status >= 400 && r.status < 500]).toEqual([path, true])
      expect(r.text).not.toContain('SECRET')
      expect(r.text).not.toContain('export default 1')
    }
    expect((await raw('/scene/clean.scene.js')).status).toBe(200)
    expect((await raw('/api/nope')).status).toBe(404)
    expect((await raw('/api/scenes', {}, 'DELETE')).status).toBe(404)
  }, T)

  test('a running generation can be stopped; stopping the server stops what it started', async () => {
    const dir = freshDir()
    const root = join(dir, 'scenes')
    mkdirSync(root)
    const agent = fakeAgent(dir, { scene: null, sleep: 30, stream: ['never'] })
    home = await startHome({ dir: root, port: null, open: false, jobs: 2 }, io(dir, { ...ENV, MIMIR_AGENT_COMMAND: `${agent} {prompt}` }))
    const post = () => fetch(home!.origin + '/api/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'slow one', dir: 'slow' }) })
    expect((await post()).status).toBe(202)
    for (let i = 0; i < 50 && !existsSync(join(dir, 'argv.txt')); i++) await Bun.sleep(50)
    const stopped = await fetch(home.origin + '/api/new/1', { method: 'DELETE' })
    expect(stopped.status).toBe(202)
    const text = await (await fetch(home.origin + '/api/new/1/events')).text()
    const last = JSON.parse(text.trim().split('\n').filter((l) => l.startsWith('data: ')).pop()!.slice(6)) as Record<string, any>
    expect(last).toMatchObject({ event: 'result', stage: 'failed', ok: false, error: 'the generation was stopped by a request (DELETE)' })
    expect((await post()).status).toBe(202)
    const before = Bun.spawnSync(['ps', '-axo', 'command=']).stdout.toString().split('\n').filter((l) => l.includes(join(dir, 'fake-agent')))
    expect(before.length).toBeGreaterThan(0)
    home.stop()
    home = null
    let left: string[] = before
    for (let i = 0; i < 80 && left.length > 0; i++) {
      await Bun.sleep(100)
      left = Bun.spawnSync(['ps', '-axo', 'command=']).stdout.toString().split('\n').filter((l) => l.includes(join(dir, 'fake-agent')))
    }
    expect(left).toEqual([])
  }, T)
})

describe('the skill, through the real engine', () => {
  /** Every complete scene the skill shows (the SKILL.md skeleton, the cookbook) is run through `mimir check`. */
  const blocks = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((code) => code.includes('export default scene('))

  test('the scenes the skill teaches from pass `mimir check` clean', async () => {
    const dir = freshDir()
    const sources = [...blocks(join(skillDir(ROOT), 'SKILL.md')), ...blocks(join(skillDir(ROOT), 'references', 'cookbook.md'))]
    expect(sources.length).toBe(4)
    for (const [i, code] of sources.entries()) {
      const file = join(dir, `skill-${i}.scene.js`)
      writeFileSync(file, code)
      const r = await mimir(['check', file, '--text'], { base: BASE })
      expect([i, r.stdout.trim().split('\n').pop()]).toEqual([i, 'OK 0 errors, 0 warnings'])
      expect(r.code).toBe(0)
    }
  }, 180_000)

  test('mimir skill, run on its own: the reference is in sync, install puts a link where it is told', async () => {
    const run = async (args: string[], env: Record<string, string> = {}): Promise<Result> => {
      const proc = Bun.spawn([Bun.which('bun')!, join(ROOT, 'src', 'cli', 'agents', 'skill.ts'), ...args], { cwd: WORK, env: { ...BASE, ...env }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      return { code, stdout, stderr }
    }
    const check = await run(['check', '--text'])
    expect(check.stdout).toMatch(/^OK \d+ reference files are up to date\n$/)
    expect(check.code).toBe(0)
    const home = freshDir()
    const installed = await run(['install', '--target', 'claude', '--target', join(home, 'elsewhere')], { HOME: home })
    expect(installed.code).toBe(0)
    const out = JSON.parse(installed.stdout) as { installed: Array<{ target: string; path: string; status: string }> }
    expect(out.installed.map((r) => [r.target, r.status])).toEqual([['claude', 'installed'], ['dir', 'installed']])
    expect(readdirSync(join(home, '.claude', 'skills', 'mimir'))).toContain('SKILL.md')
    expect(readdirSync(join(home, 'elsewhere', 'mimir', 'references'))).toContain('api-core.md')
    const bad = await run(['instal'])
    expect(bad.code).toBe(2)
    expect(bad.stderr).toContain('unknown skill action "instal"; did you mean install?')
    expect((await run(['--help'])).stdout).toContain('mimir skill - install the mimir skill for a coding agent')
  }, T)

  // The two commands below are in the launcher once src/cli/main.ts routes them; until then these lines do not run.
  test.skipIf(!COMMANDS.serve || !COMMANDS.skill)('wired into the launcher: mimir serve, mimir skill, mimir new --budget-usd', async () => {
    expect((await mimir(['serve', '--help'])).stdout).toContain('mimir serve - the home of the player')
    expect((await mimir(['skill', 'check', '--text'], { base: BASE })).stdout).toContain('reference files are up to date')
    const dir = freshDir()
    const r = await mimir(['new', '--full', 'x', '-o', join(dir, 'out'), '--agent', 'claude', '--budget-usd', '0.25'], { env: { MIMIR_AGENT_BIN: fakeAgent(dir, { scene: scene('clean'), stream: [init(dir), done()] }) } })
    expect(r.code).toBe(0)
    expect(readFileSync(join(dir, 'argv.txt'), 'utf8')).toContain('--max-budget-usd\n0.25\n')
  }, T)
})
