// job-queue: how a job queue survives a failing worker.
// One job first, the whole picture last. A producer sends one batch of jobs through a queue to workers and into a
// database. A line forms, and the line's depth becomes a plot. A worker crashes: its job goes back, waits, and a healthy
// worker finishes it. A poison job fails on every worker: each retry waits twice as long, and after three it is set
// aside as a dead letter. Through all of it one line of counts stays true: in = done + queued + in flight + dead.
//
// Nothing is keyed by hand. RULES below is the whole run: events() plays it as one seeded discrete-event simulation,
// and every token, ring, count, bar and point of the plot is read from that simulation's history at s.t(). The story
// cuts its steps at the simulation's own events (the crash, each failure, the dead letter), so changing a rule or the
// seed moves the story with it. graph() lays out the flow; the retry loop and the dead letters hang from the queue by
// relations. `mimir check` holds the scene to the claims at the end of the file at every sampled instant.
import {
  scene, graph, node, events, axes, text, num, circle, rect, line, arrow, timer, row, column, group,
  create, growArrow, write, fadeIn, derive, transform, all, lagged, timed, expect, smooth,
  FRAME_W, BLUE, GOLD, RED, GREEN, YELLOW, WHITE, GREY_A, GREY_B, GREY_C,
} from 'mimir'

// ── the rules of the run (seconds of simulation time) ────────────────────────────────────────────────────────────────
const RULES = {
  seed: 7, // decides texture only: the gaps of the stream and how long each job takes
  slots: 8, // places in the line
  workers: ['a', 'b', 'c'], // the head of the line goes to the worker that has been idle longest
  crew: ['b'], // who works from the start; the others join at `at.crew`
  batch: { alone: 1, burst: 8, stream: 36, poison: 1 }, // the producer's one batch, in this order; the poison job fails on every worker
  every: { burst: 0.45, stream: [0.85, 1.05], poison: 9.5 }, // seconds between two jobs of each part of the batch
  service: [1.2, 1.6], // seconds a worker needs for one job
  release: 0.3, // least seconds between two jobs leaving the line; a job leaves it the moment a worker is free, and walks out past the head
  store: 0.36, // least seconds between two finished jobs leaving for the database
  retry: { limit: 3, backoff: 1, factor: 2 }, // a failed job waits 1 s, then 2 s, then 4 s; a fourth failure is final
  crash: { worker: 'c', share: 0.7, outage: 20 }, // that worker stops this far through a job and is away this long
  open: 2.8, // seconds the diagram takes to draw; nothing is sent before
  // when each part starts, in seconds after the diagram has been drawn
  at: { alone: 0.4, burst: 5.9, crew: 20.9, stream: 23.5, armed: 30 }, // armed: the crash hits the first job the worker starts after this
  // seconds a job needs for each stretch of its way
  move: { arrow: 0.7, line: 0.8, exit: 0.15, hop: 0.2, linger: 0.6, stem: 0.4, side: 0.5, rise: 0.25, drop: 0.6 },
}

// ── how it looks (frame units, seconds) ──────────────────────────────────────────────────────────────────────────────
const LOOK = {
  graph: { width: 8.9, height: 4.4, nodeGap: 0.6 }, // the flow keeps to the left of the frame
  plot: { width: 3.3, height: 2.6, share: 0.3, lead: 1.5, tail: 1.5 }, // the plot has the right 30%; seconds shown before the first sample and after the batch
  margin: 0.3, // room left and right of the flow while the camera is close on it
  token: 0.075, // radius of a job
  core: 0.036, // radius of the red core a failed job keeps
  ring: 0.17, // radius of the backoff ring round a waiting job
  lift: 0.25, // the flow sits this far above the middle of its area: the retry loop and the dead letters hang under it
  settle: 1.5, // seconds the line stands at its first depth before it is measured
  loop: 0.72, // how far the retry loop hangs under the queue
  dead: 0.6, // how far under the loop the dead letters sit
  square: 0.2, // side of one square of the stack
  bar: 0.07, // width of the first sample of the plot
  carry: -110, // degrees the first sample swings through on its way to the plot (it goes over the labels, not through them)
  second: 0.45, // length of one second of backoff
  fade: 0.25, // seconds a token, a ring or a row takes to appear or leave
  flash: 0.7, // seconds of the pulse round a worker that failed
  rowsLinger: 1.2, // seconds the retry rows of a job that got done stay
  above: 10, // paint order of tokens
  gap: { label: 0.2, title: 0.3, stack: 0.6, squares: 0.04, rows: 0.16, underLoop: 0.4, bar: 0.18, seconds: 0.14, terms: 0.42, name: 0.12, top: 0.4, rule: 0.14, band: [0.1, -0.2] }, // distances between things that sit together
  stroke: { loop: 1.5, wait: 5, trace: 2.5, rule: 2 }, // line widths (1 = 0.01 units)
  wash: { depth: 0.16, outage: 0.14 }, // opacity of the two filled regions of the plot
  // seconds each move of the story takes (lag = the share of one move before the next starts)
  pace: { lag: 0.3, lift: 1, liftLag: 0.25, easeOut: 2.5, beforeAxes: 1.5, fuse: 0.8, carry: 2, trace: 0.4, crewLag: 0.2, mark: 1.5, band: 0.6, termLag: 0.4, signLag: 0.2, deadLag: 0.4 },
  tick: 1 / 60, // seconds between the two poses the "no job jumps" claim compares
  speedLimit: 8, // frame units a second no token may exceed (the fastest stretch, the walk up the line, is about 3)
}
// where each step is cut: seconds after (+) or before (-) the moment of the run it is named for. Each leaves its sentence
// room to be said; `mimir check` fails the "cuts" claims at the end of the file when one does not.
const CUT = {
  burst: -0.3, // the first step ends just before the burst
  crew: -2.5, // the two workers are drawn before they start
  stream: -0.2,
  crash: -2.5, // "crashes" is spoken as it happens
  waited: 0.5, // the crashed job's wait is over
  done: 0.5, // it has reached the database
  recovery: -1.3,
  batchSent: 0.2,
  poison: -0.3, // the last job is about to leave
  secondWait: -3.2, // the second worker is about to fail it
  thirdWait: -2.6,
  thirdRuns: 2.8, // into the third wait
  lastTry: 3.7, // after the third wait, just before the last failure
  dead: 2.4, // the dead letter has a moment to itself
  close: 5.5, // the last step
}
const HORIZON = 1e6 // a time after the last event of any run
const HOLD = 1 // seconds the engine holds at the end of every step
const CHAPTER = 0.8 // seconds a chapter after the first takes to open; the claims at the end of the file check the cuts made with both

