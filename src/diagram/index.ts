// System diagrams (pure side, main chunk): nodes, edges, graphs laid out automatically, tokens, queues, timers,
// traffic (a seeded simulation of tokens through a graph) and sequence diagrams. Everything here is constructors,
// schemas, bounds, anchors and outlines; the drawing, the layout engine and the simulation live in ./diagram.chunk.ts
// and reach this file through `slots`. Nothing here touches the DOM.
import {
  apply, boxOf, clamp01, closest, constructorOf, defineKind, defineKindMethod, defineKindSetter, definePlacement, emOf, emptyBox, expand, isNode, lagged,
  NOOP_ANIM, PACE, seq, smooth, TEXT_SIZES, union,
  type Anim, type Box3, type Frame, type Handle, type MNode, type Patch, type Resolved, type SceneModel, type Schema, type Vec3,
} from '../core/index.ts'
import { create } from '../anim/index.ts'
import { bendControl, ends, faceOf, line, lineMetrics, pointOnOutline, text } from '../r2d/index.ts'
import { circlePath, rectPath, type Subpath } from '../lib/path/index.ts'

// ── defaults ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * Every number and colour that shapes a diagram, in one place. Each one is the default of an option that a call can
 * override (the option is named in the comment); sizes are frame units, stroke widths are hundredths of a unit,
 * durations are seconds. The proportions are those of a thin-stroked light-on-black diagram: 2 px lines at 1080p.
 */
export const DIAGRAM_DEFAULTS = Object.freeze({
  /** node outline: `color`, `strokeWidth` */
  nodeColor: '#BBBBBB', nodeStroke: 1.6,
  /** edge line and arrow tip: `color`, `strokeWidth`; gap between an edge and the shapes it joins: `buff` */
  edgeColor: '#888888', edgeStroke: 1.5, edgeBuff: 0.05,
  /** a dashed outline or edge: length of a dash and of the gap after it */
  dash: 0.09, dashGap: 0.07,
  /** arrow tip of an edge (length, half width); they scale with `strokeWidth` */
  tipLength: 0.13, tipHalf: 0.05,
  /** label text of nodes / edges / counts: `labelSize`, `labelColor`, `countColor`; gap between a shape and a label beside it */
  labelSize: 24, edgeLabelSize: 20, countSize: 30, labelColor: '#DDDDDD', countColor: '#FFFFFF', labelGap: 0.14,
  /** space between a label and the count beside it, between an edge and its label, between a token and its label, and round a label inside a circle */
  inlineGap: 0.13, edgeLabelGap: 0.09, tokenLabelGap: 0.09, circlePadding: 0.15,
  /** sizes a node takes when `width` / `height` are not given */
  boxWidth: 0.92, boxHeight: 0.74, boxRadius: 0.1, boxPadding: 0.28, circleSize: 0.74, ringSize: 0.84, ringGap: 0.08, cylinderWidth: 0.96, cylinderHeight: 1.24, cylinderCap: 0.125,
  /** a queue: height, distance between slot centres, slot radius, space at each end; empty slots are drawn in `slotColor` */
  queueHeight: 0.62, slotPitch: 0.3, slotRadius: 0.1, queueEnd: 0.24, slotColor: '#444444', slotStroke: 1.5,
  /** what fills a slot, a ring or a timer, and what a token is: `accent` on nodes, `color` on tokens and timers */
  accent: '#58C4DD', ringStroke: 3, tokenRadius: 0.07,
  /** one colour per meaning: `states` on a node */
  states: Object.freeze({ idle: '#888888', busy: '#58C4DD', waiting: '#F0AC5F', failed: '#FC6255', down: '#FC6255', done: '#83C167' }) as Readonly<Record<string, string>>,
  /** opacity of the label of a node that is down: pushed back, still readable on black (above the 4.5:1 that small text needs) */
  downLabel: 0.6,
  /** the state badge: a dot of this radius, this far off the upper right corner of the outline */
  badgeRadius: 0.045, badgeGap: 0.07,
  /** a failure flash: seconds it lasts, how far its ring starts from the outline and how far it swells, and its width at the start (it thins to 1) */
  flashSeconds: 0.7, flashStart: 0.04, flashReach: 0.22, flashStroke: 4,
  /** graph(): space between neighbours of one rank, between ranks, and the box the drawing must fit in (`nodeGap`, `rankGap`, `width`, `height`) */
  nodeGap: 0.45, rankGap: 1.15, graphWidth: 12.6, graphHeight: 5.6,
  /** g.draw(): share of each part's drawing time before the next part starts (`lag`) */
  drawLag: 0.25,
  /** a group box of a graph: its outline (`color`, `strokeWidth`), the space it keeps round its nodes (`padding`), its corner radius and its label */
  groupColor: '#444444', groupStroke: 1.2, groupPadding: 0.2, groupRadius: 0.14, groupLabelSize: 18, groupLabelColor: '#888888',
  /** tokens(): frame units per second (`speed`), and the length over which a token fades at each end of its edge */
  streamSpeed: 1.2, streamFade: 0.18,
  /** traffic(): seconds per edge (`travel`), through a node that only passes jobs on (`hop`), to settle into / advance one slot, between two departures of a queue (`release` of a station) */
  travel: 0.9, hop: 0.25, settle: 0.35, release: 0.3,
  /** traffic(): frame units per second a token averages while it glides to its place inside a node; seconds it takes to appear; how far apart jobs served together sit */
  glide: 2.4, appear: 0.2, seatSpread: 0.16,
  /** traffic(): the backoff ring round a waiting job (radius in token radii, width, opacity of its track), the core of a job that has failed (in token radii), and how a job shrinks when it is done and swells when it is dead */
  waitRing: 2.6, waitStroke: 2.5, waitTrack: 0.25, coreShare: 0.45, doneShrink: 0.35, deadSwell: 0.5,
  /** traffic(): how far towards the middle of a node a job moves while it is taken in: where it ends (`absorbReach`) and where it only goes out of sight (`slip`), as shares of the way */
  absorbReach: 0.5, slip: 0.15,
  /** traffic(): seconds before a job whose way back is full or down asks again */
  retryPoll: 0.25,
  /** traffic(): retries before a job is given up, the first backoff in seconds and what each further one is multiplied by (`retry`) */
  retryLimit: 3, backoff: 1, backoffFactor: 2, failedColor: '#FC6255', waitColor: '#F0AC5F', doneColor: '#83C167',
  /** sequence(): distance between lifelines, between messages, and seconds each message takes to draw in draw() */
  actorGap: 2.6, messageGap: 0.62, messageSeconds: 0.6,
  /** when nobody gives an actorGap the lifelines are spread over about this width, each gap at most `actorGapMax` (and never under `actorGap`) */
  sequenceSpan: 7.8, actorGapMax: 6,
  /** sequence(): how far a message from an actor to itself swings out from its lifeline */
  selfReach: 0.75,
})
const D = DIAGRAM_DEFAULTS

// ── what the lazy chunk fills in ──────────────────────────────────────────────────────────────────────
/** A graph laid out: node centres and edge routes in the graph's own coordinates (centred on its origin). */
export interface GraphGeom {
  /** node uid → centre */
  pos: Map<number, [number, number]>
  /** one route per edge of the graph, as flat cubic coordinates (2 + 6·n numbers); null = join the two outlines directly */
  routes: (number[] | null)[]
  /** uniform factor the drawing was shrunk by to fit its box (1 = not shrunk) */
  scale: number
  width: number
  height: number
  /** edge crossings left in the drawing */
  crossings: number
}
/** Totals of a traffic simulation at one time. sent = done + dead + queued + inFlight, always. */
export interface TrafficCounts { sent: number; done: number; dead: number; queued: number; inFlight: number }
/** What one node of a traffic simulation is doing at one time. */
export interface StationView { sent: number; done: number; failed: number; waiting: number; busy: number; /** 0..1 of the job that has been served longest */ progress: number; down: boolean; /** 0..1 progress of the flash of its latest failure, null when none is running */ flash: number | null }
/** One job of a traffic simulation as drawn at one time (frame coordinates). */
export interface TokenPose { id: number; x: number; y: number; alpha: number; scale: number; color: string; /** 0..1: a job that has failed keeps a core in the failure colour */ core: number; /** share of a backoff still to wait (1 → 0), null when it is not waiting one out */ wait: number | null }
/** A traffic simulation at the time of one frame. */
export interface TrafficView {
  t: number
  counts: TrafficCounts
  station(id: string): StationView
  /** every job that is on stage, in job order (computed when asked: it needs where the nodes and edges are) */
  tokens(): TokenPose[]
  /** jobs that exist at this time and are neither done nor dead, counted from the job histories (the linter compares it with queued + inFlight) */
  live: number
  /** problems the simulation ran into (a function that threw, the event cap) */
  issues: readonly string[]
}
/** Filled in by ./diagram.chunk.ts when it loads. The pure side works without it (a plain row layout, no traffic). */
export const slots: {
  layout?: (graph: MNode, frame: Frame) => GraphGeom
  traffic?: (node: MNode, frame: Frame) => TrafficView
} = {}

