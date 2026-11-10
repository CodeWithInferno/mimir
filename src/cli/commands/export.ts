// mimir export <scene> [-o out.html] [--mp4 out.mp4] [--md out.md [--frames]]
//
// -o: ONE self-contained file that runs from file:// with no network.
//
// How: the scene is loaded once in the real viewer and the server records which files the page asked for.
// Exactly those modules (the chunks this scene needs) plus the scene source are embedded as text. A small
// classic script turns each into a blob: URL and installs an import map, so every `import` between them
// resolves without touching the network; import specifiers inside the modules are rewritten to
// "mimir-export/<path>" keys because a blob: module cannot resolve "./sibling.js". Stylesheets and local
// images are inlined, and a no-network Content-Security-Policy makes "self-contained" enforceable.
// The written file is then opened from file:// in the same browser and must reach __mimir.ready.
// Fonts: a face is embedded only when this scene made the browser fetch its file (--fonts all keeps every face).
//
// --mp4: every frame seeked and piped to ffmpeg (src/cli/video.ts).  --md: the transcript as an article
// (src/cli/article.ts), with a frame per step when --frames is given.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_SIZE, VIDEO_SIZE, type ExportOptions } from '../args.ts'
import { articleMarkdown } from '../article.ts'
import type { Page } from '../chrome.ts'
import { CliError, UsageError } from '../errors.ts'
import { fatalToDiag, formatDiagText, type SceneInfo } from '../format.ts'
import type { Io } from '../io.ts'
import { planFrames, sha256Hex } from '../manifest.ts'
import { frameExpression } from '../pageside.ts'
import { checkSets } from '../params.ts'
import { ensureViewer, resolveScene, type SceneRef, type ViewerRoot } from '../paths.ts'
import { contentType, safeJoin } from '../server.ts'
import { openSession, timeoutFromEnv, waitReady, type Session } from '../session.ts'
import { FFMPEG_MISSING, encodeVideo, findFfmpeg, findFfprobe, type VideoResult } from '../video.ts'

export const EXPORT_PREFIX = 'mimir-export'

/** everything Mimir needs still works under this policy; any network use fails loudly. */
export const EXPORT_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'"

/** "/mimir.3d.js" → "mimir-export/mimir.3d.js": a bare specifier, so the import map resolves it from any module. */
export function moduleKey(path: string): string {
  return EXPORT_PREFIX + path
}

const isJs = (path: string): boolean => /\.m?js$/i.test(path)
/** a JSON module: `import data from './data.json' with { type: 'json' }` */
const isJson = (path: string): boolean => /\.json$/i.test(path)
/** dev-only chunk: never part of an export */
const isCheckChunk = (path: string): boolean => /(^|\/)mimir\.check[.-][^/]*$/i.test(path) || /(^|\/)mimir\.check\.js$/i.test(path)

/** bare specifier → server path, from the viewer's own import map */
export type Aliases = Record<string, string>

/** Server path a specifier points to, or null for anything that is not a local file (http:, data:, unknown bare). */
export function resolveSpecifier(spec: string, fromPath: string, aliases: Aliases): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return null
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
    return new URL(spec, `http://mimir.invalid${fromPath}`).pathname
  }
  if (aliases[spec] !== undefined) return aliases[spec]!
  let best: string | null = null
  for (const prefix of Object.keys(aliases)) {
    if (prefix.endsWith('/') && spec.startsWith(prefix) && (best === null || prefix.length > best.length)) best = prefix
  }
  return best === null ? null : aliases[best]! + spec.slice(best.length)
}

