import { describe, expect, test } from 'bun:test'
import {
  EXPORT_CSP, bootstrapScript, inlineCssUrls, moduleKey, packHtml, resolveSpecifier, rewriteSpecifiers, scanSpecifiers, scriptJson, pruneFontFaces, replacePathLiteral } from '../../../src/cli/commands/export.ts'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('resolveSpecifier', () => {
  const aliases = { mimir: '/mimir.js', 'mimir/': '/lib/' }
  test('relative and absolute specifiers resolve against the importing module', () => {
    expect(resolveSpecifier('./mimir.3d.js', '/mimir.js', {})).toBe('/mimir.3d.js')
    expect(resolveSpecifier('../shared/util.js', '/scene/sub/a.js', {})).toBe('/scene/shared/util.js')
    expect(resolveSpecifier('./helper.js', '/scene/engine.scene.js', {})).toBe('/scene/helper.js')
    expect(resolveSpecifier('/mimir.js', '/scene/a.js', {})).toBe('/mimir.js')
  })
  test('bare specifiers go through the viewer import map (exact, then longest prefix)', () => {
    expect(resolveSpecifier('mimir', '/scene/a.js', aliases)).toBe('/mimir.js')
    expect(resolveSpecifier('mimir/kit.js', '/scene/a.js', aliases)).toBe('/lib/kit.js')
    expect(resolveSpecifier('three', '/scene/a.js', aliases)).toBeNull()
  })
  test('URLs with a scheme are not local', () => {
    expect(resolveSpecifier('https://cdn.example/x.js', '/a.js', aliases)).toBeNull()
    expect(resolveSpecifier('data:text/javascript,1', '/a.js', aliases)).toBeNull()
  })
})

describe('rewriteSpecifiers', () => {
  const has = (p: string): boolean => ['/mimir.js', '/mimir.3d.js', '/scene/helper.js'].includes(p)
  test('static, side-effect, re-export and literal dynamic imports are rewritten', () => {
    const src = [
      `import { scene } from 'mimir'`,
      `import "./helper.js"`,
      `export * from "./helper.js";`,
      `const three = await import('../mimir.3d.js')`,
    ].join('\n')
    const r = rewriteSpecifiers(src, '/scene/a.scene.js', has, { mimir: '/mimir.js' })
    expect(r.unresolved).toEqual([])
    expect(r.source).toBe(
      [
        `import { scene } from 'mimir-export/mimir.js'`,
        `import "mimir-export/scene/helper.js"`,
        `export * from "mimir-export/scene/helper.js";`,
        `const three = await import('mimir-export/mimir.3d.js')`,
      ].join('\n'),
    )
  })
  test('minified spacing', () => {
    const r = rewriteSpecifiers(`import{a as b}from"./mimir.3d.js";const x=()=>import("./mimir.3d.js");export{b,x}`, '/mimir.js', has, {})
    expect(r.source).toBe(`import{a as b}from"mimir-export/mimir.3d.js";const x=()=>import("mimir-export/mimir.3d.js");export{b,x}`)
  })
  test('imports of modules that are not embedded are left alone and reported', () => {
    const r = rewriteSpecifiers(`const c = () => import('./mimir.check.js')\nimport 'https://cdn.example/x.js'`, '/mimir.js', has, {})
    expect(r.source).toContain(`import('./mimir.check.js')`)
    expect(r.unresolved.sort()).toEqual(['./mimir.check.js', 'https://cdn.example/x.js'])
  })
  test('the same text in an ordinary string is not an import and stays', () => {
    const r = rewriteSpecifiers(`import './helper.js'\nconst label = "./helper.js"`, '/scene/a.js', has, {})
    expect(r.source).toBe(`import 'mimir-export/scene/helper.js'\nconst label = "./helper.js"`)
  })
  test('scanSpecifiers lists each specifier once', () => {
    expect(scanSpecifiers(`import a from './a.js'; import b from './a.js'; import('./b.js')`).sort()).toEqual(['./a.js', './b.js'])
  })
})