// ── per-model bookkeeping ─────────────────────────────────────────────────────────────────────────────
export interface Topology { nodes: MNode[]; edges: { edge: MNode; from: number; to: number }[] }
interface DiagramStore {
  /** edge uid → the graph that routes it and its index among that graph's edges */
  routed: Map<number, { graph: MNode; index: number }>
  /** graph uid → its member nodes (in declaration order) and its edges */
  graphs: Map<number, { members: MNode[]; edges: MNode[]; groups: MNode[]; direction: 'right' | 'down' }>
  /** group box uid → the nodes it is drawn round */
  clusters: Map<number, MNode[]>
  /** node uid → the graph it belongs to */
  owner: Map<number, MNode>
  /** traffic uid → the nodes and edges it runs over */
  topology: Map<number, Topology>
  /** edge uid → a line the module that made the edge decides (flat cubic coordinates in frame space): a message from an actor to itself */
  curves: Map<number, (frame: Frame) => number[]>
}
export const storeOf = (model: SceneModel): DiagramStore => model.store<DiagramStore>('diagram', () => ({ routed: new Map(), graphs: new Map(), clusters: new Map(), owner: new Map(), topology: new Map(), curves: new Map() }))
const report = (model: SceneModel, code: string, what: string, fix: string[], ids: string[] = []): void => { model.diagnostics.add({ code, what, fix, ids }) }

// ── node geometry (pure) ─────────────────────────────────────────────────────────────────────────────
/**
 * The defaults of this module as one scene sees them: `DIAGRAM_DEFAULTS`, with whatever the engine's config store holds under
 * 'diagram.<name>' (model.config('diagram.<name>', fallback), when the core has one). Worked out once per scene.
 */
export const diagramDefaults = (model: SceneModel): typeof DIAGRAM_DEFAULTS => model.store<typeof DIAGRAM_DEFAULTS>('diagram.defaults', () => {
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask !== 'function') return DIAGRAM_DEFAULTS
  const out = { ...DIAGRAM_DEFAULTS } as Record<string, unknown>
  for (const key of Object.keys(out)) { const v = ask.call(model, 'diagram.' + key, out[key]); if (v !== undefined && typeof v === typeof out[key]) out[key] = v }
  return out as typeof DIAGRAM_DEFAULTS
})

export const SHAPES = ['box', 'pill', 'circle', 'cylinder', 'queue', 'ring'] as const
export type Shape = (typeof SHAPES)[number]
export type LabelAt = 'inside' | 'above' | 'below' | 'left' | 'right' | 'none'
export interface NodeGeom {
  shape: Shape
  width: number
  height: number
  /** corner radius of the outline (box, pill, queue) */
  radius: number
  labelAt: LabelAt
  /** local centre of the label and of the count, and the size the count is set in */
  label: [number, number]
  count: [number, number]
  countAt: 'center' | 'inline' | 'none'
  countSize: number
  /** how far the node reaches beyond its centre with its texts: [left, right, bottom, top] */
  reach: [number, number, number, number]
  slots: number
  pitch: number
}
/** width of a label in frame units, from the tables of the embedded text face: the same answer as the text() that draws it */
const textWidth = (s: string, size: number): number => lineMetrics(s, faceOf('serif', 'normal', false)).width * emOf(size)
const textHeight = (size: number): number => 0.9 * emOf(size)
const ROOMY: readonly Shape[] = ['box', 'pill', 'circle', 'cylinder']
/** true when the node shows a count (decided by what the scene wrote, so a count that is null for a moment moves nothing) */
const counted = (node: MNode): boolean => (node.props.count !== null && node.props.count !== undefined) || !!node.model.clipsFor(node, 'count')

/** Size of a node, where its label and count sit, and how far they reach. The backend, the bounds, the layout and the tokens all read this one answer. */
export function nodeGeom(node: MNode, frame: Frame): NodeGeom {
  return frame.memo('dg' + node.uid, () => {
    // single options are read one by one: asking for all of them would ask for the ones a simulation drives
    const r = { shape: frame.prop<string>(node, 'shape'), label: frame.prop<string>(node, 'label'), labelSize: frame.prop<number>(node, 'labelSize'), labelAt: frame.prop<string>(node, 'labelAt'), slots: frame.prop<number>(node, 'slots'), width: frame.prop<number | null>(node, 'width'), height: frame.prop<number | null>(node, 'height'), count: frame.prop<number | null>(node, 'count') }
    const shape = (SHAPES as readonly string[]).includes(r.shape) ? (r.shape as Shape) : 'box'
    const label = String(r.label ?? '')
    const size = r.labelSize > 0 ? r.labelSize : D.labelSize
    const lw = label ? textWidth(label, size) : 0, lh = label ? textHeight(size) : 0
    const has = counted(node)
    const down = storeOf(node.model).graphs.get(storeOf(node.model).owner.get(node.uid)?.uid ?? -1)?.direction === 'down'
    let at: LabelAt = r.labelAt === 'auto' ? 'inside' : (r.labelAt as LabelAt)
    if (r.labelAt === 'auto') {
      if (shape === 'queue' || shape === 'ring') at = 'above'
      else if (shape === 'circle') at = !has && lw <= 0.5 ? 'inside' : 'above'
      else if (shape === 'cylinder') at = has ? 'above' : 'inside'
      else at = has ? 'below' : 'inside'
      // in a graph that flows down, the edges arrive from above and leave below: the label goes beside the node
      if (down && (at === 'above' || at === 'below')) at = 'right'
    }
    if (!label) at = 'none'
    const slotCount = Math.max(1, Math.round(r.slots ?? 1))
    let width: number, height: number, radius = 0, pitch: number = D.slotPitch
    const inside = at === 'inside' ? lw + 2 * D.boxPadding : 0
    if (shape === 'queue') {
      height = r.height ?? D.queueHeight
      width = r.width ?? slotCount * D.slotPitch + 2 * D.queueEnd
      pitch = Math.min(D.slotPitch * 1.5, (width - 2 * D.queueEnd) / slotCount)
      radius = height / 2
    } else if (shape === 'circle' || shape === 'ring') {
      width = height = r.width ?? r.height ?? Math.max(shape === 'ring' ? D.ringSize : D.circleSize, at === 'inside' ? lw + 2 * D.circlePadding : 0)
    } else if (shape === 'cylinder') {
      width = r.width ?? Math.max(D.cylinderWidth, inside)
      height = r.height ?? D.cylinderHeight
    } else {
      width = r.width ?? Math.max(D.boxWidth, inside)
      height = r.height ?? D.boxHeight
      radius = shape === 'pill' ? height / 2 : Math.min(D.boxRadius, height / 2)
    }
    const countAt = !has ? 'none' : at !== 'inside' && ROOMY.includes(shape) ? 'center' : 'inline'
    const countSize = countAt === 'center' ? D.countSize : size
    const shown = typeof r.count === 'number' && Number.isFinite(r.count) ? String(Math.round(r.count)) : ''
    // an inline count keeps room for two digits, so the label does not shift when 9 becomes 10
    const cw = countAt === 'inline' ? Math.max(textWidth('00', countSize), textWidth(shown, countSize)) : textWidth(shown, countSize)
    const g = D.labelGap
    const sink = shape === 'cylinder' ? -D.cylinderCap / 2 : 0
    let lp: [number, number] = [0, sink]
    if (at === 'above') lp = [0, height / 2 + g + lh / 2]
    else if (at === 'below') lp = [0, -height / 2 - g - lh / 2]
    else if (at === 'left') lp = [-width / 2 - g - lw / 2, 0]
    else if (at === 'right') lp = [width / 2 + g + lw / 2, 0]
    let cp: [number, number] = [0, sink]
    if (countAt === 'inline') {
      const gap = label ? D.inlineGap : 0
      if (at === 'none') cp = [0, height / 2 + g + textHeight(countSize) / 2]
      else {
        // label and count read as one line; above and below the pair is centred on the node
        if (at === 'above' || at === 'below' || at === 'inside') lp = [lp[0] - (gap + cw) / 2, lp[1]]
        if (at === 'left') lp = [lp[0] - gap - cw, lp[1]]
        cp = [lp[0] + lw / 2 + gap + cw / 2, lp[1]]
      }
    }
    const reach: [number, number, number, number] = [width / 2, width / 2, height / 2, height / 2]
    const grow = (c: [number, number], w: number, h: number): void => {
      reach[0] = Math.max(reach[0], w / 2 - c[0]); reach[1] = Math.max(reach[1], c[0] + w / 2)
      reach[2] = Math.max(reach[2], h / 2 - c[1]); reach[3] = Math.max(reach[3], c[1] + h / 2)
    }
    if (at !== 'none' && at !== 'inside') grow(lp, lw, lh)
    if (countAt === 'inline') grow(cp, cw, textHeight(countSize))
    return { shape, width, height, radius, labelAt: at, label: lp, count: cp, countAt, countSize, reach, slots: slotCount, pitch }
  }, { shape: 'box', width: D.boxWidth, height: D.boxHeight, radius: D.boxRadius, labelAt: 'none', label: [0, 0], count: [0, 0], countAt: 'none', countSize: D.countSize, reach: [0.5, 0.5, 0.4, 0.4], slots: 1, pitch: D.slotPitch } as NodeGeom)
}
/** Local centre of slot k of a queue-shaped node; slot 0 is the head (the right end, where jobs leave). */
export const slotLocal = (g: NodeGeom, k: number): [number, number] => [((g.slots - 1) / 2 - k) * g.pitch, 0]
/**
 * Where a token rests inside a node, in local coordinates: slot k of a queue, the middle of a ring or a circle, the
 * middle of any other shape whose label and count are outside it. null = the node has no room to show a token (its
 * label or its count is in the middle): a job in there is out of sight.
 */
