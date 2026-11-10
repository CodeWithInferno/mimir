// Check rules of the diagram module (lazy check chunk).
import { defineRule } from '../core/index.ts'
import { clusterBox, graphGeom, storeOf, trafficView } from './index.ts'

/**
 * Every job of a traffic simulation is somewhere: sent = done + dead + queued + in flight, and the number of jobs
 * the histories say are alive equals queued + in flight. The simulation keeps this by construction; the rule is
 * there to catch the day it does not.
 */
defineRule({
  code: 'TRAFFIC-COUNT',
  severity: 'error',
  phase: 'sample',
  on: ['step-end', 'transition', 'param'],
  run(c) {
    if (!c.frame) return
    for (const n of c.model.nodes) {
      if (n.kind !== 'traffic' || !c.frame.visible(n)) continue
      const v = c.frame.run(() => trafficView(n, c.frame!))
      const k = v.counts
      const balance = k.sent - k.done - k.dead - k.queued - k.inFlight
      if (balance !== 0) c.report({ ids: [n.id], line: n.src.line, measured: balance, limit: 0, what: `the counts of #${n.id} do not add up at t = ${v.t.toFixed(2)} s: ${k.sent} sent, but ${k.done} done + ${k.dead} dead + ${k.queued} queued + ${k.inFlight} in flight = ${k.sent - balance}.`, fix: ['this is a defect of the traffic simulation, not of the scene: report it with the scene file'] })
      else if (v.live !== k.queued + k.inFlight) c.report({ ids: [n.id], line: n.src.line, measured: v.live, limit: k.queued + k.inFlight, what: `#${n.id} has ${v.live} jobs alive at t = ${v.t.toFixed(2)} s, but counts ${k.queued} queued + ${k.inFlight} in flight.`, fix: ['this is a defect of the traffic simulation, not of the scene: report it with the scene file'] })
    }
  },
})

/** A graph that had to be shrunk to fit its box is hard to read: its text shrinks with it. */
defineRule({
  code: 'GRAPH-SHRUNK',
  severity: 'warn',
  phase: 'sample',
  on: ['step-end'],
  run(c) {
    if (!c.frame || !c.runtime) return
    for (const [uid, rec] of storeOf(c.model).graphs) {
      const g = c.model.nodes.find((n) => n.uid === uid)
      if (!g || !c.frame.visible(g)) continue
      const lay = c.frame.run(() => graphGeom(g, c.frame!))
      // a graph whose box was chosen for the author (a block of explain()) says so with allow('GRAPH-SHRUNK'); TEXT-TINY still guards its labels
      if (lay.scale >= 0.8 || (c as { allowed?: (code: string, a: unknown) => boolean }).allowed?.('GRAPH-SHRUNK', g)) continue
      c.report({ ids: [g.id], line: g.src.line, measured: Math.round(lay.scale * 100), limit: 80, what: `the graph #${g.id} (${rec.members.length} nodes) is drawn at ${Math.round(lay.scale * 100)}% of its size to fit ${c.frame.prop<number>(g, 'width')} × ${c.frame.prop<number>(g, 'height')} units, so its labels are small (limit 80%).`, fix: [rec.direction === 'right' ? "lay it out the other way: direction: 'down'" : "lay it out the other way: direction: 'right'", 'shorten the labels, or show the graph in two steps with fewer nodes each', 'or give it a larger box: width / height'] })
    }
  },
})

/** A group box is drawn round its nodes wherever the layout put them: a node that is not in the group may end up inside the box. */
defineRule({
  code: 'GROUP-COVERS',
  severity: 'warn',
  phase: 'sample',
  on: ['step-end'],
  run(c) {
    const f = c.frame
    if (!f) return
    for (const rec of storeOf(c.model).graphs.values()) for (const box of rec.groups) {
      if (!f.visible(box)) continue
      const own = storeOf(c.model).clusters.get(box.uid) ?? []
      const b = f.run(() => clusterBox(box, f)), sh = f.world(box).p
      for (const m of rec.members) {
        if (own.includes(m) || !f.visible(m)) continue
        const o = f.bounds(m)
        if (o.max[0] <= b.min[0] + sh[0] || o.min[0] >= b.max[0] + sh[0] || o.max[1] <= b.min[1] + sh[1] || o.min[1] >= b.max[1] + sh[1]) continue
        c.report({ ids: [box.id, m.id], line: box.src.line, what: `the group box #${box.id} covers #${m.id}, which is not one of its nodes: the layout placed it between them.`, fix: [`add '${m.id}' to the group`, `or declare #${m.id} before or after the group's nodes in graph({ nodes }), so that it is laid out beside them`, 'or leave the group out'] })
      }
    }
  },
})
