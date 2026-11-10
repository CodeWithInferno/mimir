// One generation, for `mimir new` and for the home API of `mimir serve`: choose the agent, start it in the working
// directory, turn its output into stage progress, hold it to its limits, and then find out what really happened.
// Nothing the agent says about its own work is taken on trust: the scene file must exist, `mimir check` is run here,
// and the contact sheet of the result is rendered here from the final file.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { CliError } from '../errors.ts'
import { loadConfig } from './config.ts'
import { commandTemplate } from './command.ts'
import { selectAdapter, type Selection } from './index.ts'
import { CONCEPT_SIZES, DEFAULT_TIMEOUT_S, DISK_WATCH_MS, SIZE_NAMES, STOP_GRACE_MS, VERIFY_RETRIES, sizeFromPrompt, type ConceptSize } from './limits.ts'
import { launchPage } from './page.ts'
import { StageTracker } from './stages.ts'
import { parseResultLine } from './text.ts'
import type { AgentCommand, AgentOptions, AgentOutcome, CheckSummary, Env, NewResult, Progress, RunContext } from './types.ts'

/** Where the instructions of a headless run live when nothing else names a file. */
export const DEFAULT_INSTRUCTIONS = join('skills', 'mimir', 'gen-system.md')
export const SKILL_DIR = join('skills', 'mimir')

export interface GenerateRequest {
  prompt: string
  /** directory the agent works in and writes the scene to (created when missing) */
  workdir: string
  /** where mimir.config.json is looked for */
  cwd: string
  env: Env
  /** the mimir checkout: bin/, skills/, the plugin manifest */
  root: string
  /** --agent, or null */
  agent: string | null
  model: string | null
  maxTurns: number | null
  budgetUsd: number | null
  /** seconds, or null */
  timeout: number | null
  /** --system: path of the instructions for a headless run, or null */
  instructions: string | null
  resume: string | null
  /** --size, or null / absent: MIMIR_SIZE, else from the length of the prompt */
  size?: ConceptSize | null
  /** --fast: the adapter's cheapest model (a named model wins) */
  fast?: boolean
  /** --full: the full loop through the skill instead of the one-page lean launch */
  full?: boolean
  /** --effort: how hard the model should think, or null / absent */
  effort?: string | null
  /** write once: corrections the model may be asked for (--fix), or null / absent for the default */
  fixRounds?: number | null
  /** write once: path of an existing scene to change instead of writing a new one (--edit) */
  edit?: string | null
}

/** Where a run keeps its raw stream and its usage, under the working directory. */
export const RUN_DIR = join('.mimir', 'new', 'runs')
export const STREAM_FILE = 'stream.ndjson'
export const USAGE_FILE = 'usage.json'

/** How the result is verified. Handed in so that the driver can be exercised without a browser. */
export interface Verifier {
  check(scenePath: string): Promise<CheckSummary>
  /** render a contact sheet of the scene into outDir and answer its path */
  sheet(scenePath: string, outDir: string): Promise<string>
}

export interface Prepared {
  request: GenerateRequest
  selection: Selection
  options: AgentOptions
  command: AgentCommand
  timeoutS: number
  size: ConceptSize
  lean: boolean
}

const positive = (text: string | undefined, name: string, whole = false): number | null => {
  if (text === undefined || text === '') return null
  const n = Number(text)
  if (!Number.isFinite(n) || n <= 0 || (whole && !Number.isInteger(n))) throw new CliError(`${name} must be a ${whole ? 'whole ' : ''}number greater than 0 (got "${text}")`)
  return n
}

/** The plugin directory that carries the skill: MIMIR_PLUGIN_DIR, else the checkout when it is a plugin, else none. */
export function pluginDirOf(root: string, env: Env): string | null {
  const override = env.MIMIR_PLUGIN_DIR
  if (override !== undefined && override !== '') {
    if (!existsSync(join(override, '.claude-plugin', 'plugin.json'))) throw new CliError(`MIMIR_PLUGIN_DIR is not a plugin directory (no .claude-plugin/plugin.json): ${override}`)
    return override
  }
  return existsSync(join(root, '.claude-plugin', 'plugin.json')) ? root : null
}

