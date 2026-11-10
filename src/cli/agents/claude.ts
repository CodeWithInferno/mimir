// Adapter: Claude Code in headless mode (`claude -p`), stream-json output.
//
// The command line is the recipe that was run and measured (docs/agents.md, "the headless recipe"):
//   --setting-sources "" --strict-mcp-config   ignore the user's and the project's settings, hooks, plugins, memory
//                                              files and every MCP server: the run depends on this repository only
//   --plugin-dir <mimir>                       load the plugin in place: the skill, and bin/ on the shell's PATH
//   --allowedTools …                           the three permission traps of a headless run (nobody can approve):
//       Skill(mimir:mimir)        a skill that declares allowed-tools needs approval to launch
//       Bash(mimir *)             the skill's own grant lasts one turn; a resumed conversation needs the rule here
//       Read(/<skill dir>/**)     a skill's reference files are outside the working directory
//   --tools Read,Write,Edit,Bash,Skill         a smaller built-in tool set halves the first-turn prompt
//
// The lean launch (options.lean, the default of `mimir new`) is a different recipe, measured in docs/agents.md:
//   --system-prompt <the page>                 REPLACES the agent's own system prompt: the page is all it carries
//   --tools Read,Write,Edit,Bash               no Skill tool, no plugin, no skill list
//   --disable-slash-commands                   nothing else is loaded into the prompt
//   --allowedTools Bash(mimir *)               the one permission a headless run needs
// First call measured: 9.3k tokens of base prompt + 3.8k of skill + 14.4k of reference reads before, one page after.
//
// Claude Code refuses to write inside a directory whose name starts with a dot ("sensitive file"); a run started
// there spends money and writes nothing, so preflight() says so before the agent starts.
// The model name below is the agent's own alias for its current mid-size model, so no dated model id lives here.
import { existsSync } from 'node:fs'
import { DEFAULT_BUDGET_USD, DEFAULT_MAX_TURNS } from './limits.ts'
import { clip, clipOutput, oneLine, parseObject, pathWith, toolSummary, which } from './text.ts'
import type { Action, AgentAdapter, AgentEvent, AgentOptions, Detection, Env, RunContext, Usage, WriterReply } from './types.ts'

/** name of the plugin, and of the skill inside it (plugin:skill) */
export const CLAUDE_PLUGIN = 'mimir'
export const CLAUDE_SKILL = 'mimir:mimir'
/** the built-in tools a generation needs */
export const CLAUDE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Skill'] as const
/** the built-in tools of a lean launch: write, edit, run mimir, open the sheet */
export const CLAUDE_LEAN_TOOLS = ['Read', 'Write', 'Edit', 'Bash'] as const
/** the agent's alias for its cheapest model (--fast); like `sonnet` below, an alias, so no dated id lives here */
export const CLAUDE_FAST_MODEL = 'haiku'
/**
 * The effort of a write-once call when nobody names one. Measured on the same request (docs/agents.md, "write
 * once"): at the agent's own default the model spent more tokens deliberating than writing, for a scene that looked
 * no better; `low` took two thirds of the time and of the cost. --effort / MIMIR_EFFORT / agent.effort override it.
 */
export const CLAUDE_WRITE_EFFORT = 'low'
/** MIMIR_ALLOW_DOT_DIR=1 skips the dot-directory refusal (for a setup where the agent is known to write there) */
export const ALLOW_DOT_DIR_ENV = 'MIMIR_ALLOW_DOT_DIR'

/** The first component of a path that starts with a dot (`.cache`, not `.` or `..`), or null. */
export function dotComponent(path: string): string | null {
  return path.split(/[\\/]/).find((part) => part.length > 1 && part.startsWith('.') && part !== '..') ?? null
}

/** The permission rules a headless run needs at session level. A rule may contain spaces: each is one argument. */
export function claudeAllowedTools(o: Pick<AgentOptions, 'pluginDir' | 'skillDir'>): string[] {
  const rules = ['Bash(mimir *)']
  if (o.pluginDir) rules.unshift(`Skill(${CLAUDE_SKILL})`)
  // an absolute path in a permission rule starts with two slashes
  if (o.skillDir) rules.push(`Read(/${o.skillDir.split('\\').join('/')}/**)`)
  return rules
}

