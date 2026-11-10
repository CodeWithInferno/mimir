// Argument parsing for every `mimir` command. Pure: no I/O, no process access. Bad input throws UsageError.
import { NEW_SPEC, SERVE_SPEC, SKILL_SPEC } from './agents/specs.ts'
import { UsageError, suggest } from './errors.ts'
import { BENCH_SPEC, REVIEW_SPEC, leanNewOptions, type LeanNewOptions } from './lean-specs.ts'

export interface FlagSpec {
  name: string
  short?: string
  /**
   * boolean: no value · string: one value, last wins · list: comma separated and repeatable ·
   * optional: a switch that may carry a value, written --name or --name=value (never --name value)
   */
  type: 'boolean' | 'string' | 'list' | 'optional'
  /** placeholder shown in help, e.g. "WxH" */
  value?: string
  help: string
}

export interface CommandSpec {
  name: string
  summary: string
  usage: string
  args: string
  minArgs: number
  maxArgs: number
  flags: FlagSpec[]
  notes?: string[]
}

const COMMON: FlagSpec[] = [
  { name: 'json', type: 'boolean', help: 'compact JSON on stdout (default when stdout is not a terminal)' },
  { name: 'text', type: 'boolean', help: 'human-readable text on stdout even when it is not a terminal' },
  { name: 'help', short: 'h', type: 'boolean', help: 'show this help' },
]

const SET_FLAG: FlagSpec = { name: 'set', type: 'list', value: 'name=value', help: 'pin a parameter to a value (repeatable)' }

