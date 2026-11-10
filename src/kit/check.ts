// src/kit/check.ts: the rule of the mechanisms (lazy check chunk). MECH-OPEN: a mechanism whose parts do not
// close. Each mechanism declares its own invariants (./mechanisms.ts); the rule measures them on the world transforms
// of every sample of the plan: step ends, the middle of every move, each slider at its extremes and 8 phases of a
// cyclic param. Pure maths, so it reports the same with and without a browser.
import { defineRule } from '../core/index.ts'
import { mechanismsOf } from './mechanisms.ts'

defineRule({
  code: 'MECH-OPEN',
  severity: 'error',
  phase: 'sample',
  pure: true,
  on: ['step-end', 'transition', 'param', 'phase'],
  run(c) {
    const frame = c.frame
    if (!frame) return
    for (const mech of mechanismsOf(c.model)) {
      for (const inv of mech.invariants) {
        const measured = inv.measure(frame)
        if (!(measured > inv.limit)) continue // NaN is NUM-INVALID's to report, at the part that produced it
        c.report({ ids: mech.parts.map((p) => p.id), line: mech.src.line, file: mech.src.file ?? undefined, measured: Math.round(measured * 1e6) / 1e6, limit: inv.limit, what: inv.what(measured), fix: inv.fix })
      }
    }
  },
})
