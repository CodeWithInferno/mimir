/** Shape of a diagram node. 'queue' is a row of slots; 'ring' is a circle with a ring round it that fills. */
type NodeShape = 'box' | 'pill' | 'circle' | 'cylinder' | 'queue' | 'ring'
/** Options of node(). Sizes are frame units. */
interface NodeOpts {
  id?: string
  /** Outline: 'box' (default), 'pill', 'circle', 'cylinder' (a database), 'queue' (a row of slots), 'ring' (a worker with a progress ring). */
  shape?: NodeShape
  /** Outline colour (default GREY_B). A state other than 'idle' takes the outline over. */
  color?: Dyn<Color>
  /** Full width; by default the node is as wide as its label needs. For a circle or a ring: the diameter. */
  width?: Dyn<number>
  /** Full height. */
  height?: Dyn<number>
  /** Outline width (1 = 0.01 units; default 1.6). */
  strokeWidth?: Dyn<number>
  /** Fill colour and its opacity (default: no fill). */
  fill?: Dyn<Color | null>
  fillOpacity?: Dyn<number>
  /** Where the label sits. 'auto' (default): inside a box or pill, above a queue, a ring or a cylinder with a count. */
  labelAt?: 'auto' | 'inside' | 'above' | 'below' | 'left' | 'right'
  /** Label size (default 'note' = 24). */
  labelSize?: number | 'body' | 'label' | 'note' | 'tiny'
  labelColor?: Dyn<Color>
  /** Colour of what the node holds: filled slots and the ring (default BLUE). */
  accent?: Dyn<Color>
  /** 'queue' only: how many slots (default 6). */
  slots?: number
  /** 'queue' only: how many slots hold a job, counted from the head (the right end). */
  filled?: Dyn<number>
  /** 'ring' only: how far the ring is filled, 0..1, clockwise from twelve o'clock. */
  progress?: Dyn<number>
  /** State badge: 'idle' | 'busy' | 'waiting' | 'failed' | 'down' | 'done' (or a key of `states`). One colour per meaning; null = no badge. */
  state?: Dyn<string | null>
  /** Colour of each state (default: idle grey, busy BLUE, waiting GOLD, failed and down RED, done GREEN). */
  states?: Record<string, Color>
  /** A whole number shown on the node: in the middle of a box, pill, circle or cylinder (the label then moves outside), beside the label otherwise. */
  count?: Dyn<number | null>
  countColor?: Dyn<Color>
  /** Out of service: drawn dashed and red. traffic() sends nothing to it and what it was serving fails. */
  down?: Dyn<boolean>
  /** Progress 0..1 of a failure flash (a ring that swells and fades). Left out, the node flashes by itself when its state becomes 'failed' or it goes down. */
  flash?: Dyn<number | null>
  opacity?: Dyn<number>
}
/** What n.to gives: the standard tweens plus the node's own setters. */
interface DiagramNodeTo extends MobSetters<DiagramNodeTo>, Anim {
  /** Switch the state half way through the play; 'failed' flashes. */
  state(state: Dyn<string | null>): DiagramNodeTo
  /** Tween the count. */
  count(value: Dyn<number | null>): DiagramNodeTo
  /** Take the node out of service (or back in with false) half way through the play. */
  down(down?: Dyn<boolean>): DiagramNodeTo
  /** Tween the ring of a 'ring' node. */
  progress(value: Dyn<number>): DiagramNodeTo
  /** Tween the number of filled slots of a 'queue' node. */
  filled(value: Dyn<number>): DiagramNodeTo
}
/** A node of a diagram. Parts: <id>.label, <id>.count. Extra anchors: 'head' and 'tail' (first and last slot of a queue). */
interface DiagramNode extends MobOf<DiagramNode, DiagramNodeTo> {
  /** Set the state badge: n.state('busy'). Inside a step it changes at that moment. */
  state(state: Dyn<string | null>): DiagramNode
  /** Show a whole number on the node: n.count(() => served()). */
  count(value: Dyn<number | null>): DiagramNode
  /** Take the node out of service: n.down(); bring it back: n.down(false). Inside a step it happens at that moment, and a traffic() over the node follows. */
  down(down?: Dyn<boolean>): DiagramNode
  /** Fill the ring of a 'ring' node, 0..1. */
  progress(value: Dyn<number>): DiagramNode
  /** Fill slots of a 'queue' node from the head. */
  filled(value: Dyn<number>): DiagramNode
}
/** A node of a system diagram: a thin outline with a label. node('cache') · node('database', { shape: 'cylinder', count: () => rows() }). In a graph() nodes are placed for you. */
declare function node(label?: Dyn<string | number>, opts?: NodeOpts): DiagramNode
/** A queue: a row of slots filled from the head (the right end). queue({ slots: 8, filled: () => waiting(), label: 'queue' }). The same as node(label, { shape: 'queue' }). */
declare function queue(opts?: NodeOpts & { label?: Dyn<string | number> }): DiagramNode
/** A small ring that fills clockwise as progress goes 0 → 1: timer(() => elapsed() / total, { radius: 0.2 }).at(worker). */
declare function timer(progress: Dyn<number>, opts?: { id?: string; radius?: Dyn<number>; color?: Dyn<Color>; strokeWidth?: Dyn<number>; /** opacity of the full circle under the arc (default 0.22, 0 = none) */ track?: Dyn<number>; opacity?: Dyn<number> }): Mob

