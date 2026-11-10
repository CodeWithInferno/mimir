// The write-once path of `mimir new`: the model is a function from text to text.
//
// It gets ONE page (what a scene is and every name it may use) and the request, and answers with the module. The
// engine writes the file and reviews it here: the linter, a text account of every step, composition findings. Only
// when the review finds something is the model asked again, with its module and the review as the correction.
// There is no agent loop and there are no tools, so a clean scene costs ONE request to the model, and any model
// that answers in text can be the writer (docs/agents.md, "write once").
//
// Nothing the model says is taken on trust: what counts is the review run here on the file as written. The best
// version seen is the one that stays on disk: a correction that makes things worse is not kept.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { CliError, UsageError, suggest } from '../errors.ts'
import { loadConfig } from './config.ts'
import { writerTemplate } from './command.ts'
import { RUN_DIR, USAGE_FILE, type GenerateHooks, type GenerateRequest } from './generate.ts'
import { ADAPTERS, adapterByName, adapterNames } from './index.ts'
import { DEFAULT_FIX_ROUNDS, NAME_STOP_WORDS, NAME_WORDS, REVIEW_TEXT_MAX, STOP_GRACE_MS, VERIFY_RETRIES, WRITER_TIMEOUT_S, sizeFromPrompt, type ConceptSize } from './limits.ts'
import { oncePage } from './page.ts'
import { pathWith } from './text.ts'
import type { AgentAdapter, AgentCommand, AgentOptions, Detection, Env, NewResult, Usage, Writer, WriterReply } from './types.ts'

// ── pure: the reply, the file name, the prompts ──────────────────────────────────────────────────

/**
 * The module in a reply: the last fenced block that has an `export default`, else the only fenced block, else the
 * whole reply when it reads like a module. `cut` = the reply stopped inside a block (the model ran out of room).
 */