export const COMMANDS: Record<string, CommandSpec> = {
  check: {
    name: 'check',
    summary: 'run the scene headless and print its diagnostics',
    usage: 'mimir check <scene> [--json] [--all] [--describe]',
    args: '<scene>',
    minArgs: 1,
    maxArgs: 1,
    flags: [
      { name: 'all', type: 'boolean', help: 'print every diagnostic (default: at most 8, errors first)' },
      { name: 'describe', type: 'boolean', help: 'an explain() scene: also print its plain-text account (per step what is said, what each link points at, one line per block)' },
    ],
    notes: ['exit 0 = no errors, 1 = at least one error, 2 = usage or internal failure'],
  },
  shot: {
    name: 'shot',
    summary: 'render PNG frames, story sheets and filmstrips of the scene',
    usage:
      'mimir shot <scene> [--steps | --step 2 | --at 1.5,3 | --at crank=90 | --cues | --fine 2:4:12]\n' +
      '                  [--set name=value ...] [--views iso,front,top | --turntable] [--sheet] [--cols n]\n' +
      '                  [--debug ids] [--size 1280x720] [--scale 1] [--out dir]',
    args: '<scene>',
    minArgs: 1,
    maxArgs: 1,
    flags: [
      { name: 'steps', type: 'boolean', help: 'the end state of every step (default)' },
      { name: 'step', type: 'string', value: 'k', help: 'the end state of step k' },
      { name: 'at', type: 'list', value: 't|name=value', help: 'story times in seconds, or the moment the story brings a parameter to a value (crank=90)' },
      { name: 'cues', type: 'boolean', help: 'one frame per guide cue of the narration, when its mark has landed (writes a sheet)' },
      { name: 'fine', type: 'string', value: 't0:t1:n', help: 'a filmstrip: n evenly spaced frames from t0 to t1 seconds, to judge motion (writes a sheet)' },
      SET_FLAG,
      { name: 'views', type: 'list', value: 'a,b', help: 'render every frame from each named view (iso, front, side, top, …)' },
      { name: 'turntable', type: 'optional', value: 'n', help: 'render every frame from n camera angles around the subject (default 8: --turntable=8)' },
      { name: 'sheet', type: 'boolean', help: 'also write ONE story sheet: a captioned cell per frame, a row per chapter (the cheapest way to look)' },
      { name: 'cols', type: 'string', value: 'n', help: 'columns of the sheet (default: as many as keep a cell readable)' },
      { name: 'debug', type: 'string', value: 'mode', help: 'ids = every part outlined in its own colour + a legend colour → id; boxes; safe = the safe area' },
      { name: 'size', type: 'string', value: 'WxH', help: 'frame size in CSS px (default 1280x720)' },
      { name: 'scale', type: 'string', value: 'n', help: 'device scale factor (default 1)' },
      { name: 'out', short: 'o', type: 'string', value: 'dir', help: 'output directory (default .mimir/shots/<scene>)' },
    ],
    notes: [
      'stdout is the manifest: [{path, step, title, t, camera, width, height, sha256}] (camera = the view, or null), the sheet last.',
      'Optional fields: chapter, cue {index, verb, targets, words, land}, param {name, value}, sheet {cols, rows, frames, tokens}.',
      'Beside every frame: <name>.probes.json {scene, step, title, t, camera, params, probes[, legend]}; manifest.json in the directory.',
      'Looking costs about width x height / 750 tokens: one sheet of 1280 px is roughly 1 to 2 thousand.',
    ],
  },
  open: {
    name: 'open',
    summary: 'dev server with live reload; opens the browser',
    usage: 'mimir open <scene> [--port n] [--no-open]',
    args: '<scene>',
    minArgs: 1,
    maxArgs: 1,
    flags: [
      { name: 'port', type: 'string', value: 'n', help: 'port (default: MIMIR_PORT, else 4747, else any free one when that is taken)' },
      { name: 'no-open', type: 'boolean', help: 'do not launch the browser' },
    ],
    notes: ['a reload keeps the story time, the camera you dragged and the sliders you moved'],
  },
  export: {
    name: 'export',
    summary: 'write ONE self-contained HTML file, a video, or the transcript as an article',
    usage: 'mimir export <scene> [-o out.html] [--mp4 out.mp4] [--md out.md [--frames]] [--set name=value ...]',
    args: '<scene>',
    minArgs: 1,
    maxArgs: 1,
    flags: [
      { name: 'out', short: 'o', type: 'string', value: 'file', help: 'the HTML file: self-contained, offline, no network (checked by opening it from file://)' },
      { name: 'mp4', type: 'string', value: 'file', help: 'a video: every frame is seeked and piped to ffmpeg (needs ffmpeg on PATH or MIMIR_FFMPEG)' },
      { name: 'md', type: 'string', value: 'file', help: 'the transcript as markdown: chapters, steps, narration, notes' },
      { name: 'frames', type: 'boolean', help: 'with --md: a frame image per step, written next to the file' },
      { name: 'fps', type: 'string', value: 'n', help: 'video frames per second (default 30)' },
      { name: 'size', type: 'string', value: 'WxH', help: 'video frame size (default 1920x1080); frame size of --md --frames (default 1280x720)' },
      { name: 'crf', type: 'string', value: 'n', help: 'video quality, x264 constant rate factor 0..51, lower is better (default 16)' },
      { name: 'from', type: 'string', value: 't', help: 'video start, story seconds (default 0)' },
      { name: 'to', type: 'string', value: 't', help: 'video end, story seconds (default: the end of the story)' },
      { name: 'jobs', type: 'string', value: 'n', help: 'browser pages that render video frames in parallel (default 4)' },
      { name: 'fonts', type: 'string', value: 'used|all', help: 'HTML: embed the font files this scene loads (default), or every font of the viewer' },
      SET_FLAG,
    ],
    notes: ['at least one of -o, --mp4, --md is needed; they can be combined in one run'],
  },
  docs: {
    name: 'docs',
    summary: 'exact lookup into the typed reference and the topic guides',
    usage: 'mimir docs [symbol|module|topic]',
    args: '[symbol|module|topic]',
    minArgs: 0,
    maxArgs: 1,
    flags: [],
    notes: [
      'no argument: every public name by module, and the topic guides',
      'a symbol: its JSDoc, its declaration, and where an example scene uses it',
      "a module (core, r2d, kit …): its declarations, one line each; 'reference': every module that way, members included",
      'output is plain text unless --json is given',
    ],
  },
  examples: {
    name: 'examples',
    summary: 'list the example scenes, one line each; print the source of one',
    usage: 'mimir examples [name]',
    args: '[name]',
    minArgs: 0,
    maxArgs: 1,
    flags: [],
    notes: [
      'no argument: every example scene with its title and what it shows',
      'a name: the source of that scene on stdout (an agent reads it here, whatever directory it may read files from)',
      'the directory is <mimir>/examples, or MIMIR_EXAMPLES',
    ],
  },
  init: {
    name: 'init',
    summary: 'write a starter scene to edit',
    usage: 'mimir init <name> [-o dir] [--force]',
    args: '<name>',
    minArgs: 1,
    maxArgs: 1,
    flags: [
      { name: 'out', short: 'o', type: 'string', value: 'dir', help: 'directory to write into (default: the working directory)' },
      { name: 'force', type: 'boolean', help: 'overwrite an existing file' },
    ],
  },
  query: {
    name: 'query',
    summary: 'measure the scene: distances, contacts, bounds, visibility, state, probes',
    usage:
      'mimir query <scene> distance <a> <b> | contacts [id] | bounds <id> | visible <id> | state | probes\n' +
      '                   [--at t | --at name=value | --step k] [--set name=value ...] [--tolerance x]',
    args: '<scene> <what> [ids...]',
    minArgs: 2,
    maxArgs: 4,
    flags: [
      { name: 'at', type: 'string', value: 't|name=value', help: 'story time in seconds, or the moment the story brings a parameter to a value' },
      { name: 'step', type: 'string', value: 'k', help: 'the end state of step k (default: the end of the last step)' },
      SET_FLAG,
      { name: 'tolerance', type: 'string', value: 'x', help: 'contacts: boxes closer than this many units count as touching (default 0.01)' },
    ],
    notes: [
      'an id may name a point of a part: piston.top, wheel.pin',
      'JSON on stdout; every answer says where it comes from (basis) and what it does not prove (limits)',
    ],
  },
  new: NEW_SPEC,
  serve: SERVE_SPEC,
  skill: SKILL_SPEC,
  review: REVIEW_SPEC,
  bench: BENCH_SPEC,
}