function actionOf(name: string, input: unknown): Action {
  const o = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const str = (k: string): string | null => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : null)
  if (name === 'Bash' && str('command')) return { type: 'shell', command: str('command')! }
  if ((name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') && (str('file_path') ?? str('notebook_path'))) return { type: 'write', path: (str('file_path') ?? str('notebook_path'))! }
  if (name === 'Read' && str('file_path')) return { type: 'read', path: str('file_path')! }
  if (name === 'Skill' && str('skill')) return { type: 'skill', name: str('skill')! }
  return { type: 'other' }
}

/** The text of a tool result: a string, or the text blocks of an array (pictures are left out). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).filter((t) => t !== '').join('\n')
}

function detectClaude(env: Env): Detection {
  const override = env.MIMIR_AGENT_BIN
  if (override !== undefined && override !== '') {
    return existsSync(override)
      ? { available: true, binary: override, why: `MIMIR_AGENT_BIN=${override}` }
      : { available: false, binary: null, why: `MIMIR_AGENT_BIN points to a file that does not exist: ${override}` }
  }
  const hit = which('claude', env)
  return hit
    ? { available: true, binary: hit, why: `claude on PATH (${hit})` }
    : {
        available: false, binary: null,
        why: 'the Claude Code command line (`claude`) is not on PATH. Install it (https://code.claude.com/docs) and sign in, or set MIMIR_AGENT_BIN=/path/to/claude',
      }
}

const tokenCount = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The `usage` object of a result, in the kinds every agent shares. `calls` = requests to the model, when known. */
export function claudeUsage(u: Record<string, any> | null, calls: number | null): Usage | null {
  if (u === null) return null
  return {
    api_calls: calls, input: tokenCount(u.input_tokens), cache_write: tokenCount(u.cache_creation_input_tokens), cache_read: tokenCount(u.cache_read_input_tokens),
    output: tokenCount(u.output_tokens), thinking: tokenCount(u.output_tokens_details?.thinking_tokens),
    total: [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens, u.output_tokens].reduce((sum: number, v: unknown) => sum + (tokenCount(v) ?? 0), 0),
  }
}

/**
 * The write-once call, measured (docs/agents.md, "write once"): no tools and the page as the whole system prompt
 * leave about 400 tokens of overhead, and the call is ONE request to the model.
 *   --tools ""                 no tool definitions in the prompt, so no loop
 *   --system-prompt <page>     replaces the agent's own system prompt
 *   the request on stdin       no limit on its length, no quoting
 */
export function claudeWriteCommand(system: string, o: Pick<AgentOptions, 'binary' | 'model' | 'effort'>): string[] {
  return [
    o.binary ?? 'claude', '-p',
    '--system-prompt', system,
    '--tools', '',
    '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands',
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
    '--output-format', 'json',
  ]
}

/** The one JSON object `claude -p --output-format json` prints. */
export function parseClaudeReply(stdout: string, exitCode: number | null, stderrTail: string): WriterReply {
  const m = parseObject(stdout.trim()) ?? parseObject(stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop() ?? '')
  if (m === null || m.type !== 'result') {
    const last = (stderrTail.trim() || stdout.trim()).split('\n').pop() ?? ''
    return { text: '', error: `the model's command line printed no result${exitCode === null ? '' : ` (exit ${exitCode})`}${last ? `: ${clip(oneLine(last), 200)}` : ''}`, model: null, costUsd: null, durationMs: null, usage: null }
  }
  const ok = m.subtype === 'success' && m.is_error !== true
  const models = m.modelUsage !== null && typeof m.modelUsage === 'object' ? Object.keys(m.modelUsage as object) : []
  return {
    text: typeof m.result === 'string' ? m.result : '',
    error: ok ? null : `the model ended with ${m.subtype ?? 'an error'}${typeof m.result === 'string' && m.result ? `: ${clip(oneLine(m.result), 200)}` : ''}`,
    model: models.length === 1 ? models[0]! : null,
    costUsd: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : null,
    durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : null,
    usage: claudeUsage(m.usage !== null && typeof m.usage === 'object' ? (m.usage as Record<string, any>) : null, typeof m.num_turns === 'number' ? m.num_turns : 1),
  }
}

export const claude: AgentAdapter = {
  name: 'claude',
  describe: 'Claude Code in headless mode (claude -p), stream-json output',
  status: 'tested',
  defaults: { model: 'sonnet', maxTurns: DEFAULT_MAX_TURNS, budgetUsd: DEFAULT_BUDGET_USD, fastModel: CLAUDE_FAST_MODEL, writeEffort: CLAUDE_WRITE_EFFORT },

  preflight(workdir, o): string | null {
    const dot = dotComponent(workdir)
    if (dot === null || o.env[ALLOW_DOT_DIR_ENV] === '1') return null
    return `the agent cannot write under a dot-directory, and ${workdir} is inside "${dot}": it would spend its turns on refused writes. Give another directory with -o (or set ${ALLOW_DOT_DIR_ENV}=1 if your setup allows it)`
  },

  detect(env): Detection {
    return detectClaude(env)
  },

  writer: {
    status: 'tested',
    detect: (env) => detectClaude(env),
    command: (system, prompt, o) => ({ argv: claudeWriteCommand(system, o), env: {}, stdin: prompt }),
    parse: parseClaudeReply,
  },

  command(prompt, _workdir, o) {
    if (o.lean) {
      const lean = [
        o.binary ?? 'claude', '-p', prompt,
        '--setting-sources', '', '--strict-mcp-config',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Bash(mimir *)',
        '--tools', CLAUDE_LEAN_TOOLS.join(','),
        '--system-prompt', o.instructions,
        '--disable-slash-commands',
        ...(o.model ? ['--model', o.model] : []),
        ...(o.effort ? ['--effort', o.effort] : []),
        '--max-turns', String(o.maxTurns),
        '--max-budget-usd', String(o.budgetUsd),
        ...(o.resume ? ['--resume', o.resume] : ['--session-id', o.sessionId]),
        '--output-format', 'stream-json', '--verbose',
        ...o.extraArgs,
      ]
      return { argv: lean, env: { PATH: pathWith(o.binDir, o.env) }, stdin: null }
    }
    const argv = [
      o.binary ?? 'claude', '-p', prompt,
      ...(o.pluginDir ? ['--plugin-dir', o.pluginDir] : []),
      '--setting-sources', '', '--strict-mcp-config',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', ...claudeAllowedTools(o),
      '--tools', CLAUDE_TOOLS.filter((t) => t !== 'Skill' || o.pluginDir !== null).join(','),
      '--append-system-prompt-file', o.instructionsFile,
      ...(o.model ? ['--model', o.model] : []),
      ...(o.effort ? ['--effort', o.effort] : []),
      '--max-turns', String(o.maxTurns),
      '--max-budget-usd', String(o.budgetUsd),
      ...(o.resume ? ['--resume', o.resume] : ['--session-id', o.sessionId]),
      '--output-format', 'stream-json', '--verbose',
      ...o.extraArgs,
    ]
    // the plugin's bin/ normally reaches the shell's PATH by itself; under load it once did not, so it is exported too
    return { argv, env: { PATH: pathWith(o.binDir, o.env) }, stdin: null }
  },

  parseEvent(line, run: RunContext): AgentEvent[] {
    const m = parseObject(line)
    if (m === null) return line.trim() !== '' ? [{ kind: 'log', line: clip(line.trim()) }] : []
    const o = run.options
    if (m.type === 'system' && m.subtype === 'init') {
      const session = typeof m.session_id === 'string' ? m.session_id : null
      const out: AgentEvent[] = [{ kind: 'start', model: typeof m.model === 'string' ? m.model : null, session, workdir: typeof m.cwd === 'string' ? m.cwd : null }]
      run.memo.session = session
      // fail fast: without its plugin the agent would spend its turns hunting for the tool
      const plugins: Array<{ name?: unknown }> = Array.isArray(m.plugins) ? m.plugins : []
      if (Array.isArray(m.plugin_errors) && m.plugin_errors.length) out.push({ kind: 'abort', reason: `the agent could not load a plugin: ${clip(JSON.stringify(m.plugin_errors))}` })
      else if (!o.lean && o.pluginDir && !plugins.some((p) => p && p.name === CLAUDE_PLUGIN)) {
        out.push({ kind: 'abort', reason: `the agent started without the ${CLAUDE_PLUGIN} plugin (${o.pluginDir}): its init event lists ${plugins.length ? plugins.map((p) => String(p?.name)).join(', ') : 'no plugins'}` })
      }
      return out
    }
    if (m.type === 'system' && m.subtype === 'permission_denied') {
      return [{ kind: 'denied', tool: String(m.tool_name ?? '?'), reason: clip(oneLine(String(m.message ?? m.decision_reason_type ?? ''))) }]
    }
    // a message of the agent's own conversation is a turn; those of a sub-agent it started are not
    const own = m.parent_tool_use_id === null || m.parent_tool_use_id === undefined
    if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
      const out: AgentEvent[] = own ? [{ kind: 'turn' }] : []
      // one request to the model = one message id (its blocks arrive as separate lines)
      if (own && typeof m.message.id === 'string') ((run.memo.calls ??= new Set<string>()) as Set<string>).add(m.message.id)
      for (const block of m.message.content as Array<Record<string, any>>) {
        if (block?.type === 'tool_use') {
          const name = String(block.name ?? '?')
          out.push({ kind: 'tool', id: typeof block.id === 'string' ? block.id : null, name, summary: toolSummary(name, block.input), action: own ? actionOf(name, block.input) : { type: 'other' } })
        } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') out.push({ kind: 'text', text: clip(oneLine(block.text)) })
      }
      return out
    }
    if (m.type === 'user' && own && Array.isArray(m.message?.content)) {
      const out: AgentEvent[] = []
      for (const block of m.message.content as Array<Record<string, any>>) {
        if (block?.type !== 'tool_result') continue
        out.push({ kind: 'output', id: typeof block.tool_use_id === 'string' ? block.tool_use_id : null, text: clipOutput(resultText(block.content)), failed: block.is_error === true })
      }
      return out
    }
    if (m.type === 'result') {
      const denials: string[] = Array.isArray(m.permission_denials) ? m.permission_denials.map((d: any) => `${d?.tool_name ?? '?'}${d?.tool_input ? ` ${clip(oneLine(JSON.stringify(d.tool_input)), 120)}` : ''}`) : []
      const success = m.subtype === 'success' && m.is_error !== true
      const error = success ? null
        : m.subtype === 'error_max_turns' ? `the agent hit its turn limit (${o.maxTurns}; raise it with --max-turns)`
          : m.subtype === 'error_max_budget_usd' ? `the agent hit its cost ceiling ($${o.budgetUsd}; raise it with --budget-usd)`
            : `the agent ended with ${m.subtype ?? 'an error'}${typeof m.result === 'string' && m.result ? `: ${clip(oneLine(m.result), 200)}` : ''}`
      const calls = run.memo.calls instanceof Set ? run.memo.calls.size : null
      const usage = claudeUsage(m.usage !== null && typeof m.usage === 'object' ? (m.usage as Record<string, any>) : null, calls)
      return [{
        kind: 'end',
        outcome: {
          ok: success, error, text: typeof m.result === 'string' ? m.result : '',
          turns: typeof m.num_turns === 'number' ? m.num_turns : null, costUsd: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : null,
          durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : null,
          session: typeof m.session_id === 'string' ? m.session_id : typeof run.memo.session === 'string' ? run.memo.session : null, denials, usage,
        },
      }]
    }
    return []
  },
}
