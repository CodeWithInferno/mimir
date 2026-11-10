// Drives the real player for the e2e tests (tests/e2e/player*.test.ts): a tiny server that serves the built viewer,
// one scene directory and, when asked, a mock of the home API; full Chrome headless over raw CDP, as the CLI does;
// real key, mouse and touch events. Not a test file itself.
import { mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { launchChrome, type Browser, type Page } from '../../../src/cli/chrome.ts'
import { ensureViewer } from '../../../src/cli/paths.ts'
import { contentType } from '../../../src/cli/server.ts'

export const ROOT = resolve(import.meta.dir, '..', '..', '..')
export const FIXTURE = join(ROOT, 'tests', 'e2e', 'scenes', 'player', 'tour.scene.js')

/** What the mock of `mimir serve` answers. Every part is optional: a server without one answers 404 for it. */
export interface MockApi {
  scenes?: { id: string; title: string; kind?: string; updated?: string | number; thumb?: string }[]
  /** POST /api/new answers this id; GET /api/new/<id>/events then sends `events`, one every `everyMs`, and keeps the stream open */
  build?: { id: string; events: Record<string, unknown>[]; everyMs?: number }
  /** GET and HEAD /api/export answer with this body */
  exportHtml?: string
  /** what the viewer page declares in <meta name="mimir-server"> */
  declare?: string
}
export interface Drive {
  page: Page; origin: string; errors: string[]; requests: string[]; posts: { path: string; body: string }[]
  url(query?: string): string
  open(query?: string, o?: { ready?: boolean }): Promise<void>
  ev<T = unknown>(js: string): Promise<T>
  key(k: string, mods?: number): Promise<void>
  type(text: string): Promise<void>
  click(x: number, y: number): Promise<void>
  /** click the middle of the first element a selector matches */
  clickOn(selector: string): Promise<void>
  move(x: number, y: number): Promise<void>
  drag(x0: number, y0: number, x1: number, y1: number): Promise<void>
  tap(x: number, y: number): Promise<void>
  wait(ms: number): Promise<void>
  /** poll an expression until it is truthy */
  until(js: string, timeoutMs?: number): Promise<void>
  shot(file: string): Promise<void>
  close(): Promise<void>
}
const KEYS: Record<string, [string, number]> = { ' ': ['Space', 32], Escape: ['Escape', 27], Enter: ['Enter', 13], Tab: ['Tab', 9], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], Home: ['Home', 36], End: ['End', 35], PageDown: ['PageDown', 34], PageUp: ['PageUp', 33], '/': ['Slash', 191], '?': ['Slash', 191], '[': ['BracketLeft', 219], ']': ['BracketRight', 221] }
/** modifier bits of CDP's Input events */
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
/** a 1 × 1 px PNG, for the frames and thumbnails of the mock */
const PIXEL = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

