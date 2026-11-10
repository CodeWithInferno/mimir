// Host protocol: window.__mimir (DESIGN §9) and the viewer boot sequence.
//   viewer.html?scene=<module url>[&headless=1][&t=<tau>][&step=<k>][&set=name:value,...][&view=<name>][&debug=<mode>]
//              [&autoplay=0|1][&mode=<name>][&config=<url of mimir.config.json>][&features=<modules>]
// Headless: nothing advances on its own. Time moves only through seek(); frame() resolves once the frame for the
// current state has been drawn and presented; play() does nothing. A scene that fails to import still resolves
// `ready` (info().fatal). With a person watching, the story starts playing once it is ready (see `autoplay`).
import {
  allManifests, closeConfigGroup, closest, compile, defineConfig, lookControls, FONT_MONO, FONT_SANS, FRAME_H, FRAME_W, isSceneDef, parseStack, playerFactory, projectConfig, Runtime, SceneModel, setProjectConfig, setPublicNames, sortDiags, STEP_END_EPSILON, VIEWS, kindOf,
  type Diag, type NarrationSpanRec, type ParamValue, type PlayerInstance, type PlayerTransport, type Pose, type RuntimeEvent, type SceneDef,
} from '../core/index.ts'

// the version of the package, compiled in by the build (scripts/build.ts reads package.json); 'dev' when the sources run unbundled
declare const __MIMIR_VERSION__: string | undefined
export const VERSION: string = typeof __MIMIR_VERSION__ === 'string' ? __MIMIR_VERSION__ : 'dev'
export { STEP_END_EPSILON }

/** How the viewer starts and plays. A scene or a project changes them like any setting ('viewer.autoplay': false). */
export const VIEWER_DEFAULTS = {
  /** start playing as soon as the scene is ready (never in headless mode; `?autoplay=0` / `?autoplay=1` decide for one page; a page opened at a moment with `t=` or `step=` stays there; a person who asked for reduced motion is not played at unless the page says autoplay=1) */
  autoplay: true,
  /** the mode the viewer opens in (`?mode=` decides for one page); the player defines the modes, 'video' plays the story full-bleed */
  mode: 'video',
  /** story seconds per second of wall time while playing */
  speed: 1,
  /** the most story time one displayed frame may advance, in seconds: a tab that was in the background resumes where it was instead of jumping */
  maxStep: 0.1,
}
defineConfig('viewer', VIEWER_DEFAULTS, { min: 0 })
closeConfigGroup('viewer')

