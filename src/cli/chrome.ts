// Headless driver: a full Chrome-family browser with --headless=new over raw CDP on a WebSocket. No puppeteer, no
// playwright. chrome-headless-shell is deliberately not searched for: it renders WebGL on the CPU, so its frames are
// not the frames a person sees.
// This is the ONE place that knows where browsers are installed (docs/OSS-HYGIENE.md, rule 2): every other file asks
// findChrome() / launchChrome(). MIMIR_CHROME names a binary and always wins.
// Platforms: macOS is what the project is developed and tested on. The Linux and Windows search lists and the
// Windows process handling below are written from the browsers' documented install locations and have not been run
// on those systems; launchChrome says so once on Windows.
// Wall-clock is used here only for timeouts; nothing in this file influences rendered pixels.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { CliError } from './errors.ts'

// ── locating a browser ───────────────────────────────────────────────────────────────────────────

const MAC_APPS = [
  'Google Chrome.app/Contents/MacOS/Google Chrome',
  'Chromium.app/Contents/MacOS/Chromium',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'Brave Browser.app/Contents/MacOS/Brave Browser',
  'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
]
/** command names of the browsers on Linux, in preference order (looked up on PATH first, then in the directories below) */
const LINUX_NAMES = [
  'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser',
  'microsoft-edge-stable', 'microsoft-edge', 'brave-browser',
]
/** where a distribution package, snap or a manual install puts those commands when PATH does not have them */
const LINUX_DIRS = ['/usr/bin', '/usr/local/bin', '/bin', '/snap/bin']
const LINUX_PATHS = ['/opt/google/chrome/chrome', '/usr/lib/chromium/chromium', '/usr/lib64/chromium-browser/chromium-browser']
/** Flatpak exports a launcher per application id, system-wide and per user */
const FLATPAK_IDS = ['com.google.Chrome', 'org.chromium.Chromium', 'com.microsoft.Edge', 'com.brave.Browser']
/** browser binaries below a Windows program directory (Program Files, Program Files (x86), the per-user Local AppData) */
const WINDOWS_APPS = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Chromium', 'Application', 'chrome.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
]
const WINDOWS_NAMES = ['chrome.exe', 'chromium.exe', 'msedge.exe', 'brave.exe']

/**
 * Candidate binaries in preference order for a platform (pure; used by findChrome and its tests). `env` supplies the
 * Windows program directories (ProgramFiles, ProgramFiles(x86), LOCALAPPDATA); the paths are built with the path rules
 * of the platform asked about, not of the one this runs on.
 */
export function chromeCandidates(platform: string, home: string, env: Record<string, string | undefined> = {}): string[] {
  if (platform === 'darwin') {
    return ['/Applications', posix.join(home, 'Applications')].flatMap((dir) => MAC_APPS.map((app) => posix.join(dir, app)))
  }
  if (platform === 'win32') {
    const roots = [env.ProgramFiles ?? env.PROGRAMFILES, env['ProgramFiles(x86)'] ?? env['PROGRAMFILES(X86)'], env.LOCALAPPDATA ?? (home ? win32.join(home, 'AppData', 'Local') : undefined)]
      .filter((r): r is string => typeof r === 'string' && r !== '')
    return WINDOWS_APPS.flatMap((app) => roots.map((root) => win32.join(root, ...app)))
  }
  return [
    ...LINUX_DIRS.flatMap((d) => LINUX_NAMES.map((n) => posix.join(d, n))),
    ...LINUX_PATHS,
    ...['/var/lib/flatpak/exports/bin', posix.join(home, '.local/share/flatpak/exports/bin')].flatMap((d) => FLATPAK_IDS.map((id) => posix.join(d, id))),
  ]
}

/** Command names looked up on PATH for a platform, before the fixed locations (a browser on PATH is the user's choice). */
export function chromeCommands(platform: string): string[] {
  return platform === 'darwin' ? [] : platform === 'win32' ? WINDOWS_NAMES : LINUX_NAMES
}