export const COMMAND_NAMES = Object.keys(COMMANDS)

export type FlagValue = boolean | string | string[]

export interface Parsed {
  command: string
  args: string[]
  flags: Record<string, FlagValue>
  help: boolean
  /** --json was given */
  json: boolean
  /** --text was given */
  text: boolean
}

/** stdout format: JSON when asked for or when piped, text on a terminal or when --text is given. */
export function wantsJson(json: boolean, text: boolean, isTTY: boolean): boolean {
  return text ? false : json || !isTTY
}

export type TopLevel =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'command'; command: string; rest: string[] }

/** First pass: which command, or top-level --help / --version. */
export function parseTopLevel(argv: readonly string[]): TopLevel {
  const first = argv[0]
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    const topic = first === 'help' ? argv[1] : undefined
    if (topic !== undefined && COMMANDS[topic]) return { kind: 'command', command: topic, rest: ['--help'] }
    return { kind: 'help' }
  }
  if (first === '--version' || first === '-v' || first === '-V' || first === 'version') return { kind: 'version' }
  if (first.startsWith('-')) throw new UsageError(`expected a command before "${first}"`)
  if (!COMMANDS[first]) {
    const near = suggest(first, COMMAND_NAMES)
    throw new UsageError(
      `unknown command "${first}"` + (near.length ? `; did you mean ${near.join(', ')}?` : '') +
        ` (commands: ${COMMAND_NAMES.join(', ')})`,
    )
  }
  return { kind: 'command', command: first, rest: argv.slice(1) }
}

