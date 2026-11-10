// mimir export --mp4: every frame is rendered by seeking the story (time is an input, so frame i is the picture at
// i / fps and nothing else) and piped as PNG to ffmpeg. ffmpeg is optional software: it is looked for, never assumed.
//
// A long video is made in parts (VIDEO_PART_FRAMES frames each, every part a finished mp4 in `<out>.parts/`) that are
// joined at the end without re-encoding. A frame that does not come back in time is tried again on a fresh page; when
// that fails too, the run stops with the step that was slow, the finished parts stay, and the same command continues
// from them. Progress goes to stderr.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ParamSet, Size } from './args.ts'
import { onCleanup, PageError, type Page } from './chrome.ts'
import { CliError } from './errors.ts'
import { frameExpression } from './pageside.ts'
import { timeoutFromEnv } from './session.ts'

/** Where ffmpeg is: MIMIR_FFMPEG, else PATH. null when it is not installed. A MIMIR_FFMPEG that does not exist is an error. */
export function findFfmpeg(env: Record<string, string | undefined> = process.env): string | null {
  const override = env.MIMIR_FFMPEG
  if (override !== undefined && override !== '') {
    if (!existsSync(override)) throw new CliError(`MIMIR_FFMPEG points to a file that does not exist: ${override}`)
    return override
  }
  return Bun.which('ffmpeg', { PATH: env.PATH ?? '' })
}

export const FFMPEG_MISSING =
  'mimir export --mp4 needs ffmpeg, and none was found on PATH. Install it (macOS: brew install ffmpeg · Debian / Ubuntu: ' +
  'sudo apt install ffmpeg · Windows: winget install ffmpeg) or set MIMIR_FFMPEG=/path/to/ffmpeg. ' +
  'The HTML export (-o out.html) and the article (--md) do not need it.'

/** ffprobe next to the ffmpeg that is used, else on PATH; null when there is none (the video is then not probed). */
export function findFfprobe(ffmpeg: string, env: Record<string, string | undefined> = process.env): string | null {
  const beside = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  if (existsSync(beside)) return beside
  return Bun.which('ffprobe', { PATH: env.PATH ?? '' })
}

/** Story times of the frames of a video: frame i shows the story at from + i / fps; the last frame never passes `to`. */
export function videoTimes(from: number, to: number, fps: number): number[] {
  const count = Math.max(1, Math.round((to - from) * fps))
  return Array.from({ length: count }, (_, i) => Math.min(to, Number((from + i / fps).toFixed(6))))
}

/**
 * The encoder: H.264 in an mp4 that plays everywhere (yuv420p, BT.709 tagged, moov atom first). `-tune animation`
 * suits flat colour and thin lines; quality is --crf (lower is better).
 */
export function ffmpegArgs(fps: number, crf: number, out: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-tune', 'animation', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-r', String(fps), '-movflags', '+faststart', '-f', 'mp4', out,
  ]
}

/** frames per part: a part is the unit that is kept when a run stops, and the most that is rendered again (5 s at 30 fps) */
export const VIDEO_PART_FRAMES = 150
/** how often one frame is tried (each further try on a fresh page) before the run gives up */
export const VIDEO_FRAME_TRIES = 3
/** seconds between two progress lines on stderr */
export const VIDEO_PROGRESS_SECONDS = 5
/** a frame slower than this many seconds is named in the log with the step that took the time */
export const VIDEO_SLOW_FRAME_SECONDS = 5

export interface VideoResult {
  path: string
  bytes: number
  sha256: string
  frames: number
  fps: number
  width: number
  height: number
  /** story seconds covered */
  from: number
  to: number
  /** sha256 over the sha256 of the PNG bytes of every frame in order: the same scene gives the same value, whatever the encoder does, however many pages drew it and in however many runs */
  frames_sha256: string
  /** what ffprobe measured in the written file, or null when ffprobe is not installed */
  probe: { frames: number | null; width: number | null; height: number | null; duration: number | null; codec: string | null } | null
  /** how the time was spent: wall seconds of this run, frames it rendered (the rest came from parts an earlier run finished), frames tried again, and the slowest frame with its two steps */
  timing: { seconds: number; rendered: number; resumed: number; retried: number; pages: number; slowest: { frame: number; t: number; seek_ms: number; screenshot_ms: number } | null }
}

export interface VideoOptions {
  out: string
  ffmpeg: string
  ffprobe: string | null
  fps: number
  crf: number
  size: Size
  from: number
  to: number
  sets: readonly ParamSet[]
  /** pages that render at the same time */
  jobs: number
  /** what the pictures depend on besides the options above (the scene file, the build): parts of an earlier run are used only when it is the same */
  fingerprint: string
  /** per-step limit in ms (MIMIR_TIMEOUT); default timeoutFromEnv() */
  timeoutMs?: number
  partFrames?: number
  tries?: number
  log(message: string): void
}

