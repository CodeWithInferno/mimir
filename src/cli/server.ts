// Local server shared by every command.
//   /            → viewerRoot (viewer.html and the bundles)
//   /scene/*     → the directory of the scene file, so the scene's relative imports work
//   /events      → SSE; `event: reload` whenever the scene directory or the viewer changes
//   /__mimir/*   → in-memory pages the CLI composes itself (the contact sheet)
//
// What it refuses, because a page on the open web can reach a server on this machine through the reader's browser:
//   - a request whose Host header is not this server's loopback address (403): a foreign name that resolves to
//     127.0.0.1 (DNS rebinding) never gets an answer it could read;
//   - dot files and anything inside a dot directory (.env, .git/config …), under either root (404);
//   - files whose extension is not on SERVED_EXTENSIONS (404): the server hands out what a web page loads, not
//     whatever lies next to the scene;
//   - paths outside the two roots, also through a symbolic link (404).
// It listens on 127.0.0.1 only.
import { realpathSync, watch, type FSWatcher } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { CliError } from './errors.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

export function contentType(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** The extensions the server hands out: what a scene and the viewer load (code, data, images, fonts, sound, video). */
export const SERVED_EXTENSIONS: readonly string[] = Object.keys(TYPES)

/** Extra extensions from MIMIR_SERVE_EXTENSIONS ("glb,.bin"): lowercase, each with its dot; anything that is not a plain extension is dropped. */
export function extraExtensions(env: Record<string, string | undefined>): string[] {
  return (env.MIMIR_SERVE_EXTENSIONS ?? '').split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter((e) => e !== '').map((e) => (e.startsWith('.') ? e : '.' + e)).filter((e) => /^\.[a-z0-9]+$/.test(e))
}

/** A dot file, or a file inside a dot directory: never served (and never a reason to reload). */
export const isHidden = (relPath: string): boolean => relPath.split(/[\\/]/).some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')

/**
 * May the file behind a URL path be served? Not a dot file, and an extension that is on the list.
 * `extra` adds extensions (ServerOptions.extensions).
 */
export function servable(urlPath: string, extra: readonly string[] = []): boolean {
  let decoded: string
  try { decoded = decodeURIComponent(urlPath) } catch { return false }
  if (isHidden(decoded)) return false
  const ext = extname(decoded).toLowerCase()
  return ext !== '' && (SERVED_EXTENSIONS.includes(ext) || extra.includes(ext))
}

/** The Host headers this server answers: its own loopback address under the three names a browser may use for it. */
export const allowedHosts = (port: number): string[] => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]

export interface ReloadEvent { kind: 'scene' | 'viewer'; path: string }

export interface ServerOptions {
  viewerRoot: string
  sceneDir: string
  /** 0 = any free port */
  port?: number
  /** watch the scene directory and the viewer and push reload events */
  watch?: boolean
  /** add the live-reload client to viewer.html (mimir open); headless runs never get it */
  liveReload?: boolean
  /** extensions served besides SERVED_EXTENSIONS, each with its dot (MIMIR_SERVE_EXTENSIONS) */
  extensions?: readonly string[]
  /** called for every request that was answered, with its status */
  onRequest?: (pathname: string, status: number) => void
}

export interface MimirServer {
  origin: string
  port: number
  /** serve bytes at a /__mimir/… path */
  put(pathname: string, body: Uint8Array | string, type: string): void
  /** stop serving what put() added under a path prefix (frees the bytes) */
  drop(prefix: string): void
  /** push a reload event to every connected /events client (also used by the watcher) */
  reload(ev: ReloadEvent): void
  clients(): number
  stop(): void
}

/**
 * The dev server's own reload client. The viewer does not have to know about /events: the page reloads when the
 * scene or the viewer changes and comes back where the author was: at the same story time (the page contract's
 * &t=), with the camera they dragged or picked, and with the sliders they moved. Camera and sliders travel in
 * sessionStorage (one tab, one scene) and are handed back through the host protocol once the new page is ready.
 */