/** Generic flag parser driven by the command's spec. */
export function parseFlags(spec: CommandSpec, argv: readonly string[]): Parsed {
  const all = [...spec.flags, ...COMMON]
  const byName = new Map(all.map((f) => [f.name, f]))
  const byShort = new Map(all.filter((f) => f.short).map((f) => [f.short!, f]))
  const flags: Record<string, FlagValue> = {}
  const args: string[] = []
  const fail = (msg: string): never => {
    throw new UsageError(msg, spec.name)
  }

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!
    if (tok === '--') {
      args.push(...argv.slice(i + 1))
      break
    }
    if (!tok.startsWith('-') || tok === '-' || /^-\d/.test(tok)) {
      args.push(tok)
      continue
    }
    let flag: FlagSpec | undefined
    let inline: string | undefined
    let shown: string
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=')
      const name = eq < 0 ? tok.slice(2) : tok.slice(2, eq)
      inline = eq < 0 ? undefined : tok.slice(eq + 1)
      shown = `--${name}`
      flag = byName.get(name)
      if (!flag) {
        const near = suggest(name, [...byName.keys()])
        fail(
          `unknown option ${shown} for "mimir ${spec.name}"` +
            (near.length ? `; did you mean ${near.map((n) => `--${n}`).join(', ')}?` : ''),
        )
      }
    } else {
      const name = tok.slice(1, 2)
      inline = tok.length > 2 ? tok.slice(tok[2] === '=' ? 3 : 2) : undefined
      shown = `-${name}`
      flag = byShort.get(name)
      if (!flag) fail(`unknown option ${shown} for "mimir ${spec.name}"`)
    }
    const f = flag!
    if (f.type === 'optional') {
      // a switch that may carry a value: only the inline form, so the next token is never swallowed
      flags[f.name] = inline === undefined ? true : inline
      continue
    }
    if (f.type === 'boolean') {
      if (inline === undefined || inline === 'true') flags[f.name] = true
      else if (inline === 'false') flags[f.name] = false
      else fail(`${shown} takes no value (got "${inline}")`)
      continue
    }
    let value = inline
    if (value === undefined) {
      const next = argv[i + 1]
      if (next === undefined || (next.startsWith('--') && next.length > 2)) {
        fail(`${shown} needs a value${f.value ? ` (${shown} ${f.value})` : ''}`)
      }
      value = next!
      i++
    }
    if (f.type === 'string') flags[f.name] = value
    else {
      const prev = (flags[f.name] as string[] | undefined) ?? []
      const parts = value.split(',').map((s) => s.trim()).filter((s) => s !== '')
      if (parts.length === 0) fail(`${shown} needs a value${f.value ? ` (${shown} ${f.value})` : ''}`)
      flags[f.name] = [...prev, ...parts]
    }
  }

  const help = flags.help === true
  if (!help) {
    if (args.length < spec.minArgs) fail(`missing argument: ${spec.args}`)
    if (args.length > spec.maxArgs) {
      fail(`unexpected argument "${args[spec.maxArgs]}" (mimir ${spec.name} takes ${spec.args || 'no arguments'})`)
    }
  }
  if (flags.json === true && flags.text === true) fail('use only one of --json and --text')
  return { command: spec.name, args, flags, help, json: flags.json === true, text: flags.text === true }
}

// ── typed options ────────────────────────────────────────────────────────────────────────────────

export interface Size { width: number; height: number }
export type ParamValue = number | boolean | string
export interface ParamSet { name: string; value: ParamValue }
/** One --at item: a story time, or "the moment the story brings this parameter to this value". */
export type AtItem = { kind: 'time'; t: number } | { kind: 'param'; name: string; value: ParamValue }
export type FrameMode =
  | { kind: 'steps' }
  | { kind: 'at'; items: AtItem[] }
  | { kind: 'step'; step: number }
  | { kind: 'cues' }
  | { kind: 'fine'; t0: number; t1: number; count: number }

export interface CheckOptions { scene: string; all: boolean; json: boolean; describe: boolean }
export interface ShotOptions {
  scene: string
  mode: FrameMode
  sets: ParamSet[]
  views: string[]
  /** number of camera angles around the subject, or null */
  turntable: number | null
  sheet: boolean
  /** columns of the sheet, or null for the default */
  cols: number | null
  debug: string | null
  size: Size
  /** true when --size was given: the contact sheet may then be as wide as one frame */
  sizeExplicit: boolean
  scale: number
  out: string | null
  json: boolean
}
export interface OpenOptions { scene: string; port: number | null; open: boolean; json: boolean }
export interface ExportOptions {
  scene: string
  /** the HTML file, or null */
  out: string | null
  mp4: string | null
  md: string | null
  /** with md: a frame per step */
  frames: boolean
  fps: number
  /** null = the default of what is being made (video 1920x1080, article frames 1280x720) */
  size: Size | null
  crf: number
  from: number | null
  to: number | null
  jobs: number
  fonts: 'used' | 'all'
  sets: ParamSet[]
  json: boolean
}
export interface DocsOptions { query: string | null; json: boolean }
export interface ExamplesOptions { /** the example to print, or null for the list */ name: string | null; json: boolean }
export interface InitOptions { name: string; out: string | null; force: boolean; json: boolean }
export interface QueryOptions {
  scene: string
  what: QueryKind
  args: string[]
  at: AtItem | null
  step: number | null
  sets: ParamSet[]
  tolerance: number
  json: boolean
}
export interface NewOptions extends LeanNewOptions {
  prompt: string
  out: string | null
  /** null = MIMIR_AGENT, else the default adapter */
  agent: string | null
  model: string | null
  maxTurns: number | null
  maxUsd: number | null
  system: string | null
  resume: string | null
  /** seconds, or null for the default */
  timeout: number | null
  json: boolean
}

