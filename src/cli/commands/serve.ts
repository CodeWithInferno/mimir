// mimir serve [dir] [--port n] [--open] [--jobs n]
//
// The home of the player: one local server that serves the viewer and answers the home API over the scenes of a
// directory (the working directory unless one is named).
//
//   GET    /api/scenes                 the scenes under the directory: [{ name, title, summary, path, url, modified }]
//   GET    /api/agents                 which coding agents are on this machine, and which one a generation would use
//   POST   /api/new  { prompt, … }     start a generation (the same run as `mimir new`); answers 202 { id, events }
//   GET    /api/new                    the generations of this server
//   GET    /api/new/<id>               one generation: status, stage, result
//   GET    /api/new/<id>/events        its progress as server-sent events (replayed from the start, or from Last-Event-ID)
//   GET    /api/new/<id>/sheet         the contact sheet of its result (PNG)
//   DELETE /api/new/<id>               stop it
//   GET    /api/sheet?scene=<path>     a contact sheet of a scene (PNG), rendered on demand and kept until the file changes
//   GET    /api/export?scene=<path>[&format=html|mp4|md]   the scene as one self-contained file
//   GET    /scene/<path>               files of the directory (what a scene imports)
//   GET    /events                     server-sent events: `reload` when a file of the directory changes
//   GET    /…                          the viewer
//
// Safe by default. It listens on 127.0.0.1 only, on a free port unless --port names one. A request whose Host
// header is not this server's own address is refused (a web page cannot reach it through a made-up host name).
// Requests that change something must be same-origin and JSON (another site cannot start an agent with a form).
// Dot files and dot directories are never served, and no path leaves the directory.
import { watch, type FSWatcher } from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import { detectAll } from '../agents/index.ts'
import { loadConfig } from '../agents/config.ts'
import { generate, prepare, sceneFiles, type GenerateRequest, type Prepared, type Verifier } from '../agents/generate.ts'
import { DEFAULT_JOBS } from '../agents/limits.ts'
import { SERVE_SPEC } from '../agents/specs.ts'
import { standalone } from '../agents/standalone.ts'
import type { NewResult, Progress, Stage } from '../agents/types.ts'
import { COMMANDS, parseFlags, toExportOptions, type Parsed } from '../args.ts'
import { onCleanup } from '../chrome.ts'
import { CliError, UsageError } from '../errors.ts'
import type { Io } from '../io.ts'
import { ROOT, ensureViewer } from '../paths.ts'
import { contentType, injectLiveReload, isIgnoredChange, safeJoin } from '../server.ts'
import { describeExample, shortSummary } from './docs.ts'
import { exportScene } from './export.ts'
import { cliVerifier } from './new.ts'

export { DEFAULT_JOBS, SERVE_SPEC }
/** finished generations kept in memory for late readers */
export const JOBS_KEPT = 50
/** largest request body, bytes */
export const BODY_MAX = 64 * 1024
/** longest prompt, characters */
export const PROMPT_MAX = 4000
/** words of the prompt that name the directory of a generation */
export const SLUG_WORDS = 6
/** how deep scenes are looked for under the directory */
export const SCENE_DEPTH = 3
/** ms a change on disk is held back, so that one save is one reload */
export const RELOAD_DEBOUNCE_MS = 40
export const EXPORT_FORMATS = ['html', 'mp4', 'md'] as const

export interface ServeOptions { dir: string | null; port: number | null; open: boolean; jobs: number }

