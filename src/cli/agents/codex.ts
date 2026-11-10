// Adapter: Codex CLI in non-interactive mode (`codex exec --json`).
//
// UNTESTED. This adapter was written from the documented command line (`codex exec --help`, codex-cli 0.163) and
// the documented JSONL event stream; no generation has been run with it. What is known to need a look on first use:
//   - Codex has no system-prompt flag, so the instructions travel in front of the request (withInstructions).
//   - `mimir check` and `mimir shot` start a local server and a headless browser. The workspace-write sandbox
//     blocks the network by default, so the command line turns network access on for the sandbox. If the browser
//     still cannot start inside the sandbox, add `"args": ["--sandbox", "danger-full-access"]` to the agent section
//     of mimir.config.json (and run it somewhere you trust).
//   - Codex reports tokens, not dollars: cost_usd is null and --budget-usd cannot be enforced.
//   - Codex reports one "turn" per run, so --max-turns counts its finished items (commands, file changes, messages).
// Model: none is named here; Codex uses the model of its own configuration unless --model says otherwise.
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { DEFAULT_BUDGET_USD, DEFAULT_MAX_TURNS } from './limits.ts'
import { clip, clipOutput, oneLine, parseObject, pathWith, which, withInstructions } from './text.ts'
import type { AgentAdapter, AgentEvent, Detection, Env, RunContext, WriterReply } from './types.ts'

const abs = (p: string, workdir: string): string => (isAbsolute(p) ? p : join(workdir, p))

function detectCodex(env: Env): Detection {
  const override = env.MIMIR_AGENT_BIN
  if (override !== undefined && override !== '') {
    return existsSync(override)
      ? { available: true, binary: override, why: `MIMIR_AGENT_BIN=${override}` }
      : { available: false, binary: null, why: `MIMIR_AGENT_BIN points to a file that does not exist: ${override}` }
  }
  const hit = which('codex', env)
  return hit
    ? { available: true, binary: hit, why: `codex on PATH (${hit})` }
    : { available: false, binary: null, why: 'the Codex command line (`codex`) is not on PATH. Install it and sign in, or set MIMIR_AGENT_BIN=/path/to/codex' }
}

/**
 * The JSONL stream of one `codex exec --json` run read as ONE answer: the last message of the agent, and the tokens
 * of the turn. Codex keeps its own instructions and tools, so this is not a single request to the model; it is the
 * same text function as far as `mimir new` is concerned.
 */
