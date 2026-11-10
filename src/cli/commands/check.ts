// mimir check <scene> [--json] [--all]
import type { CheckOptions } from '../args.ts'
import { buildCheckResult, fatalToDiag, formatCheckJson, formatCheckText, normalizeDiag, type CheckResult, type Diag, type FileContext, type StepInfo } from '../format.ts'
import type { Io } from '../io.ts'
import { ensureViewer, resolveScene, type SceneRef } from '../paths.ts'
import { openSession } from '../session.ts'

/** Run the scene headless and collect its diagnostics. `shown` is how the author named the scene (for the fixes that quote a command). */
export async function checkScene(scene: SceneRef, shown: string, all: boolean, io: Io, describe = false): Promise<{ result: CheckResult; steps: StepInfo[]; account: string | null }> {
  const viewer = await ensureViewer(io.env, io.log)
  const session = await openSession({ scene, viewerRoot: viewer.dir, width: 1280, height: 720, scale: 1, log: io.log })
  let diags: Diag[]
  let account: string | null = null
  try {
    if (session.info.fatal) {
      diags = [fatalToDiag(session.info.fatal, scene.url)]
    } else {
      const raw = await session.host<unknown>('diagnostics', { sample: true })
      // the page does not know what the author typed: a fix that names a command names this scene
      diags = (Array.isArray(raw) ? raw : []).map(normalizeDiag).map((d) => ({ ...d, fix: d.fix.map((f) => f.replace('mimir shot <scene>', `mimir shot ${shown}`)) }))
      // the account of an explain() scene is a manifest of the page (session.info is a filtered subset)
      if (describe) account = (await session.host<{ quick?: { describe?: string } | null }>('info'))?.quick?.describe ?? null
    }
  } finally {
    await session.close()
  }
  const result = buildCheckResult(diags, all)
  // a result from the last good build is not a result about the current sources: say so where the caller reads (stdout)
  if (viewer.stale) { result.stale = true; result.build_error = viewer.stale }
  return { result, steps: session.info.steps, account }
}

export async function check(opts: CheckOptions, io: Io): Promise<number> {
  const scene = resolveScene(opts.scene, io.cwd, 'check')
  const { result, steps, account } = await checkScene(scene, opts.scene, opts.all, io, opts.describe)
  const ctx: FileContext = { sceneDir: scene.dir, cwd: io.cwd }
  if (io.json) io.out(opts.describe ? JSON.stringify({ ...JSON.parse(formatCheckJson(result, ctx)), describe: account }) + '\n' : formatCheckJson(result, ctx))
  else io.out(formatCheckText(result, steps, ctx) + (opts.describe ? `\n${account ?? '(not an explain() scene: there is no account to print)'}\n` : ''))
  return result.ok ? 0 : 1
}
