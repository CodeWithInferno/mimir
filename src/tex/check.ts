// Check rules of formulas (lazy check chunk). What is wrong with a formula is found where the formula is laid out
// (src/tex/tex.chunk.ts: a source that does not parse, a face that was not loaded with the scene) and recorded on
// the model; these rules forward it, so `mimir check` reports it. A part or a colour key the formula does not have
// is REF-MISSING, which the core's own rule forwards.
import { defineRule } from '../core/index.ts'

for (const code of ['TEX-INVALID', 'TEX-FONT']) {
  defineRule({
    code, phase: 'static', severity: code === 'TEX-FONT' ? 'warn' : 'error',
    run(c) { for (const d of c.model.diagnostics.byCode(code)) c.report({ what: d.what, fix: d.fix, ids: d.ids, severity: d.severity, step: d.step, t: d.t, line: d.line, file: d.file }) },
  })
}
