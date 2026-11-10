// The contract between `mimir new` and a coding agent. The engine never calls a model: generation is a headless
// agent that runs the authoring loop with this CLI. An adapter knows three things about one agent: whether it is
// on this machine (detect), how to start it (command) and how to read its output (parseEvent). Everything else,
// stages, limits, the check of what the agent claims, is the same for every agent and lives beside this file.
//
// Pure types: no process is started here.

export type Env = Record<string, string | undefined>

/** What a run is allowed and told; resolved from flags, the environment and mimir.config.json (docs/agents.md). */
export interface AgentOptions {
  /** the model id or alias handed to the agent, or null to leave the choice to the agent */
  model: string | null
  /** how hard the model should think (the agent's own word for it, e.g. low | medium | high), or null / absent for the agent's default */
  effort?: string | null
  /** most model turns the run may take: given to the agent when it has such a flag, and enforced by the driver */
  maxTurns: number
  /** cost ceiling in US dollars: given to the agent when it has such a flag; the result says over_budget when it was passed */
  budgetUsd: number
  /** absolute path of the instructions for a headless run (it exists) */
  instructionsFile: string
  /** the text of that file */
  instructions: string
  /** conversation to continue, or null for a new one */
  resume: string | null
  /** id for a new conversation, for agents that accept one */
  sessionId: string
  /** <mimir>/bin: put first on PATH so that `mimir` is this CLI */
  binDir: string
  /** absolute path of the skill folder (skills/mimir), or null when this checkout has none */
  skillDir: string | null
  /** a plugin directory that carries the skill for agents that load plugins, or null */
  pluginDir: string | null
  /** the executable found by detect(), or null for adapters that have none */
  binary: string | null
  /** the command template of the `command` adapter, or null */
  commandTemplate: string | null
  /** the command template of a plain text model (MIMIR_WRITER_COMMAND / agent.writer), or null / absent */
  writerTemplate?: string | null
  /** extra arguments appended to the agent's command line (mimir.config.json agent.args) */
  extraArgs: readonly string[]
  env: Env
  /**
   * A lean launch: `instructions` is the ONE always-on page and is everything the agent needs. An adapter that can
   * replaces the agent's own system prompt with it, loads no skill and no plugin, and passes the minimum tool set.
   */
  lean?: boolean
}

export interface AgentCommand {
  argv: string[]
  /** added to the environment of the child */
  env: Record<string, string>
  /** text for the child's stdin, or null to close it at once (a headless agent must never wait on a pipe) */
  stdin: string | null
}

export interface Detection {
  available: boolean
  /** the executable, when there is one */
  binary: string | null
  /** how it was found, or what is missing and how to get it (one sentence a person can act on) */
  why: string
}

/** What a tool call does, in terms every agent shares. */
export type Action =
  | { type: 'shell'; command: string }
  | { type: 'write'; path: string }
  | { type: 'read'; path: string }
  | { type: 'skill'; name: string }
  | { type: 'other' }

/** What an adapter learns from the stream about how the run ended. */
export interface AgentOutcome {
  /** the agent itself reports success */
  ok: boolean
  /** why not, in one sentence */
  error: string | null
  /** the agent's last message */
  text: string
  turns: number | null
  costUsd: number | null
  durationMs: number | null
  session: string | null
  /** tool calls that were refused */
  denials: string[]
  /** tokens by kind, when the agent reports them */
  usage?: Usage | null
}

/** What a run consumed, as the agent reports it. A kind the agent does not report is null. */
export interface Usage {
  /** requests to the model (one per assistant message); a turn count is often larger, because agents count differently */
  api_calls: number | null
  /** input tokens that were neither read from nor written to a cache */
  input: number | null
  cache_write: number | null
  cache_read: number | null
  /** output tokens, thinking included */
  output: number | null
  thinking: number | null
  /** the sum of the four kinds above that are known */
  total: number | null
}

