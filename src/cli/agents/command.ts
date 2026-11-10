// Adapter: any agent at all. A command template from mimir.config.json (agent.command) or MIMIR_AGENT_COMMAND is
// run in the working directory. No vendor is needed: a local model behind a script works as well as a hosted one.
//
// What the command gets:
//   placeholders in the template   {prompt} {request} {system} {skill} {workdir} {model} {max_turns} {budget_usd}
//     {prompt}  = the request as the user typed it      {request} = instructions + where the skill is + the request
//     {system}  = path of the headless instructions     {skill}   = path of the skill folder
//   the same in its environment    MIMIR_PROMPT MIMIR_REQUEST MIMIR_SYSTEM_FILE MIMIR_SKILL_DIR MIMIR_WORKDIR
//                                  MIMIR_MODEL MIMIR_MAX_TURNS MIMIR_BUDGET_USD [MIMIR_RESUME]
//   {request} on its stdin, and `mimir` (this CLI) first on PATH
// What it must do: write <name>.scene.js into the working directory, and end its output with a line
//   RESULT <scene path>
// What it may do: print progress, one JSON object per line: {"event":"tool","name":"…","summary":"…"},
//   {"event":"text","text":"…"}, {"event":"stage","stage":"checking"} (storyboard | writing | checking | looking |
//   fixing). Any other line is kept as a log line. Without those, stages are read off the files it writes.
import { DEFAULT_BUDGET_USD, DEFAULT_MAX_TURNS } from './limits.ts'
import { clip, parseObject, pathWith, splitCommand, withInstructions } from './text.ts'
import type { AgentAdapter, AgentConfig, AgentEvent, AgentOptions, Detection, Env, Writer } from './types.ts'

export const COMMAND_PLACEHOLDERS = ['prompt', 'request', 'system', 'skill', 'workdir', 'model', 'max_turns', 'budget_usd'] as const

/** The template: the environment wins over the config file (a machine overrides a project). */
export function commandTemplate(env: Env, config: AgentConfig): string | null {
  const fromEnv = env.MIMIR_AGENT_COMMAND
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return typeof config.command === 'string' && config.command.trim() !== '' ? config.command : null
}

function values(prompt: string, workdir: string, o: AgentOptions): Record<(typeof COMMAND_PLACEHOLDERS)[number], string> {
  return {
    prompt, request: withInstructions(prompt, o), system: o.instructionsFile, skill: o.skillDir ?? '', workdir,
    model: o.model ?? '', max_turns: String(o.maxTurns), budget_usd: String(o.budgetUsd),
  }
}

// ── the same idea without a loop: any model that turns text into text ─────────────────────────────
// MIMIR_WRITER_COMMAND, or "agent": { "writer": "…" } in mimir.config.json, is the command line of ONE call of a
// model: a local one behind `ollama run <model>`, a hosted one behind any command-line client.
//   on its stdin        the page, a blank line, the request; only the request when the template uses {system};
//                       nothing when it uses {prompt}
//   placeholders        {system} {prompt} {model} {effort}: each becomes ONE argument, whatever it contains
//   in its environment  MIMIR_SYSTEM MIMIR_PROMPT MIMIR_MODEL MIMIR_EFFORT
//   on its stdout       the answer: the module in a fenced code block (text around it is ignored)

export const WRITER_PLACEHOLDERS = ['system', 'prompt', 'model', 'effort'] as const

/** The writer template: the environment wins over the config file. */
export function writerTemplate(env: Env, config: AgentConfig): string | null {
  const fromEnv = env.MIMIR_WRITER_COMMAND
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return typeof config.writer === 'string' && config.writer.trim() !== '' ? config.writer : null
}