export function seatLocal(g: NodeGeom, k = 0): [number, number] | null {
  if (g.shape === 'queue') return slotLocal(g, Math.min(k, g.slots - 1))
  if (g.labelAt === 'inside' || g.countAt === 'center') return null
  return [0, g.shape === 'cylinder' ? -D.cylinderCap / 2 : 0]
}
const K = 0.5522847498
/** the silhouette of a cylinder: half an ellipse on top, the sides, half an ellipse below */
function cylinderOutline(w: number, h: number): Subpath[] {
  const rx = w / 2, ry = D.cylinderCap, top = h / 2 - ry, bottom = -h / 2 + ry
  const c: number[] = [-rx, top]
  c.push(-rx, top + ry * K, -rx * K, top + ry, 0, top + ry, rx * K, top + ry, rx, top + ry * K, rx, top)
  c.push(rx, top + (bottom - top) / 3, rx, top + ((bottom - top) * 2) / 3, rx, bottom)
  c.push(rx, bottom - ry * K, rx * K, bottom - ry, 0, bottom - ry, -rx * K, bottom - ry, -rx, bottom - ry * K, -rx, bottom)
  c.push(-rx, bottom + (top - bottom) / 3, -rx, bottom + ((top - bottom) * 2) / 3, -rx, top)
  return [{ coords: c, closed: true }]
}
/** The outline of a node's shape in local coordinates: edges stop on it, tokens leave from it, create() draws it. */
export function shapeOutline(g: NodeGeom): Subpath[] {
  if (g.shape === 'circle' || g.shape === 'ring') return circlePath({ radius: g.width / 2 })
  if (g.shape === 'cylinder') return cylinderOutline(g.width, g.height)
  return rectPath({ width: g.width, height: g.height, radius: g.radius })
}

// ── node ─────────────────────────────────────────────────────────────────────────────────────────────
const NODE: Schema = {
  label: { type: 'text', default: '', example: "node('cache')" },
  shape: { type: SHAPES, default: 'box', dynamic: false },
  color: { type: 'color', default: D.nodeColor },
  width: { type: 'positive', nullable: true, default: null },
  height: { type: 'positive', nullable: true, default: null },
  strokeWidth: { type: 'nonneg', default: D.nodeStroke },
  fill: { type: 'color', nullable: true, default: null, example: 'fill: BLUE' },
  fillOpacity: { type: 'unit', default: 0.15 },
  labelAt: { type: ['auto', 'inside', 'above', 'below', 'left', 'right'], default: 'auto', dynamic: false },
  labelSize: { type: 'positive', default: D.labelSize, tokens: TEXT_SIZES, dynamic: false },
  labelColor: { type: 'color', default: D.labelColor },
  accent: { type: 'color', default: D.accent },
  slots: { type: 'int', default: 6, dynamic: false, example: 'slots: 8' },
  filled: { type: 'number', default: 0, example: 'filled: () => waiting()' },
  progress: { type: 'number', default: 0, example: 'progress: () => done() / total' },
  state: { type: 'string', nullable: true, default: null, example: "state: 'busy'" },
  states: { type: { record: 'color' }, default: D.states, dynamic: false, example: "states: { idle: GREY, busy: BLUE, failed: RED }" },
  count: { type: 'number', nullable: true, default: null, example: 'count: () => served()' },
  countColor: { type: 'color', default: D.countColor },
  down: { type: 'boolean', default: false },
  flash: { type: 'number', nullable: true, default: null },
}
const of = <T,>(node: MNode, name: string) => (): T => node.model.now().prop<T>(node, name)
/** the count of a node as text; made the first time the node is given a count */
function ensureCount(node: MNode): void {
  if (node.children.some((c) => c.id === `${node.id}.count`)) return
  const model = node.model
  const shown = (): string => { const c = model.now().prop<number | null>(node, 'count'); return c === null || c === undefined || !Number.isFinite(c) ? '' : String(Math.round(c)) }
  model.child(node, 'count', text, shown, { size: () => nodeGeom(node, model.now()).countSize, color: of<string>(node, 'countColor') }).at(() => nodeGeom(node, model.now()).count)
}
/** A node of a system diagram: an outline with a label, and optionally a count, a state, slots or a ring. */
export const node = defineKind({
  name: 'node', space: '2d', chunk: 'diagram', positional: ['label'], schema: NODE,
  bounds: (n, _r, frame) => { const g = nodeGeom(n, frame); return boxOf(g.width / 2, g.height / 2, 0) },
  outline: (n, _r, frame) => shapeOutline(nodeGeom(n, frame)),
  anchors: (n, _r, frame) => { const g = nodeGeom(n, frame); const s = seatLocal(g, 0), t = seatLocal(g, g.slots - 1); return { head: [s?.[0] ?? 0, s?.[1] ?? 0, 0], tail: [t?.[0] ?? 0, t?.[1] ?? 0, 0] } },
  init(n, model) {
    const label = n.props.label
    if (typeof label === 'function' || (typeof label === 'string' && label)) {
      model.child(n, 'label', text, typeof label === 'function' ? of<string>(n, 'label') : label, { size: n.props.labelSize as number, color: of<string>(n, 'labelColor'), opacity: () => (model.now().prop(n, 'down') ? D.downLabel : 1) })
        .at(() => nodeGeom(n, model.now()).label)
    }
    if (counted(n)) ensureCount(n)
  },
})
const dyn = (n: MNode, call: string, v: unknown, ok: (x: unknown) => boolean, example: string): boolean => {
  if (typeof v === 'function' || ok(v)) return true
  report(n.model, typeof v === 'number' ? 'NUM-INVALID' : 'API-TYPE', `${n.kind}.${call}() got ${typeof v === 'string' ? `"${v}"` : String(v)}.`, [example], [n.id])
  return false
}
const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
/** n.state('busy'): the state badge and the outline take the colour of that state; n.to.state('failed') switches halfway through the play and flashes. */
defineKindSetter('node', 'state', (n: MNode, v: unknown): Patch | null => (dyn(n, 'state', v, (x) => x === null || typeof x === 'string', ".state('busy')") ? { state: v } : null))
/** n.count(12) / n.count(() => served()): a whole number shown on the node. */
defineKindSetter('node', 'count', (n: MNode, v: unknown): Patch | null => { if (!dyn(n, 'count', v, (x) => x === null || finite(x), '.count(() => served())')) return null; ensureCount(n); return { count: v } })
/** n.down() / n.down(false): out of service. traffic() sends nothing to a node that is down, and what it was serving fails. */
defineKindSetter('node', 'down', (n: MNode, v: unknown = true): Patch | null => (dyn(n, 'down', v, (x) => typeof x === 'boolean', '.down(true)') ? { down: v } : null))
/** n.progress(0.4): how far the ring of a ring-shaped node is filled (0..1). */
defineKindSetter('node', 'progress', (n: MNode, v: unknown): Patch | null => (dyn(n, 'progress', v, finite, '.progress(0.5)') ? { progress: v } : null))
/** n.filled(3): how many slots of a queue-shaped node hold a job, counted from the head. */
defineKindSetter('node', 'filled', (n: MNode, v: unknown): Patch | null => (dyn(n, 'filled', v, finite, '.filled(3)') ? { filled: v } : null))

/** queue({ slots, filled, label }): a node in the shape of a queue: a row of slots, filled from the head (the right end). */
export function queue(opts?: unknown): Handle {
  const o = typeof opts === 'object' && opts !== null && !Array.isArray(opts) && !isNode(opts) ? (opts as Record<string, unknown>) : null
  if (!o) return opts === undefined ? node('', { shape: 'queue' }) : node('', opts)
  const { label, ...rest } = o
  return node(label ?? '', { ...rest, shape: 'queue' })
}

