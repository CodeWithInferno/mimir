import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHROME_FLAGS, chromeCandidates, chromeCommands, chromeExtraArgs, chromeFlags, chromeMissingMessage, findChrome, launchChrome, processListCommand, sandboxHint, sweepStaleProfiles } from '../../../src/cli/chrome.ts'
import { CliError, UsageError } from '../../../src/cli/errors.ts'
import { buildNeeded, builtSignature, ensureViewer, inputSignature, newestMtime, resolveScene } from '../../../src/cli/paths.ts'
import { LIVE_RELOAD_CLIENT, SERVED_EXTENSIONS, allowedHosts, contentType, extraExtensions, injectLiveReload, isHidden, isIgnoredChange, safeJoin, servable, startServer } from '../../../src/cli/server.ts'
import { hostExpression, readyExpression, stuckInfo, timeoutFromEnv } from '../../../src/cli/session.ts'
import { browserOpener, preferredPort } from '../../../src/cli/commands/open.ts'
import { checkViews, setProblem, viewList } from '../../../src/cli/commands/shot.ts'
import { frameExpression } from '../../../src/cli/commands/shot.ts'

const created: string[] = []
/** A temp directory that is removed when this file is done. */
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'mimir-unit-'))
  created.push(d)
  return d
}
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true })
})

