// The command-line shape of `mimir review`, `mimir bench` and the lean flags of `mimir new`.
// Pure data (no I/O, no imports that run code), so that src/cli/args.ts can list them beside the other commands.
import type { CommandSpec, FlagSpec, Parsed } from './args.ts'
import { CONCEPT_SIZES, DEFAULT_BENCH_RUNS, DEFAULT_FIX_ROUNDS, DEFAULT_NEW_MODE, NEW_MODES, SIZE_NAMES, type ConceptSize, type NewMode } from './agents/limits.ts'
import { UsageError, suggest } from './errors.ts'
import { GUIDE_DEFAULTS } from '../guide/index.ts'

/** height of the 2D frame in its own units (DESIGN: 14.222 x 8) */
const FRAME_HEIGHT = 8
/** the top edge of the caption line, in % of the frame from the top, as the guide draws it by default */
export const CAPTION_ZONE_TOP = Math.floor(100 * (1 - (GUIDE_DEFAULTS.captionBottom + GUIDE_DEFAULTS.captionSize * GUIDE_DEFAULTS.captionLine) / FRAME_HEIGHT))

/**
 * Named defaults of the composition findings of `mimir review`, in % of the frame (x from the left, y from the
 * top). Each is overridable per call: `mimir review <scene> --limit smallWidth=45 --limit caption=85`.
 */
export const REVIEW_LIMITS = {
  /** SMALL: the finished picture is narrower than this share of the frame width … */
  smallWidth: 55,
  /** … or covers less than this share of the frame area */
  smallArea: 20,
  /** TOP-HEAVY: the centre of the content is above this line */
  topHeavy: 33,
  /** CAPTION: where the caption line starts when none is showing in the frame that is measured (a line that is showing is measured itself) */
  caption: CAPTION_ZONE_TOP,
  /** … and the air an object must leave above the caption line */
  captionGap: 1.5,
  /** LOPSIDED: one side margin is wider than this while the opposite one is narrower than `lopsidedNear` */
  lopsidedFar: 32,
  lopsidedNear: 12,
  /** NOT ON STAGE YET: seconds a pointer may land before its target has come on stage (they are seen arriving together) */
  landGrace: 0.6,
  /** FAINT-TEXT: a text on stage at the end of a step whose own opacity (the dimming of a focus left out) is under this, in % */
  faintText: 45,
  /** an object counts as moved / resized when its centre or size changes by more than this */
  moved: 1,
  /** an object is reported outside the frame when less than this share of its box is inside, in % */
  inside: 98,
  /** objects listed by name per line before the rest is counted */
  listed: 10,
} as const
export type ReviewLimits = { -readonly [K in keyof typeof REVIEW_LIMITS]: number }

export const REVIEW_SPEC: CommandSpec = {
  name: 'review',
  summary: 'the whole inner loop in one call: lint + a text account of every step + composition findings + one small sheet',
  usage: 'mimir review <scene> [--sheet] [--json] [--limit name=value ...] [--out dir]',
  args: '<scene>',
  minArgs: 1,
  maxArgs: 1,
  flags: [
    { name: 'sheet', type: 'boolean', help: 'render the story sheet (one cell per step) and print its path; without it a sheet is made only when a composition finding needs eyes' },
    { name: 'limit', type: 'list', value: 'name=value', help: `override a composition threshold (repeatable): ${Object.entries(REVIEW_LIMITS).map(([k, v]) => `${k}=${v}`).join(', ')}` },
    { name: 'out', short: 'o', type: 'string', value: 'dir', help: 'where the sheet goes (default .mimir/review/<scene>)' },
  ],
  notes: [
    'Text on stdout unless --json. Positions are % of the frame: x from the left, y from the top; sizes are width x height.',
    'Last line: `FIX FIRST: …` (linter errors, exit 1), `FLAGS: …` (no errors, composition findings to fix, exit 0) or `CLEAN: …` (exit 0).',
    'Composition findings: SMALL, TOP-HEAVY, CAPTION, LOPSIDED, FAINT-TEXT, NOT ON STAGE YET (a narration link whose target is not there when the pointer lands).',
    'A viewer that has __mimir.describe() adds its own lines per step (the blocks of explain() describe themselves).',
  ],
}

