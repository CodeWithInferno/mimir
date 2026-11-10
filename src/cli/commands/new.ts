// mimir new "<prompt>" [-o dir] [--agent name] [--model id] [--max-turns n] [--budget-usd x] [--system file] [--resume id] [--timeout s]
//
// Starts a headless coding agent that follows the authoring loop of the mimir skill with this CLI, prints where the
// run is as NDJSON (stage: storyboard | writing | checking | looking | fixing | ready | failed) and ends with one
// result line: the scene, what `mimir check` says about it, and a contact sheet of it.
//
// The engine calls no model. Which agent runs is an adapter (src/cli/agents): chosen by --agent, MIMIR_AGENT,
// mimir.config.json, or the first one found on this machine. What the agent claims is not taken on trust: the scene
// file must exist, the check is run here, and the sheet is rendered here from the final file. A run that stops
// without a clean check says `failed`, and why.
import type { NewOptions } from '../args.ts'
import { COMMANDS, parseFlags, toOpenOptions, toShotOptions } from '../args.ts'
import { CliError, UsageError } from '../errors.ts'
import { generate, prepare, type GenerateHooks, type GenerateRequest, type Verifier } from '../agents/generate.ts'
import type { NewMode } from '../agents/limits.ts'
import { generateOnce, prepareOnce, writerCall, type OnceDeps } from '../agents/once.ts'
import type { NewResult, Progress } from '../agents/types.ts'
import { onCleanup } from '../chrome.ts'
import type { Io } from '../io.ts'
import { ROOT } from '../paths.ts'
import { REVIEW_LIMITS, resolveNewMode } from '../lean-specs.ts'
import { open as openScene } from './open.ts'
import { formatReviewText, reviewScene } from './review.ts'
import { shot } from './shot.ts'

/** Check and render with this CLI's own commands, in this process, saying nothing on stdout. */
export function cliVerifier(io: Io): Verifier {
  const quiet: Io = { ...io, log: () => {} }
  return {
    async check(scenePath) {
      // the linter and the composition findings in one browser session (what `mimir review` prints, without a sheet)
      const { result } = await reviewScene({ scene: scenePath, sheet: false, out: null, limits: { ...REVIEW_LIMITS }, json: false, noSheet: true }, quiet)
      return { ok: result.ok, errors: result.errors, warnings: result.warnings, flags: result.flags.length }
    },
    async sheet(scenePath, outDir) {
      let printed = ''
      const capture: Io = { ...quiet, json: true, out: (text) => { printed += text } }
      const code = await shot(toShotOptions(parseFlags(COMMANDS.shot!, [scenePath, '--sheet', '--out', outDir, '--json'])), capture)
      const entries = JSON.parse(printed) as Array<{ path?: unknown; sheet?: unknown }>
      const sheet = Array.isArray(entries) ? entries.find((e) => e !== null && typeof e === 'object' && e.sheet !== undefined && typeof e.path === 'string') : undefined
      if (!sheet) throw new Error(`mimir shot --sheet wrote no sheet (exit ${code})`)
      return sheet.path as string
    },
  }
}

/** What a write-once generation needs from this CLI: the review of a scene as counts and as text, and a sheet. */
export function cliOnceDeps(io: Io): Pick<OnceDeps, 'review' | 'sheet'> {
  const quiet: Io = { ...io, log: () => {} }
  return {
    async review(scenePath) {
      const limits = { ...REVIEW_LIMITS }
      const { result, info, ctx, kinds } = await reviewScene({ scene: scenePath, sheet: false, out: null, limits, json: false, noSheet: true }, quiet)
      return { ok: result.ok, errors: result.errors, warnings: result.warnings, flags: result.flags.length, steps: result.steps.length, text: formatReviewText(result, info, ctx, kinds, limits) }
    },
    sheet: cliVerifier(io).sheet,
  }
}