describe('server helpers', () => {
  test('safeJoin keeps paths inside the root', () => {
    expect(safeJoin('/root/dir', '/a/b.js')).toBe('/root/dir/a/b.js')
    expect(safeJoin('/root/dir', '/')).toBe('/root/dir')
    expect(safeJoin('/root/dir', '/a%20b.js')).toBe('/root/dir/a b.js')
    expect(safeJoin('/root/dir', '/../secret')).toBeNull()
    expect(safeJoin('/root/dir', '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
    expect(safeJoin('/root/dir', '/a/../../dir2/x')).toBeNull()
    expect(safeJoin('/root/dir', '/%00')).toBeNull()
    expect(safeJoin('/root/dir', '/%zz')).toBeNull()
  })
  test('changes in dot directories and node_modules never trigger a reload', () => {
    expect(isIgnoredChange('.mimir/shots/a/step-01.png')).toBe(true)
    expect(isIgnoredChange('.git/index')).toBe(true)
    expect(isIgnoredChange('node_modules/three/build/three.js')).toBe(true)
    expect(isIgnoredChange('sub/.DS_Store')).toBe(true)
    expect(isIgnoredChange('engine.scene.js~')).toBe(true)
    expect(isIgnoredChange('engine.scene.js')).toBe(false)
    expect(isIgnoredChange('parts/piston.js')).toBe(false)
  })
  test('content types', () => {
    expect(contentType('/a/viewer.html')).toBe('text/html; charset=utf-8')
    expect(contentType('x.scene.js')).toBe('text/javascript; charset=utf-8')
    expect(contentType('x.MJS')).toBe('text/javascript; charset=utf-8')
    expect(contentType('x.wasm')).toBe('application/wasm')
    expect(contentType('x.bin')).toBe('application/octet-stream')
  })
})

describe('server routes', () => {
  const dir = tempDir()
  mkdirSync(join(dir, 'viewer'))
  mkdirSync(join(dir, 'scenes', 'parts'), { recursive: true })
  writeFileSync(join(dir, 'viewer', 'viewer.html'), '<!doctype html><title>v</title>')
  writeFileSync(join(dir, 'viewer', 'mimir.js'), 'export const a = 1')
  writeFileSync(join(dir, 'scenes', 'a.scene.js'), 'export default 1')
  writeFileSync(join(dir, 'scenes', 'parts', 'p.js'), 'export const p = 1')
  writeFileSync(join(dir, 'secret.txt'), 'secret')

  test('viewer root, scene directory, in-memory pages, 404s and the request log', async () => {
    const seen: Array<[string, number]> = []
    const server = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0, onRequest: (p, s) => seen.push([p, s]) })
    try {
      const get = (p: string) => fetch(server.origin + p)
      expect(server.origin).toBe(`http://127.0.0.1:${server.port}`)
      expect(await (await get('/')).text()).toContain('<title>v</title>')
      const js = await get('/mimir.js')
      expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
      expect(js.headers.get('cache-control')).toBe('no-store')
      expect(await (await get('/scene/a.scene.js')).text()).toBe('export default 1')
      expect(await (await get('/scene/parts/p.js')).text()).toBe('export const p = 1')
      expect((await get('/scene/nope.js')).status).toBe(404)
      expect((await get('/nope.js')).status).toBe(404)
      expect((await get('/scene/%2e%2e/secret.txt')).status).toBe(404)
      expect((await get('/favicon.ico')).status).toBe(204)
      server.put('/__mimir/sheet.html', '<p>sheet</p>', 'text/html; charset=utf-8')
      expect(await (await get('/__mimir/sheet.html')).text()).toBe('<p>sheet</p>')
      expect(seen.filter(([, s]) => s === 200).map(([p]) => p)).toEqual(['/', '/mimir.js', '/scene/a.scene.js', '/scene/parts/p.js', '/__mimir/sheet.html'])
    } finally {
      server.stop()
    }
  })

  // The server is reachable from any page the reader has open (a page can ask the browser for http://127.0.0.1:<port>/),
  // so what it refuses is part of its contract: SECURITY.md describes exactly this.
  test('dot files and dot directories are never served, from either root', async () => {
    mkdirSync(join(dir, 'scenes', '.git'), { recursive: true })
    writeFileSync(join(dir, 'scenes', '.env'), 'TOKEN=1')
    writeFileSync(join(dir, 'scenes', '.env.js'), 'export const token = 1')
    writeFileSync(join(dir, 'scenes', '.git', 'config.txt'), 'url = …')
    writeFileSync(join(dir, 'viewer', '.hidden.js'), 'x')
    const seen: Array<[string, number]> = []
    const server = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0, onRequest: (p, s) => seen.push([p, s]) })
    try {
      for (const path of ['/scene/.env', '/scene/.env.js', '/scene/.git/config.txt', '/scene/%2eenv', '/scene/parts/../.env.js', '/.hidden.js']) {
        const res = await fetch(server.origin + path)
        expect([path, res.status]).toEqual([path, 404])
        expect(await res.text()).not.toContain('TOKEN')
      }
      expect(seen.every(([, status]) => status === 404)).toBe(true)
    } finally { server.stop() }
    for (const [path, hidden] of [['.env', true], ['a/.git/config', true], ['parts/p.js', false], ['a.scene.js', false], ['./a.js', false], ['..\\.ssh\\id', true]] as const) expect([path, isHidden(path)]).toEqual([path, hidden])
  })

  test('only the listed file types are served; MIMIR_SERVE_EXTENSIONS adds to the list', async () => {
    writeFileSync(join(dir, 'scenes', 'notes.pem'), 'key')
    writeFileSync(join(dir, 'scenes', 'data.csv'), 'a,b')
    writeFileSync(join(dir, 'scenes', 'model.glb'), 'glb')
    writeFileSync(join(dir, 'scenes', 'Makefile'), 'all:')
    const plain = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0, extensions: [] })
    const more = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0, extensions: extraExtensions({ MIMIR_SERVE_EXTENSIONS: 'glb, .BIN' }) })
    try {
      const status = async (origin: string, path: string): Promise<number> => (await fetch(origin + path)).status
      expect(await status(plain.origin, '/scene/data.csv')).toBe(200)
      expect(await status(plain.origin, '/scene/notes.pem')).toBe(404)
      expect(await status(plain.origin, '/scene/Makefile')).toBe(404) // no extension: not a web asset
      expect(await status(plain.origin, '/scene/model.glb')).toBe(404)
      expect(await status(more.origin, '/scene/model.glb')).toBe(200)
      expect(await status(more.origin, '/scene/notes.pem')).toBe(404)
    } finally { plain.stop(); more.stop() }
    expect(extraExtensions({})).toEqual([])
    expect(extraExtensions({ MIMIR_SERVE_EXTENSIONS: 'glb, .BIN ../x a/b' })).toEqual(['.glb', '.bin'])
    for (const ext of ['.js', '.mjs', '.json', '.html', '.css', '.svg', '.png', '.woff2', '.wasm']) expect(SERVED_EXTENSIONS).toContain(ext)
    expect(servable('/a/b.scene.js')).toBe(true)
    expect(servable('/a/key.pem')).toBe(false)
    expect(servable('/a/.b.js')).toBe(false)
    expect(servable('/%zz.js')).toBe(false)
  })

  test('a request with a foreign Host header is refused (DNS rebinding): only the loopback names of this server are answered', async () => {
    const seen: Array<[string, number]> = []
    const server = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0, onRequest: (p, s) => seen.push([p, s]) })
    try {
      const withHost = (host: string): Promise<Response> => fetch(server.origin + '/scene/a.scene.js', { headers: { host } })
      for (const host of ['attacker.example', `attacker.example:${server.port}`, `127.0.0.1:${server.port + 1}`, `127.0.0.1.attacker.example:${server.port}`, '']) {
        const res = await withHost(host)
        expect([host, res.status]).toEqual([host, 403]) // an empty Host header too (it once made the URL unparseable: a 500)
        expect(await res.text()).not.toContain('export default')
      }
      for (const host of allowedHosts(server.port)) expect([host, (await withHost(host)).status]).toEqual([host, 200])
      expect((await withHost(`LOCALHOST:${server.port}`)).status).toBe(200)
      expect(seen.filter(([, status]) => status === 403).length).toBe(5)
      // /events and the in-memory pages are behind the same check
      expect((await fetch(server.origin + '/events', { headers: { host: 'attacker.example' } })).status).toBe(403)
    } finally { server.stop() }
    const n = 5 // any number: nothing listens on it
    expect(allowedHosts(n)).toEqual([`127.0.0.1:${n}`, `localhost:${n}`, `[::1]:${n}`])
  })

  test('a symbolic link inside the scene directory that leads out of it is not followed', async () => {
    const outside = tempDir()
    writeFileSync(join(outside, 'private.js'), 'export const secret = 1')
    writeFileSync(join(dir, 'scenes', 'real.js'), 'export const ok = 1')
    let linked = true
    try {
      symlinkSync(join(outside, 'private.js'), join(dir, 'scenes', 'leak.js'))
      symlinkSync(join(dir, 'scenes', 'real.js'), join(dir, 'scenes', 'alias.js'))
    } catch { linked = false } // a platform or account that may not create links: nothing to test
    if (!linked) return
    const server = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0 })
    try {
      expect((await fetch(server.origin + '/scene/leak.js')).status).toBe(404)
      expect(await (await fetch(server.origin + '/scene/alias.js')).text()).toBe('export const ok = 1')
    } finally { server.stop() }
  })

  test('the live-reload client is added to viewer.html only when asked for', async () => {
    const plain = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0 })
    const dev = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0, liveReload: true })
    try {
      expect(await (await fetch(plain.origin + '/viewer.html')).text()).toBe('<!doctype html><title>v</title>')
      for (const path of ['/viewer.html', '/', '/viewer.html?scene=%2Fscene%2Fa.scene.js']) {
        const html = await (await fetch(dev.origin + path)).text()
        expect(html).toContain('new EventSource("/events")')
        expect(html).toStartWith('<!doctype html><title>v</title>')
      }
      expect(await (await fetch(dev.origin + '/mimir.js')).text()).toBe('export const a = 1')
    } finally {
      plain.stop()
      dev.stop()
    }
  })
  test('injectLiveReload puts the client at the end of <head>', () => {
    const html = injectLiveReload('<html><head><title>x</title></head><body></body></html>')
    expect(html.indexOf('EventSource')).toBeGreaterThan(html.indexOf('<title>'))
    expect(html.indexOf('EventSource')).toBeLessThan(html.indexOf('</head>'))
    expect(html.match(/<script>/g)!.length).toBe(1)
    expect(() => new Function(LIVE_RELOAD_CLIENT.replace(/<\/?script>/g, ''))).not.toThrow()
  })

  test('/events is an SSE stream that receives reload events', async () => {
    const server = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0 })
    try {
      const res = await fetch(server.origin + '/events')
      expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let text = decoder.decode((await reader.read()).value)
      expect(text).toContain(': connected')
      expect(server.clients()).toBe(1)
      server.reload({ kind: 'scene', path: 'a.scene.js' })
      while (!text.includes('event: reload')) text += decoder.decode((await reader.read()).value)
      expect(text).toContain('event: reload\ndata: {"kind":"scene","path":"a.scene.js"}\n\n')
      await reader.cancel()
    } finally {
      server.stop()
    }
  })

  test('a taken port is a clear error', () => {
    const a = startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: 0 })
    try {
      expect(() => startServer({ viewerRoot: join(dir, 'viewer'), sceneDir: join(dir, 'scenes'), port: a.port })).toThrow(/already in use/)
    } finally {
      a.stop()
    }
  })
})