/** Options of edge(). */
interface EdgeOpts {
  id?: string
  /** A short text beside the middle of the edge. */
  label?: Dyn<string | number>
  dashed?: Dyn<boolean>
  /** Degrees the edge turns through (0 = straight). On an edge of a graph() it replaces the routed line with this arc. */
  bend?: Dyn<number>
  /** A tip at both ends. */
  both?: Dyn<boolean>
  /** false = a plain line without a tip. */
  arrow?: Dyn<boolean>
  color?: Dyn<Color>
  /** Line width (1 = 0.01 units; default 1.5). */
  strokeWidth?: Dyn<number>
  /** Gap between the tip and the shape it points at (default 0.05). */
  buff?: number
  /** Share of the edge that is drawn, 0..1 (default 1): grow an edge with a param. create(edge) is the usual way. */
  drawn?: Dyn<number>
  labelSize?: number | 'label' | 'note' | 'tiny'
  labelColor?: Dyn<Color>
  opacity?: Dyn<number>
}
/** A thin arrow from the outline of one object to the outline of another (points and anchors are used exactly). Part: <id>.label. Tokens travel on it. */
declare function edge(a: PointLike, b: PointLike, opts?: EdgeOpts): Mob

/** One node of a graph(): its label, its options (label defaults to the name), or a 2D object made earlier. */
type GraphNodeSpec = string | (NodeOpts & { label?: Dyn<string | number> }) | Mob
/** A graph: its nodes by name, its edges, and the animation that draws it. */
interface Graph extends MobOf<Graph> {
  /** The nodes by the names given to graph(): g.nodes.api. Their ids are those names, so narration can point at them: [the cache](cache). */
  readonly nodes: Record<string, DiagramNode>
  /** Every edge, in the order given. Their ids are 'from-to'. */
  readonly edges: Mob[]
  /** The group boxes by name: g.groups.backend. Part: <name>.label. */
  readonly groups: Record<string, Mob>
  /** The edge between two nodes: g.edge('api', 'db'). */
  edge(from: string, to: string): Mob
  /** One node by name: the same object as g.nodes[name]. */
  node(name: string): DiagramNode
  /** Draw the graph on, node by node and edge by edge along the flow: st.play(g.draw()). lag = share of each part's time before the next starts (default 0.25). */
  draw(opts?: { lag?: number }): Anim
}
/**
 * A node-and-arrow diagram that lays itself out in layers along the flow; nobody positions anything. Edges are routed
 * round the nodes and end on their outlines. It is centred on its position and shrinks to fit width × height.
 * graph({ nodes: { api: 'API', db: { label: 'database', shape: 'cylinder' } }, edges: [['api', 'db', { label: 'SQL' }]] })
 */