/** Where pages come from: a page showing the scene headless at the video size, and a way to give one back. */
export interface PagePool { open(): Promise<Page>; close(page: Page): Promise<void> }

const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

function probeVideo(ffprobe: string, file: string): VideoResult['probe'] {
  const r = Bun.spawnSync([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,width,height,codec_name:format=duration', '-of', 'json', file])
  if (r.exitCode !== 0) return null
  try {
    const j = JSON.parse(r.stdout.toString()) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
    const s = j.streams?.[0] ?? {}
    const n = (v: unknown): number | null => (Number.isFinite(Number(v)) && v !== undefined && v !== null && v !== '' ? Number(v) : null)
    return { frames: n(s.nb_read_frames), width: n(s.width), height: n(s.height), duration: n(j.format?.duration), codec: typeof s.codec_name === 'string' ? s.codec_name : null }
  } catch {
    return null
  }
}

/** The parts of a video: part k holds frames [k * size, min(total, (k + 1) * size)). */
export function videoParts(total: number, size: number): Array<{ index: number; first: number; count: number }> {
  const n = Math.max(1, Math.floor(size))
  return Array.from({ length: Math.ceil(total / n) }, (_, k) => ({ index: k, first: k * n, count: Math.min(n, total - k * n) }))
}
/** Where the parts of a video are kept while it is made (and after a run that stopped): beside the output file. */
export const partsDir = (out: string): string => `${out}.parts`
const partFile = (dir: string, k: number): string => join(dir, `part-${String(k + 1).padStart(5, '0')}.mp4`)
const partNote = (dir: string, k: number): string => join(dir, `part-${String(k + 1).padStart(5, '0')}.json`)
/** "1 min 20 s" */
export function spokenSeconds(s: number): string {
  const n = Math.max(0, Math.round(s))
  return n < 60 ? `${n} s` : n < 3600 ? `${Math.floor(n / 60)} min ${n % 60} s` : `${Math.floor(n / 3600)} h ${Math.floor((n % 3600) / 60)} min`
}

interface PartNote { key: string; first: number; count: number; frames: string[] }

/** One encoder process for one part. */
function startEncoder(ffmpeg: string, args: string[]): { write(png: Uint8Array): Promise<void>; finish(): Promise<void>; kill(): void } {
  const enc = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  let startError: Error | null = null
  enc.stderr!.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000) })
  enc.stdin!.on('error', () => { /* ffmpeg went away: its exit code and stderr say why */ })
  const exited = new Promise<number | null>((done) => {
    enc.once('error', (e) => { startError = new CliError(`could not start ffmpeg (${ffmpeg}): ${e.message}`); done(null) })
    enc.once('exit', (code) => done(code))
  })
  const gone = (): Error | null => startError ?? (enc.exitCode !== null ? new CliError(`ffmpeg stopped early (exit ${enc.exitCode}): ${stderr.trim() || 'no message'}`) : null)
  return {
    async write(png) {
      const e = gone()
      if (e) throw e
      if (!enc.stdin!.write(png)) await Promise.race([new Promise<void>((r) => enc.stdin!.once('drain', () => r())), exited])
    },
    async finish() {
      enc.stdin!.end()
      const code = await exited
      if (startError) throw startError
      if (code !== 0) throw new CliError(`ffmpeg failed (exit ${code}): ${stderr.trim() || 'no message'}`)
    },
    kill() { try { enc.kill('SIGKILL') } catch { /* gone */ } },
  }
}

/**
 * Render and encode. Up to `jobs` pages show the scene headless at the video size; any page renders any frame and
 * the frames are written in order, so the result does not depend on how many pages there are, nor on how many runs
 * it took.
 */