/**
 * Everything that can be wrong before the agent starts is found here (and thrown as a usage or setup error):
 * the adapter, its executable, the instructions file, the limits. Each value: flag, then environment, then
 * mimir.config.json, then the adapter's documented default.
 */
export function prepare(request: GenerateRequest): Prepared {
  const { env, root } = request
  const config = loadConfig(request.cwd, env)
  const selection = selectAdapter(request.agent, env, config.agent)
  const { adapter, detection } = selection

  const named = request.instructions ?? (env.MIMIR_GEN_SYSTEM && env.MIMIR_GEN_SYSTEM !== '' ? env.MIMIR_GEN_SYSTEM : null)
  const instructionsFile = named !== null ? resolve(request.cwd, named)
    : config.agent.instructions !== undefined && config.file !== null ? resolve(dirname(config.file), config.agent.instructions)
      : join(root, DEFAULT_INSTRUCTIONS)
  if (!existsSync(instructionsFile) || !statSync(instructionsFile).isFile()) {
    throw new CliError(
      `mimir new needs the instructions for a headless run, and ${instructionsFile} does not exist. ` +
        (named !== null ? 'Check the path given with --system / MIMIR_GEN_SYSTEM. ' : `They ship with the mimir skill (${DEFAULT_INSTRUCTIONS}); give another file with --system <file> or MIMIR_GEN_SYSTEM. `) +
        'Nothing was generated.',
    )
  }
  const skillDir = existsSync(join(root, SKILL_DIR, 'SKILL.md')) ? join(root, SKILL_DIR) : null
  const sizeName = request.size ?? (env.MIMIR_SIZE && env.MIMIR_SIZE !== '' ? env.MIMIR_SIZE : null)
  if (sizeName !== null && !(SIZE_NAMES as readonly string[]).includes(sizeName)) throw new CliError(`MIMIR_SIZE must be one of ${SIZE_NAMES.join(', ')} (got "${sizeName}")`)
  const size = (sizeName as ConceptSize | null) ?? sizeFromPrompt(request.prompt)
  // The lean launch is the default: ONE page is the agent's whole instructions. Instructions somebody named
  // (--system, MIMIR_GEN_SYSTEM, mimir.config.json) or --full keep the full loop through the skill.
  const custom = named !== null || (config.agent.instructions !== undefined && config.file !== null)
  const page = request.full === true || custom ? null : launchPage(root, env.MIMIR_TYPES && env.MIMIR_TYPES !== '' ? env.MIMIR_TYPES : join(root, 'types', 'mimir.d.ts'), size)
  const lean = page !== null
  const namedModel = request.model ?? (env.MIMIR_MODEL && env.MIMIR_MODEL !== '' ? env.MIMIR_MODEL : null) ?? config.agent.model ?? null
  if (request.fast === true && namedModel === null && !adapter.defaults.fastModel) throw new CliError(`--fast: the ${adapter.name} adapter names no cheap model. Name one with --model. Nothing was generated.`)
  const options: AgentOptions = {
    model: namedModel ?? (request.fast === true ? adapter.defaults.fastModel! : adapter.defaults.model),
    effort: request.effort ?? (env.MIMIR_EFFORT && env.MIMIR_EFFORT !== '' ? env.MIMIR_EFFORT : null) ?? config.agent.effort ?? null,
    maxTurns: request.maxTurns ?? positive(env.MIMIR_MAX_TURNS, 'MIMIR_MAX_TURNS', true) ?? config.agent.maxTurns ?? (lean ? CONCEPT_SIZES[size].maxTurns : adapter.defaults.maxTurns),
    budgetUsd: request.budgetUsd ?? positive(env.MIMIR_BUDGET_USD, 'MIMIR_BUDGET_USD') ?? config.agent.budgetUsd ?? adapter.defaults.budgetUsd,
    instructionsFile: page?.file ?? instructionsFile,
    instructions: page?.text ?? readFileSync(instructionsFile, 'utf8'),
    lean,
    resume: request.resume,
    sessionId: env.MIMIR_SESSION && env.MIMIR_SESSION !== '' ? env.MIMIR_SESSION : randomUUID(),
    binDir: join(root, 'bin'),
    // a lean run carries everything in its page: no skill to read, no plugin to load
    skillDir: lean ? null : skillDir,
    pluginDir: lean ? null : pluginDirOf(root, env),
    binary: detection.binary,
    commandTemplate: commandTemplate(env, config.agent),
    extraArgs: config.agent.args ?? [],
    env,
  }
  const workdir = resolve(request.cwd, request.workdir)
  // a directory the agent is known to refuse would cost money and write nothing: say so before it starts
  const refused = adapter.preflight?.(workdir, options) ?? null
  if (refused !== null) throw new CliError(`mimir new: ${refused}. Nothing was generated.`)
  const command = adapter.command(request.prompt, workdir, options)
  if (command.argv.length === 0 || command.argv[0] === '') throw new CliError(`the ${adapter.name} agent has an empty command line. Nothing was generated.`)
  return { request: { ...request, workdir }, selection, options, command, timeoutS: request.timeout ?? config.agent.timeout ?? DEFAULT_TIMEOUT_S, size, lean }
}