/**
 * @typedef {{ k: string, t0: number, t1: number, w?: string, e?: string, back?: boolean, on?: boolean, last?: boolean, n?: number, u?: number, from?: string, moves?: number[][] }} Leg one stretch of a job's way
 * @typedef {{ id: number, poison: boolean, fails: number, fate: 'done' | 'dead', legs: Leg[] }} Job
 * @typedef {{ name: string, online: boolean, down: boolean, job: number | null, idle: number }} Worker
 * @typedef {{ t: number, kind: string, job?: number, worker?: string }} Item something that is going to happen
 * @typedef {{ w: string, job: number, t0: number, t1: number, end: number, ok: boolean }} Serve one job in one worker: planned from t0 to t1, over at `end`
 * @typedef {{ t: number, job: number, worker: string, why: 'crash' | 'poison', n: number }} Fail the n-th failure of a job
 * @typedef {{ job: number, n: number, t0: number, t1: number }} Wait the backoff before retry n
 * @typedef {{ sent: number, done: number, dead: number, queued: number, flight: number, jobs: Job[], line: number[], returning: number, released: number, stored: number,
 *   crash: { worker: string, t: number, until: number } | null, workers: Record<string, Worker>, agenda: Item[], depth: number[][], serves: Serve[], fails: Fail[], waits: Wait[] }} Run the state of the simulation
 */
/** the last entry of a list that has one @template T @param {T[]} list @returns {T} */
const last = (list) => list[list.length - 1]
/** a value the rules guarantee is there @template T @param {T | undefined | null} value @returns {T} */
const the = (value) => /** @type {T} */ (value)

const TOTAL = RULES.batch.alone + RULES.batch.burst + RULES.batch.stream + RULES.batch.poison
const lerp = (a, b, u) => a + (b - a) * u
const clamp01 = (u) => Math.max(0, Math.min(1, u))
const between = (p, q, u) => [lerp(p[0], q[0], u), lerp(p[1], q[1], u)]
/** 0 → 1 over `span` seconds from t0, eased @param {number} t @param {number} t0 @param {number} [span] */
const rise = (t, t0, span = LOOK.fade) => smooth(clamp01((t - t0) / span))

// ── the simulation: a pure state machine; events() gives it the clock and the seeded random stream ──────────────────────
// A job's way is a list of legs { k, t0, t1, … }; the legs are the record everything on screen is drawn from.
const LINE_SPEED = RULES.slots / RULES.move.line // slots a second a job moves up the line
/** place in the line at time t, in slots from the head (it enters one slot behind the last) @param {Leg} leg @param {number} t */
const placeInLine = (leg, t) => {
  const moves = the(leg.moves)
  let u = RULES.slots
  for (let i = 0; i < moves.length; i++) {
    const [t0, slot] = moves[i]
    const t1 = i + 1 < moves.length ? moves[i + 1][0] : Infinity
    u = Math.max(slot, u - LINE_SPEED * (Math.min(t, t1) - t0))
    if (t <= t1) break
  }
  return u
}