declare function graph(opts: {
  id?: string
  nodes: Record<string, GraphNodeSpec>
  edges: [from: string, to: string, opts?: EdgeOpts][]
  /** Boxes drawn round some of the nodes, by name: groups: { backend: ['api', 'db'] } or { backend: { label: 'back end', nodes: ['api', 'db'], color: GREY, dashed: true } }. The layout does not move nodes for them: name nodes that end up next to each other. */
  groups?: Record<string, string[] | { nodes: string[]; label?: Dyn<string>; color?: Dyn<Color>; strokeWidth?: Dyn<number>; dashed?: Dyn<boolean>; padding?: Dyn<number>; labelColor?: Dyn<Color> }>
  /** Which way the edges flow (default 'right'). */
  direction?: 'right' | 'down'
  /** Space between neighbours of one layer (default 0.45) and between layers (default 1.15). */
  nodeGap?: number
  rankGap?: number
  /** The box the drawing must fit in (default 12.6 × 5.6): gaps are squeezed first, then the whole drawing is shrunk. */
  width?: number
  height?: number
  opacity?: Dyn<number>
}): Graph

/** One dot on an edge, at a share of its length (0 = start, 1 = end): token({ on: g.edge('api', 'db'), at: () => progress() }). */
declare function token(opts: { id?: string; on: Mob; at?: Dyn<number>; color?: Dyn<Color>; radius?: Dyn<number>; /** a short text above the dot */ label?: Dyn<string | number>; labelSize?: number | 'note' | 'tiny'; labelColor?: Dyn<Color>; opacity?: Dyn<number> }): Mob
/** A steady stream of dots along an edge: tokens(edge, { count: 3, speed: 1.5 }). speed is frame units per second; phase shifts every dot by a share of the edge; active (true / false / 0..1) shows or hides them without moving them. */
declare function tokens(on: Mob, opts?: { id?: string; count?: Dyn<number>; speed?: Dyn<number>; phase?: Dyn<number>; active?: Dyn<boolean | number>; color?: Dyn<Color>; radius?: Dyn<number>; /** the clock in seconds (default s.t()) */ time?: Dyn<number>; opacity?: Dyn<number> }): Mob

/** Seconds, or [shortest, longest] for a value drawn per job from the seeded stream. */
type Span = number | [number, number]
/** A node where jobs appear. */
interface TrafficSource {
  /** How many jobs in all (default: without end). */
  count?: number
  /** Seconds between two jobs (default 1). */
  every?: Dyn<Span>
  /** Seconds before the first job (default 0). */
  start?: number
  /** Jobs (by number, 0 = the first) that fail at every station that serves them. */
  failing?: number[]
}
/** What a node does with the jobs that reach it. A node not named passes them straight on; a 'queue' node holds them in its slots until the next node has room. */
interface TrafficStation {
  /** Seconds one job takes here. Giving it makes the node a server. */
  service?: Dyn<Span>
  /** Jobs served at the same time (default 1). */
  workers?: number
  /** Jobs that may wait here (default: the slots of a 'queue' node, else 0). */
  slots?: number
  /** Which outgoing edge a job takes, among the targets that are up and have room: 'idle' (default: the one sent to longest ago), 'roundRobin', 'random', 'first', or weights by node name { a: 3, b: 1 }. */
  route?: 'idle' | 'roundRobin' | 'random' | 'first' | Record<string, number>
  /** Share of the jobs that fail here, 0..1. A failed job goes back the way it came (on the edge that points back, when the graph has one: ['worker', 'queue', { dashed: true }] after ['queue', 'worker']; such an edge carries retries only), waits out a backoff half way and tries again. */
  failRate?: Dyn<number>
  /** Share of the jobs that end here although an edge leads on, 0..1 (a cache hit). */
  absorb?: Dyn<number>
  /** Least seconds between two jobs leaving (default 0.3 for a queue, else 0). */
  release?: number
}
/** A running traffic simulation: the tokens (a 2D object: fade it in, raise it with z) and its live counts. */
interface Traffic extends MobOf<Traffic> {
  /** A live number: sim.count('sent' | 'done' | 'dead' | 'queued' | 'inFlight') for the whole graph (sent = done + dead + queued + inFlight, always), or of one node: sim.count('sent' | 'done' | 'failed' | 'waiting' | 'busy', 'db'). */
  count(what: 'sent' | 'done' | 'dead' | 'queued' | 'inFlight'): () => number
  count(what: 'sent' | 'done' | 'failed' | 'waiting' | 'busy', node: string | Mob): () => number
}
/**
 * A seeded simulation of jobs through a graph, drawn as tokens that glide along the edges, wait in the slots of
 * queues, sit in the rings of servers and retry when they fail. Counts are conserved: every job is queued, in flight,
 * done or dead. Its clock starts when it appears (make it inside the step where traffic should start, or fadeIn it).
 * Nodes left unbound show what happens to them: sources count what they sent, queues what waits, servers get a
 * progress ring and a state, nodes where jobs end count them. node.down() inside a step takes a node out: traffic
 * shifts to the others. Probes for check: '<id>.sent', '.done', '.dead', '.queued', '.inFlight', '.balance' (always 0).
 * traffic(g, { sources: { client: { every: [0.5, 0.9] } }, stations: { worker: { service: [0.9, 1.4], failRate: 0.1 } } })
 */