describe('paths', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'engine.scene.js'), 'export default 1')

  test('resolveScene: absolute path, directory, url and output name', () => {
    const s = resolveScene('engine.scene.js', dir, 'check')
    expect(s).toEqual({ path: join(dir, 'engine.scene.js'), dir, file: 'engine.scene.js', name: 'engine', url: '/scene/engine.scene.js' })
    writeFileSync(join(dir, 'my scene.js'), 'export default 1')
    expect(resolveScene('my scene.js', dir, 'check')).toMatchObject({ name: 'my scene', url: '/scene/my%20scene.js' })
  })
  test('a missing scene (or a directory) is a usage error of that command', () => {
    expect(() => resolveScene('nope.js', dir, 'shot')).toThrow(UsageError)
    expect(() => resolveScene('nope.js', dir, 'shot')).toThrow('scene file not found: nope.js')
    expect(() => resolveScene('.', dir, 'shot')).toThrow(UsageError)
  })
  test('buildNeeded: missing, stale, fresh', () => {
    expect(buildNeeded(false, 0, 100)).toBe('missing')
    expect(buildNeeded(true, 100, 200)).toBe('stale')
    expect(buildNeeded(true, 200, 100)).toBeNull()
    expect(buildNeeded(true, 100, 100)).toBeNull()
  })
  test('newestMtime walks the tree, skipping dot files, node_modules and the skip predicate', () => {
    const root = tempDir()
    mkdirSync(join(root, 'a', 'cli'), { recursive: true })
    mkdirSync(join(root, 'node_modules'))
    const stamp = (p: string, seconds: number): void => {
      writeFileSync(p, 'x')
      utimesSync(p, seconds, seconds)
    }
    stamp(join(root, 'old.ts'), 1000)
    stamp(join(root, 'a', 'new.ts'), 2000)
    stamp(join(root, 'a', 'cli', 'newer.ts'), 3000)
    stamp(join(root, 'node_modules', 'newest.js'), 4000)
    stamp(join(root, '.hidden'), 5000)
    expect(newestMtime(root)).toBe(3000 * 1000)
    expect(newestMtime(root, (p) => p === join(root, 'a', 'cli'))).toBe(2000 * 1000)
    expect(newestMtime(join(root, 'missing'))).toBe(0)
    rmSync(root, { recursive: true, force: true })
  })
  test('MIMIR_VIEWER_ROOT must contain viewer.html', async () => {
    expect(ensureViewer({ MIMIR_VIEWER_ROOT: dir })).rejects.toThrow(/has no viewer\.html/)
    writeFileSync(join(dir, 'viewer.html'), '<!doctype html>')
    expect(await ensureViewer({ MIMIR_VIEWER_ROOT: dir })).toEqual({ dir, built: false })
  })
})

