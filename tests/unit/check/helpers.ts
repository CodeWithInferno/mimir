// Shared by the check tests: build a scene with every seed module and the check rules registered, run the engine
// without a browser (the pure rules: solids, declarations, story), and read the result.
import '../../../src/r2d/index.ts'
import '../../../src/r3d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/index.ts'
import '../../../src/check/check.ts'
import { runCheck, type CheckStats } from '../../../src/check/engine.ts'
import { compile, scene, type Diag, type SceneModel } from '../../../src/core/index.ts'

export const build = (fn: (s: any) => void, title = 'check'): SceneModel => compile(scene({ title }, fn))
export async function check(fn: (s: any) => void, rules?: string[]): Promise<{ diags: Diag[]; stats: CheckStats; model: SceneModel; codes: string[]; of(code: string): Diag[] }> {
  const model = build(fn)
  const out = await runCheck(null, rules ? { rules } : {}, model)
  return { diags: out, stats: out.stats!, model, codes: out.map((d) => `${d.code} ${d.severity}`), of: (code) => out.filter((d) => d.code === code) }
}
