// explain(spec) → a normal scene. This file is the compiler: it validates the spec (never throws), asks the stage
// for one rectangle per block, builds the blocks, and turns the story (an array of steps, or a generator that is run
// once while the scene is built) into ordinary steps: narration with its links, control sweeps, block transitions.
// It also keeps a plain-text account of every step (info().quick), so a story can be reviewed without pixels.
import {
  callSite, defineManifest, isNode, PALETTE, scene,
  type Handle, type MNode, type Param, type SceneDef, type SceneModel, type Src,
} from '../core/index.ts'
import { text } from '../r2d/index.ts'
import { fadeIn, indicate } from '../anim/index.ts'
import { guideConfig } from '../guide/index.ts'
import { absorbNarration } from './narration.ts'
import { adopterOf, blockKinds, didYouMean, isBlockDef, textWidth, type BlockCtx, type BlockDef, type BlockHandle, type Scene, type StepHandle } from './block.ts'
import { layoutStage, STAGE_DEFAULTS, type StageLayout, type StageOptions } from './stage.ts'

/** Named defaults of the story compiler. */
export const STORY_DEFAULTS = {
  /** a generator that yields more steps than this is cut off (a loop that never ends) */
  maximumSteps: 240,
  /** words of a step's title when the step gives none: the first words of what it says */
  titleWords: 5,
  /** size token and colour of the title line */
  titleSize: 'label',
  titleColor: PALETTE.GREY_B as string,
}

export interface ControlSpec { from?: number; to?: number; value?: number; step?: number; unit?: string; label?: string; cyclic?: boolean; hidden?: boolean }
export interface StepSpec { say?: string; set?: Record<string, number>; chapter?: string; note?: string; focus?: string | string[]; title?: string; [block: string]: unknown }
export interface ExplainSpec {
  title?: string
  subtitle?: string
  controls?: Record<string, ControlSpec>
  stage?: Record<string, unknown>
  story?: StepSpec[] | ((blocks: Record<string, any>) => Iterable<StepSpec> | Iterator<StepSpec> | StepSpec[])
  layout?: Partial<StageOptions>
}
const TOP_KEYS = ['title', 'subtitle', 'controls', 'stage', 'story', 'layout'] as const
const CONTROL_KEYS = ['from', 'to', 'value', 'step', 'unit', 'label', 'cyclic', 'hidden'] as const
const STEP_KEYS = ['say', 'set', 'chapter', 'note', 'focus', 'title'] as const

// ── the plain-text account ───────────────────────────────────────────────────────────────────────────
export interface QuickStepAccount {
  /** 1-based */
  step: number
  title: string
  chapter: string | null
  /** what is spoken, without the link syntax */
  says: string
  /** every link of the narration: the words and the `block.path` they point at */
  points: { words: string; target: string }[]
  /** blocks on stage at the end of the step, in stage order */
  onStage: string[]
  /** blocks that came on stage in this step */
  entered: string[]
  /** controls the step sweeps: name → value */
  set: Record<string, number>
  /** one line per block on stage: handle.describe(state) */
  blocks: Record<string, string>
  /** blocks whose state the step changed */
  changed: string[]
  /** what the layer changed in the sentence so that it passes the narration rules (too many links, symbols …), and what it added to a step that showed nothing */
  adjusted: string[]
}
export interface QuickAccount { title: string; arrangement: string; blocks: { id: string; kind: string; rect: [number, number, number, number] }[]; controls: Record<string, ControlSpec>; steps: QuickStepAccount[] }
/** What explain() built for one scene: the account, and every block's handle with its state after the last step. */
export interface QuickLive { account: QuickAccount | null; handles: Record<string, BlockHandle<any>>; states: Record<string, any> }
const accounts = (model: SceneModel): QuickLive => model.store('quick', () => ({ account: null as QuickAccount | null, handles: {}, states: {} }))
let latest: QuickLive = { account: null, handles: {}, states: {} }
/** The blocks of a compiled explain() scene: handles and final states by block id (for tests and tools). Without a model: the scene built last. */
export const quickBlocks = (model?: SceneModel): QuickLive => (model ? accounts(model) : latest)
/** The account of an explain() scene as text: one paragraph per step. */
export function describeAccount(a: QuickAccount): string {
  const lines: string[] = [`${a.title || '(no title)'} · ${a.steps.length} steps · blocks: ${a.blocks.map((b) => `${b.id} (${b.kind})`).join(', ') || 'none'} · arranged as ${a.arrangement}`]
  for (const s of a.steps) {
    lines.push(`${s.step}. ${s.title}${s.chapter ? `  [chapter: ${s.chapter}]` : ''}`)
    if (s.says) lines.push(`   says: ${s.says}`)
    if (s.points.length) lines.push(`   points at: ${s.points.map((p) => `"${p.words}" -> ${p.target}`).join(', ')}`)
    if (s.adjusted.length) lines.push(`   adjusted: ${s.adjusted.join('; ')}`)
    if (s.entered.length) lines.push(`   enters: ${s.entered.join(', ')}`)
    const sets = Object.entries(s.set)
    if (sets.length) lines.push(`   sets: ${sets.map(([k, v]) => `${k} = ${v}`).join(', ')}`)
    for (const id of s.onStage) lines.push(`   ${s.changed.includes(id) ? '*' : ' '} ${id}: ${s.blocks[id] ?? ''}`)
  }
  return lines.join('\n')
}
/** The account of a compiled scene (null when it was not made by explain()). */
export const quickAccount = (model: SceneModel): QuickAccount | null => accounts(model).account
defineManifest('quick', (model) => {
  const a = accounts(model).account
  return a ? { ...a, describe: describeAccount(a) } : null
})