export const DEFAULT_SIZE: Size = { width: 1280, height: 720 }
/** camera angles of --turntable when no number is given */
export const TURNTABLE_VIEWS = 8
/** most frames one --fine filmstrip may ask for */
export const FINE_MAX_FRAMES = 240
/** video defaults (--fps, --size, --crf, --jobs) */
export const VIDEO_FPS = 30
export const VIDEO_SIZE: Size = { width: 1920, height: 1080 }
export const VIDEO_CRF = 16
export const VIDEO_JOBS = 4
/** contacts: two boxes closer than this many scene units count as touching (--tolerance) */
export const CONTACT_TOLERANCE = 0.01
export const QUERY_KINDS = ['distance', 'contacts', 'bounds', 'visible', 'state', 'probes'] as const
export type QueryKind = (typeof QUERY_KINDS)[number]
/** how many ids each query takes: [min, max] */
export const QUERY_ARITY: Record<QueryKind, [number, number]> = {
  distance: [2, 2], contacts: [0, 1], bounds: [1, 1], visible: [1, 1], state: [0, 0], probes: [0, 0],
}

const str = (v: FlagValue | undefined): string | null => (typeof v === 'string' ? v : null)
const list = (v: FlagValue | undefined): string[] => (Array.isArray(v) ? v : [])

function number(text: string, what: string, command: string): number {
  const n = Number(text)
  if (text.trim() === '' || !Number.isFinite(n)) throw new UsageError(`${what} must be a number (got "${text}")`, command)
  return n
}

export function parseSize(text: string, command = 'shot'): Size {
  const m = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(text.trim())
  if (!m) throw new UsageError(`--size must look like 1280x720 (got "${text}")`, command)
  const width = Number(m[1])
  const height = Number(m[2])
  if (width < 16 || height < 16 || width > 8192 || height > 8192) {
    throw new UsageError(`--size must be between 16x16 and 8192x8192 (got "${text}")`, command)
  }
  return { width, height }
}

/** the debug overlays of the viewer (host.debug): ids = boxes + names + visible points, boxes, safe = the safe area */
export const DEBUG_MODES = ['ids', 'boxes', 'safe']

function paramValue(raw: string): ParamValue {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return Number.isFinite(Number(raw)) ? Number(raw) : raw
}

export function parseSet(text: string, command = 'shot'): ParamSet {
  const eq = text.indexOf('=')
  const name = eq < 0 ? '' : text.slice(0, eq).trim()
  const raw = eq < 0 ? '' : text.slice(eq + 1).trim()
  if (name === '' || raw === '') throw new UsageError(`--set must look like name=value (got "${text}")`, command)
  return { name, value: paramValue(raw) }
}

/** One --at item: `1.5` is a story time, `crank=90` the moment the story brings the parameter there. */
export function parseAt(text: string, command = 'shot'): AtItem {
  const eq = text.indexOf('=')
  if (eq >= 0) {
    const name = text.slice(0, eq).trim()
    const raw = text.slice(eq + 1).trim()
    if (name === '' || raw === '') throw new UsageError(`--at takes seconds or name=value (got "${text}")`, command)
    return { kind: 'param', name, value: paramValue(raw) }
  }
  const t = number(text, '--at', command)
  if (t < 0) throw new UsageError(`--at times must be >= 0 (got ${t})`, command)
  return { kind: 'time', t }
}