export const BENCH_SPEC: CommandSpec = {
  name: 'bench',
  summary: 'run prompts through `mimir new` one at a time and print one table: verdict, API calls, tokens, seconds, cost',
  usage: 'mimir bench [--prompts file] [--only a,b] [--model m] [--agent name] [--runs n] [--size s] [--once | --loop] [--fix n] [--fast] [--full] [-o dir] [--json]',
  args: '',
  minArgs: 0,
  maxArgs: 0,
  flags: [
    { name: 'prompts', type: 'string', value: 'file', help: 'one prompt per line, `#` starts a comment (default: MIMIR_BENCH_PROMPTS, else <mimir>/bench/small-concepts.txt)' },
    { name: 'only', type: 'list', value: 'word', help: 'run only the prompts that contain one of these words (repeatable)' },
    { name: 'model', type: 'string', value: 'm', help: 'model handed to the agent (default: as mimir new)' },
    { name: 'agent', type: 'string', value: 'name', help: 'agent adapter (default: as mimir new)' },
    { name: 'runs', type: 'string', value: 'n', help: `runs per prompt (default ${DEFAULT_BENCH_RUNS})` },
    { name: 'size', type: 'string', value: 's', help: `size hint for every prompt: ${SIZE_NAMES.join(' | ')} (default: from the prompt, as mimir new)` },
    { name: 'fast', type: 'boolean', help: 'the adapter\'s cheapest model (as mimir new --fast)' },
    { name: 'full', type: 'boolean', help: 'the full loop instead of the lean launch (as mimir new --full)' },
    { name: 'once', type: 'boolean', help: 'write once: one call of the model, the engine reviews (as mimir new --once)' },
    { name: 'loop', type: 'boolean', help: 'the agent loop (as mimir new --loop)' },
    { name: 'fix', type: 'string', value: 'n', help: 'write once: corrections per prompt (as mimir new --fix)' },
    { name: 'effort', type: 'string', value: 'level', help: 'how hard the model should think (as mimir new --effort)' },
    { name: 'out', short: 'o', type: 'string', value: 'dir', help: 'where the runs go, one directory each (default mimir-bench/<time>)' },
  ],
  notes: [
    'Every run is a real generation: it costs what the table says. Runs are sequential, so wall times are comparable.',
    'Columns: verdict, API calls, turns, seconds, tokens (cache read / cache write / uncached input / output), cost, first review clean, looked, scene lines, sheet.',
    'A table is not the bar: open every sheet it lists.',
    'exit 0 = every run ready, 1 = at least one failed, 2 = usage or setup.',
  ],
}

export interface LeanNewOptions {
  /** --size, or null to take it from the prompt */
  size: ConceptSize | null
  /** the adapter's cheapest model */
  fast: boolean
  /** the full loop (skill, references, storyboard, cue sheet and filmstrip) instead of the lean launch */
  full: boolean
  /** --once / --loop, or null to take MIMIR_NEW_MODE, else the default */
  mode: NewMode | null
  /** --fix: corrections a write-once generation may ask for, or null for the default */
  fix: number | null
  /** --edit: an existing scene to change (write once) */
  edit: string | null
  /** --open: play the result when it is ready */
  open: boolean
  /** --effort, or null for the agent's default */
  effort: string | null
}

