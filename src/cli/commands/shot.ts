// mimir shot <scene> [--steps | --step 2 | --at 1.5,3 | --at crank=90 | --cues | --fine 2:4:12] [--set name=value ...]
//                    [--views iso,front | --turntable] [--sheet] [--cols n] [--debug ids] [--size 1280x720] [--scale 1] [--out dir]
//
// Made for an agent's eyes: one browser, one page, one round trip per frame; a story sheet that costs about a
// thousand tokens to look at; a probes JSON beside every frame and a manifest with a sha256 per file.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ParamValue, ShotOptions } from '../args.ts'
import { Composer } from '../compose.ts'
import { CliError, UsageError, suggest } from '../errors.ts'
import { fatalToDiag, formatDiagText, formatSeconds, type SceneInfo } from '../format.ts'
import type { Io } from '../io.ts'
import {
  SHEET_MAX_HEIGHT, SHEET_MAX_WIDTH, STRIP_MIN_CELL, formatManifestText, frameFileStem, groupByChapter, imageTokens, legendColor, legendHtml, planFrames,
  sha256Hex, storyCues, storyHtml, storyLayout, turntableAngles, turntableName,
  type FramePlan, type LegendItem, type ManifestEntry, type SheetCell,
} from '../manifest.ts'
import { frameExpression, type ViewSpec } from '../pageside.ts'
import { checkSets, resolveParamTime, setProblem } from '../params.ts'
import { ensureViewer, resolveScene } from '../paths.ts'
import { pngSize } from '../png.ts'
import { openSession, timeoutFromEnv, type Session } from '../session.ts'

export { frameExpression, setProblem }

const MANIFEST_FILE = 'manifest.json'

/** The file name of a sheet, by what it shows: a later run of another kind never replaces it. */
export const SHEET_NAMES = { story: 'sheet', cues: 'cues', film: 'film' } as const
export function sheetBase(mode: ShotOptions['mode']['kind']): string {
  return mode === 'cues' ? SHEET_NAMES.cues : mode === 'fine' ? SHEET_NAMES.film : SHEET_NAMES.story
}

/**
 * Remove what a previous run of the same kind wrote into this directory: the frames its manifest lists, and the
 * sheets of the kind this run writes (`base`). A sheet of another kind stays: `--cues` and then `--step 5` used to
 * delete the cue sheet before anybody had looked at it.
 */
function removePreviousRun(outDir: string, base: string): void {
  const ownSheet = new RegExp(`^${base}(-\\d+)?(\\.debug-[a-z]+)?\\.png$`)
  try {
    for (const name of readdirSync(outDir)) if (ownSheet.test(name)) rmSync(join(outDir, name), { force: true })
  } catch { /* no directory yet */ }
  let prev: unknown
  try {
    prev = JSON.parse(readFileSync(join(outDir, MANIFEST_FILE), 'utf8'))
  } catch {
    return
  }
  if (!Array.isArray(prev)) return
  for (const e of prev) {
    const p = e !== null && typeof e === 'object' ? (e as { path?: unknown }).path : null
    if (typeof p !== 'string' || !p.endsWith('.png') || !resolve(p).startsWith(resolve(outDir) + sep)) continue
    // a sheet is removed only by a run that writes that kind of sheet again (above)
    if ((e as { sheet?: unknown }).sheet !== undefined) continue
    rmSync(p, { force: true })
    rmSync(p.replace(/\.png$/, '.probes.json'), { force: true })
  }
}