/** One thing the agent did or said, in terms every agent shares. Adapters turn their own stream into these. */
export type AgentEvent =
  | { kind: 'start'; model: string | null; session: string | null; workdir: string | null }
  /** one model turn of the agent's own conversation */
  | { kind: 'turn' }
  | { kind: 'tool'; id: string | null; name: string; summary: string; action: Action }
  /** what a tool call returned */
  | { kind: 'output'; id: string | null; text: string; failed: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'denied'; tool: string; reason: string }
  | { kind: 'log'; line: string }
  /** a stage the agent reports itself (the `command` adapter: an agent whose tool calls cannot be seen) */
  | { kind: 'stage'; stage: string }
  /** a reason to stop the agent now; the driver kills it and reports this */
  | { kind: 'abort'; reason: string }
  | { kind: 'end'; outcome: AgentOutcome }

/** Per-run memory of an adapter's parser (ids of calls in flight, …). */
export interface RunContext {
  options: AgentOptions
  workdir: string
  memo: Record<string, unknown>
}

/** One call of a model used as a plain function from text to text (the write-once path of `mimir new`). */
export interface WriterReply {
  /** everything the model answered */
  text: string
  /** why there is no usable answer, in one sentence, or null */
  error: string | null
  model: string | null
  costUsd: number | null
  /** as the model's command line reports it; null when it reports none */
  durationMs: number | null
  usage: Usage | null
}

/**
 * How an agent's command line is used WITHOUT its loop: one request, no tools, the answer on stdout. An adapter that
 * has one can serve the write-once path of `mimir new`; an adapter without one cannot, and says so.
 */
export interface Writer {
  /** tested | untested, as for the adapter */
  status: 'tested' | 'untested'
  /** Is the text function usable on this machine, and with which executable? Never throws, never starts anything. */
  detect(env: Env, config: AgentConfig): Detection
  /** The command line of one call. `system` is the whole page, `prompt` the request (or the request and a correction). Pure. */
  command(system: string, prompt: string, options: AgentOptions): AgentCommand
  /** What the call answered, from everything it printed. Pure. */
  parse(stdout: string, exitCode: number | null, stderrTail: string): WriterReply
}

export interface AgentAdapter {
  name: string
  describe: string
  /**
   * tested: run end to end by the maintainers, the numbers are in docs/agents.md.
   * untested: written from the agent's documented command line; nobody has run a generation with it yet.
   */
  status: 'tested' | 'untested'
  /** documented defaults; --model / --max-turns / --budget-usd, the environment and mimir.config.json override them */
  defaults: { model: string | null; maxTurns: number; budgetUsd: number; /** the agent's cheapest model, for --fast; absent = it names none */ fastModel?: string | null; /** the effort of a write-once call when nobody names one; absent = the agent's own default */ writeEffort?: string | null }
  /** A reason this agent cannot work in that directory (said before anything is spent), or null. */
  preflight?(workdir: string, options: AgentOptions): string | null
  /** true when the agent's tool calls cannot be seen in its output (stages then come from the files it writes) */
  opaque?: boolean
  /** Is this agent usable on this machine, and with which executable? Never throws, never starts the agent. */
  detect(env: Env, config: AgentConfig): Detection
  /** The command line of one generation. Pure. */
  command(prompt: string, workdir: string, options: AgentOptions): AgentCommand
  /** One line of the child's stdout → what happened. Pure given `run`. */
  parseEvent(line: string, run: RunContext): AgentEvent[]
  /** The same model as a plain text function (no loop, no tools); absent when the agent cannot be used that way. */
  writer?: Writer
}

/** The `agent` object of mimir.config.json. Every field is optional. */
export interface AgentConfig {
  /** adapter name: the same as --agent */
  name?: string
  model?: string
  /** how hard the model should think: the same as --effort */
  effort?: string
  maxTurns?: number
  budgetUsd?: number
  /** seconds */
  timeout?: number
  /** command template of the `command` adapter: the same as MIMIR_AGENT_COMMAND */
  command?: string
  /** command template of a plain text model for the write-once path: the same as MIMIR_WRITER_COMMAND */
  writer?: string
  /** extra arguments appended to the agent's command line */
  args?: string[]
  /** path of the instructions for a headless run, relative to the config file */
  instructions?: string
}

/** The stages of a generation, in the order a clean run visits them (fixing ↔ checking ↔ looking repeat). */
export const STAGES = ['storyboard', 'writing', 'checking', 'looking', 'fixing', 'ready', 'failed'] as const
export type Stage = (typeof STAGES)[number]