/**
 * Progress of the flash of a node's latest failure (0..1), or null: its `flash` option when that is given, otherwise
 * derived from the story: the moment its `state` became 'failed' or it went `down`. A pure function of the frame.
 */
export function flashOf(n: MNode, frame: Frame): number | null {
  const own = frame.prop<number | null>(n, 'flash')
  if (own !== null && own !== undefined) return own > 0 && own < 1 ? own : null
  let latest = -Infinity
  for (const [channel, bad] of [['state', (v: unknown) => v === 'failed'], ['down', (v: unknown) => v === true]] as const) {
    for (const c of n.model.clipsFor(n, channel) ?? []) { const at = (c.t0 + c.t1) / 2; if (at <= frame.tau && at > latest && bad(c.to)) latest = at }
  }
  const u = (frame.tau - latest) / D.flashSeconds
  return u > 0 && u < 1 ? u : null
}

// ── timer ────────────────────────────────────────────────────────────────────────────────────────────
/** timer(progress, { radius }): a small ring that fills clockwise from twelve o'clock as progress goes 0 → 1. */
export const timer = defineKind({
  name: 'timer', space: '2d', chunk: 'diagram', positional: ['progress'],
  schema: {
    progress: { type: 'number', default: 0, example: 'timer(() => elapsed() / total)' },
    radius: { type: 'positive', default: 0.22 },
    color: { type: 'color', default: D.accent },
    strokeWidth: { type: 'nonneg', default: D.ringStroke },
    /** opacity of the full circle drawn under the arc (0 = none) */
    track: { type: 'unit', default: 0.22 },
  },
  bounds: (_n, r) => boxOf(r.radius, r.radius, 0),
  outline: (_n, r) => circlePath({ radius: r.radius }),
})

// ── edge ─────────────────────────────────────────────────────────────────────────────────────────────
const line3 = (a: readonly number[], b: readonly number[]): number[] => [a[0]!, a[1]!, a[0]! + (b[0]! - a[0]!) / 3, a[1]! + (b[1]! - a[1]!) / 3, a[0]! + ((b[0]! - a[0]!) * 2) / 3, a[1]! + ((b[1]! - a[1]!) * 2) / 3, b[0]!, b[1]!]
/** The line of an edge in frame coordinates (before the edge's own shift), as flat cubic coordinates: the graph's route when it has one, else from outline to outline. */
export function edgeCurve(e: MNode, frame: Frame): number[] {
  return frame.memo('de' + e.uid, () => {
    const r = frame.props(e)
    const own = storeOf(e.model).curves.get(e.uid)
    if (own) return own(frame)
    const via = storeOf(e.model).routed.get(e.uid)
    const free = !e.model.clipsFor(e, 'a') && !e.model.clipsFor(e, 'b') && !r.bend
    if (via && free) {
      const route = graphGeom(via.graph, frame).routes[via.index]
      if (route && route.length >= 8) {
        const w = frame.world(via.graph)
        const out = new Array<number>(route.length)
        for (let i = 0; i + 1 < route.length; i += 2) { const p = apply(w, [route[i]!, route[i + 1]!, 0]); out[i] = p[0]; out[i + 1] = p[1] }
        return out
      }
    }
    const [a, b] = ends(e, r, frame)
    const c = bendControl(a, b, r.bend ?? 0)
    if (!c) return line3(a, b)
    return [a[0], a[1], a[0] + ((c[0] - a[0]) * 2) / 3, a[1] + ((c[1] - a[1]) * 2) / 3, b[0] + ((c[0] - b[0]) * 2) / 3, b[1] + ((c[1] - b[1]) * 2) / 3, b[0], b[1]]
  }, [0, 0, 0, 0, 0, 0, 0, 0])
}
const edgeBounds = (e: MNode, _r: Resolved, frame: Frame): Box3 => {
  const c = edgeCurve(e, frame), box = emptyBox()
  // the control polygon contains the curve
  for (let i = 0; i + 1 < c.length; i += 2) expand(box, [c[i]!, c[i + 1]!, 0])
  return box
}
/** where the label of an edge sits: beside the middle of the line, on the upper (or right) side, clear of the line */
function edgeLabelAt(e: MNode, label: MNode, frame: Frame): Vec3 {
  const { point, tangentDeg } = pointOnOutline(e, frame, 0.5)
  const a = (tangentDeg * Math.PI) / 180
  let nx = -Math.sin(a), ny = Math.cos(a)
  if (ny < -0.3 || (Math.abs(ny) <= 0.3 && nx < 0)) { nx = -nx; ny = -ny }
  const b = frame.localBounds(label)
  const off = D.edgeLabelGap + Math.abs(nx) * (b.max[0] - b.min[0]) / 2 + Math.abs(ny) * (b.max[1] - b.min[1]) / 2
  const sh = frame.world(e).p
  return [point[0] - sh[0] + nx * off, point[1] - sh[1] + ny * off, 0]
}
/** An arrow of a diagram: a thin line from the outline of one node to the outline of another, with a small tip. */
export const edge = defineKind({
  name: 'edge', space: '2d', chunk: 'diagram', positional: ['a', 'b'], required: ['a', 'b'], worldGeometry: true,
  schema: {
    a: { type: 'point', example: 'edge(client, server)' }, b: { type: 'point', example: 'edge(client, server)' },
    label: { type: 'text', default: '', example: "label: 'retry'" },
    dashed: { type: 'boolean', default: false },
    bend: { type: 'number', default: 0, example: 'bend: 30' },
    both: { type: 'boolean', default: false },
    arrow: { type: 'boolean', default: true },
    color: { type: 'color', default: D.edgeColor },
    strokeWidth: { type: 'nonneg', default: D.edgeStroke },
    buff: { type: 'nonneg', default: D.edgeBuff },
    drawn: { type: 'number', default: 1, example: 'drawn: () => progress()' },
    labelSize: { type: 'positive', default: D.edgeLabelSize, tokens: TEXT_SIZES, dynamic: false },
    labelColor: { type: 'color', default: D.labelColor },
  },
  bounds: edgeBounds,
  outline: (e, _r, frame) => [{ coords: edgeCurve(e, frame), closed: false }],
  anchors: (e, _r, frame) => { const c = edgeCurve(e, frame), n = c.length; return { start: [c[0]!, c[1]!, 0], end: [c[n - 2]!, c[n - 1]!, 0] } },
  init(e, model) {
    const label = e.props.label
    if (!(typeof label === 'function' || (typeof label === 'string' && label))) return
    const t: Handle = model.child(e, 'label', text, typeof label === 'function' ? of<string>(e, 'label') : label, { size: e.props.labelSize as number, color: of<string>(e, 'labelColor'), opacity: () => smooth(clamp01(model.now().prop<number>(e, 'drawn') * 2 - 0.6)) })
    t.at(() => edgeLabelAt(e, t, model.now()))
  },
})
/** The two nodes an edge joins (null for an end that is a point). */
export const edgeEnds = (e: MNode): [MNode | null, MNode | null] => [isNode(e.props.a) ? e.props.a : null, isNode(e.props.b) ? e.props.b : null]

// ── group box ────────────────────────────────────────────────────────────────────────────────────────
/** The box of a group in frame coordinates: round its nodes and their labels, with room on top for its own label. */
export function clusterBox(c: MNode, frame: Frame): Box3 {
  return frame.memo('dc' + c.uid, () => {
    const box = emptyBox()
    for (const m of storeOf(c.model).clusters.get(c.uid) ?? []) {
      if (m.kind !== 'node') { union(box, frame.bounds(m)); continue }
      const w = frame.world(m), g = nodeGeom(m, frame)
      expand(box, apply(w, [-g.reach[0], -g.reach[2], 0]))
      expand(box, apply(w, [g.reach[1], g.reach[3], 0]))
    }
    if (!(box.min[0] <= box.max[0])) return boxOf(0, 0, 0)
    const pad = frame.prop<number>(c, 'padding')
    const head = String(frame.prop(c, 'label') ?? '') ? textHeight(frame.prop<number>(c, 'labelSize')) + D.labelGap : 0
    return { min: [box.min[0] - pad, box.min[1] - pad, 0], max: [box.max[0] + pad, box.max[1] + pad + head, 0] }
  }, boxOf(0, 0, 0))
}
/** A box drawn round some nodes of a graph, with a label in its upper left corner. Made by graph({ groups }). */
const cluster = defineKind({
  name: 'cluster', space: '2d', chunk: 'diagram', worldGeometry: true,
  schema: {
    label: { type: 'text', default: '' },
    color: { type: 'color', default: D.groupColor },
    strokeWidth: { type: 'nonneg', default: D.groupStroke },
    dashed: { type: 'boolean', default: false },
    padding: { type: 'nonneg', default: D.groupPadding },
    radius: { type: 'nonneg', default: D.groupRadius },
    labelSize: { type: 'positive', default: D.groupLabelSize, tokens: TEXT_SIZES, dynamic: false },
    labelColor: { type: 'color', default: D.groupLabelColor },
  },
  bounds: (c, _r, frame) => clusterBox(c, frame),
  outline: (c, r, frame) => { const b = clusterBox(c, frame); return rectPath({ width: b.max[0] - b.min[0], height: b.max[1] - b.min[1], radius: r.radius, center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] }) },
  init(c, model) {
    const label = c.props.label
    if (!(typeof label === 'function' || (typeof label === 'string' && label))) return
    const t: Handle = model.child(c, 'label', text, typeof label === 'function' ? of<string>(c, 'label') : label, { size: c.props.labelSize as number, color: of<string>(c, 'labelColor') })
    t.at(() => { const f = model.now(), b = clusterBox(c, f), tb = f.localBounds(t), pad = f.prop<number>(c, 'padding'); return [b.min[0] + pad + (tb.max[0] - tb.min[0]) / 2, b.max[1] - pad * 0.75 - (tb.max[1] - tb.min[1]) / 2, 0] })
  },
})