export async function encodeVideo(pool: PagePool, o: VideoOptions): Promise<VideoResult> {
  const times = videoTimes(o.from, o.to, o.fps)
  const total = times.length
  const timeoutMs = o.timeoutMs ?? timeoutFromEnv()
  const tries = Math.max(1, o.tries ?? VIDEO_FRAME_TRIES)
  const parts = videoParts(total, o.partFrames ?? VIDEO_PART_FRAMES)
  const dir = partsDir(o.out)
  const key = createHash('sha256').update(JSON.stringify([o.fingerprint, o.size.width, o.size.height, o.fps, o.crf, o.from, o.to, o.sets, o.partFrames ?? VIDEO_PART_FRAMES])).digest('hex')
  const started = performance.now()

  // ── what an earlier run of the same video finished ──
  const digests: (string | null)[] = new Array(total).fill(null)
  const done = new Set<number>()
  mkdirSync(dir, { recursive: true })
  for (const part of parts) {
    try {
      const note = JSON.parse(readFileSync(partNote(dir, part.index), 'utf8')) as PartNote
      if (note.key !== key || note.first !== part.first || note.count !== part.count || note.frames.length !== part.count || !existsSync(partFile(dir, part.index)) || statSync(partFile(dir, part.index)).size === 0) throw new Error('not this video')
      note.frames.forEach((d, i) => { digests[part.first + i] = d })
      done.add(part.index)
    } catch {
      rmSync(partFile(dir, part.index), { force: true }); rmSync(partNote(dir, part.index), { force: true })
    }
  }
  const todo = parts.filter((p) => !done.has(p.index))
  const resumed = parts.filter((p) => done.has(p.index)).reduce((n, p) => n + p.count, 0)
  if (resumed) o.log(`video: continuing: ${resumed} of ${total} frames (${done.size} of ${parts.length} parts) are kept from an earlier run in ${dir}`)
  const queue: number[] = todo.flatMap((p) => Array.from({ length: p.count }, (_, i) => p.first + i))
  const toRender = queue.length

  // ── rendering: any page takes the next frame; a frame that fails is tried again on a fresh page ──
  let failed: Error | null = null
  /** the failure of a frame: what is kept is added to its message once the encoder has finished what it had */
  let renderFailure: Error | null = null
  const ready = new Map<number, Uint8Array>()
  let taken = 0 // frames handed to a page
  let written = 0 // frames given to the encoder, in order
  let retried = 0
  let slowest: VideoResult['timing']['slowest'] = null
  let wake: (() => void) | null = null
  const jobs = Math.max(1, Math.min(o.jobs, toRender || 1))
  const lookahead = jobs * 3
  const keptHint = (): string => { const kept = done.size; return kept ? ` ${kept} of ${parts.length} parts are finished and kept in ${dir}: run the same command again and it continues from there.` : ' Run the same command again to retry.' }
  const worker = async (): Promise<void> => {
    let page: Page | null = null
    try {
      for (;;) {
        if (failed) return
        // do not render far ahead of what the encoder has taken (memory: a frame is megabytes)
        while (taken - written > lookahead && !failed) await new Promise<void>((r) => setTimeout(r, 2))
        if (failed || taken >= toRender) return
        const i = queue[taken++]!
        const where = `video frame ${i + 1} of ${total} (t=${times[i]}s)`
        for (let attempt = 1; !failed; attempt++) {
          let step = 'opening a page for the scene'
          try {
            page ??= await pool.open()
            step = 'seeking the story (the scene\'s own work for this frame)'
            const t0 = performance.now()
            await page.evaluate(frameExpression(times[i]!, o.sets, null), timeoutMs)
            const t1 = performance.now()
            step = 'the screenshot (Page.captureScreenshot)'
            const png = await page.screenshot(timeoutMs, { fast: true })
            const t2 = performance.now()
            if (!slowest || t2 - t0 > slowest.seek_ms + slowest.screenshot_ms) slowest = { frame: i + 1, t: times[i]!, seek_ms: Math.round(t1 - t0), screenshot_ms: Math.round(t2 - t1) }
            if (t2 - t0 > VIDEO_SLOW_FRAME_SECONDS * 1000) o.log(`video: slow frame ${i + 1} (t=${times[i]}s): seek ${((t1 - t0) / 1000).toFixed(1)} s, screenshot ${((t2 - t1) / 1000).toFixed(1)} s`)
            ready.set(i, png)
            break
          } catch (e) {
            const message = (e as Error).message
            // the scene threw: the same frame throws again on any page
            if (e instanceof PageError) { failed ??= (renderFailure = new CliError(`rendering ${where} failed: the scene threw while ${step}: ${message}.`)); break }
            const old = page
            page = null
            if (old) void pool.close(old)
            if (attempt >= tries) {
              failed ??= (renderFailure = new CliError(`rendering ${where} failed ${attempt} time${attempt === 1 ? '' : 's'}, each on a fresh page. The slow step was ${step}: ${message}. MIMIR_TIMEOUT=<ms> raises the limit of one step (now ${timeoutMs} ms); fewer --jobs or a smaller --size lighten the load.`))
              break
            }
            retried++
            o.log(`video: frame ${i + 1} (t=${times[i]}s): ${step} failed (${message}); trying again on a fresh page (try ${attempt + 1} of ${tries})`)
          }
        }
        wake?.()
      }
    } finally {
      if (page) void pool.close(page)
    }
  }

  // ── encoding: one finished file per part ──
  const live: { encoder: ReturnType<typeof startEncoder> | null } = { encoder: null }
  let lastSaid = performance.now()
  const removeCleanup = onCleanup(() => { live.encoder?.kill() })
  const progress = (force = false): void => {
    const now = performance.now()
    if (!force && now - lastSaid < VIDEO_PROGRESS_SECONDS * 1000) return
    lastSaid = now
    const seconds = (now - started) / 1000
    const rate = written / Math.max(seconds, 1e-3)
    const left = rate > 0 ? (toRender - written) / rate : 0
    o.log(`video: frame ${resumed + written} of ${total} (${Math.floor(((resumed + written) / total) * 100)} %), ${rate.toFixed(1)} frames/s${written < toRender ? `, about ${spokenSeconds(left)} left` : ''}`)
  }
  const writer = async (): Promise<void> => {
    for (const part of todo) {
      const tmp = `${partFile(dir, part.index)}.partial.mp4`
      const own: string[] = []
      const encoder = (live.encoder = startEncoder(o.ffmpeg, ffmpegArgs(o.fps, o.crf, tmp)))
      try {
        for (let i = part.first; i < part.first + part.count; i++) {
          let png: Uint8Array | undefined
          while (!(png = ready.get(i))) {
            if (failed) throw failed
            await new Promise<void>((r) => { wake = r; setTimeout(r, 50) })
          }
          ready.delete(i)
          own.push(createHash('sha256').update(png).digest('hex'))
          await encoder.write(png)
          written++
          progress()
        }
        await encoder.finish()
      } catch (e) {
        encoder.kill()
        rmSync(tmp, { force: true })
        failed ??= e as Error
        throw failed
      }
      if (!existsSync(tmp) || statSync(tmp).size === 0) { failed ??= new CliError(`ffmpeg exited cleanly but wrote no video to ${tmp}`); throw failed }
      renameSync(tmp, partFile(dir, part.index))
      writeFileSync(partNote(dir, part.index), JSON.stringify({ key, first: part.first, count: part.count, frames: own } satisfies PartNote))
      own.forEach((d, k) => { digests[part.first + k] = d })
      done.add(part.index)
    }
  }
  try {
    const results = await Promise.allSettled([...Array.from({ length: jobs }, worker), writer()])
    if (failed) throw failed
    for (const r of results) if (r.status === 'rejected') throw r.reason
    if (toRender) progress(true)
    // ── join: the parts are complete H.264 files with the same settings, so they are copied, not encoded again ──
    const partial = `${o.out}.partial.mp4`
    if (parts.length === 1) renameSync(partFile(dir, 0), partial)
    else {
      const list = join(dir, 'parts.txt')
      writeFileSync(list, parts.map((p) => `file '${partFile(dir, p.index).replace(/'/g, "'\\''")}'`).join('\n') + '\n')
      const r = Bun.spawnSync([o.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', partial])
      if (r.exitCode !== 0) throw new CliError(`joining the ${parts.length} parts of the video failed (ffmpeg exit ${r.exitCode}): ${r.stderr.toString().trim().slice(-600) || 'no message'}. The parts are kept in ${dir}; run the same command again.`)
    }
    if (!existsSync(partial) || statSync(partial).size === 0) throw new CliError(`ffmpeg exited cleanly but wrote no video to ${partial}`)
    renameSync(partial, o.out)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    live.encoder?.kill()
    rmSync(`${o.out}.partial.mp4`, { force: true })
    // nothing finished: leave no empty folder behind
    if (!done.size) rmSync(dir, { recursive: true, force: true })
    if (e instanceof Error && e === (renderFailure as Error | null)) throw new CliError(`${e.message}${keptHint()}`)
    throw e
  } finally {
    removeCleanup()
  }
  const seconds = (performance.now() - started) / 1000
  o.log(`video: ${toRender} frames rendered in ${seconds.toFixed(1)} s (${(toRender / Math.max(seconds, 1e-3)).toFixed(1)} frames/s, ${jobs} page${jobs === 1 ? '' : 's'}${resumed ? `, ${resumed} frames from an earlier run` : ''}${retried ? `, ${retried} frame${retried === 1 ? '' : 's'} tried again` : ''})`)
  const probe = o.ffprobe ? probeVideo(o.ffprobe, o.out) : null
  if (probe && probe.frames !== null && probe.frames !== total) {
    throw new CliError(`the video has ${probe.frames} frames but ${total} were rendered; the file was kept at ${o.out}`)
  }
  const all = createHash('sha256')
  for (const d of digests) all.update(d ?? '')
  return {
    path: o.out, bytes: statSync(o.out).size, sha256: sha256File(o.out), frames: total, fps: o.fps, width: o.size.width, height: o.size.height,
    from: o.from, to: o.to, frames_sha256: all.digest('hex'), probe,
    timing: { seconds: Number(seconds.toFixed(1)), rendered: toRender, resumed, retried, pages: jobs, slowest },
  }
}