// ── narration links ──────────────────────────────────────────────────────────────────────────────────
const LINK = /\[([^\]]*)\]\(([^)]*)\)/g
/** Plain words of a sentence: `[the row](row)` → `the row`. */
export const plainOf = (say: string): string => say.replace(LINK, '$1')
/** The links of a sentence as written: words, verb, `block.path` targets, options. */
export function linksOf(say: string): { words: string; verb: string; targets: string[]; options: string }[] {
  const out: { words: string; verb: string; targets: string[]; options: string }[] = []
  for (const m of say.matchAll(LINK)) {
    let inner = m[2]!.trim(), verb = '', options = ''
    const v = /^([A-Za-z]+):/.exec(inner)
    if (v) { verb = v[1]!; inner = inner.slice(v[0].length) }
    const comma = inner.indexOf(',')
    if (comma >= 0) { options = inner.slice(comma); inner = inner.slice(0, comma) }
    out.push({ words: m[1]!, verb, targets: inner.split('+').map((t) => t.trim()).filter(Boolean), options })
  }
  return out
}
const titleOf = (say: string, k: number): string => {
  const words = plainOf(say).split(/[.!?:;]/)[0]!.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return `Step ${k}`
  return words.slice(0, STORY_DEFAULTS.titleWords).join(' ').replace(/[,]+$/, '') + (words.length > STORY_DEFAULTS.titleWords ? ' …' : '')
}
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !isNode(v) && typeof v !== 'function'
const same = (a: unknown, b: unknown): boolean => { try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false } }

// ── explain ──────────────────────────────────────────────────────────────────────────────────────────
/** A block that is a plain engine object (graph(), a kit part, a group …): fitted into its rectangle, no state of its own. */
function plainBlock(node: Handle): BlockDef {
  return {
    kind: node.kind, is3d: node.space === '3d',
    build(ctx) {
      if (node.space !== '3d' && !node.placement) node.fit(ctx.rect)
      const find = (path: string): Handle | undefined => (path ? (node.model.byId.get(`${node.id}.${path}`) ?? node.model.byId.get(path)) as Handle | undefined : node)
      return {
        root: node, initial: {}, keys: [], api: { node }, target: find,
        targets: () => node.model.nodes.filter((n) => n.id.startsWith(node.id + '.')).map((n) => n.id.slice(node.id.length + 1)),
        apply: (_st, _change, prev) => prev,
        describe: () => `${node.kind} #${node.id}`,
      }
    },
  }
}

interface Live { id: string; def: BlockDef; handle: BlockHandle; state: Record<string, unknown>; onStage: boolean }

/**
 * explain(spec): a declarative scene. `stage` names the blocks, `story` is the list of steps (or a generator: a real
 * algorithm that yields its own steps), `controls` are the sliders. No positions, sizes, durations or cameras.
 */