export function extractModule(reply: string): { module: string | null; cut: boolean } {
  const blocks = [...reply.matchAll(/```[ \t]*[\w-]*[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]!)
  const exported = [...blocks].reverse().find((b) => /\bexport\s+default\b/.test(b))
  const done = (text: string, cut = false): { module: string; cut: boolean } => ({ module: text.replace(/\s+$/, '') + '\n', cut })
  if (exported !== undefined) return done(exported)
  if (blocks.length === 1 && blocks[0]!.trim() !== '') return done(blocks[0]!)
  // a block that was opened and never closed
  const open = /```[ \t]*[\w-]*[ \t]*\r?\n([\s\S]*)$/.exec(reply)
  if (blocks.length === 0 && open && /\b(import|export)\b/.test(open[1]!)) return done(open[1]!, true)
  if (blocks.length === 0 && /\bexport\s+default\b/.test(reply)) return done(reply.trim())
  return { module: null, cut: false }
}

/** "how does a TCP three-way handshake work" → "tcp-three-way-handshake": the name of the scene file. */
export function sceneNameFromPrompt(prompt: string): string {
  const words = prompt.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w !== '' && !NAME_STOP_WORDS.includes(w))
  return words.slice(0, NAME_WORDS).join('-') || 'scene'
}

/** A scene path in `dir` that does not exist yet: name.scene.js, name-2.scene.js, … (a generation never overwrites a file). */
export function freeScenePath(dir: string, name: string, exists: (path: string) => boolean = existsSync): string {
  for (let n = 1; ; n++) {
    const path = join(dir, `${name}${n === 1 ? '' : `-${n}`}.scene.js`)
    if (!exists(path)) return path
  }
}

/** The start and the end of a long review (the verdict of the linter is first, the findings are last). */
export function clipReview(text: string, max: number = REVIEW_TEXT_MAX): string {
  // the last line tells an agent with tools what to run next; a writer has none
  const body = text.replace(/(^|\n)(FIX FIRST|FLAGS|CLEAN):[^\n]*\n?(NEXT:[^\n]*\n?)?$/, '\n').trimEnd()
  if (body.length <= max) return body
  const head = Math.floor(max * 0.4)
  return `${body.slice(0, head)}\n… (${body.length - max} characters left out) …\n${body.slice(body.length - (max - head))}`
}

const fenced = (module: string): string => '```js\n' + module.replace(/\s+$/, '') + '\n```'

export function firstPrompt(request: string): string {
  return `Request: ${request.trim()}`
}

/** The second and later calls: the request, what was answered, and what the engine measured when it built that. */
export function correctionPrompt(request: string, module: string, review: string, why: string | null = null): string {
  return (
    `Request: ${request.trim()}\n\nYou answered with this module:\n${fenced(module)}\n\n` +
    `The engine built it and measured every step. Its review:\n${clipReview(review)}\n\n` +
    (why !== null ? `${why}\n\n` : '') +
    'Answer with the complete corrected module in one js code block. Fix exactly what the review reports; keep everything else as it is.'
  )
}

/** A change to a scene that exists: the module as it is, and what to change. */
export function editPrompt(request: string, module: string): string {
  return `This scene exists:\n${fenced(module)}\n\nChange it: ${request.trim()}\n\nAnswer with the complete changed module in one js code block. Change only what the request asks for.`
}

/** What a version of the scene is worth: fewer errors first, then a story at all, then fewer composition findings. */
export interface Score { errors: number; steps: number; flags: number; warnings: number }
/** Is `a` at least as good as `b`? (a later version wins a tie: it is the one that answered the review) */
export function atLeastAsGood(a: Score, b: Score): boolean {
  if (a.errors !== b.errors) return a.errors < b.errors
  if ((a.steps === 0) !== (b.steps === 0)) return a.steps > 0
  if (a.flags !== b.flags) return a.flags < b.flags
  return a.warnings <= b.warnings
}
export const needsCorrection = (s: Score): boolean => s.errors > 0 || s.steps === 0 || s.flags > 0

/** Tokens and calls of several replies together; a kind nobody reported stays null. */
export function sumUsage(replies: ReadonlyArray<Pick<WriterReply, 'usage'>>): Usage | null {
  const known = replies.map((r) => r.usage).filter((u): u is Usage => u !== null)
  if (!known.length) return null
  const add = (pick: (u: Usage) => number | null): number | null => {
    const v = known.map(pick).filter((x): x is number => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) : null
  }
  return { api_calls: replies.length, input: add((u) => u.input), cache_write: add((u) => u.cache_write), cache_read: add((u) => u.cache_read), output: add((u) => u.output), thinking: add((u) => u.thinking), total: add((u) => u.total) }
}

// ── which model writes ───────────────────────────────────────────────────────────────────────────

export interface WriterSelection { adapter: AgentAdapter; writer: Writer; detection: Detection; source: 'flag' | 'env' | 'config' | 'detected' }

/**
 * Choose the writer of a run: --agent, then MIMIR_AGENT, then mimir.config.json (agent.name), then the first
 * adapter whose writer detect() finds on this machine (a configured writer command first, then the installed
 * command lines in alphabetical order). No vendor is preferred and none is required.
 */
export function selectWriter(flag: string | null, env: Env, config: ReturnType<typeof loadConfig>['agent']): WriterSelection {
  const fromEnv = env.MIMIR_AGENT !== undefined && env.MIMIR_AGENT !== '' ? env.MIMIR_AGENT : null
  const named = flag ?? fromEnv ?? config.name ?? null
  const source: WriterSelection['source'] = flag !== null ? 'flag' : fromEnv !== null ? 'env' : config.name !== undefined ? 'config' : 'detected'
  if (named !== null) {
    const adapter = adapterByName(named)
    if (!adapter) {
      const near = suggest(named, adapterNames())
      const message = `unknown agent "${named}"` + (near.length ? `; did you mean ${near.join(', ')}?` : '') + ` (agents: ${adapterNames().join(', ')})`
      if (source === 'flag') throw new UsageError(message, 'new')
      throw new CliError(`${message}, named by ${source === 'env' ? 'MIMIR_AGENT' : 'agent.name in mimir.config.json'}`)
    }
    if (!adapter.writer) throw new CliError(`mimir new: the ${adapter.name} agent cannot answer as plain text, so it cannot write once. Run it with --loop, or name another agent. Nothing was generated.`)
    const detection = adapter.writer.detect(env, config)
    if (!detection.available) throw new CliError(`mimir new --agent ${adapter.name}: ${detection.why}. Nothing was generated.`)
    return { adapter, writer: adapter.writer, detection, source }
  }
  const rows: string[] = []
  for (const adapter of ADAPTERS) {
    if (!adapter.writer) continue
    const detection = adapter.writer.detect(env, config)
    if (detection.available) return { adapter, writer: adapter.writer, detection, source }
    rows.push(`  ${adapter.name}: ${detection.why}`)
  }
  throw new CliError(`mimir new needs a model that answers in text, and none was found on this machine:\n${rows.join('\n')}\nNothing was generated.`)
}

export interface PreparedOnce {
  request: GenerateRequest
  selection: WriterSelection
  options: AgentOptions
  /** the page: the whole system text of every call */
  system: string
  /** does the page teach explain()? */
  quick: boolean
  size: ConceptSize
  fixRounds: number
  timeoutS: number
  /** absolute path of an existing scene to change, or null for a new one */
  edit: string | null
}

const wholeAtLeast = (text: string | undefined, name: string, least: number): number | null => {
  if (text === undefined || text === '') return null
  const n = Number(text)
  if (!Number.isInteger(n) || n < least) throw new CliError(`${name} must be a whole number of at least ${least} (got "${text}")`)
  return n
}

/** Everything that can be wrong before the model is called is found here: the writer, the page, the file to change. */
export function prepareOnce(request: GenerateRequest): PreparedOnce {
  const { env, root } = request
  const config = loadConfig(request.cwd, env)
  const selection = selectWriter(request.agent, env, config.agent)
  const { adapter, detection } = selection
  const named = request.instructions ?? (env.MIMIR_GEN_SYSTEM && env.MIMIR_GEN_SYSTEM !== '' ? env.MIMIR_GEN_SYSTEM : null)
  let system: string
  let systemFile: string
  let quick = false
  if (named !== null) {
    systemFile = resolve(request.cwd, named)
    if (!existsSync(systemFile) || !statSync(systemFile).isFile()) throw new CliError(`mimir new: the instructions ${systemFile} do not exist (--system / MIMIR_GEN_SYSTEM). Nothing was generated.`)
    system = readFileSync(systemFile, 'utf8')
  } else {
    const page = oncePage(root, env.MIMIR_TYPES && env.MIMIR_TYPES !== '' ? env.MIMIR_TYPES : join(root, 'types', 'mimir.d.ts'))
    if (page === null) throw new CliError('mimir new: this checkout has no page for a write-once call (skills/mimir/ONCE.md and PAGE.md). Give one with --system <file>, or run with --loop. Nothing was generated.')
    system = page.text
    systemFile = page.file
    quick = page.quick
  }
  const namedModel = request.model ?? (env.MIMIR_MODEL && env.MIMIR_MODEL !== '' ? env.MIMIR_MODEL : null) ?? config.agent.model ?? null
  if (request.fast === true && namedModel === null && !adapter.defaults.fastModel) throw new CliError(`--fast: the ${adapter.name} adapter names no cheap model. Name one with --model. Nothing was generated.`)
  const workdir = resolve(request.cwd, request.workdir)
  const edit = request.edit != null ? resolve(request.cwd, request.edit) : null
  if (edit !== null && (!existsSync(edit) || !statSync(edit).isFile())) throw new CliError(`mimir new --edit: no scene file ${edit}. Nothing was changed.`)
  const budget = request.budgetUsd ?? (() => { const t = env.MIMIR_BUDGET_USD; if (t === undefined || t === '') return null; const n = Number(t); if (!Number.isFinite(n) || n <= 0) throw new CliError(`MIMIR_BUDGET_USD must be a number greater than 0 (got "${t}")`); return n })() ?? config.agent.budgetUsd ?? adapter.defaults.budgetUsd
  const options: AgentOptions = {
    model: namedModel ?? (request.fast === true ? adapter.defaults.fastModel! : adapter.defaults.model),
    effort: request.effort ?? (env.MIMIR_EFFORT && env.MIMIR_EFFORT !== '' ? env.MIMIR_EFFORT : null) ?? config.agent.effort ?? adapter.defaults.writeEffort ?? null,
    maxTurns: 1, budgetUsd: budget, instructionsFile: systemFile, instructions: system, lean: true, resume: null,
    sessionId: env.MIMIR_SESSION && env.MIMIR_SESSION !== '' ? env.MIMIR_SESSION : randomUUID(),
    binDir: join(root, 'bin'), skillDir: null, pluginDir: null, binary: detection.binary, commandTemplate: null,
    writerTemplate: writerTemplate(env, config.agent), extraArgs: [], env,
  }
  return {
    request: { ...request, workdir }, selection, options, system, quick,
    size: request.size ?? sizeFromPrompt(request.prompt),
    fixRounds: request.fixRounds ?? wholeAtLeast(env.MIMIR_FIX_ROUNDS, 'MIMIR_FIX_ROUNDS', 0) ?? DEFAULT_FIX_ROUNDS,
    timeoutS: request.timeout ?? config.agent.timeout ?? WRITER_TIMEOUT_S,
    edit,
  }
}

// ── one call of the model ────────────────────────────────────────────────────────────────────────

export interface CallResult extends WriterReply { wallMs: number }

/** Start the writer's command, hand it its stdin, and read everything it prints. It gets a process group of its own, so that it can be stopped whole. */
export function runWriter(cmd: AgentCommand, o: { cwd: string; env: Env; binDir: string; timeoutS: number; onCleanup?: GenerateHooks['onCleanup']; now?: () => number }): Promise<{ stdout: string; stderrTail: string; code: number | null; wallMs: number; stopped: string | null }> {
  const now = o.now ?? Date.now
  const began = now()
  return new Promise((done, fail) => {
    const child = spawn(cmd.argv[0]!, cmd.argv.slice(1), {
      cwd: o.cwd, env: { ...(o.env as Record<string, string>), PATH: pathWith(o.binDir, o.env), ...cmd.env },
      stdio: [cmd.stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    })
    const signal = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) return
      try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch { /* gone */ } }
    }
    const removeCleanup = o.onCleanup?.(() => signal('SIGKILL')) ?? (() => {})
    let stopped: string | null = null
    const timer = setTimeout(() => {
      stopped = `the model did not answer within ${o.timeoutS} s (--timeout)`
      signal('SIGTERM')
      setTimeout(() => signal('SIGKILL'), STOP_GRACE_MS).unref()
    }, o.timeoutS * 1000)
    let stdout = ''
    let stderrTail = ''
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr!.on('data', (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-2000) })
    if (cmd.stdin !== null && child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(cmd.stdin) }
    child.once('error', (e) => { clearTimeout(timer); removeCleanup(); fail(new CliError(`could not start the model's command (${cmd.argv[0]}): ${e.message}. Nothing was generated.`)) })
    child.once('close', (code) => { clearTimeout(timer); removeCleanup(); done({ stdout, stderrTail, code, wallMs: Math.round(now() - began), stopped }) })
  })
}