export const commandWriter: Writer = {
  status: 'tested',
  detect(env, config): Detection {
    const template = writerTemplate(env, config)
    if (template === null) {
      return {
        available: false, binary: null,
        why: 'no writer command: set MIMIR_WRITER_COMMAND, or "agent": { "writer": "…" } in mimir.config.json, to a command that reads the page and the request on its stdin and prints the answer (placeholders {system} {prompt} {model})',
      }
    }
    const first = splitCommand(template)[0]
    return first ? { available: true, binary: first, why: `writer command: ${clip(template, 120)}` } : { available: false, binary: null, why: 'the writer command is empty' }
  },
  command(system, prompt, o) {
    const template = o.writerTemplate ?? ''
    const v: Record<(typeof WRITER_PLACEHOLDERS)[number], string> = { system, prompt, model: o.model ?? '', effort: o.effort ?? '' }
    const fill = (arg: string): string => arg.replace(/\{(\w+)\}/g, (whole, key: string) => (key in v ? v[key as keyof typeof v] : whole))
    return {
      argv: splitCommand(template).map(fill),
      env: { MIMIR_SYSTEM: system, MIMIR_PROMPT: prompt, MIMIR_MODEL: v.model, MIMIR_EFFORT: v.effort },
      // what the template does not take as an argument arrives on stdin
      stdin: /\{prompt\}/.test(template) ? null : /\{system\}/.test(template) ? prompt : `${system.trim()}\n\n${prompt}`,
    }
  },
  parse(stdout, exitCode, stderrTail) {
    const text = stdout.trim()
    const last = stderrTail.trim().split('\n').pop() ?? ''
    const error = text !== '' ? null : `the writer command printed nothing${exitCode === null ? '' : ` (exit ${exitCode})`}${last ? `: ${clip(last, 200)}` : ''}`
    return { text: stdout, error, model: null, costUsd: null, durationMs: null, usage: null }
  },
}

export const command: AgentAdapter = {
  name: 'command',
  describe: 'any agent: the command template of mimir.config.json (agent.command) or MIMIR_AGENT_COMMAND',
  status: 'tested',
  opaque: true,
  defaults: { model: null, maxTurns: DEFAULT_MAX_TURNS, budgetUsd: DEFAULT_BUDGET_USD },
  writer: commandWriter,

  detect(env, config): Detection {
    const template = commandTemplate(env, config)
    if (template === null) {
      return {
        available: false, binary: null,
        why: 'no command template: set MIMIR_AGENT_COMMAND, or "agent": { "command": "…" } in mimir.config.json, to the command line of a headless agent ' +
          '(placeholders {prompt} {request} {system} {skill} {workdir} {model}; it must end its output with "RESULT <scene path>")',
      }
    }
    const first = splitCommand(template)[0]
    return first ? { available: true, binary: first, why: `command template: ${clip(template, 120)}` } : { available: false, binary: null, why: 'the command template is empty' }
  },

  command(prompt, workdir, o) {
    const v = values(prompt, workdir, o)
    const fill = (arg: string): string => arg.replace(/\{(\w+)\}/g, (whole, key: string) => (key in v ? v[key as keyof typeof v] : whole))
    return {
      argv: [...splitCommand(o.commandTemplate ?? '').map(fill), ...o.extraArgs],
      env: {
        PATH: pathWith(o.binDir, o.env), MIMIR_PROMPT: v.prompt, MIMIR_REQUEST: v.request, MIMIR_SYSTEM_FILE: v.system, MIMIR_SKILL_DIR: v.skill,
        MIMIR_WORKDIR: v.workdir, MIMIR_MODEL: v.model, MIMIR_MAX_TURNS: v.max_turns, MIMIR_BUDGET_USD: v.budget_usd,
        ...(o.resume ? { MIMIR_RESUME: o.resume } : {}),
      },
      stdin: v.request,
    }
  },

  parseEvent(line): AgentEvent[] {
    const trimmed = line.trim()
    if (trimmed === '') return []
    if (/^RESULT\s+\S/.test(trimmed)) {
      return [{ kind: 'end', outcome: { ok: true, error: null, text: trimmed, turns: null, costUsd: null, durationMs: null, session: null, denials: [] } }]
    }
    const m = parseObject(trimmed)
    if (m !== null) {
      if (m.event === 'tool' && typeof m.name === 'string') return [{ kind: 'tool', id: null, name: m.name, summary: clip(String(m.summary ?? m.name)), action: { type: 'other' } }]
      if (m.event === 'text' && typeof m.text === 'string') return [{ kind: 'text', text: clip(m.text) }]
      if (m.event === 'stage' && typeof m.stage === 'string') return [{ kind: 'stage', stage: m.stage }]
      if (m.event === 'log' && typeof m.line === 'string') return [{ kind: 'log', line: clip(m.line) }]
      if (m.event === 'denied') return [{ kind: 'denied', tool: String(m.tool ?? '?'), reason: clip(String(m.reason ?? '')) }]
    }
    return [{ kind: 'log', line: clip(trimmed) }]
  },
}
