// src/sim/check.ts: SIM-UNSTABLE (lazy check chunk). Two sources: what the simulations reported while frames were
// evaluated (a state that became non-finite), and a measurement: every ode() is solved again with half its step at
// the end of each step of the story and at each param extreme the plan samples; a result that moves by more than the
// tolerance is not converged, so what the scene shows is an artefact of the step size.
import { defineRule } from '../core/index.ts'
import { simsOf } from './index.ts'

const pct = (x: number): string => (x >= 0.1 ? String(Math.round(x * 100)) : (x * 100).toFixed(1))
const trim = (x: number): string => String(Number(x.toPrecision(3)))

defineRule({
  code: 'SIM-UNSTABLE', severity: 'warn', phase: 'story',
  run(c) {
    for (const d of c.model.diagnostics.byCode('SIM-UNSTABLE')) c.report({ what: d.what, fix: d.fix, ids: d.ids, measured: d.measured, limit: d.limit, severity: d.severity, step: d.step, t: d.t, line: d.line, file: d.file, params: d.params })
    const sims = simsOf(c.model)
    if (!sims.length) return
    const worst = new Map<number, { share: number; t: number; step: number | null; clause: string; params: Record<string, number | boolean | string>; hint: string[] }>()
    for (const s of c.samples) {
      if (s.kind !== 'step-end' && s.kind !== 'param') continue
      const frame = c.stateAt(s.tau, s.params)
      sims.forEach((sim, i) => {
        const m = sim.drift(frame)
        if (!m || !(m.share > sim.tolerance)) return
        const cur = worst.get(i)
        if (!cur || m.share > cur.share) worst.set(i, { share: m.share, t: m.t, step: s.step, clause: frame.paramClause(), params: { ...frame.overrides }, hint: frame.reproHint() })
      })
    }
    for (const [i, w] of worst) {
      const sim = sims[i]!
      // one that already blew up has said so, with the same fix
      if (c.model.diagnostics.byCode('SIM-UNSTABLE').some((d) => d.line === sim.src.line && d.line !== null)) continue
      c.report({
        severity: 'warn', step: w.step, t: null, line: sim.src.line, file: sim.src.file ?? undefined, measured: `${pct(w.share)}%`, limit: `${pct(sim.tolerance)}%`,
        what: `${sim.call} at line ${sim.src.line ?? '?'} is not converged: at t=${trim(w.t)}s its state moves by ${pct(w.share)}% of its size when the step is halved (dt = ${trim(sim.dt)} s, limit ${pct(sim.tolerance)}%)${w.clause ? ` ${w.clause}` : ''}.`,
        fix: [`use a smaller step: dt: ${trim(sim.dt / 4)}`, 'or slow the system down (less stiffness, more damping) so the step resolves its fastest motion', ...w.hint],
        ...(w.clause ? { params: w.params } : {}),
      })
    }
  },
})