/** What the engine says about a scene file (the linter and the composition findings, as text and as counts). */
export interface OnceReview extends Score { ok: boolean; text: string }

export interface OnceDeps {
  /** one call of the model */
  write(system: string, prompt: string): Promise<CallResult>
  /** build the scene and measure it; throws when the browser could not be reached */
  review(scenePath: string): Promise<OnceReview>
  /** render a contact sheet of the scene into outDir and answer its path */
  sheet(scenePath: string, outDir: string): Promise<string>
}

/** The real `write`: the selected writer's command line, run in the working directory. */
export function writerCall(p: PreparedOnce, hooks: Pick<GenerateHooks, 'onCleanup' | 'now'>): OnceDeps['write'] {
  return async (system, prompt) => {
    const cmd = p.selection.writer.command(system, prompt, p.options)
    if (cmd.argv.length === 0 || cmd.argv[0] === '') throw new CliError(`the ${p.selection.adapter.name} writer has an empty command line. Nothing was generated.`)
    const ran = await runWriter(cmd, { cwd: p.request.workdir, env: p.request.env, binDir: p.options.binDir, timeoutS: p.timeoutS, onCleanup: hooks.onCleanup, now: hooks.now })
    const reply = p.selection.writer.parse(ran.stdout, ran.code, ran.stderrTail)
    return { ...reply, error: ran.stopped ?? reply.error, wallMs: ran.wallMs }
  }
}

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

