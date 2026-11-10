// mimir.config.json: the project's settings. This file reads the `agent` section only (other sections belong to
// other commands and are left alone). The file is looked for in the working directory and then in each directory
// above it; MIMIR_CONFIG names one directly.
//
//   { "agent": { "name": "command", "command": "my-agent --prompt {request}", "model": "…", "maxTurns": 60,
//                "budgetUsd": 3, "timeout": 1800, "args": ["--flag"], "instructions": "docs/generator.md" } }
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { CliError, suggest } from '../errors.ts'
import type { AgentConfig, Env } from './types.ts'

export const CONFIG_FILE = 'mimir.config.json'

const FIELDS: Record<keyof AgentConfig, 'string' | 'number' | 'strings'> = {
  name: 'string', model: 'string', effort: 'string', maxTurns: 'number', budgetUsd: 'number', timeout: 'number', command: 'string', writer: 'string', args: 'strings', instructions: 'string',
}

/** The config file that applies to a working directory, or null. */
export function findConfig(cwd: string, env: Env): string | null {
  const named = env.MIMIR_CONFIG
  if (named !== undefined && named !== '') {
    const path = resolve(cwd, named)
    if (!existsSync(path) || !statSync(path).isFile()) throw new CliError(`MIMIR_CONFIG points to a file that does not exist: ${path}`)
    return path
  }
  let dir = resolve(cwd)
  for (;;) {
    const path = join(dir, CONFIG_FILE)
    if (existsSync(path) && statSync(path).isFile()) return path
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/** Validate the `agent` section. A wrong field is an error that names the file: a typo must not silently do nothing. */
export function parseAgentConfig(text: string, file: string): AgentConfig {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new CliError(`${file} is not valid JSON: ${(e as Error).message}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new CliError(`${file} must hold a JSON object`)
  const section = (raw as Record<string, unknown>).agent
  if (section === undefined) return {}
  if (section === null || typeof section !== 'object' || Array.isArray(section)) throw new CliError(`${file}: "agent" must be an object`)
  const out: AgentConfig = {}
  for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
    const kind = (FIELDS as Record<string, string | undefined>)[key]
    if (kind === undefined) {
      const near = suggest(key, Object.keys(FIELDS))
      throw new CliError(`${file}: unknown field agent.${key}` + (near.length ? `; did you mean ${near.join(', ')}?` : '') + ` (fields: ${Object.keys(FIELDS).join(', ')})`)
    }
    if (kind === 'string') {
      if (typeof value !== 'string' || value.trim() === '') throw new CliError(`${file}: agent.${key} must be a non-empty string`)
      ;(out as Record<string, unknown>)[key] = value
    } else if (kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new CliError(`${file}: agent.${key} must be a number greater than 0`)
      if (key === 'maxTurns' && !Number.isInteger(value)) throw new CliError(`${file}: agent.maxTurns must be a whole number`)
      ;(out as Record<string, unknown>)[key] = value
    } else {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new CliError(`${file}: agent.${key} must be a list of strings`)
      ;(out as Record<string, unknown>)[key] = value
    }
  }
  return out
}

export interface LoadedConfig { file: string | null; agent: AgentConfig }

export function loadConfig(cwd: string, env: Env): LoadedConfig {
  const file = findConfig(cwd, env)
  if (file === null) return { file: null, agent: {} }
  return { file, agent: parseAgentConfig(readFileSync(file, 'utf8'), file) }
}