describe('embedding helpers', () => {
  test('scriptJson cannot close a script element', () => {
    const json = scriptJson({ a: '</script><!-- x' })
    expect(json).not.toContain('<')
    expect(JSON.parse(json)).toEqual({ a: '</script><!-- x' })
  })
  test('moduleKey is a bare specifier', () => {
    expect(moduleKey('/scene/a.scene.js')).toBe('mimir-export/scene/a.scene.js')
  })
  test('css url() references become data URIs; network ones stay', () => {
    const warnings: string[] = []
    const css = inlineCssUrls(
      `@font-face{src:url("./f.woff2")} a{background:url(img/dot.png)} b{background:url(https://x/y.png)} c{background:url(nope.png)}`,
      '/viewer.css',
      (p) => (p === '/f.woff2' ? enc('FONT') : p === '/img/dot.png' ? enc('PNG') : null),
      warnings,
    )
    expect(css).toContain(`url("data:font/woff2;base64,${Buffer.from('FONT').toString('base64')}")`)
    expect(css).toContain(`url("data:image/png;base64,${Buffer.from('PNG').toString('base64')}")`)
    expect(css).toContain('url(https://x/y.png)')
    expect(css).toContain('url(nope.png)')
    expect(warnings).toEqual(['/viewer.css refers to nope.png, which does not exist; left as is'])
  })
  test('the bootstrap installs an import map and sets ?scene=', () => {
    const js = bootstrapScript({ 'mimir-export/mimir.js': 'export const a = "</script>"' }, { mimir: 'mimir-export/mimir.js' }, 'mimir-export/scene/a.js')
    expect(js).not.toContain('</script')
    expect(js).toContain('map.type = "importmap"')
    expect(js).toContain('here.searchParams.set("scene", "mimir-export/scene/a.js")')
    expect(() => new Function(js)).not.toThrow() // syntactically valid classic script
  })
})