export const LIVE_RELOAD_CLIENT = `<script>
// mimir open: live reload
(() => {
  const key = "mimir-reload:" + (new URLSearchParams(location.search).get("scene") || "");
  const host = () => window.__mimir;
  let view = null; // the last view that was set: { view: a name or a pose, user: it came from a drag }
  const restore = () => {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(key) || "null"); sessionStorage.removeItem(key); } catch (e) {}
    if (!saved) return;
    Promise.resolve(host().ready).then(() => {
      try {
        for (const name of Object.keys(saved.params || {})) host().setParam(name, saved.params[name]);
        if (saved.view != null) {
          // "user" lets a viewer that understands it treat the pose like a drag (a later camera cue takes over again)
          host().setView(saved.view, { user: !!saved.user });
          view = { view: saved.view, user: !!saved.user };
        }
      } catch (e) {}
    });
  };
  // window.__mimir is published by the viewer's module script, which runs after this one
  let tries = 0;
  const wait = setInterval(() => {
    if (!host()) { if (++tries > 1500) clearInterval(wait); return; }
    clearInterval(wait);
    try {
      if (typeof host().on === "function") host().on("view", (v) => { view = v == null ? null : { view: v, user: !!(host().state && host().state().userView) }; });
    } catch (e) {}
    restore();
  }, 20);
  const events = new EventSource("/events");
  events.addEventListener("reload", () => {
    const url = new URL(location.href);
    try {
      const state = host() && host().state ? host().state() : null;
      const tau = state ? Number(state.tau) : NaN;
      if (Number.isFinite(tau) && tau > 0) url.searchParams.set("t", tau.toFixed(3)); else url.searchParams.delete("t");
      const keep = {};
      // a dragged camera is kept while it is still in force (the story takes it back at the next camera cue)
      if (view && (!view.user || (state && state.userView))) { keep.view = view.view; keep.user = view.user; }
      if (state && Array.isArray(state.overridden) && state.params) {
        keep.params = {};
        for (const name of state.overridden) keep.params[name] = state.params[name];
      }
      sessionStorage.setItem(key, JSON.stringify(keep));
    } catch (e) {}
    location.replace(url);
  });
})();
</script>`

/** viewer.html with the reload client placed at the end of <head> (or appended when there is no head). */
export function injectLiveReload(html: string): string {
  const at = html.search(/<\/head\s*>/i)
  return at < 0 ? html + '\n' + LIVE_RELOAD_CLIENT + '\n' : html.slice(0, at) + LIVE_RELOAD_CLIENT + '\n' + html.slice(at)
}

/** Map a URL path under a root to a file path; null when it would escape the root. */
export function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const base = resolve(root)
  const full = resolve(join(base, decoded))
  return full === base || full.startsWith(base + sep) ? full : null
}

/** Paths whose changes never trigger a reload: dot files and dot directories (.git, .mimir, …), node_modules. */
export function isIgnoredChange(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((seg) => seg.startsWith('.') || seg === 'node_modules' || seg.endsWith('~'))
}

/** The real location of a path (symbolic links followed), or null when it does not exist. */
const real = (path: string): string | null => { try { return realpathSync(path) } catch { return null } }

const NO_STORE = { 'cache-control': 'no-store' }