/** What to tell someone whose browser was not found, for their platform. */
export function chromeMissingMessage(platform: string): string {
  const where = platform === 'darwin' ? 'in /Applications and ~/Applications'
    : platform === 'win32' ? 'on PATH and in Program Files, Program Files (x86) and the Local AppData folder'
    : 'on PATH, in the usual system directories, in /snap/bin and in the Flatpak exports'
  const install = platform === 'darwin' ? 'Install one (for example Google Chrome)'
    : platform === 'win32' ? 'Install one (for example Google Chrome or Microsoft Edge)'
    : 'Install one with your package manager (for example chromium or google-chrome-stable)'
  const example = platform === 'win32' ? 'MIMIR_CHROME=C:\\path\\to\\chrome.exe' : 'MIMIR_CHROME=/path/to/chrome'
  return `no Chrome-family browser found (looked for Google Chrome, Chromium, Microsoft Edge and Brave ${where}). ${install}, or set ${example} to the browser binary.`
}

/**
 * Path of the browser to drive. MIMIR_CHROME wins; a set but missing MIMIR_CHROME is an error, not a fallback.
 * `probe` lets a test stand in for the platform, the file system and PATH.
 */
export function findChrome(
  env: Record<string, string | undefined> = process.env,
  probe: { platform: string; home: string; exists(path: string): boolean; which(name: string): string | null } = {
    platform: process.platform, home: homedir(), exists: existsSync, which: (name) => Bun.which(name, { PATH: env.PATH ?? process.env.PATH ?? '' }),
  },
): string {
  const override = env.MIMIR_CHROME
  if (override !== undefined && override !== '') {
    if (!probe.exists(override)) throw new CliError(`MIMIR_CHROME points to a file that does not exist: ${override}`)
    return override
  }
  for (const name of chromeCommands(probe.platform)) {
    const hit = probe.which(name)
    if (hit) return hit
  }
  for (const p of chromeCandidates(probe.platform, probe.home, env)) if (probe.exists(p)) return p
  throw new CliError(chromeMissingMessage(probe.platform))
}

/**
 * Extra browser flags from MIMIR_CHROME_ARGS: a JSON array of strings (an argument may then contain spaces, such as a
 * path), or plain text split at white space.
 */
export function chromeExtraArgs(value: string | undefined): string[] {
  const text = (value ?? '').trim()
  if (text === '') return []
  if (text.startsWith('[')) {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch (e) { throw new CliError(`MIMIR_CHROME_ARGS starts with "[" but is not a JSON array: ${(e as Error).message}. Write ["--flag", "--other=value with spaces"] or plain flags separated by spaces.`) }
    if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== 'string')) throw new CliError('MIMIR_CHROME_ARGS must be a JSON array of strings, for example ["--no-sandbox"]')
    return (parsed as string[]).filter((a) => a !== '')
  }
  return text.split(/\s+/).filter((a) => a !== '')
}

/** What the browser printed when it refused to start for lack of a sandbox, turned into what to do about it; null otherwise. */
export function sandboxHint(output: string): string | null {
  return /no usable sandbox|sandbox_host|setuid sandbox|running as root without --no-sandbox|namespace sandbox failed/i.test(output)
    ? 'The browser could not set up its sandbox (common in containers and CI without user namespaces). If you trust the scenes you run, start it without one: MIMIR_CHROME_ARGS=--no-sandbox'
    : null
}

// ── process-wide cleanup: Chrome must never outlive the CLI ────────────────────────────────────────────

interface Cleanup {
  /** last resort, runs inside the 'exit' event where nothing can be awaited */
  sync: () => void
  /** preferred on signals: may wait until processes are really gone before removing their files */
  async?: () => Promise<void>
}
const cleanups = new Set<Cleanup>()
let hooked = false
let termination: Promise<never> | null = null