// ── graph ────────────────────────────────────────────────────────────────────────────────────────────
/** the layout a graph falls back on while the layout engine (the lazy chunk) is not there: one row or column, in declaration order */
function rowLayout(graph: MNode, frame: Frame): GraphGeom {
  const rec = storeOf(graph.model).graphs.get(graph.uid)
  const pos = new Map<number, [number, number]>()
  if (!rec) return { pos, routes: [], scale: 1, width: 0, height: 0, crossings: 0 }
  const down = rec.direction === 'down'
  const gap = frame.prop<number>(graph, 'rankGap')
  const sizes = rec.members.map((m) => { const b = frame.localBounds(m); return [b.max[0] - b.min[0], b.max[1] - b.min[1]] as const })
  const total = sizes.reduce((s, z) => s + z[down ? 1 : 0], 0) + gap * Math.max(0, sizes.length - 1)
  let cursor = -total / 2
  rec.members.forEach((m, i) => { const len = sizes[i]![down ? 1 : 0]; pos.set(m.uid, down ? [0, -(cursor + len / 2)] : [cursor + len / 2, 0]); cursor += len + gap })
  return { pos, routes: rec.edges.map(() => null), scale: 1, width: down ? Math.max(0, ...sizes.map((z) => z[0])) : total, height: down ? total : Math.max(0, ...sizes.map((z) => z[1])), crossings: 0 }
}
/** A graph's layout in this frame: from the layout engine when it is loaded, a plain row otherwise. */
export function graphGeom(graph: MNode, frame: Frame): GraphGeom {
  return frame.memo('dl' + graph.uid, () => (slots.layout ? slots.layout(graph, frame) : rowLayout(graph, frame)), { pos: new Map(), routes: [], scale: 1, width: 0, height: 0, crossings: 0 })
}
// a node of a graph sits where the layout puts it, in the graph's own coordinates
definePlacement('graph', (n, pl, frame) => { const p = graphGeom(pl.graph as MNode, frame).pos.get(n.uid); return { p: p ? [p[0], p[1], 0] : [0, 0, 0] } })
const GRAPH: Schema = {
  nodes: { type: 'any', dynamic: false, example: "nodes: { api: 'API', db: { label: 'database', shape: 'cylinder' } }" },
  edges: { type: 'any', dynamic: false, example: "edges: [['api', 'db']]" },
  direction: { type: ['right', 'down'], default: 'right', dynamic: false },
  nodeGap: { type: 'nonneg', default: D.nodeGap, dynamic: false },
  rankGap: { type: 'nonneg', default: D.rankGap, dynamic: false },
  width: { type: 'positive', default: D.graphWidth, dynamic: false },
  height: { type: 'positive', default: D.graphHeight, dynamic: false },
  groups: { type: 'any', dynamic: false, example: "groups: { backend: ['api', 'db'] }" },
}
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !isNode(v)
/** nodes then the edges that leave them, rank by rank along the flow: the order a graph is drawn in */
function flowOrder(members: MNode[], edges: MNode[]): MNode[] {
  const depth = new Map<MNode, number>(members.map((m) => [m, 0]))
  // longest path from the sources; an edge that would close a cycle is ignored (at most |nodes| rounds)
  for (let round = 0, moved = true; moved && round < members.length; round++) {
    moved = false
    for (const e of edges) {
      const [a, b] = edgeEnds(e)
      if (!a || !b || a === b || !depth.has(a) || !depth.has(b)) continue
      if (depth.get(b)! < depth.get(a)! + 1 && depth.get(a)! + 1 < members.length) { depth.set(b, depth.get(a)! + 1); moved = true }
    }
  }
  const out: MNode[] = []
  const last = Math.max(0, ...depth.values())
  for (let d = 0; d <= last; d++) {
    const rank = members.filter((m) => depth.get(m) === d)
    out.push(...rank)
    out.push(...edges.filter((e) => { const a = edgeEnds(e)[0]; return !!a && rank.includes(a) }))
  }
  for (const e of edges) if (!out.includes(e)) out.push(e)
  return out
}
/** A node-and-arrow diagram that lays itself out in layers along the flow. */
const graphKind = defineKind({
  name: 'graph', space: '2d', container: true, chunk: 'diagram', schema: GRAPH,
  init(g, model) {
    const store = storeOf(model)
    const direction = g.props.direction === 'down' ? 'down' : 'right'
    const rec = { members: [] as MNode[], edges: [] as MNode[], groups: [] as MNode[], direction: direction as 'right' | 'down' }
    store.graphs.set(g.uid, rec)
    const byKey: Record<string, Handle> = Object.create(null)
    const specs = g.props.nodes
    if (!plain(specs)) { if (!g.invalid) report(model, 'API-TYPE', 'graph() needs nodes: an object of name → label or options.', ["graph({ nodes: { api: 'API', db: { label: 'database', shape: 'cylinder' } }, edges: [['api', 'db']] })"], [g.id]) }
    else for (const [key, spec] of Object.entries(specs)) {
      let n: Handle
      if (isNode(spec)) n = spec as Handle
      else if (plain(spec)) { const { label, id, ...rest } = spec; n = node(label ?? key, { ...rest, id: id ?? key }) }
      else if (typeof spec === 'string' || typeof spec === 'function') n = node(spec, { id: key })
      else { report(model, 'API-TYPE', `graph(): node "${key}" must be a label, an options object or an object made earlier, got ${spec === null ? 'null' : typeof spec}.`, [`${key}: '${key}'`, `${key}: { label: '${key}', shape: 'circle' }`], [g.id]); continue }
      if (n.space !== '2d') { report(model, 'API-TYPE', `graph(): node "${key}" is a 3D part; a graph is flat.`, ['pass a 2D object, a label or node options'], [g.id]); continue }
      if (n.placement) report(model, 'PLACE-CONFLICT', `#${n.id} already has a placement (${n.placement.type}) and is also a node of graph(); the graph decides where it goes.`, [`remove the placement of #${n.id}`], [n.id])
      model.adopt(g, n)
      n.placement = { type: 'graph', graph: g }
      store.owner.set(n.uid, g)
      rec.members.push(n)
      byKey[key] = n
    }
    const list = g.props.edges
    if (list !== undefined && !Array.isArray(list)) report(model, 'API-TYPE', 'graph(): edges must be a list of [from, to] pairs.', ["edges: [['api', 'db'], ['api', 'cache', { dashed: true }]]"], [g.id])
    for (const item of Array.isArray(list) ? list : []) {
      const tuple = Array.isArray(item) ? item : plain(item) ? [item.from, item.to, item] : null
      const [from, to] = tuple ?? []
      const opts = tuple && plain(tuple[2]) ? Object.fromEntries(Object.entries(tuple[2]).filter(([k]) => k !== 'from' && k !== 'to')) : {}
      const missing = [from, to].find((k) => typeof k !== 'string' || !byKey[k])
      if (!tuple || missing !== undefined || typeof from !== 'string' || typeof to !== 'string') {
        const names = Object.keys(byKey)
        const near = typeof missing === 'string' ? closest(missing, names) : null
        report(model, typeof missing === 'string' ? 'REF-MISSING' : 'API-TYPE', typeof missing === 'string' ? `graph(): an edge names "${missing}", and no node of this graph is called that.` : 'graph(): an edge must be [from, to] or [from, to, options], naming two nodes of the graph.', [near ? `use "${near}"` : `nodes: ${names.join(', ')}`], [g.id])
        continue
      }
      const e = edge(byKey[from], byKey[to], { id: `${from}-${to}`, ...opts })
      model.adopt(g, e)
      store.routed.set(e.uid, { graph: g, index: rec.edges.length })
      rec.edges.push(e)
    }
    const groups: Record<string, Handle> = Object.create(null)
    const given = g.props.groups
    if (given !== undefined && !plain(given)) report(model, 'API-TYPE', 'graph(): groups must be an object of name → the names of its nodes.', ["groups: { backend: ['api', 'db'] }"], [g.id])
    for (const [name, spec] of plain(given) ? Object.entries(given) : []) {
      const { nodes: listed, label, ...rest } = plain(spec) ? spec : { nodes: spec }
      const names = Array.isArray(listed) ? listed : []
      const members = names.map((k) => (typeof k === 'string' ? byKey[k] : undefined))
      const bad = names.find((_k, i) => !members[i])
      if (!names.length || bad !== undefined) {
        const near = typeof bad === 'string' ? closest(bad, Object.keys(byKey)) : null
        report(model, typeof bad === 'string' ? 'REF-MISSING' : 'API-TYPE', typeof bad === 'string' ? `graph(): group "${name}" names "${bad}", and no node of this graph is called that.` : `graph(): group "${name}" must list the names of its nodes.`, [near ? `use "${near}"` : `${name}: ['${Object.keys(byKey)[0] ?? 'api'}']`], [g.id])
        if (!members.some(Boolean)) continue
      }
      const box = cluster({ id: name, label: label ?? name, ...rest })
      box.props.z = -1
      store.clusters.set(box.uid, members.filter((m): m is Handle => !!m))
      model.adopt(g, box)
      rec.groups.push(box)
      groups[name] = box
    }
    delete g.props.nodes
    delete g.props.edges
    delete g.props.groups
    const self = g as Handle
    self.nodes = byKey
    self.edges = rec.edges
    self.groups = groups
    // a drawing wider or taller than its box is shrunk as a whole (the layout engine says by how much)
    if (g.props.scale === undefined) g.props.scale = () => graphGeom(g, model.now()).scale
  },
})
/** graph({ nodes, edges, direction }): nodes and arrows laid out automatically. g.nodes.name, g.edge(from, to), g.draw(). */
export function graph(opts?: unknown): Handle { return graphKind(opts === undefined ? {} : opts) }
const missingPart = (g: MNode, what: string, name: unknown, names: string[]): Handle => {
  const near = typeof name === 'string' ? closest(name, names) : null
  report(g.model, 'REF-MISSING', `${g.kind}.${what}: ${typeof name === 'string' ? `"${name}"` : String(name)} is not part of this ${g.kind}.`, [near ? `use "${near}"` : `it has: ${names.join(', ')}`], [g.id])
  return (constructorOf('placeholder') ?? node)()
}
/** g.edge('api', 'db'): the arrow between two nodes of the graph. */
defineKindMethod('graph', 'edge', (g: Handle, from: unknown, to: unknown) => {
  const rec = storeOf(g.model).graphs.get(g.uid)
  const hit = rec?.edges.find((e) => { const [a, b] = edgeEnds(e); return a?.id === (isNode(from) ? from.id : from) && b?.id === (isNode(to) ? to.id : to) })
  return hit ?? missingPart(g, 'edge()', `${String(isNode(from) ? from.id : from)}-${String(isNode(to) ? to.id : to)}`, (rec?.edges ?? []).map((e) => e.id))
})
/** g.node('api'): one node of the graph (the same object as g.nodes.api). */
defineKindMethod('graph', 'node', (g: Handle, name: unknown) => (typeof name === 'string' && g.nodes[name]) || missingPart(g, 'node()', name, Object.keys(g.nodes ?? {})))
/** g.draw({ lag }): the animation that draws the graph on, node by node and edge by edge along the flow. */
defineKindMethod('graph', 'draw', (g: Handle, opts?: unknown): Anim => {
  const rec = storeOf(g.model).graphs.get(g.uid)
  const lag = plain(opts) && typeof opts.lag === 'number' && opts.lag >= 0 ? opts.lag : D.drawLag
  if (!rec) return NOOP_ANIM('draw', PACE.enter)
  return lagged([...flowOrder(rec.members, rec.edges), ...rec.groups].map((m) => create(m)), { lag })
})

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────────
/** the point a share of the way along an edge (or around any 2D outline), in frame coordinates */
export const pointOn = (on: unknown, frame: Frame, alpha: number): Vec3 => (isNode(on) ? pointOnOutline(on, frame, clamp01(alpha)).point : [0, 0, 0])
const around = (p: Vec3, radius: number): Box3 => ({ min: [p[0] - radius, p[1] - radius, 0], max: [p[0] + radius, p[1] + radius, 0] })
const needsOn = (n: MNode, call: string): void => {
  if (isNode(n.props.on) && n.props.on.space === '2d') return
  n.invalid = true
  if (!isNode(n.props.on)) report(n.model, 'API-TYPE', `${call} needs the edge it travels on.`, [call === 'token()' ? 'token({ on: edge, at: () => progress() })' : 'tokens(edge, { count: 3 })'], [n.id])
  else report(n.model, 'API-TYPE', `${call}: #${n.props.on.id} is a 3D part; tokens travel on 2D edges.`, ['pass an edge() or another 2D object'], [n.id])
}
const TOKEN_STYLE: Schema = { color: { type: 'color', default: D.accent }, radius: { type: 'positive', default: D.tokenRadius } }
/** token({ on: edge, at }): one dot on an edge, at a share of its length (0 = start, 1 = end). */
export const token = defineKind({
  name: 'token', space: '2d', chunk: 'diagram', worldGeometry: true,
  schema: {
    on: { type: 'node', dynamic: false, example: 'on: edge' },
    at: { type: 'number', default: 0, example: 'at: () => progress()' },
    ...TOKEN_STYLE,
    label: { type: 'text', default: '', example: "label: 'GET /'" },
    labelSize: { type: 'positive', default: 18, tokens: TEXT_SIZES, dynamic: false },
    labelColor: { type: 'color', default: D.labelColor },
  },
  bounds: (n, r, frame) => around(pointOn(r.on, frame, r.at), r.radius),
  textRects: (n, r, frame) => {
    const s = String(r.label ?? '')
    if (!s) return []
    const p = pointOn(r.on, frame, r.at), w = textWidth(s, r.labelSize), h = textHeight(r.labelSize)
    return [{ text: s, rect: { x: p[0] - w / 2, y: p[1] + r.radius + D.tokenLabelGap, width: w, height: h } }]
  },
  init: (n) => needsOn(n, 'token()'),
})
/** One dot of a stream: where it is along the edge (0..1) and how visible (it fades in at the start and out at the end). */
export function streamAt(r: Resolved, length: number): { u: number; alpha: number }[] {
  const count = Math.max(0, Math.min(400, Math.round(r.count ?? 0)))
  const active = typeof r.active === 'number' ? clamp01(r.active) : r.active === false ? 0 : 1
  const L = Math.max(length, 1e-6)
  const fade = Math.min(0.5, D.streamFade / L)
  const out: { u: number; alpha: number }[] = []
  for (let i = 0; i < count; i++) {
    const x = i / count + (Number(r.phase) || 0) + ((Number(r.speed) || 0) * (Number(r.time) || 0)) / L
    const u = x - Math.floor(x)
    out.push({ u, alpha: active * smooth(clamp01(Math.min(u, 1 - u) / fade)) })
  }
  return out
}
/** tokens(edge, { count, speed }): a steady stream of dots along an edge. */
export const tokens = defineKind({
  name: 'tokens', space: '2d', chunk: 'diagram', worldGeometry: true, positional: ['on'], required: ['on'],
  schema: {
    on: { type: 'node', dynamic: false, example: 'tokens(edge, { count: 3 })' },
    count: { type: 'int', default: 3 },
    speed: { type: 'number', default: D.streamSpeed, example: 'speed: 1.5' },
    phase: { type: 'number', default: 0 },
    active: { type: 'any', default: true, example: 'active: () => running()' },
    ...TOKEN_STYLE,
    /** the clock the stream runs on, in seconds (default: s.t()) */
    time: { type: 'number', example: 'time: () => s.t()' },
  },
  bounds: (n, r, frame) => { const b = isNode(r.on) ? frame.bounds(r.on) : boxOf(0, 0, 0); return { min: [b.min[0] - r.radius, b.min[1] - r.radius, 0], max: [b.max[0] + r.radius, b.max[1] + r.radius, 0] } },
  init(n, model) { needsOn(n, 'tokens()'); if (n.props.time === undefined) n.props.time = () => model.now().t },
})