/** One sentence of the narration: as written (with its spans), as spoken, when, and where its spans are in the spoken text. */
export interface NarrationInfo { text: string; plain: string; /** absolute story time */ t0: number; duration: number; spans: NarrationSpanRec[] }
export interface StepInfo {
  /** 1-based */ index: number; title: string; t0: number; t1: number; /** seconds of closing hold */ hold: number
  /** the spoken sentences (plain) */ say: string[]
  /** 1-based chapter number, null when the scene has no chapters (or the step comes before the first) */ chapter: number | null
}
export interface ChapterInfo { /** 1-based */ index: number; title: string; t0: number; t1: number; /** 1-based numbers of its steps */ steps: number[]; /** ids of the objects that stay on stage when it opens */ keep: string[] }
/** One entry per step, in order: everything read mode shows (DESIGN §3.4). */
export interface TranscriptEntry { /** 1-based step number */ step: number; title: string; /** 1-based chapter number, or null */ chapter: number | null; chapterTitle: string | null; t0: number; t1: number; narration: NarrationInfo[]; /** st.note(markdown) texts joined by blank lines; null when the step has none */ note: string | null }
export interface ParamInfo {
  name: string; kind: 'number' | 'toggle' | 'choice'; value: ParamValue; min: number; max: number; step: number; unit: string; label: string; options: string[]
  /** the param goes round (an angle): value and value + period show the same thing */ cyclic: boolean
  /** length of one cycle in the param's unit; 0 when it is not cyclic */ period: number
  /** heading of its row in a viewer ('' = none) */ group: string
  /** only the story drives it: no control in the viewer */ hidden: boolean
}
export interface PartInfo { id: string; label: string; kind: string; space: '2d' | '3d'; line: number | null }
export interface Manifest {
  version: string
  title: string
  subtitle: string
  file: string | null
  duration: number
  frame: { width: number; height: number }
  /** px size of the stage right now */
  stage: { width: number; height: number }
  steps: StepInfo[]
  /** chapters of a long explanation (empty when the scene has none) */
  chapters: ChapterInfo[]
  /** the whole explanation as text: one entry per step */
  transcript: TranscriptEntry[]
  /** lazy chunks this scene needs, in load order ('3d', a module's own …) */
  chunks: string[]
  /** on-demand modules whose API was loaded for this scene ('kit', 'plot' …), in load order */
  features: string[]
  params: ParamInfo[]
  parts: PartInfo[]
  views: string[]
  /** view modes a viewer can hold by hand with setLook(): the channel and the word its control carries */
  looks: { channel: string; label: string }[]
  has3d: boolean
  /** 3D panel in frame units (min corner), or null */
  viewport: { x: number; y: number; width: number; height: number } | null
  headless: boolean
  /** the story starts playing when the page is ready (false in headless mode, with `?autoplay=0`, with 'viewer.autoplay': false, or for a person who prefers reduced motion) */
  autoplay: boolean
  /** the mode the viewer opens in: `?mode=`, else the setting 'viewer.mode' ('video') */
  mode: string
  /** the settings in force that are not the registered defaults: what the project file and the scene set, by dotted key */
  config: { /** name of the project file the page was given, or null */ project: string | null; values: Record<string, unknown> }
  /** problems found while building the scene (before any check sampling) */
  problems: { errors: number; warnings: number }
  fatal: { message: string; file: string | null; line: number | null; stack?: string } | null
  /** fields added by modules with defineManifest(key, fn) */
  [key: string]: unknown
}
export interface HostState { tau: number; /** 1-based, 0 when the scene has no steps */ step: number; u: number; duration: number; params: Record<string, ParamValue>; overridden: string[]; caption: string; userView: boolean; /** the story is advancing on its own (host.play()) */ playing: boolean; /** story seconds per second while playing */ speed: number }
export interface MimirHost {
  /** resolves when the scene is built, mounted and its first frame is drawn (also when the scene failed: see info().fatal) */
  ready: Promise<void>
  info(): Manifest
  seek(tau: number): void
  setParam(name: string, value: ParamValue): void
  setView(view: string | Partial<Pose> | null): void
  /** resolves after the frame for the current state is fully rendered */
  frame(): Promise<void>
  /**
   * check diagnostics in JSON form (loads the check chunk on first use). By default every rule runs over the
   * sampling plan of DESIGN §7; { sample: false } (or { static: true }) returns only what the build recorded,
   * without rendering anything; { rules: [...] } limits the run to those codes.
   */
  diagnostics(opts?: { sample?: boolean; static?: boolean; rules?: string[] }): Promise<Diag[]>
  probes(): Record<string, number>
  /**
   * A measured answer about the scene (loads the check chunk on first use): query('distance', ['piston', 'head']) about
   * the state on screen, or query({ what, args, step | t, set }) about any moment and slider setting. what = distance |
   * contacts | bounds | visible | state | probes | coverage. A bad request is answered with { error, fix }.
   */
  query(what: string | Record<string, unknown>, ids?: string[], options?: Record<string, unknown>): Promise<Record<string, unknown>>
  /** 'ids' | 'boxes' | 'safe' | null. Resolves once the overlay is there (it is loaded with the dev chunk on first use). */
  debug(mode: string | null): Promise<void>
  // ── beyond DESIGN §9: what the player needs ──
  state(): HostState
  clearParam(name?: string): void
  on(event: RuntimeEvent | HostEvent, fn: (arg: any) => void): () => void
  /**
   * Let the story advance on its own from where it is (from the start when it is at the end), at `speed` story seconds
   * per second. The wall clock only chooses which story time is shown: every frame is still state(τ, params). Does
   * nothing in headless mode. Events: 'play', then 'pause' (with { ended: true } when the story ran to its end).
   * Pinning a param (setParam) pauses: while the story plays, the params are the story's.
   */
  play(opts?: { speed?: number }): void
  pause(): void
  readonly playing: boolean
  /** id of the top-most object at a stage-px point, or null */
  pick(x: number, y: number): string | null
  /** Hold a view mode by hand (info().looks): amount 0..1 of its "on" value, whatever the story says; null gives it back to the story. */
  setLook(channel: string, amount: number | null): void
  /** Where an object is on the stage right now, in stage px: its box, and a point of it that is really visible (3D); null when it is hidden or unknown. */
  locate(id: string): { x: number; y: number; width: number; height: number; at: { x: number; y: number } | null } | null
  /** Light one object as under the pointer (null: none). */
  hover(id: string | null): void
  /** The 3D camera of the frame on screen (null without a 3D panel): what setView() takes, so a viewer can ease from here to there. */
  camera(): Pose | null
  readonly version: string
}

/** 'ready' fires once; 'play' and 'pause' follow host.play() / host.pause() and the end of the story */
export type HostEvent = 'ready' | 'play' | 'pause'
/** The parsed mimir.config.json of a project: `defaults` are settings for every scene (the config store); other keys belong to the CLI. */
export interface ProjectConfig { defaults?: unknown; [key: string]: unknown }