/** Run every registered cleanup now (synchronous; safe to call twice). */
export function runCleanups(): void {
  for (const c of [...cleanups]) {
    cleanups.delete(c)
    try {
      c.sync()
    } catch {
      // best effort
    }
  }
}

/**
 * Non-null once a signal has started tearing the process down. From then on the signal path owns the exit:
 * nothing else may call process.exit or report errors, because killing the browser makes whatever was in
 * flight fail (a launch, a page call), and exiting on that failure would skip the rest of the teardown.
 */
export function terminationInProgress(): Promise<never> | null {
  return termination
}

/** Signal path: tear everything down properly (awaiting what must be awaited), then exit with the signal's code. */
function terminate(code: number): Promise<never> {
  if (termination) return termination
  termination = (async (): Promise<never> => {
    await Promise.all(
      [...cleanups].map(async (c) => {
        try {
          if (c.async) await c.async()
          else c.sync()
        } catch {
          // best effort
        }
        // only now: if the process is exited from elsewhere meanwhile, the 'exit' hook still finds this entry
        cleanups.delete(c)
      }),
    )
    process.exit(code)
  })()
  return termination
}

/**
 * Register a cleanup that runs on exit and on SIGINT / SIGTERM / SIGHUP. `sync` is the fallback for the 'exit'
 * event; `async`, when given, is what signals use. Returns its remover.
 */
export function onCleanup(sync: () => void, async?: () => Promise<void>): () => void {
  if (!hooked) {
    hooked = true
    process.on('exit', runCleanups)
    const bySignal: Array<[NodeJS.Signals, number]> = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]
    for (const [sig, code] of bySignal) process.on(sig, () => void terminate(code))
  }
  const entry: Cleanup = { sync, async }
  cleanups.add(entry)
  return () => cleanups.delete(entry)
}

// ── CDP connection ───────────────────────────────────────────────────────────────────────────────