/** @param {number} open simulation time at which the diagram stands */
const run = (open) => {
  const T = Object.fromEntries(Object.entries(RULES.at).map(([name, after]) => [name, open + after]))
  const M = RULES.move
  /** @param {Run} st @param {number} t @param {string} kind @param {{ job?: number, worker?: string }} [more] */
  const schedule = (st, t, kind, more = {}) => {
    let i = st.agenda.length
    while (i > 0 && st.agenda[i - 1].t > t) i--
    st.agenda.splice(i, 0, { t, kind, ...more })
  }
  /** add a leg to a job's way; returns when it ends @param {Job} job @param {string} k @param {number} t0 @param {number} span @param {Partial<Leg>} [more] */
  const leg = (job, k, t0, span, more = {}) => { job.legs.push({ k, t0, t1: t0 + span, ...more }); return t0 + span }
  /** the free worker that has been idle longest @param {Run} st @returns {Worker | undefined} */
  const idle = (st) => RULES.workers.map((name) => st.workers[name]).filter((w) => w.online && !w.down && w.job === null).sort((p, q) => p.idle - q.idle)[0]
  /** the depth of the line after everything that happens at time t @param {Run} st @param {number} t */
  const depth = (st, t) => { if (last(st.depth)[0] === t) last(st.depth)[1] = st.line.length; else st.depth.push([t, st.line.length]) }
  /** ask for the next hand-over at the earliest moment it can happen @param {Run} st @param {number} t */
  const plan = (st, t) => {
    if (!st.line.length || st.returning > 0 || !idle(st)) return
    schedule(st, Math.max(t, st.released + RULES.release), 'dispatch')
  }
  /** a job takes its place at the end of the line @param {Run} st @param {number} t @param {Job} job @param {'producer' | 'loop'} from */
  const join = (st, t, job, from) => {
    st.flight--; st.queued++
    job.legs.push({ k: 'line', t0: t, t1: Infinity, from, moves: [[t, st.line.length]] })
    st.line.push(job.id)
    depth(st, t)
  }
  /** a job fails: it goes back the way it came, then waits and rejoins the line, or is set aside for good
   * @param {Run} st @param {number} t @param {Job} job @param {string} worker @param {'crash' | 'poison'} why */
  const fail = (st, t, job, worker, why) => {
    job.fails++
    st.fails.push({ t, job: job.id, worker, why, n: job.fails })
    st.returning++
    let at = leg(job, 'stay', t, M.linger, { w: worker })
    at = leg(job, 'enter', at, M.hop, { w: worker, back: true })
    at = leg(job, 'edge', at, M.arrow, { e: `queue-${worker}`, back: true })
    at = leg(job, 'stem', at, M.stem, { w: worker })
    schedule(st, at, 'clear')
    if (job.fails > RULES.retry.limit) {
      job.fate = 'dead'
      schedule(st, leg(job, 'drop', at, M.drop), 'bury', { job: job.id })
      return
    }
    const wait = RULES.retry.backoff * RULES.retry.factor ** (job.fails - 1)
    at = leg(job, 'side', at, M.side)
    st.waits.push({ job: job.id, n: job.fails, t0: at, t1: at + wait })
    at = leg(job, 'wait', at, wait, { n: job.fails })
    at = leg(job, 'side', at, M.side, { on: true })
    schedule(st, leg(job, 'rise', at, M.rise), 'rejoin', { job: job.id })
  }

  /** what each kind of event does to the state @type {Record<string, (st: Run, t: number, item: Item, draw: number[]) => void>} */
  const handlers = {
    emit: (st, t, item, draw) => {
      const id = st.sent, /** @type {Job} */ job = { id, poison: RULES.batch.poison > 0 && id === TOTAL - 1, fails: 0, fate: 'done', legs: [] }
      st.jobs.push(job); st.sent++; st.flight++
      schedule(st, leg(job, 'edge', t, M.arrow, { e: 'producer-queue' }), 'arrive', { job: id })
      const next = id + 1, B = RULES.batch
      if (next >= TOTAL) return
      if (next === B.alone) schedule(st, T.burst, 'emit')
      else if (next < B.alone + B.burst) schedule(st, t + RULES.every.burst, 'emit')
      else if (next === B.alone + B.burst) schedule(st, T.stream, 'emit')
      else if (next < TOTAL - B.poison) schedule(st, t + lerp(RULES.every.stream[0], RULES.every.stream[1], draw[0]), 'emit')
      else schedule(st, t + RULES.every.poison, 'emit')
    },
    arrive: (st, t, item) => join(st, t, st.jobs[the(item.job)], 'producer'),
    rejoin: (st, t, item) => join(st, t, st.jobs[the(item.job)], 'loop'),
    dispatch: (st, t) => {
      const worker = idle(st)
      if (!st.line.length || st.returning > 0 || !worker || t < st.released + RULES.release - 1e-9) return
      const job = st.jobs[the(st.line.shift())], stood = last(job.legs)
      stood.t1 = t
      st.line.forEach((id, slot) => the(last(st.jobs[id].legs).moves).push([t, slot]))
      st.queued--; st.flight++; st.released = t
      depth(st, t)
      worker.job = job.id // the worker is taken from this moment; the job walks the rest of the line and out to it
      const u = placeInLine(stood, t)
      let at = leg(job, 'exit', t, u / LINE_SPEED + M.exit, { w: worker.name, u, from: stood.from })
      at = leg(job, 'edge', at, M.arrow, { e: `queue-${worker.name}` })
      schedule(st, leg(job, 'enter', at, M.hop, { w: worker.name }), 'start', { job: job.id, worker: worker.name })
    },
    start: (st, t, item, draw) => {
      const worker = st.workers[the(item.worker)], job = st.jobs[the(item.job)]
      const span = lerp(RULES.service[0], RULES.service[1], draw[0])
      st.serves.push({ w: worker.name, job: job.id, t0: t, t1: t + span, end: t + span, ok: true })
      leg(job, 'serve', t, span, { w: worker.name })
      if (worker.name === RULES.crash.worker && st.crash === null && t >= T.armed) {
        st.crash = { worker: worker.name, t: t + RULES.crash.share * span, until: t + RULES.crash.share * span + RULES.crash.outage }
        schedule(st, st.crash.t, 'crash')
        schedule(st, st.crash.until, 'recover')
      }
      schedule(st, t + span, 'finish', { job: job.id, worker: worker.name })
    },
    finish: (st, t, item) => {
      const worker = st.workers[the(item.worker)], job = st.jobs[the(item.job)]
      if (worker.job !== job.id || worker.down) return // the worker crashed under this job
      if (job.poison) {
        the(st.serves.findLast((serve) => serve.job === job.id)).ok = false
        worker.job = null; worker.idle = t
        fail(st, t, job, worker.name, 'poison')
        return
      }
      const at = Math.max(t, st.stored + RULES.store)
      st.stored = at
      if (at > t) leg(job, 'serve', t, at - t, { w: worker.name })
      schedule(st, at, 'leave', { job: job.id, worker: worker.name })
    },
    leave: (st, t, item) => {
      const worker = st.workers[the(item.worker)], job = st.jobs[the(item.job)]
      worker.job = null; worker.idle = t
      const at = leg(job, 'leave', t, M.hop, { w: worker.name })
      schedule(st, leg(job, 'edge', at, M.arrow, { e: `${worker.name}-db`, last: true }), 'store', { job: job.id })
    },
    store: (st) => { st.flight--; st.done++ },
    crash: (st, t) => {
      const worker = st.workers[the(st.crash).worker], job = st.jobs[the(worker.job)]
      worker.down = true; worker.job = null
      const serve = the(st.serves.findLast((entry) => entry.job === job.id))
      serve.ok = false; serve.end = t
      last(job.legs).t1 = t
      fail(st, t, job, worker.name, 'crash')
    },
    recover: (st, t) => { const worker = st.workers[the(st.crash).worker]; worker.down = false; worker.idle = t },
    crew: (st, t) => RULES.workers.forEach((name) => { if (!st.workers[name].online) { st.workers[name].online = true; st.workers[name].idle = t } }),
    clear: (st) => { st.returning-- },
    bury: (st) => { st.flight--; st.dead++ },
  }

  /** @type {Run} */
  const init = {
    sent: 0, done: 0, dead: 0, queued: 0, flight: 0, // the five counts on screen, kept by the events themselves
    jobs: [], line: [], returning: 0, released: -HORIZON, stored: -HORIZON, crash: null,
    workers: Object.fromEntries(RULES.workers.map((name) => [name, { name, online: RULES.crew.includes(name), down: false, job: null, idle: open }])),
    agenda: [{ t: T.alone, kind: 'emit' }, { t: T.crew, kind: 'crew' }],
    depth: [[open, 0]], serves: [], fails: [], waits: [],
  }
  return events({
    seed: RULES.seed,
    maxEvents: 40 * TOTAL,
    init,
    next: (state, rng, t) => {
      const item = state.agenda[0]
      if (!item) return null
      const draw = [rng.next()] // every event draws one number, used or not, so the stream does not depend on the order of branches
      return {
        after: Math.max(0, item.t - t),
        label: item.kind,
        apply: (st) => { const due = the(st.agenda.shift()); handlers[due.kind](st, due.t, due, draw); plan(st, due.t) },
      }
    },
  })
}