// ── traffic ──────────────────────────────────────────────────────────────────────────────────────────
const SOURCE: Schema = {
  count: { type: 'int', example: 'count: 40' },
  every: { type: 'any', example: 'every: 0.6  (or [0.4, 0.9])' },
  start: { type: 'nonneg', default: 0 },
  failing: { type: { array: 'int' }, example: 'failing: [39]' },
}
const STATION: Schema = {
  service: { type: 'any', example: 'service: 1.2  (or [0.9, 1.5])' },
  workers: { type: 'int', example: 'workers: 2' },
  slots: { type: 'int', example: 'slots: 8' },
  route: { type: 'any', example: "route: 'roundRobin'" },
  failRate: { type: 'number', example: 'failRate: 0.1' },
  absorb: { type: 'number', example: 'absorb: 0.6' },
  release: { type: 'nonneg', example: 'release: 0.3' },
}
const RETRY: Schema = { limit: { type: 'int', example: 'limit: 3' }, backoff: { type: 'nonneg', example: 'backoff: 1' }, factor: { type: 'positive', example: 'factor: 2' } }
export const ROUTES = ['idle', 'roundRobin', 'random', 'first'] as const
const EMPTY_STATION: StationView = Object.freeze({ sent: 0, done: 0, failed: 0, waiting: 0, busy: 0, progress: 0, down: false, flash: null })
const EMPTY_VIEW: TrafficView = Object.freeze({ t: 0, counts: Object.freeze({ sent: 0, done: 0, dead: 0, queued: 0, inFlight: 0 }), station: () => EMPTY_STATION, tokens: () => [], live: 0, issues: [] })
/** The simulation of a traffic object at the time of a frame (all zeros while the simulation engine, the lazy chunk, is not there). */
export function trafficView(n: MNode, frame: Frame): TrafficView {
  return frame.memo('dt' + n.uid, () => (slots.traffic ? slots.traffic(n, frame) : EMPTY_VIEW), EMPTY_VIEW)
}
/** Story time at which an object first appears (0 when it is there from the start). */
export function enterTime(n: MNode): number {
  const first = [...(n.model.clipsFor(n, 'present') ?? [])].sort((a, b) => a.t0 - b.t0 || a.seq - b.seq)[0]
  return first && first.to === 1 ? first.t0 : 0
}
const range = (model: SceneModel, id: string, what: string, v: unknown): void => {
  if (v === undefined || typeof v === 'function' || (typeof v === 'number' && v >= 0 && Number.isFinite(v))) return
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && x >= 0 && Number.isFinite(x)) && v[0] <= v[1]) return
  report(model, 'API-TYPE', `traffic(): ${what} must be seconds, or [shortest, longest], got ${JSON.stringify(v) ?? String(v)}.`, [`${what.split(' ').pop()}: 1.2`, `${what.split(' ').pop()}: [0.9, 1.5]`], [id])
}
/**
 * traffic(graph, { sources, stations, retry }): a seeded simulation of jobs through a graph, drawn as tokens. Jobs
 * appear at the sources, queue in slots, are served by stations, fail and retry, and finish where no edge leads on.
 */