export function parseCodexReply(stdout: string, exitCode: number | null, stderrTail: string): WriterReply {
  let text = ''
  let failed: string | null = null
  let usage: WriterReply['usage'] = null
  for (const line of stdout.split('\n')) {
    const m = parseObject(line)
    if (m === null) continue
    const item: Record<string, any> = m.item !== null && typeof m.item === 'object' ? m.item : {}
    if (m.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string') text = item.text
    else if (m.type === 'turn.failed') failed = `the model ended with an error${typeof m.error?.message === 'string' ? `: ${clip(oneLine(m.error.message), 200)}` : ''}`
    else if (m.type === 'turn.completed' && m.usage !== null && typeof m.usage === 'object') {
      const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
      const input = n(m.usage.input_tokens), cached = n(m.usage.cached_input_tokens), output = n(m.usage.output_tokens)
      usage = { api_calls: null, input: input !== null && cached !== null ? input - cached : input, cache_write: null, cache_read: cached, output, thinking: n(m.usage.reasoning_output_tokens), total: (input ?? 0) + (output ?? 0) }
    }
  }
  const last = stderrTail.trim().split('\n').pop() ?? ''
  const error = failed ?? (text.trim() !== '' ? null : `the model's command line printed no answer${exitCode === null ? '' : ` (exit ${exitCode})`}${last ? `: ${clip(oneLine(last), 200)}` : ''}`)
  return { text, error, model: null, costUsd: null, durationMs: null, usage }
}

export const codex: AgentAdapter = {
  name: 'codex',
  describe: 'Codex CLI in non-interactive mode (codex exec --json). Untested: written from its documented command line',
  status: 'untested',
  defaults: { model: null, maxTurns: DEFAULT_MAX_TURNS, budgetUsd: DEFAULT_BUDGET_USD },

  detect(env): Detection {
    return detectCodex(env)
  },

  // UNTESTED, like the adapter. Read-only sandbox: the answer is text, nothing is written by the agent.
  writer: {
    status: 'untested',
    detect: (env) => detectCodex(env),
    command: (system, prompt, o) => ({
      argv: [o.binary ?? 'codex', 'exec', '--json', '--skip-git-repo-check', '--color', 'never', '--sandbox', 'read-only', ...(o.model ? ['--model', o.model] : []), ...(o.effort ? ['--config', `model_reasoning_effort=${o.effort}`] : []), '-'],
      env: {},
      stdin: `${system.trim()}\n\n${prompt}`,
    }),
    parse: parseCodexReply,
  },

  command(prompt, workdir, o) {
    const argv = [
      o.binary ?? 'codex', 'exec', ...(o.resume ? ['resume', o.resume] : []),
      '--json', '--skip-git-repo-check', '--color', 'never',
      '--cd', workdir,
      '--sandbox', 'workspace-write', '--config', 'sandbox_workspace_write.network_access=true',
      ...(o.model ? ['--model', o.model] : []),
      ...(o.effort ? ['--config', `model_reasoning_effort=${o.effort}`] : []),
      ...o.extraArgs,
      withInstructions(prompt, o),
    ]
    return { argv, env: { PATH: pathWith(o.binDir, o.env) }, stdin: null }
  },

  parseEvent(line, run: RunContext): AgentEvent[] {
    const m = parseObject(line)
    if (m === null) return line.trim() !== '' ? [{ kind: 'log', line: clip(line.trim()) }] : []
    const memo = run.memo as { session?: string; last?: string; items?: number }
    if (m.type === 'thread.started') {
      memo.session = typeof m.thread_id === 'string' ? m.thread_id : undefined
      return [{ kind: 'start', model: run.options.model, session: memo.session ?? null, workdir: run.workdir }]
    }
    if (m.type === 'item.started' || m.type === 'item.completed') {
      const item: Record<string, any> = m.item !== null && typeof m.item === 'object' ? m.item : {}
      const id = typeof item.id === 'string' ? item.id : null
      const done = m.type === 'item.completed'
      const out: AgentEvent[] = []
      if (item.type === 'command_execution' && typeof item.command === 'string') {
        if (!done) out.push({ kind: 'tool', id, name: 'shell', summary: clip(oneLine(item.command)), action: { type: 'shell', command: item.command } })
        else out.push({ kind: 'output', id, text: clipOutput(String(item.aggregated_output ?? '')), failed: typeof item.exit_code === 'number' && item.exit_code !== 0 })
      } else if (item.type === 'file_change' && done && Array.isArray(item.changes)) {
        for (const c of item.changes as Array<Record<string, unknown>>) {
          if (typeof c?.path !== 'string') continue
          out.push({ kind: 'tool', id, name: 'write', summary: c.path, action: { type: 'write', path: abs(c.path, run.workdir) } })
        }
      } else if (item.type === 'agent_message' && done && typeof item.text === 'string') {
        memo.last = item.text
        if (item.text.trim() !== '') out.push({ kind: 'text', text: clip(oneLine(item.text)) })
      } else if (done && typeof item.path === 'string' && /\.(png|jpe?g|webp)$/i.test(item.path)) {
        // a picture the agent opened (its image viewing tool)
        out.push({ kind: 'tool', id, name: String(item.type ?? 'view'), summary: item.path, action: { type: 'read', path: abs(item.path, run.workdir) } })
      } else if (item.type === 'error' && typeof item.message === 'string') {
        out.push({ kind: 'log', line: clip(oneLine(item.message)) })
      }
      if (done && (item.type === 'command_execution' || item.type === 'file_change' || item.type === 'agent_message')) {
        memo.items = (memo.items ?? 0) + 1
        out.push({ kind: 'turn' })
      }
      return out
    }
    const end = (ok: boolean, error: string | null): AgentEvent[] => [{
      kind: 'end',
      outcome: { ok, error, text: memo.last ?? '', turns: memo.items ?? null, costUsd: null, durationMs: null, session: memo.session ?? null, denials: [] },
    }]
    if (m.type === 'turn.completed') return end(true, null)
    if (m.type === 'turn.failed') return end(false, `the agent ended with an error${typeof m.error?.message === 'string' ? `: ${clip(oneLine(m.error.message), 200)}` : ''}`)
    if (m.type === 'error') return [{ kind: 'log', line: clip(oneLine(String(m.message ?? 'error'))) }]
    return []
  },
}