describe('packHtml', () => {
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<link rel="stylesheet" href="./viewer.css">
<link rel="modulepreload" href="./mimir.js">
<script type="importmap">{ "imports": { "mimir": "./mimir.js" } }</script>
<script src="./classic.js"></script>
</head><body>
<img src="logo.png" alt="">
<script type="module" src="./mimir.js"></script>
<script type="module">import { boot } from './mimir.js'; boot()</script>
</body></html>`
  const modules = new Map([
    ['/mimir.js', `export const boot = () => import('./mimir.3d.js')\nconst lint = () => import("./mimir.check.js")\n//# sourceMappingURL=mimir.js.map\n`],
    ['/mimir.3d.js', `export const THREE = 1`],
    ['/scene/a.scene.js', `import { boot } from 'mimir'\nimport './parts.js'\nexport default boot`],
    ['/scene/parts.js', `export const parts = []`],
  ])
  const assets: Record<string, string> = { '/viewer.css': 'body{background:url(bg.png)}', '/bg.png': 'BG', '/logo.png': 'LOGO', '/classic.js': 'window.x = "</script>"' }
  const r = packHtml({ html, modules, scenePath: '/scene/a.scene.js', readAsset: (p) => (p in assets ? enc(assets[p]!) : null) })

  test('the CSP is the first thing in <head>, then the bootstrap', () => {
    const head = r.html.slice(r.html.indexOf('<head>'))
    expect(head.indexOf('Content-Security-Policy')).toBeLessThan(head.indexOf('<script'))
    expect(r.html).toContain(`content="${EXPORT_CSP}"`)
    expect(EXPORT_CSP).toContain("default-src 'none'")
    expect(EXPORT_CSP).toContain("connect-src 'none'")
    expect(head.indexOf('const modules =')).toBeLessThan(head.indexOf('<meta charset'))
  })
  test('every loaded module is embedded with rewritten imports; nothing else', () => {
    expect(r.modules).toEqual(['/mimir.js', '/mimir.3d.js', '/scene/a.scene.js', '/scene/parts.js'])
    expect(r.skipped).toEqual(['/mimir.check.js'])
    expect(r.warnings).toEqual([])
    expect(r.html).toContain(`import('mimir-export/mimir.3d.js')`)
    expect(r.html).toContain(`import { boot } from 'mimir-export/mimir.js'\\nimport 'mimir-export/scene/parts.js'`)
    expect(r.html).toContain(`import(\\"./mimir.check.js\\")`)
    expect(r.html).not.toContain('sourceMappingURL')
  })
  test('module scripts keep their place and import by key; the old import map is gone', () => {
    expect(r.html).toContain('<script type="module">import "mimir-export/mimir.js";</script>')
    expect(r.html).toContain(`<script type="module">import { boot } from 'mimir-export/mimir.js'; boot()</script>`)
    expect(r.html).not.toContain('type="importmap"')
    expect(r.html).toContain('"mimir":"mimir-export/mimir.js"')
    expect(r.html).toContain('here.searchParams.set("scene", "mimir-export/scene/a.scene.js")')
  })
  test('stylesheets, their url()s, images and classic scripts are inlined; preloads dropped', () => {
    expect(r.html).toContain(`<style>body{background:url("data:image/png;base64,${Buffer.from('BG').toString('base64')}")}</style>`)
    expect(r.html).toContain(`<img src="data:image/png;base64,${Buffer.from('LOGO').toString('base64')}" alt="">`)
    expect(r.html).toContain('<script>window.x = "<\\/script>"</script>')
    expect(r.html).not.toContain('modulepreload')
    expect(r.html).not.toContain('href="./viewer.css"')
  })
  test('no reference to a local file is left in the document', () => {
    expect(r.html).not.toMatch(/(?:src|href)\s*=\s*["']\.?\/?(?!data:)[\w./-]+\.(?:js|css|png)["']/)
  })
  test('a document without <head> still gets the policy first', () => {
    const bare = packHtml({ html: '<!doctype html><body><script type="module" src="mimir.js"></script></body>', modules, scenePath: '/scene/a.scene.js', readAsset: () => null })
    expect(bare.html.indexOf('Content-Security-Policy')).toBeLessThan(bare.html.indexOf('<body>'))
    expect(bare.html).toContain('import "mimir-export/mimir.js";')
  })
  test('things that cannot be embedded are reported, not hidden', () => {
    const odd = packHtml({
      html: '<head><script type="module" src="https://cdn.example/lib.js"></script><script type="module" src="./missing.js"></script></head>',
      modules: new Map([['/scene/a.scene.js', `import 'https://cdn.example/x.js'`]]),
      scenePath: '/scene/a.scene.js',
      readAsset: () => null,
    })
    expect(odd.warnings.length).toBe(3)
    expect(odd.warnings.join('\n')).toContain('from the network')
    expect(odd.warnings.join('\n')).toContain('never requested')
    expect(odd.warnings.join('\n')).toContain('not a local file')
  })
})