/** `t0:t1:n` of --fine. */
export function parseFine(text: string, command = 'shot'): { t0: number; t1: number; count: number } {
  const parts = text.split(':').map((p) => p.trim())
  const shape = `--fine must look like t0:t1:n, e.g. 2:4:12 (got "${text}")`
  if (parts.length !== 3 || parts.some((p) => p === '' || !Number.isFinite(Number(p)))) throw new UsageError(shape, command)
  const [t0, t1, count] = parts.map(Number) as [number, number, number]
  if (t0 < 0 || t1 <= t0) throw new UsageError(`--fine needs 0 <= t0 < t1 (got "${text}")`, command)
  if (!Number.isInteger(count) || count < 2 || count > FINE_MAX_FRAMES) throw new UsageError(`--fine takes 2 to ${FINE_MAX_FRAMES} frames (got "${parts[2]}")`, command)
  return { t0, t1, count }
}

function wholeNumber(text: string, what: string, command: string, min: number, max: number): number {
  const n = number(text, what, command)
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`${what} must be a whole number from ${min} to ${max} (got "${text}")`, command)
  return n
}

export function toCheckOptions(p: Parsed): CheckOptions {
  return { scene: p.args[0]!, all: p.flags.all === true, json: p.json, describe: p.flags.describe === true }
}

export function toShotOptions(p: Parsed): ShotOptions {
  const cmd = 'shot'
  const f = p.flags
  const given = [f.steps === true, f.at !== undefined, f.step !== undefined, f.cues === true, f.fine !== undefined].filter(Boolean).length
  if (given > 1) throw new UsageError('use only one of --steps, --at, --step, --cues, --fine', cmd)
  let mode: FrameMode = { kind: 'steps' }
  if (f.at !== undefined) mode = { kind: 'at', items: list(f.at).map((t) => parseAt(t, cmd)) }
  else if (f.step !== undefined) {
    const step = number(str(f.step)!, '--step', cmd)
    if (!Number.isInteger(step) || step < 0) throw new UsageError(`--step must be a whole step number (got "${str(f.step)}")`, cmd)
    mode = { kind: 'step', step }
  } else if (f.cues === true) mode = { kind: 'cues' }
  else if (f.fine !== undefined) mode = { kind: 'fine', ...parseFine(str(f.fine)!, cmd) }
  const sizeText = str(f.size)
  const scaleText = str(f.scale)
  const scale = scaleText === null ? 1 : number(scaleText, '--scale', cmd)
  if (scale < 0.25 || scale > 4) throw new UsageError(`--scale must be between 0.25 and 4 (got ${scale})`, cmd)
  const sets = list(f.set).map((s) => parseSet(s, cmd))
  const views = list(f.views)
  const debug = str(f.debug)
  if (debug !== null && !DEBUG_MODES.includes(debug)) throw new UsageError(`--debug must be one of ${DEBUG_MODES.join(', ')} (got "${debug}")`, cmd)
  for (const v of views) {
    if (!/^[\w-]+$/.test(v)) throw new UsageError(`--views takes view names such as iso,front (got "${v}")`, cmd)
  }
  let turntable: number | null = null
  if (f.turntable !== undefined && f.turntable !== false) {
    turntable = f.turntable === true ? TURNTABLE_VIEWS : wholeNumber(String(f.turntable), '--turntable', cmd, 2, 72)
    if (views.length) throw new UsageError('use only one of --views and --turntable', cmd)
  }
  const colsText = str(f.cols)
  return {
    scene: p.args[0]!,
    mode,
    sets,
    views,
    turntable,
    // a filmstrip and a cue sheet are what those modes are for: the sheet is always written
    sheet: f.sheet === true || mode.kind === 'cues' || mode.kind === 'fine',
    cols: colsText === null ? null : wholeNumber(colsText, '--cols', cmd, 1, 24),
    debug,
    size: sizeText === null ? { ...DEFAULT_SIZE } : parseSize(sizeText, cmd),
    sizeExplicit: sizeText !== null,
    scale,
    out: str(f.out),
    json: p.json,
  }
}