/** Scene files under a directory (not hidden ones, not node_modules), with their modification time. */
export function sceneFiles(dir: string, depth = 2): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (d: string, left: number): void => {
    let names: string[]
    try { names = readdirSync(d) } catch { return }
    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const p = join(d, name)
      let st: ReturnType<typeof statSync>
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (left > 0) walk(p, left - 1) } else if (/\.scene\.m?js$/i.test(name)) out.set(p, st.mtimeMs)
    }
  }
  walk(dir, depth)
  return out
}

/** The scene files that are new or changed since `before`, newest first. */
export function changedScenes(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>): string[] {
  return [...after].filter(([p, m]) => before.get(p) !== m).sort((a, b) => b[1] - a[1]).map(([p]) => p)
}

export interface GenerateHooks {
  /** one progress line, then the result line last */
  emit(e: Progress | NewResult): void
  log(message: string): void
  /** the agent's stderr, as it arrives */
  stderr?(chunk: Uint8Array): void
  /** called once the agent runs, with a function that stops it (the result then says why) */
  onStart?(stop: (why: string) => void): void
  /** register something that must run if this process is torn down; answers the function that unregisters it */
  onCleanup?(fn: () => void): () => void
  /** the clock (ms); a test hands in its own */
  now?(): number
}

/** Run a step of the verification; when it throws (the browser could not be started or reached), try again a few times. */
async function attempt<T>(run: () => Promise<T>, log: (message: string) => void, what: string): Promise<T> {
  for (let tries = 0; ; tries++) {
    try {
      return await run()
    } catch (e) {
      if (tries >= VERIFY_RETRIES) throw e
      log(`${what} failed (${(e as Error).message.split('\n')[0]}); trying once more`)
    }
  }
}