export function explain(spec: ExplainSpec): SceneDef {
  const src = callSite()
  const given = isPlain(spec) ? spec : {}
  const def = scene({ title: typeof given.title === 'string' ? given.title : '', ...(typeof given.subtitle === 'string' ? { subtitle: given.subtitle } : {}) }, (s: Scene) => build(s, spec, src))
  def.src = src
  return def
}

function build(s: Scene, raw: unknown, src: Src): void {
  const model = s.model
  const report = (code: string, what: string, fix: string[] = [], ids: string[] = [], severity?: 'warn'): void => { model.diagnostics.add({ code, what, fix, ids, ...(severity ? { severity } : {}) }, src) }
  if (!isPlain(raw)) { report('API-TYPE', `explain() expects one object, got ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw}.`, ["explain({ title: 'How X works', stage: { row: cells([1, 2, 3]) }, story: [{ say: 'Three [values](row).' }] })"]) }
  const spec: ExplainSpec = isPlain(raw) ? raw : {}
  for (const key of Object.keys(spec)) if (!(TOP_KEYS as readonly string[]).includes(key)) report('API-UNKNOWN', `explain() has no key "${key}".`, [didYouMean(key, TOP_KEYS, 'keys')])
  const title = typeof spec.title === 'string' ? spec.title.trim() : ''
  const options: Partial<StageOptions> = {}
  if (isPlain(spec.layout)) for (const [k, v] of Object.entries(spec.layout)) {
    if (!Object.hasOwn(STAGE_DEFAULTS, k)) report('API-UNKNOWN', `explain(): layout has no option "${k}".`, [didYouMean(k, Object.keys(STAGE_DEFAULTS), 'options')])
    else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) report('NUM-INVALID', `explain(): layout.${k} must be a number that is not negative, got ${String(v)}.`, [`${k}: ${(STAGE_DEFAULTS as Record<string, number>)[k]}`])
    else (options as Record<string, number>)[k] = v
  }
  const stageOpts: StageOptions = { ...STAGE_DEFAULTS, ...options }

  // ── controls → params ──────────────────────────────────────────────────────────────────────────────
  const controls = new Map<string, Param<number>>()
  const controlSpecs: Record<string, ControlSpec> = {}
  if (spec.controls !== undefined && !isPlain(spec.controls)) report('API-TYPE', 'explain(): controls must be an object of name → { from, to }.', ["controls: { crank: { from: 0, to: 360, unit: '°' } }"])
  for (const [name, c0] of Object.entries(isPlain(spec.controls) ? spec.controls : {})) {
    const c: ControlSpec = isPlain(c0) ? c0 : {}
    if (!isPlain(c0)) report('API-TYPE', `explain(): the control "${name}" must be an object, got ${typeof c0}.`, [`${name}: { from: 0, to: 1 }`])
    for (const k of Object.keys(c)) if (!(CONTROL_KEYS as readonly string[]).includes(k)) report('API-UNKNOWN', `explain(): the control "${name}" has no option "${k}".`, [didYouMean(k, CONTROL_KEYS, 'options')])
    const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
    const from = num(c.from, 0), to = num(c.to, from + 1)
    const min = Math.min(from, to), max = Math.max(from, to)
    const value = Math.min(max, Math.max(min, num(c.value, from)))
    controlSpecs[name] = { from, to, value, ...(c.unit !== undefined ? { unit: String(c.unit) } : {}), ...(c.cyclic ? { cyclic: true } : {}), ...(c.hidden ? { hidden: true } : {}) }
    const p = s.param(name, { value, min, max, ...(typeof c.step === 'number' && c.step > 0 ? { step: c.step } : {}), ...(c.unit !== undefined ? { unit: String(c.unit) } : {}), ...(typeof c.label === 'string' ? { label: c.label } : {}) }) as Param<number>
    // the engine's params have no such flag yet: blocks that sample a control (a machine's sweep) read it here
    if (c.cyclic && p?.def) (p.def as { cyclic?: boolean }).cyclic = true
    controls.set(name, p)
  }

  // ── stage: which blocks, where ─────────────────────────────────────────────────────────────────────
  if (spec.stage !== undefined && !isPlain(spec.stage)) report('API-TYPE', 'explain(): stage must be an object of name → block.', ['stage: { row: cells([3, 8, 12]) }'])
  const defs: { id: string; def: BlockDef }[] = []
  const kindNames = blockKinds().map((k) => k.kind)
  for (const [id, v] of Object.entries(isPlain(spec.stage) ? spec.stage : {})) {
    // an engine object first: its handle answers every property name, so it would pass for anything
    if (isNode(v)) { const adopter = adopterOf(v.kind); defs.push({ id, def: adopter?.adopt ? adopter.adopt(v as Handle) : plainBlock(v as Handle) }) }
    else if (isBlockDef(v)) defs.push({ id, def: v })
    else if (isPlain(v) && typeof v.kind === 'string') report('API-UNKNOWN', `explain(): stage.${id} names the block kind "${v.kind}", which does not exist; the rest of the stage is shown without it.`, [didYouMean(v.kind, kindNames, 'blocks')])
    else report('API-TYPE', `explain(): stage.${id} is not a block (got ${v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v}); the rest of the stage is shown without it.`, [`blocks: ${kindNames.join(', ')}`, `${id}: ${blockKinds()[0]?.example ?? 'cells([3, 8, 12])'}`])
  }
  const layout: StageLayout = layoutStage(defs.map(({ id, def }) => ({ id, is3d: def.is3d, aspect: def.prefer?.aspect, weight: def.prefer?.weight })), { title: !!title, options })
  if (layout.panel) s.viewport({ x: layout.panel.center[0], y: layout.panel.center[1], width: layout.panel.width, height: layout.panel.height })
  if (layout.extraPanels.length) report('API-TYPE', `explain(): the stage has ${layout.extraPanels.length + 1} 3D blocks and one 3D panel; ${layout.extraPanels.map((x) => `"${x}"`).join(', ')} share${layout.extraPanels.length === 1 ? 's' : ''} it with the first.`, ['put the parts into one machine block', 'or keep one 3D block per scene'])

  let titleNode: Handle | null = null
  if (title && layout.title) {
    titleNode = text(title, { id: 'title', size: STORY_DEFAULTS.titleSize, color: STORY_DEFAULTS.titleColor }) as Handle
    const width = textWidth(title, STORY_DEFAULTS.titleSize)
    titleNode.at(layout.title.center[0], layout.title.center[1])
    if (width > layout.title.width) titleNode.scale(layout.title.width / width)
    // a title is a sentence, not a label: the label-length rule does not apply to it
    if (typeof titleNode.allow === 'function') titleNode.allow('TEXT-LONG')
  }

  const live: Live[] = []
  const byId = new Map<string, Live>()
  for (const { id, def } of defs) {
    const ctx: BlockCtx = {
      s, id, rect: layout.rects[id]!,
      control: (name) => controls.get(name),
      block: (other) => byId.get(other)?.handle,
      report: (what, fix) => report('API-TYPE', `${def.kind} "${id}": ${what}`, fix ? [fix] : [], [id]),
    }
    let handle: BlockHandle | null = null
    try { handle = def.build(ctx) } catch (e) { model.reportError(e, `the block "${id}" (${def.kind})`) }
    if (!handle || !handle.root) { if (handle) report('API-TYPE', `the block "${id}" (${def.kind}) built nothing to show.`, []); continue }
    const entry: Live = { id, def, handle, state: { ...(handle.initial ?? {}) }, onStage: false }
    live.push(entry)
    byId.set(id, entry)
  }
  const blockIds = live.map((b) => b.id)
  const account: QuickAccount = {
    title, arrangement: layout.arrangement, controls: controlSpecs, steps: [],
    blocks: live.map((b) => { const r = layout.rects[b.id]!; return { id: b.id, kind: b.def.kind, rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 1000) / 1000) as [number, number, number, number] } }),
  }
  const store = accounts(model)
  store.account = account
  for (const b of live) { store.handles[b.id] = b.handle; store.states[b.id] = b.state }
  latest = store

  // ── the story ──────────────────────────────────────────────────────────────────────────────────────
  const stepKeys = [...STEP_KEYS, ...blockIds]
  /** every `block.path` a link may name, for did-you-mean */
  const allTargets = (): string[] => live.flatMap((b) => [b.id, ...safeTargets(b).map((t) => `${b.id}.${t}`)])
  const safeTargets = (b: Live): string[] => { try { return b.handle.targets().filter((t) => t !== '') } catch { return [] } }
  const targetOf = (b: Live, path: string): MNode | undefined => { try { const n = b.handle.target(path); return isNode(n) ? n : undefined } catch { return undefined } }
  /** Resolve `block.path` to an object. Reports what is wrong once; an unknown path inside a known block falls back to the block. */
  const resolve = (ref: string, where: string): { node: MNode | null; block: Live | null } => {
    const dot = ref.indexOf('.')
    const head = dot < 0 ? ref : ref.slice(0, dot), rest = dot < 0 ? '' : ref.slice(dot + 1)
    const b = byId.get(head)
    if (b) {
      const node = targetOf(b, rest)
      if (node) return { node, block: b }
      // the words still land on the right block: the scene is whole, so this is said as a warning (an error would ask for a second writing)
      report('GUIDE-TARGET', `${where} points at "${ref}", and the block "${head}" has no part "${rest}"; it points at the whole block instead.`, [didYouMean(rest, safeTargets(b), `parts of ${head}`)], [head], 'warn')
      return { node: targetOf(b, '') ?? (isNode(b.handle.root) ? b.handle.root : null), block: b }
    }
    // an id of the engine (an object made inside custom(), a part of a machine) is taken as it is
    const direct = model.byId.get(ref)
    if (direct) return { node: direct, block: null }
    report('GUIDE-TARGET', `${where} points at "${ref}", and no block of the stage is called "${head}"; the words are spoken without a mark.`, [didYouMean(ref, allTargets(), 'targets')])
    return { node: null, block: null }
  }

  /** What one step asks for, checked before it is recorded. */
  interface Planned { spec: StepSpec; say: string; focus: string[] }
  const plan = (st: StepSpec, k: number): Planned => {
    const say = typeof st.say === 'string' && st.say.trim() ? st.say : ''
    if (st.say !== undefined && typeof st.say !== 'string') report('API-TYPE', `step ${k}: say must be a sentence, got ${typeof st.say}.`, ["say: 'Look at the [middle](row.mid).'"])
    for (const key of Object.keys(st)) if (!byId.has(key) && !(STEP_KEYS as readonly string[]).includes(key)) report('API-UNKNOWN', `step ${k} has the key "${key}", which is neither a block of the stage nor a step option; it is ignored.`, [didYouMean(key, stepKeys, 'keys')])
    const focus: string[] = []
    for (const f of st.focus === undefined ? [] : Array.isArray(st.focus) ? st.focus : [st.focus]) {
      if (typeof f === 'string') focus.push(f)
      else report('API-TYPE', `step ${k}: focus takes names such as 'row.mid', got ${typeof f}.`, ["focus: 'row.mid'"])
    }
    return { spec: st, say, focus }
  }
  /** The sentence in the engine's syntax: every `block.path` resolved to the object it names NOW (after the step's changes, so a step can point at what it has just made). */
  const narrate = (say: string, k: number, points: { words: string; target: string }[]): string => say.replace(LINK, (whole, words: string, inner: string) => {
    const link = linksOf(whole)[0]
    if (!link || !link.targets.length) return whole
    const ids: string[] = []
    for (const t of link.targets) {
      const r = resolve(t, `step ${k}: "[${words}](${inner})"`)
      if (r.node) { ids.push(r.node.id); points.push({ words, target: t }); lastTouched = r.node }
    }
    return ids.length ? `[${words}](${link.verb ? link.verb + ':' : ''}${ids.join('+')}${link.options})` : words
  })
  /** what the story pointed at or changed last: where a step that shows nothing else puts the eye */
  let lastTouched: MNode | null = null
  const values = new Map<string, number>()

  let chapter: string | null = null
  const record = (p: Planned, k: number): void => {
    const st0 = p.spec
    if (typeof st0.chapter === 'string' && st0.chapter.trim()) {
      chapter = st0.chapter.trim()
      // a chapter keeps the stage: the blocks stay, the story moves on
      const keep: MNode[] = [...(titleNode ? [titleNode] : []), ...live.flatMap((b) => [b.handle.root as MNode, ...((b.handle.extras?.() ?? []) as MNode[])])].filter(isNode)
      s.chapter(chapter, { keep })
    }
    // the whole stage comes on in step one, in stage order: the frame is balanced from the first second (a block that
    // waited for its first mention left a hole where it was going to stand)
    const entering = live.filter((b) => !b.onStage)
    const acc: QuickStepAccount = { step: k, title: typeof st0.title === 'string' && st0.title.trim() ? st0.title.trim() : titleOf(p.say, k), chapter, says: plainOf(p.say), points: [], onStage: [], entered: entering.map((b) => b.id), set: {}, blocks: {}, changed: [], adjusted: [] }
    s.step(acc.title, (st: StepHandle) => {
      if (typeof st0.note === 'string' && st0.note.trim()) st.note(st0.note)
      const start = st.cursor
      let end = start
      // blocks that arrive do so together, one a little after the other
      if (k === 1 && titleNode) { st.play(fadeIn(titleNode, { duration: stageOpts.enterSeconds })); end = Math.max(end, st.cursor); st.rec.cursor = start }
      entering.forEach((b, i) => {
        st.rec.cursor = start + i * stageOpts.enterLag
        try {
          if (typeof b.handle.enter === 'function') b.handle.enter(st)
          // a 3D model only fades in: a rise would move its parts in the world, and what reads them (a probe, a chart of a probe) would be off while it lasts
          else st.play(fadeIn(b.handle.root, b.def.is3d ? { duration: stageOpts.enterSeconds } : { duration: stageOpts.enterSeconds, shift: [0, stageOpts.enterRise] }))
        } catch (e) { model.reportError(e, `the block "${b.id}" coming on stage`) }
        b.onStage = true
        end = Math.max(end, st.cursor)
      })
      const after = end
      let moved = entering.length > 0
      // controls sweep over the whole step
      if (st0.set !== undefined) {
        if (!isPlain(st0.set)) report('API-TYPE', `step ${k}: set must be an object of control → value.`, ['set: { crank: 90 }'])
        else for (const [name, value] of Object.entries(st0.set)) {
          const param = controls.get(name)
          if (!param) { report('API-UNKNOWN', `step ${k} sets "${name}", which is not a control of this scene; it is ignored.`, [didYouMean(name, [...controls.keys()], 'controls')]); continue }
          if (typeof value !== 'number' || !Number.isFinite(value)) { report('NUM-INVALID', `step ${k}: set.${name} must be a number, got ${String(value)}.`, [`set: { ${name}: ${param.def.max} }`]); continue }
          st.set(param, value)
          acc.set[name] = value
          if ((values.get(name) ?? controlSpecs[name]?.value) !== value) moved = true
          values.set(name, value)
        }
      }
      // block transitions: the blocks move together, each from where the arrivals ended
      for (const b of live) {
        if (!Object.hasOwn(st0, b.id)) continue
        const changes = Array.isArray(st0[b.id]) ? (st0[b.id] as unknown[]) : [st0[b.id]]
        st.rec.cursor = after
        for (const change of changes) {
          if (!isPlain(change)) { report('API-TYPE', `step ${k}: ${b.id} must be an object of what changes (or a list of them), got ${change === null ? 'null' : typeof change}.`, [`${b.id}: { ${validKeys(b)[0] ?? 'key'}: … }`], [b.id]); continue }
          const clean: Record<string, unknown> = {}
          const valid = validKeys(b)
          for (const [key, value] of Object.entries(change)) {
            if (b.handle.keys === null || valid.includes(key)) clean[key] = value
            else report('API-UNKNOWN', `step ${k}: the block "${b.id}" (${b.def.kind}) has no state "${key}"; it is ignored.`, [didYouMean(key, valid, `states of ${b.def.kind}`)], [b.id])
          }
          const prev = b.state
          try { b.state = b.handle.apply(st, clean, prev) ?? prev } catch (e) { model.reportError(e, `step ${k}: the block "${b.id}"`) }
          if (!same(prev, b.state) && !acc.changed.includes(b.id)) { acc.changed.push(b.id); if (isNode(b.handle.root)) lastTouched = b.handle.root }
        }
        store.states[b.id] = b.state
        end = Math.max(end, st.cursor)
      }
      // the narration starts once the arrivals are on stage, so a word never points at something that is not there
      // yet; what the step changes happens while it is spoken. Its links are resolved now, after the changes, and
      // the sentence is made to pass the narration rules (narration.ts) instead of being reported.
      st.rec.cursor = after
      let spoken = ''
      if (p.say) {
        const fixed = absorbNarration(narrate(p.say, k, acc.points), guideConfig(model))
        spoken = fixed.say
        // the account lists the links that still carry a mark (a link spoken as plain words points at nothing)
        const kept = linksOf(spoken).map((l) => l.words)
        acc.points = acc.points.filter((pt) => { const i = kept.indexOf(pt.words); if (i < 0) return false; if (!acc.points.some((o) => o !== pt && o.words === pt.words)) kept.splice(i, 1); return true })
        acc.adjusted.push(...fixed.changes)
        acc.says = plainOf(spoken)
        st.say(spoken)
        end = Math.max(end, st.cursor)
      }
      const focus: MNode[] = []
      for (const f of p.focus) { const r = resolve(f, `step ${k}: focus`); if (r.node) focus.push(r.node) }
      // a step in which nothing on stage would change is not left dead: the eye is put on what the story touched last
      if (!moved && !acc.changed.length && !focus.length && !linksOf(spoken).length) {
        const about = lastTouched ?? live.map((b) => b.handle.root).find(isNode) ?? null
        // a drawing gets a short pulse (nothing else is dimmed: a focus would grey out the title and the other blocks
        // for a whole step); a 3D part is brought into focus, which in a model is a highlight
        if (about && about.space !== '3d') { st.play(indicate(about)); end = Math.max(end, st.cursor); acc.adjusted.push(`nothing changes on stage in this step: #${about.id} gets a pulse`) }
        else if (about) { focus.push(about); acc.adjusted.push(`nothing changes on stage in this step: #${about.id} is brought into focus`) }
      }
      st.rec.cursor = end
      if (focus.length) st.focus(...focus)
      st.need(Math.max(end, stageOpts.stepSeconds))
    })
    acc.onStage = live.filter((b) => b.onStage).map((b) => b.id)
    for (const b of live) if (b.onStage) { try { acc.blocks[b.id] = String(b.handle.describe(b.state)) } catch (e) { acc.blocks[b.id] = `(describe failed: ${String((e as Error)?.message ?? e)})` } }
    account.steps.push(acc)
  }
  const validKeys = (b: Live): string[] => (Array.isArray(b.handle.keys) ? [...b.handle.keys] : Object.keys(b.handle.initial ?? {}))

  const apis: Record<string, unknown> = {}
  for (const b of live) apis[b.id] = b.handle.api ?? {}
  let source: unknown = spec.story
  if (typeof source === 'function') {
    try { source = (source as (a: Record<string, unknown>) => unknown)(apis) } catch (e) { model.reportError(e, 'the story'); source = [] }
  }
  if (Array.isArray(source)) {
    // a list is known in full: a block that no step mentions comes on in step one with the others
    const steps = source.filter((x, i) => { if (isPlain(x)) return true; report('API-TYPE', `step ${i + 1} of the story must be an object, got ${x === null ? 'null' : typeof x}; it is skipped.`, ["{ say: 'Look at the [middle](row.mid).', row: { mid: 3 } }"]); return false }) as StepSpec[]
    steps.forEach((x, i) => record(plan(x, i + 1), i + 1))
  } else if (source && typeof (source as Iterator<unknown>).next === 'function') {
    // a generator: each step is recorded before the algorithm goes on, so what it reads (row.value(i)) is the state after that step
    const it = source as Iterator<unknown>
    let k = 0
    for (;;) {
      let r: IteratorResult<unknown>
      try { r = it.next() } catch (e) { model.reportError(e, `the story (after step ${k})`); break }
      if (r.done) break
      if (++k > STORY_DEFAULTS.maximumSteps) { report('API-TYPE', `the story yielded more than ${STORY_DEFAULTS.maximumSteps} steps; it was cut off there.`, ['make sure the loop of the story ends', 'yield one step per idea, not per iteration']); try { it.return?.() } catch { /* the story is over either way */ } break }
      if (!isPlain(r.value)) { report('API-TYPE', `step ${k} of the story must be an object, got ${r.value === null ? 'null' : typeof r.value}; it is skipped.`, ["yield { say: 'Look at the [middle](row.mid).', row: { mid } }"]); continue }
      record(plan(r.value as StepSpec, k), k)
    }
  } else if (source !== undefined) report('API-TYPE', `explain(): story must be a list of steps or a generator function, got ${typeof source}.`, ["story: [{ say: 'Three [values](row).' }]", 'story: function* ({ row }) { yield { say: … } }'])
  if (!account.steps.length) report('API-TYPE', 'explain(): the story has no steps, so there is nothing to play.', ["story: [{ say: 'Three [values](row).' }]"])
}
