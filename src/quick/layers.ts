// layers({ sizes, values?, weights?, train? }): a layered network (neurons, pipeline stages). Node brightness and
// link colour / width come from functions, or from a network that is REALLY trained here (plain gradient descent,
// every round recorded), so nothing on screen is made up. The author writes sizes and names; places come from the
// rectangle the stage gives the block.
import { kindOf, PACE, PALETTE, selector, smooth, type Handle, type Param } from '../core/index.ts'
import { circle, dot, group, line, text } from '../r2d/index.ts'
import { fadeIn, fadeOut, indicate, moveAlong } from '../anim/index.ts'
import { rng as makeRng } from '../lib/sim/index.ts'
import type { BlockCtx, BlockDef, BlockHandle } from './block.ts'
import { nearest } from './flowparse.ts'

/** Every default of the layers block, by name. `layers({ look: { … } })` overrides any of them. */
export const LAYERS_BLOCK = Object.freeze({
  aspect: 1.7,
  weight: 1.4,
  /** largest node radius, and the share of the space between neighbours a node may take (across, down) */
  radius: 0.5,
  across: 0.2,
  down: 0.36,
  /** a node shows its number from this radius on; the number turns dark from this brightness on (the value at
   *  which dark ink and light ink both keep a contrast of 4.5:1 against the node's grey) */
  numbered: 0.3,
  flip: 0.46,
  /** link width (1 = 0.01 units) at weight 0 and at the strongest weight; opacity at weight 0 */
  thin: 1.2,
  thick: 6.5,
  faint: 0.3,
  /** the |weight| drawn at full width when the weights do not say (a trained network uses its own largest) */
  strongest: 4,
  /** seconds a pulse takes from one layer to the next */
  hop: 0.8,
  pulse: 0.07,
  /** width kept for a name beside the first and last layer, per character (frame units) */
  letter: 0.125,
  up: PALETTE.BLUE, downward: PALETTE.RED, ink: PALETTE.WHITE, dark: PALETTE.BLACK, quiet: PALETTE.GREY_B, signal: PALETTE.YELLOW,
})
type Look = { -readonly [K in keyof typeof LAYERS_BLOCK]: (typeof LAYERS_BLOCK)[K] }
/** Every default of train(), by name. */
export const TRAIN_DEFAULTS = Object.freeze({ rate: 1, rounds: 200, seed: 1, spread: 1 })

export interface Example { x: readonly number[]; y: readonly number[] | number }
export interface TrainOptions { sizes: readonly number[]; data: readonly Example[] | ((random: { (): number; range(a: number, b: number): number }) => readonly Example[]); rate?: number; rounds?: number; seed?: number | string }
/** weights[l][j][i]: from node i of layer l to node j of layer l + 1; biases[l][j]: of node j of layer l + 1 */
export interface Net { weights: number[][][]; biases: number[][] }
export interface Training {
  sizes: number[]
  data: Example[]
  rounds: number
  /** the network after every round; history[0] is the random start */
  history: Net[]
  /** mean absolute error over the data after every round */
  errors: number[]
  /** every layer's values for one input */
  forward(net: Net, x: readonly number[]): number[][]
  /** the network between two recorded rounds */
  at(round: number): Net
}
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u