export default scene({ title: 'How a job queue survives a failing worker' }, (s) => {
  const now = () => s.t()
  s.guide({ pointerColor: YELLOW })

  // ── the run: simulated once, here; `record` is its last state, which holds every job's legs ────────────────────────
  const OPEN = RULES.open
  const sim = run(OPEN)
  const record = sim.at(HORIZON)
  const live = s.signal(() => sim.at(now()))
  const jobs = record.jobs
  const ends = jobs.map((job) => last(job.legs).t1)
  const END = Math.max(...ends)

  // ── the flow, laid out by graph(); every node shows the simulation ─────────────────────────────────────────────────
  const serving = (name) => record.serves.findLast((serve) => serve.w === name && serve.t0 <= now())
  const failure = (name) => record.fails.findLast((entry) => entry.worker === name && entry.t <= now())
  const failing = (name) => { const entry = failure(name); return entry !== undefined && now() < entry.t + RULES.move.linger }
  const isDown = (name) => record.crash !== null && record.crash.worker === name && now() >= record.crash.t && now() < record.crash.until
  /** a worker: the ring is how far it is through its job; a crashed worker keeps the ring where it broke @param {string} name @returns {NodeOpts & { label: string }} */
  const worker = (name) => ({
    label: '', shape: 'ring',
    progress: () => { const serve = serving(name); return serve && (now() < serve.end || failing(name) || isDown(name)) ? clamp01((Math.min(now(), serve.end) - serve.t0) / (serve.t1 - serve.t0)) : 0 },
    state: () => (isDown(name) ? 'down' : failing(name) ? 'failed' : live().workers[name].job !== null ? 'busy' : 'idle'),
    accent: () => (isDown(name) || failing(name) ? RED : BLUE),
    down: () => isDown(name),
    flash: () => { const entry = failure(name); return entry && now() < entry.t + LOOK.flash ? (now() - entry.t) / LOOK.flash : null },
  })
  const g = graph({
    nodes: {
      producer: { label: 'producer', count: () => live().sent },
      queue: { label: 'queue', shape: 'queue', slots: RULES.slots, count: () => live().queued, countColor: BLUE },
      a: worker('a'), b: worker('b'), c: worker('c'),
      db: { label: 'database', shape: 'cylinder', count: () => live().done, countColor: GREEN },
    },
    edges: [
      ['producer', 'queue'],
      ['queue', 'a'], ['queue', 'b'], ['queue', 'c'],
      ['a', 'db'], ['b', 'db'], ['c', 'db'],
    ],
    ...LOOK.graph,
  })
  const left = s.area('left', 1 - LOOK.plot.share), right = s.area('right', LOOK.plot.share)
  const flowCentre = [left.center[0], left.center[1] + LOOK.lift]
  g.at(flowCentre[0], flowCentre[1])
  const { producer, queue, a, b, c, db } = g.nodes
  const edges = Object.fromEntries(g.edges.map((edge) => [edge.id, edge]))
  const workerName = text('worker', { id: 'workerName', size: 'note', color: GREY_A }).nextTo(b, 'up', LOOK.gap.label)
  const crewName = text('workers', { id: 'crewName', size: 'note', color: GREY_A }).nextTo(a, 'up', LOOK.gap.label)

  // the retry loop hangs under the queue: down from where jobs leave it, back under it, up into its tail
  const exit = queue.right, tail = queue.anchor('tail'), head = queue.anchor('head')
  const turn = () => [exit()[0], queue.bottom()[1] - LOOK.loop] // where the way back leaves the stem
  const corner = () => [tail()[0], turn()[1]]
  const entry = () => [tail()[0], queue.bottom()[1]]
  const rest = () => between(turn(), corner(), 0.5) // where a job waits out its backoff
  const stem = line(exit, turn, { id: 'stem', color: GREY_B, dashed: true, strokeWidth: LOOK.stroke.loop, buff: 0 })
  const under = line(turn, corner, { id: 'under', color: GREY_B, dashed: true, strokeWidth: LOOK.stroke.loop, buff: 0 })
  const back = arrow(corner, entry, { id: 'back', color: GREY_B, dashed: true, strokeWidth: LOOK.stroke.loop, buff: 0 })
  const loop = group([stem, under, back])
  const dead = node('dead letters', { id: 'dead', shape: 'queue', slots: 3, color: RED, labelAt: 'below', count: () => live().dead, countColor: RED }).nextTo(turn, 'down', LOOK.dead)
  const grave = arrow(turn, dead, { id: 'grave', color: GREY_B, strokeWidth: LOOK.stroke.loop })

  // moments of the run the story is cut at
  const victim = the(record.fails.find((entry) => entry.why === 'crash')) // the job the crashed worker was holding
  const poison = the(jobs.find((job) => job.poison))
  const blows = record.fails.filter((entry) => entry.why === 'poison') // the poison job's failures, in order
  const waitsOf = (id) => record.waits.filter((wait) => wait.job === id)
  const depthAt = (t) => the(record.depth.findLast(([at]) => at <= t))[1]
  const peak = Math.max(...record.depth.filter(([t]) => t < OPEN + RULES.at.crew).map(([, d]) => d))
  const firstDrop = the(record.depth.find(([, d], i) => i > 0 && record.depth[i - 1][1] === peak && d === peak - 1))[0]
  const SAMPLE = firstDrop + LOOK.settle // the line has stood at its first depth for a moment
  const batchDone = Math.max(...ends.filter((_, id) => !jobs[id].poison))
  const lastOfStream = jobs[TOTAL - 1 - RULES.batch.poison].legs[0].t0
  const outage = the(record.crash)

  // ── tokens: one dot per job, placed by the leg it is on ────────────────────────────────────────────────────────────
  const slotPoint = (u, from) => (u <= RULES.slots - 1
    ? between(head(), tail(), u / (RULES.slots - 1))
    : between(tail(), from === 'loop' ? entry() : edges['producer-queue'].end(), u - (RULES.slots - 1)))
  const place = {
    edge: (l, u) => edges[l.e].pointAt(l.back ? 1 - u : u)(),
    line: (l, u, t) => slotPoint(placeInLine(l, t), l.from),
    exit: (l, u, t) => { const left = l.u - LINE_SPEED * (t - l.t0); return left > 0 ? slotPoint(left, l.from) : between(head(), edges[`queue-${l.w}`].start(), -left / (LINE_SPEED * RULES.move.exit)) },
    enter: (l, u) => between(edges[`queue-${l.w}`].end(), g.nodes[l.w].center(), l.back ? 1 - u : u),
    serve: (l) => g.nodes[l.w].center(),
    stay: (l) => g.nodes[l.w].center(),
    leave: (l, u) => between(g.nodes[l.w].center(), edges[`${l.w}-db`].start(), u),
    stem: (l, u) => between(edges[`queue-${l.w}`].start(), turn(), u),
    side: (l, u) => (l.on ? between(rest(), corner(), u) : between(turn(), rest(), u)),
    wait: () => rest(),
    rise: (l, u) => between(corner(), entry(), u),
    drop: (l, u) => between(turn(), dead.anchor('head')(), u),
  }
  /** where a job is at time t, how visible, and which count it belongs to */
  const poseOf = (job, t) => {
    const legs = job.legs
    if (t < legs[0].t0) return { at: producer.center(), alpha: 0, group: 'unsent' }
    const final = last(legs)
    if (t >= final.t1) return job.fate === 'dead' ? { at: place.drop(final, 1), alpha: 1, group: 'dead' } : { at: db.center(), alpha: 0, group: 'done' }
    const l = legs.find((leg) => t < leg.t1)
    const alpha = Math.min(rise(t, legs[0].t0), l.last ? 1 - rise(t, l.t1 - LOOK.fade) : 1)
    return { at: place[l.k](l, (t - l.t0) / (l.t1 - l.t0), t), alpha, group: l.k === 'line' ? 'queued' : 'flight' }
  }
  const poses = s.signal(() => jobs.map((job) => poseOf(job, now())))
  const firstBlow = (id) => the(record.fails.find((entry) => entry.job === id))
  const lastBlow = (id) => the(record.fails.findLast((entry) => entry.job === id))
  const tint = (job) => (job.fate === 'dead' && now() >= lastBlow(job.id).t ? RED : BLUE) // a job that will not be tried again is red
  const dots = jobs.map((job) => circle({ id: `job${job.id}`, radius: LOOK.token, color: () => tint(job), fill: () => tint(job), fillOpacity: 1 })
    .at(() => poses()[job.id].at).opacity(() => poses()[job.id].alpha).z(LOOK.above).allow('TINY'))
  // a job that failed keeps a red core
  const cores = jobs.filter((job) => job.fails > 0).map((job) => circle({ id: `core${job.id}`, radius: LOOK.core, color: RED, fill: RED, fillOpacity: 1 })
    .at(() => poses()[job.id].at).opacity(() => poses()[job.id].alpha * rise(now(), firstBlow(job.id).t)).z(LOOK.above + 1).allow('TINY'))

  // the backoff: a gold ring round the waiting job that fills as the wait runs down, and one row per retry
  const waitNow = () => record.waits.find((wait) => now() >= wait.t0 - LOOK.fade && now() < wait.t1 + LOOK.fade)
  const ring = timer(() => { const wait = waitNow(); return wait ? clamp01((now() - wait.t0) / (wait.t1 - wait.t0)) : 0 }, { id: 'backoff', radius: LOOK.ring, color: GOLD })
    .at(rest).opacity(() => { const wait = waitNow(); return wait ? Math.min(rise(now(), wait.t0 - LOOK.fade), 1 - rise(now(), wait.t1)) : 0 }).z(LOOK.above - 1)
  // the rows show the retries of the job that failed last; they leave once that job is done
  const retrying = () => { const entry = record.fails.findLast((fail) => fail.t <= now()); return entry ? jobs[entry.job] : null }
  const retryOf = (n) => { const job = retrying(); return job ? waitsOf(job.id).find((wait) => wait.n === n) : undefined }
  const waited = (n) => { const wait = retryOf(n); return wait ? Math.max(0, Math.min(now(), wait.t1) - wait.t0) : 0 }
  const shown = (n) => {
    const job = retrying(), wait = retryOf(n)
    if (!job || !wait || now() < wait.t0) return 0
    return Math.min(rise(now(), wait.t0), 1 - rise(now(), job.fate === 'done' ? ends[job.id] + LOOK.rowsLinger : HORIZON))
  }
  const tries = Array.from({ length: RULES.retry.limit }, (_, i) => i + 1)
  const names = tries.map((n) => text(`retry ${n} of ${RULES.retry.limit}`, { id: `retry${n}`, size: 'note', color: GOLD }).opacity(() => shown(n)))
  const retries = column(names, { id: 'retries', gap: LOOK.gap.rows, align: 'left' }).nextTo(rest, 'down', LOOK.gap.underLoop).alignTo(producer, 'left')
  const bars = tries.flatMap((n) => {
    const from = () => [names[n - 1].right()[0] + LOOK.gap.bar, names[n - 1].center()[1]]
    const to = () => [from()[0] + LOOK.second * waited(n), from()[1]]
    return [
      line(from, to, { id: `wait${n}`, color: GOLD, strokeWidth: LOOK.stroke.wait, buff: 0 }).opacity(() => shown(n)),
      num(() => waited(n), { id: `seconds${n}`, decimals: 1, unit: ' s', size: 'note', color: GOLD, align: 'left' }).nextTo(to, 'right', LOOK.gap.seconds).opacity(() => shown(n)),
    ]
  })

  // ── the plot: the depth of the line against time, born from the waiting jobs ───────────────────────────────────────
  const P = LOOK.plot
  const plot = axes({ id: 'plot', x: [SAMPLE - P.lead, batchDone + P.tail], y: [0, RULES.slots], width: P.width, height: P.height, ticks: { x: false, y: 2 }, xLabel: 'time', color: GREY_C, tickLabelSize: 'note', labelSize: 'note' })
    .at(() => [right.center[0], queue.center()[1]])
  const plotTitle = text('queue depth', { id: 'plotTitle', size: 'label', color: GREY_A }).nextTo(plot, 'up', LOOK.gap.title)
  const until = () => Math.min(now(), batchDone + P.tail)
  /** the staircase of the depth from the sample to now */
  const stairs = () => {
    const points = [[SAMPLE, depthAt(SAMPLE)]]
    for (const [t, d] of record.depth) {
      if (t <= SAMPLE) continue
      if (t > until()) break
      points.push([t, last(points)[1]], [t, d])
    }
    points.push([Math.max(SAMPLE, until()), last(points)[1]])
    return points
  }
  const filled = plot.area(stairs, { id: 'depthArea', color: BLUE, fillOpacity: LOOK.wash.depth })
  const trace = plot.plot(stairs, { id: 'depth', color: BLUE, strokeWidth: LOOK.stroke.trace })
  const waiting = jobs.filter((job) => poseOf(job, SAMPLE).group === 'queued') // the jobs in line at the sample, head first
  const squares = waiting.map((job, i) => rect({ id: `square${i}`, width: LOOK.square, height: LOOK.square, color: BLUE, fill: BLUE, fillOpacity: 1 }))
  const stack = column([...squares].reverse(), { id: 'stack', gap: LOOK.gap.squares }).nextTo(queue, 'up', LOOK.gap.stack)
  const fused = rect({ id: 'fused', width: LOOK.square, height: () => stack.height(), color: BLUE, fill: BLUE, fillOpacity: 1 }).at(stack)
  const sample = rect({ id: 'sample', width: LOOK.bar, height: (P.height / RULES.slots) * waiting.length, color: BLUE, fill: BLUE, fillOpacity: 1 }).at(plot.toFrame(SAMPLE, waiting.length / 2))
  // the outage on the plot: a band from the crash to the recovery (or to now)
  const band = plot.area(() => [[outage.t, RULES.slots], [Math.max(outage.t, Math.min(now(), outage.until)), RULES.slots]], { id: 'band', color: RED, fillOpacity: LOOK.wash.outage })
  const bandEdge = plot.vline(outage.t, { id: 'bandEdge', color: RED, dashed: false, strokeWidth: LOOK.stroke.loop })
  const bandName = text('worker down', { id: 'bandName', size: 'note', color: RED }).nextTo(plot.toFrame(outage.t, RULES.slots), 'right', LOOK.gap.band[0]).shift(0, LOOK.gap.band[1])
  const depthPlot = [plot, plotTitle, filled, trace, sample, band, bandEdge, bandName]

  // ── the line of counts: in = done + queued + in flight + dead ──────────────────────────────────────────────────────
  /** one term: a live number over its name @param {() => number} value @param {string} name @param {string} color */
  const term = (value, name, color) => column([text(() => String(value()), { size: 'body', color }), text(name, { size: 'note', color: GREY_B })], { id: `count-${name.replace(' ', '-')}`, gap: LOOK.gap.name })
  const sign = (mark) => text(mark, { size: 'label', color: GREY_B })
  const count = { in: term(() => live().sent, 'in', WHITE), done: term(() => live().done, 'done', GREEN), queued: term(() => live().queued, 'queued', BLUE), flight: term(() => live().flight, 'in flight', BLUE), dead: term(() => live().dead, 'dead', RED) }
  const signs = [sign('='), sign('+'), sign('+'), sign('+')]
  const counts = row([count.in, signs[0], count.done, signs[1], count.queued, signs[2], count.flight, signs[3], count.dead], { id: 'counts', gap: LOOK.gap.terms, align: 'top' })
    .toEdge('up', LOOK.gap.top).alignTo(producer, 'left')
  const rule = line(() => [counts.left()[0], counts.bottom()[1] - LOOK.gap.rule], () => [counts.right()[0], counts.bottom()[1] - LOOK.gap.rule], { id: 'rule', color: WHITE, strokeWidth: LOOK.stroke.rule, buff: 0 })

  // ── the story: every cut is a moment of the run ────────────────────────────────────────────────────────────────────
  const PACE = LOOK.pace
  const flow = [g, workerName, crewName, loop, ...dots, ...cores, ring, retries, ...bars] // the diagram and what moves on it
  const everything = [...flow, dead, grave, ...depthPlot, stack, fused, counts, rule]
  let clock = 0 // s.t() at the story's cursor, as the plan has it
  let opens = false // the next step opens a chapter
  const cuts = [] // the plan: { from, to } of every step in simulation time, checked below
  const chapter = (title) => { s.chapter(title, { keep: everything }); opens = cuts.length > 0 }
  /** one step that ends when the simulation reaches `to`; build(st, play, wait) records it @param {string} title @param {number | null} to null = time stands still */
  const beat = (title, to, build) => s.step(title, (st) => {
    const from = clock, runs = to !== null
    if (runs && opens) clock += CHAPTER
    opens = false
    const play = (anim) => { st.play(anim); if (runs) clock += anim.duration }
    const wait = (t) => { if (t > clock) { st.wait(t - clock); clock = t } }
    if (!runs) st.clock({ freeze: true })
    build(st, play, wait)
    if (runs) { wait(to - HOLD); clock += HOLD }
    cuts.push({ from, to: clock })
  })

  chapter('One job')
  beat('One job', OPEN + RULES.at.burst + CUT.burst, (st, play) => {
    st.say('One job leaves the [producer](producer), passes through the [queue](queue), and a [worker](b) gets it done.')
    st.zoom(flowCentre, { zoom: FRAME_W / (LOOK.graph.width + 2 * LOOK.margin), duration: 0 }) // close on the one row there is
    play(timed(lagged([create(producer), growArrow(edges['producer-queue']), create(queue), growArrow(edges['queue-b']), all(create(b), write(workerName)), growArrow(edges['b-db']), create(db)], { lag: PACE.lag }), { duration: OPEN }))
  })
  beat('A line forms', SAMPLE, (st) => {
    st.say('Send jobs faster than they get done, and a [line](queue) forms.')
  })

  beat('Stack the line', null, (st, play) => {
    st.say('Stack the waiting jobs, and you have the [depth](stack) of the queue.')
    play(lagged(waiting.map((job, i) => derive(dots[job.id], squares[i], { duration: PACE.lift })), { lag: PACE.liftLag }))
    st.zoom(null, { duration: PACE.easeOut }) // the camera eases out and makes room for the plot
    st.wait(PACE.beforeAxes)
    play(all(create(plot), write(plotTitle)))
    play(transform(stack, fused, { duration: PACE.fuse })) // the squares fuse into one bar,
    play(transform(fused, sample, { duration: PACE.carry, pathArc: LOOK.carry })) // which is carried over the diagram to its place on the time axis
  })

  chapter('Queue depth')
  beat('Depth over time', OPEN + RULES.at.crew + CUT.crew, (st, play) => {
    st.say('Follow that [number](sample) over time, and you watch the line shrink.')
    play(all(fadeIn(filled, { duration: PACE.trace }), fadeIn(trace, { duration: PACE.trace })))
  })

  beat('Two more workers', OPEN + RULES.at.stream + CUT.stream, (st, play) => {
    st.say('Add two more [workers](a), and the line clears.')
    play(lagged([transform(workerName, crewName), create(a), create(c), growArrow(edges['queue-a']), growArrow(edges['queue-c']), growArrow(edges['a-db']), growArrow(edges['c-db'])], { lag: PACE.crewLag }))
  })
  beat('A steady stream', victim.t + CUT.crash, (st) => {
    st.say('Now a steady stream of jobs flows straight through.')
  })

  chapter('A worker crashes')
  const victimWait = waitsOf(victim.job)[0]
  beat('The crash', victimWait.t1 + CUT.waited, (st, play, wait) => {
    st.say('When a [worker](c) crashes, its job goes back and [waits](stem).')
    wait(victim.t + RULES.move.linger)
    play(create(loop, { duration: RULES.move.hop + RULES.move.arrow + RULES.move.stem }))
  })
  beat('A healthy worker', ends[victim.job] + CUT.done, (st) => {
    st.say('Then it rejoins the [line](queue), and a healthy worker finishes it.')
  })
  beat('Two cannot keep up', outage.until + CUT.recovery, (st, play) => {
    st.say("Meanwhile, two workers can't keep up, so the [line grows](depth).")
    play(derive(c, bandEdge, { duration: PACE.mark }))
    play(all(fadeIn(band, { duration: PACE.band }), write(bandName)))
  })
  beat('Recovery', lastOfStream + CUT.batchSent, (st) => {
    st.say('The [worker](c) comes back, and the line stops growing.')
  })
  beat('Every job counted', poison.legs[0].t0 + CUT.poison, (st, play) => {
    st.say('The batch ends, and every job stays [accounted for](counts) as the backlog clears.')
    // each count leaves the place it was kept: the producer's, the database's, the queue's, and the jobs under way themselves
    const lag = PACE.termLag, flying = jobs.filter((job) => poseOf(job, clock + 3 * lag).group === 'flight') // the jobs under way when the fourth term starts
    play(lagged([derive(producer.center, count.in), derive(db.center, count.done), derive(queue.top, count.queued), all(...flying.map((job) => derive(dots[job.id], count.flight)))], { lag }))
    play(lagged(signs.slice(0, 3).map((mark) => write(mark)), { lag: PACE.signLag }))
  })

  chapter('A poison job')
  const pause = waitsOf(poison.id)
  beat('It fails', pause[1].t0 + CUT.secondWait, (st) => {
    st.say(`The last job fails too, but this time the [worker](${blows[0].worker}) is fine.`)
    st.focus(...flow, counts)
  })
  beat('Twice as long', pause[2].t0 + CUT.thirdWait, (st) => {
    st.say('The next worker fails too, and now it waits [twice as long](wait2).')
    st.focus(...flow, counts)
  })
  beat('And again', pause[2].t0 + CUT.thirdRuns, (st) => {
    st.say('It fails a third time, and the wait [doubles](wait3) again.')
    st.focus(...flow, counts)
  })
  beat('Somewhere to go', pause[2].t1 + CUT.lastTry, (st, play) => {
    st.say('A job that keeps failing needs [somewhere to go](dead).')
    st.focus(...flow, counts, dead, grave)
    play(lagged([growArrow(grave), create(dead)], { lag: PACE.deadLag }))
    play(all(derive(dead, count.dead), write(signs[3])))
  })
  beat('Set aside', END + CUT.dead, (st) => {
    st.say('After three retries it is set aside as a [dead letter](dead).')
    st.focus(...flow, counts, dead, grave)
  })
  beat('Nothing is lost', END + CUT.dead + CUT.close, (st, play) => {
    st.say('And every job is still [accounted for](counts).')
    st.focus(counts, rule)
    play(create(rule))
  })

  // ── what must hold, for `mimir check` ──────────────────────────────────────────────────────────────────────────────
  const tally = (name) => poses().filter((pose) => pose.group === name).length // counted from where the tokens are, not from the counters
  s.probe('in', () => live().sent)
  s.probe('done', () => live().done)
  s.probe('queued', () => live().queued)
  s.probe('inFlight', () => live().flight)
  s.probe('dead', () => live().dead)
  s.probe('ledger', () => live().sent - live().done - live().queued - live().flight - live().dead) // 0 at every instant
  s.probe('clock', now)
  s.expect('in = done + queued + in flight + dead', () => live().sent === live().done + live().queued + live().flight + live().dead)
  s.expect('the counts are the tokens on screen', () => tally('queued') === live().queued && tally('flight') === live().flight && tally('done') === live().done && tally('dead') === live().dead)
  s.expect('no job jumps: every token moves less than the speed limit allows', () => jobs.every((job) => {
    const here = poseOf(job, now()), before = poseOf(job, now() - LOOK.tick)
    return here.alpha === 0 || before.alpha === 0 || Math.hypot(here.at[0] - before.at[0], here.at[1] - before.at[1]) <= LOOK.speedLimit * LOOK.tick
  }))
  s.expect('the line never outgrows its slots', () => live().queued <= RULES.slots)
  s.expect('the crashed job is done on its first retry', () => jobs[victim.job].fails === 1 && jobs[victim.job].fate === 'done')
  s.expect('the poison job fails on every worker and is the only dead letter', () => new Set(blows.map((blow) => blow.worker)).size === RULES.workers.length && record.dead === 1 && poison.fate === 'dead')
  s.expect('each backoff is twice the one before', () => pause.every((wait, i) => Math.abs(wait.t1 - wait.t0 - RULES.retry.backoff * RULES.retry.factor ** i) < 1e-9))
  cuts.forEach((cut, i) => expect.during(i + 1, () => now() >= cut.from - 1e-6 && now() <= cut.to + 1e-6)) // the story's cuts are the simulation's moments
})