/** A path as an agent should read it: relative to the working directory when it is inside it. */
export function shownPath(path: string, cwd: string): string {
  const rel = relative(cwd, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : path
}

/**
 * The manifest as compact text (the default on stdout; --json prints the full records with sha256): the directory
 * once, then one line per file with its name only, the sheet last with what it costs to look at.
 */
export function formatManifestCompact(entries: readonly ManifestEntry[], outDir: string, cwd: string): string {
  const inside = (p: string): string => { const rel = relative(outDir, p); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : shownPath(p, cwd) }
  const text = formatManifestText(entries.map((e) => ({ ...e, path: inside(e.path) })))
  const lines = text.split('\n').filter((l) => l !== '').map((l, i) => { const e = entries[i]!; return e.sheet ? `${l}  (about ${e.sheet.tokens ?? imageTokens(e.width, e.height)} tokens to look at)` : l })
  return `in ${shownPath(outDir, cwd)}/\n${lines.join('\n')}\n`
}

interface FrameState {
  probes: Record<string, number>
  params: Record<string, ParamValue>
  /** only asked for with --debug ids: the parts on screen, or null when this viewer cannot be measured */
  legend?: Array<{ index: number; id: string; space: string; rect: LegendItem['rect']; at: LegendItem['at'] }> | null
}

/** The views every frame is rendered from: the scene's own camera, named views, or the angles of a turntable. */
export function viewList(opts: Pick<ShotOptions, 'views' | 'turntable'>): Array<{ name: string | null; spec: ViewSpec }> {
  if (opts.turntable !== null) return turntableAngles(opts.turntable).map((azimuth) => ({ name: turntableName(azimuth), spec: { azimuth } }))
  if (opts.views.length) return opts.views.map((v) => ({ name: v, spec: v }))
  return [{ name: null, spec: null }]
}

/** Views are checked against what the viewer lists, so a misspelt one fails here instead of rendering the default camera. */
export function checkViews(info: SceneInfo, opts: Pick<ShotOptions, 'views' | 'turntable'>, command: string): void {
  if (info.views !== null) {
    for (const v of opts.views) {
      if (info.views.includes(v)) continue
      const near = suggest(v, info.views)
      throw new UsageError(`--views ${v}: no such view` + (near.length ? `; did you mean ${near.join(', ')}?` : '') + ` (views: ${info.views.join(', ') || 'none'})`, command)
    }
  }
  if (info.has3d === false && (opts.turntable !== null || opts.views.length)) {
    throw new UsageError(`${opts.turntable !== null ? '--turntable' : '--views'}: this scene has no 3D panel, so there is no camera to move`, command)
  }
}

function cellOf(plan: FramePlan, src: string, view: string | null): SheetCell {
  const base: SheetCell = { src, step: plan.step, title: plan.title, t: plan.t, view, chapter: plan.chapter ?? null }
  if (plan.cue) return { ...base, badge: String(plan.cue.index), label: `${plan.cue.verb} ${plan.cue.targets.join('+')}${plan.cue.words ? ` · “${plan.cue.words}”` : ''}` }
  if (plan.param) return { ...base, label: `${plan.param.name} = ${String(plan.param.value)} · ${plan.title}` }
  return base
}

/** Render one frame: seek, wait for the settled picture, screenshot. */
async function capture(session: Session, plan: FramePlan, opts: ShotOptions, view: { name: string | null; spec: ViewSpec }, legend: boolean): Promise<{ png: Uint8Array; state: FrameState }> {
  const timeoutMs = timeoutFromEnv()
  let raw: string
  try {
    raw = await session.page.evaluate<string>(frameExpression(plan.t, opts.sets, view.spec, { legend }), timeoutMs)
  } catch (e) {
    throw new CliError(`rendering t=${formatSeconds(plan.t)}s${view.name ? ` (view ${view.name})` : ''} failed: ${(e as Error).message}`)
  }
  const png = await session.page.screenshot(timeoutMs)
  return { png, state: JSON.parse(raw) as FrameState }
}

export async function shot(opts: ShotOptions, io: Io): Promise<number> {
  const scene = resolveScene(opts.scene, io.cwd, 'shot')
  const viewer = await ensureViewer(io.env, io.log)
  const outDir = opts.out !== null ? resolve(io.cwd, opts.out) : join(io.cwd, '.mimir', 'shots', scene.name)
  const { width, height } = opts.size
  const session = await openSession({ scene, viewerRoot: viewer.dir, width, height, scale: opts.scale, log: io.log })
  const composer = new Composer(session)
  const entries: ManifestEntry[] = []
  const stale = viewer.stale ? { stale: true as const } : {}
  try {
    const info = session.info
    if (info.fatal) {
      process.stderr.write(formatDiagText(fatalToDiag(info.fatal, scene.url), [], { sceneDir: scene.dir, cwd: io.cwd }) + '\n')
      io.log('nothing rendered: the scene failed to load (see mimir check)')
      if (io.json) io.out('[]\n')
      return 1
    }
    // a value the slider could never have is a typo, not a picture (the host would ignore or misread it silently)
    checkSets(info, opts.sets, 'shot')
    // --at name=value: the page finds the moment the story has the parameter there
    const times = new Map<string, number>()
    if (opts.mode.kind === 'at') {
      for (const item of opts.mode.items) {
        if (item.kind === 'param') times.set(`${item.name}=${String(item.value)}`, await resolveParamTime(session, info, item, opts.sets, 'shot'))
      }
    }
    // a filmstrip that runs past the end stops at the end (the author had to guess the times): say so, do not refuse
    let mode = opts.mode
    if (mode.kind === 'fine' && mode.t1 > info.duration && mode.t0 < info.duration) {
      io.log(`--fine: the story ends at ${formatSeconds(info.duration)} s; the strip stops there instead of ${formatSeconds(mode.t1)} s`)
      mode = { ...mode, t1: info.duration }
    }
    const plans = planFrames(info, mode, (item) => times.get(`${item.name}=${String(item.value)}`) ?? 0)
    if (opts.mode.kind === 'cues' && storyCues(info).from === 'cli') io.log('cue times are scheduled by the CLI from the narration text (the viewer does not report its cues)')
    // a frame of a scene with errors shows red placeholders: say so here, the frame alone does not
    if (info.problems && info.problems.errors > 0) io.log(`warning: the scene has ${info.problems.errors} error${info.problems.errors === 1 ? '' : 's'}; these frames show what could still be built. Run: mimir check ${opts.scene}`)
    checkViews(info, opts, 'shot')

    mkdirSync(outDir, { recursive: true })
    removePreviousRun(outDir, sheetBase(opts.mode.kind))
    // --debug ids is drawn by the CLI when the parts can be measured (a colour per part + a legend); the viewer's
    // own overlay is the fallback, and what --debug boxes / safe always use
    let legendMode = opts.debug === 'ids'
    if (opts.debug !== null && !legendMode) await session.host('debug', opts.debug)

    const started = performance.now()
    const views = viewList(opts)
    const cells: SheetCell[] = []
    const frames: Uint8Array[] = []
    let frameSize: { width: number; height: number } | null = null
    for (const plan of plans) {
      for (const view of views) {
        let { png, state } = await capture(session, plan, opts, view, legendMode)
        let legend: LegendItem[] | null = null
        if (legendMode && !state.legend) {
          // this viewer cannot be measured from outside: its own ids overlay is all there is
          legendMode = false
          io.log('--debug ids: this viewer does not expose its parts to measure; using its own overlay (no legend)')
          await session.host('debug', 'ids')
          ;({ png, state } = await capture(session, plan, opts, view, false))
        } else if (legendMode && state.legend) {
          legend = state.legend.map((l) => ({ n: l.index + 1, id: l.id, color: legendColor(l.index), rect: l.rect, at: l.at, space: l.space }))
          png = (await composer.render(legendHtml('frame.png', width, height, legend), { 'frame.png': png }, width, null, opts.scale)).png
        }
        const size = pngSize(png)
        if (!size) throw new CliError('the browser returned a screenshot that is not a PNG')
        // frames with a legend differ in height: the cells of a sheet are sized for the tallest
        frameSize = frameSize ? { width: frameSize.width, height: Math.max(frameSize.height, size.height) } : size
        const stem = frameFileStem(plan, view.name, opts.debug)
        const path = join(outDir, `${stem}.png`)
        writeFileSync(path, png)
        writeFileSync(
          join(outDir, `${stem}.probes.json`),
          JSON.stringify({
            scene: scene.file, step: plan.step, title: plan.title, t: plan.t, camera: view.name, params: state.params, probes: state.probes,
            ...(typeof plan.chapter === 'number' ? { chapter: plan.chapter } : {}),
            ...(plan.cue ? { cue: plan.cue } : {}),
            ...(plan.param ? { param: plan.param } : {}),
            ...(legend ? { legend: legend.map((l) => ({ n: l.n, id: l.id, color: l.color, space: l.space, rect: l.rect, at: l.at })) } : {}),
          }, null, 2) + '\n',
        )
        entries.push({
          path, step: plan.step, title: plan.title, t: plan.t, camera: view.name, width: size.width, height: size.height, sha256: sha256Hex(png), ...stale,
          ...(typeof plan.chapter === 'number' ? { chapter: plan.chapter } : {}),
          ...(plan.cue ? { cue: plan.cue } : {}),
          ...(plan.param ? { param: plan.param } : {}),
        })
        cells.push(cellOf(plan, `${frames.length}.png`, view.name))
        frames.push(png)
      }
    }
    io.log(`${frames.length} frame${frames.length === 1 ? '' : 's'} in ${Math.round(performance.now() - started)} ms`)

    if (opts.sheet && frameSize) {
      const maxWidth = opts.sizeExplicit ? Math.max(SHEET_MAX_WIDTH, width) : SHEET_MAX_WIDTH
      // chapters get a row each on a sheet of step ends; a filmstrip or a set of picked times is one run of cells
      const groups = opts.mode.kind === 'steps' || opts.mode.kind === 'cues' ? groupByChapter(cells, info) : [{ heading: null, range: null, cells }]
      // a filmstrip and a turntable are read as a sequence: narrower cells, as many per row as fit
      const strip = opts.mode.kind === 'fine' || (opts.turntable !== null && plans.length === 1)
      const stripCols = Math.min(cells.length, Math.max(1, Math.floor(maxWidth / STRIP_MIN_CELL)))
      const layout = storyLayout(groups, frameSize.width, frameSize.height, {
        maxWidth, maxHeight: SHEET_MAX_HEIGHT, cols: opts.cols ?? (strip ? stripCols : null), ...(strip ? { minCell: STRIP_MIN_CELL } : {}),
      })
      const title = opts.mode.kind === 'fine' ? 'filmstrip' : opts.mode.kind === 'cues' ? 'cue sheet' : opts.mode.kind === 'steps' ? 'story sheet' : 'contact sheet'
      const suffix = opts.debug !== null ? `.debug-${opts.debug}` : ''
      for (let i = 0; i < layout.pages.length; i++) {
        const page = layout.pages[i]!
        const used: Record<string, Uint8Array> = {}
        for (const g of page.groups) for (const c of g.cells) used[c.src] = frames[Number(c.src.replace('.png', ''))]!
        const sheet = await composer.render(storyHtml(page, layout.cell), used, page.width, page.height, 1)
        const base = sheetBase(opts.mode.kind)
        const path = join(outDir, layout.pages.length === 1 ? `${base}${suffix}.png` : `${base}-${i + 1}${suffix}.png`)
        writeFileSync(path, sheet.png)
        entries.push({
          path, step: null, title, t: null, camera: null, width: sheet.width, height: sheet.height, sha256: sha256Hex(sheet.png),
          sheet: {
            cols: layout.cell.cols, rows: page.rows, frames: page.frames, tokens: imageTokens(sheet.width, sheet.height),
            ...(layout.pages.length > 1 ? { page: i + 1, pages: layout.pages.length } : {}),
          },
          ...stale,
        })
        io.log(`${title}: ${path} (${sheet.width}x${sheet.height}, about ${imageTokens(sheet.width, sheet.height)} tokens to look at)`)
      }
    }
    writeFileSync(join(outDir, MANIFEST_FILE), JSON.stringify(entries, null, 2) + '\n')
  } finally {
    await composer.close()
    await session.close()
  }
  io.out(io.json ? JSON.stringify(entries) + '\n' : formatManifestCompact(entries, outDir, io.cwd))
  return 0
}
