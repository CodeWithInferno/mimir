// The agent adapters and how one is chosen.
//
// Order of choice: --agent, then MIMIR_AGENT, then mimir.config.json (agent.name), then the first adapter that
// detect() finds on this machine. The detection order is: `command` (present only when the user configured a command
// template, which is as explicit as a choice gets), then the installed command lines in alphabetical order. No vendor
// is preferred and none is required.
import { CliError, UsageError, suggest } from '../errors.ts'
import { claude } from './claude.ts'
import { codex } from './codex.ts'
import { command } from './command.ts'
import type { AgentAdapter, AgentConfig, Detection, Env } from './types.ts'

export * from './types.ts'
export * from './limits.ts'
export { claude, codex, command }

/** Every adapter, in detection order. */
export const ADAPTERS: readonly AgentAdapter[] = [command, claude, codex]
export const adapterNames = (): string[] => ADAPTERS.map((a) => a.name)
export const adapterByName = (name: string): AgentAdapter | undefined => ADAPTERS.find((a) => a.name === name)

export interface Selection {
  adapter: AgentAdapter
  detection: Detection
  /** where the choice came from */
  source: 'flag' | 'env' | 'config' | 'detected'
}

export interface DetectionRow { name: string; status: AgentAdapter['status']; describe: string; available: boolean; why: string }

/** What is on this machine, for a message or for `mimir new --agents`. */
export function detectAll(env: Env, config: AgentConfig): DetectionRow[] {
  return ADAPTERS.map((a) => {
    const d = a.detect(env, config)
    return { name: a.name, status: a.status, describe: a.describe, available: d.available, why: d.why }
  })
}

/** Choose the adapter of a run. A named adapter that is missing, or no adapter at all, is a setup error that says what to do. */
export function selectAdapter(flag: string | null, env: Env, config: AgentConfig): Selection {
  const fromEnv = env.MIMIR_AGENT !== undefined && env.MIMIR_AGENT !== '' ? env.MIMIR_AGENT : null
  const named = flag ?? fromEnv ?? config.name ?? null
  const source: Selection['source'] = flag !== null ? 'flag' : fromEnv !== null ? 'env' : config.name !== undefined ? 'config' : 'detected'
  if (named !== null) {
    const adapter = adapterByName(named)
    if (!adapter) {
      const near = suggest(named, adapterNames())
      const message = `unknown agent "${named}"` + (near.length ? `; did you mean ${near.join(', ')}?` : '') + ` (agents: ${adapterNames().join(', ')})`
      if (source === 'flag') throw new UsageError(message, 'new')
      throw new CliError(`${message}, named by ${source === 'env' ? 'MIMIR_AGENT' : 'agent.name in mimir.config.json'}`)
    }
    const detection = adapter.detect(env, config)
    if (!detection.available) throw new CliError(`mimir new --agent ${adapter.name}: ${detection.why}. Nothing was generated.`)
    return { adapter, detection, source }
  }
  const rows: string[] = []
  for (const adapter of ADAPTERS) {
    const detection = adapter.detect(env, config)
    if (detection.available) return { adapter, detection, source }
    rows.push(`  ${adapter.name}: ${detection.why}`)
  }
  throw new CliError(`mimir new needs a coding agent, and none was found on this machine:\n${rows.join('\n')}\nNothing was generated.`)
}