/** Every import specifier in a module (static, re-export and literal dynamic imports). */
export function scanSpecifiers(source: string): string[] {
  const transpiler = new Bun.Transpiler({ loader: 'js' })
  return [...new Set(transpiler.scanImports(source).map((i) => i.path))]
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Rewrite the specifiers that point at embedded modules to their "mimir-export/…" keys. Specifiers that point
 * elsewhere are left alone and returned as `unresolved` (they fail loudly under the CSP if ever reached).
 */
export function rewriteSpecifiers(
  source: string, fromPath: string, has: (path: string) => boolean, aliases: Aliases,
): { source: string; unresolved: string[] } {
  let out = source
  const unresolved: string[] = []
  let specs: string[]
  try {
    specs = scanSpecifiers(source)
  } catch (e) {
    throw new CliError(`cannot parse ${fromPath} to find its imports: ${(e as Error).message}`)
  }
  for (const spec of specs) {
    const target = resolveSpecifier(spec, fromPath, aliases)
    if (target === null || !has(target)) {
      unresolved.push(spec)
      continue
    }
    const key = moduleKey(target)
    if (isJson(target)) {
      // a JSON module is embedded as a script module (`export default {…}`): a script blob is all the export's policy
      // lets a page load, so the import attribute goes: `from "x" with { type: "json" }` → `from "x"`
      const q = `(["'\`])${escapeRegExp(spec)}\\2` // group 2: the quote (group 1 is everything that is kept)
      out = out.replace(new RegExp(`(\\bfrom\\s*${q})\\s*(?:with|assert)\\s*\\{[^{}]*\\}`, 'g'), '$1')
      out = out.replace(new RegExp(`(\\bimport\\s*\\(\\s*${q})\\s*,\\s*\\{[^()]*\\}\\s*\\)`, 'g'), '$1)')
    }
    // `from "x"`, `import "x"`, `import("x")` in any spacing a minifier leaves
    const re = new RegExp(`(\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s*)(["'\`])${escapeRegExp(spec)}\\2`, 'g')
    out = out.replace(re, (_m, lead: string, quote: string) => `${lead}${quote}${key}${quote}`)
  }
  return { source: out, unresolved }
}

/** JSON that is safe inside a classic <script>: no "</script", no "<!--". */
export function scriptJson(value: unknown): string {
  // U+2028 / U+2029 are legal inside string literals since ES2019, so only "<" needs escaping
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function dataUri(path: string, bytes: Uint8Array): string {
  return `data:${contentType(path).replace(/;\s*charset=[^;]+/i, '')};base64,${Buffer.from(bytes).toString('base64')}`
}

const isLocalRef = (ref: string): boolean => ref !== '' && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)
const refPath = (ref: string, fromPath: string): string => new URL(ref, `http://mimir.invalid${fromPath}`).pathname

const isFont = (path: string): boolean => /\.(woff2?|ttf|otf|eot)$/i.test(path)

/** What the packer did with files that are not modules: for the result and for its tests. */
export interface AssetLog {
  /** server paths that were inlined (stylesheets, images, fonts, classic scripts) */
  inlined: Set<string>
  /** font files of @font-face rules that were left out because this scene never loaded them */
  fontsDropped: string[]
}

/**
 * Drop the @font-face rules whose files the page never fetched (`used` = the files it did fetch). A browser only
 * downloads a face when some text needs it, so an unfetched face is one this scene does not show. `used: null`
 * keeps every rule. Rules that point at data: or the network are left alone.
 */
export function pruneFontFaces(css: string, cssPath: string, used: ReadonlySet<string> | null, dropped: string[]): string {
  if (used === null) return css
  return css.replace(/@font-face\s*\{[^{}]*\}/g, (rule) => {
    const local = [...rule.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)].map((m) => m[2]!).filter(isLocalRef).map((ref) => refPath(ref, cssPath))
    if (local.length === 0 || local.some((path) => used.has(path))) return rule
    for (const path of local) if (!dropped.includes(path)) dropped.push(path)
    return ''
  })
}

/** Inline url(...) references of a stylesheet as data: URIs. */
export function inlineCssUrls(css: string, cssPath: string, readAsset: (path: string) => Uint8Array | null, warnings: string[], log?: AssetLog): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, _q: string, ref: string) => {
    if (!isLocalRef(ref)) return whole
    const path = refPath(ref, cssPath)
    const bytes = readAsset(path)
    if (bytes === null) {
      warnings.push(`${cssPath} refers to ${ref}, which does not exist; left as is`)
      return whole
    }
    log?.inlined.add(path)
    return `url("${dataUri(path, bytes)}")`
  })
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}

