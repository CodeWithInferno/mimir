// Parameter addressing shared by shot, query and export: --set name=value is checked against what the scene
// declares, and --at name=value is turned into the story time at which the story has the parameter there.
import type { AtItem, ParamSet, ParamValue } from './args.ts'
import { CliError, UsageError, suggest } from './errors.ts'
import { formatSeconds, type ParamInfo, type SceneInfo } from './format.ts'
import { paramTimeExpression } from './pageside.ts'
import { timeoutFromEnv, type Session } from './session.ts'

/** Why a --set value cannot be a value of this param, or null. A host that does not say what kind a param is gets no check. */
export function setProblem(def: ParamInfo, value: ParamValue): string | null {
  if (def.kind === 'number') {
    if (typeof value !== 'number') return `"${def.name}" is a number from ${def.min} to ${def.max}`
    if (value < def.min || value > def.max) return `"${def.name}" goes from ${def.min} to ${def.max}`
  } else if (def.kind === 'toggle') {
    if (typeof value !== 'boolean') return `"${def.name}" is a toggle: true or false`
  } else if (def.kind === 'choice') {
    if (!def.options.includes(String(value))) return `"${def.name}" is one of: ${def.options.join(', ')}`
  }
  return null
}

function paramOf(info: SceneInfo, name: string, flag: string, command: string): ParamInfo {
  const def = info.params.find((p) => p.name === name)
  if (def) return def
  const known = info.params.map((p) => p.name)
  const near = suggest(name, known)
  throw new UsageError(
    `${flag} ${name}: the scene has no parameter "${name}"` + (near.length ? `; did you mean ${near.join(', ')}?` : '') + ` (parameters: ${known.length ? known.join(', ') : 'none'})`,
    command,
  )
}

/** Every --set must name a parameter of the scene and carry a value its slider could have: a typo is not a picture. */
export function checkSets(info: SceneInfo, sets: readonly ParamSet[], command: string): void {
  for (const s of sets) {
    const bad = setProblem(paramOf(info, s.name, '--set', command), s.value)
    if (bad) throw new UsageError(`--set ${s.name}=${String(s.value)}: ${bad}`, command)
  }
}

interface ParamTime { found: boolean; t?: number; actual?: ParamValue; reason?: string; from?: number | null; to?: number | null; seen?: string[] }

/**
 * Story time of `--at name=value`: the first moment the story itself brings the parameter to that value.
 * A parameter that is pinned with --set, or that the story never brings there, is a usage error that says what
 * the story does with it.
 */
export async function resolveParamTime(session: Session, info: SceneInfo, item: Extract<AtItem, { kind: 'param' }>, sets: readonly ParamSet[], command: string): Promise<number> {
  const flag = '--at'
  const def = paramOf(info, item.name, flag, command)
  const shown = `${flag} ${item.name}=${String(item.value)}`
  if (sets.some((s) => s.name === item.name)) {
    throw new UsageError(`${shown}: "${item.name}" is pinned with --set, so the story no longer moves it; drop one of the two`, command)
  }
  const bad = setProblem(def, item.value)
  if (bad) throw new UsageError(`${shown}: ${bad}`, command)
  let r: ParamTime
  try {
    r = JSON.parse(await session.page.evaluate<string>(paramTimeExpression(item.name, item.value), timeoutFromEnv())) as ParamTime
  } catch (e) {
    throw new CliError(`${shown}: looking for that moment failed: ${(e as Error).message}`)
  }
  if (r.found && typeof r.t === 'number') return r.t
  if (r.reason === 'no-state') throw new CliError(`${shown}: this viewer does not report parameter values over time (no __mimir.state()); use --at <seconds> with --set ${item.name}=${String(item.value)}`)
  const range = typeof r.from === 'number' && typeof r.to === 'number'
    ? r.from === r.to ? `the story keeps it at ${r.from}` : `the story takes it from ${r.from} to ${r.to}`
    : r.seen?.length ? `the story only has it at ${r.seen.join(', ')}` : 'the story never changes it'
  throw new UsageError(
    `${shown}: the story never brings "${item.name}" to ${String(item.value)} (${range} over ${formatSeconds(info.duration)}s). ` +
      `To see that value anyway, pin it: --set ${item.name}=${String(item.value)}`,
    command,
  )
}