declare function traffic(over: Graph | Mob[], opts: {
  id?: string
  /** Where jobs appear, by node name. */
  sources: Record<string, TrafficSource>
  /** What nodes do with jobs, by node name. */
  stations?: Record<string, TrafficStation>
  /** Failed jobs retry `limit` times (default 3); the first backoff is `backoff` seconds (default 1), each further one `factor` times longer (default 2). Past the limit a job is dead. */
  retry?: { limit?: number; backoff?: number; factor?: number }
  /** Same seed, same run (default 1). */
  seed?: number | string
  /** Seconds a job takes along one edge (default 0.9), and across a node that only passes it on (default 0.25). */
  travel?: Dyn<number>
  hop?: Dyn<number>
  /** Simulation seconds already gone by when the traffic appears (default 0). */
  start?: number
  /** Colour of a job, of a failed one (and the core a job keeps after a failure), and of the backoff ring. */
  color?: Dyn<Color>
  failedColor?: Dyn<Color>
  waitColor?: Dyn<Color>
  /** Radius of a token (default 0.07). */
  radius?: Dyn<number>
  /** false = leave every node as the scene made it (default true: unbound nodes show counts, rings and states). */
  bind?: boolean
  /** The simulation's clock in seconds (default: s.t() since the traffic appeared). */
  time?: Dyn<number>
  opacity?: Dyn<number>
}): Traffic

/** A sequence diagram: its actors by name, its messages in order, and the animation that draws it. */
interface Sequence extends MobOf<Sequence, SequenceTo> {
  /** The actor boxes by name: q.actors.server. */
  readonly actors: Record<string, DiagramNode>
  /** The message arrows, in order. */
  readonly messages: Mob[]
  /** How many messages are drawn; a fraction draws the next one part of the way. */
  shown(count: Dyn<number>): Sequence
  /** Draw the actors and lifelines on, then the messages one after the other: st.play(q.draw()). seconds = time per message (default 0.6). */
  draw(opts?: { seconds?: number }): Anim
}
interface SequenceTo extends MobSetters<SequenceTo>, Anim {
  /** Draw (or undraw) messages up to this one: st.play(q.to.shown(3)). */
  shown(count: Dyn<number>): SequenceTo
}
/**
 * A request / response exchange: one lifeline per actor, the messages between them top to bottom in the order given.
 * sequence({ actors: ['client', 'server', 'database'], messages: [['client', 'server', 'GET /cart'], ['server', 'database', 'query'], ['database', 'server', 'rows', { dashed: true }]] })
 */
declare function sequence(opts: {
  id?: string
  /** Names in left-to-right order, or name → label. */
  actors: string[] | Record<string, string>
  /** [from, to, label, edge options?]; a message from an actor to itself loops back. */
  messages: [from: string, to: string, label?: string, opts?: EdgeOpts][]
  /** How many messages are drawn (default: all). */
  shown?: Dyn<number>
  /** Distance between lifelines (default 2.6) and between messages (default 0.62). */
  actorGap?: number
  messageGap?: number
  opacity?: Dyn<number>
}): Sequence