describe('fonts: only the faces this scene loaded', () => {
  const css = `@font-face{font-family:"CM";src:url(fonts/book.woff2) format("woff2")}
@font-face { font-family: "CM"; font-weight: 700; src: url("./fonts/bold.woff2") format("woff2"), url(fonts/bold.woff) format("woff") }
@font-face{font-family:"Net";src:url(https://cdn.example/x.woff2)}
@font-face{font-family:"In";src:url(data:font/woff2;base64,AAAA)}
body{font-family:CM}`
  test('a face whose file was never fetched is dropped; one of several sources fetched keeps the rule', () => {
    const dropped: string[] = []
    const out = pruneFontFaces(css, '/viewer.css', new Set(['/fonts/bold.woff2']), dropped)
    expect(out).not.toContain('book.woff2')
    expect(out).toContain('bold.woff2')
    expect(out).toContain('bold.woff)')
    expect(dropped).toEqual(['/fonts/book.woff2'])
    // rules that point at the network or at data: are not this function's business; other css is untouched
    expect(out).toContain('cdn.example')
    expect(out).toContain('data:font/woff2')
    expect(out).toContain('body{font-family:CM}')
  })
  test('nothing fetched drops every local face; null keeps everything (--fonts all)', () => {
    const dropped: string[] = []
    expect(pruneFontFaces(css, '/viewer.css', new Set(), dropped)).not.toContain('fonts/')
    expect(dropped.sort()).toEqual(['/fonts/bold.woff', '/fonts/bold.woff2', '/fonts/book.woff2'])
    expect(pruneFontFaces(css, '/viewer.css', null, [])).toBe(css)
  })
  test('packHtml embeds the used face as data, drops the other, and reports both', () => {
    const files: Record<string, string> = { '/viewer.css': css, '/fonts/book.woff2': 'BOOK', '/fonts/bold.woff2': 'BOLD', '/fonts/bold.woff': 'BOLDW' }
    const pack = (usedAssets: Set<string> | null) => packHtml({
      html: '<head><link rel="stylesheet" href="./viewer.css"><style>@font-face{font-family:"Mono";src:url(fonts/mono.woff2)}</style></head>',
      modules: new Map([['/scene/a.scene.js', 'export default 1']]), scenePath: '/scene/a.scene.js', usedAssets,
      readAsset: (path) => (path in files ? enc(files[path]!) : null),
    })
    const used = pack(new Set(['/viewer.css', '/fonts/book.woff2']))
    expect(used.html).toContain(`url("data:font/woff2;base64,${Buffer.from('BOOK').toString('base64')}")`)
    expect(used.html).not.toContain(Buffer.from('BOLD').toString('base64'))
    expect(used.html).not.toContain('mono.woff2')
    expect(used.assets.sort()).toEqual(['/fonts/book.woff2', '/viewer.css'])
    expect(used.fontsDropped.sort()).toEqual(['/fonts/bold.woff', '/fonts/bold.woff2', '/fonts/mono.woff2'])
    expect(used.warnings).toEqual([])
    const all = pack(null)
    expect(all.html).toContain(Buffer.from('BOLD').toString('base64'))
    expect(all.fontsDropped).toEqual([])
    // a face that is kept but whose file is missing on disk is reported, not hidden
    expect(all.warnings.join('\n')).toContain('fonts/mono.woff2, which does not exist')
  })
})

describe('files a script loads at run time', () => {
  test('replacePathLiteral: the path as a string or inside url(), with or without ./ or /', () => {
    const text = `new FontFace("CM", "url(./fonts/a.woff2)"); load('fonts/a.woff2'); x = \`/fonts/a.woff2\`; keep = "fonts/a.woff2.bak"; other = 'myfonts/a.woff2'`
    const r = replacePathLiteral(text, '/fonts/a.woff2', 'data:X')
    expect(r.count).toBe(3)
    expect(r.text).toBe(`new FontFace("CM", "url(data:X)"); load('data:X'); x = \`data:X\`; keep = "fonts/a.woff2.bak"; other = 'myfonts/a.woff2'`)
    expect(replacePathLiteral('nothing here', '/fonts/a.woff2', 'data:X')).toEqual({ text: 'nothing here', count: 0 })
  })
  test('packHtml embeds a font named in a module, a scene image named relative to the scene, and reports what it could not', () => {
    const files: Record<string, string> = { '/fonts/a.woff2': 'FONT', '/scene/logo.png': 'LOGO', '/data.bin': 'BIN' }
    const r = packHtml({
      html: '<head></head><body></body>',
      modules: new Map([
        ['/mimir.js', `const face = new FontFace('CM', 'url(./fonts/a.woff2)')`],
        ['/scene/a.scene.js', `const img = new URL('./logo.png', import.meta.url)\nexport default 1`],
      ]),
      scenePath: '/scene/a.scene.js',
      readAsset: (path) => (path in files ? enc(files[path]!) : null),
      runtimeAssets: ['/fonts/a.woff2', '/scene/logo.png', '/data.bin', '/gone.png'],
    })
    expect(r.html).toContain(`url(data:font/woff2;base64,${Buffer.from('FONT').toString('base64')})`)
    expect(r.html).toContain(`new URL('data:image/png;base64,${Buffer.from('LOGO').toString('base64')}', import.meta.url)`)
    expect(r.assets.sort()).toEqual(['/fonts/a.woff2', '/scene/logo.png'])
    expect(r.unembedded).toEqual(['/data.bin', '/gone.png'])
  })
})