export interface CdpEvent { method: string; params: Record<string, any>; sessionId?: string }
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class Cdp {
  private nextId = 0
  private pending = new Map<number, Pending>()
  private listeners = new Set<(e: CdpEvent) => void>()
  private closed: string | null = null

  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (typeof m.id === 'number') {
        const p = this.pending.get(m.id)
        if (!p) return
        this.pending.delete(m.id)
        clearTimeout(p.timer)
        if (m.error) p.reject(new Error(`${m.error.message ?? 'CDP error'}${m.error.data ? `: ${m.error.data}` : ''}`))
        else p.resolve(m.result)
      } else if (typeof m.method === 'string') {
        for (const fn of [...this.listeners]) fn(m as CdpEvent)
      }
    }
    ws.onclose = () => this.fail('the browser closed the DevTools connection')
    ws.onerror = () => this.fail('the DevTools connection failed')
  }

  static connect(url: string, timeoutMs: number): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const timer = setTimeout(() => {
        try {
          ws.close()
        } catch {
          // already closed
        }
        reject(new CliError(`timed out after ${timeoutMs} ms connecting to the browser's DevTools endpoint ${url}`))
      }, timeoutMs)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve(new Cdp(ws))
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new CliError(`could not connect to the browser's DevTools endpoint ${url}`))
      }
    })
  }

  private fail(reason: string): void {
    if (this.closed) return
    this.closed = reason
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new CliError(reason))
    }
    this.pending.clear()
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new CliError(this.closed))
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CliError(`timed out after ${timeoutMs} ms waiting for the browser to answer ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
    })
  }

  on(fn: (e: CdpEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  close(): void {
    this.fail('the DevTools connection was closed')
    try {
      this.ws.close()
    } catch {
      // already closed
    }
  }
}

// ── page ─────────────────────────────────────────────────────────────────────────────────────────

export type ConsoleLevel = 'error' | 'warning'
export type ConsoleSink = (level: ConsoleLevel, text: string) => void

/** An exception thrown by code evaluated in the page. */
export class PageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageError'
  }
}

function describeArg(a: Record<string, any>): string {
  if (a.type === 'string') return String(a.value)
  if ('value' in a) return typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value)
  return String(a.description ?? a.unserializableValue ?? a.type)
}

export class Page {
  constructor(private cdp: Cdp, readonly sessionId: string, readonly targetId: string) {}

  send<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    return this.cdp.send<T>(method, params, this.sessionId, timeoutMs)
  }

  /** CSS-pixel viewport and device scale factor. PNG pixels = size × scale. */
  async setViewport(width: number, height: number, scale: number): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
  }

  async navigate(url: string, timeoutMs = 30_000): Promise<void> {
    const r = await this.send<{ errorText?: string }>('Page.navigate', { url }, timeoutMs)
    if (r.errorText) throw new CliError(`the browser could not load ${url}: ${r.errorText}`)
  }

  /** Evaluate an expression (promises are awaited) and return its value. Page exceptions become PageError. */
  async evaluate<T = unknown>(expression: string, timeoutMs = 30_000): Promise<T> {
    const r = await this.send<{ result: { value?: T }; exceptionDetails?: Record<string, any> }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs,
    )
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception
      throw new PageError(String(ex?.description ?? ex?.value ?? r.exceptionDetails.text ?? 'page exception'))
    }
    return r.result.value as T
  }

  /**
   * A PNG of the viewport. `fast` asks the browser for its quickest PNG encoding: the pixels are the same, the file
   * is larger and its bytes differ from the default encoding (video frames: nobody keeps or hashes those files).
   */
  async screenshot(timeoutMs = 30_000, opts: { fast?: boolean } = {}): Promise<Uint8Array> {
    const r = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(opts.fast ? { optimizeForSpeed: true } : {}) }, timeoutMs)
    return new Uint8Array(Buffer.from(r.data, 'base64'))
  }

  async close(): Promise<void> {
    try {
      await this.cdp.send('Target.closeTarget', { targetId: this.targetId }, undefined, 5_000)
    } catch {
      // the browser is going away anyway
    }
  }
}

// ── the browser process and its profile ──────────────────────────────────────────────────────────────────

function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 })
  } catch {
    // retried by the callers that need a guarantee
  }
}

/**
 * One Chrome with its throwaway profile. Chrome is started as the leader of its OWN process group, so the
 * browser and every helper (GPU, network, renderers; also one that is being forked at that instant) can be
 * killed with a single signal to the group.
 *
 * Why this matters: a helper that outlives the browser re-creates the profile directory. Measured here: killing
 * only the browser process about 30 ms after start left an orphaned GPU process alive for up to 75 ms, and the
 * profile directory was back after it had been removed (8 of 10 runs). So the profile is removed only after the
 * whole group is gone, and the removal is checked.
 */
export class ChromeProcess {
  /** alive → killing (an awaited teardown is in flight) → removed (processes gone, profile deleted) */
  private state: 'alive' | 'killing' | 'removed' = 'alive'
  private killing: Promise<void> | null = null
  private removeCleanup: () => void

  constructor(readonly proc: ReturnType<typeof Bun.spawn>, readonly profileDir: string) {
    this.removeCleanup = onCleanup(() => this.killSync(), () => this.kill())
  }

  get pid(): number {
    return this.proc.pid
  }

  /** SIGKILL to the whole process group (falls back to the browser process alone). Windows has no process groups: taskkill ends the process tree. */
  private signalGroup(): void {
    if (process.platform === 'win32') {
      try { Bun.spawnSync(['taskkill', '/pid', String(this.proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' }) } catch { /* no taskkill: fall through */ }
      try { this.proc.kill() } catch { /* already gone */ }
      return
    }
    try {
      process.kill(-this.proc.pid, 'SIGKILL')
    } catch {
      try {
        this.proc.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
  }

  /** True while any process of Chrome's group exists. Only meaningful once the browser child has been reaped. */
  private groupAlive(): boolean {
    if (process.platform === 'win32') return false // nothing to probe: taskkill /T ended the tree
    try {
      process.kill(-this.proc.pid, 0)
      return true
    } catch (e) {
      return (e as { code?: string }).code !== 'ESRCH'
    }
  }

  /** Wait until the browser has exited and its process group is empty. False when that takes longer than the limit. */
  private async gone(timeoutMs: number): Promise<boolean> {
    const deadline = performance.now() + timeoutMs
    const exited = await Promise.race([this.proc.exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))])
    if (!exited) return false
    while (this.groupAlive()) {
      if (performance.now() > deadline) return false
      await new Promise((r) => setTimeout(r, 5))
    }
    return true
  }

  /**
   * Kill the browser and its helpers, wait until they are really gone, then remove the profile.
   * `graceMs` > 0 first gives Chrome that long to exit on its own (after Browser.close).
   */
  kill(graceMs = 0): Promise<void> {
    // every caller waits for the same teardown; a second call never returns before the first has finished
    this.killing ??= this.teardown(graceMs)
    return this.killing
  }

  private async teardown(graceMs: number): Promise<void> {
    if (this.state !== 'alive') return
    this.state = 'killing'
    if (graceMs > 0) await this.gone(graceMs)
    this.signalGroup()
    const clean = await this.gone(3_000)
    // killSync may have finished the job while this was waiting (the process is exiting)
    if ((this.state as string) === 'removed') return
    removeDir(this.profileDir)
    // not provably quiet (or the directory is somehow back): fall back to watching it
    if (!clean || existsSync(this.profileDir)) this.removeUntilQuiet()
    this.state = 'removed'
    this.removeCleanup()
  }

  /**
   * Synchronous last resort for the 'exit' event, where nothing can be awaited and the killed child cannot be
   * reaped (so the group cannot be probed): kill the group, then keep removing the profile until it has stayed
   * absent for 100 ms (at most 1.5 s). Also completes a kill() that was still waiting when the process exits.
   */
  killSync(): void {
    if (this.state === 'removed') return
    this.state = 'removed'
    this.removeCleanup()
    this.signalGroup()
    this.removeUntilQuiet()
  }

  private removeUntilQuiet(): void {
    const step = 20
    let quiet = 0
    for (let waited = 0; waited < 1_500 && quiet < 100; waited += step) {
      if (existsSync(this.profileDir)) {
        removeDir(this.profileDir)
        quiet = 0
      } else quiet += step
      Bun.sleepSync(step)
    }
    removeDir(this.profileDir)
  }
}

// ── browser ──────────────────────────────────────────────────────────────────────────────────────

export interface LaunchOptions {
  /** ms to wait for the DevTools endpoint */
  timeoutMs?: number
  env?: Record<string, string | undefined>
  /** called for console errors / warnings, uncaught exceptions and failed requests of every page */
  onConsole?: ConsoleSink
}

export class Browser {
  constructor(
    readonly binary: string,
    private chrome: ChromeProcess,
    readonly cdp: Cdp,
    private onConsole: ConsoleSink | undefined,
  ) {}

  get pid(): number {
    return this.chrome.pid
  }

  get profileDir(): string {
    return this.chrome.profileDir
  }

  /**
   * A new page. `window: true` gives it a window of its own: only the front tab of a window gets animation frames
   * (measured: a second tab's requestAnimationFrame never fired), so pages that render at the same time need one each.
   */
  async newPage(width: number, height: number, scale: number, opts: { window?: boolean } = {}): Promise<Page> {
    const { targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', ...(opts.window ? { newWindow: true } : {}) })
    const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(this.cdp, sessionId, targetId)
    const sink = this.onConsole
    if (sink) {
      this.cdp.on((e) => {
        if (e.sessionId !== sessionId) return
        if (e.method === 'Runtime.consoleAPICalled') {
          const type = e.params.type as string
          const level: ConsoleLevel | null = type === 'error' || type === 'assert' ? 'error' : type === 'warning' ? 'warning' : null
          if (level) sink(level, (e.params.args as Record<string, any>[]).map(describeArg).join(' '))
        } else if (e.method === 'Runtime.exceptionThrown') {
          const d = e.params.exceptionDetails as Record<string, any>
          sink('error', String(d.exception?.description ?? d.exception?.value ?? d.text ?? 'uncaught exception'))
        } else if (e.method === 'Log.entryAdded') {
          const entry = e.params.entry as Record<string, any>
          if (entry.level === 'error') sink('error', `${entry.text}${entry.url ? ` (${entry.url})` : ''}`)
        }
      })
    }
    await Promise.all([page.send('Page.enable'), page.send('Runtime.enable'), page.send('Log.enable')])
    await page.setViewport(width, height, scale)
    return page
  }

  /**
   * Ask Chrome to quit (Browser.close), give it 2 s, then kill whatever is left of its process group, wait for
   * it to be gone and remove the profile. Safe to call twice.
   */
  async close(): Promise<void> {
    try {
      await this.cdp.send('Browser.close', {}, undefined, 1_000)
    } catch {
      // fall through to the kill
    }
    this.cdp.close()
    await this.chrome.kill(2_000)
  }
}

export const CHROME_FLAGS = [
  '--headless=new',
  '--remote-debugging-port=0', // Chrome picks a free port and prints the endpoint on stderr
  // Lifeline, not a transport (CDP runs on the WebSocket above): Chrome also listens on fd 3 and quits by itself
  // when that pipe closes, which happens when this process dies in a way no handler can see (SIGKILL).
  // Measured: parent SIGKILLed → 7 Chrome processes gone within 95 ms; without it they ran on indefinitely.
  // (POSIX only: chromeFlags() leaves it out on Windows, where the pipe is passed as handles this launcher does not set up.)
  '--remote-debugging-pipe',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-features=Translate,MediaRouter,OptimizationHints',
  '--mute-audio',
  // Pages that render at the same time each have a window; a window that another one covers must keep its animation
  // frames and timers (measured: with four windows one of them stopped answering after about 50 frames without these).
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  // A frame must be a function of its time alone, never of the frames drawn before it (measured: the same time shot
  // after different histories differed by a few antialiasing levels on up to 40 px until both of these were set).
  '--disable-partial-raster', // a tile is rastered whole, not patched over the pixels of the frame before
  '--disable-gpu-rasterization', // 2D content is rastered on the CPU: the GPU path caches remember earlier scales. WebGL is unaffected
]

/** The flags for a platform: all of CHROME_FLAGS, without the fd 3 / fd 4 lifeline on Windows. */
export const chromeFlags = (platform: string): string[] => (platform === 'win32' ? CHROME_FLAGS.filter((f) => f !== '--remote-debugging-pipe') : [...CHROME_FLAGS])

/** The command that lists the command line of every running process on a platform (one per line), or null when there is none to rely on. */
export function processListCommand(platform: string): string[] | null {
  return platform === 'win32' ? null : ['ps', '-axo', 'command=']
}

/**
 * Remove browser profiles that an earlier run left behind (it was SIGKILLed: no handler ran): directories named
 * mimir-chrome-* in `tmp` that are older than `maxAgeMs` and that no running process mentions. Returns what it removed.
 */
export function sweepStaleProfiles(tmp: string, maxAgeMs = 10 * 60_000, now = Date.now()): string[] {
  let names: string[]
  try { names = readdirSync(tmp) } catch { return [] }
  const old = names.filter((n) => n.startsWith('mimir-chrome-')).map((n) => join(tmp, n)).filter((p) => {
    try { const st = statSync(p); return st.isDirectory() && now - st.mtimeMs > maxAgeMs } catch { return false }
  })
  if (!old.length) return []
  const list = processListCommand(process.platform)
  if (!list) return [] // cannot tell what is alive on this platform: touch nothing
  let running = ''
  try { const r = Bun.spawnSync(list); if (r.exitCode !== 0) return []; running = r.stdout.toString() } catch { return [] } // cannot tell what is alive: touch nothing
  const removed: string[] = []
  for (const p of old) if (!running.includes(p)) { removeDir(p); removed.push(p) }
  return removed
}

let warnedWindows = false
/** Said once per process on Windows: what is known not to have been run there. */
function warnWindowsOnce(): void {
  if (warnedWindows) return
  warnedWindows = true
  process.stderr.write('mimir: note: Windows is untested. Browser discovery, starting the browser and ending its process tree are written for it but have never been run there; if something fails, MIMIR_CHROME=<path to chrome.exe or msedge.exe> is the first thing to set, and WSL runs the Linux path.\n')
}

/** Start Chrome with a throwaway profile and connect to it. The caller must close() it; signals are covered. */
export async function launchChrome(opts: LaunchOptions = {}): Promise<Browser> {
  const env = opts.env ?? process.env
  const timeoutMs = opts.timeoutMs ?? 20_000
  const binary = findChrome(env)
  if (/headless[-_ ]shell/i.test(binary)) {
    process.stderr.write('mimir: warning: chrome-headless-shell renders WebGL on the CPU; frames will not match what users see\n')
  }
  // the temp directory of the environment this launch was given (the tests pass their own), not a process global
  const tmp = env.TMPDIR !== undefined && env.TMPDIR !== '' ? env.TMPDIR : tmpdir()
  sweepStaleProfiles(tmp)
  const profileDir = mkdtempSync(join(tmp, 'mimir-chrome-'))
  const windows = process.platform === 'win32'
  if (windows) warnWindowsOnce()
  const args = [...chromeFlags(process.platform), `--user-data-dir=${profileDir}`]
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox')
  try { args.push(...chromeExtraArgs(env.MIMIR_CHROME_ARGS)) } catch (e) { removeDir(profileDir); throw e }
  args.push('about:blank')

  let proc: ReturnType<typeof Bun.spawn>
  try {
    // detached = its own process group, so the browser and all its helpers can be killed together.
    // fd 3 / fd 4 are the DevTools pipe of --remote-debugging-pipe; nothing is ever written to or read from them.
    proc = windows
      ? Bun.spawn([binary, ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
      : Bun.spawn([binary, ...args], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], detached: true })
  } catch (e) {
    removeDir(profileDir)
    throw new CliError(`could not start the browser ${binary}: ${(e as Error).message}`)
  }
  // from here on a signal, an exit or an error tears the whole process group down and removes the profile
  const chrome = new ChromeProcess(proc, profileDir)

  let tail = ''
  const endpoint = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new CliError(`timed out after ${timeoutMs} ms waiting for ${binary} to start (last output: ${tail.slice(-300).trim() || 'none'})`)),
      timeoutMs,
    )
    const done = (fn: () => void): void => {
      clearTimeout(timer)
      fn()
    }
    void (async () => {
      const decoder = new TextDecoder()
      let found = false
      // keep draining after the endpoint is found so Chrome never blocks on a full stderr pipe
      for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
        if (found) continue
        tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4000)
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(tail)
        if (m) {
          found = true
          done(() => resolve(m[1]!))
        }
      }
      if (!found) { const hint = sandboxHint(tail); done(() => reject(new CliError(`the browser exited before it was ready: ${tail.slice(-400).trim() || 'no output'}${hint ? `\n${hint}` : ''}`))) }
    })().catch((e) => done(() => reject(e instanceof Error ? e : new Error(String(e)))))
  })

  try {
    const wsUrl = await endpoint
    const cdp = await Cdp.connect(wsUrl, 10_000)
    return new Browser(binary, chrome, cdp, opts.onConsole)
  } catch (e) {
    await chrome.kill()
    throw e
  }
}