export const NEW_LEAN_FLAGS: FlagSpec[] = [
  { name: 'size', type: 'string', value: 's', help: `how big the concept is: ${SIZE_NAMES.map((n) => `${n} (${CONCEPT_SIZES[n].steps} steps, ${CONCEPT_SIZES[n].maxTurns} turns)`).join(', ')}; sets the step and turn limits (default: MIMIR_SIZE, else from the length of the prompt)` },
  { name: 'fast', type: 'boolean', help: 'use the adapter\'s cheapest model (a --model wins); cheaper, plainer compositions' },
  { name: 'full', type: 'boolean', help: 'the full loop through the skill (references, storyboard, two look rounds, cue sheet, filmstrip) instead of the one-page lean launch' },
  { name: 'once', type: 'boolean', help: `write once: the model answers with the scene (one call, no tools), the engine builds and reviews it and asks again only when the review finds something${DEFAULT_NEW_MODE === 'once' ? ' (the default)' : ''}` },
  { name: 'loop', type: 'boolean', help: `a headless agent runs the authoring loop itself and looks at the frames: several calls${DEFAULT_NEW_MODE === 'loop' ? ' (the default)' : ''}` },
  { name: 'fix', type: 'string', value: 'n', help: `write once: corrections the model may be asked for when the review finds something (default: MIMIR_FIX_ROUNDS, else ${DEFAULT_FIX_ROUNDS}; 0 = never)` },
  { name: 'edit', type: 'string', value: 'scene', help: 'write once: change this scene as the prompt says instead of writing a new one (one call)' },
  { name: 'open', type: 'boolean', help: 'play the scene when it is ready (as mimir open)' },
  { name: 'effort', type: 'string', value: 'level', help: 'how hard the model should think, in the agent\'s own words (low, medium, high, …); less is faster and cheaper (default: MIMIR_EFFORT, else mimir.config.json, else the adapter\'s)' },
]

export function parseSizeName(text: string, command: string, what = '--size'): ConceptSize {
  if ((SIZE_NAMES as readonly string[]).includes(text)) return text as ConceptSize
  const near = suggest(text, SIZE_NAMES)
  throw new UsageError(`${what} must be one of ${SIZE_NAMES.join(', ')} (got "${text}")` + (near.length ? `; did you mean ${near.join(', ')}?` : ''), command)
}

/** --once / --loop / --edit → the mode somebody asked for, or null. Both at once is a usage error. */
export function parseNewMode(p: Parsed): NewMode | null {
  const once = p.flags.once === true, loop = p.flags.loop === true || p.flags.full === true
  const edit = typeof p.flags.edit === 'string' && p.flags.edit !== ''
  if (once && loop) throw new UsageError(`give only one of --once and --loop${p.flags.full === true ? ' (--full is a loop)' : ''}`, p.command)
  if (edit && loop) throw new UsageError('--edit changes a scene in one call: it cannot be combined with --loop or --full', p.command)
  return once || edit ? 'once' : loop ? 'loop' : null
}

/** The mode of a run: the flag, then MIMIR_NEW_MODE, then the default. */
export function resolveNewMode(flag: NewMode | null, env: Record<string, string | undefined>): NewMode {
  if (flag !== null) return flag
  const named = env.MIMIR_NEW_MODE
  if (named === undefined || named === '') return DEFAULT_NEW_MODE
  if (!(NEW_MODES as readonly string[]).includes(named)) throw new UsageError(`MIMIR_NEW_MODE must be one of ${NEW_MODES.join(', ')} (got "${named}")`, 'new')
  return named as NewMode
}

export function leanNewOptions(p: Parsed): LeanNewOptions {
  const size = p.flags.size
  const fixText = typeof p.flags.fix === 'string' ? p.flags.fix : null
  const fix = fixText === null ? null : Number(fixText)
  if (fix !== null && (!Number.isInteger(fix) || fix < 0)) throw new UsageError(`--fix must be a whole number of at least 0 (got "${fixText}")`, p.command)
  return {
    size: typeof size === 'string' ? parseSizeName(size, p.command) : null, fast: p.flags.fast === true, full: p.flags.full === true,
    mode: parseNewMode(p), fix, edit: typeof p.flags.edit === 'string' && p.flags.edit !== '' ? p.flags.edit : null, open: p.flags.open === true,
    effort: typeof p.flags.effort === 'string' && p.flags.effort !== '' ? p.flags.effort : null,
  }
}