export interface PackInput {
  /** text of viewer.html */
  html: string
  /** server path → source of every module the page loaded, the scene module included */
  modules: Map<string, string>
  /** server path of the scene module, e.g. /scene/engine.scene.js */
  scenePath: string
  /** on-demand modules whose API this scene uses (info().features): the exported page loads exactly these, it cannot read the source to find out */
  features?: string[]
  /** bytes of a file by server path (stylesheets, images, fonts, classic scripts), or null */
  readAsset(path: string): Uint8Array | null
  /** files the page fetched while the scene ran: only the @font-face rules among them are kept. Absent / null = keep every face */
  usedAssets?: ReadonlySet<string> | null
  /**
   * Files a script fetched at run time (a font or an image named in code, not in the document). Each is embedded
   * where its path is written as a literal ("./fonts/x.woff2", url(fonts/x.woff2)); the rest come back in `unembedded`.
   */
  runtimeAssets?: readonly string[]
}

export interface PackResult {
  html: string
  /** server paths of the embedded modules */
  modules: string[]
  /** local modules that are imported somewhere but were not loaded by this scene, so they are left out */
  skipped: string[]
  warnings: string[]
  /** server paths of the files that were inlined: stylesheets, images, fonts, classic scripts */
  assets: string[]
  /** font files left out because this scene never loaded them */
  fontsDropped: string[]
  /** runtime assets whose path appears nowhere as a literal: they cannot be embedded */
  unembedded: string[]
}

/** The classic script that makes the embedded modules importable. Runs before any module script. */
export function bootstrapScript(modules: Record<string, string>, aliases: Record<string, string>, sceneKey: string, features: string[] = []): string {
  return `(() => {
  // Mimir export: every module of this page is embedded below as text and loaded from a blob: URL.
  const modules = ${scriptJson(modules)};
  const aliases = ${scriptJson(aliases)};
  const prefix = ${JSON.stringify(EXPORT_PREFIX)};
  const imports = {};
  for (const key of Object.keys(modules)) {
    const url = URL.createObjectURL(new Blob([modules[key]], { type: "text/javascript" }));
    imports[key] = url;
    // the same module addressed by URL from this document (the viewer may resolve the scene parameter first)
    for (const ref of [key, key.slice(prefix.length), "." + key.slice(prefix.length)]) {
      try { imports[new URL(ref, location.href).href] = url; } catch {}
    }
  }
  for (const name of Object.keys(aliases)) if (imports[aliases[name]]) imports[name] = imports[aliases[name]];
  const map = document.createElement("script");
  map.type = "importmap";
  map.textContent = JSON.stringify({ imports });
  document.currentScript.after(map);
  // same page contract as the dev server: viewer.html?scene=<module url>
  const here = new URL(location.href);
  here.searchParams.set("scene", ${JSON.stringify(sceneKey)});
  // the on-demand modules this scene uses (their API chunks are embedded above; no others are)
  here.searchParams.set("features", ${JSON.stringify(features.join(','))});
  history.replaceState(null, "", here);
})();`
}

/** Replace a path written as a literal ("./fonts/a.woff2", 'fonts/a.woff2', url(/fonts/a.woff2)) by `value`. Returns the text and how often. */
export function replacePathLiteral(text: string, path: string, value: string): { text: string; count: number } {
  const rel = path.replace(/^\/+/, '')
  let count = 0
  const re = new RegExp(`(["'\`(]\\s*)(?:\\./|/)?${escapeRegExp(rel)}(?=\\s*["'\`)])`, 'g')
  const out = text.replace(re, (_m, lead: string) => { count++; return lead + value })
  return { text: out, count }
}