/** One generation in the mode asked for: the same request, the same result line. */
export async function runGeneration(request: GenerateRequest, mode: NewMode, io: Io, hooks: GenerateHooks): Promise<NewResult> {
  if (mode === 'once') {
    const prepared = prepareOnce(request)
    return generateOnce(prepared, { write: writerCall(prepared, hooks), ...cliOnceDeps(io) }, hooks)
  }
  return generate(prepare(request), cliVerifier(io), hooks)
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** One line per event: JSON for a program, plain words for a person. */
export function printer(io: Pick<Io, 'json' | 'out'>): (e: Progress | NewResult) => void {
  if (io.json) return (e) => io.out(JSON.stringify(e) + '\n')
  return (e) => {
    if (e.event === 'start') io.out(`agent ${e.agent}${e.model ? ` (${e.model})` : ''} in ${e.workdir}\n`)
    else if (e.event === 'stage') io.out(`[${e.stage}]\n`)
    else if (e.event === 'tool') io.out(`  ${e.name}  ${e.summary}\n`)
    else if (e.event === 'check') io.out(`  check ${e.round}: ${e.ok ? 'OK' : 'FAIL'} ${plural(e.errors, 'error')}, ${plural(e.warnings, 'warning')}\n`)
    else if (e.event === 'look') io.out(`  looked at ${e.image}\n`)
    else if (e.event === 'text') io.out(`  … ${e.text}\n`)
    else if (e.event === 'denied') io.out(`  DENIED ${e.tool}  ${e.reason}\n`)
    else if (e.event === 'log') io.out(`  ${e.line}\n`)
    else {
      io.out(
        (e.ok ? `READY ${e.scene}` : `FAILED ${e.error ?? 'no scene'}${e.scene ? ` (${e.scene})` : ''}`) +
          (e.check ? `  check: ${plural(e.check.errors, 'error')}, ${plural(e.check.warnings, 'warning')}` : '') +
          (e.mode === 'once' ? `  written once: ${plural(e.turns ?? 0, 'call')}` : `  rounds: ${e.rounds.check} check, ${e.rounds.look} look`) +
          (e.turns !== null && e.mode !== 'once' ? `  ${plural(e.turns, 'turn')}` : '') + (e.cost_usd !== null ? `  $${e.cost_usd.toFixed(4)}` : '') + `  ${(e.wall_ms / 1000).toFixed(0)} s\n` +
          (e.usage ? `tokens: ${e.usage.total ?? '?'} (cache read ${e.usage.cache_read ?? '?'}, cache write ${e.usage.cache_write ?? '?'}, input ${e.usage.input ?? '?'}, output ${e.usage.output ?? '?'})  api calls: ${e.usage.api_calls ?? '?'}\n` : '') +
          `verdict: ${e.verdict}${e.first_review_clean !== null ? `  first review clean: ${e.first_review_clean ? 'yes' : 'no'}` : ''}\n` +
          (e.sheet ? `sheet: ${e.sheet}\n` : '') + e.notes.map((n) => `note: ${n}\n`).join('') +
          (e.ok && e.scene ? `watch: mimir open ${e.scene}\n` : ''),
      )
    }
  }
}

export function requestOf(opts: NewOptions, io: Pick<Io, 'cwd' | 'env'>, root: string = ROOT): GenerateRequest {
  return {
    prompt: opts.prompt, workdir: opts.out ?? '.', cwd: io.cwd, env: io.env, root,
    agent: opts.agent, model: opts.model, maxTurns: opts.maxTurns, budgetUsd: opts.maxUsd, timeout: opts.timeout, instructions: opts.system, resume: opts.resume, size: opts.size, fast: opts.fast, full: opts.full,
    fixRounds: opts.fix, edit: opts.edit, effort: opts.effort,
  }
}

export async function newScene(opts: NewOptions, io: Io): Promise<number> {
  // everything that can be wrong before a model is called is a usage or setup error (exit 2), with nothing on stdout
  const asked = opts.mode !== null || (io.env.MIMIR_NEW_MODE !== undefined && io.env.MIMIR_NEW_MODE !== '')
  // --resume continues an agent's conversation: it says "loop" by itself
  let mode = opts.mode === null && opts.resume !== null ? 'loop' : resolveNewMode(opts.mode, io.env)
  if (mode === 'once' && opts.resume !== null) throw new UsageError('--resume continues an agent\'s conversation (--loop); to change a scene that was written once, use --edit <scene>', 'new')
  const hooks: GenerateHooks = {
    emit: printer(io),
    log: io.log,
    stderr: (chunk) => void process.stderr.write(chunk),
    onCleanup: (fn) => onCleanup(fn),
  }
  const request = requestOf(opts, io)
  if (mode === 'once' && !asked) {
    // nobody asked for one call: when no model here answers in text, the agent loop is the way that still works
    try { prepareOnce(request) } catch (e) {
      if (!(e instanceof CliError) || e instanceof UsageError) throw e
      io.log(`no model that answers in text was found (${e.message.split('\n')[0]}); running the agent loop instead (--loop)`)
      mode = 'loop'
    }
  }
  const result = await runGeneration(request, mode, io, hooks)
  if (opts.open && result.ok && result.scene !== null) {
    await openScene(toOpenOptions(parseFlags(COMMANDS.open!, [result.scene])), io)
  }
  return result.ok ? 0 : 1
}