/** Train a small fully connected network (sigmoid units, cross-entropy, full-batch gradient descent) and keep every round. */
export function train(options: TrainOptions): Training {
  const sizes = (Array.isArray(options?.sizes) ? options.sizes : []).map((n) => Math.max(1, Math.round(Number(n) || 1)))
  const random = makeRng(options?.seed ?? TRAIN_DEFAULTS.seed)
  const draw = Object.assign(() => random.next(), { range: (a: number, b: number) => random.range(a, b) })
  const raw = typeof options?.data === 'function' ? options.data(draw) : options?.data
  const data: Example[] = (Array.isArray(raw) ? raw : []).filter((e) => e && Array.isArray(e.x)).map((e) => ({ x: e.x, y: Array.isArray(e.y) ? e.y : [Number(e.y)] }))
  const rounds = Math.max(0, Math.round(options?.rounds ?? TRAIN_DEFAULTS.rounds)), rate = options?.rate ?? TRAIN_DEFAULTS.rate
  const net: Net = {
    weights: sizes.slice(1).map((n, l) => Array.from({ length: n }, () => Array.from({ length: sizes[l]! }, () => random.range(-TRAIN_DEFAULTS.spread, TRAIN_DEFAULTS.spread)))),
    biases: sizes.slice(1).map((n) => Array.from({ length: n }, () => random.range(-TRAIN_DEFAULTS.spread, TRAIN_DEFAULTS.spread))),
  }
  const forward = (q: Net, x: readonly number[]): number[][] => {
    const values: number[][] = [sizes.length ? Array.from({ length: sizes[0]! }, (_, i) => Number(x[i]) || 0) : []]
    q.weights.forEach((layer, l) => values.push(layer.map((row, j) => sigmoid(row.reduce((sum, w, i) => sum + w * values[l]![i]!, q.biases[l]![j]!)))))
    return values
  }
  const copy = (q: Net): Net => ({ weights: q.weights.map((l) => l.map((r) => [...r])), biases: q.biases.map((b) => [...b]) })
  const error = (q: Net): number => (data.length ? data.reduce((sum, e) => { const out = forward(q, e.x)[sizes.length - 1]!; return sum + out.reduce((s, v, k) => s + Math.abs(v - ((e.y as number[])[k] ?? 0)), 0) / out.length }, 0) / data.length : 0)
  const history = [copy(net)], errors = [error(net)]
  for (let round = 0; round < rounds && data.length; round++) {
    const gw = net.weights.map((l) => l.map((r) => r.map(() => 0))), gb = net.biases.map((b) => b.map(() => 0))
    for (const e of data) {
      const values = forward(net, e.x)
      // the gradient of the cross-entropy at the output is (output − target); it is passed back layer by layer
      let delta = values[sizes.length - 1]!.map((v, k) => v - ((e.y as number[])[k] ?? 0))
      for (let l = net.weights.length - 1; l >= 0; l--) {
        const below = values[l]!
        delta.forEach((d, j) => { gb[l]![j]! += d; below.forEach((v, i) => { gw[l]![j]![i]! += d * v }) })
        if (l > 0) delta = below.map((v, i) => delta.reduce((sum, d, j) => sum + d * net.weights[l]![j]![i]!, 0) * v * (1 - v))
      }
    }
    const step = rate / data.length
    net.weights.forEach((layer, l) => layer.forEach((row, j) => row.forEach((_, i) => { row[i]! -= step * gw[l]![j]![i]! })))
    net.biases.forEach((b, l) => b.forEach((_, j) => { b[j]! -= step * gb[l]![j]! }))
    history.push(copy(net))
    errors.push(error(net))
  }
  const last = history.length - 1
  const at = (round: number): Net => {
    const r = Math.min(last, Math.max(0, round)), i = Math.floor(r), u = r - i, a = history[i]!, b = history[Math.min(last, i + 1)]!
    return u === 0 ? a : { weights: a.weights.map((l, x) => l.map((row, j) => row.map((w, k) => lerp(w, b.weights[x]![j]![k]!, u)))), biases: a.biases.map((l, x) => l.map((v, j) => lerp(v, b.biases[x]![j]!, u))) }
  }
  return { sizes, data, rounds: last, history, errors, forward, at }
}