export function toServeOptions(p: Parsed): ServeOptions {
  const text = (name: string): string | null => (typeof p.flags[name] === 'string' ? (p.flags[name] as string) : null)
  const whole = (name: string, min: number, max: number): number | null => {
    const t = text(name)
    if (t === null) return null
    const n = Number(t)
    if (t.trim() === '' || !Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max} (got "${t}")`, 'serve')
    return n
  }
  return { dir: p.args[0] ?? null, port: whole('port', 0, 65535), open: p.flags.open === true, jobs: whole('jobs', 1, 64) ?? DEFAULT_JOBS }
}

export interface SceneRow { name: string; title: string; summary: string; path: string; url: string; modified: string }

const posix = (p: string): string => p.split(sep).join('/')
const isScenePath = (p: string): boolean => /\.scene\.m?js$/i.test(p)
const hidden = (urlPath: string): boolean => urlPath.split('/').some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')

/** The scenes under a directory, newest first. Titles are read from the text of the file; no scene is run. */
export function listScenes(root: string): SceneRow[] {
  return [...sceneFiles(root, SCENE_DEPTH)]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([path, mtime]) => {
      let source = ''
      try { source = readFileSync(path, 'utf8') } catch { /* listed without a title */ }
      const info = describeExample(path, source)
      const rel = posix(relative(root, path))
      return { name: info.name, title: info.title, summary: shortSummary(info.summary), path: rel, url: `/viewer.html?scene=${encodeURIComponent('/scene/' + rel.split('/').map(encodeURIComponent).join('/'))}`, modified: new Date(mtime).toISOString() }
    })
}

/** A directory name for a generation, from the words of its prompt: "How does a gear work?" → "how-does-a-gear-work". */
export function slugOf(prompt: string): string {
  const words = prompt.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w !== '')
  return words.slice(0, SLUG_WORDS).join('-') || 'scene'
}

/** The first of slug, slug-2, slug-3 … that does not exist under root. */
export function freeDir(root: string, slug: string): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? slug : `${slug}-${n}`
    if (!existsSync(join(root, name))) return name
  }
}

export interface Job {
  id: string
  prompt: string
  /** directory of the generation, relative to the served directory */
  dir: string
  status: 'running' | 'ready' | 'failed'
  stage: Stage
  started: string
  events: Array<Progress | NewResult>
  result: NewResult | null
  stop: ((why: string) => void) | null
  listeners: Set<() => void>
}

const jobView = (j: Job): Record<string, unknown> => ({ id: j.id, prompt: j.prompt, dir: j.dir, status: j.status, stage: j.stage, started: j.started, events: j.events.length, result: j.result })

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) { super(message) }
}

const JSON_HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' }
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value) + '\n', { status, headers: JSON_HEADERS })
const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

export interface HomeDeps {
  /** how a generation is verified (the test suite hands in its own) */
  verifier?: Verifier
  /** the viewer directory (default: built on demand) */
  viewerRoot?: string
  /** the mimir checkout a generation runs from */
  mimirRoot?: string
}

export interface HomeServer {
  origin: string
  port: number
  root: string
  jobs: ReadonlyMap<string, Job>
  /** stop every generation and close the server */
  stop(): void
}

/** Is this request addressed to this server itself? `host` is the Host header. */
export function ownHost(host: string | null, port: number): boolean {
  if (host === null) return false
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase())
}

export async function startHome(opts: ServeOptions, io: Io, deps: HomeDeps = {}): Promise<HomeServer> {
  const root = resolve(io.cwd, opts.dir ?? '.')
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new UsageError(`not a directory: ${opts.dir ?? '.'}`, 'serve')
  const viewerRoot = resolve(deps.viewerRoot ?? (await ensureViewer(io.env, io.log)).dir)
  const mimirRoot = deps.mimirRoot ?? ROOT
  const verifier = deps.verifier ?? cliVerifier(io)
  const jobs = new Map<string, Job>()
  const encoder = new TextEncoder()
  const scratch = mkdtempSync(join(tmpdir(), 'mimir-serve-'))
  let nextId = 1
  let port = 0

  // ── live reload: one event per changed file of the directory ────────────────────────────────────
  const reloadClients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      const rel = filename === null ? '' : String(filename)
      if (rel !== '' && isIgnoredChange(rel)) return
      const old = timers.get(rel)
      if (old) clearTimeout(old)
      timers.set(rel, setTimeout(() => {
        timers.delete(rel)
        const chunk = encoder.encode(`event: reload\ndata: ${JSON.stringify({ kind: 'scene', path: posix(rel) })}\n\n`)
        for (const c of [...reloadClients]) { try { c.enqueue(chunk) } catch { reloadClients.delete(c) } }
      }, RELOAD_DEBOUNCE_MS))
    })
    watcher.on('error', () => {})
  } catch (e) {
    io.log(`cannot watch ${root}: ${(e as Error).message}`)
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────────
  /** A scene named by a request: inside the directory, not hidden, a scene file that exists. */
  const sceneOf = (value: string | null): string => {
    if (value === null || value === '') throw new HttpError(400, 'missing ?scene=<path of a scene under the served directory>')
    const rel = value.replace(/^\/scene\//, '')
    const path = hidden(rel) ? null : safeJoin(root, rel)
    if (path === null || !isScenePath(path)) throw new HttpError(400, `not a scene of this directory: ${value}`)
    if (!existsSync(path) || !statSync(path).isFile()) throw new HttpError(404, `no such scene: ${value}`)
    return path
  }
  const fileResponse = (path: string, headers: Record<string, string> = {}): Response => new Response(Bun.file(path), { headers: { ...NO_STORE, 'content-type': contentType(path), ...headers } })
  const running = (): Job[] => [...jobs.values()].filter((j) => j.status === 'running')

  // ── POST /api/new ────────────────────────────────────────────────────────────────────────────────
  const startJob = async (req: Request): Promise<Response> => {
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'send JSON: content-type: application/json')
    const raw = await req.text()
    if (raw.length > BODY_MAX) throw new HttpError(413, `the request body is larger than ${BODY_MAX} bytes`)
    let body: Record<string, unknown>
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      body = parsed as Record<string, unknown>
    } catch (e) {
      throw new HttpError(400, `the request body is not a JSON object: ${(e as Error).message}`)
    }
    const known = ['prompt', 'agent', 'model', 'maxTurns', 'budgetUsd', 'timeout', 'dir']
    const unknown = Object.keys(body).filter((k) => !known.includes(k))
    if (unknown.length) throw new HttpError(400, `unknown field ${unknown.join(', ')} (fields: ${known.join(', ')})`)
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (prompt === '') throw new HttpError(400, 'prompt must be a non-empty string')
    if (prompt.length > PROMPT_MAX) throw new HttpError(400, `the prompt is longer than ${PROMPT_MAX} characters`)
    const str = (k: string): string | null => {
      if (body[k] === undefined || body[k] === null) return null
      if (typeof body[k] !== 'string' || body[k] === '') throw new HttpError(400, `${k} must be a non-empty string`)
      return body[k] as string
    }
    const num = (k: string, whole = false): number | null => {
      if (body[k] === undefined || body[k] === null) return null
      const n = body[k]
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || (whole && !Number.isInteger(n))) throw new HttpError(400, `${k} must be a ${whole ? 'whole ' : ''}number greater than 0`)
      return n
    }
    const wanted = str('dir')
    let dir: string
    if (wanted !== null) {
      const inside = hidden(wanted) ? null : safeJoin(root, wanted)
      if (inside === null || inside === root) throw new HttpError(400, `dir must be a directory under the served directory, without dot segments (got "${wanted}")`)
      dir = posix(relative(root, inside))
    } else dir = freeDir(root, slugOf(prompt))
    if (running().length >= opts.jobs) throw new HttpError(429, `${running().length} generation${running().length === 1 ? ' is' : 's are'} already running (at most ${opts.jobs}; mimir serve --jobs n)`, { running: running().map((j) => j.id) })

    const request: GenerateRequest = {
      prompt, workdir: join(root, dir), cwd: root, env: io.env, root: mimirRoot,
      agent: str('agent'), model: str('model'), maxTurns: num('maxTurns', true), budgetUsd: num('budgetUsd'), timeout: num('timeout'), instructions: null, resume: null,
    }
    let prepared: Prepared
    try {
      prepared = prepare(request)
    } catch (e) {
      // no agent on this machine, a bad config file, an unknown adapter: the caller can act on the message
      if (e instanceof UsageError) throw new HttpError(400, e.message)
      if (e instanceof CliError) throw new HttpError(503, e.message)
      throw e
    }
    const job: Job = { id: String(nextId++), prompt, dir, status: 'running', stage: 'storyboard', started: new Date().toISOString(), events: [], result: null, stop: null, listeners: new Set() }
    jobs.set(job.id, job)
    for (const old of [...jobs.values()].filter((j) => j.status !== 'running').slice(0, Math.max(0, jobs.size - JOBS_KEPT))) jobs.delete(old.id)
    const push = (e: Progress | NewResult): void => {
      job.events.push(e)
      job.stage = e.stage
      if (e.event === 'result') { job.result = e; job.status = e.ok ? 'ready' : 'failed'; job.stop = null }
      for (const wake of [...job.listeners]) wake()
    }
    void generate(prepared, verifier, { emit: push, log: io.log, onStart: (stop) => { job.stop = stop }, onCleanup: (fn) => onCleanup(fn) }).catch((e: unknown) => {
      // the agent could not be started at all: the generation still ends with a result line that says so
      push({
        event: 'result', stage: 'failed', ok: false, scene: null, check: null, sheet: null, storyboard: null, looked: null, rounds: { check: 0, look: 0, edit: 0 }, shots: { sheet: 0, cues: 0, fine: 0, frames: 0 },
        agent: prepared.selection.adapter.name, model: prepared.options.model, session: null, turns: null, cost_usd: null, duration_ms: null, wall_ms: 0, denials: 0,
        error: e instanceof Error ? e.message : String(e), notes: [],
      })
    })
    return json({ ...jobView(job), events_url: `/api/new/${job.id}/events` }, 202)
  }

  /** The progress of a generation as server-sent events: everything so far, then what follows, closed after the result. */
  const eventStream = (job: Job, from: number): Response => {
    let sent = Math.max(0, Math.min(from, job.events.length))
    let wake: (() => void) | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('retry: 1000\n\n'))
        const flush = (): void => {
          try {
            while (sent < job.events.length) {
              const e = job.events[sent]!
              c.enqueue(encoder.encode(`id: ${sent + 1}\nevent: ${e.event}\ndata: ${JSON.stringify(e)}\n\n`))
              sent++
            }
            if (job.result !== null) { if (wake) job.listeners.delete(wake); c.close() }
          } catch {
            if (wake) job.listeners.delete(wake)
          }
        }
        wake = flush
        job.listeners.add(flush)
        flush()
      },
      cancel() { if (wake) job.listeners.delete(wake) },
    })
    return new Response(stream, { headers: { ...NO_STORE, 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' } })
  }

  // ── sheets and exports ───────────────────────────────────────────────────────────────────────────
  const sheets = new Map<string, { mtime: number; path: string }>()
  const sheetOf = async (scene: string): Promise<string> => {
    const mtime = statSync(scene).mtimeMs
    const hit = sheets.get(scene)
    if (hit && hit.mtime === mtime && existsSync(hit.path)) return hit.path
    const out = join(scratch, 'sheets', String(sheets.size + 1) + '-' + basename(scene).replace(/\.scene\.m?js$/i, ''))
    const path = await verifier.sheet(scene, out)
    sheets.set(scene, { mtime, path })
    return path
  }
  let exportCount = 0
  const exportOf = async (scene: string, format: string): Promise<Response> => {
    if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `format must be one of ${EXPORT_FORMATS.join(', ')} (got "${format}")`)
    const name = basename(scene).replace(/\.scene\.m?js$/i, '')
    const dir = join(scratch, 'exports', String(++exportCount))
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${name}.${format}`)
    const quiet: Io = { ...io, json: true, out: () => {}, log: () => {} }
    try {
      const code = await exportScene(toExportOptions(parseFlags(COMMANDS.export!, [scene, format === 'html' ? '-o' : `--${format}`, file, '--json'])), quiet)
      if (!existsSync(file)) throw new HttpError(500, `the export wrote no file (exit ${code}); run: mimir check ${relative(root, scene)}`)
      const bytes = readFileSync(file)
      return new Response(bytes, { headers: { ...NO_STORE, 'content-type': contentType(file), 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}.${format}"` } })
    } catch (e) {
      if (e instanceof HttpError) throw e
      if (e instanceof CliError || e instanceof UsageError) throw new HttpError(500, e.message)
      throw e
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // ── routes ───────────────────────────────────────────────────────────────────────────────────────
  const route = async (req: Request, url: URL): Promise<Response> => {
    const { pathname } = url
    const method = req.method
    const read = method === 'GET' || method === 'HEAD'
    if (pathname === '/api/scenes' && read) return json({ root, scenes: listScenes(root) })
    if (pathname === '/api/agents' && read) {
      const config = loadConfig(root, io.env)
      const rows = detectAll(io.env, config.agent)
      const named = (io.env.MIMIR_AGENT && io.env.MIMIR_AGENT !== '' ? io.env.MIMIR_AGENT : null) ?? config.agent.name ?? null
      return json({ agents: rows, default: named ?? rows.find((r) => r.available)?.name ?? null })
    }
    if (pathname === '/api/new') {
      if (method === 'POST') return startJob(req)
      if (read) return json({ jobs: [...jobs.values()].map(jobView) })
      throw new HttpError(405, 'GET or POST')
    }
    const m = /^\/api\/new\/([^/]+)(?:\/(events|sheet))?$/.exec(pathname)
    if (m) {
      const job = jobs.get(decodeURIComponent(m[1]!))
      if (!job) throw new HttpError(404, `no generation ${m[1]}`)
      if (m[2] === 'events' && read) return eventStream(job, Number(req.headers.get('last-event-id') ?? url.searchParams.get('from') ?? 0) || 0)
      if (m[2] === 'sheet' && read) {
        if (!job.result?.sheet || !existsSync(job.result.sheet)) throw new HttpError(404, job.result ? 'this generation has no contact sheet' : 'the generation is still running')
        return fileResponse(job.result.sheet)
      }
      if (m[2] === undefined && read) return json(jobView(job))
      if (m[2] === undefined && method === 'DELETE') {
        if (job.status === 'running') job.stop?.('the generation was stopped by a request (DELETE)')
        return json(jobView(job), job.status === 'running' ? 202 : 200)
      }
      throw new HttpError(405, 'method not allowed')
    }
    if (pathname === '/api/sheet' && read) {
      try {
        return fileResponse(await sheetOf(sceneOf(url.searchParams.get('scene'))))
      } catch (e) {
        if (e instanceof HttpError) throw e
        throw new HttpError(500, `the sheet could not be rendered: ${(e as Error).message.split('\n')[0]}`)
      }
    }
    if (pathname === '/api/export' && read) return exportOf(sceneOf(url.searchParams.get('scene')), url.searchParams.get('format') ?? 'html')
    if (pathname.startsWith('/api/')) throw new HttpError(404, `no such endpoint: ${method} ${pathname}`)
    if (!read) throw new HttpError(405, 'method not allowed')

    if (pathname === '/events') {
      let own: ReadableStreamDefaultController<Uint8Array> | null = null
      const stream = new ReadableStream<Uint8Array>({
        start(c) { own = c; reloadClients.add(c); c.enqueue(encoder.encode('retry: 500\n\n: connected\n\n')) },
        cancel() { if (own) reloadClients.delete(own) },
      })
      return new Response(stream, { headers: { ...NO_STORE, 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' } })
    }
    let decoded: string
    try { decoded = decodeURIComponent(pathname) } catch { throw new HttpError(400, 'bad path') }
    // dot files and dot directories are nobody's business: not the directory's, not the viewer's
    if (hidden(decoded)) throw new HttpError(404, `not found: ${pathname}`)
    if (pathname === '/scene' || pathname.startsWith('/scene/')) {
      const path = safeJoin(root, pathname.slice('/scene'.length) || '/')
      if (path !== null && existsSync(path) && statSync(path).isFile()) return fileResponse(path)
      throw new HttpError(404, `not found: ${pathname}`)
    }
    const viewerPath = pathname === '/' ? '/viewer.html' : pathname
    const path = safeJoin(viewerRoot, viewerPath)
    if (path !== null && existsSync(path) && statSync(path).isFile()) {
      if (viewerPath === '/viewer.html') return new Response(injectLiveReload(readFileSync(path, 'utf8')), { headers: { ...NO_STORE, 'content-type': contentType(path) } })
      return fileResponse(path)
    }
    if (pathname === '/favicon.ico') return new Response(null, { status: 204, headers: NO_STORE })
    throw new HttpError(404, `not found: ${pathname}`)
  }

  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: opts.port ?? 0,
      idleTimeout: 0, // event streams stay open
      async fetch(req) {
        const url = new URL(req.url)
        const api = url.pathname.startsWith('/api/')
        try {
          // a page of another site can make a browser send requests here: only requests addressed to this server count
          if (!ownHost(req.headers.get('host'), port)) throw new HttpError(403, 'this server answers only to its own address (127.0.0.1 or localhost with its port)')
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const origin = req.headers.get('origin')
            const site = req.headers.get('sec-fetch-site')
            if ((origin !== null && !ownHost(origin.replace(/^https?:\/\//, ''), port)) || (site !== null && site !== 'same-origin' && site !== 'none')) throw new HttpError(403, 'requests that change something must come from this server\'s own pages')
          }
          return await route(req, url)
        } catch (e) {
          if (e instanceof HttpError) return api ? json({ error: e.message, ...e.extra }, e.status) : new Response(`${e.message}\n`, { status: e.status, headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' } })
          io.log(`serve: ${req.method} ${url.pathname}: ${(e as Error).stack ?? String(e)}`)
          return api ? json({ error: `internal error: ${(e as Error).message}` }, 500) : new Response('internal error\n', { status: 500, headers: NO_STORE })
        }
      },
    })
  } catch (e) {
    rmSync(scratch, { recursive: true, force: true })
    watcher?.close()
    const err = e as { code?: string; message?: string }
    if (err.code === 'EADDRINUSE') throw new CliError(`port ${opts.port} is already in use; pass --port <other>, or leave it out for any free port`)
    throw new CliError(`could not start the local server: ${err.message ?? String(e)}`)
  }
  port = server.port as number

  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    root,
    jobs,
    stop() {
      for (const j of running()) j.stop?.('the server was stopped')
      watcher?.close()
      for (const t of timers.values()) clearTimeout(t)
      for (const c of reloadClients) { try { c.close() } catch { /* already closed */ } }
      reloadClients.clear()
      void server.stop(true)
      rmSync(scratch, { recursive: true, force: true })
    },
  }
}

function launchBrowser(url: string, io: Io): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open'
  const bin = cmd ? Bun.which(cmd) : null
  if (!bin) return void io.log(`cannot open a browser on this platform; open ${url} yourself`)
  try {
    Bun.spawn([bin, url], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  } catch (e) {
    io.log(`could not open the browser (${(e as Error).message}); open ${url} yourself`)
  }
}

export async function serve(opts: ServeOptions, io: Io): Promise<number> {
  const home = await startHome(opts, io)
  onCleanup(() => home.stop())
  const url = `${home.origin}/`
  io.out(io.json ? JSON.stringify({ url, port: home.port, root: home.root }) + '\n' : url + '\n')
  io.log(`serving ${home.root} (${readdirSync(home.root).length} entries); the home API is under ${home.origin}/api; press Ctrl+C to stop`)
  if (opts.open) launchBrowser(url, io)
  // keep running until a signal arrives (handled by the cleanup hooks)
  await new Promise<never>(() => {})
  return 0
}

/** `mimir serve …` from its own arguments (what the command line calls). */
export async function serveCommand(argv: readonly string[], io: Io): Promise<number> {
  return serve(toServeOptions(parseFlags(SERVE_SPEC, argv)), io)
}

// `bun src/cli/commands/serve.ts [dir] …` runs the command on its own (the same code `mimir serve` calls)
if (import.meta.main) await standalone(SERVE_SPEC, serveCommand)