describe('building the viewer on demand', () => {
  // a miniature checkout: src/, scripts/build.ts that writes dist/viewer.html, and src/cli (which never counts)
  const make = (buildBody: string): string => {
    const root = tempDir()
    mkdirSync(join(root, 'src', 'core'), { recursive: true })
    mkdirSync(join(root, 'src', 'cli'), { recursive: true })
    mkdirSync(join(root, 'scripts'))
    writeFileSync(join(root, 'src', 'core', 'a.ts'), 'export const a = 1')
    writeFileSync(join(root, 'scripts', 'build.ts'), buildBody)
    return root
  }
  const BUILD = `import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
mkdirSync('dist', { recursive: true })
writeFileSync('dist/viewer.html', '<!doctype html>built')
appendFileSync('builds.log', 'x')
`
  const builds = (root: string): number => { try { return readFileSync(join(root, 'builds.log'), 'utf8').length } catch { return 0 } }
  const age = (p: string, seconds: number): void => utimesSync(p, seconds, seconds)

  test('dist missing → runs bun scripts/build.ts once; fresh dist → no build; src newer → rebuild', async () => {
    const root = make(BUILD)
    const logs: string[] = []
    expect(await ensureViewer({}, (m) => logs.push(m), root)).toEqual({ dir: join(root, 'dist'), built: true })
    expect(builds(root)).toBe(1)
    expect(logs[0]).toContain('dist is missing')
    // everything in src is older than dist now
    age(join(root, 'src', 'core', 'a.ts'), 1000)
    age(join(root, 'scripts', 'build.ts'), 1000)
    expect(await ensureViewer({}, () => {}, root)).toEqual({ dir: join(root, 'dist'), built: false })
    expect(builds(root)).toBe(1)
    // a change in src/cli alone does not rebuild the viewer
    writeFileSync(join(root, 'src', 'cli', 'main.ts'), '// cli')
    age(join(root, 'src', 'cli', 'main.ts'), Date.now() / 1000 + 3600)
    expect((await ensureViewer({}, () => {}, root)).built).toBe(false)
    // a newer engine source does
    age(join(root, 'src', 'core', 'a.ts'), Date.now() / 1000 + 3600)
    expect((await ensureViewer({}, (m) => logs.push(m), root)).built).toBe(true)
    expect(builds(root)).toBe(2)
    expect(logs.at(-1)).toContain('older than src')
    rmSync(root, { recursive: true, force: true })
  })
  test('a failing build is reported with its output', async () => {
    const root = make(`console.error('TS2304: cannot find name piston'); process.exit(3)`)
    expect(ensureViewer({}, () => {}, root)).rejects.toThrow(/building the viewer failed \(bun scripts\/build\.ts exited with 3\):\nTS2304: cannot find name piston/)
    rmSync(root, { recursive: true, force: true })
  })
  test('a build that produces no viewer.html, and a checkout without a build script, are clear errors', async () => {
    const root = make(`// does nothing`)
    expect(ensureViewer({}, () => {}, root)).rejects.toThrow(/did not produce .*dist\/viewer\.html/)
    rmSync(join(root, 'scripts', 'build.ts'))
    expect(ensureViewer({}, () => {}, root)).rejects.toThrow(/the viewer is not built: .*viewer\.html is missing and .*build\.ts does not exist/)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('a stale dist is detected when the set of source files changes (a file added or removed, not only edited)', () => {
  const PATHS = join(import.meta.dir, '..', '..', '..', 'src', 'cli', 'paths.ts')
  // a build script that records what it was built from, as the real one does
  const BUILD = `import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { inputSignature } from ${JSON.stringify(PATHS)}
mkdirSync('dist', { recursive: true })
writeFileSync('dist/viewer.html', '<!doctype html>built')
writeFileSync('dist/build.json', JSON.stringify({ inputs: inputSignature(process.cwd()) }))
appendFileSync('builds.log', 'x')
`
  const make = (): string => {
    const root = tempDir()
    for (const d of ['src/core', 'src/demo', 'src/cli', 'src/_generated', 'scripts']) mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, 'src', 'core', 'a.ts'), 'export const a = 1')
    writeFileSync(join(root, 'src', 'demo', 'index.ts'), 'export const api = {}')
    writeFileSync(join(root, 'scripts', 'build.ts'), BUILD)
    return root
  }
  const builds = (root: string): number => { try { return readFileSync(join(root, 'builds.log'), 'utf8').length } catch { return 0 } }
  /** make every source look older than dist, so only the set of files can trigger a rebuild */
  const ageAll = (root: string): void => {
    const walk = (dir: string): void => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else utimesSync(p, 1000, 1000) } }
    walk(join(root, 'src'))
    walk(join(root, 'scripts'))
  }

  test('inputSignature follows the SET of files: add, remove and rename change it; an edit, src/cli and src/_generated do not', () => {
    const root = make()
    const base = inputSignature(root)
    expect(base).toMatch(/^3:[0-9a-f]{16}$/) // core/a.ts, demo/index.ts, scripts/build.ts
    writeFileSync(join(root, 'src', 'core', 'a.ts'), 'export const a = 2')
    writeFileSync(join(root, 'src', 'cli', 'main.ts'), '// cli')
    writeFileSync(join(root, 'src', '_generated', 'core.ts'), '// generated')
    expect(inputSignature(root)).toBe(base)
    writeFileSync(join(root, 'src', 'demo', 'three.ts'), '')
    const added = inputSignature(root)
    expect(added).not.toBe(base)
    renameSync(join(root, 'src', 'demo'), join(root, 'src', 'demo2'))
    expect(inputSignature(root)).not.toBe(added)
    rmSync(join(root, 'src', 'demo2'), { recursive: true })
    expect(inputSignature(root)).toMatch(/^2:/)
    expect(buildNeeded(true, 200, 100, 'a', 'a')).toBeNull()
    expect(buildNeeded(true, 200, 100, 'a', 'b')).toBe('changed')
    expect(buildNeeded(true, 100, 200, 'a', 'b')).toBe('stale')
    rmSync(root, { recursive: true, force: true })
  })
  test('removing, adding or renaming a module rebuilds, although no file is newer than dist', async () => {
    const root = make()
    const logs: string[] = []
    expect((await ensureViewer({}, (m) => logs.push(m), root)).built).toBe(true)
    expect(builtSignature(join(root, 'dist'))).toBe(inputSignature(root))
    ageAll(root)
    expect((await ensureViewer({}, (m) => logs.push(m), root)).built).toBe(false)
    rmSync(join(root, 'src', 'demo'), { recursive: true }) // deleting files makes nothing newer
    expect((await ensureViewer({}, (m) => logs.push(m), root)).built).toBe(true)
    expect(logs.at(-1)).toContain('added, removed or renamed')
    expect(builds(root)).toBe(2)
    expect((await ensureViewer({}, (m) => logs.push(m), root)).built).toBe(false)
    renameSync(join(root, 'src', 'core', 'a.ts'), join(root, 'src', 'core', 'b.ts'))
    utimesSync(join(root, 'src', 'core', 'b.ts'), 1000, 1000)
    expect((await ensureViewer({}, (m) => logs.push(m), root)).built).toBe(true)
    expect(builds(root)).toBe(3)
    rmSync(root, { recursive: true, force: true })
  })
  test('a rebuild that fails keeps answering from the last good dist, loudly; a first build that fails still throws', async () => {
    const root = make()
    expect((await ensureViewer({}, () => {}, root)).built).toBe(true)
    writeFileSync(join(root, 'scripts', 'build.ts'), `console.error('build: kind "rect" is registered twice'); process.exit(1)`)
    const logs: string[] = []
    const r = await ensureViewer({}, (m) => logs.push(m), root)
    expect(r.built).toBe(false)
    expect(r.dir).toBe(join(root, 'dist'))
    expect(r.stale).toContain('registered twice')
    expect(logs.at(-1)).toMatch(/^WARNING: building the viewer failed \(bun scripts\/build\.ts exited with 1\):\nbuild: kind "rect" is registered twice\nWARNING: using the last good build in .*dist; it does NOT contain the latest source changes/)
    rmSync(join(root, 'dist'), { recursive: true })
    expect(ensureViewer({}, () => {}, root)).rejects.toThrow(/building the viewer failed/)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('live reload watcher', () => {
  test('a change in the scene directory or in the viewer pushes a reload; dot directories do not', async () => {
    const root = tempDir()
    mkdirSync(join(root, 'viewer'))
    mkdirSync(join(root, 'scenes', '.mimir'), { recursive: true })
    writeFileSync(join(root, 'viewer', 'viewer.html'), '<!doctype html>')
    writeFileSync(join(root, 'scenes', 'a.scene.js'), 'export default 1')
    const server = startServer({ viewerRoot: join(root, 'viewer'), sceneDir: join(root, 'scenes'), port: 0, watch: true })
    try {
      const res = await fetch(server.origin + '/events')
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let text = decoder.decode((await reader.read()).value)
      const until = async (needle: string): Promise<void> => {
        const deadline = Date.now() + 8000
        while (!text.includes(needle) && Date.now() < deadline) text += decoder.decode((await reader.read()).value)
      }
      await Bun.sleep(150) // let the watchers arm
      writeFileSync(join(root, 'scenes', '.mimir', 'step-01.png'), 'png')
      writeFileSync(join(root, 'scenes', 'a.scene.js'), 'export default 2')
      await until('"kind":"scene"')
      expect(text).toContain('event: reload\ndata: {"kind":"scene","path":"a.scene.js"}')
      expect(text).not.toContain('.mimir')
      writeFileSync(join(root, 'viewer', 'mimir.js'), 'export const a = 2')
      // (macOS may also replay the creation of viewer.html from just before the watcher started)
      await until('"path":"mimir.js"')
      expect(text).toContain('data: {"kind":"viewer","path":"mimir.js"}')
      await reader.cancel()
    } finally {
      server.stop()
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)
})

describe('browser discovery', () => {
  test('macOS candidates: Chrome first, then Chromium, Edge, Brave; no headless shell', () => {
    const c = chromeCandidates('darwin', '/Users/x')
    expect(c[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(c.slice(1, 4)).toEqual([
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ])
    expect(c).toContain('/Users/x/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(c.some((p) => /headless.shell/i.test(p))).toBe(false)
  })
  test('Linux candidates: the system directories, snap and the Flatpak exports; PATH is asked first', () => {
    const c = chromeCandidates('linux', '/home/x')
    expect(c[0]).toBe('/usr/bin/google-chrome-stable')
    for (const p of ['/usr/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/brave-browser', '/snap/bin/chromium', '/var/lib/flatpak/exports/bin/org.chromium.Chromium', '/home/x/.local/share/flatpak/exports/bin/com.google.Chrome']) expect(c).toContain(p)
    expect(chromeCommands('linux')[0]).toBe('google-chrome-stable')
    expect(chromeCommands('darwin')).toEqual([])
    // a browser on PATH (a Nix profile, a wrapper script) wins over a fixed location
    const probe = { platform: 'linux', home: '/home/x', exists: (p: string) => p === '/usr/bin/chromium', which: (n: string) => (n === 'chromium' ? '/nix/profile/bin/chromium' : null) }
    expect(findChrome({}, probe)).toBe('/nix/profile/bin/chromium')
    expect(findChrome({}, { ...probe, which: () => null })).toBe('/usr/bin/chromium')
  })
  test('Windows candidates come from the program directories of the environment, with Windows path rules, on any platform', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }
    const c = chromeCandidates('win32', 'C:\\Users\\x', env)
    expect(c[0]).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    for (const p of ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'C:\\Users\\x\\AppData\\Local\\Chromium\\Application\\chrome.exe']) expect(c).toContain(p)
    // without the variables only the per-user folder under the home directory is known
    expect(chromeCandidates('win32', 'C:\\Users\\x', {})).toEqual(expect.arrayContaining(['C:\\Users\\x\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe']))
    expect(chromeCommands('win32')).toContain('msedge.exe')
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    expect(findChrome(env, { platform: 'win32', home: 'C:\\Users\\x', exists: (p) => p === edge, which: () => null })).toBe(edge)
  })
  test('no browser: one message that names what was looked for on that platform and both ways out', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
      const nothing = { platform, home: platform === 'win32' ? 'C:\\Users\\x' : '/home/x', exists: () => false, which: () => null }
      expect(() => findChrome({}, nothing)).toThrow(CliError)
      const message = chromeMissingMessage(platform)
      expect(() => findChrome({}, nothing)).toThrow(message)
      expect(message).toMatch(/^no Chrome-family browser found \(looked for Google Chrome, Chromium, Microsoft Edge and Brave /)
      expect(message).toContain('MIMIR_CHROME=')
      expect(message).toMatch(/Install one/)
    }
    expect(chromeMissingMessage('win32')).toContain('Program Files')
    expect(chromeMissingMessage('linux')).toContain('Flatpak')
  })
  test('MIMIR_CHROME_ARGS: plain flags split at white space, or a JSON array when an argument holds a space', () => {
    expect(chromeExtraArgs(undefined)).toEqual([])
    expect(chromeExtraArgs('  --no-sandbox   --use-angle=swiftshader ')).toEqual(['--no-sandbox', '--use-angle=swiftshader'])
    expect(chromeExtraArgs('["--no-sandbox", "--disk-cache-dir=/a path/with spaces"]')).toEqual(['--no-sandbox', '--disk-cache-dir=/a path/with spaces'])
    expect(() => chromeExtraArgs('["--no-sandbox"')).toThrow(/MIMIR_CHROME_ARGS starts with "\[" but is not a JSON array/)
    expect(() => chromeExtraArgs('[1, 2]')).toThrow('MIMIR_CHROME_ARGS must be a JSON array of strings')
  })
  test('a browser that cannot set up its sandbox is answered with the way out; other output is not', () => {
    expect(sandboxHint('[1:1:ERROR:zygote_host_impl_linux.cc] No usable sandbox! Update your kernel …')).toContain('MIMIR_CHROME_ARGS=--no-sandbox')
    expect(sandboxHint('Running as root without --no-sandbox is not supported.')).toContain('--no-sandbox')
    expect(sandboxHint('cannot open display')).toBeNull()
  })
  test('Windows: no fd lifeline flag and no process list to rely on; everything else is the same', () => {
    expect(chromeFlags('linux')).toEqual(CHROME_FLAGS)
    expect(chromeFlags('win32')).toEqual(CHROME_FLAGS.filter((f) => f !== '--remote-debugging-pipe'))
    expect(processListCommand('win32')).toBeNull()
    expect(processListCommand('darwin')).toEqual(['ps', '-axo', 'command='])
  })
  test('MIMIR_CHROME wins, and a missing one is an error rather than a silent fallback', () => {
    expect(findChrome({ MIMIR_CHROME: process.execPath })).toBe(process.execPath)
    expect(() => findChrome({ MIMIR_CHROME: '/nope/chrome' })).toThrow(CliError)
    expect(() => findChrome({ MIMIR_CHROME: '/nope/chrome' })).toThrow('MIMIR_CHROME points to a file that does not exist')
  })
  test('the throwaway profile is created in the TMPDIR of the environment given to the launch, and removed on close', async () => {
    const tmp = tempDir()
    const browser = await launchChrome({ env: { ...process.env, TMPDIR: tmp } })
    try {
      expect(browser.profileDir.startsWith(join(tmp, 'mimir-chrome-'))).toBe(true)
      expect(readdirSync(tmp).length).toBe(1)
    } finally {
      await browser.close()
    }
    expect(readdirSync(tmp)).toEqual([])
    await browser.close() // closing twice is harmless
    rmSync(tmp, { recursive: true, force: true })
  }, 60_000)
  test('profiles left behind by a killed run are swept at the next launch: old ones that no process uses, nothing else', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mimir-sweep-'))
    const dir = (name: string, ageMin: number): string => { const p = join(tmp, name); mkdirSync(p); writeFileSync(join(p, 'x'), ''); const t = (Date.now() - ageMin * 60_000) / 1000; utimesSync(p, t, t); return p }
    const orphan = dir('mimir-chrome-orphan', 60), fresh = dir('mimir-chrome-fresh', 1), other = dir('something-else', 60), live = dir('mimir-chrome-live', 60)
    // a process that mentions the old directory on its command line stands for a browser that is still using it
    const user = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 20000)', `--user-data-dir=${live}`], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
    try {
      await Bun.sleep(150)
      expect(sweepStaleProfiles(tmp)).toEqual([orphan])
      expect(readdirSync(tmp).sort()).toEqual(['mimir-chrome-fresh', 'mimir-chrome-live', 'something-else'])
      expect(sweepStaleProfiles(tmp)).toEqual([])
      expect([fresh, other].length).toBe(2)
      expect(sweepStaleProfiles(join(tmp, 'does-not-exist'))).toEqual([])
    } finally {
      user.kill()
      await user.exited
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('flags: new headless, a port chosen by the browser, no fixed profile', () => {
    expect(CHROME_FLAGS).toContain('--headless=new')
    expect(CHROME_FLAGS).toContain('--remote-debugging-port=0')
    expect(CHROME_FLAGS).toContain('--remote-debugging-pipe') // lifeline: Chrome quits when the CLI dies
    expect(CHROME_FLAGS.some((f) => f.startsWith('--user-data-dir'))).toBe(false)
    // the GPU stays on (WebGL must not fall back to software) …
    expect(CHROME_FLAGS.some((f) => f === '--disable-gpu' || f.startsWith('--disable-gpu-compositing') || f.includes('swiftshader') || f.includes('use-gl='))).toBe(false)
    // … but 2D raster is made a function of the frame alone: whole tiles, on the CPU (no partial raster, no GPU path caches)
    expect(CHROME_FLAGS).toContain('--disable-partial-raster')
    expect(CHROME_FLAGS).toContain('--disable-gpu-rasterization')
    // pages that render side by side (video frames) each have a window: a covered window must keep rendering
    for (const f of ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']) expect(CHROME_FLAGS).toContain(f)
  })
})

describe('page expressions', () => {
  test('hostExpression serialises arguments and returns JSON', () => {
    expect(hostExpression('seek', [1.5])).toBe('Promise.resolve(window.__mimir["seek"](1.5)).then((v) => JSON.stringify(v === undefined ? null : v))')
    expect(hostExpression('setParam', ['rpm', 1200])).toContain('window.__mimir["setParam"]("rpm", 1200)')
    expect(hostExpression('diagnostics', [{ sample: true }])).toContain('({"sample":true})')
  })
  test('frameExpression: seek, then overrides, then the view, then frame(), then probes', () => {
    const js = frameExpression(3.999, [{ name: 'rpm', value: 1200 }, { name: 'open', value: true }], 'iso')
    const order = ['m.seek(3.999)', '[["rpm",1200],["open",true]]', 'm.setView("iso")', 'm.frame()', 'm.probes()'].map((s) => js.indexOf(s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(frameExpression(0, [], null)).not.toContain('setView')
    expect(() => new Function(`return ${js}`)).not.toThrow()
  })
  test('frameExpression reports the parameter values in effect, not the declared defaults', async () => {
    const run = (host: Record<string, unknown>): Promise<{ params: Record<string, unknown>; probes: Record<string, number> }> =>
      (new Function('window', `return ${frameExpression(1, [{ name: 'crank', value: 200 }], null)}`)({ __mimir: host }) as Promise<string>).then((j) => JSON.parse(j))
    const calls: string[] = []
    const live: Record<string, unknown> = { crank: 40 }
    const base = {
      seek: (t: number) => void calls.push(`seek ${t}`),
      setParam: (n: string, v: unknown) => { calls.push(`set ${n}=${v}`); live[n] = v },
      frame: async () => void calls.push('frame'),
      probes: () => ({ height: 3.67 }),
      info: () => ({ params: [{ name: 'crank', value: 40 }] }), // the real host keeps the declared default here
    }
    // real host: state() has the live values
    expect(await run({ ...base, state: () => ({ params: { ...live } }) })).toEqual({ params: { crank: 200 }, probes: { height: 3.67 } })
    expect(calls).toEqual(['seek 1', 'set crank=200', 'frame'])
    // contract-only viewer (no state()): info() is all there is
    expect((await run(base)).params).toEqual({ crank: 40 })
  })
  test('readyExpression is valid JavaScript and carries the timeout', () => {
    expect(readyExpression(1234)).toContain('performance.now() + 1234')
    expect(() => new Function(`return ${readyExpression(1000)}`)).not.toThrow()
  })
  test('a scene that never becomes ready is reported as a load error of the scene (a fatal), with what to look for', () => {
    const info = stuckInfo(4000)
    expect(info.fatal!.message).toContain('the scene never finished building (waited 4000 ms)')
    expect(info.fatal!.message).toContain('endless loop')
    expect(info.fatal!.message).toContain('top-level await')
    expect(info.steps).toEqual([])
  })
  test('shot --set: a value the param cannot have is named; a host that does not say what kind a param is gets no check', () => {
    const p = (o: object): any => ({ name: 'p', min: 0, max: 10, value: 1, kind: null, options: [], ...o })
    expect(setProblem(p({ kind: 'number' }), 'abc')).toBe('"p" is a number from 0 to 10')
    expect(setProblem(p({ kind: 'number' }), 1e9)).toBe('"p" goes from 0 to 10')
    expect(setProblem(p({ kind: 'number' }), 10)).toBeNull()
    expect(setProblem(p({ kind: 'toggle' }), 'yes')).toBe('"p" is a toggle: true or false')
    expect(setProblem(p({ kind: 'toggle' }), true)).toBeNull()
    expect(setProblem(p({ kind: 'choice', options: ['slow', 'fast'] }), 'warp')).toBe('"p" is one of: slow, fast')
    expect(setProblem(p({ kind: 'choice', options: ['slow', 'fast'] }), 'fast')).toBeNull()
    expect(setProblem(p({}), 'anything')).toBeNull()
  })
  test('MIMIR_TIMEOUT', () => {
    expect(timeoutFromEnv({})).toBe(30_000)
    expect(timeoutFromEnv({ MIMIR_TIMEOUT: '1500' })).toBe(1500)
    expect(timeoutFromEnv({ MIMIR_TIMEOUT: 'soon' })).toBe(30_000)
    expect(timeoutFromEnv({ MIMIR_TIMEOUT: '5' })).toBe(30_000)
  })
})

describe('live reload keeps where the author was', () => {
  /** Run the injected client in a fake page; returns what it did when a reload event arrives. */
  async function reload(host: Record<string, unknown> | undefined, saved: string | null, emit?: (fire: (v: unknown) => void) => void) {
    const storage = new Map<string, string>()
    const key = 'mimir-reload:/scene/a.scene.js'
    if (saved !== null) storage.set(key, saved)
    let onReload: (() => void) | null = null
    let replaced: URL | null = null
    const viewListeners: Array<(v: unknown) => void> = []
    if (host) host.on = (event: string, fn: (v: unknown) => void) => { if (event === 'view') viewListeners.push(fn) }
    const window: Record<string, unknown> = { __mimir: host }
    const location = { href: 'http://127.0.0.1:1/viewer.html?scene=%2Fscene%2Fa.scene.js&t=9', search: '?scene=%2Fscene%2Fa.scene.js&t=9', replace: (u: URL) => { replaced = u } }
    class FakeEvents { addEventListener(_n: string, fn: () => void) { onReload = fn } }
    const js = LIVE_RELOAD_CLIENT.replace(/<\/?script>/g, '')
    new Function('window', 'location', 'sessionStorage', 'EventSource', 'setInterval', 'clearInterval', js)(
      window, location, { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) },
      FakeEvents, (fn: () => void) => { queueMicrotask(fn); return 1 }, () => {},
    )
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    emit?.((v) => viewListeners.forEach((fn) => fn(v)))
    onReload!()
    return { url: replaced as URL | null, stored: storage.get(key) ?? null }
  }
  const hostAt = (state: Record<string, unknown>, calls: string[] = []) => ({
    ready: Promise.resolve(),
    state: () => state,
    setParam: (n: string, v: unknown) => void calls.push(`param ${n}=${v}`),
    setView: (v: unknown, o: unknown) => void calls.push(`view ${JSON.stringify(v)} ${JSON.stringify(o)}`),
  })

  test('the story time goes into the address; a dragged camera and the moved sliders into sessionStorage', async () => {
    const pose = { azimuth: 120, elevation: 30, distance: 9, target: [0, 1, 0] }
    const r = await reload(hostAt({ tau: 4.25, userView: true, overridden: ['crank'], params: { crank: 77, bore: 2 } }), null, (fire) => fire(pose))
    expect(r.url!.searchParams.get('t')).toBe('4.250')
    expect(JSON.parse(r.stored!)).toEqual({ view: pose, user: true, params: { crank: 77 } })
  })
  test('a camera the story has taken back is not kept; a named view is', async () => {
    const taken = await reload(hostAt({ tau: 1, userView: false, overridden: [], params: {} }), null, (fire) => fire({ azimuth: 10 }))
    // the drag happened while userView was false in this fake (the story owns the camera again): nothing to keep
    expect(JSON.parse(taken.stored!)).toEqual({ view: { azimuth: 10 }, user: false, params: {} })
    const state = { tau: 1, userView: true, overridden: [], params: {} }
    const dragged = await reload(hostAt(state), null, (fire) => { fire({ azimuth: 10 }); state.userView = false })
    expect(JSON.parse(dragged.stored!)).toEqual({ params: {} })
    const named = await reload(hostAt({ tau: 0, userView: false, overridden: [], params: {} }), null, (fire) => fire('top'))
    expect(JSON.parse(named.stored!)).toEqual({ view: 'top', user: false, params: {} })
    expect(named.url!.searchParams.has('t')).toBe(false) // at t = 0 the address carries no time
  })
  test('after the reload the saved camera and sliders are handed back through the host, once', async () => {
    const calls: string[] = []
    const saved = JSON.stringify({ view: { azimuth: 120 }, user: true, params: { crank: 77 } })
    const r = await reload(hostAt({ tau: 2, userView: true, overridden: ['crank'], params: { crank: 77 } }, calls), saved)
    expect(calls).toEqual(['param crank=77', 'view {"azimuth":120} {"user":true}'])
    // what was restored is what a second reload keeps
    expect(JSON.parse(r.stored!)).toEqual({ view: { azimuth: 120 }, user: true, params: { crank: 77 } })
  })
  test('a viewer without events or state still reloads', async () => {
    const r = await reload({ ready: Promise.resolve() }, null)
    expect(r.url).not.toBeNull()
    expect(r.url!.searchParams.has('t')).toBe(false)
  })
})

describe('mimir open: the port and the browser', () => {
  // the numbers are built at run time: nothing here listens on them
  const some = 5000 + 173
  test('no fixed port: any free one (0) unless MIMIR_PORT names one', () => {
    expect(preferredPort({})).toBe(0)
    expect(preferredPort({ MIMIR_PORT: String(some) })).toBe(some)
    expect(preferredPort({ MIMIR_PORT: '0' })).toBe(0)
    for (const bad of ['', 'abc', '70000', '-1', '8.5']) expect(preferredPort({ MIMIR_PORT: bad })).toBe(0)
  })
  test('two servers started without a port get two different free ports', () => {
    const root = tempDir()
    const a = startServer({ viewerRoot: root, sceneDir: root, port: preferredPort({}) })
    const b = startServer({ viewerRoot: root, sceneDir: root, port: preferredPort({}) })
    try {
      expect(a.port).toBeGreaterThan(0)
      expect(b.port).toBeGreaterThan(0)
      expect(a.port).not.toBe(b.port)
    } finally { a.stop(); b.stop() }
  })
  test('opening the default browser: the command per platform, found on PATH, never through a shell', () => {
    const url = `http://127.0.0.1:${some}/viewer.html?scene=%2Fscene%2Fa.scene.js`
    const has = (...names: string[]) => (name: string): string | null => (names.includes(name) ? `/bin/${name}` : null)
    expect(browserOpener('darwin', url, has('open'))).toEqual(['/bin/open', url])
    expect(browserOpener('linux', url, has('xdg-open', 'gio'))).toEqual(['/bin/xdg-open', url])
    expect(browserOpener('linux', url, has('gio'))).toEqual(['/bin/gio', 'open', url])
    expect(browserOpener('linux', url, has('wslview'))).toEqual(['/bin/wslview', url])
    expect(browserOpener('win32', url, has('rundll32.exe'))).toEqual(['/bin/rundll32.exe', 'url.dll,FileProtocolHandler', url])
    for (const platform of ['darwin', 'linux', 'win32', 'freebsd']) expect(browserOpener(platform, url, () => null)).toBeNull()
  })
})

describe('shot: views', () => {
  const info = (over: Record<string, unknown>) => ({ title: '', duration: 1, steps: [], params: [], parts: [], views: ['iso', 'front', 'top'], problems: null, fatal: null, ...over })
  test('the scene camera, named views, or the angles of a turntable', () => {
    expect(viewList({ views: [], turntable: null })).toEqual([{ name: null, spec: null }])
    expect(viewList({ views: ['iso', 'top'], turntable: null })).toEqual([{ name: 'iso', spec: 'iso' }, { name: 'top', spec: 'top' }])
    expect(viewList({ views: [], turntable: 4 })).toEqual([
      { name: 'az000', spec: { azimuth: 0 } }, { name: 'az090', spec: { azimuth: 90 } }, { name: 'az180', spec: { azimuth: 180 } }, { name: 'az270', spec: { azimuth: 270 } },
    ])
  })
  test('a misspelt view and a camera flag on a scene without a 3D panel are usage errors', () => {
    expect(() => checkViews(info({}), { views: ['isso'], turntable: null }, 'shot')).toThrow('--views isso: no such view; did you mean iso? (views: iso, front, top)')
    expect(() => checkViews(info({ has3d: false }), { views: [], turntable: 8 }, 'shot')).toThrow('--turntable: this scene has no 3D panel')
    expect(() => checkViews(info({ has3d: false }), { views: ['iso'], turntable: null }, 'shot')).toThrow('--views: this scene has no 3D panel')
    expect(() => checkViews(info({ has3d: true }), { views: ['iso'], turntable: null }, 'shot')).not.toThrow()
    // a host that does not say whether it has 3D is not refused
    expect(() => checkViews(info({ views: null }), { views: ['anything'], turntable: null }, 'shot')).not.toThrow()
  })
})