const tokensOf = (r: Pick<WriterReply, 'usage'>): number | null => r.usage?.total ?? null

export async function generateOnce(p: PreparedOnce, deps: OnceDeps, hooks: GenerateHooks): Promise<NewResult> {
  const { adapter, writer } = p.selection
  const workdir = p.request.workdir
  const now = hooks.now ?? Date.now
  const began = now()
  mkdirSync(workdir, { recursive: true })
  const scene = p.edit ?? freeScenePath(workdir, sceneNameFromPrompt(p.request.prompt))
  const name = basename(scene).replace(/\.scene\.m?js$/i, '')
  let runDir: string | null = join(dirname(scene), RUN_DIR, p.options.sessionId)
  try { mkdirSync(runDir, { recursive: true }) } catch { runDir = null }
  const keep = (file: string, text: string): void => { if (runDir !== null) { try { writeFileSync(join(runDir, file), text) } catch { /* the run matters more than its record */ } } }
  const original = p.edit !== null ? readFileSync(p.edit, 'utf8') : null
  if (p.edit !== null && runDir !== null) { try { copyFileSync(p.edit, join(runDir, 'before-edit.scene.js')) } catch { /* as above */ } }

  hooks.log(`write once: ${adapter.name}${writer.status === 'untested' ? ' (untested writer)' : ''}, model ${p.options.model ?? 'its own default'}${p.options.effort ? `, effort ${p.options.effort}` : ''}, one page of ${Buffer.byteLength(p.system)} bytes${p.quick ? ' (explain)' : ''}, at most ${p.fixRounds} correction${p.fixRounds === 1 ? '' : 's'}; ${p.edit !== null ? 'changing' : 'writing'} ${scene}`)
  hooks.emit({ event: 'start', stage: 'writing', agent: adapter.name, model: p.options.model, session: null, workdir })

  const replies: CallResult[] = []
  const calls: NonNullable<NewResult['calls']> = []
  const notes: string[] = []
  let error: string | null = null
  let model: string | null = p.options.model
  let best: { module: string; review: OnceReview } | null = null
  let last: { module: string; review: OnceReview } | null = null
  let firstClean: boolean | null = null
  let reviews = 0
  let writes = 0
  let cost = 0
  let prompt = original !== null ? editPrompt(p.request.prompt, original) : firstPrompt(p.request.prompt)

  for (let round = 0; round <= p.fixRounds; round++) {
    hooks.emit({ event: 'stage', stage: round === 0 ? 'writing' : 'fixing', round, elapsed_ms: Math.round(now() - began) })
    let reply: CallResult
    try {
      reply = await deps.write(p.system, prompt)
    } catch (e) {
      if (best === null) throw e
      notes.push(`correction ${round} could not be asked for: ${(e as Error).message.split('\n')[0]}`)
      break
    }
    replies.push(reply)
    model = reply.model ?? model
    cost += reply.costUsd ?? 0
    keep(`call-${round + 1}.reply.txt`, reply.text)
    const { module, cut } = reply.error === null ? extractModule(reply.text) : { module: null, cut: false }
    const call = { seconds: Math.round(reply.wallMs / 100) / 10, tokens: tokensOf(reply), cost_usd: reply.costUsd, errors: -1, flags: -1 }
    calls.push(call)
    hooks.emit({ event: 'log', stage: round === 0 ? 'writing' : 'fixing', line: `call ${round + 1}: ${call.seconds.toFixed(1)} s${call.tokens !== null ? `, ${call.tokens} tokens` : ''}${call.cost_usd !== null ? `, $${call.cost_usd.toFixed(4)}` : ''}` })
    if (module === null) {
      const why = reply.error ?? 'the model answered without a module (no js code block with an `export default`)'
      if (best === null) { error = why; break }
      notes.push(`correction ${round} was not usable: ${why}`)
      break
    }
    if (cut) notes.push(`the answer of call ${round + 1} stopped inside its code block: the module may be incomplete`)
    writeFileSync(scene, module)
    writes++
    hooks.emit({ event: 'tool', stage: round === 0 ? 'writing' : 'fixing', name: 'write', summary: scene })
    hooks.emit({ event: 'stage', stage: 'checking', round, elapsed_ms: Math.round(now() - began) })
    let review: OnceReview
    try {
      review = await attempt(() => deps.review(scene), hooks.log, 'the review of the scene')
    } catch (e) {
      error = `the scene could not be reviewed: ${(e as Error).message.split('\n')[0]}`
      last = null
      break
    }
    reviews++
    keep(`call-${round + 1}.review.txt`, review.text)
    call.errors = review.errors
    call.flags = review.flags
    hooks.emit({ event: 'check', stage: 'checking', round: reviews, ok: review.ok, errors: review.errors, warnings: review.warnings })
    if (firstClean === null) firstClean = !needsCorrection(review)
    last = { module, review }
    if (best === null || atLeastAsGood(review, best.review)) best = last
    if (!needsCorrection(review)) break
    if (round === p.fixRounds) break
    if (cost >= p.options.budgetUsd) { notes.push(`no further correction: the cost so far ($${cost.toFixed(4)}) reached the ceiling ($${p.options.budgetUsd}; raise it with --budget-usd)`); break }
    const why = review.steps === 0 && review.errors === 0 ? 'The scene has no steps: an explainer is a story, told step by step.' : null
    prompt = correctionPrompt(p.request.prompt, module, review.text, why)
  }

  // the best version seen stays on disk
  if (best !== null && last !== null && best !== last) {
    writeFileSync(scene, best.module)
    notes.push('the last correction did not improve the scene: the better earlier version was kept')
  }
  if (best === null && original !== null) writeFileSync(scene, original) // a change that produced nothing leaves the file as it was

  let sheet: string | null = null
  const final = best?.review ?? null
  if (final !== null) {
    if (final.errors > 0) error ??= `the scene has ${final.errors} error${final.errors === 1 ? '' : 's'} after ${replies.length - 1} correction${replies.length - 1 === 1 ? '' : 's'}: run mimir review ${scene}`
    else if (final.steps === 0) error ??= `the scene builds but tells no story (no steps): run mimir review ${scene}`
    if (final.warnings > 0) notes.push(`the scene has ${final.warnings} warning${final.warnings === 1 ? '' : 's'}: run mimir check ${scene}`)
    if (final.flags > 0) notes.push(`mimir review still has ${final.flags} composition finding${final.flags === 1 ? '' : 's'}: run mimir review ${scene}`)
    try {
      sheet = await attempt(() => deps.sheet(scene, join(dirname(scene), '.mimir', 'new', name)), hooks.log, 'the contact sheet of the result')
    } catch (e) {
      notes.push(`no contact sheet: ${(e as Error).message.split('\n')[0]}`)
    }
    notes.push('written once: no model looked at the frames; the engine built the scene and measured every step (open the sheet, or run with --loop for an agent that looks)')
  }
  if (writer.status === 'untested') notes.push(`the ${adapter.name} writer is untested`)
  const usage = sumUsage(replies)
  const overBudget = cost > p.options.budgetUsd
  const ok = error === null && best !== null
  const exists = best !== null || original !== null
  const result: NewResult = {
    event: 'result', stage: ok ? 'ready' : 'failed', ok, scene: exists ? scene : null,
    check: final !== null ? { ok: final.ok, errors: final.errors, warnings: final.warnings, flags: final.flags } : null,
    sheet, storyboard: null, looked: false, rounds: { check: reviews, look: 0, edit: writes }, shots: { sheet: 0, cues: 0, fine: 0, frames: 0 },
    agent: adapter.name, model, session: null, turns: replies.length, cost_usd: replies.some((r) => r.costUsd !== null) ? cost : null, ...(overBudget ? { over_budget: true as const } : {}),
    duration_ms: replies.some((r) => r.durationMs !== null) ? replies.reduce((a, r) => a + (r.durationMs ?? 0), 0) : null, wall_ms: Math.round(now() - began), denials: 0,
    error: ok ? null : error ?? 'no scene was written', notes,
    verdict: !ok ? 'failed' : (final?.flags ?? 0) > 0 ? 'ready-with-flags' : 'ready', size: p.size, lean: true, mode: 'once', calls, usage,
    first_review_clean: firstClean, flags: final?.flags ?? null, scene_lines: best !== null ? best.module.replace(/\n+$/, '').split('\n').length : null, run_dir: runDir,
  }
  keep(USAGE_FILE, JSON.stringify({ prompt: p.request.prompt, ...result }, null, 2) + '\n')
  hooks.emit(result)
  return result
}