export const traffic = defineKind({
  name: 'traffic', space: '2d', chunk: 'diagram', worldGeometry: true, positional: ['over'], required: ['over'],
  schema: {
    over: { type: 'any', dynamic: false, example: 'traffic(graph, { sources: { client: { every: 0.6 } } })' },
    seed: { type: 'any', default: 1, dynamic: false, example: 'seed: 7' },
    sources: { type: { record: { type: { object: SOURCE } } }, default: {}, example: 'sources: { client: { every: 0.6, count: 40 } }' },
    stations: { type: { record: { type: { object: STATION } } }, default: {}, example: 'stations: { worker: { service: [0.9, 1.5], failRate: 0.1 } }' },
    retry: { type: { object: RETRY }, default: {}, example: 'retry: { limit: 3, backoff: 1 }' },
    travel: { type: 'positive', default: D.travel },
    hop: { type: 'nonneg', default: D.hop },
    start: { type: 'number', default: 0, dynamic: false },
    color: { type: 'color', default: D.accent },
    failedColor: { type: 'color', default: D.failedColor },
    waitColor: { type: 'color', default: D.waitColor },
    radius: { type: 'positive', default: D.tokenRadius },
    bind: { type: 'boolean', default: true, dynamic: false },
    /** the simulation's clock in seconds (default: s.t() counted from the moment the traffic appears, plus `start`) */
    time: { type: 'number', example: 'time: () => s.t()' },
  },
  bounds(n, r, frame) {
    const topo = storeOf(n.model).topology.get(n.uid)
    const box = emptyBox()
    for (const m of topo?.nodes ?? []) union(box, frame.bounds(m))
    for (const e of topo?.edges ?? []) union(box, frame.bounds(e.edge))
    if (!(box.min[0] <= box.max[0])) return boxOf(0, 0, 0)
    const pad = (r.radius as number) + 0.25
    return { min: [box.min[0] - pad, box.min[1] - pad, 0], max: [box.max[0] + pad, box.max[1] + pad, 0] }
  },
  init(n, model) {
    const store = storeOf(model)
    const over = n.props.over
    delete n.props.over
    let edges: MNode[] = []
    if (isNode(over) && over.kind === 'graph') edges = store.graphs.get(over.uid)?.edges ?? []
    else if (Array.isArray(over)) edges = over.filter((e): e is MNode => isNode(e) && e.kind === 'edge')
    const topo: Topology = { nodes: [], edges: [] }
    const index = (m: MNode): number => { let i = topo.nodes.indexOf(m); if (i < 0) { i = topo.nodes.length; topo.nodes.push(m) } return i }
    if (isNode(over) && over.kind === 'graph') for (const m of store.graphs.get(over.uid)?.members ?? []) index(m)
    for (const e of edges) { const [a, b] = edgeEnds(e); if (a && b && a !== b) topo.edges.push({ edge: e, from: index(a), to: index(b) }) }
    store.topology.set(n.uid, topo)
    if (!topo.edges.length) {
      n.invalid = true
      report(model, 'API-TYPE', 'traffic() needs a graph, or a list of edges that join nodes, to run over.', ["traffic(graph, { sources: { client: { every: 0.6 } } })", 'traffic([edge(a, b), edge(b, c)], { sources: { a: { every: 1 } } })'], [n.id])
    }
    const ids = topo.nodes.map((m) => m.id)
    const sources = plain(n.props.sources) ? n.props.sources : {}, stations = plain(n.props.stations) ? n.props.stations : {}
    for (const [what, rec] of [['sources', sources], ['stations', stations]] as const) for (const [id, o] of Object.entries(rec)) {
      if (!ids.includes(id)) { const near = closest(id, ids); report(model, 'REF-MISSING', `traffic(): ${what} names "${id}", and no node it runs over has that id.`, [near ? `use "${near}"` : `nodes: ${ids.join(', ')}`], [n.id]); continue }
      if (!plain(o)) continue
      if (what === 'sources') range(model, n.id, `sources.${id}.every`, o.every)
      else {
        range(model, n.id, `stations.${id}.service`, o.service)
        const route = o.route
        if (route !== undefined && typeof route !== 'function' && !plain(route) && !(ROUTES as readonly unknown[]).includes(route)) { const near = typeof route === 'string' ? closest(route, ROUTES) : null; report(model, typeof route === 'string' ? 'API-UNKNOWN' : 'API-TYPE', `traffic(): stations.${id}.route has no value ${typeof route === 'string' ? `"${route}"` : String(route)}.`, [near ? `use "${near}"` : `use one of: ${ROUTES.join(', ')}, or weights such as { a: 2, b: 1 }`], [n.id]) }
      }
    }
    if (topo.edges.length && !Object.keys(sources).some((id) => ids.includes(id))) report(model, 'API-TYPE', 'traffic() has no sources: nothing would ever move.', [`sources: { ${ids[0] ?? 'client'}: { every: 0.6 } }`], [n.id])
    // the clock starts when the traffic appears, so a simulation introduced in step 3 starts at its beginning there
    if (n.props.time === undefined) n.props.time = () => { const f = model.now(); return f.t - model.simTime(enterTime(n)) + (Number(n.props.start) || 0) }
    for (const what of ['sent', 'done', 'dead', 'queued', 'inFlight'] as const) model.probes.set(`${n.id}.${what}`, () => trafficView(n, model.now()).counts[what])
    model.probes.set(`${n.id}.balance`, () => { const c = trafficView(n, model.now()).counts; return c.sent - c.done - c.dead - c.queued - c.inFlight })
    if (n.props.bind === false) return
    // nodes the scene left unbound show what the simulation does to them
    const station = (m: MNode) => (): StationView => trafficView(n, model.now()).station(m.id)
    for (const m of topo.nodes) {
      if (m.kind !== 'node') continue
      const i = topo.nodes.indexOf(m)
      const o = plain(stations[m.id]) ? (stations[m.id] as Record<string, unknown>) : {}
      const out = topo.edges.some((e) => e.from === i), source = Object.hasOwn(sources, m.id)
      const serves = o.service !== undefined, buffer = !serves && (m.props.shape === 'queue' || typeof o.slots === 'number')
      const view = station(m)
      const free = (name: string): boolean => m.props[name] === undefined || m.props[name] === null || m.props[name] === (NODE[name] as { default?: unknown }).default
      if (serves && free('progress')) m.props.progress = () => view().progress
      if (serves && free('state')) m.props.state = () => { const v = view(); return model.now().prop(m, 'down') ? 'down' : v.flash !== null ? 'failed' : v.busy > 0 ? 'busy' : 'idle' }
      if (free('flash')) m.props.flash = () => view().flash
      if (!free('count')) continue
      const role = source ? 'sent' : !out || o.absorb !== undefined ? 'done' : buffer ? 'waiting' : null
      if (!role) continue
      m.props.count = () => view()[role]
      if (free('countColor')) m.props.countColor = role === 'done' ? D.doneColor : role === 'waiting' ? D.accent : D.countColor
      ensureCount(m)
    }
  },
})
const COUNTS = ['sent', 'done', 'dead', 'queued', 'inFlight'] as const
const STATION_COUNTS = ['sent', 'done', 'failed', 'waiting', 'busy'] as const
/** sim.count('done') / sim.count('done', 'db'): a live number of the simulation, for the whole graph or for one node. */
defineKindMethod('traffic', 'count', (n: Handle, what: unknown, where?: unknown) => {
  const model = n.model
  const id = isNode(where) ? where.id : where
  const names: readonly string[] = id === undefined ? COUNTS : STATION_COUNTS
  if (typeof what !== 'string' || !names.includes(what)) { const near = typeof what === 'string' ? closest(what, names) : null; report(model, 'API-UNKNOWN', `traffic.count(): there is no count "${String(what)}"${id === undefined ? '' : ' of one node'}.`, [near ? `use "${near}"` : `use one of: ${names.join(', ')}`], [n.id]); return () => 0 }
  if (id === undefined) return () => trafficView(n, model.now()).counts[what as (typeof COUNTS)[number]]
  const ids = (storeOf(model).topology.get(n.uid)?.nodes ?? []).map((m) => m.id)
  if (typeof id !== 'string' || !ids.includes(id)) { const near = typeof id === 'string' ? closest(id, ids) : null; report(model, 'REF-MISSING', `traffic.count(): "${String(id)}" is not a node this traffic runs over.`, [near ? `use "${near}"` : `nodes: ${ids.join(', ')}`], [n.id]); return () => 0 }
  return () => trafficView(n, model.now()).station(id)[what as (typeof STATION_COUNTS)[number]]
})