export interface BootOptions {
  scene?: string | SceneDef
  headless?: boolean
  /** start playing when ready: `?autoplay=0` / `?autoplay=1`. Unset: the setting 'viewer.autoplay', not on a page opened at a moment (`t=`, `step=`), and not for a person who prefers reduced motion. Never in headless mode. */
  autoplay?: boolean
  /** the mode the viewer opens in (`?mode=`); unset: the setting 'viewer.mode' */
  mode?: string
  /**
   * The project's config: the parsed mimir.config.json, or the URL of one (`?config=<url>`). A page that cannot fetch
   * (an export) is given the object instead: `globalThis.__mimirConfig = { defaults: { … } }` before boot().
   */
  config?: string | ProjectConfig
  t?: number
  step?: number
  set?: Record<string, ParamValue>
  view?: string
  debug?: string
  /** where the stage goes when there is no player (default: the whole window) */
  root?: HTMLElement
  /** base URL of the lazy chunks (default: next to this bundle) */
  chunkBase?: string
  /** loaders of the lazy chunks by name, generated by the build (src/_generated/chunks.ts): literal imports next to this bundle */
  chunks?: Record<string, () => Promise<unknown>>
  api?: Record<string, unknown>
  /** on-demand modules, generated by the build (src/_generated/chunks.ts): the chunk with a module's API and the names that ask for it */
  featureTable?: FeatureInfo[]
  /** makes the API of a loaded on-demand module part of the public names (src/_generated/core.ts) */
  install?: (names: Record<string, unknown>) => void
  /** the on-demand modules to load, by name, instead of reading them off the scene source (`?features=kit,plot`; an export says it this way) */
  features?: string[]
}
/** An on-demand module: `chunk` holds its API; a scene needs it when its source uses one of `names` or calls one of `methods`. */
export interface FeatureInfo { module: string; chunk: string; names: string[]; methods: string[]; /** the dev chunk with the module's check rules, when it has any: loaded with `check` only for scenes that use the module */ check?: string; /** the on-demand modules this one is built on: a scene that uses this module uses them too */ uses?: string[] }

/** The modules a scene uses, with the modules those are built on (and so on): what it draws with, whoever named it. */
export function featureClosure(loaded: readonly string[], table: readonly FeatureInfo[]): string[] {
  const out = new Set(loaded)
  for (let grew = true; grew; ) {
    grew = false
    for (const f of table) if (out.has(f.module)) for (const m of f.uses ?? []) if (!out.has(m)) { out.add(m); grew = true }
  }
  return [...out]
}

/** query parameter the host adds to a scene URL when it must import the module a second time */
export const RETRY_PARAM = 'mimir-retry'
const sansRetry = (file: string | null): string | null => (file === null ? null : file.replace(new RegExp(`[?&]${RETRY_PARAM}=\\d+`), ''))
/** How many source files of one scene (the scene and what it imports) are read to find the modules it uses. */
export const FEATURE_SCAN_FILES = 64
/** The on-demand modules a piece of scene source uses: one of the module's public names as a word, or one of its methods as a call. */
export function featuresIn(source: string, table: readonly FeatureInfo[]): string[] {
  const code = codeOnly(source)
  // a name is used where it stands as a word of its own, not as a member of something else (`info.guide`, `g.nodes`)
  const words = new Set([...code.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)].map((m) => m[0]))
  // a name the scene declares itself (`const queue = rect(…)`) is its own object, not the public function of that name
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) words.delete(m[1]!)
  return table.filter((f) => f.names.some((n) => words.has(n)) || f.methods.some((m) => new RegExp(`\\.\\s*${m}\\s*\\(`).test(code))).map((f) => f.module)
}
/** Source without its comments and without the text of its strings (the code inside `${…}` of a template stays): words that are only spoken or explained are not uses of a name. */
export function codeOnly(source: string): string {
  let out = ''
  const depth: number[] = [] // open `${` of the templates we are inside, as brace counts
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!, next = source[i + 1]
    if (ch === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; out += '\n'; continue }
    if (ch === '/' && next === '*') { i = source.indexOf('*/', i + 2); if (i < 0) break; i++; out += ' '; continue }
    if (ch === "'" || ch === '"' || ch === '`' || (ch === '}' && depth.length && depth[depth.length - 1] === 0)) {
      if (ch === '}') depth.pop()
      const quote = ch === '}' ? '`' : ch
      for (i++; i < source.length && source[i] !== quote; i++) {
        if (source[i] === '\\') i++
        else if (quote === '`' && source[i] === '$' && source[i + 1] === '{') { depth.push(0); i++; break }
        else if (quote !== '`' && source[i] === '\n') break
      }
      out += ' '
      continue
    }
    if (depth.length) { if (ch === '{') depth[depth.length - 1]!++; else if (ch === '}') depth[depth.length - 1]!-- }
    out += ch
  }
  return out
}
/**
 * Stand-ins for the public names of on-demand modules that were not loaded. The scan of the source finds every name
 * that is written out; a name reached some other way (globalThis['ax' + 'es'], a source that cannot be read) lands
 * here instead of on `undefined`: touching the stand-in notes the module in `needed` and throws, and the host loads
 * the module and builds the scene again. `then` stays undefined so that a stand-in can pass through a promise.
 */