export function toOpenOptions(p: Parsed): OpenOptions {
  const portText = str(p.flags.port)
  let port: number | null = null
  if (portText !== null) {
    port = number(portText, '--port', 'open')
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port must be 0..65535 (got "${portText}")`, 'open')
  }
  return { scene: p.args[0]!, port, open: p.flags['no-open'] !== true, json: p.json }
}

export function toExportOptions(p: Parsed): ExportOptions {
  const cmd = 'export'
  const f = p.flags
  const out = str(f.out)
  const mp4 = str(f.mp4)
  const md = str(f.md)
  if (out === null && mp4 === null && md === null) throw new UsageError('missing -o <out.html> (or --mp4 <out.mp4>, or --md <out.md>)', cmd)
  if (f.frames === true && md === null) throw new UsageError('--frames belongs to --md <out.md> (a frame image per step of the article)', cmd)
  for (const name of ['fps', 'crf', 'from', 'to', 'jobs'] as const) {
    if (f[name] !== undefined && mp4 === null) throw new UsageError(`--${name} belongs to --mp4 <out.mp4>`, cmd)
  }
  const size = str(f.size)
  if (size !== null && mp4 === null && !(md !== null && f.frames === true)) throw new UsageError('--size belongs to --mp4 or to --md --frames', cmd)
  const fonts = str(f.fonts) ?? 'used'
  if (fonts !== 'used' && fonts !== 'all') throw new UsageError(`--fonts must be used or all (got "${fonts}")`, cmd)
  const from = str(f.from) === null ? null : number(str(f.from)!, '--from', cmd)
  const to = str(f.to) === null ? null : number(str(f.to)!, '--to', cmd)
  if ((from !== null && from < 0) || (to !== null && to <= (from ?? 0))) throw new UsageError('--from and --to are story seconds with 0 <= from < to', cmd)
  const fps = str(f.fps) === null ? VIDEO_FPS : number(str(f.fps)!, '--fps', cmd)
  if (fps < 1 || fps > 240) throw new UsageError(`--fps must be between 1 and 240 (got ${fps})`, cmd)
  const crf = str(f.crf) === null ? VIDEO_CRF : number(str(f.crf)!, '--crf', cmd)
  if (crf < 0 || crf > 51) throw new UsageError(`--crf must be between 0 and 51 (got ${crf})`, cmd)
  const parsedSize = size === null ? null : parseSize(size, cmd)
  if (parsedSize && mp4 !== null && (parsedSize.width % 2 || parsedSize.height % 2)) throw new UsageError(`--size for a video must have an even width and height (got "${size}")`, cmd)
  return {
    scene: p.args[0]!, out, mp4, md, frames: f.frames === true, fps, size: parsedSize, crf, from, to,
    jobs: str(f.jobs) === null ? VIDEO_JOBS : wholeNumber(str(f.jobs)!, '--jobs', cmd, 1, 16),
    fonts, sets: list(f.set).map((s) => parseSet(s, cmd)), json: p.json,
  }
}

export function toDocsOptions(p: Parsed): DocsOptions {
  return { query: p.args[0] ?? null, json: p.json }
}

export function toExamplesOptions(p: Parsed): ExamplesOptions {
  return { name: p.args[0] ?? null, json: p.json }
}

export function toInitOptions(p: Parsed): InitOptions {
  const name = p.args[0]!.trim()
  // the name becomes a file name: letters, digits, dash, underscore, dot
  if (!/^[A-Za-z0-9][\w.-]*$/.test(name.replace(/\.scene\.js$/i, '').replace(/\.js$/i, ''))) {
    throw new UsageError(`the name must be a file name made of letters, digits, "-", "_" (got "${p.args[0]}")`, 'init')
  }
  return { name, out: str(p.flags.out), force: p.flags.force === true, json: p.json }
}

export function toQueryOptions(p: Parsed): QueryOptions {
  const cmd = 'query'
  const what = p.args[1]!
  if (!(QUERY_KINDS as readonly string[]).includes(what)) {
    const near = suggest(what, QUERY_KINDS)
    throw new UsageError(`unknown query "${what}"` + (near.length ? `; did you mean ${near.join(', ')}?` : '') + ` (one of: ${QUERY_KINDS.join(', ')})`, cmd)
  }
  const kind = what as QueryKind
  const args = p.args.slice(2)
  const [min, max] = QUERY_ARITY[kind]
  if (args.length < min || args.length > max) {
    const takes = max === 0 ? 'no ids' : min === max ? `${min} id${min === 1 ? '' : 's'}` : `${min} to ${max} ids`
    throw new UsageError(`query ${kind} takes ${takes} (got ${args.length}${args.length ? `: ${args.join(' ')}` : ''})`, cmd)
  }
  const f = p.flags
  if (f.at !== undefined && f.step !== undefined) throw new UsageError('use only one of --at and --step', cmd)
  let step: number | null = null
  if (f.step !== undefined) {
    step = number(str(f.step)!, '--step', cmd)
    if (!Number.isInteger(step) || step < 0) throw new UsageError(`--step must be a whole step number (got "${str(f.step)}")`, cmd)
  }
  const tolText = str(f.tolerance)
  const tolerance = tolText === null ? CONTACT_TOLERANCE : number(tolText, '--tolerance', cmd)
  if (tolerance < 0) throw new UsageError(`--tolerance must be >= 0 (got ${tolerance})`, cmd)
  return {
    scene: p.args[0]!, what: kind, args, at: f.at === undefined ? null : parseAt(str(f.at)!, cmd), step,
    sets: list(f.set).map((s) => parseSet(s, cmd)), tolerance, json: p.json,
  }
}

export function toNewOptions(p: Parsed): NewOptions {
  const cmd = 'new'
  const f = p.flags
  const prompt = p.args[0]!.trim()
  if (prompt === '') throw new UsageError('the prompt is empty', cmd)
  const positive = (name: string): number | null => {
    const text = str(f[name])
    if (text === null) return null
    const n = number(text, `--${name}`, cmd)
    if (n <= 0) throw new UsageError(`--${name} must be greater than 0 (got "${text}")`, cmd)
    return n
  }
  const maxTurns = positive('max-turns')
  if (maxTurns !== null && !Number.isInteger(maxTurns)) throw new UsageError(`--max-turns must be a whole number (got "${str(f['max-turns'])}")`, cmd)
  return {
    prompt, out: str(f.out), agent: str(f.agent), model: str(f.model), maxTurns, maxUsd: positive('budget-usd'),
    system: str(f.system), resume: str(f.resume), timeout: positive('timeout'), json: p.json, ...leanNewOptions(p),
  }
}

// ── help text ────────────────────────────────────────────────────────────────────────────────────

export function commandHelp(spec: CommandSpec): string {
  const rows = [...spec.flags, ...COMMON].map((f) => {
    const left = `${f.short ? `-${f.short}, ` : '    '}--${f.name}${f.value ? (f.type === 'optional' ? `[=${f.value}]` : ` ${f.value}`) : ''}`
    return [left, f.help] as const
  })
  const pad = Math.max(...rows.map((r) => r[0].length))
  const lines = [`mimir ${spec.name} - ${spec.summary}`, '', `usage: ${spec.usage}`, '', 'options:']
  for (const [left, help] of rows) lines.push(`  ${left.padEnd(pad)}  ${help}`)
  for (const n of spec.notes ?? []) lines.push('', n)
  return lines.join('\n') + '\n'
}

export function topHelp(version: string): string {
  const pad = Math.max(...COMMAND_NAMES.map((n) => n.length))
  const lines = [
    `mimir ${version} - explainer / simulation engine`,
    '',
    'usage: mimir <command> [options]',
    '',
    'commands:',
    ...COMMAND_NAMES.map((n) => `  ${n.padEnd(pad)}  ${COMMANDS[n]!.summary}`),
    '',
    'the loop: mimir check <scene>  ->  mimir shot <scene> --sheet  ->  look  ->  fix  ->  mimir open <scene>',
    '',
    'stdout carries the result only (compact JSON when piped or with --json); logs go to stderr.',
    'exit codes: 0 clean, 1 errors found, 2 usage or internal failure.',
    '',
    'environment: MIMIR_CHROME (browser binary), MIMIR_FFMPEG (ffmpeg binary), MIMIR_VIEWER_ROOT (viewer directory),',
    '  MIMIR_TIMEOUT (ms a scene may take to load), MIMIR_PORT (mimir open), MIMIR_EXAMPLES, MIMIR_TOPICS (directories),',
    '  MIMIR_AGENT, MIMIR_AGENT_COMMAND, MIMIR_MODEL, MIMIR_MAX_TURNS, MIMIR_BUDGET_USD, MIMIR_GEN_SYSTEM, MIMIR_CONFIG (mimir new, mimir serve).',
    '',
    'mimir <command> --help   details of one command',
    'mimir --version',
  ]
  return lines.join('\n') + '\n'
}
