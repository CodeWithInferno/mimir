// Small pure helpers shared by the adapters: one-line summaries, the RESULT line, command-line splitting.
import { delimiter } from 'node:path'
import type { Env } from './types.ts'

/** longest text of one progress event; the full text stays with the agent */
export const EVENT_TEXT_MAX = 400

export const clip = (s: string, max = EVENT_TEXT_MAX): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)
export const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim()

/** What a tool call is about, in one line: the command of a shell call, the file of a read / write / edit, … */
export function toolSummary(name: string, input: unknown): string {
  const o = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  for (const key of ['command', 'file_path', 'path', 'skill', 'pattern', 'url', 'description']) {
    if (typeof o[key] === 'string' && o[key] !== '') return clip(oneLine(o[key] as string))
  }
  const first = Object.values(o).find((v) => typeof v === 'string' && v !== '')
  return typeof first === 'string' ? clip(oneLine(first)) : name
}

/** The `RESULT <scene path> [<sheet png path>]` line a generator ends with (the last one wins), or null. */
export function parseResultLine(text: string): { scene: string; sheet: string | null } | null {
  const lines = text.split('\n').map((l) => l.trim().replace(/^[`*]+|[`*]+$/g, '')).filter((l) => /^RESULT\s+\S/.test(l))
  const last = lines[lines.length - 1]
  if (!last) return null
  const rest = last.replace(/^RESULT\s+/, '')
  // two paths separated by white space; a path may itself contain spaces, so split at the scene file's extension
  const m = /^(.*?\.m?js)(?:\s+(.*\.png))?\s*$/i.exec(rest)
  if (m) return { scene: m[1]!.trim(), sheet: m[2] ? m[2].trim() : null }
  const parts = rest.split(/\s+/)
  return { scene: parts[0]!, sheet: parts[1] ?? null }
}

/** Split a command line the way a shell would for plain words and quotes (no expansion, no operators). */
export function splitCommand(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let has = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i]
      else cur += c
    } else if (c === '"' || c === "'") { quote = c; has = true }
    else if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true }
    else if (/\s/.test(c)) { if (has || cur !== '') out.push(cur); cur = ''; has = false }
    else cur += c
  }
  if (has || cur !== '') out.push(cur)
  return out
}

/** characters kept from the start and from the end of a tool's output (a status is in its first or its last line) */
export const OUTPUT_HEAD = 600
export const OUTPUT_TAIL = 4000

/** The start and the end of a long output. */
export function clipOutput(text: string): string {
  return text.length <= OUTPUT_HEAD + OUTPUT_TAIL ? text : `${text.slice(0, OUTPUT_HEAD)}\n…\n${text.slice(-OUTPUT_TAIL)}`
}

/** PATH with a directory in front. */
export const pathWith = (dir: string, env: Env): string => [dir, env.PATH ?? ''].filter((p) => p !== '').join(delimiter)

/** The first executable of that name on PATH, or null. */
export const which = (name: string, env: Env): string | null => Bun.which(name, { PATH: env.PATH ?? '' })

/** JSON.parse that answers null for anything that is not a JSON object. */
export function parseObject(text: string): Record<string, any> | null {
  try {
    const v = JSON.parse(text) as unknown
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null
  } catch {
    return null
  }
}

/**
 * The request for an agent that has no way to take instructions apart from its prompt: the headless instructions,
 * where the skill is, then the request itself.
 */
export function withInstructions(prompt: string, o: { instructions: string; skillDir: string | null }): string {
  const skill = o.skillDir ? `The mimir skill is the folder ${o.skillDir}. Read ${o.skillDir}/SKILL.md now, before anything else, and follow it.\n\n` : ''
  return `${o.instructions.trim()}\n\n${skill}Request: ${prompt}`
}