type Values = readonly (readonly number[])[] | ((layer: number, index: number, env: Record<string, any>) => number)
type Weights = readonly (readonly (readonly number[])[])[] | ((layer: number, from: number, to: number, env: Record<string, any>) => number)
export interface LayersOptions {
  /** nodes per layer, first to last: [2, 3, 1] */
  sizes: readonly number[]
  /** brightness of each node, 0..1: values[layer][index], or (layer, index, { control, block }) => number */
  values?: Values
  /** weight of each link: weights[layer][to][from], or (layer, from, to, { control, block }) => number. Positive is drawn in one colour, negative in the other; width is its size */
  weights?: Weights
  /** names beside the first and the last layer, and over each layer */
  inputs?: readonly string[]
  outputs?: readonly string[]
  names?: readonly string[]
  /** train a real network on data: { data, rate, rounds, seed }; the block then shows it at its `round` */
  train?: Omit<TrainOptions, 'sizes'>
  /** controls that feed the first layer of a trained network, by name (default: the first example of the data) */
  feed?: readonly string[]
  look?: Partial<Look>
}
export interface LayersState { round: number; focus: string | null; pulses: number; version: number }
const KEYS = ['round', 'pulse', 'focus', 'set'] as const

/** The pure half of the block: what a change does to the state, and what it could not read. */
export function reduceLayers(prev: LayersState, change: unknown, o: { rounds: number; targets: readonly string[] }): { state: LayersState; pulse: boolean; set: { values?: Values; weights?: Weights } | null; problems: { what: string; fix: string }[] } {
  const state: LayersState = { ...prev }
  const problems: { what: string; fix: string }[] = []
  const c = (typeof change === 'object' && change !== null ? change : {}) as Record<string, unknown>
  for (const k of Object.keys(c)) if (!(KEYS as readonly string[]).includes(k)) { const near = nearest(k, KEYS); problems.push({ what: `"${k}" is not something layers can be told`, fix: near ? `did you mean "${near}"? (${KEYS.join(', ')})` : `one of: ${KEYS.join(', ')}` }) }
  if (c.round !== undefined) {
    if (!o.rounds) problems.push({ what: 'round needs a trained network', fix: 'layers({ sizes, train: { data, rounds: 200 } })' })
    else if (c.round === 'end') state.round = o.rounds
    else if (typeof c.round === 'number' && Number.isFinite(c.round)) state.round = Math.min(o.rounds, Math.max(0, c.round))
    else problems.push({ what: "round must be a number or 'end'", fix: "round: 0  ·  round: 'end'" })
  }
  if (c.focus !== undefined) {
    if (c.focus === null || c.focus === false) state.focus = null
    else if (typeof c.focus === 'string' && o.targets.includes(c.focus)) state.focus = c.focus
    else { const near = typeof c.focus === 'string' ? nearest(c.focus, o.targets) : null; problems.push({ what: `focus: ${JSON.stringify(c.focus)} names no node or link`, fix: near ? `did you mean '${near}'?` : "a node is 'layer.index' counted from 1 ('2.1'), a link is 'from-to' ('1.2-2.1')" }) }
  }
  const pulse = c.pulse === true || (typeof c.pulse === 'number' && c.pulse > 0)
  if (pulse) state.pulses++
  let set: { values?: Values; weights?: Weights } | null = null
  if (c.set !== undefined) {
    if (typeof c.set === 'object' && c.set !== null) { set = c.set as { values?: Values; weights?: Weights }; state.version++ }
    else problems.push({ what: 'set needs { values } and / or { weights }', fix: 'set: { values: [[1, 0], [0.2, 0.9, 0.4], [0.7]] }' })
  }
  return { state, pulse, set, problems }
}

/** A layered network: layers({ sizes: [2, 3, 1], inputs: ['sun', 'wind'], train: { data, rounds: 300 } }). */
export function layers(opts: LayersOptions): BlockDef<LayersState> {
  const o = (typeof opts === 'object' && opts !== null ? opts : { sizes: [] }) as LayersOptions
  const look: Look = { ...LAYERS_BLOCK, ...(typeof o.look === 'object' && o.look !== null ? o.look : {}) }
  return { kind: 'layers', prefer: { aspect: look.aspect, weight: look.weight }, build: (ctx) => buildLayers(ctx, o, look) }
}

