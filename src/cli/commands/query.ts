// mimir query <scene> distance <a> <b> | contacts [id] | bounds <id> | visible <id> | state | probes
//                    [--at t | --at name=value | --step k] [--set name=value ...] [--tolerance x]
//
// Verify a geometry claim instead of guessing it from a picture. The scene is brought to the asked moment, the
// frame is rendered, and the page answers (src/cli/pageside.ts): through the viewer's own __mimir.query() when it
// has one, otherwise from the frame state. Every answer says what it is based on and what it does not prove; a
// viewer that can answer neither way is an error, never a made-up number.
import type { QueryOptions } from '../args.ts'
import { CliError, UsageError, suggest } from '../errors.ts'
import { fatalToDiag, formatDiagText, formatSeconds } from '../format.ts'
import type { Io } from '../io.ts'
import { planFrames, stepAt } from '../manifest.ts'
import { frameExpression, queryExpression } from '../pageside.ts'
import { checkSets, resolveParamTime } from '../params.ts'
import { ensureViewer, resolveScene } from '../paths.ts'
import { openSession, timeoutFromEnv } from '../session.ts'

/** stage size the scene is measured at (screen rectangles and pixel counts are in px of this stage) */
export const QUERY_STAGE = { width: 1280, height: 720 }

interface PageAnswer {
  source?: string
  result?: Record<string, unknown>
  unavailable?: string
  error?: 'no-part' | 'no-anchor' | 'needs-part'
  ref?: string
  id?: string
  anchor?: string
  anchors?: string[]
  ids?: string[]
}

export async function query(opts: QueryOptions, io: Io): Promise<number> {
  const scene = resolveScene(opts.scene, io.cwd, 'query')
  const viewer = await ensureViewer(io.env, io.log)
  const session = await openSession({ scene, viewerRoot: viewer.dir, width: QUERY_STAGE.width, height: QUERY_STAGE.height, scale: 1, log: io.log })
  let out: Record<string, unknown>
  try {
    const info = session.info
    if (info.fatal) {
      process.stderr.write(formatDiagText(fatalToDiag(info.fatal, scene.url), [], { sceneDir: scene.dir, cwd: io.cwd }) + '\n')
      io.log('nothing measured: the scene failed to load (see mimir check)')
      return 1
    }
    checkSets(info, opts.sets, 'query')
    // when: --at t, --at name=value, --step k; by default the end of the last step
    let t: number
    try {
      if (opts.at?.kind === 'param') t = await resolveParamTime(session, info, opts.at, opts.sets, 'query')
      else if (opts.at) t = planFrames(info, { kind: 'at', items: [opts.at] })[0]!.t
      else if (opts.step !== null) t = planFrames(info, { kind: 'step', step: opts.step })[0]!.t
      else t = planFrames(info, { kind: 'steps' }).at(-1)!.t
    } catch (e) {
      // the planner speaks for `shot`; the same mistake here is a mistake of `query`
      if (e instanceof UsageError) throw new UsageError(e.message, 'query')
      throw e
    }
    const timeoutMs = timeoutFromEnv()
    await session.page.evaluate(frameExpression(t, opts.sets, null), timeoutMs)
    let answer: PageAnswer
    try {
      answer = JSON.parse(await session.page.evaluate<string>(queryExpression({ what: opts.what, ids: opts.args, tolerance: opts.tolerance }), timeoutMs)) as PageAnswer
    } catch (e) {
      throw new CliError(`query ${opts.what} failed in the page: ${(e as Error).message}`)
    }
    if (answer.error === 'no-part') {
      const ids = answer.ids ?? info.parts.map((p) => p.id)
      const near = suggest(answer.ref ?? '', ids)
      throw new UsageError(
        `query ${opts.what}: the scene has no part "${answer.ref}"` + (near.length ? `; did you mean ${near.join(', ')}?` : '') +
          ` (parts: ${ids.slice(0, 40).join(', ') || 'none'}${ids.length > 40 ? `, … ${ids.length - 40} more` : ''})`,
        'query',
      )
    }
    if (answer.error === 'no-anchor') {
      const near = suggest(answer.anchor ?? '', answer.anchors ?? [])
      throw new UsageError(`query ${opts.what}: #${answer.id} has no point "${answer.anchor}"` + (near.length ? `; did you mean ${near.join(', ')}?` : '') + ` (points: ${(answer.anchors ?? []).join(', ')})`, 'query')
    }
    if (answer.error === 'needs-part') throw new UsageError(`query ${opts.what} takes a part, not a point of one (got "${answer.ref}")`, 'query')
    // the viewer's own answer to a request it cannot serve: what is wrong and what to write instead
    const refused = answer.result as { error?: unknown; fix?: unknown } | undefined
    if (refused && typeof refused.error === 'string') {
      const fix = Array.isArray(refused.fix) ? refused.fix.filter((f): f is string => typeof f === 'string') : []
      throw new UsageError(`query ${opts.what}: ${refused.error}${fix.length ? ` ${fix.join('; ')}` : ''}`, 'query')
    }
    if (answer.unavailable || !answer.result) {
      throw new CliError(`query ${opts.what} cannot be answered: ${answer.unavailable ?? 'the page returned nothing'}. Nothing was measured.`)
    }
    const step = stepAt(info.steps, t)
    out = {
      query: opts.what,
      ...(opts.args.length ? { ids: opts.args } : {}),
      scene: scene.file,
      t,
      step: step ? step.index : null,
      ...(opts.sets.length ? { set: Object.fromEntries(opts.sets.map((s) => [s.name, s.value])) } : {}),
      ...(opts.at?.kind === 'param' ? { at: { [opts.at.name]: opts.at.value } } : {}),
      source: answer.source ?? 'viewer',
      ...answer.result,
      ...(viewer.stale ? { stale: true } : {}),
    }
    io.log(`measured at t=${formatSeconds(t)}s${step ? ` (step ${step.index} "${step.title}")` : ''}`)
  } finally {
    await session.close()
  }
  // JSON either way: compact for a pipe, indented for a person
  io.out((io.json ? JSON.stringify(out) : JSON.stringify(out, null, 2)) + '\n')
  return 0
}