export async function generate(p: Prepared, verify: Verifier, hooks: GenerateHooks): Promise<NewResult> {
  const { adapter } = p.selection
  const { options, command: cmd } = p
  const workdir = p.request.workdir
  const now = hooks.now ?? Date.now
  mkdirSync(workdir, { recursive: true })
  const before = sceneFiles(workdir)
  const began = now()
  const tracker = new StageTracker(() => now() - began)
  const run: RunContext = { options, workdir, memo: {} }
  // the raw output of the agent is kept beside the result: every run is a measurement
  let runDir: string | null = join(workdir, RUN_DIR, options.sessionId)
  try { mkdirSync(runDir, { recursive: true }); writeFileSync(join(runDir, STREAM_FILE), '') } catch { runDir = null }
  hooks.log(`${p.lean ? `lean launch (${p.size} concept, one page of ${Buffer.byteLength(options.instructions)} bytes)` : 'full loop (skill + references)'}`)
  hooks.log(`agent ${adapter.name}${adapter.status === 'untested' ? ' (untested adapter)' : ''}: ${cmd.argv[0]} (model ${options.model ?? 'its own default'}, at most ${options.maxTurns} turns and $${options.budgetUsd}); working in ${workdir}`)

  let model: string | null = options.model
  let session: string | null = null
  let started = false
  let turns = 0
  let outcome: AgentOutcome | null = null
  const start = (): void => {
    if (started) return
    started = true
    hooks.emit({ event: 'start', stage: tracker.stage, agent: adapter.name, model, session, workdir })
  }

  // The agent gets a process group of its own, so that it and everything it started (shells, browsers of its own
  // mimir runs) can be stopped together: a child that outlives it would keep its output pipe open.
  const child = spawn(cmd.argv[0]!, cmd.argv.slice(1), { cwd: workdir, env: { ...(p.request.env as Record<string, string>), ...cmd.env }, stdio: [cmd.stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  const signal = (sig: NodeJS.Signals): void => {
    if (child.pid === undefined) return
    try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch { /* gone */ } }
  }
  const removeCleanup = hooks.onCleanup?.(() => signal('SIGKILL')) ?? (() => {})
  let killedFor: string | null = null
  const stop = (why: string): void => {
    if (killedFor !== null) return
    killedFor = why
    signal('SIGTERM')
    setTimeout(() => signal('SIGKILL'), STOP_GRACE_MS).unref()
  }
  hooks.onStart?.(stop)
  const timer = setTimeout(() => stop(`the agent was stopped after ${p.timeoutS} s (--timeout)`), p.timeoutS * 1000)
  if (cmd.stdin !== null && child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(cmd.stdin) }
  if (adapter.opaque) start()

  // an agent whose tool calls cannot be seen: the scene file appearing or changing on disk is what shows its progress
  let seen = before
  const watch = adapter.opaque
    ? setInterval(() => {
        const after = sceneFiles(workdir)
        for (const path of changedScenes(seen, after)) for (const e of tracker.observeWrite(path)) hooks.emit(e)
        seen = after
      }, DISK_WATCH_MS)
    : null

  let stderrTail = ''
  child.stderr!.on('data', (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-2000); hooks.stderr?.(d) })
  let buffer = ''
  const feed = (text: string): void => {
    for (const ev of adapter.parseEvent(text, run)) {
      if (ev.kind === 'start') { model = ev.model ?? model; session = ev.session ?? session; start() }
      else if (ev.kind === 'turn') turns++
      else if (ev.kind === 'abort') stop(ev.reason)
      else if (ev.kind === 'end') outcome = ev.outcome
      else for (const e of tracker.feed(ev)) hooks.emit(e)
    }
    // the limit is a limit: the agent is given it, and held to it here (its own count of turns is the same count)
    if (killedFor === null && outcome === null && turns > options.maxTurns) stop(`the agent was stopped at its turn limit (${options.maxTurns}; raise it with --max-turns)`)
  }
  child.stdout!.on('data', (d: Buffer) => {
    if (runDir !== null) { try { appendFileSync(join(runDir, STREAM_FILE), d) } catch { /* the run matters more than its record */ } }
    buffer += d.toString()
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      feed(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
    }
  })
  let spawnError: Error | null = null
  const code = await new Promise<number | null>((done) => {
    child.once('error', (e) => { spawnError = e; done(null) })
    child.once('close', (c) => done(c))
    // once it was told to stop, its exit is enough: do not wait for whoever still holds its pipes
    child.once('exit', (c) => { if (killedFor !== null) setTimeout(() => done(c), STOP_GRACE_MS).unref() })
  })
  signal('SIGKILL') // nothing the agent started may outlive it
  clearTimeout(timer)
  if (watch) clearInterval(watch)
  removeCleanup()
  if (buffer !== '') feed(buffer)
  if (spawnError) throw new CliError(`could not start the agent (${cmd.argv[0]}): ${(spawnError as Error).message}. Nothing was generated.`)

  // ── what really happened ─────────────────────────────────────────────────────────────────────────
  const ended = outcome as AgentOutcome | null
  const stderrLast = stderrTail.trim().split('\n').pop() ?? ''
  const final: AgentOutcome = ended ?? {
    ok: false, text: '', turns: null, costUsd: null, durationMs: null, session, denials: [],
    error: `the agent exited${code === null ? '' : ` with code ${code}`} without reporting a result${stderrLast ? `: ${stderrLast}` : ''}`,
  }
  let error: string | null = killedFor ?? final.error ?? (code !== 0 && code !== null ? `the agent exited with code ${code}${stderrLast ? `: ${stderrLast}` : ''}` : null)
  const notes: string[] = []
  const sum = tracker.summary()

  // the scene: what the agent names in its RESULT line, else what it was seen writing, else what changed on disk
  const claimed = parseResultLine(final.text)
  const abs = (path: string): string => (isAbsolute(path) ? path : resolve(workdir, path))
  const changed = changedScenes(before, sceneFiles(workdir))
  const written = [...sum.scenes].reverse().map(abs).find((path) => existsSync(path)) ?? null
  let scene: string | null = null
  if (claimed && existsSync(abs(claimed.scene))) scene = abs(claimed.scene)
  else scene = written ?? changed[0] ?? null
  if (claimed && scene !== abs(claimed.scene)) error ??= `the agent reported the scene ${claimed.scene}, which does not exist`
  if (scene === null) error ??= 'the agent finished without writing a scene file (*.scene.js)'

  // never take the agent's word for it: check here, and render the sheet of the final file here
  let check: CheckSummary | null = null
  let sheet: string | null = null
  if (scene !== null) {
    try {
      check = await attempt(() => verify.check(scene!), hooks.log, 'the check of the result')
      if (!check.ok) error ??= `the scene has ${check.errors} error${check.errors === 1 ? '' : 's'}: run mimir check ${scene}`
      else if (check.warnings > 0) notes.push(`the scene has ${check.warnings} warning${check.warnings === 1 ? '' : 's'}: run mimir check ${scene}`)
    } catch (e) {
      error ??= `the scene could not be checked: ${(e as Error).message}`
    }
    try {
      sheet = await attempt(() => verify.sheet(scene!, join(dirname(scene), '.mimir', 'new', basename(scene!).replace(/\.scene\.m?js$/i, ''))), hooks.log, 'the contact sheet of the result')
    } catch (e) {
      notes.push(`no contact sheet: ${(e as Error).message.split('\n')[0]}`)
    }
  }
  if (final.denials.length) notes.push(`${final.denials.length} tool call${final.denials.length === 1 ? ' was' : 's were'} refused (${final.denials.slice(0, 3).join('; ')})`)
  if (sum.looked === false && sum.rounds.look > 0 && p.lean) notes.push('the agent looked at the sheet once and fixed what it saw; the final frames were verified by the text of mimir review only')
  else if (sum.looked === false) notes.push('the agent did not open a picture rendered after its last change to the scene: nobody has looked at the final frames')
  else if (sum.looked === null) notes.push('unknown whether the agent looked at its frames: its tool calls cannot be seen')
  if (adapter.status === 'untested') notes.push(`the ${adapter.name} adapter is untested`)
  const overBudget = final.costUsd !== null && final.costUsd > options.budgetUsd
  const storyboard = sum.storyboard !== null && existsSync(abs(sum.storyboard)) ? abs(sum.storyboard) : null

  if (check?.flags) notes.push(`mimir review still has ${check.flags} composition finding${check.flags === 1 ? '' : 's'}: run mimir review ${scene}`)
  let sceneLines: number | null = null
  if (scene !== null) { try { sceneLines = readFileSync(scene, 'utf8').replace(/\n+$/, '').split('\n').length } catch { /* gone */ } }
  const verdict: NewResult['verdict'] = error !== null ? 'failed' : sum.looked !== null && sum.rounds.look === 0 ? 'ready-unseen' : (check?.flags ?? 0) > 0 ? 'ready-with-flags' : 'ready'
  const usage = final.usage ?? null

  const result: NewResult = {
    event: 'result', stage: error === null ? 'ready' : 'failed', ok: error === null, scene, check, sheet, storyboard, looked: sum.looked, rounds: sum.rounds, shots: sum.shots,
    agent: adapter.name, model, session: final.session ?? session ?? options.resume,
    turns: final.turns ?? (turns > 0 ? turns : null), cost_usd: final.costUsd, ...(overBudget ? { over_budget: true as const } : {}),
    duration_ms: final.durationMs, wall_ms: Math.round(now() - began), denials: final.denials.length, error, notes,
    verdict, size: p.size, lean: p.lean, usage, first_review_clean: sum.firstClean, flags: check?.flags ?? null, scene_lines: sceneLines, run_dir: runDir,
  }
  if (runDir !== null) { try { writeFileSync(join(runDir, USAGE_FILE), JSON.stringify({ prompt: p.request.prompt, ...result }, null, 2) + '\n') } catch { /* the result line carries it too */ } }
  hooks.emit(result)
  return result
}