export async function drive(o: { scene?: string | null; width?: number; height?: number; touch?: boolean; api?: MockApi; env?: Record<string, string | undefined> } = {}): Promise<Drive> {
  const viewer = await ensureViewer(o.env ?? process.env)
  const scene = o.scene === null ? null : resolve(o.scene ?? FIXTURE)
  const api = o.api ?? {}
  const requests: string[] = [], posts: { path: string; body: string }[] = [], errors: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 0,
    async fetch(req) {
      const u = new URL(req.url), p = u.pathname
      requests.push(`${req.method} ${p}`)
      const json = (v: unknown): Response => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
      if (p === '/api/scenes' && api.scenes) return json(api.scenes)
      if (p === '/api/new' && req.method === 'POST' && api.build) { posts.push({ path: p, body: await req.text() }); return json({ id: api.build.id }) }
      if (api.build && p === `/api/new/${api.build.id}/events`) {
        const b = api.build, enc = new TextEncoder()
        let timer: ReturnType<typeof setInterval> | undefined
        return new Response(new ReadableStream<Uint8Array>({
          start(c) { let i = 0; c.enqueue(enc.encode(': open\n\n')); timer = setInterval(() => { if (i < b.events.length) c.enqueue(enc.encode(`data: ${JSON.stringify(b.events[i++])}\n\n`)); else clearInterval(timer) }, b.everyMs ?? 60) },
          cancel() { clearInterval(timer) },
        }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } })
      }
      if (p === '/api/export' && api.exportHtml !== undefined) return new Response(api.exportHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } }) // a HEAD gets the same headers and no body
      if (p.startsWith('/mock/') && p.endsWith('.png')) return new Response(PIXEL, { headers: { 'content-type': 'image/png' } })
      if (p === '/favicon.ico') return new Response(null, { status: 204 })
      // the fixture's directory is served to every page: one opened without a scene can still be sent to one
      if (p.startsWith('/scene/')) { const f = Bun.file(join(dirname(scene ?? FIXTURE), p.slice('/scene/'.length))); if (await f.exists()) return new Response(f, { headers: { 'content-type': contentType(p), 'cache-control': 'no-store' } }) }
      if (p === '/' || p === '/viewer.html') {
        let html = await Bun.file(join(viewer.dir, 'viewer.html')).text()
        if (api.declare) html = html.replace('</head>', `<meta name="mimir-server" content="${api.declare}">\n</head>`)
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
      }
      const f = Bun.file(join(viewer.dir, p.slice(1)))
      if (!p.includes('..') && (await f.exists())) return new Response(f, { headers: { 'content-type': contentType(p), 'cache-control': 'no-store' } })
      return new Response('not found\n', { status: 404 })
    },
  })
  const origin = `http://127.0.0.1:${server.port}`
  let browser: Browser | null = null
  try {
    browser = await launchChrome({ env: o.env, onConsole: (level, text) => { if (level === 'error') errors.push(text) } })
    const W = o.width ?? 1440, H = o.height ?? 900
    const page = await browser.newPage(W, H, 1)
    if (o.touch) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: true })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    }
    const ev = <T,>(js: string): Promise<T> => page.evaluate<T>(js)
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}): Promise<unknown> => page.send('Input.dispatchMouseEvent', { type, x, y, ...extra })
    const d: Drive = {
      page, origin, errors, requests, posts, ev, wait,
      url: (query = '') => `${origin}/viewer.html${scene ? `?scene=${encodeURIComponent('/scene/' + basename(scene))}${query ? '&' + query : ''}` : query ? '?' + query : ''}`,
      async open(query = '', { ready = true } = {}) {
        await page.navigate(d.url(query))
        await d.until('!!window.__mimir')
        if (ready) await page.evaluate('window.__mimir.ready.then(() => 1)', 30_000)
      },
      async until(js, timeoutMs = 15_000) {
        const t0 = Date.now()
        for (;;) {
          if (await ev<boolean>(`!!(${js})`).catch(() => false)) return
          if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for: ${js}`)
          await wait(30)
        }
      },
      async key(k, mods = 0) {
        const [code, vk] = KEYS[k] ?? [k.length === 1 ? (/[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : /\d/.test(k) ? 'Digit' + k : '') : k, k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0]
        const text = k.length === 1 && !(mods & (MOD.ctrl | MOD.meta)) ? k : k === 'Enter' ? '\r' : undefined
        await page.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(text ? { text } : {}) })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
      },
      async type(text) { for (const ch of text) await page.send('Input.insertText', { text: ch }) },
      async click(x, y) { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, { button: 'left', clickCount: 1 }); await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 }) },
      async clickOn(selector) {
        const at = await ev<{ x: number; y: number } | null>(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
        if (!at) throw new Error(`nothing matches ${selector}`)
        await d.click(at.x, at.y)
      },
      async move(x, y) { await mouse('mouseMoved', x, y) },
      async drag(x0, y0, x1, y1) {
        await mouse('mouseMoved', x0, y0)
        await mouse('mousePressed', x0, y0, { button: 'left', clickCount: 1 })
        for (let i = 1; i <= 8; i++) await mouse('mouseMoved', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8, { buttons: 1 })
        await mouse('mouseReleased', x1, y1, { button: 'left', clickCount: 1 })
      },
      async tap(x, y) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      },
      async shot(file) { mkdirSync(dirname(file), { recursive: true }); await Bun.write(file, await page.screenshot()) },
      async close() { await browser?.close(); await server.stop(true) },
    }
    return d
  } catch (e) {
    await browser?.close()
    await server.stop(true)
    throw e
  }
}