/** Turn viewer.html + the loaded modules into one self-contained document. Pure given `readAsset`. */
export function packHtml(input: PackInput): PackResult {
  const warnings: string[] = []
  const htmlPath = '/viewer.html'
  let html = input.html
  const log: AssetLog = { inlined: new Set(), fontsDropped: [] }
  const used = input.usedAssets ?? null
  const css = (text: string, path: string): string => inlineCssUrls(pruneFontFaces(text, path, used, log.fontsDropped), path, input.readAsset, warnings, log)

  // 1. the viewer's own import map: remember it, drop it (the bootstrap installs the only map)
  const aliases: Aliases = {}
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs: string, body: string) => {
    if ((attr(attrs, 'type') ?? '').toLowerCase() !== 'importmap') return whole
    try {
      const map = JSON.parse(body) as { imports?: Record<string, string> }
      for (const [name, target] of Object.entries(map.imports ?? {})) {
        if (isLocalRef(target)) aliases[name] = refPath(target, htmlPath)
      }
    } catch (e) {
      warnings.push(`the import map in viewer.html is not valid JSON (${(e as Error).message}); ignored`)
    }
    return ''
  })

  const has = (path: string): boolean => input.modules.has(path)
  const skipped = new Set<string>()
  const noteUnresolved = (from: string, specs: string[]): void => {
    for (const s of specs) {
      const target = resolveSpecifier(s, from, aliases)
      // a local chunk this scene never loaded is the point of the export; anything else is worth a warning
      if (target !== null) skipped.add(target)
      else warnings.push(`${from} imports "${s}", which is not a local file; it is blocked in the export`)
    }
  }

  // 2. scripts
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs: string, body: string) => {
    const type = (attr(attrs, 'type') ?? '').toLowerCase()
    const src = attr(attrs, 'src')
    const isModule = type === 'module'
    const isClassic = type === '' || type === 'text/javascript' || type === 'application/javascript'
    if (src !== null) {
      if (!isLocalRef(src)) {
        warnings.push(`viewer.html loads ${src} from the network; left as is (blocked by the export's CSP)`)
        return whole
      }
      const path = refPath(src, htmlPath)
      if (isModule) {
        if (!has(path)) {
          warnings.push(`viewer.html loads the module ${src}, which the page never requested; left as is`)
          return whole
        }
        return `<script type="module">import ${JSON.stringify(moduleKey(path))};</script>`
      }
      if (isClassic) {
        const bytes = input.readAsset(path)
        if (bytes === null) {
          warnings.push(`viewer.html loads ${src}, which does not exist; left as is`)
          return whole
        }
        log.inlined.add(path)
        const cleaned = attrs.replace(/\s*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
        return `<script${cleaned}>${new TextDecoder().decode(bytes).replace(/<\/script/gi, '<\\/script')}</script>`
      }
      return whole
    }
    if (isModule) {
      const r = rewriteSpecifiers(body, htmlPath, has, aliases)
      noteUnresolved('viewer.html', r.unresolved)
      return `<script${attrs}>${r.source}</script>`
    }
    return whole
  })

  // 3. <link>: stylesheets inline, preloads dropped, icons as data URIs
  html = html.replace(/<link\b([^>]*)>/gi, (whole, attrs: string) => {
    const rel = (attr(attrs, 'rel') ?? '').toLowerCase()
    const href = attr(attrs, 'href')
    if (href === null || !isLocalRef(href)) return /preload|prefetch|preconnect/.test(rel) ? '' : whole
    const path = refPath(href, htmlPath)
    if (/modulepreload|preload|prefetch/.test(rel)) return ''
    const bytes = input.readAsset(path)
    if (rel.split(/\s+/).includes('stylesheet')) {
      if (bytes === null) {
        warnings.push(`viewer.html links ${href}, which does not exist; dropped`)
        return ''
      }
      log.inlined.add(path)
      return `<style>${css(new TextDecoder().decode(bytes), path).replace(/<\/style/gi, '<\\/style')}</style>`
    }
    if (/icon/.test(rel)) {
      if (bytes !== null) log.inlined.add(path)
      return bytes === null ? '' : whole.replace(/(\bhref\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${dataUri(path, bytes)}"`)
    }
    return whole
  })

  // 4. inline <style> blocks and <img src>
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_w, open: string, text: string, close: string) => open + css(text, htmlPath) + close)
  html = html.replace(/<img\b([^>]*)>/gi, (whole, attrs: string) => {
    const src = attr(attrs, 'src')
    if (src === null || !isLocalRef(src)) return whole
    const path = refPath(src, htmlPath)
    const bytes = input.readAsset(path)
    if (bytes === null) return whole
    log.inlined.add(path)
    return whole.replace(/(\bsrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${dataUri(path, bytes)}"`)
  })

  // 5. modules: rewrite their imports, embed
  const embedded: Record<string, string> = {}
  for (const [path, source] of input.modules) {
    if (isJson(path)) {
      // data: embedded as a module whose default export is the value
      try { embedded[moduleKey(path)] = `export default ${JSON.stringify(JSON.parse(source))};\n` } catch (e) { warnings.push(`${path} is not valid JSON (${(e as Error).message}); left out`) }
      continue
    }
    const r = rewriteSpecifiers(source.replace(/\n\/\/[#@] sourceMappingURL=[^\n]*\s*$/, '\n'), path, has, aliases)
    noteUnresolved(path, r.unresolved)
    embedded[moduleKey(path)] = r.source
  }
  const aliasKeys: Record<string, string> = {}
  for (const [name, path] of Object.entries(aliases)) if (has(path)) aliasKeys[name] = moduleKey(path)

  // 6. files a script fetched at run time: embedded wherever their path is written as a literal
  const unembedded: string[] = []
  for (const path of input.runtimeAssets ?? []) {
    if (log.inlined.has(path)) continue
    const bytes = input.readAsset(path)
    if (bytes === null) { unembedded.push(path); continue }
    const uri = dataUri(path, bytes)
    let count = 0
    // a file of the scene directory is named relative to the scene in its code ("./logo.png"), not as /scene/logo.png
    for (const written of path.startsWith('/scene/') ? [path, path.slice('/scene'.length)] : [path]) {
      for (const key of Object.keys(embedded)) {
        const r = replacePathLiteral(embedded[key]!, written, uri)
        embedded[key] = r.text
        count += r.count
      }
      const inDoc = replacePathLiteral(html, written, uri)
      html = inDoc.text
      count += inDoc.count
    }
    if (count > 0) log.inlined.add(path)
    else unembedded.push(path)
  }

  // 7. CSP first, then the bootstrap, before anything else in <head>
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">\n` +
    `<script>${bootstrapScript(embedded, aliasKeys, moduleKey(input.scenePath), input.features ?? [])}</script>\n`
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${head}`)
  else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>\n${head}</head>`)
  else html = html.replace(/^(\s*<!doctype[^>]*>)?/i, (m) => `${m}\n<head>\n${head}</head>\n`)

  return { html, modules: [...input.modules.keys()], skipped: [...skipped], warnings, assets: [...log.inlined], fontsDropped: log.fontsDropped, unembedded }
}

// ── the HTML file ────────────────────────────────────────────────────────────────────────────────

export interface HtmlResult { path: string; bytes: number; modules: string[]; skipped: string[]; verified: boolean; warnings: string[]; fonts?: { embedded: string[]; dropped: string[] }; stale?: true }

interface HtmlJob { session: Session; scene: SceneRef; viewer: ViewerRoot; outPath: string; requested: string[]; opts: ExportOptions; io: Io }

async function exportHtml(job: HtmlJob): Promise<HtmlResult> {
  const { session, scene, viewer, outPath, requested, opts, io } = job
  const info = session.info
  const viewerHtml = resolve(viewer.dir, 'viewer.html')
  const toFile = (path: string): string | null =>
    path === '/scene' || path.startsWith('/scene/') ? safeJoin(scene.dir, path.slice('/scene'.length) || '/') : safeJoin(viewer.dir, path)
  const readAsset = (path: string): Uint8Array | null => {
    const file = toFile(path)
    if (file === null || !existsSync(file)) return null
    return new Uint8Array(readFileSync(file))
  }
  // Visit the end of every step, then the end and the start of the story, so chunks that load on demand and the
  // fonts of text that only appears later are requested too.
  if (info.duration > 0) {
    for (const s of info.steps) {
      await session.host('seek', Math.max(s.t0, s.t1 - 0.001))
      await session.host('frame')
    }
    await session.host('seek', info.duration)
    await session.host('frame')
    await session.host('seek', 0)
    await session.host('frame')
  }
  // a font file is requested when text needs it; the request can still be in flight after the frame
  try { await session.page.evaluate('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true', timeoutFromEnv()) } catch { /* no font loading API */ }

  const modules = new Map<string, string>()
  const other: string[] = []
  for (const path of requested) {
    if (path === '/viewer.html' || path === '/' || path === '/events' || path.startsWith('/__mimir/')) continue
    if (isJs(path) && !isCheckChunk(path)) {
      const bytes = readAsset(path)
      if (bytes !== null) modules.set(path, new TextDecoder().decode(bytes))
    } else if (!isJs(path)) other.push(path)
  }
  // JSON that a module imports is a module too: embed it, so `import data from './data.json' with { type: 'json' }` works offline
  const transpiler = new Bun.Transpiler({ loader: 'js' })
  for (const [from, source] of [...modules]) {
    let specs: string[] = []
    try { specs = transpiler.scanImports(source).map((i) => i.path) } catch { /* reported by the packer */ }
    for (const spec of specs) {
      const target = resolveSpecifier(spec, from, {})
      if (target === null || !isJson(target) || modules.has(target) || !other.includes(target)) continue
      const bytes = readAsset(target)
      if (bytes === null) continue
      modules.set(target, new TextDecoder().decode(bytes))
      other.splice(other.indexOf(target), 1)
    }
  }
  if (!modules.has(scene.url)) {
    throw new CliError(`the viewer never loaded the scene module ${scene.url}; cannot export (does the viewer import ?scene=…?)`)
  }

  const features = ((await session.host<{ features?: string[] }>('info'))?.features ?? []).filter((x) => typeof x === 'string')
  const packed = packHtml({
    html: readFileSync(viewerHtml, 'utf8'), modules, scenePath: scene.url, readAsset, features,
    usedAssets: opts.fonts === 'all' ? null : new Set(other),
    // fonts and images named in code: embedded where their path is a literal. Anything else a script fetched stays out
    runtimeAssets: other.filter((path) => /\.(woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico)$/i.test(path)),
  })
  const warnings = [...packed.warnings]
  const fetched = other.filter((path) => !packed.assets.includes(path))
  // anything the page fetched by script and that could not be embedded cannot be reached offline
  for (const path of fetched) warnings.push(`the page loaded ${path} at run time (fetch); it is not embedded and is blocked in the export. Import the data instead: import data from './${path.split('/').pop()}' with { type: 'json' }`)
  if (info.problems && info.problems.errors > 0) warnings.push(`the scene has ${info.problems.errors} error${info.problems.errors === 1 ? '' : 's'}; the export shows what could still be built. Run: mimir check ${opts.scene}`)
  if (viewer.stale) warnings.push('the viewer could not be rebuilt: this export was made with the last good build, not with the current sources')
  const hint = fetched.length ? ` The scene fetched ${fetched.join(', ')} at run time, which an offline file cannot do: import the data instead (import data from './file.json' with { type: 'json' }).` : ''

  // The file only gets its final name once it has been seen to work: it is written next to the target,
  // opened from file:// in the same browser, and must become ready with the same story.
  const draft = `${outPath}.unverified.html`
  /** the draft is kept only when it is the evidence: a file that was written and then failed its own offline check */
  let keepDraft = false
  try {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(draft, packed.html)
    keepDraft = true
    const bytes = Buffer.byteLength(packed.html)
    const timeoutMs = timeoutFromEnv()
    const before = session.consoleErrors.length
    const page = await session.browser.newPage(1280, 720, 1)
    const fileUrl = pathToFileURL(draft).href
    let again: SceneInfo
    try {
      await page.navigate(fileUrl, timeoutMs)
      again = await waitReady(page, timeoutMs, fileUrl)
    } catch (e) {
      throw new CliError(`the export does not run from file:// (${(e as Error).message}); the failing file was kept at ${draft}.${hint}`)
    }
    await page.close()
    const blocked = session.consoleErrors.slice(before)
    if (again.fatal) {
      throw new CliError(`the export does not run from file://: ${again.fatal.message.split('\n')[0]}; the failing file was kept at ${draft}.${hint}`)
    }
    if (again.title !== info.title || again.steps.length !== info.steps.length) {
      throw new CliError(
        `opened from file:// the export shows a different story ("${again.title}", ${again.steps.length} steps) ` +
          `than the dev server ("${info.title}", ${info.steps.length} steps); the failing file was kept at ${draft}`,
      )
    }
    keepDraft = false
    renameSync(draft, outPath)
    for (const b of blocked) warnings.push(`console error when opened from file://: ${b}`)
    for (const w of warnings) io.log(`warning: ${w}`)
    if (packed.skipped.length) io.log(`left out (not used by this scene): ${packed.skipped.join(', ')}`)
    const fonts = packed.assets.filter(isFont)
    if (packed.fontsDropped.length) io.log(`fonts left out (this scene never loads them; --fonts all keeps them): ${packed.fontsDropped.join(', ')}`)
    return {
      path: outPath, bytes, modules: packed.modules, skipped: packed.skipped, verified: true, warnings,
      ...(fonts.length || packed.fontsDropped.length ? { fonts: { embedded: fonts, dropped: packed.fontsDropped } } : {}),
      ...(viewer.stale ? { stale: true as const } : {}),
    }
  } finally {
    // no leftovers: the draft stays only when it is the file that failed its own offline check (the error names it)
    if (!keepDraft) rmSync(draft, { force: true })
  }
}

// ── the article ──────────────────────────────────────────────────────────────────────────────────

export interface ArticleResult { path: string; bytes: number; steps: number; chapters: number; words: number; frames: Array<{ path: string; step: number; t: number; sha256: string }> }

async function exportArticle(session: Session, scene: SceneRef, mdPath: string, opts: ExportOptions): Promise<ArticleResult> {
  const info = session.info
  const frames: ArticleResult['frames'] = []
  const refs = new Map<number, string>()
  mkdirSync(dirname(mdPath), { recursive: true })
  if (opts.frames && info.steps.length) {
    const size = opts.size ?? DEFAULT_SIZE
    // the images sit in a directory named after the article, so the two can be moved together
    const dir = join(dirname(mdPath), `${basename(mdPath, extname(mdPath))}-frames`)
    mkdirSync(dir, { recursive: true })
    const page = await session.scenePage(size.width, size.height, 1)
    const timeoutMs = timeoutFromEnv()
    for (const plan of planFrames(info, { kind: 'steps' })) {
      await page.evaluate(frameExpression(plan.t, opts.sets, null), timeoutMs)
      const png = await page.screenshot(timeoutMs)
      const path = join(dir, `${plan.stem}.png`)
      writeFileSync(path, png)
      frames.push({ path, step: plan.step ?? 0, t: plan.t, sha256: sha256Hex(png) })
      if (plan.step !== null) refs.set(plan.step, relative(dirname(mdPath), path).split('\\').join('/'))
    }
    await page.close()
  }
  const article = articleMarkdown(info, { frames: refs })
  if (!info.transcript?.length) process.stderr.write(`mimir: the viewer reports no transcript for ${scene.file}: the article has the step titles only\n`)
  writeFileSync(mdPath, article.markdown)
  return { path: mdPath, bytes: Buffer.byteLength(article.markdown), steps: article.steps, chapters: article.chapters, words: article.words, frames }
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

/** An output path may not be a directory: that mistake would otherwise fail at the very end, after all the work. */
function outputPath(flag: string, value: string, cwd: string, sceneName: string, ext: string): string {
  const path = resolve(cwd, value)
  let isDir = false
  try { isDir = statSync(path).isDirectory() } catch { /* does not exist yet: fine */ }
  if (isDir) throw new UsageError(`${flag} ${value} is a directory; name the file to write, e.g. ${flag} ${value.replace(/\/+$/, '')}/${sceneName}.${ext}`, 'export')
  return path
}

export async function exportScene(opts: ExportOptions, io: Io): Promise<number> {
  const scene = resolveScene(opts.scene, io.cwd, 'export')
  const outPath = opts.out === null ? null : outputPath('-o', opts.out, io.cwd, scene.name, 'html')
  const mp4Path = opts.mp4 === null ? null : outputPath('--mp4', opts.mp4, io.cwd, scene.name, 'mp4')
  const mdPath = opts.md === null ? null : outputPath('--md', opts.md, io.cwd, scene.name, 'md')
  // a missing encoder is known before any browser starts
  const ffmpeg = mp4Path === null ? null : findFfmpeg(io.env)
  if (mp4Path !== null && ffmpeg === null) throw new CliError(FFMPEG_MISSING)
  const viewer = await ensureViewer(io.env, io.log)

  // The HTML file is packed from what a real viewer page loads (not headless: the player chunks are part of the
  // export); a run that only makes a video or an article needs no such page.
  const requested: string[] = []
  const session = await openSession({
    scene, viewerRoot: viewer.dir, width: 1280, height: 720, scale: 1, headless: outPath === null, log: io.log,
    onRequest: (pathname, status) => {
      if (status === 200 && !requested.includes(pathname)) requested.push(pathname)
    },
  })
  let html: HtmlResult | null = null
  let md: ArticleResult | null = null
  let mp4: VideoResult | null = null
  try {
    const info = session.info
    if (info.fatal) {
      process.stderr.write(formatDiagText(fatalToDiag(info.fatal, scene.url), [], { sceneDir: scene.dir, cwd: io.cwd }) + '\n')
      io.log('nothing exported: the scene failed to load (see mimir check)')
      return 1
    }
    checkSets(info, opts.sets, 'export')
    if (opts.sets.length && outPath !== null) io.log('--set applies to the video and to the frames of the article; the HTML file starts from the declared values')
    const end = opts.to ?? info.duration
    if (mp4Path !== null) {
      if (end > info.duration + 1e-9) throw new UsageError(`--to ${end}: past the end of the story (duration ${info.duration}s)`, 'export')
      if ((opts.from ?? 0) >= end) throw new UsageError(`--from ${opts.from ?? 0}: the video would be empty (it ends at ${end}s)`, 'export')
    }
    if (outPath !== null) html = await exportHtml({ session, scene, viewer, outPath, requested: [...requested], opts, io })
    if (mdPath !== null) md = await exportArticle(session, scene, mdPath, opts)
    if (mp4Path !== null) {
      const size = opts.size ?? VIDEO_SIZE
      const frames = Math.max(1, Math.round((end - (opts.from ?? 0)) * opts.fps))
      mkdirSync(dirname(mp4Path), { recursive: true })
      io.log(`video: ${frames} frames at ${size.width}x${size.height}, ${opts.fps} fps`)
      // what the pictures depend on besides the options: the scene file and the build that renders it
      const fingerprint = sha256Hex(new Uint8Array(readFileSync(scene.path))) + ':' + (existsSync(join(viewer.dir, 'build.json')) ? sha256Hex(new Uint8Array(readFileSync(join(viewer.dir, 'build.json')))) : '') + ':' + info.duration
      mp4 = await encodeVideo({ open: () => session.scenePage(size.width, size.height, 1), close: (page) => page.close() }, {
        out: mp4Path, ffmpeg: ffmpeg!, ffprobe: findFfprobe(ffmpeg!, io.env), fps: opts.fps, crf: opts.crf, size, from: opts.from ?? 0, to: end, sets: opts.sets, jobs: opts.jobs, fingerprint, log: io.log,
      })
    }
  } finally {
    await session.close()
  }
  // -o alone keeps the shape it always had; the other outputs are added under their own keys
  const stale = viewer.stale ? { stale: true as const } : {}
  const result = { ...(html ?? {}), ...(md ? { md } : {}), ...(mp4 ? { mp4 } : {}), ...(html ? {} : stale) }
  if (io.json) io.out(JSON.stringify(result) + '\n')
  else {
    const lines: string[] = []
    if (html) lines.push(`${html.path}  ${(html.bytes / 1024).toFixed(1)} KB  ${html.modules.length} modules  verified from file://`)
    if (md) lines.push(`${md.path}  ${md.steps} steps  ${md.words} words${md.frames.length ? `  ${md.frames.length} frames` : ''}`)
    if (mp4) lines.push(`${mp4.path}  ${(mp4.bytes / 1024 / 1024).toFixed(1)} MB  ${mp4.frames} frames  ${mp4.width}x${mp4.height}  ${mp4.fps} fps`)
    io.out(lines.join('\n') + '\n')
  }
  return 0
}