// ── sequence ─────────────────────────────────────────────────────────────────────────────────────────
interface SequenceRec { actors: MNode[]; lifelines: MNode[]; messages: MNode[] }
const sequences = (model: SceneModel): Map<number, SequenceRec> => model.store('diagram.sequence', () => new Map<number, SequenceRec>())
/** The gap between the lifelines of a sequence of `count` actors when the author gives none. */
export const actorGapFor = (count: number): number => (count > 1 ? Math.min(D.actorGapMax, Math.max(D.actorGap, D.sequenceSpan / (count - 1))) : D.actorGap)
/** sequence({ actors, messages }): lifelines side by side and the messages between them, top to bottom, in order. */
export const sequence = defineKind({
  name: 'sequence', space: '2d', chunk: 'diagram', container: true,
  schema: {
    actors: { type: 'any', dynamic: false, example: "actors: ['client', 'server', 'database']" },
    messages: { type: 'any', dynamic: false, example: "messages: [['client', 'server', 'GET /cart'], ['server', 'client', '200', { dashed: true }]]" },
    shown: { type: 'number', example: 'shown: 2' },
    actorGap: { type: 'positive', default: D.actorGap, dynamic: false },
    messageGap: { type: 'positive', default: D.messageGap, dynamic: false },
  },
  init(q, model) {
    const rec: SequenceRec = { actors: [], lifelines: [], messages: [] }
    sequences(model).set(q.uid, rec)
    const given = q.props.actors
    const named: [string, unknown][] = Array.isArray(given) ? given.map((a) => [String(a), a]) : plain(given) ? Object.entries(given) : []
    if (!named.length) report(model, 'API-TYPE', 'sequence() needs actors: a list of names.', ["sequence({ actors: ['client', 'server'], messages: [['client', 'server', 'GET /']] })"], [q.id])
    const list = Array.isArray(q.props.messages) ? q.props.messages : []
    if (q.props.messages !== undefined && !Array.isArray(q.props.messages)) report(model, 'API-TYPE', 'sequence(): messages must be a list of [from, to, label].', ["messages: [['client', 'server', 'GET /']]"], [q.id])
    const row = q.props.messageGap as number
    // the default gap means nobody chose one: two or three parties then use the width a frame has
    const gap = q.props.actorGap === D.actorGap ? actorGapFor(named.length) : (q.props.actorGap as number)
    const x = (i: number): number => (i - (named.length - 1) / 2) * gap
    const depth = (list.length + 0.6) * row
    const top = (depth + D.boxHeight) / 2 - D.boxHeight / 2
    const byKey: Record<string, number> = Object.create(null)
    // lines and arrows are drawn between points of the frame: these follow the sequence wherever it is placed
    const local = (v: Vec3) => (): Vec3 => apply(model.now().world(q), v)
    named.forEach(([key, label], i) => {
      byKey[key] = i
      const a = model.child(q, key, node, typeof label === 'string' || typeof label === 'function' ? label : key).at(x(i), top)
      rec.actors.push(a)
      rec.lifelines.push(model.child(q, `${key}-line`, line, local([x(i), top - D.boxHeight / 2, 0]), local([x(i), top - D.boxHeight / 2 - depth, 0]), { color: D.slotColor, strokeWidth: D.edgeStroke, dashed: true }).z(-1))
    })
    const total = list.length
    const shown = (): number => { const v = model.now().prop<number>(q, 'shown'); return typeof v === 'number' && Number.isFinite(v) ? v : total }
    list.forEach((item, i) => {
      const [from, to, label, opts] = Array.isArray(item) ? item : []
      const a = byKey[from as string], b = byKey[to as string]
      if (a === undefined || b === undefined) {
        const bad = a === undefined ? from : to
        const near = typeof bad === 'string' ? closest(bad, Object.keys(byKey)) : null
        report(model, typeof bad === 'string' ? 'REF-MISSING' : 'API-TYPE', typeof bad === 'string' ? `sequence(): message ${i + 1} names "${bad}", which is not one of the actors.` : `sequence(): message ${i + 1} must be [from, to, label].`, [near ? `use "${near}"` : `actors: ${Object.keys(byKey).join(', ')}`], [q.id])
        return
      }
      const y = top - D.boxHeight / 2 - (i + 0.8) * row
      const self = a === b
      const p: Vec3 = [x(a), y + (self ? row * 0.2 : 0), 0], d: Vec3 = self ? [x(a), y - row * 0.3, 0] : [x(b), y, 0]
      const e = model.child(q, `m${i + 1}`, edge, local(p), local(d), { ...(plain(opts) ? opts : {}), label: typeof label === 'string' || typeof label === 'function' ? label : '', buff: 0, drawn: () => clamp01(shown() - i) })
      // a message to oneself leaves the lifeline, turns and comes back a little lower
      if (self) storeOf(model).curves.set(e.uid, (frame) => { const s0 = local(p)(), s1 = local(d)(), reach = D.selfReach * frame.world(q).s; return [s0[0], s0[1], s0[0] + reach, s0[1], s1[0] + reach, s1[1], s1[0], s1[1]] })
      rec.messages.push(e)
    })
    if (q.props.shown === undefined) q.props.shown = total
    const selfHandle = q as Handle
    selfHandle.actors = Object.fromEntries(named.map(([key], i) => [key, rec.actors[i]]))
    selfHandle.messages = rec.messages
  },
})
const showSetter = (q: MNode, v: unknown): Patch | null => (dyn(q, 'shown', v, finite, '.shown(2)') ? { shown: v } : null)
/** q.shown(2): how many messages are drawn (a fraction draws the next one part of the way); q.to.shown(3) draws the third. */
defineKindSetter('sequence', 'shown', showSetter)
/** q.draw(): the animation that draws the actors and lifelines on, then the messages one after the other. */
defineKindMethod('sequence', 'draw', (q: Handle, opts?: unknown): Anim => {
  const rec = sequences(q.model).get(q.uid)
  if (!rec) return NOOP_ANIM('draw', PACE.enter)
  const per = plain(opts) && typeof opts.seconds === 'number' && opts.seconds > 0 ? opts.seconds : D.messageSeconds
  return seq(lagged([...rec.actors, ...rec.lifelines].map((m) => create(m)), { lag: 0.15 }), ...rec.messages.map((m) => create(m, { duration: per })))
})

/** On demand: this module's API is its own chunk (mimir.diagramapi.js), loaded before a scene that uses one of its names. */
export const lazy = true
export const api = { node, edge, graph, token, tokens, queue, timer, traffic, sequence }
