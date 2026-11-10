// One headless run: local server + one Chrome + one page that has loaded the scene and resolved __mimir.ready.
// check, shot and export all go through this, so a browser is launched once per command and always closed.
import { launchChrome, PageError, type Browser, type ConsoleLevel, type Page } from './chrome.ts'
import { CliError } from './errors.ts'
import { normalizeInfo, type SceneInfo } from './format.ts'
import type { SceneRef } from './paths.ts'
import { locateFatal } from './preparse.ts'
import { startServer, type MimirServer } from './server.ts'

export interface SessionOptions {
  scene: SceneRef
  viewerRoot: string
  width: number
  height: number
  scale: number
  /** add headless=1 to the page URL (the default for check and shot) */
  headless?: boolean
  log?: (message: string) => void
  onRequest?: (pathname: string, status: number) => void
}

export interface Session {
  browser: Browser
  page: Page
  server: MimirServer
  info: SceneInfo
  pageUrl: string
  /** ms spent launching the browser, and from launch to ready */
  timing: { launch: number; ready: number }
  /** console errors the page produced so far */
  consoleErrors: string[]
  /** call a host-protocol method and get its (JSON-serialisable) result */
  host<T = unknown>(method: string, ...args: unknown[]): Promise<T>
  /**
   * Another page of the same browser with the same scene loaded headless (nothing moves on its own), at its own size.
   * It gets a window of its own, so it renders while other pages do.
   */
  scenePage(width: number, height: number, scale: number): Promise<Page>
  close(): Promise<void>
}

/** MIMIR_TIMEOUT (ms) bounds how long a scene may take to become ready, and each later page call. */
export function timeoutFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MIMIR_TIMEOUT)
  return Number.isFinite(n) && n >= 100 ? n : 30_000
}

/** Page-side wait: __mimir appears, then its ready promise settles. Returns a JSON string. */
export function readyExpression(timeoutMs: number): string {
  return `(async () => {
  const deadline = performance.now() + ${timeoutMs};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  while (!(window.__mimir && window.__mimir.ready)) {
    if (performance.now() > deadline) return JSON.stringify({ state: 'no-host' });
    await sleep(10);
  }
  let rejected = null;
  const settled = Promise.resolve(window.__mimir.ready).then(() => true, (e) => { rejected = String((e && (e.stack || e.message)) || e); return true; });
  const ok = await Promise.race([settled, sleep(Math.max(0, deadline - performance.now())).then(() => false)]);
  if (!ok) return JSON.stringify({ state: 'not-ready' });
  let info = null;
  try { info = window.__mimir.info(); } catch (e) { rejected = rejected || String((e && (e.stack || e.message)) || e); }
  return JSON.stringify({ state: 'ready', rejected, info });
})()`
}

/** Expression that calls window.__mimir[method](...args), awaits it and returns the result as a JSON string. */
export function hostExpression(method: string, args: readonly unknown[]): string {
  const list = args.map((a) => JSON.stringify(a) ?? 'undefined').join(', ')
  return `Promise.resolve(window.__mimir[${JSON.stringify(method)}](${list})).then((v) => JSON.stringify(v === undefined ? null : v))`
}

/** What a scene that never finishes building is reported as: a fatal load error (RUNTIME-ERROR, exit 1), like one that throws. */
export function stuckInfo(timeoutMs: number): SceneInfo {
  const info = normalizeInfo({})
  info.fatal = {
    message:
      `the scene never finished building (waited ${timeoutMs} ms): it is stuck in an endless loop or in a top-level await ` +
      'that never resolves. Look for a `while` / `for` whose condition never becomes false, or an awaited promise ' +
      '(fetch, a timer) that never settles. MIMIR_TIMEOUT=<ms> raises the limit.',
    file: null, line: null,
  }
  return info
}
const isBrowserTimeout = (e: unknown): boolean => e instanceof Error && /timed out after \d+ ms waiting for the browser to answer/.test(e.message)

