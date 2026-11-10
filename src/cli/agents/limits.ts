// Named defaults of a generation. Each is overridable: per call (a flag), per machine (the environment), per project
// (mimir.config.json). docs/agents.md has the table.

/**
 * Model turns a generation may take when nothing else is said. Measured with the real loop (docs/agents.md): a scene
 * that is checked, looked at twice and inspected in a cue sheet and a filmstrip took 23 to 61 turns; a run that is
 * stopped at the limit counts as failed, so the default leaves room above the largest run seen. The agent's own
 * turn limit did not always stop it, so the driver counts turns itself and stops the agent at this number.
 */
export const DEFAULT_MAX_TURNS = 90
/** cost ceiling in US dollars handed to agents that take one */
export const DEFAULT_BUDGET_USD = 3
/** seconds after which a generation is given up (--timeout) */
export const DEFAULT_TIMEOUT_S = 1800
/** ms an agent that was told to stop (SIGTERM) gets before it is killed */
export const STOP_GRACE_MS = 2000
/** ms between two looks at the working directory of an agent whose tool calls cannot be seen */
export const DISK_WATCH_MS = 1000
/** times the driver's own check or render is tried again when the browser could not be reached (a busy machine); a scene's errors are never retried */
export const VERIFY_RETRIES = 1
/** generations `mimir serve` runs at the same time (each is an agent that costs turns and money) */
export const DEFAULT_JOBS = 1

// ── the size of a concept ────────────────────────────────────────────────────────────────────────
// `mimir new --size small|medium|large` (MIMIR_SIZE; default: from the length of the prompt) sets how many steps the
// scene should have, how long it should be, how many review rounds the agent may take and where the driver stops it.
// Measured basis (docs/agents.md, "what a generation costs"): a small concept through the lean launch took 3 to 9
// API calls, which the agent reports as 9 to 22 turns; the limit leaves room above the largest run seen.

export const SIZE_NAMES = ['small', 'medium', 'large'] as const
export type ConceptSize = (typeof SIZE_NAMES)[number]

export interface SizeLimits {
  /** steps the scene should have, as the page says it */
  steps: string
  /** lines the scene file should have, as the page says it */
  lines: string
  /** `mimir review` rounds after the first one */
  fixRounds: number
  /** turn limit handed to the agent and enforced by the driver (--max-turns overrides) */
  maxTurns: number
  /** may the agent render a cue sheet or a filmstrip when the prompt is about motion? */
  motionShots: boolean
}

export const CONCEPT_SIZES: Record<ConceptSize, SizeLimits> = {
  small: { steps: '4 to 5', lines: '40 to 70', fixRounds: 2, maxTurns: 30, motionShots: false },
  medium: { steps: '5 to 7', lines: '60 to 110', fixRounds: 3, maxTurns: 50, motionShots: true },
  large: { steps: '6 to 10', lines: '90 to 180', fixRounds: 4, maxTurns: DEFAULT_MAX_TURNS, motionShots: true },
}

/** a prompt of at most this many words is a small concept … */
export const SMALL_PROMPT_WORDS = 14
/** … and of at most this many a medium one; anything longer is large */
export const MEDIUM_PROMPT_WORDS = 45

/** The size of a concept when nobody says: read off the length of the prompt (a one-line question is a small concept). */
export function sizeFromPrompt(prompt: string): ConceptSize {
  const words = prompt.trim().split(/\s+/).filter((w) => w !== '').length
  return words <= SMALL_PROMPT_WORDS ? 'small' : words <= MEDIUM_PROMPT_WORDS ? 'medium' : 'large'
}

// ── write once ───────────────────────────────────────────────────────────────────────────────────
// `mimir new --once`: the model answers with the module, the engine reviews it (src/cli/agents/once.ts).

export const NEW_MODES = ['once', 'loop'] as const
export type NewMode = (typeof NEW_MODES)[number]
/**
 * how `mimir new` generates when nothing says (--once / --loop, MIMIR_NEW_MODE). Measured (docs/agents.md, "write
 * once"): sixteen of sixteen requests came out ready in one call, a seventh of the time and a twentieth of the cost of
 * the loop. When no model that answers in text is found, an unasked-for `once` falls back to the loop.
 */
export const DEFAULT_NEW_MODE: NewMode = 'once'
/** corrections a write-once generation may ask for after its first answer (--fix, MIMIR_FIX_ROUNDS); 0 = never ask again */
export const DEFAULT_FIX_ROUNDS = 1
/** seconds one call of the writer may take (--timeout) */
export const WRITER_TIMEOUT_S = 300
/** characters of the engine's review handed back with a correction (its start and its end are kept) */
export const REVIEW_TEXT_MAX = 6000
/** words of the prompt that name the scene file … */
export const NAME_WORDS = 4
/** … after these are left out (the words of a question, not of its subject) */
export const NAME_STOP_WORDS: readonly string[] = ['how', 'does', 'do', 'did', 'a', 'an', 'the', 'work', 'works', 'working', 'is', 'are', 'what', 'why', 'explain', 'show', 'me', 'of', 'in', 'on', 'to', 'and', 'it', 'its', 'i', 'want', 'see', 'make', 'please']

/** runs per prompt of `mimir bench` (--runs) */
export const DEFAULT_BENCH_RUNS = 1