export interface CheckSummary { ok: boolean; errors: number; warnings: number; /** composition findings of `mimir review` (not errors), when the verifier measures them */ flags?: number }

/** What `mimir new` prints, one JSON object per line. Every line carries the stage the run is in. */
export type Progress =
  | { event: 'start'; stage: Stage; agent: string; model: string | null; session: string | null; workdir: string }
  /** the run moved to another stage */
  | { event: 'stage'; stage: Stage; round: number; elapsed_ms: number }
  | { event: 'tool'; stage: Stage; name: string; summary: string }
  /** the result of a `mimir check` the agent ran, read from the agent's own stream */
  | { event: 'check'; stage: Stage; round: number; ok: boolean; errors: number; warnings: number }
  /** the agent opened a rendered picture */
  | { event: 'look'; stage: Stage; round: number; image: string }
  | { event: 'text'; stage: Stage; text: string }
  | { event: 'denied'; stage: Stage; tool: string; reason: string }
  | { event: 'log'; stage: Stage; line: string }

/** The last line of `mimir new`. */
export interface NewResult {
  event: 'result'
  /** ready or failed */
  stage: 'ready' | 'failed'
  /** true only when the agent finished by itself, a scene file exists, and `mimir check` run by this command finds no error in it */
  ok: boolean
  /** absolute path of the scene the agent wrote, or null */
  scene: string | null
  /** what `mimir check` says about the scene (run by this command, not taken from the agent), or null when there is no scene or it could not be checked */
  check: CheckSummary | null
  /** absolute path of a contact sheet of the final scene, rendered by this command, or null when it could not be rendered */
  sheet: string | null
  /** the storyboard the agent wrote, when there is one */
  storyboard: string | null
  /**
   * Did the agent open a picture that was rendered after its last change to the scene?
   * true / false from its tool calls; null = unknown (the agent's tool calls cannot be seen).
   */
  looked: boolean | null
  /** how many times the agent ran `mimir check`, rendered or opened pictures, and wrote the scene file */
  rounds: { check: number; look: number; edit: number }
  /** how many times the agent rendered each kind of picture with `mimir shot`: the story sheet, the cue sheet, a filmstrip, plain frames */
  shots: { sheet: number; cues: number; fine: number; frames: number }
  agent: string
  model: string | null
  session: string | null
  turns: number | null
  cost_usd: number | null
  /** true when the reported cost is above the ceiling that was asked for */
  over_budget?: true
  /** what the agent reports about itself */
  duration_ms: number | null
  /** measured here, from the start of the agent to the end of this command's own check and render */
  wall_ms: number
  /** tool calls the agent was refused */
  denials: number
  /** why ok is false, or null */
  error: string | null
  /** things a reader should know that do not make the run a failure */
  notes: string[]
  // The fields below are filled by every generation; they are optional so that a caller that reports a failure
  // before any agent ran (mimir serve) need not invent them.
  /**
   * The honest one-word answer: failed · ready (checked clean and the agent looked at it) · ready-with-flags (no
   * error, but `mimir review` still has composition findings) · ready-unseen (no error, and the agent never opened
   * a picture: nobody has looked at it).
   */
  verdict?: 'failed' | 'ready' | 'ready-with-flags' | 'ready-unseen'
  /** small | medium | large: the limits the run was given */
  size?: string
  /** true = the one-page launch; false = the full loop through the skill */
  lean?: boolean
  /**
   * once = the model answered with the module and the engine reviewed it (no tools, no agent loop);
   * loop = a headless agent ran the authoring loop itself.
   */
  mode?: 'once' | 'loop'
  /** once: what every call of the model cost, in order (the first is the writing, the rest are corrections) */
  calls?: Array<{ seconds: number; tokens: number | null; cost_usd: number | null; errors: number; flags: number }>
  /** tokens by kind and API calls, as the agent reports them; null when it reports none */
  usage?: Usage | null
  /** was the first `mimir review` (or `mimir check`) the agent ran free of errors and flags? null = it ran none that could be read */
  first_review_clean?: boolean | null
  /** composition findings left in the final scene, or null when they were not measured */
  flags?: number | null
  /** lines of the scene file, or null */
  scene_lines?: number | null
  /** the directory that keeps this run: stream.ndjson (the agent's raw output) and usage.json */
  run_dir?: string | null
}