function buildLayers(ctx: BlockCtx, o: LayersOptions, look: Look): BlockHandle<LayersState> {
  const { s, id, rect } = ctx
  const known = ['sizes', 'values', 'weights', 'inputs', 'outputs', 'names', 'train', 'feed', 'look']
  for (const k of Object.keys(o)) if (!known.includes(k)) { const near = nearest(k, known); ctx.report(`${id}: layers has no option "${k}"`, near ? `did you mean "${near}"?` : `options: ${known.join(', ')}`) }
  let sizes = (Array.isArray(o.sizes) ? o.sizes : []).map((n) => Math.round(Number(n))).filter((n) => n >= 1)
  if (sizes.length < 2) { ctx.report(`${id}: layers needs sizes, at least two layers`, 'layers({ sizes: [2, 3, 1] })'); sizes = [1, 1] }
  const env: Record<string, any> = new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? (ctx.control(key)?.() ?? ctx.block(key)?.api) : undefined) })
  const safe = (fn: () => number): number => { try { const v = fn(); return Number.isFinite(v) ? v : 0 } catch { return 0 } }

  // ── where the numbers come from: a trained network at its round, or the author's functions (blended on `set`) ──
  const training = o.train ? train({ ...o.train, sizes }) : null
  if (training && !training.data.length) ctx.report(`${id}: train has no data`, 'train: { data: [{ x: [0, 1], y: 1 }, …] }')
  const round: Param<number> | null = training ? s.param(`${id} round`, { value: 0, min: 0, max: Math.max(1, training.rounds), step: 1, label: `${id}: round` }) : null
  const feed = (o.feed ?? []).map((name) => { const c = ctx.control(name); if (!c) ctx.report(`${id}: feed: '${name}' is not a control`, 'declare it: controls: { ' + name + ': { from: 0, to: 1 } }'); return c })
  const versions: { values?: Values; weights?: Weights }[] = [{ values: o.values, weights: o.weights }]
  const blend: Param<number> | null = training ? null : s.param(`${id} change`, { value: 0, min: 0, max: 1, label: `${id}: change` })
  const valueOf = (v: { values?: Values }, l: number, i: number): number => (typeof v.values === 'function' ? safe(() => (v.values as Function)(l, i, env)) : Number(v.values?.[l]?.[i] ?? 0))
  const weightOf = (v: { weights?: Weights }, l: number, from: number, to: number): number => (typeof v.weights === 'function' ? safe(() => (v.weights as Function)(l, from, to, env)) : Number(v.weights?.[l]?.[to]?.[from] ?? 1))
  const between = <T,>(read: (v: { values?: Values; weights?: Weights }) => number): number => {
    const x = Math.min(versions.length - 1, Math.max(0, blend ? blend() : 0)), k = Math.floor(x)
    return lerp(read(versions[k]!), read(versions[Math.min(versions.length - 1, k + 1)]!), x - k)
  }
  const netNow = s.signal(() => training!.at(round!()))
  const valuesNow = s.signal(() => training!.forward(netNow(), feed.length ? feed.map((c) => (c ? c() : 0)) : training!.data[0]?.x ?? []))
  const value = (l: number, i: number): number => Math.min(1, Math.max(0, training ? valuesNow()[l]?.[i] ?? 0 : between((v) => valueOf(v, l, i))))
  const weight = (l: number, from: number, to: number): number => (training ? netNow().weights[l]?.[to]?.[from] ?? 0 : between((v) => weightOf(v, l, from, to)))
  const strongest = training ? Math.max(1e-6, ...training.history.flatMap((n) => n.weights.flat(2).map(Math.abs))) : look.strongest

  // ── the picture, inside the rectangle ──────────────────────────────────────────────────────────────────────────
  const longest = (list?: readonly string[]): number => Math.max(0, ...(list ?? []).map((n) => String(n).length)) * look.letter
  const left = longest(o.inputs) ? longest(o.inputs) + 0.25 : 0, right = longest(o.outputs) ? longest(o.outputs) + 0.25 : 0
  const top = o.names?.length ? 0.45 : 0
  const tall = Math.max(...sizes), inner = { width: Math.max(0.5, rect.width - left - right), height: Math.max(0.5, rect.height - top) }
  const r = Math.min(look.radius, (inner.width / sizes.length) * look.across, (inner.height / tall) * look.down)
  const x = (l: number): number => rect.left + left + r + ((inner.width - 2 * r) * l) / (sizes.length - 1)
  const pitch = Math.min(inner.height / tall, r * 3.4)
  const y = (l: number, i: number): number => rect.bottom + inner.height / 2 + ((sizes[l]! - 1) / 2 - i) * pitch
  const parts: Handle[] = [], nodes: Handle[][] = [], numbers: (Handle | null)[][] = [], links: Record<string, Handle> = {}
  sizes.forEach((n, l) => {
    nodes.push([]); numbers.push([])
    for (let i = 0; i < n; i++) {
      const body = circle({ id: `${id}.${l + 1}.${i + 1}`, radius: r, stroke: look.ink, strokeWidth: 2.5, fill: look.ink, fillOpacity: () => value(l, i) }).at(x(l), y(l, i))
      nodes[l]!.push(body); parts.push(body)
      const number = r >= look.numbered ? text(() => value(l, i).toFixed(2), { size: 'note', backstroke: 0, color: () => (value(l, i) >= look.flip ? look.dark : look.ink) }).at(body) : null
      numbers[l]!.push(number); if (number) parts.push(number)
    }
  })
  for (let l = 0; l < sizes.length - 1; l++) for (let a = 0; a < sizes[l]!; a++) for (let b = 0; b < sizes[l + 1]!; b++) {
    const size = (): number => Math.min(1, Math.abs(weight(l, a, b)) / strongest)
    const link = line(nodes[l]![a]!, nodes[l + 1]![b]!, { id: `${id}.${l + 1}.${a + 1}-${l + 2}.${b + 1}`, color: () => (weight(l, a, b) >= 0 ? look.up : look.downward), strokeWidth: () => look.thin + (look.thick - look.thin) * size(), opacity: () => look.faint + (1 - look.faint) * size() }).z(-1)
    links[`${l + 1}.${a + 1}-${l + 2}.${b + 1}`] = link
    parts.push(link)
  }
  ;(o.inputs ?? []).slice(0, sizes[0]).forEach((name, i) => parts.push(text(String(name), { size: 'note', color: look.quiet }).nextTo(nodes[0]![i]!, 'left', 0.2)))
  ;(o.outputs ?? []).slice(0, sizes[sizes.length - 1]).forEach((name, i) => parts.push(text(String(name), { size: 'note', color: look.quiet }).nextTo(nodes[sizes.length - 1]![i]!, 'right', 0.2)))
  ;(o.names ?? []).slice(0, sizes.length).forEach((name, l) => parts.push(text(String(name), { size: 'note', color: look.quiet }).at(x(l), rect.top - 0.2)))
  const root: Handle = group(parts)
  if (training) { s.probe(`${id}.error`, () => { const e = training.errors, q = round!(), i = Math.floor(q); return lerp(e[i]!, e[Math.min(e.length - 1, i + 1)]!, q - i) }) }

  const nodeAt = (path: string): Handle | undefined => { const m = /^(\d+)\.(\d+)$/.exec(path); return m ? nodes[Number(m[1]) - 1]?.[Number(m[2]) - 1] : undefined }
  const targets = (): string[] => [...nodes.flatMap((layer, l) => layer.map((_, i) => `${l + 1}.${i + 1}`)), ...Object.keys(links)]
  const target = (path: string): Handle | undefined => (!path ? root : nodeAt(path) ?? links[path])

  const apply = (st: any, change: unknown, prev: LayersState): LayersState => {
    const { state, pulse, set, problems } = reduceLayers(prev, change, { rounds: training?.rounds ?? 0, targets: targets() })
    for (const p of problems) ctx.report(`${id}: ${p.what}`, p.fix)
    if (round && state.round !== prev.round) st.set(round, state.round, { rate: smooth })
    if (set) {
      if (!blend) ctx.report(`${id}: a trained network shows its own numbers; set has no effect`, "move it through training instead: { round: 'end' }")
      else {
        const last = versions[versions.length - 1]!
        versions.push({ values: set.values ?? last.values, weights: set.weights ?? last.weights })
        const def = (blend as unknown as { def: { max: number } }).def
        def.max = Math.max(def.max, versions.length - 1)
        st.set(blend, versions.length - 1)
      }
    }
    if (state.focus !== prev.focus && state.focus) {
      const t = target(state.focus)!
      const m = /^(\d+)\.(\d+)$/.exec(state.focus)
      const number = m ? numbers[Number(m[1]) - 1]?.[Number(m[2]) - 1] : null
      const ends = state.focus.includes('-') ? state.focus.split('-').flatMap((p) => { const n = nodeAt(p); const q = /^(\d+)\.(\d+)$/.exec(p)!; const num = numbers[Number(q[1]) - 1]?.[Number(q[2]) - 1]; return [n, num].filter(Boolean) as Handle[] }) : []
      // dim the rest of THIS network only: the title and the other blocks keep their light (the engine's st.focus darkens the whole frame)
      const keep = new Set<unknown>(), own = new Set<unknown>()
      const mark = (into: Set<unknown>) => (n: { children?: unknown[] }): void => { into.add(n); (n.children ?? []).forEach((c) => mark(into)(c as { children?: unknown[] })) }
      for (const n of [t, ...(number ? [number] : []), ...ends]) mark(keep)(n as never)
      mark(own)(root as never)
      st.clip(selector((n) => own.has(n) && !keep.has(n) && !kindOf(n.kind)?.container), 'dim', 1, { duration: PACE.scopedIn, scope: 'step' })
      st.action('focus', { nodes: [t] })
    }
    if (pulse) {
      // one forward pass: a dot runs along every link of a layer at once, the next layer lights up, and so on
      for (let l = 0; l < sizes.length - 1; l++) {
        const runners = Object.entries(links).filter(([k]) => k.startsWith(`${l + 1}.`)).map(([, link]) => ({ link, runner: dot({ radius: look.pulse, color: look.signal }).at(link.start).z(2).allow('TINY') }))
        st.play(...runners.map((q) => fadeIn(q.runner, { duration: look.hop / 4 })))
        st.play(...runners.map((q) => moveAlong(q.runner, q.link, { duration: look.hop })))
        st.play(...runners.map((q) => fadeOut(q.runner, { duration: look.hop / 4 })), ...nodes[l + 1]!.map((n) => indicate(n, { color: look.signal, duration: look.hop / 2 })))
      }
    }
    return state
  }
  const api = {
    sizes,
    /** the value of a node and the weight of a link right now */
    value: (layer: number, index: number): number => value(layer, index),
    weight: (layer: number, from: number, to: number): number => weight(layer, from, to),
    /** a trained network: its recorded error after every round, what a chart follows, and its clock (the round) */
    rounds: training?.rounds ?? 0,
    error: (at?: number): number => (training ? training.errors[Math.min(training.rounds, Math.max(0, Math.round(at ?? training.rounds)))]! : 0),
    series: (name: string) => (name === 'error' && training ? (): [number, number][] => training.errors.map((e, i) => [i, e]) : undefined),
    time: (): number => (round ? round() : 0),
    end: (): number => training?.rounds ?? 0,
    training,
  }
  return {
    root, initial: { round: 0, focus: null, pulses: 0, version: 0 }, keys: null, target, targets, apply: apply as BlockHandle<LayersState>['apply'], api,
    describe: (state) => `${id}: layers ${sizes.join(' → ')}${training ? `; round ${Math.round(state.round)} of ${training.rounds}, error ${api.error(state.round).toFixed(3)}` : ''}${state.focus ? `; focus on ${state.focus}` : ''}`,
  }
}