export async function waitReady(page: Page, timeoutMs: number, what: string): Promise<SceneInfo> {
  let raw: string | undefined
  for (let attempt = 0; ; attempt++) {
    try {
      raw = await page.evaluate<string>(readyExpression(timeoutMs), timeoutMs + 5_000)
      break
    } catch (e) {
      // a page whose main thread is blocked (an endless loop in the scene) cannot answer at all
      if (isBrowserTimeout(e)) return stuckInfo(timeoutMs)
      // the evaluation can race the navigation; the new document gets a fresh context
      const transient = e instanceof Error && /context was destroyed|Cannot find context|navigated or closed/i.test(e.message)
      if (!transient || attempt >= 5) throw e
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  const r = JSON.parse(raw!) as { state: string; rejected?: string | null; info?: unknown }
  if (r.state === 'no-host') {
    throw new CliError(`timed out after ${timeoutMs} ms: ${what} never defined window.__mimir (is this a Mimir viewer?)`)
  }
  // the page answers but the scene's promise never settles (a top-level await on something that never resolves)
  if (r.state === 'not-ready') return stuckInfo(timeoutMs)
  const info = normalizeInfo(r.info)
  if (r.rejected && !info.fatal) info.fatal = { message: r.rejected, file: null, line: null }
  return info
}

export async function openSession(opts: SessionOptions): Promise<Session> {
  const log = opts.log ?? (() => {})
  const timeoutMs = timeoutFromEnv()
  const consoleErrors: string[] = []
  const onConsole = (level: ConsoleLevel, text: string): void => {
    if (level === 'error') consoleErrors.push(text)
    process.stderr.write(`[page ${level}] ${text}\n`)
  }
  const server = startServer({ viewerRoot: opts.viewerRoot, sceneDir: opts.scene.dir, port: 0, onRequest: opts.onRequest })
  let browser: Browser | null = null
  try {
    const t0 = performance.now()
    browser = await launchChrome({ onConsole })
    const t1 = performance.now()
    const page = await browser.newPage(opts.width, opts.height, opts.scale)
    const pageUrl =
      `${server.origin}/viewer.html?scene=${encodeURIComponent(opts.scene.url)}` + (opts.headless === false ? '' : '&headless=1')
    let info: SceneInfo
    try {
      await page.navigate(pageUrl, timeoutMs)
      info = await waitReady(page, timeoutMs, pageUrl)
    } catch (e) {
      if (!isBrowserTimeout(e)) throw e
      info = stuckInfo(timeoutMs) // the navigation itself never returned: the module blocks the page while it loads
    }
    // the browser reports a module that does not parse without a position; the files are on disk, so find it here
    if (info.fatal) info.fatal = locateFatal(info.fatal, opts.scene.path)
    const t2 = performance.now()
    log(`browser ${Math.round(t1 - t0)} ms, scene ready ${Math.round(t2 - t1)} ms`)
    const owned = browser
    return {
      browser: owned,
      page,
      server,
      info,
      pageUrl,
      timing: { launch: t1 - t0, ready: t2 - t1 },
      consoleErrors,
      async host<T>(method: string, ...args: unknown[]): Promise<T> {
        try {
          const raw = await page.evaluate<string>(hostExpression(method, args), timeoutMs)
          return JSON.parse(raw) as T
        } catch (e) {
          if (e instanceof PageError) throw new CliError(`the viewer threw in __mimir.${method}(): ${e.message}`)
          throw e
        }
      },
      async scenePage(w: number, h: number, scale: number): Promise<Page> {
        const extra = await owned.newPage(w, h, scale, { window: true })
        const url = `${server.origin}/viewer.html?scene=${encodeURIComponent(opts.scene.url)}&headless=1`
        await extra.navigate(url, timeoutMs)
        const again = await waitReady(extra, timeoutMs, url)
        if (again.fatal) throw new CliError(`the scene failed to load in a second page: ${again.fatal.message.split('\n')[0]}`)
        return extra
      },
      async close() {
        await owned.close()
        server.stop()
      },
    }
  } catch (e) {
    if (browser) await browser.close()
    server.stop()
    throw e
  }
}
