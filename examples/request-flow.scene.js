// request-flow: how a request finds its answer, and what happens when a server dies.
// Nothing is positioned by hand: graph() lays the system out, traffic() runs a seeded simulation over it, and every
// number on screen is read from that simulation (so the counts add up at every instant, and `check` proves it).
import { scene, graph, traffic, text, row, column, fadeIn, lagged, GREEN, BLUE, WHITE, GREY_B, GREY_C } from 'mimir'

export default scene({ title: 'How a request finds its answer' }, (s) => {
  // ── the system ─────────────────────────────────────────────────────────────────────────────────────
  const g = graph({
    nodes: {
      client: 'client',
      balancer: { label: 'load balancer', shape: 'queue', slots: 5 }, // requests wait in its slots while every server is busy
      a: { label: 'server A', shape: 'ring' }, // the ring fills while the server works on a request
      b: { label: 'server B', shape: 'ring' },
      cache: 'cache',
      db: { label: 'database', shape: 'cylinder' },
    },
    edges: [
      ['client', 'balancer'],
      ['balancer', 'a'], ['balancer', 'b'],
      ['a', 'cache'], ['b', 'cache'],
      ['cache', 'db', { label: 'miss' }],
    ],
  }).at(0, 0.7)
  const { a, b, cache, db } = g.nodes

  // ── the traffic ────────────────────────────────────────────────────────────────────────────────────
  // Rules, not keyframes: a request appears every 0.9 to 1.4 s; the balancer hands the head of its line to the server
  // that has been idle longest; a server takes 0.7 to 1.1 s; the cache answers 65% of the requests itself (a hit) and
  // passes the rest on to the database (a miss). A request whose server dies goes back, waits 1 s and is sent again.
  const sim = traffic(g, {
    seed: 11,
    sources: { client: { every: [0.9, 1.4] } },
    stations: {
      a: { service: [0.7, 1.1] },
      b: { service: [0.7, 1.1] },
      cache: { service: 0.25, workers: 4, absorb: 0.65 },
    },
    travel: 0.7,
  })
  const sent = sim.count('sent'), hits = sim.count('done', cache), reads = sim.count('done', db)
  const underway = () => sim.count('queued')() + sim.count('inFlight')() + sim.count('dead')()

  // the line of counts: sent = answered by the cache + answered by the database + still under way
  /** one term: a live number over its name. @param {() => number} value @param {string} name @param {string} color */
  const term = (value, name, color) => column([text(() => String(value()), { size: 'label', color }), text(name, { size: 'tiny', color: GREY_C })], { gap: 0.14 })
  /** @param {string} mark */
  const sign = (mark) => text(mark, { size: 'label', color: GREY_B })
  const terms = [term(sent, 'sent', WHITE), sign('='), term(hits, 'cache hits', GREEN), sign('+'), term(reads, 'database reads', GREEN), sign('+'), term(underway, 'under way', BLUE)]
  row(terms, { gap: 0.4, align: 'top' }).at(0, -2.35)

  s.probe('sent', sent)
  s.probe('hits', hits)
  s.probe('reads', reads)
  s.probe('underway', underway)
  s.probe('ledger', () => sent() - hits() - reads() - underway()) // 0 at every instant
  s.probe('waitingAtBalancer', sim.count('waiting', 'balancer'))
  s.probe('servedByA', sim.count('busy', a))
  s.probe('servedByB', sim.count('busy', b))

  // ── the story ──────────────────────────────────────────────────────────────────────────────────────
  s.step('The parts', (st) => {
    st.say('A [client](client), a [load balancer](balancer) and two [servers](ring:a+b).')
    st.say('Behind them, a [cache](cache) and a [database](db).')
    st.play(g.draw())
  })

  s.step('Requests', (st) => {
    st.say('Every request goes to the [balancer](balancer), which hands it to whichever server has been idle longest.')
    st.play(fadeIn(sim)) // the simulation's clock starts here
    st.wait(6)
  })

  s.step('Hit or miss', (st) => {
    st.say('A server asks the [cache](cache) first. Most answers are already there. Only a miss goes on to the [database](db).')
    st.play(lagged(terms.map((part) => fadeIn(part, { shift: [0, 0.15] })), { lag: 0.15 }))
    st.wait(6)
  })

  s.step('A server dies', (st) => {
    st.say('Then [server B](b) dies. The request it was working on goes back, waits a moment, and is sent again.')
    b.down() // from this moment the balancer sends nothing to B, and what B held fails
    st.wait(7)
  })

  s.step('Traffic shifts', (st) => {
    st.say('Everything now goes through [server A](a), so a line forms at the [balancer](balancer).')
    st.wait(7)
  })

  s.step('Recovery', (st) => {
    st.say('When B comes back the line drains. Nothing was lost: the counts still add up.')
    b.down(false)
    st.wait(8)
  })
})