export function startServer(opts: ServerOptions): MimirServer {
  const viewerRoot = resolve(opts.viewerRoot)
  const sceneDir = resolve(opts.sceneDir)
  const extras = new Map<string, { body: Uint8Array | string; type: string }>()
  const encoder = new TextEncoder()
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const watchers: FSWatcher[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const reload = (ev: ReloadEvent): void => {
    const chunk = encoder.encode(`event: reload\ndata: ${JSON.stringify(ev)}\n\n`)
    for (const c of [...clients]) {
      try {
        c.enqueue(chunk)
      } catch {
        clients.delete(c)
      }
    }
  }

  // every command serves the same types: without an explicit list, the environment's MIMIR_SERVE_EXTENSIONS applies
  const extra = opts.extensions ?? extraExtensions(process.env)
  /** a file under `root` named by a URL path: null when it is hidden, of a type that is not served, missing, or outside the root */
  const file = async (root: string, urlPath: string): Promise<Response | null> => {
    if (!servable(urlPath, extra)) return null
    const path = safeJoin(root, urlPath)
    if (path === null) return null
    const f = Bun.file(path)
    if (!(await f.exists())) return null
    // a symbolic link inside the root must not lead out of it
    const at = real(path), base = real(root)
    if (at === null || base === null || !(at === base || at.startsWith(base + sep))) return null
    return new Response(f, { headers: { ...NO_STORE, 'content-type': contentType(path) } })
  }

  const route = async (pathname: string): Promise<Response> => {
    if (pathname === '/events') {
      let own: ReadableStreamDefaultController<Uint8Array> | null = null
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          own = c
          clients.add(c)
          c.enqueue(encoder.encode('retry: 500\n\n: connected\n\n'))
        },
        cancel() {
          if (own) clients.delete(own)
        },
      })
      return new Response(stream, {
        headers: { ...NO_STORE, 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' },
      })
    }
    const extra = extras.get(pathname)
    if (extra) return new Response(extra.body as BodyInit, { headers: { ...NO_STORE, 'content-type': extra.type } })
    if (pathname === '/scene' || pathname.startsWith('/scene/')) {
      const hit = await file(sceneDir, pathname.slice('/scene'.length) || '/')
      return hit ?? new Response(`not found: ${pathname}\n`, { status: 404, headers: NO_STORE })
    }
    const viewerPath = pathname === '/' ? '/viewer.html' : pathname
    if (opts.liveReload && viewerPath === '/viewer.html') {
      const f = Bun.file(join(viewerRoot, 'viewer.html'))
      if (await f.exists()) {
        return new Response(injectLiveReload(await f.text()), { headers: { ...NO_STORE, 'content-type': contentType(viewerPath) } })
      }
    }
    const hit = await file(viewerRoot, viewerPath)
    if (hit) return hit
    // browsers ask for it on their own; a 404 would show up as a console error in every run
    if (pathname === '/favicon.ico') return new Response(null, { status: 204, headers: NO_STORE })
    return new Response(`not found: ${pathname}\n`, { status: 404, headers: NO_STORE })
  }

  let hosts: string[] = []
  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: opts.port ?? 0,
      idleTimeout: 0, // SSE connections stay open
      async fetch(req) {
        // (a request without a usable Host header has a relative URL: the base keeps the parse from throwing)
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname
        // only requests addressed to this server by its loopback name are answered (see the top of this file)
        const host = (req.headers.get('host') ?? '').toLowerCase()
        if (!hosts.includes(host)) {
          opts.onRequest?.(pathname, 403)
          return new Response('forbidden: this server only answers requests addressed to its own loopback address\n', { status: 403, headers: NO_STORE })
        }
        const res = await route(pathname)
        opts.onRequest?.(pathname, res.status)
        return res
      },
    })
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'EADDRINUSE') throw new CliError(`port ${opts.port} is already in use; pass --port <other> or stop the other server`)
    throw new CliError(`could not start the local server: ${err.message ?? String(e)}`)
  }

  if (opts.watch) {
    const observe = (dir: string, kind: ReloadEvent['kind']): void => {
      const pending = new Map<string, ReturnType<typeof setTimeout>>()
      try {
        const w = watch(dir, { recursive: true }, (_event, filename) => {
          const rel = filename === null ? '' : String(filename)
          if (rel !== '' && isIgnoredChange(rel)) return
          // editors write a file in several steps; one event per file per 40 ms is enough
          const old = pending.get(rel)
          if (old) {
            clearTimeout(old)
            timers.delete(old)
          }
          const timer = setTimeout(() => {
            pending.delete(rel)
            timers.delete(timer)
            reload({ kind, path: rel })
          }, 40)
          pending.set(rel, timer)
          timers.add(timer)
        })
        w.on('error', () => {})
        watchers.push(w)
      } catch (e) {
        process.stderr.write(`mimir: cannot watch ${dir}: ${(e as Error).message}\n`)
      }
    }
    observe(sceneDir, 'scene')
    if (viewerRoot !== sceneDir && !viewerRoot.startsWith(sceneDir + sep)) observe(viewerRoot, 'viewer')
  }

  const port = server.port as number
  hosts = allowedHosts(port)
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    put: (pathname, body, type) => void extras.set(pathname, { body, type }),
    drop: (prefix) => { for (const key of [...extras.keys()]) if (key.startsWith(prefix)) extras.delete(key) },
    reload,
    clients: () => clients.size,
    stop() {
      for (const w of watchers) w.close()
      for (const t of timers) clearTimeout(t)
      for (const c of clients) {
        try {
          c.close()
        } catch {
          // already closed
        }
      }
      clients.clear()
      void server.stop(true)
    },
  }
}