export function featureStubs(table: readonly FeatureInfo[], loaded: readonly string[], needed: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of table) {
    if (loaded.includes(f.module)) continue
    for (const name of f.names) {
      const touch = (): never => { needed.add(f.module); throw new FeatureNeeded(name, f.module) }
      out[name] = new Proxy(function () {}, {
        apply: touch,
        construct: touch,
        get: (_t, key) => (key === 'then' || typeof key === 'symbol' ? undefined : touch()),
        has: touch,
        ownKeys: touch,
      })
    }
  }
  return out
}
/** Thrown by the stand-in of a name whose on-demand module is not loaded; the host answers by loading the module. */
export class FeatureNeeded extends Error {
  constructor(readonly symbol: string, readonly module: string) {
    super(`"${symbol}" belongs to the on-demand module "${module}", which is not loaded in this page`)
    this.name = 'FeatureNeeded'
  }
}
/** Relative specifiers a module imports (static, dynamic and re-exports), as written. */
export const localImports = (source: string): string[] => [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]!)
/**
 * The on-demand modules a scene uses, read from its source and the local modules it imports. Null when a file cannot
 * be read (a scene opened from file://): the caller then starts with none and loads what the scene turns out to touch.
 */
async function scanFeatures(url: string, table: readonly FeatureInfo[]): Promise<string[] | null> {
  const found = new Set<string>(), seen = new Set<string>(), todo = [url]
  try {
    while (todo.length && seen.size < FEATURE_SCAN_FILES) {
      const at = todo.shift()!
      if (seen.has(at)) continue
      seen.add(at)
      if (!/\.m?js(\?|#|$)/i.test(at)) continue // data (JSON) names nothing
      const res = await fetch(at)
      if (!res.ok) return null
      const text = await res.text()
      for (const f of featuresIn(text, table)) found.add(f)
      for (const spec of localImports(text)) todo.push(new URL(spec, at).href)
    }
  } catch { return null }
  return todo.length ? null : table.map((f) => f.module).filter((m) => found.has(m))
}

function parseQuery(search: string): BootOptions {
  const q = new URLSearchParams(search)
  const o: BootOptions = {}
  const scene = q.get('scene')
  if (scene) o.scene = scene
  const hl = q.get('headless')
  if (hl !== null && hl !== '0' && hl !== 'false') o.headless = true
  const num = (k: string): number | undefined => { const v = q.get(k); const n = v === null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : undefined }
  o.t = num('t')
  o.step = num('step')
  const view = q.get('view')
  if (view) o.view = view
  const debug = q.get('debug')
  if (debug) o.debug = debug
  const features = q.get('features')
  if (features !== null) o.features = features.split(',').map((x) => x.trim()).filter(Boolean)
  const autoplay = q.get('autoplay')
  if (autoplay !== null) o.autoplay = !(autoplay === '0' || autoplay === 'false')
  const mode = q.get('mode')
  if (mode) o.mode = mode
  const config = q.get('config')
  if (config) o.config = config
  const set = q.get('set')
  if (set) {
    o.set = {}
    for (const pair of set.split(',')) {
      const i = pair.search(/[:=]/)
      if (i <= 0) continue
      const raw = pair.slice(i + 1).trim()
      const n = Number(raw)
      o.set[pair.slice(0, i).trim()] = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && Number.isFinite(n) ? n : raw
    }
  }
  return o
}

/** Install every public name on globalThis so a missing import never breaks a scene. */
export function installGlobals(api: Record<string, unknown>): void {
  const g = globalThis as Record<string, unknown>
  for (const [name, value] of Object.entries(api)) {
    try { Object.defineProperty(g, name, { value, writable: true, configurable: true, enumerable: false }) } catch { /* a locked global keeps its value */ }
  }
  setPublicNames(() => Object.keys(api))
}

/** Build the page: import the scene, compile, mount, apply the URL state, publish window.__mimir. */
export function boot(given: BootOptions = {}): MimirHost {
  const opts: BootOptions = { ...(typeof location !== 'undefined' ? parseQuery(location.search) : {}), ...given }
  const headless = !!opts.headless
  let model = new SceneModel()
  let runtime: Runtime | null = null
  const pending: { event: string; fn: (arg: any) => void }[] = []
  const readyFns = new Set<() => void>()
  let isReady = false
  let startPlaying: (() => void) | null = null
  let checkMod: Promise<any> | null = null
  const featuresLoaded: string[] = []
  /** on-demand modules a stand-in was touched for (featureStubs): loaded before the scene is built again */
  const featuresNeeded = new Set<string>()
  // ── playback: the one clock of the page. It only chooses τ; pixels depend on (τ, params) alone ──
  let playing = false, speed = 1, raf = 0, lastTick: number | null = null
  /** a mounted player that keeps its own clock (PlayerInstance.transport): play / pause / playing / speed are then that clock's */
  let transport: PlayerTransport | null = null
  const hostListeners = new Map<string, Set<(arg: any) => void>>()
  const emitHost = (event: string, arg?: unknown): void => { for (const fn of [...(hostListeners.get(event) ?? [])]) { try { fn(arg) } catch (e) { console.error('[mimir] listener', e) } } }
  const stop = (ended: boolean): void => {
    if (!playing) return
    playing = false
    if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf)
    raf = 0
    emitHost('pause', { ended })
  }
  const tick = (now: number): void => {
    raf = 0
    if (!playing || !runtime) return
    // the timestamp of the frame being displayed: the first tick only notes it
    const dt = lastTick === null ? 0 : Math.min(model.config<number>('viewer.maxStep', VIEWER_DEFAULTS.maxStep), Math.max(0, (now - lastTick) / 1000)) * speed
    lastTick = now
    const tau = runtime.tau + dt
    if (tau >= model.duration) { runtime.seek(model.duration); stop(true); return }
    if (dt > 0) runtime.seek(tau)
    raf = requestAnimationFrame(tick)
  }
  /** `(prefers-reduced-motion: reduce)`: nothing starts moving on its own for such a person */
  const reducedMotion = (): boolean => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
  // a page opened at a moment (`t=`, `step=`: a link to that moment, a reload that comes back where the author was) shows that moment
  const autoplay = (): boolean => !headless && (opts.autoplay ?? (opts.t === undefined && opts.step === undefined && model.config<boolean>('viewer.autoplay', VIEWER_DEFAULTS.autoplay) === true && !reducedMotion()))
  let hasPlayer = false
  // Literal specifiers next to this bundle, so `mimir export` can find and rewrite them. scripts/build.ts keeps them
  // external; `chunkBase` overrides the location for hosts that serve the chunks elsewhere.
  const loading = new Map<string, Promise<unknown>>()
  const load = (chunk: string): Promise<unknown> => {
    let p = loading.get(chunk)
    if (!p) {
      const literal = opts.chunks?.[chunk]
      p = opts.chunkBase ? import(/* @vite-ignore */ `${opts.chunkBase}mimir.${chunk}.js`)
        : literal ? literal()
        : Promise.reject(new Error(`this build has no lazy chunk "${chunk}" (chunks: ${Object.keys(opts.chunks ?? {}).join(', ') || 'none'})`))
      loading.set(chunk, p)
      p.catch(() => loading.delete(chunk))
    }
    return p
  }

  const info = (): Manifest => {
    const says = new Map<number, string[]>()
    for (const a of model.actions) if (a.type === 'say') says.set(a.step, [...(says.get(a.step) ?? []), String(a.data?.plain ?? '')])
    const diags = model.diagnostics.list
    // fields that modules add with defineManifest; a hook that throws is reported and left out
    const extra: Record<string, unknown> = {}
    for (const [key, fn] of allManifests()) {
      // info() is sent over the wire: a hook whose value is not JSON (a node, a cycle) is reported by name and left out
      try { const v = fn(model, runtime); extra[key] = v === undefined ? null : JSON.parse(JSON.stringify(v)) } catch (e) { model.reportError(e, `manifest hook "${key}" (defineManifest: the value must be plain JSON)`) }
    }
    return {
      version: VERSION,
      title: model.opts.title ?? '',
      subtitle: model.opts.subtitle ?? '',
      file: model.file,
      duration: model.duration,
      frame: { width: FRAME_W, height: FRAME_H },
      stage: runtime ? { width: runtime.width, height: runtime.height } : { width: 0, height: 0 },
      steps: model.steps.map((s) => ({ index: s.k, title: s.title, t0: s.t0, t1: s.t1, hold: s.hold, say: says.get(s.index) ?? [], chapter: s.chapter >= 0 ? s.chapter + 1 : null })),
      chapters: model.chapters.filter((c) => c.firstStep >= 0).map((c) => {
        const own = model.steps.filter((s) => s.chapter === c.index)
        return { index: c.index + 1, title: c.title, t0: own[0]!.t0, t1: own[own.length - 1]!.t1, steps: own.map((s) => s.k), keep: c.keep.map((n) => n.id) }
      }),
      transcript: model.steps.map((s) => ({
        step: s.k, title: s.title, chapter: s.chapter >= 0 ? s.chapter + 1 : null, chapterTitle: s.chapter >= 0 ? model.chapters[s.chapter]!.title : null, t0: s.t0, t1: s.t1,
        narration: s.narration.map((n) => ({ text: n.text, plain: n.plain, t0: n.t0, duration: n.duration, spans: n.spans })),
        note: s.notes.length ? s.notes.join('\n\n') : null,
      })),
      chunks: runtime ? [...runtime.chunks] : model.chunksNeeded(),
      features: [...featuresLoaded],
      params: model.params.map((p) => ({ name: p.name, kind: p.kind, value: p.value, min: p.min, max: p.max, step: p.step, unit: p.unit, label: p.label, options: p.options, cyclic: p.cyclic, period: p.period, group: p.group, hidden: p.hidden })),
      parts: model.nodes.filter((n) => !kindOf(n.kind)?.container).map((n) => ({ id: n.id, label: n.label ?? n.id, kind: n.kind, space: n.space, line: n.src.line })),
      views: Object.keys(VIEWS),
      looks: model.has3d ? lookControls() : [],
      has3d: model.has3d,
      viewport: model.viewportRect(),
      headless,
      autoplay: autoplay(),
      mode: opts.mode ?? String(model.config<string>('viewer.mode', VIEWER_DEFAULTS.mode)),
      config: { project: projectConfig().source, values: { ...projectConfig().values, ...model.settings.own() } },
      problems: { errors: diags.filter((d) => d.severity === 'error').length, warnings: diags.filter((d) => d.severity === 'warn').length },
      fatal: model.fatal,
      ...extra,
    }
  }

  const host: MimirHost = {
    version: VERSION,
    ready: null as unknown as Promise<void>,
    info,
    seek(tau) { runtime?.seek(Number(tau)) },
    // while the story plays the params are the story's (play() gives them back to it): pinning one by hand is the person taking over, and the story waits
    setParam(name, value) { if (transport) { if (transport.pausesOnParam?.() !== false) transport.pause() } else stop(false); runtime?.setParam(name, value) },
    clearParam(name) { runtime?.clearParam(name) },
    setView(view) { runtime?.setView(view === '' ? null : (view as string | Partial<Pose> | null)) },
    async frame() { if (runtime) await runtime.settled() },
    async diagnostics(o = {}) {
      if (!runtime || o.static || o.sample === false) return sortDiags(model.diagnostics.list)
      try {
        const mod = await loadCheck()
        // every module of the build has told the store its settings by now: keys that waited for their module are judged
        model.settings.settle()
        return await mod.runCheck(runtime, { rules: o.rules })
      } catch (e) {
        checkMod = null
        model.reportError(e, 'loading the check chunk')
        return sortDiags(model.diagnostics.list)
      }
    },
    probes() { return runtime ? runtime.frame.probes() : {} },
    async query(what, ids, options) {
      if (!runtime) return { error: 'the scene is not loaded.', fix: [] }
      try { return (await loadCheck()).runQuery(runtime, what, ids, options) } catch (e) { checkMod = null; return { error: `the check chunk could not be loaded (${(e as Error)?.message ?? e}).`, fix: ['rebuild: bun scripts/build.ts'] } }
    },
    async debug(mode) {
      // the debug overlay is a development tool: it lives in the dev chunk (src/host/check.ts) and is fetched on first use
      if (mode && runtime) { try { await loadCheck(); runtime.syncOverlays() } catch { checkMod = null } }
      runtime?.setDebug(mode)
    },
    state() {
      const f = runtime?.frame
      const params = Object.create(null) as Record<string, ParamValue> // a param may be called "constructor"
      if (f) for (const p of model.params) params[p.name] = f.param(p)
      const says = f ? f.actions<{ plain: string }>('say') : []
      return { tau: runtime?.tau ?? 0, step: f && f.k >= 0 ? f.k + 1 : 0, u: f?.u ?? 0, duration: model.duration, params, overridden: Object.keys(runtime?.overrides ?? {}), caption: says.length ? says[says.length - 1]!.data.plain : '', userView: !!runtime?.userHasView, playing: transport ? transport.playing : playing, speed: transport ? transport.speed : speed }
    },
    on(event, fn) {
      if (event === 'ready') { if (isReady) fn(undefined); else readyFns.add(fn as () => void); return () => readyFns.delete(fn as () => void) }
      if (event === 'play' || event === 'pause') { const set = hostListeners.get(event) ?? new Set(); hostListeners.set(event, set); set.add(fn); return () => set.delete(fn) }
      if (runtime) return runtime.on(event, fn)
      const entry = { event, fn }
      pending.push(entry)
      return () => { const i = pending.indexOf(entry); if (i >= 0) pending.splice(i, 1) }
    },
    pick(x, y) { return runtime?.pick(x, y)?.id ?? null },
    get playing() { return transport ? transport.playing : playing },
    play(o = {}) {
      // headless frames are evidence: nothing moves unless seek() says so
      if (headless || !runtime || typeof requestAnimationFrame === 'undefined') return
      if (transport) { transport.play(typeof o?.speed === 'number' && Number.isFinite(o.speed) && o.speed > 0 ? { speed: o.speed } : {}); return }
      const s = typeof o?.speed === 'number' && Number.isFinite(o.speed) && o.speed > 0 ? o.speed : model.config<number>('viewer.speed', VIEWER_DEFAULTS.speed)
      speed = s > 0 ? s : VIEWER_DEFAULTS.speed
      if (playing) return
      runtime.clearParam() // the story drives the params again
      if (runtime.tau >= model.duration - STEP_END_EPSILON) runtime.seek(0)
      playing = true
      lastTick = null
      emitHost('play', { speed })
      raf = requestAnimationFrame(tick)
    },
    pause() { if (transport) transport.pause(); else stop(false) },
    setLook(channel, amount) { runtime?.setLook(channel, amount) },
    locate(id) {
      const node = runtime ? model.byId.get(id) : undefined
      const r = node ? runtime!.screenRect(node) : null
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, at: runtime!.visiblePoint(node!) } : null
    },
    hover(id) { if (runtime) for (const r of runtime.renderers.values()) (r as { hover?: (id: string | null) => void }).hover?.(id) },
    camera() { return runtime && model.has3d ? { ...runtime.frame.camera() } : null },
  }
  /** The dev chunk, and with it the check rules of the on-demand modules this scene loaded (each its own chunk, so `check` does not pull modules the scene never asked for). */
  const loadCheck = (): Promise<any> => (checkMod ??= (async () => {
    const mod = await load('check')
    // a module that is built on others (explain() on graphs, parts, formulas) is held to their rules as well
    const used = featureClosure(featuresLoaded, opts.featureTable ?? [])
    for (const f of opts.featureTable ?? []) if (f.check && used.includes(f.module)) await load(f.check)
    return mod
  })())

  /** Load the API of on-demand modules and publish their names; the names of the modules that are not loaded get stand-ins. */
  const loadFeatures = async (modules: readonly string[]): Promise<void> => {
    const table = opts.featureTable ?? []
    const wanted = table.filter((f) => !featuresLoaded.includes(f.module) && modules.includes(f.module))
    const got = await Promise.allSettled(wanted.map((f) => load(f.chunk)))
    const publish = (names: Record<string, unknown>): void => { opts.install?.(names); if (!opts.install && opts.api) Object.assign(opts.api, names) }
    got.forEach((r, i) => {
      const f = wanted[i]!
      if (r.status === 'rejected') throw new Error(`the "${f.module}" module could not be loaded (${(r.reason as Error)?.message ?? r.reason}); ${opts.features ? 'this page was told which modules it holds (an export holds what its scene used when it was exported): export the scene again' : 'rebuild: bun scripts/build.ts'}`)
      const names = (r.value as { api?: Record<string, unknown> } | null)?.api
      if (names) publish(names)
      featuresLoaded.push(f.module)
    })
    publish(featureStubs(table, featuresLoaded, featuresNeeded))
    if (opts.api) installGlobals(opts.api)
  }
  /** The project's settings (mimir.config.json): given as an object, fetched from a URL, or left on globalThis by an export. */
  const loadProjectConfig = async (): Promise<string | null> => {
    const given = opts.config ?? (globalThis as { __mimirConfig?: ProjectConfig }).__mimirConfig
    if (given === undefined || given === null) { setProjectConfig(null); return null }
    let cfg: unknown = given, name = 'mimir.config.json'
    if (typeof given === 'string') {
      const url = new URL(given, typeof location !== 'undefined' ? location.href : 'file:///').href
      name = url.split(/[?#]/)[0]!.split('/').pop() || name
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        cfg = JSON.parse(await res.text())
      } catch (e) { setProjectConfig(null); return `${name} could not be read (${(e as Error)?.message ?? e}); the scene runs on the defaults.` }
    }
    if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) { setProjectConfig(null); return `${name} must hold an object: { "defaults": { … } }.` }
    setProjectConfig((cfg as ProjectConfig).defaults ?? null, name)
    return null
  }

  host.ready = (async () => {
    try {
      if (opts.api) installGlobals(opts.api)
      // 0. the project's settings come first: everything the scene creates reads them
      const configProblem = await loadProjectConfig()
      // 1. the scene module
      let def: SceneDef | null = null
      let file: string | null = null
      const table = opts.featureTable ?? []
      /** import the scene module (again, under another URL, once a module it needs has arrived: a module is evaluated once per URL) */
      const importScene = async (attempt: number): Promise<void> => {
        def = null
        model = new SceneModel()
        try {
          const mod = await import(/* @vite-ignore */ attempt ? `${file}${file!.includes('?') ? '&' : '?'}${RETRY_PARAM}=${attempt}` : file!)
          if (isSceneDef(mod?.default)) def = mod.default
          else model.fatal = { message: 'The scene module has no default export made with scene(): write `export default scene({ title }, s => { … })`.', file, line: null }
        } catch (e) {
          const err = e as Error
          const at = parseStack(err?.stack)
          let message = `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`
          // an import of a name that does not exist: say which name is meant, and that imports are optional
          const missing = /export named '([^']+)'/.exec(err?.message ?? '')
          if (missing) {
            const near = closest(missing[1]!, Object.keys(opts.api ?? {}))
            message = `'${missing[1]}' is not part of the mimir API${near ? `; did you mean '${near}'?` : '.'} (Every name is also a global: the import line can list fewer names.)`
          }
          model.fatal = { message, file: sansRetry(at.file) ?? file, line: at.line, stack: err?.stack }
        }
      }
      const build = (): void => {
        if (def) model = compile(def, { file })
        else { const fatal = model.fatal; model = compile({ isSceneDef: true, opts: { title: '' }, build: () => {} }, { file }); model.fatal = fatal; if (fatal) model.diagnostics.add({ code: 'RUNTIME-ERROR', what: fatal.message, fix: [], file: fatal.file, line: fatal.line }, null) }
      }
      if (typeof opts.scene === 'string') {
        file = new URL(opts.scene, typeof location !== 'undefined' ? location.href : 'file:///').href
        // the API of on-demand modules (kit, plots, diagrams …) must be there before the scene runs: read which ones off
        // the source. A source that cannot be read (file://) starts with none: the stand-ins say what it touches.
        if (table.length) await loadFeatures(opts.features ?? (await scanFeatures(file, table)) ?? [])
        await importScene(0)
        build()
        // a name the scan could not see was touched (computed access, an unreadable source): load its module, build again
        for (let attempt = 1; attempt <= table.length && [...featuresNeeded].some((m) => !featuresLoaded.includes(m)); attempt++) {
          await loadFeatures([...featuresNeeded])
          await importScene(attempt)
          build()
        }
        for (const d of model.diagnostics.list) d.file = sansRetry(d.file)
      } else if (opts.scene) {
        def = opts.scene
        if (table.length) await loadFeatures(opts.features ?? featuresIn(String(def.build), table))
        build()
        for (let attempt = 1; attempt <= table.length && [...featuresNeeded].some((m) => !featuresLoaded.includes(m)); attempt++) { await loadFeatures([...featuresNeeded]); build() }
      } else { model.fatal = { message: 'No scene given. Open viewer.html?scene=<url of a scene module>.', file: null, line: null }; build() }
      if (configProblem) model.diagnostics.add({ code: 'RUNTIME-ERROR', severity: 'warn', step: null, t: null, what: configProblem, fix: ['fix the file, or remove `config=` from the page URL'], file: projectConfig().source, line: null }, null)
      // 3. page: the player supplies the slot, or the stage takes the whole window
      const root = opts.root ?? document.body
      let slot: HTMLElement | null = null
      // the player may live in a lazy chunk of its own (src/player/player.chunk.ts): it is only needed with a person watching
      if (!headless && !playerFactory() && opts.chunks?.player) { try { if (opts.chunks.fonts) await load('fonts').catch(() => {}); await load('player') } catch (e) { model.reportError(e, 'loading the player') } }
      const make = headless ? null : playerFactory()
      runtime = new Runtime(model, { headless, load })
      for (const p of pending.splice(0)) runtime.on(p.event as RuntimeEvent, p.fn)
      let player: PlayerInstance | null = null
      if (make) { try { player = make(host, root); slot = player.slot; hasPlayer = true } catch (e) { model.reportError(e, 'starting the player') } }
      if (player?.transport) { const own = (transport = player.transport); own.onChange((on, ended) => emitHost(on ? 'play' : 'pause', on ? { speed: own.speed } : { ended })) }
      if (!slot) {
        slot = document.createElement('div')
        slot.style.cssText = 'position:fixed;inset:0;background:#000;overflow:hidden'
        root.appendChild(slot)
      }
      await runtime.mount(slot)
      // 4. URL state
      for (const [k, v] of Object.entries(opts.set ?? {})) runtime.setParam(k, v)
      if (opts.view) runtime.setView(opts.view)
      if (opts.debug) await host.debug(opts.debug)
      if (opts.step !== undefined) { const s = model.steps[Math.round(opts.step) - 1]; if (s) runtime.seek(Math.max(s.t0, s.t1 - STEP_END_EPSILON)) }
      if (opts.t !== undefined) runtime.seek(opts.t)
      try { await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready } catch { /* no font loading API */ }
      runtime.render(true)
      // with a person watching the story plays (DESIGN §9): a mounted player owns playback (it keeps its own clock and reads info().autoplay; one that returns play() is asked to start); without a player the host's clock runs
      if (autoplay() && !model.fatal) startPlaying = player ? (player.play ? player.play.bind(player) : null) : () => host.play()
    } catch (e) {
      const err = e as Error
      model.fatal ??= { message: `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`, file: null, line: null, stack: err?.stack }
      console.error('[mimir] boot failed', e)
    }
    // a player shows a scene that failed to load in its own words (info().fatal); without one the stage says it
    if (model.fatal && !hasPlayer) showFatal(model.fatal, runtime?.stageEl ?? document.body)
    isReady = true
    for (const fn of readyFns) { try { fn() } catch (e) { console.error(e) } }
    readyFns.clear()
    try { startPlaying?.() } catch (e) { console.error('[mimir] autoplay', e) }
  })()
  ;(globalThis as { __mimir?: MimirHost }).__mimir = host
  return host
}

function showFatal(fatal: NonNullable<SceneModel['fatal']>, into: HTMLElement): void {
  const box = document.createElement('div')
  box.className = 'mimir-fatal'
  box.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(80%,760px);z-index:50;background:#141416;border:1px solid #FC6255;border-radius:10px;padding:18px 22px;color:#EEE;font:14px/1.45 ${FONT_SANS}`
  const h = document.createElement('div')
  h.textContent = 'The scene could not be loaded'
  h.style.cssText = 'font-weight:650;color:#FC6255;margin-bottom:6px;font-size:15px'
  const m = document.createElement('div')
  m.textContent = fatal.message
  m.style.cssText = `font-family:${FONT_MONO};font-size:13px;white-space:pre-wrap;word-break:break-word`
  box.append(h, m)
  if (fatal.file) {
    const w = document.createElement('div')
    w.textContent = `${fatal.file.split('/').pop()}${fatal.line !== null ? ':' + fatal.line : ''}`
    w.style.cssText = `margin-top:8px;color:#999;font-family:${FONT_MONO};font-size:12px`
    box.appendChild(w)
  }
  into.appendChild(box)
}

export const api = {}
